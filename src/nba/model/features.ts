// Agrégation des play-by-play en profils joueurs / équipes / ligue, à une date donnée (point-in-time),
// avec pondération de la forme récente : poids = DECAY^(matchs joués depuis) × escompte de saison précédente.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readCache, CACHE_DIR } from '../../data/http.ts';
import type { GameRecord } from '../../data/cdn.ts';
import { parseGame, shotLabel, START_TYPES, type ParsedGame, type StartType } from './pbp.ts';
import { ZONES, type Zone } from './zones.ts';
import { seasonOfGameId, seasonsBetween } from '../seasons.ts';

export const DECAY = 0.97; // demi-vie ≈ 23 matchs joués
export const PREV_SEASON_DISCOUNT = 0.8;
export const PREV_DECAY = 0.993; // saison précédente : demi-vie ≈ 100 matchs
export const PLAYOFF_DISCOUNT = 0.8;
/**
 * Poids de la saison en cours face aux précédentes (réglables pour le contrôle de justesse) :
 *   prevDiscount : escompte d'un match de la saison précédente ;
 *   prevFade     : en plus, chaque match joué cette saison retire cette part aux matchs des saisons précédentes.
 */
export const RECENCY = { decay: DECAY, prevDiscount: PREV_SEASON_DISCOUNT, prevDecay: PREV_DECAY, prevFade: 1 };
export function setRecency(p: Partial<typeof RECENCY>): void {
  for (const k of Object.keys(RECENCY) as Array<keyof typeof RECENCY>) if (typeof p[k] === 'number') RECENCY[k] = p[k]!;
}

export type ZoneArr = [number, number, number, number, number, number];
export const zArr = (): ZoneArr => [0, 0, 0, 0, 0, 0];
export const zi = (z: Zone): number => ZONES.indexOf(z);

export interface GameLine {
  gameId: string;
  date: string;
  season: string;
  tm: number;
  opp: number;
  home: boolean;
  starter: boolean;
  sec: number;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  stl: number;
  blk: number;
  tov: number;
  fga: number;
  fta: number;
  pf: number;
}

export interface PlayerFeat {
  id: number;
  lastTeam: number;
  games: GameLine[]; // ordre chronologique
  // sommes pondérées
  w: number; // somme des poids (matchs effectifs)
  sec: number;
  offPoss: number;
  defPoss: number;
  fga: ZoneArr;
  fgm: ZoneArr;
  astdM: ZoneArr; // paniers assistés
  fta: number;
  ftm: number;
  tov: number;
  tovLive: number;
  stl: number;
  blk: ZoneArr;
  oppFgaOn: ZoneArr;
  pfShoot: number;
  pfOther: number;
  pfOff: number;
  fdShoot: number;
  fdOther: number;
  fdBonus: number;
  oreb: number;
  orebOpp: number;
  dreb: number;
  drebOpp: number;
  and1: number;
  putbacks: number;
  stintSum: number;
  stintN: number;
  spots: Array<Array<[number, number]>>; // par zone, plus récents d'abord
  labels: Array<Map<string, number>>;
  presenceByTeam: Map<number, { w: number; bins: number[]; n: number; starts: number }>;
  rawFga: number; // tirs non pondérés (taille d'échantillon réelle)
}

export interface TeamFeat {
  id: number;
  w: number;
  games: number;
  poss: number;
  sec: number; // temps de jeu (pour rythme)
  pts: number;
  ptsAllowed: number;
  starts: Record<StartType, number>;
  trans: Record<StartType, number>;
  oppStarts: Record<StartType, number>;
  oppTrans: Record<StartType, number>;
  durSum: number;
  durN: number;
  oppDurSum: number;
  oppDurN: number;
  oppFga: ZoneArr;
  oppFgm: ZoneArr;
  oppExpFgm: ZoneArr; // attendu selon les tireurs (pour le résidu défensif de schéma)
  nonShootFouls: number;
  defPoss: number;
  shootFoulsDrawnNoMake: number;
  liveTov: number;
  tovForced: number;
  timeouts: number;
  sched: Array<{ opp: number; w: number; date: string; venue: number }>; // calendrier (adversaires, salles)
  homeMarginSum: number;
}

export interface LeagueFeat {
  zoneFga: ZoneArr;
  zoneFgm: ZoneArr;
  zoneAstd: ZoneArr;
  groupZoneFga: Record<string, ZoneArr>;
  groupZoneFgm: Record<string, ZoneArr>;
  orebByZone: ZoneArr; // taux de rebond offensif par zone du tir manqué
  orebFt: number;
  transByStart: Record<StartType, number>;
  hcDur: number;
  possPerGame: number;
  nonShootFoulRate: number;
  ft: number;
  homeMargin: number;
  games: number;
  pts: number;
  presenceTemplate: number[][]; // [rang de minutes 0..12][minute 0..47] probabilité d'être sur le terrain
  stintMean: number;
  and1PerMake: ZoneArr;
  distFg: number[]; // adresse de la ligue par distance (pied par pied, 0 à 40), lissée
}

export interface FeatureSet {
  asOf: string;
  players: Map<number, PlayerFeat>;
  teams: Map<number, TeamFeat>;
  league: LeagueFeat;
  astPairs: Map<number, Map<number, number>>; // passeur -> marqueur -> passes décisives (pondérées)
  gamesUsed: number;
  lastGameDate: string;
}

const parsedCache = new Map<string, { g: GameRecord; pg: ParsedGame }>();

/** Matchs officiels uniquement : saison régulière (002), playoffs (004), play-in (005), finale NBA Cup (006). Pas de pré-saison. */
export function isCompetitiveGame(gameId: string): boolean {
  return ['002', '004', '005', '006'].includes(gameId.slice(0, 3));
}

export function loadGames(): Array<{ g: GameRecord; pg: ParsedGame }> {
  const ids = readdirSync(join(CACHE_DIR, 'games')).map((f) => f.replace('.json.gz', '')).filter(isCompetitiveGame).sort();
  const out: Array<{ g: GameRecord; pg: ParsedGame }> = [];
  for (const id of ids) {
    let r = parsedCache.get(id);
    if (!r) {
      const g = readCache<GameRecord>('games', id);
      if (!g) continue;
      r = { g, pg: parseGame(g) };
      parsedCache.set(id, r);
    }
    out.push(r);
  }
  out.sort((a, b) => (a.g.date === b.g.date ? a.g.gameId.localeCompare(b.g.gameId) : a.g.date.localeCompare(b.g.date)));
  return out;
}

function emptyPlayer(id: number): PlayerFeat {
  return {
    id, lastTeam: 0, games: [], w: 0, sec: 0, offPoss: 0, defPoss: 0, fga: zArr(), fgm: zArr(), astdM: zArr(), fta: 0, ftm: 0,
    tov: 0, tovLive: 0, stl: 0, blk: zArr(), oppFgaOn: zArr(), pfShoot: 0, pfOther: 0, pfOff: 0, fdShoot: 0, fdOther: 0, fdBonus: 0, oreb: 0, orebOpp: 0,
    dreb: 0, drebOpp: 0, and1: 0, putbacks: 0, stintSum: 0, stintN: 0, spots: ZONES.map(() => []), labels: ZONES.map(() => new Map()),
    presenceByTeam: new Map(), rawFga: 0,
  };
}
function emptyStarts(): Record<StartType, number> {
  return { made: 0, dreb: 0, steal: 0, deadTO: 0, start: 0 };
}
function emptyTeam(id: number): TeamFeat {
  return {
    id, w: 0, games: 0, poss: 0, sec: 0, pts: 0, ptsAllowed: 0, starts: emptyStarts(), trans: emptyStarts(), oppStarts: emptyStarts(),
    oppTrans: emptyStarts(), durSum: 0, durN: 0, oppDurSum: 0, oppDurN: 0, oppFga: zArr(), oppFgm: zArr(), oppExpFgm: zArr(),
    nonShootFouls: 0, defPoss: 0, shootFoulsDrawnNoMake: 0, liveTov: 0, tovForced: 0, timeouts: 0, homeMarginSum: 0, sched: [],
  };
}

/**
 * Construit les features à partir de tous les matchs strictement antérieurs à `asOf` (YYYY-MM-DD).
 */
const featMemo = new Map<string, FeatureSet>();
export function buildFeaturesCached(asOf: string, groupOf: (pid: number) => string): FeatureSet {
  let f = featMemo.get(asOf);
  if (!f) {
    if (featMemo.size > 6) featMemo.clear();
    featMemo.set(asOf, (f = buildFeatures(asOf, groupOf)));
  }
  return f;
}

export function buildFeatures(asOf: string, groupOf: (pid: number) => string): FeatureSet {
  const all = loadGames().filter((x) => x.g.date < asOf);
  const players = new Map<number, PlayerFeat>();
  const teams = new Map<number, TeamFeat>();
  const astPairs = new Map<number, Map<number, number>>();
  const curSeason = all.length ? seasonOfGameId(all[all.length - 1].g.gameId) : '';

  // 1) Index des matchs joués par joueur / par équipe, pour calculer les poids de récence.
  const playerGameIdx = new Map<number, string[]>();
  const teamGameIdx = new Map<number, string[]>();
  for (const { g } of all) {
    for (const t of [g.home, g.away]) {
      const tl = teamGameIdx.get(t.id) ?? [];
      tl.push(g.gameId);
      teamGameIdx.set(t.id, tl);
      for (const p of t.players) {
        if (p.sec <= 0) continue;
        const l = playerGameIdx.get(p.id) ?? [];
        l.push(g.gameId);
        playerGameIdx.set(p.id, l);
      }
    }
  }
  // Poids de récence : décroissance « forme » sur la saison en cours ; la saison précédente est lissée
  // (l'intersaison casse la notion de forme) et ses playoffs légèrement escomptés (défenses d'élite, rotations courtes).
  const weightOf = (list: string[] | undefined, gameId: string): number => {
    if (!list) return 0;
    const i = list.lastIndexOf(gameId);
    if (i < 0) return 0;
    let curAfter = 0;
    let prevAfter = 0;
    for (let k = i + 1; k < list.length; k++) {
      if (seasonOfGameId(list[k]) === curSeason) curAfter++;
      else prevAfter++;
    }
    const gs = seasonOfGameId(gameId);
    const R = RECENCY;
    if (gs === curSeason) return R.decay ** curAfter;
    const po = gameId.startsWith('004') ? PLAYOFF_DISCOUNT : 1;
    const back = Math.max(1, seasonsBetween(gs, curSeason));
    return R.prevDiscount ** back * (R.decay * R.prevFade) ** curAfter * R.prevDecay ** prevAfter * po;
  };

  // Ligue (non pondéré : saison précédente + saison en cours).
  const L = {
    zoneFga: zArr(), zoneFgm: zArr(), zoneAstd: zArr(), groupZoneFga: {} as Record<string, ZoneArr>, groupZoneFgm: {} as Record<string, ZoneArr>,
    orebN: zArr(), orebOff: zArr(), ftN: 0, ftOff: 0, starts: emptyStarts(), trans: emptyStarts(), durSum: 0, durN: 0, poss: 0,
    nonShoot: 0, defPoss: 0, fta: 0, ftm: 0, homeMargin: 0, games: 0, pts: 0, stintSum: 0, stintN: 0, and1: zArr(),
    presence: Array.from({ length: 13 }, () => new Array(48).fill(0)), presenceN: new Array(13).fill(0),
    distFga: new Array(41).fill(0), distFgm: new Array(41).fill(0),
  };
  for (const g of ['G', 'W', 'B']) {
    L.groupZoneFga[g] = zArr();
    L.groupZoneFgm[g] = zArr();
  }

  const Lsink = structuredClone(L);
  for (const { g, pg } of all) {
    const leagueScope = seasonsBetween(seasonOfGameId(g.gameId), curSeason) <= 1;
    const LX = leagueScope ? L : Lsink; // agrégats de ligue : deux dernières saisons seulement
    if (leagueScope) LX.games++;
    if (leagueScope) {
      LX.homeMargin += g.home.score - g.away.score;
      LX.pts += g.home.score + g.away.score;
    }
    const season = seasonOfGameId(g.gameId);

    // Box scores : lignes de match par joueur.
    for (const [t, o, isHome] of [[g.home, g.away, true], [g.away, g.home, false]] as const) {
      // Gabarit de présence par rang de minutes (pour joueurs sans historique dans leur équipe).
      const ranked = t.players.filter((p) => p.sec > 0).sort((a, b) => b.sec - a.sec);
      ranked.forEach((p, rank) => {
        if (rank >= 13) return;
        const pgp = pg.players.get(p.id);
        if (!pgp) return;
        for (let m = 0; m < 48; m++) LX.presence[rank][m] += pgp.presence[m] / 60;
        LX.presenceN[rank]++;
      });
      for (const p of t.players) {
        // 0 minute : conservé seulement si c'est un choix du coach (aucun motif ou DNP_COACH).
        // Les « ACTIVE » avec DND_INJURY / DNP_INJURY / NWT_* / DND_REST sont des absences, pas des choix.
        if (p.sec <= 0 && !(p.status === 'ACTIVE' && (!p.reason || p.reason.includes('COACH')))) continue;
        let f = players.get(p.id);
        if (!f) players.set(p.id, (f = emptyPlayer(p.id)));
        f.lastTeam = t.id;
        const s = p.stats;
        f.games.push({
          gameId: g.gameId, date: g.date, season, tm: t.id, opp: o.id, home: isHome, starter: p.starter, sec: p.sec,
          pts: s.points ?? 0, reb: s.reboundsTotal ?? 0, ast: s.assists ?? 0, fg3m: s.threePointersMade ?? 0,
          stl: s.steals ?? 0, blk: s.blocks ?? 0, tov: s.turnovers ?? 0, fga: s.fieldGoalsAttempted ?? 0,
          fta: s.freeThrowsAttempted ?? 0, pf: s.foulsPersonal ?? 0,
        });
      }
    }

    // Joueurs : comptes issus du PBP.
    for (const r of pg.players.values()) {
      if (r.sec <= 0) continue;
      const f = players.get(r.pid);
      if (!f) continue;
      const w = weightOf(playerGameIdx.get(r.pid), g.gameId);
      f.w += w;
      f.sec += w * r.sec;
      f.offPoss += w * r.offPoss;
      f.defPoss += w * r.defPoss;
      f.fta += w * r.fta;
      f.ftm += w * r.ftm;
      f.tov += w * r.tov;
      f.tovLive += w * r.tovLive;
      f.stl += w * r.stl;
      f.pfShoot += w * r.pfShoot;
      f.pfOther += w * r.pfOther;
      f.pfOff += w * r.pfOff;
      f.fdShoot += w * r.fdShoot;
      f.fdOther += w * r.fdOther;
      f.fdBonus += w * r.fdBonus;
      f.oreb += w * r.oreb;
      f.orebOpp += w * r.orebOpp;
      f.dreb += w * r.dreb;
      f.drebOpp += w * r.drebOpp;
      for (const z of ZONES) f.oppFgaOn[zi(z)] += w * r.oppFgaOn[z];
      for (const s of r.stints) {
        if (s >= 30) {
          f.stintSum += w * s;
          f.stintN += w;
          LX.stintSum += s;
          LX.stintN++;
        }
      }
      let pr = f.presenceByTeam.get(r.tm);
      if (!pr) f.presenceByTeam.set(r.tm, (pr = { w: 0, bins: new Array(48).fill(0), n: 0, starts: 0 }));
      pr.w += w;
      pr.n++;
      if (r.starter) pr.starts += w;
      for (let m = 0; m < 48; m++) pr.bins[m] += (w * r.presence[m]) / 60;
      LX.fta += r.fta;
      LX.ftm += r.ftm;
    }

    // Tirs.
    for (const s of pg.shots) {
      const f = players.get(s.pid);
      const z = zi(s.zone);
      LX.zoneFga[z]++;
      LX.zoneFgm[z] += s.made;
      const db = Math.min(40, Math.floor(Math.hypot(s.x, s.y) / 10));
      LX.distFga[db]++;
      LX.distFgm[db] += s.made;
      if (s.made && s.ast) LX.zoneAstd[z]++;
      if (s.and1) LX.and1[z]++;
      const grp = groupOf(s.pid);
      LX.groupZoneFga[grp][z]++;
      LX.groupZoneFgm[grp][z] += s.made;
      if (!f) continue;
      const w = weightOf(playerGameIdx.get(s.pid), g.gameId);
      f.fga[z] += w;
      f.fgm[z] += w * s.made;
      f.rawFga++;
      if (s.made && s.ast) f.astdM[z] += w;
      if (s.and1) f.and1 += w;
      if (s.putback) f.putbacks += w;
      f.spots[z].unshift([s.x, s.y]);
      if (f.spots[z].length > 80) f.spots[z].pop();
      const lab = shotLabel(s.sub, s.ds);
      f.labels[z].set(lab, (f.labels[z].get(lab) ?? 0) + w);
      if (s.blk) {
        const b = players.get(s.blk);
        if (b) b.blk[z] += weightOf(playerGameIdx.get(s.blk), g.gameId);
      }
      if (s.made && s.ast) {
        const m = astPairs.get(s.ast) ?? new Map<number, number>();
        m.set(s.pid, (m.get(s.pid) ?? 0) + weightOf(playerGameIdx.get(s.ast), g.gameId));
        astPairs.set(s.ast, m);
      }
    }
    for (const rb of pg.rebByZone) {
      if (rb.zone === 'FT') continue;
      LX.orebN[zi(rb.zone)]++;
      if (rb.off) LX.orebOff[zi(rb.zone)]++;
    }
    LX.ftN += pg.ftMissOreb.n;
    LX.ftOff += pg.ftMissOreb.off;

    // Équipes.
    const gameSec = 2880 + Math.max(0, Math.max(...g.home.periods.map((_, i) => i + 1)) - 4) * 300;
    for (const tg of pg.teams.values()) {
      const opp = tg.tm === g.home.id ? g.away.id : g.home.id;
      const og = pg.teams.get(opp)!;
      let T = teams.get(tg.tm);
      if (!T) teams.set(tg.tm, (T = emptyTeam(tg.tm)));
      const w = weightOf(teamGameIdx.get(tg.tm), g.gameId);
      T.w += w;
      T.games++;
      T.sched.push({ opp, w, date: g.date, venue: g.home.id });
      T.poss += w * tg.poss;
      T.sec += w * gameSec;
      T.pts += w * tg.pts;
      T.ptsAllowed += w * og.pts;
      T.durSum += w * tg.durSum;
      T.durN += w * tg.durN;
      T.oppDurSum += w * og.durSum;
      T.oppDurN += w * og.durN;
      T.nonShootFouls += w * tg.nonShootFouls;
      T.defPoss += w * og.poss;
      T.shootFoulsDrawnNoMake += w * tg.shootFoulsNoMake;
      T.liveTov += w * tg.liveTov;
      T.tovForced += w * (og.liveTov + og.deadTov);
      T.timeouts += w * tg.timeouts;
      if (tg.home) T.homeMarginSum += w * (g.home.score - g.away.score);
      for (const st of START_TYPES) {
        T.starts[st] += w * tg.starts[st];
        T.trans[st] += w * tg.transByStart[st];
        T.oppStarts[st] += w * og.starts[st];
        T.oppTrans[st] += w * og.transByStart[st];
        LX.starts[st] += tg.starts[st];
        LX.trans[st] += tg.transByStart[st];
      }
      LX.durSum += tg.durSum;
      LX.durN += tg.durN;
      LX.poss += tg.poss;
      LX.nonShoot += tg.nonShootFouls;
      LX.defPoss += og.poss;
    }
    for (const s of pg.shots) {
      const defTeam = s.tm === g.home.id ? g.away.id : g.home.id;
      const T = teams.get(defTeam)!;
      const w = weightOf(teamGameIdx.get(defTeam), g.gameId);
      T.oppFga[zi(s.zone)] += w;
      T.oppFgm[zi(s.zone)] += w * s.made;
    }
  }

  // Taux attendus par tireur (pour isoler le résidu défensif de schéma de chaque équipe).
  const leagueFg = L.zoneFga.map((n, i) => (n ? L.zoneFgm[i] / n : 0)) as ZoneArr;
  const shooterFg = new Map<number, ZoneArr>();
  for (const f of players.values()) {
    shooterFg.set(f.id, f.fga.map((n, i) => (f.fgm[i] + 25 * leagueFg[i]) / (n + 25)) as ZoneArr);
  }
  for (const { g, pg } of all) {
    for (const s of pg.shots) {
      const defTeam = s.tm === g.home.id ? g.away.id : g.home.id;
      const T = teams.get(defTeam)!;
      const w = weightOf(teamGameIdx.get(defTeam), g.gameId);
      T.oppExpFgm[zi(s.zone)] += w * (shooterFg.get(s.pid)?.[zi(s.zone)] ?? leagueFg[zi(s.zone)]);
    }
  }

  const league: LeagueFeat = {
    zoneFga: L.zoneFga, zoneFgm: L.zoneFgm, zoneAstd: L.zoneAstd, groupZoneFga: L.groupZoneFga, groupZoneFgm: L.groupZoneFgm,
    orebByZone: L.orebN.map((n, i) => (n ? L.orebOff[i] / n : 0.25)) as ZoneArr,
    orebFt: L.ftN ? L.ftOff / L.ftN : 0.13,
    transByStart: Object.fromEntries(START_TYPES.map((s) => [s, L.starts[s] ? L.trans[s] / L.starts[s] : 0])) as Record<StartType, number>,
    hcDur: L.durN ? L.durSum / L.durN : 13,
    possPerGame: L.games ? L.poss / L.games / 2 : 99,
    nonShootFoulRate: L.defPoss ? L.nonShoot / L.defPoss : 0.08,
    ft: L.fta ? L.ftm / L.fta : 0.78,
    homeMargin: L.games ? L.homeMargin / L.games : 2,
    games: L.games,
    pts: L.games ? L.pts / L.games / 2 : 114,
    presenceTemplate: L.presence.map((row, r) => row.map((v) => (L.presenceN[r] ? v / L.presenceN[r] : 0))),
    stintMean: L.stintN ? L.stintSum / L.stintN : 360,
    and1PerMake: L.and1.map((n, i) => (L.zoneFgm[i] ? n / L.zoneFgm[i] : 0)) as ZoneArr,
    distFg: smoothDist(L.distFga, L.distFgm),
  };

  return {
    asOf, players, teams, league, astPairs, gamesUsed: all.length, lastGameDate: all.length ? all[all.length - 1].g.date : '',
  };
}

/** Tirage du libellé de tir le plus fréquent pour un joueur / zone (utile pour le texte du play-by-play simulé). */
export function topLabels(m: Map<string, number>, k = 6): Array<[string, number]> {
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  const tot = arr.reduce((s, [, v]) => s + v, 0) || 1;
  return arr.map(([l, v]) => [l, v / tot]);
}

/** Adresse par distance : fenêtre de ±1 pied, rétrécie vers la moyenne générale quand les tentatives sont rares. */
function smoothDist(fga: number[], fgm: number[]): number[] {
  const all = fgm.reduce((a, v) => a + v, 0) / Math.max(1, fga.reduce((a, v) => a + v, 0));
  return fga.map((_, d) => {
    let n = 0, m = 0;
    for (let k = Math.max(0, d - 1); k <= Math.min(40, d + 1); k++) {
      n += fga[k];
      m += fgm[k];
    }
    return (m + 30 * all) / (n + 30);
  });
}
