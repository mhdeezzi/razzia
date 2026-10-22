// Points attendus par tir et occasions par match. Un tir vaut l'adresse de la ligue à cet emplacement (zone, distance)
// pour ce type de tir (dunk, lay-up en coupe, tir après dribble, flotteur...), quel que soit le tireur et qu'il rentre ou non.
// Séparer les occasions créées (volume et qualité des tirs, pertes, rebonds offensifs, lancers) de la réussite, qui à
// l'échelle d'une équipe et de quelques matchs relève surtout de la chance.
import type { GameRecord } from '../../data/cdn.ts';
import type { ParsedGame, ShotRec } from './pbp.ts';
import { ZONES, isThree, type Zone } from './zones.ts';
import { seasonOfGameId, seasonsBetween } from '../seasons.ts';

export type ShotCat = 'dunk' | 'cut' | 'run' | 'drive' | 'putback' | 'float' | 'hook' | 'catch' | 'self';

/** Type de tir à partir du libellé officiel : le descripteur dit comment le tir a été créé (et souvent sa difficulté). */
export function shotCat(s: Pick<ShotRec, 'sub' | 'ds' | 'putback'>): ShotCat {
  const sub = (s.sub ?? '').toLowerCase();
  const ds = (s.ds ?? '').toLowerCase();
  if (s.putback || ds.includes('tip') || ds.includes('putback')) return 'putback';
  if (sub === 'dunk') return 'dunk';
  if (sub === 'hook') return 'hook';
  if (ds.includes('floating')) return 'float';
  if (sub === 'layup') return ds.includes('cutting') || ds.includes('alley') ? 'cut' : ds.includes('running') || ds.includes('finger') ? 'run' : 'drive';
  return ds === '' || ds === 'bank' ? 'catch' : 'self';
}

const distBin = (s: Pick<ShotRec, 'x' | 'y'>): number => Math.min(30, Math.floor(Math.hypot(s.x, s.y) / 10));

export interface XModel {
  p: Map<string, number>; // adresse attendue par cellule zone|distance|type|contre-attaque (rétrécie vers le parent)
  zone: number[]; // adresse moyenne par zone
  shooter: Map<number, number[]>; // adresse des tireurs par zone (écart logit à la ligue, rétréci) sur la même période
}
const logit = (p: number): number => Math.log(Math.max(1e-6, p) / Math.max(1e-6, 1 - p));
const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
const SHOOTER_K = 150; // tirs avant de croire l'adresse observée d'un tireur dans une zone

/** Ajuste le modèle sur une liste de tirs : comptes par cellule, rétrécis hiérarchiquement (type -> distance -> zone). */
export function fitXModel(shots: Iterable<ShotRec>, k = 40): XModel {
  const n = new Map<string, [number, number]>();
  const add = (key: string, made: number) => {
    const e = n.get(key) ?? [0, 0];
    e[0]++;
    e[1] += made;
    n.set(key, e);
  };
  for (const s of shots) {
    const z = s.zone;
    const d = distBin(s);
    add(z, s.made);
    add(`${z}|${d}`, s.made);
    add(`${z}|${d}|${shotCat(s)}|${s.fb ? 1 : 0}`, s.made);
  }
  const zone = ZONES.map((z) => {
    const e = n.get(z);
    return e && e[0] ? e[1] / e[0] : 0.4;
  });
  const byShooter = new Map<number, { n: number[]; m: number[] }>();
  for (const s of shots) {
    const e = byShooter.get(s.pid) ?? { n: [0, 0, 0, 0, 0, 0], m: [0, 0, 0, 0, 0, 0] };
    const z = ZONES.indexOf(s.zone);
    e.n[z]++;
    e.m[z] += s.made;
    byShooter.set(s.pid, e);
  }
  const shooter = new Map<number, number[]>();
  for (const [pid, e] of byShooter) shooter.set(pid, e.n.map((cnt, z) => logit((e.m[z] + SHOOTER_K * zone[z]) / (cnt + SHOOTER_K)) - logit(zone[z])));
  const p = new Map<string, number>();
  for (const [key, [cnt, made]] of n) {
    const parts = key.split('|');
    if (parts.length === 2) {
      const prior = zone[ZONES.indexOf(parts[0] as Zone)];
      p.set(key, (made + k * prior) / (cnt + k));
    }
  }
  for (const [key, [cnt, made]] of n) {
    const parts = key.split('|');
    if (parts.length === 4) {
      const prior = p.get(`${parts[0]}|${parts[1]}`) ?? zone[ZONES.indexOf(parts[0] as Zone)];
      p.set(key, (made + k * prior) / (cnt + k));
    }
  }
  return { p, zone, shooter };
}

export function xFg(m: XModel, s: ShotRec): number {
  const z = s.zone;
  const d = distBin(s);
  return m.p.get(`${z}|${d}|${shotCat(s)}|${s.fb ? 1 : 0}`) ?? m.p.get(`${z}|${d}`) ?? m.zone[ZONES.indexOf(z)];
}
/** Adresse attendue compte tenu aussi du tireur (son adresse habituelle dans la zone) : le reste est réussite du soir. */
export function xFgShooter(m: XModel, s: ShotRec): number {
  return logistic(logit(xFg(m, s)) + (m.shooter.get(s.pid)?.[ZONES.indexOf(s.zone)] ?? 0));
}
export const shotValue = (s: ShotRec): number => (isThree(s.zone) ? 3 : 2);

/** Occasions d'une équipe sur un match (ses possessions en attaque). */
export interface TeamOcc {
  gameId: string;
  date: string;
  tm: number;
  opp: number;
  home: boolean;
  poss: number;
  pts: number;
  fga: number;
  xShot: number; // points attendus sur ses tirs (emplacement et type de tir)
  xShotAdj: number; // idem, compte tenu de l'adresse habituelle de chaque tireur
  shotPts: number; // points réels sur ses tirs
  fta: number;
  tov: number;
  orb: number;
  orbChances: number; // rebonds offensifs + rebonds défensifs adverses
  trans: number; // possessions en contre-attaque
  zones: number[]; // tirs par zone
  catSelf: number; // tirs créés en dribble (pull-up, step back, fadeaway...)
}

const LEAGUE_FT = 0.78;
/** Points attendus par possession : tirs à leur valeur attendue (tireurs compris) + lancers à l'adresse de la ligue. */
export const xPPP = (o: TeamOcc): number => (o.poss > 0 ? (o.xShotAdj + LEAGUE_FT * o.fta) / o.poss : 0);

// Un modèle par saison, ajusté sur les deux saisons précédentes (aucune donnée de la saison jugée) ; la plus ancienne
// saison disponible est jugée avec son propre modèle, faute de mieux (elle ne sert que de référence lointaine).
const modelBySeason = new Map<string, XModel>();
const occByGame = new Map<string, [TeamOcc, TeamOcc]>();

export function occasionsOf(all: Array<{ g: GameRecord; pg: ParsedGame }>): Map<string, [TeamOcc, TeamOcc]> {
  const seasons = [...new Set(all.map((x) => seasonOfGameId(x.g.gameId)))].sort();
  for (const season of seasons) {
    if (modelBySeason.has(season)) continue;
    const prior = all.filter((x) => {
      const gap = seasonsBetween(seasonOfGameId(x.g.gameId), season);
      return gap >= 1 && gap <= 2;
    });
    const src = prior.length >= 500 ? prior : all.filter((x) => seasonOfGameId(x.g.gameId) === season);
    modelBySeason.set(season, fitXModel(src.flatMap((x) => x.pg.shots)));
  }
  for (const { g, pg } of all) {
    if (occByGame.has(g.gameId)) continue;
    const m = modelBySeason.get(seasonOfGameId(g.gameId))!;
    const side = (tm: number, opp: number, home: boolean): TeamOcc => {
      const T = pg.teams.get(tm)!;
      const o: TeamOcc = {
        gameId: g.gameId, date: g.date, tm, opp, home, poss: T.poss, pts: T.pts, fga: 0, xShot: 0, xShotAdj: 0, shotPts: 0, fta: 0,
        tov: T.liveTov + T.deadTov, orb: 0, orbChances: 0, trans: 0, zones: [0, 0, 0, 0, 0, 0], catSelf: 0,
      };
      for (const s of pg.shots) {
        if (s.tm !== tm) continue;
        o.fga++;
        o.xShot += shotValue(s) * xFg(m, s);
        o.xShotAdj += shotValue(s) * xFgShooter(m, s);
        o.shotPts += s.made * shotValue(s);
        o.zones[ZONES.indexOf(s.zone)]++;
        if (shotCat(s) === 'self') o.catSelf++;
      }
      let oppDreb = 0;
      for (const p of pg.players.values()) {
        if (p.tm === tm) {
          o.fta += p.fta;
          o.orb += p.oreb;
        } else if (p.tm === opp) oppDreb += p.dreb;
      }
      o.orbChances = o.orb + oppDreb;
      o.trans = pg.poss.filter((x) => x.tm === tm && x.trans).length;
      return o;
    };
    occByGame.set(g.gameId, [side(g.home.id, g.away.id, true), side(g.away.id, g.home.id, false)]);
  }
  return occByGame;
}

/** Journal des occasions par équipe (ordre chronologique), créées et concédées. */
export interface OccGame {
  date: string;
  gameId: string;
  opp: number;
  home: boolean;
  margin: number;
  xMargin: number; // écart attendu sur 100 possessions (occasions créées - concédées, tireurs compris)
  for: TeamOcc;
  against: TeamOcc;
}
export function occLogs(all: Array<{ g: GameRecord; pg: ParsedGame }>): Map<number, OccGame[]> {
  const occ = occasionsOf(all);
  const out = new Map<number, OccGame[]>();
  for (const { g } of all) {
    const pair = occ.get(g.gameId);
    if (!pair) continue;
    for (const [a, b] of [pair, [pair[1], pair[0]]] as const) {
      let l = out.get(a.tm);
      if (!l) out.set(a.tm, (l = []));
      l.push({ date: a.date, gameId: a.gameId, opp: a.opp, home: a.home, margin: a.pts - b.pts, xMargin: 100 * (xPPP(a) - xPPP(b)), for: a, against: b });
    }
  }
  return out;
}

/** Profil d'occasions sur une liste de matchs (sommes), pour comparer une période récente à une référence. */
export interface OccProfile {
  n: number;
  xNet: number; // points attendus par 100 possessions, créés - concédés
  tov: number; // pertes par possession
  tovForced: number;
  orb: number; // taux de rebond offensif
  orbAllowed: number;
  trans: number; // part des possessions en contre-attaque
  transAllowed: number;
  fta: number; // lancers par possession
  ftaAllowed: number;
  xFg: number; // points attendus par tir (qualité des tirs)
  xFgAllowed: number;
  make: number; // points réels - attendus par tir, tireurs compris (réussite du soir, ou tirs plus contestés)
  makeAllowed: number;
}
export function occProfile(games: OccGame[]): OccProfile | undefined {
  if (!games.length) return undefined;
  const s = (f: (g: OccGame) => number) => games.reduce((a, g) => a + f(g), 0);
  const pf = s((g) => g.for.poss) || 1;
  const pa = s((g) => g.against.poss) || 1;
  const fgaF = s((g) => g.for.fga) || 1;
  const fgaA = s((g) => g.against.fga) || 1;
  return {
    n: games.length,
    xNet: s((g) => g.xMargin) / games.length,
    tov: s((g) => g.for.tov) / pf,
    tovForced: s((g) => g.against.tov) / pa,
    orb: s((g) => g.for.orb) / (s((g) => g.for.orbChances) || 1),
    orbAllowed: s((g) => g.against.orb) / (s((g) => g.against.orbChances) || 1),
    trans: s((g) => g.for.trans) / pf,
    transAllowed: s((g) => g.against.trans) / pa,
    fta: s((g) => g.for.fta) / pf,
    ftaAllowed: s((g) => g.against.fta) / pa,
    xFg: s((g) => g.for.xShot) / fgaF,
    xFgAllowed: s((g) => g.against.xShot) / fgaA,
    make: (s((g) => g.for.shotPts) - s((g) => g.for.xShotAdj)) / fgaF,
    makeAllowed: (s((g) => g.against.shotPts) - s((g) => g.against.xShotAdj)) / fgaA,
  };
}
