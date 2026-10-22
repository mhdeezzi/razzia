// Construction du modèle de match : fusion PBP (forme récente) + Synergy + tracking + matchups + blessures + marché.
import { buildFeaturesCached, topLabels, zi, type FeatureSet, type GameLine, type PlayerFeat, type TeamFeat, type ZoneArr } from './features.ts';
import { loadTablesCached, heightToIn, groupOfPos, type Tables, type SynAgg, type ContestAgg } from './tables.ts';
import { PT_LIST, HALF_COURT_PT, type Contest, type GameModel, type PlayerModel, type TeamModel, type TeamMomentum, type TeamH2H, type PT, type PTEff, type Z6, type LeagueModel, type SimParams } from './types.ts';
import { START_TYPES, type StartType } from './pbp.ts';
import { ZONES, isThree } from './zones.ts';
import { teamById, teamByTri, type TeamInfo } from '../teams.ts';
import { seasonOfDate, seasonsInScope } from '../seasons.ts';
import { getInjuries, getMarket, getProps, noVig, type InjuryItem } from '../../data/espn.ts';
import { playerPasses, SEASON_TYPES, dailyLineups } from '../../data/nbaStats.ts';
import { pool } from '../../data/http.ts';
import type { GameRecord } from '../../data/cdn.ts';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, readCache } from '../../data/http.ts';
import { seasonOfGameId } from '../seasons.ts';

export interface BuildOpts {
  date: string;
  homeTri: string;
  awayTri: string;
  gameId?: string;
  out?: string[]; // joueurs forcés absents (noms)
  in?: string[]; // joueurs forcés disponibles
  injuries?: boolean; // utiliser le rapport ESPN (défaut : oui pour un match à venir)
  market?: boolean;
  actual?: GameRecord; // match réel (backtest) : statuts INACTIVE utilisés
  passes?: boolean;
  // Contrôle de justesse : sans les tables stats.nba.com de la saison du match (totaux de fin de saison = futur).
  pastTablesOnly?: boolean;
  log?: (...a: unknown[]) => void;
}

// Fuseaux horaires (heure standard) et altitude des salles, pour la fatigue de voyage.
const TZ: Record<string, number> = {
  ATL: -5, BOS: -5, BKN: -5, CHA: -5, CLE: -5, DET: -5, IND: -5, MIA: -5, NYK: -5, ORL: -5, PHI: -5, TOR: -5, WAS: -5,
  CHI: -6, DAL: -6, HOU: -6, MEM: -6, MIL: -6, MIN: -6, NOP: -6, OKC: -6, SAS: -6,
  DEN: -7, UTA: -7, PHX: -7,
  GSW: -8, LAC: -8, LAL: -8, POR: -8, SAC: -8,
};
const ALTITUDE: Record<string, number> = { DEN: 0.5, UTA: 0.3 };

export const DEFAULT_PARAMS: SimParams = {
  homeFgLogit: 0.04,
  homeFoulMult: 1.04,
  durScale: 1,
  sdTeamNight: 0.03,
  sdTeam3Night: 0.05,
  sdPlayerNight: 0.1,
  sdUsage: 0.2,
  sdMinutes: 0.28,
  sdPace: 0.02,
  defWeight: 0.85,
  hunting: 0.5,
  astScale: 1.0,
  techRate: 0.0045,
  teamRebShare: 0.13,
  orebMult: 1.18,
  foulMult: 0.74,
  sfMult: 0.99,
  fgBias: 0.04,
  fg3Bias: -0.045,
  threeMult: 0.926,
  teamBias: [0, 0],
  uncWeight: 1,
  // Contrôle sans fuite sur 2 x 200 matchs avec les tables de tirs contestés : momentum, confrontations récentes et
  // fin de saison sans enjeu (combinés) font moins bien que ce réglage (Brier 0,2277 vs 0,2251 et 0,2164 vs 0,2120).
  momentumWeight: 0,
  momentumEarly: 0,
  h2hWeight: 0,
  coachDef: 1.5,
  noStakesPenalty: 0,
  qualityCut: 4,
  usageGamma: 1.4,
  astGamma: 2.0,
  rebGamma: 1.25,
  rubber: 0.06,
  sdGameNight: 0.03,
  sdWhistle: 0.08,
  distWeight: 1,
  duelWeight: 0.5,
  fatigueOff: 0.03,
  fatigueDef: 0.015,
  sosWeight: 1,
  contestWeight: 1,
};

const logit = (p: number): number => Math.log(Math.max(1e-6, p) / Math.max(1e-6, 1 - p));
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

// Niveau d'un joueur : Game Score (Hollinger) ramené à 36 minutes. LF réussis et paniers estimés depuis la ligne de match.
const QUALITY_FLOOR = 7; // remplaçant type de fin de banc
const QUALITY_K = 150; // minutes (pondérées) avant de croire le niveau observé
const RETURN_MIN = 0.85; // premier match après une absence : minutes limitées
function gameScore(x: GameLine): number {
  const ftm = 0.78 * x.fta;
  const fgm = Math.max(0, (x.pts - x.fg3m - ftm) / 2);
  return x.pts + 0.4 * fgm - 0.7 * x.fga - 0.4 * (x.fta - ftm) + 0.4 * x.reb + x.stl + 0.7 * x.ast + 0.7 * x.blk - 0.4 * x.pf - x.tov;
}
const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
const norm6 = (a: number[]): Z6 => {
  const s = sum(a) || 1;
  return a.map((v) => v / s) as Z6;
};

export function normName(n: string): string {
  return n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`-]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STATUS_AVAIL: Record<string, number> = {
  out: 0, 'out for season': 0, suspended: 0, doubtful: 0.15, questionable: 0.5, 'day-to-day': 0.65, probable: 0.9, available: 1, active: 1,
};

// Probabilité qu'un panier réussi soit assisté selon le type de jeu (avant ajustement par profil du joueur).
export const PT_AST_PRIOR: Record<PT, number> = {
  Transition: 0.5, Isolation: 0.04, PRBallHandler: 0.06, PRRollman: 0.9, Postup: 0.22, Spotup: 0.9, Handoff: 0.72, Cut: 0.88,
  OffScreen: 0.88, OffRebound: 0.03, Misc: 0.45,
};

interface Ctx {
  feats: FeatureSet;
  tables: Tables;
  league: LeagueModel;
  Q: Record<PT, Z6>; // distribution de zone de ligue par type de jeu (estimée)
  groupPtRate: Record<string, Record<PT, number>>;
  groupZone: Record<string, Z6>;
  groupFg: Record<string, Z6>;
  groupReb: Record<string, { orb: number; drb: number }>;
  groupDef: Record<string, { stl: number; pfShoot: number; pfOther: number; blk: Z6 }>;
  synLeagueEff: Record<PT, { tov: number; sfMiss: number; and1PerMake: number; fg: number }>;
  heights: Map<number, number>;
  usgOf: Map<number, number>;
  groupOf: (pid: number) => 'G' | 'W' | 'B';
  defD: Map<number, { rim: number; mid: number; three: number; overall: number }>; // impacts défensifs rétrécis et centrés
  defPrior: Record<string, { rim: number; mid: number; three: number; overall: number }>;
  foulPrior: Record<string, { other: number; bonus: number; shootMiss: number }>;
  groupUsg: Record<string, number>;
  mByOff: Map<number, Array<{ def: number; w: number }>>;
  mByDef: Map<number, Array<{ off: number; w: number }>>;
}

/** Parts par niveau de contestation (rétrécies vers la répartition de la ligue quand l'échantillon est petit). */
function shares(a: ContestAgg | undefined, prior?: { s2: number[]; s3: number[] }, k = 0): { s2: number[]; s3: number[] } | undefined {
  if (!a) return prior;
  const n2 = sum(a.fg2a), n3 = sum(a.fg3a);
  if (!prior && (n2 <= 0 || n3 <= 0)) return undefined;
  const sh = (x: number[], n: number, p?: number[]) => x.map((v, c) => (v + k * (p?.[c] ?? 0.25)) / (n + k || 1));
  return { s2: sh(a.fg2a, n2, prior?.s2), s3: sh(a.fg3a, n3, prior?.s3) };
}

/** Profil de contestation d'un joueur : parts et adresse par niveau, rétrécies vers la ligue (pente ligue × son adresse). */
function contestOf(a: ContestAgg | undefined, L: ContestAgg): Contest | undefined {
  const lg = shares(L);
  if (!a || !lg) return undefined;
  const s = shares(a, lg, 30)!;
  const fg = (m: number[], n: number[], lm: number[], ln: number[]) => {
    const pAll = (sum(m) + 20 * (sum(lm) / Math.max(1, sum(ln)))) / (sum(n) + 20);
    const lAll = sum(lm) / Math.max(1, sum(ln));
    return n.map((att, c) => {
      const prior = clamp(pAll * ((ln[c] ? lm[c] / ln[c] : lAll) / Math.max(1e-6, lAll)), 0.05, 0.95);
      return (m[c] + 40 * prior) / (att + 40);
    });
  };
  return { ...s, f2: fg(a.fg2m, a.fg2a, L.fg2m, L.fg2a), f3: fg(a.fg3m, a.fg3a, L.fg3m, L.fg3a) };
}

function leagueModel(f: FeatureSet, t: Tables): LeagueModel {
  const L = f.league;
  const zoneFg = L.zoneFga.map((n, i) => (n ? L.zoneFgm[i] / n : 0.4)) as Z6;
  const zoneFreq = norm6(L.zoneFga);
  const totPoss = sum(PT_LIST.map((p) => t.synLeague[p].poss)) || 1;
  return {
    zoneFg, zoneFreq,
    zoneAstd: L.zoneAstd.map((n, i) => (L.zoneFgm[i] ? n / L.zoneFgm[i] : 0.5)) as Z6,
    orebByZone: L.orebByZone as Z6,
    orebFt: L.orebFt,
    transByStart: L.transByStart,
    hcDur: L.hcDur,
    pace: L.possPerGame,
    ptFreq: Object.fromEntries(PT_LIST.map((p) => [p, t.synLeague[p].poss / totPoss])) as Record<PT, number>,
    nonShootFoulRate: L.nonShootFoulRate,
    ft: L.ft,
    homeMargin: L.homeMargin,
    ppg: L.pts,
    rankMinutes: L.presenceTemplate.map((row) => sum(row)),
    distFg: L.distFg,
    contest: shares(t.contestL),
  };
}

/** Estime la distribution de zone de chaque type de jeu (mélange non négatif sur l'ensemble des joueurs). */
function fitPlayTypeZones(f: FeatureSet, t: Tables, league: LeagueModel): Record<PT, Z6> {
  // Priors : connaissances terrain, affinés ensuite par les données.
  const prior: Record<PT, number[]> = {
    Transition: [2.2, 0.8, 0.4, 1.3, 1.3, 1.0], Isolation: [0.9, 1.3, 1.9, 0.2, 0.2, 1.0], PRBallHandler: [0.9, 1.4, 1.3, 0.15, 0.15, 1.2],
    PRRollman: [2.6, 1.3, 0.5, 0.3, 0.3, 0.7], Postup: [1.2, 2.4, 1.3, 0.05, 0.05, 0.1], Spotup: [0.4, 0.6, 0.8, 2.3, 2.3, 1.6],
    Handoff: [0.8, 1.0, 1.1, 0.7, 0.7, 1.5], Cut: [3.6, 1.0, 0.15, 0.05, 0.05, 0.05], OffScreen: [0.4, 0.7, 1.4, 1.4, 1.4, 1.5],
    OffRebound: [4.0, 1.0, 0.1, 0.03, 0.03, 0.05], Misc: [1, 1, 1, 1, 1, 1],
  };
  const Q: Record<PT, number[]> = Object.fromEntries(PT_LIST.map((p) => [p, norm6(prior[p].map((m, i) => m * league.zoneFreq[i]))])) as any;
  const rows: Array<{ pi: number[]; P: number[]; w: number }> = [];
  for (const [pid, syn] of t.synP) {
    const pf = f.players.get(pid);
    if (!pf) continue;
    const tot = sum(pf.fga);
    if (pf.rawFga < 250) continue;
    const fgaPT = PT_LIST.map((p) => syn[p].fga);
    const s = sum(fgaPT);
    if (s < 100) continue;
    rows.push({ pi: fgaPT.map((v) => v / s), P: pf.fga.map((v) => v / tot), w: Math.sqrt(pf.rawFga) });
  }
  // Mises à jour multiplicatives (NMF à facteur π fixé) : Q <- Q ⊙ (πᵀ P / πᵀ π Q).
  for (let it = 0; it < 200; it++) {
    const num = PT_LIST.map(() => new Array(6).fill(0));
    const den = PT_LIST.map(() => new Array(6).fill(0));
    for (const r of rows) {
      const pred = new Array(6).fill(0);
      PT_LIST.forEach((p, k) => {
        for (let z = 0; z < 6; z++) pred[z] += r.pi[k] * Q[p][z];
      });
      PT_LIST.forEach((_, k) => {
        for (let z = 0; z < 6; z++) {
          num[k][z] += r.w * r.pi[k] * r.P[z];
          den[k][z] += r.w * r.pi[k] * pred[z];
        }
      });
    }
    PT_LIST.forEach((p, k) => {
      Q[p] = norm6(Q[p].map((q, z) => (den[k][z] > 0 ? q * (num[k][z] / den[k][z]) : q)));
      // Ancrage léger sur le prior pour les cases mal identifiées.
      const pr = norm6(prior[p].map((m, i) => m * league.zoneFreq[i]));
      Q[p] = norm6(Q[p].map((q, z) => 0.92 * q + 0.08 * pr[z]));
    });
  }
  return Q as Record<PT, Z6>;
}

function synRate(a: SynAgg | undefined): number {
  return a ? a.poss : 0;
}

function makeCtx(f: FeatureSet, t: Tables, groupOf: (pid: number) => 'G' | 'W' | 'B', heights: Map<number, number>): Ctx {
  const league = leagueModel(f, t);
  const Q = fitPlayTypeZones(f, t, league);
  const usgOf = new Map<number, number>();
  for (const [pid, a] of t.adv) usgOf.set(pid, a.usg);

  // Priors par groupe de poste.
  const groupPtRate: Record<string, Record<PT, number>> = {};
  const groupZone: Record<string, Z6> = {};
  const groupFg: Record<string, Z6> = {};
  const groupReb: Record<string, { orb: number; drb: number }> = {};
  const groupDef: Record<string, { stl: number; pfShoot: number; pfOther: number; blk: Z6 }> = {};
  for (const g of ['G', 'W', 'B']) {
    const acc = Object.fromEntries(PT_LIST.map((p) => [p, 0])) as Record<PT, number>;
    let poss = 0;
    for (const [pid, syn] of t.synP) {
      if (groupOf(pid) !== g) continue;
      const a = t.adv.get(pid);
      if (!a || a.poss < 1500) continue;
      poss += a.poss;
      for (const p of PT_LIST) acc[p] += syn[p].poss;
    }
    // Les joueurs sans historique sont des rôles mineurs : usage prior réduit à ~75 % du groupe.
    groupPtRate[g] = Object.fromEntries(PT_LIST.map((p) => [p, poss ? (0.75 * acc[p]) / poss : 0.01])) as Record<PT, number>;
    groupZone[g] = norm6(f.league.groupZoneFga[g]);
    groupFg[g] = f.league.groupZoneFga[g].map((n, i) => (n ? (f.league.groupZoneFgm[g][i] + 50 * league.zoneFg[i]) / (n + 50) : league.zoneFg[i])) as Z6;
    let ob = 0, oo = 0, db = 0, dd = 0, stl = 0, dp = 0, pfs = 0, pfo = 0;
    const blk = [0, 0, 0, 0, 0, 0], opp = [0, 0, 0, 0, 0, 0];
    for (const pf of f.players.values()) {
      if (groupOf(pf.id) !== g || pf.sec < 3000) continue;
      ob += pf.oreb; oo += pf.orebOpp; db += pf.dreb; dd += pf.drebOpp; stl += pf.stl; dp += pf.defPoss; pfs += pf.pfShoot; pfo += pf.pfOther;
      for (let z = 0; z < 6; z++) {
        blk[z] += pf.blk[z];
        opp[z] += pf.oppFgaOn[z];
      }
    }
    groupReb[g] = { orb: oo ? ob / oo : 0.05, drb: dd ? db / dd : 0.15 };
    groupDef[g] = { stl: dp ? stl / dp : 0.013, pfShoot: dp ? pfs / dp : 0.02, pfOther: dp ? pfo / dp : 0.02, blk: blk.map((b, z) => (opp[z] ? b / opp[z] : 0.005)) as Z6 };
  }

  const synLeagueEff = Object.fromEntries(PT_LIST.map((p) => {
    const a = t.synLeague[p];
    return [p, {
      tov: a.poss ? a.tov / a.poss : 0.12,
      sfMiss: a.poss ? Math.max(0, a.sf - a.and1) / a.poss : 0.05,
      and1PerMake: a.fgm ? a.and1 / a.fgm : 0.03,
      fg: a.fga ? a.fgm / a.fga : 0.45,
    }];
  })) as Ctx['synLeagueEff'];

  // Impacts défensifs individuels (tracking "défenseur le plus proche") :
  // rétrécissement vers la moyenne du poste (pas vers 0, sinon biais), puis centrage pondéré sur la ligue.
  const CATS = { rim: ['Less Than 6Ft', 150], mid: ['2 Pointers', 300], three: ['3 Pointers', 700], overall: ['Overall', 300] } as const;
  type DK = keyof typeof CATS;
  const raw = new Map<number, Record<DK, { v: number; n: number }>>();
  for (const [pid, d] of t.def) {
    const r = {} as Record<DK, { v: number; n: number }>;
    for (const k of Object.keys(CATS) as DK[]) {
      const c = d[CATS[k][0]];
      r[k] = c && c.dfga > 0 && c.normal > 0 ? { v: logit(c.dfgm / c.dfga) - logit(c.normal), n: c.dfga } : { v: 0, n: 0 };
    }
    raw.set(pid, r);
  }
  const defPrior: Record<string, Record<DK, number>> = {};
  for (const g of ['G', 'W', 'B']) {
    defPrior[g] = {} as Record<DK, number>;
    for (const k of Object.keys(CATS) as DK[]) {
      let num = 0, den = 0;
      for (const [pid, r] of raw) if (groupOf(pid) === g && r[k].n > 30) { num += r[k].v * r[k].n; den += r[k].n; }
      defPrior[g][k] = den ? num / den : 0;
    }
  }
  const shr = new Map<number, Record<DK, number>>();
  const center = {} as Record<DK, number>;
  for (const k of Object.keys(CATS) as DK[]) {
    let num = 0, den = 0;
    for (const [pid, r] of raw) {
      const g = groupOf(pid);
      const kk = CATS[k][1];
      const v = (r[k].n * r[k].v + kk * defPrior[g][k]) / (r[k].n + kk);
      const rec = shr.get(pid) ?? ({} as Record<DK, number>);
      rec[k] = v;
      shr.set(pid, rec);
      num += v * r[k].n;
      den += r[k].n;
    }
    center[k] = den ? num / den : 0;
  }
  const defD = new Map<number, { rim: number; mid: number; three: number; overall: number }>();
  for (const [pid, r] of shr) defD.set(pid, { rim: clamp(r.rim - center.rim, -0.6, 0.6), mid: clamp(r.mid - center.mid, -0.6, 0.6), three: clamp(r.three - center.three, -0.6, 0.6), overall: clamp(r.overall - center.overall, -0.6, 0.6) });
  for (const g of Object.keys(defPrior)) for (const k of Object.keys(CATS) as DK[]) defPrior[g][k] -= center[k];

  const mByOff = new Map<number, Array<{ def: number; w: number }>>();
  const mByDef = new Map<number, Array<{ off: number; w: number }>>();
  for (const r of t.matchups) {
    const w = r.PARTIAL_POSS * r._w;
    (mByOff.get(r.OFF_PLAYER_ID) ?? mByOff.set(r.OFF_PLAYER_ID, []).get(r.OFF_PLAYER_ID)!).push({ def: r.DEF_PLAYER_ID, w });
    (mByDef.get(r.DEF_PLAYER_ID) ?? mByDef.set(r.DEF_PLAYER_ID, []).get(r.DEF_PLAYER_ID)!).push({ off: r.OFF_PLAYER_ID, w });
  }

  // Priors de fautes provoquées par poste (par possession offensive sur le terrain).
  const foulPrior: Record<string, { other: number; bonus: number; shootMiss: number }> = {};
  for (const g of ['G', 'W', 'B']) {
    let o = 0, b = 0, sm = 0, n = 0;
    for (const pf of f.players.values()) {
      if (groupOf(pf.id) !== g || pf.offPoss < 300) continue;
      o += pf.fdOther; b += pf.fdBonus; sm += Math.max(0, pf.fdShoot - pf.and1); n += pf.offPoss;
    }
    foulPrior[g] = { other: n ? o / n : 0.02, bonus: n ? b / n : 0.007, shootMiss: n ? sm / n : 0.013 };
  }
  const groupUsg: Record<string, number> = {};
  for (const g of ['G', 'W', 'B']) {
    let u = 0, n = 0;
    for (const pf of f.players.values()) {
      if (groupOf(pf.id) !== g || pf.offPoss < 300) continue;
      u += sum(pf.fga) + 0.44 * pf.fta + pf.tov;
      n += pf.offPoss;
    }
    groupUsg[g] = n ? u / n : 0.19;
  }

  return { feats: f, tables: t, league, Q, groupPtRate, groupZone, groupFg, groupReb, groupDef, synLeagueEff, heights, usgOf, groupOf, defD, defPrior, foulPrior, groupUsg, mByOff, mByDef };
}

function shrinkRate(num: number, den: number, prior: number, k: number): number {
  return (num + k * prior) / (den + k);
}

/**
 * Distribution de zone par type de jeu : carte de tir réelle du joueur (P) × inclinaison propre au type de jeu
 * (Q_k / Q̄, estimée sur la ligue), puis léger recalage IPF pour retrouver P sous le mix de jeux du joueur.
 * Un joueur qui ne tire jamais de loin n'aura jamais de 3 pts, quel que soit le type de jeu.
 */
function playerZoneByPT(pi: Record<PT, number>, P: Z6, Q: Record<PT, Z6>, Qbar: Z6): Record<PT, Z6> {
  const tilt = (p: PT) => Q[p].map((q, z) => Math.pow(q / Math.max(1e-6, Qbar[z]), 0.85));
  const T = Object.fromEntries(PT_LIST.map((p) => [p, tilt(p)])) as Record<PT, number[]>;
  const u = [1, 1, 1, 1, 1, 1];
  let zoneBy = {} as Record<PT, Z6>;
  for (let it = 0; it < 25; it++) {
    zoneBy = Object.fromEntries(PT_LIST.map((p) => [p, norm6(P.map((v, z) => v * T[p][z] * u[z]))])) as Record<PT, Z6>;
    const marg = [0, 0, 0, 0, 0, 0];
    for (const p of PT_LIST) for (let z = 0; z < 6; z++) marg[z] += pi[p] * zoneBy[p][z];
    for (let z = 0; z < 6; z++) u[z] *= marg[z] > 1e-9 ? clamp(Math.pow(P[z] / marg[z], 0.5), 0.5, 2) : 1;
  }
  return zoneBy;
}

function buildPlayer(ctx: Ctx, pid: number, info: { name: string; jersey: string; pos: string; heightIn: number; teamId: number }, status: { status: string; avail: number }, curSeason: string): PlayerModel {
  const { feats: f, tables: t, league } = ctx;
  const pf: PlayerFeat | undefined = f.players.get(pid);
  const g = ctx.groupOf(pid);
  const notes: string[] = [];

  // --- Usage par type de jeu ---
  const syn = t.synP.get(pid);
  const adv = t.adv.get(pid);
  const onPoss = adv?.poss ?? 0;
  const K = 400;
  const pt = {} as Record<PT, number>;
  for (const p of PT_LIST) pt[p] = (synRate(syn?.[p]) + K * ctx.groupPtRate[g][p]) / (onPoss + K);
  // Niveau d'usage : play-by-play pondéré par la forme (FGA + 0,44·FTA + pertes, par possession jouée),
  // Synergy ne fournissant que la répartition entre types de jeu.
  if (pf && pf.offPoss > 0) {
    const used = sum(pf.fga) + 0.44 * pf.fta + pf.tov;
    const prior = 0.75 * ctx.groupUsg[g];
    const usgPbp = (used + 250 * prior) / (pf.offPoss + 250);
    const synSum = sum(PT_LIST.map((p) => pt[p]));
    const k = (usgPbp * 1.1) / Math.max(1e-6, synSum);
    for (const p of PT_LIST) pt[p] *= k;
  }
  // Forme récente d'usage (10 derniers matchs vs moyenne pondérée de long terme).
  const games = pf?.games.filter((x) => x.sec > 0) ?? [];
  const usePerMin = (arr: typeof games) => {
    const m = sum(arr.map((x) => x.sec)) / 60;
    return m > 0 ? sum(arr.map((x) => x.fga + 0.44 * x.fta + x.tov)) / m : 0;
  };
  const l10 = games.slice(-10);
  const longRun = games.slice(-60);
  let formMult = 1;
  const curGames = games.filter((x) => x.season === curSeason).length;
  if (curGames >= 4 && l10.length >= 4 && longRun.length >= 15) {
    const r = usePerMin(l10) / Math.max(1e-6, usePerMin(longRun));
    const wgt = l10.length / (l10.length + 8);
    formMult = clamp(Math.exp(0.3 * wgt * Math.log(Math.max(0.3, r))), 0.88, 1.12);
    if (Math.abs(formMult - 1) > 0.04) notes.push(`usage récent ${formMult > 1 ? 'en hausse' : 'en baisse'} (${((formMult - 1) * 100).toFixed(0)} %)`);
  }
  for (const p of PT_LIST) pt[p] *= formMult;
  // Sans historique NBA (rookie) : niveau d'usage selon le rang de draft (les premiers choix ont des rôles offensifs).
  if ((!pf || pf.offPoss < 100) && !syn) {
    const pick = Number(t.index.get(pid)?.DRAFT_NUMBER) || 99;
    const target = (pick <= 3 ? 0.24 : pick <= 10 ? 0.21 : pick <= 20 ? 0.18 : pick <= 30 ? 0.165 : 0.15) * 1.1;
    const cur0 = sum(PT_LIST.map((p) => pt[p]));
    if (cur0 > 0) for (const p of PT_LIST) pt[p] *= target / cur0;
    notes.push(`profil rookie (draft n° ${pick === 99 ? 'non drafté' : pick})`);
  }
  const usg = sum(PT_LIST.map((p) => pt[p]));

  // --- Efficacité par type de jeu ---
  const eff = {} as Record<PT, PTEff>;
  for (const p of PT_LIST) {
    const a = syn?.[p];
    const le = ctx.synLeagueEff[p];
    const n = a?.poss ?? 0;
    eff[p] = {
      tov: shrinkRate(a?.tov ?? 0, n, le.tov, 60),
      sfMiss: shrinkRate(Math.max(0, (a?.sf ?? 0) - (a?.and1 ?? 0)), n, le.sfMiss, 60),
      and1: shrinkRate(a?.and1 ?? 0, a?.fgm ?? 0, le.and1PerMake, 40),
      adj: 0,
      n,
    };
  }

  // --- Zones et adresse (forme récente) ---
  const fga = pf?.fga ?? ([0, 0, 0, 0, 0, 0] as ZoneArr);
  const fgm = pf?.fgm ?? ([0, 0, 0, 0, 0, 0] as ZoneArr);
  const totFga = sum(fga);
  const P = norm6(fga.map((v, z) => v + 8 * ctx.groupZone[g][z]));
  const gfg = ctx.groupFg[g];
  const fg = [0, 0, 0, 0, 0, 0] as Z6;
  fg[0] = (fgm[0] + 40 * gfg[0]) / (fga[0] + 40);
  fg[1] = (fgm[1] + 60 * gfg[1]) / (fga[1] + 60);
  fg[2] = (fgm[2] + 100 * gfg[2]) / (fga[2] + 100);
  const g3 = (gfg[3] * ctx.groupZone[g][3] + gfg[4] * ctx.groupZone[g][4] + gfg[5] * ctx.groupZone[g][5]) / Math.max(1e-6, ctx.groupZone[g][3] + ctx.groupZone[g][4] + ctx.groupZone[g][5]);
  const a3 = fga[3] + fga[4] + fga[5];
  const m3 = fgm[3] + fgm[4] + fgm[5];
  const p3 = (m3 + 250 * g3) / (a3 + 250);
  const lg3 = (league.zoneFg[3] * league.zoneFreq[3] + league.zoneFg[4] * league.zoneFreq[4] + league.zoneFg[5] * league.zoneFreq[5]) / (league.zoneFreq[3] + league.zoneFreq[4] + league.zoneFreq[5]);
  fg[3] = (fgm[3] + 120 * (p3 + (league.zoneFg[3] - lg3))) / (fga[3] + 120);
  fg[4] = (fgm[4] + 120 * (p3 + (league.zoneFg[4] - lg3))) / (fga[4] + 120);
  fg[5] = (fgm[5] + 120 * (p3 + (league.zoneFg[5] - lg3))) / (fga[5] + 120);

  // Mélange de types de jeu des tirs (π), puis distribution de zone par type de jeu calée sur la vraie carte de tir.
  const fgaPT = PT_LIST.map((p) => (syn?.[p]?.fga ?? 0) + 20 * pt[p]);
  const sPT = sum(fgaPT) || 1;
  const pi = Object.fromEntries(PT_LIST.map((p, k) => [p, fgaPT[k] / sPT])) as Record<PT, number>;
  const zone = playerZoneByPT(pi, P, ctx.Q, ctx.league.zoneFreq);

  // Ajustement d'adresse par type de jeu (Synergy FG% vs attendu par les zones), recentré.
  let wsum = 0;
  let asum = 0;
  for (const p of PT_LIST) {
    const a = syn?.[p];
    const exp = sum(zone[p].map((q, z) => q * fg[z]));
    if (!a || a.fga < 5) continue;
    const act = (a.fgm + 60 * exp) / (a.fga + 60);
    eff[p].adj = clamp(logit(act) - logit(exp), -0.5, 0.5);
    wsum += a.fga;
    asum += a.fga * eff[p].adj;
  }
  if (wsum > 0) for (const p of PT_LIST) if (eff[p].adj !== 0) eff[p].adj -= asum / wsum;

  // Assisté : probabilité réelle du joueur par zone, et prior moyen de type de jeu de ses paniers (normalisation).
  const astd = fgm.map((m, z) => clamp(((pf?.astdM[z] ?? 0) + 15 * league.zoneAstd[z]) / (m + 15), 0.02, 0.98)) as Z6;
  const astNorm = fg.map((_, z) => {
    let num = 0, den = 0;
    for (const k of PT_LIST) {
      const w = pt[k] * zone[k][z];
      num += w * PT_AST_PRIOR[k];
      den += w;
    }
    return den > 0 ? num / den : 0.5;
  }) as Z6;

  const ft = ((pf?.ftm ?? 0) + 40 * league.ft) / ((pf?.fta ?? 0) + 40);

  // Rebonds.
  const gr = ctx.groupReb[g];
  const orb = shrinkRate(pf?.oreb ?? 0, pf?.orebOpp ?? 0, gr.orb, 150);
  const drb = shrinkRate(pf?.dreb ?? 0, pf?.drebOpp ?? 0, gr.drb, 150);
  // Putbacks : possessions Synergy "OffRebound" par match rapportées aux rebonds offensifs par match.
  const pbPerGame = adv && adv.gp > 0 ? (syn?.OffRebound.poss ?? 0) / adv.gp : 0;
  const orebPerGame = pf && pf.w > 0 ? pf.oreb / pf.w : 0;
  const putback = clamp((pbPerGame + 2 * 0.35) / (orebPerGame + 2), 0.15, 0.75);

  // Défense (tracking du défenseur le plus proche), rétrécie vers le poste et centrée sur la ligue.
  const d = t.def.get(pid);
  const dd = ctx.defD.get(pid) ?? ctx.defPrior[g];
  const dRim = dd.rim;
  const dMid = dd.mid;
  const d3 = dd.three;
  const dOverall = dd.overall;
  const minutes = adv?.min ?? 0;
  const rimRate = minutes > 50 ? (d?.['Less Than 6Ft']?.dfga ?? 0) / minutes : g === 'B' ? 0.17 : 0.07;
  const threeRate = minutes > 50 ? (d?.['3 Pointers']?.dfga ?? 0) / minutes : g === 'B' ? 0.1 : 0.14;
  const midRate = minutes > 50 ? Math.max(0.01, ((d?.Overall?.dfga ?? 0) - (d?.['Less Than 10Ft']?.dfga ?? 0) - (d?.['3 Pointers']?.dfga ?? 0)) / minutes) : 0.06;
  const gd = ctx.groupDef[g];
  const defPoss = pf?.defPoss ?? 0;
  const stl = shrinkRate(pf?.stl ?? 0, defPoss, gd.stl, 800);
  const blk = (pf?.blk ?? [0, 0, 0, 0, 0, 0]).map((b, z) => shrinkRate(b, pf?.oppFgaOn[z] ?? 0, gd.blk[z], 250)) as Z6;
  const pfShoot = shrinkRate(pf?.pfShoot ?? 0, defPoss, gd.pfShoot, 600);
  const pfOther = shrinkRate(pf?.pfOther ?? 0, defPoss, gd.pfOther, 600);
  const pfOff = shrinkRate(pf?.pfOff ?? 0, pf?.offPoss ?? 0, 0.006, 600);
  const tovLiveShare = shrinkRate(pf?.tovLive ?? 0, pf?.tov ?? 0, 0.55, 30);

  // Profil de défense : taille / usage moyens des attaquants défendus (matchups).
  let hS = 0, uS = 0, wS = 0;
  for (const r of ctx.mByDef.get(pid) ?? []) {
    const h = ctx.heights.get(r.off);
    const u = ctx.usgOf.get(r.off);
    if (h == null || u == null) continue;
    hS += r.w * h; uS += r.w * u; wS += r.w;
  }
  const guardProfile = wS > 200 ? { height: hS / wS, usg: uS / wS } : { height: info.heightIn, usg: 0.19 };
  // Qualité habituelle des défenseurs affrontés (pour que la « chasse au mismatch » soit relative).
  let qS = 0, qW = 0;
  for (const r of ctx.mByOff.get(pid) ?? []) {
    const dq = ctx.defD.get(r.def);
    if (!dq) continue;
    qS += r.w * dq.overall; qW += r.w;
  }
  const typicalDefQ = qW > 100 ? qS / qW : 0;

  // Fautes provoquées (PBP, forme récente).
  const offPoss = pf?.offPoss ?? 0;
  const fp = ctx.foulPrior[g];
  const drawOther = shrinkRate(pf?.fdOther ?? 0, offPoss, fp.other, 600);
  const drawBonus = shrinkRate(pf?.fdBonus ?? 0, offPoss, fp.bonus, 600);
  // Calage des fautes de tir sur tentatives manquées : Synergy (par type de jeu) recalé sur le taux PBP réel du joueur.
  const sfTarget = shrinkRate(Math.max(0, (pf?.fdShoot ?? 0) - (pf?.and1 ?? 0)), offPoss, fp.shootMiss, 500);
  const sfImplied = sum(PT_LIST.map((p) => pt[p] * eff[p].sfMiss)) / 1.08;
  if (sfImplied > 0) {
    const r = clamp(sfTarget / sfImplied, 0.6, 1.8);
    for (const p of PT_LIST) eff[p].sfMiss = clamp(eff[p].sfMiss * r, 0, 0.4);
  }

  // Forme (affichage / rapport).
  const cur = games.filter((x) => x.season === curSeason);
  const avg = (arr: typeof games, k: 'pts' | 'reb' | 'ast' | 'fg3m') => (arr.length ? sum(arr.map((x) => x[k])) / arr.length : 0);
  const avgMin = (arr: typeof games) => (arr.length ? sum(arr.map((x) => x.sec)) / arr.length / 60 : 0);
  const seasonRef = cur.length >= 5 ? cur : games.filter((x) => x.season !== curSeason);
  const form = {
    gp: games.length, gpCur: games.filter((x) => x.season === curSeason && x.tm === info.teamId).length, ptsL10: avg(l10, 'pts'), minL10: avgMin(l10), ptsSeason: avg(seasonRef, 'pts'), minSeason: avgMin(seasonRef),
    rebL10: avg(l10, 'reb'), astL10: avg(l10, 'ast'), fg3mL10: avg(l10, 'fg3m'),
  };

  const astRate = shrinkRate(sum([...(ctx.feats.astPairs.get(pid)?.values() ?? [])]), pf?.offPoss ?? 0, 0.03, 400);

  return {
    id: pid, name: info.name, short: info.name, jersey: info.jersey, pos: info.pos, group: g, heightIn: info.heightIn, teamId: info.teamId,
    status: status.status, avail: status.avail, starter: false, presence: new Array(48).fill(0), expMin: 0, quality: QUALITY_FLOOR,
    stintMean: pf && pf.stintN > 2 ? pf.stintSum / pf.stintN : ctx.feats.league.stintMean,
    usg, pt, eff, zone, fg, ft, astd, astNorm,
    spots: pf?.spots ?? ZONES.map(() => []),
    contest: contestOf(ctx.tables.contestP.get(pid), ctx.tables.contestL),
    spotLogit: (pf?.spots ?? ZONES.map(() => [])).map((sp) => (sp.length ? sum(sp.map(([x, y]) => logit(ctx.feats.league.distFg[Math.min(40, Math.floor(Math.hypot(x, y) / 10))]))) / sp.length : 0)) as Z6,
    labels: pf ? pf.labels.map((m) => topLabels(m)) : ZONES.map(() => []),
    astTo: {}, passTo: {}, astRate, putback, orb, drb,
    dRim, dMid, d3, dOverall, rimRate, midRate, threeRate, stl, blk, pfShoot, pfOther, pfOff, drawOther, drawBonus, typicalDefQ, tovLiveShare, guardProfile,
    form, notes,
  };
}

/**
 * Rang moyen dans la rotation de chaque joueur pendant la pré-saison de son équipe actuelle (saison en cours).
 * La pré-saison ne sert jamais aux statistiques de jeu, seulement à révéler la hiérarchie des nouvelles rotations.
 */
let preseasonRanks: Map<string, { rank: number; n: number }> | null = null;
function preseasonRank(teamId: number, pid: number, season: string): { rank: number; n: number } | undefined {
  if (!preseasonRanks) {
    preseasonRanks = new Map();
    const dir = join(CACHE_DIR, '_preseason');
    const acc = new Map<string, { sum: number; n: number }>();
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        const g = readCache<GameRecord>('_preseason', f.replace('.json.gz', ''));
        if (!g) continue;
        const gs = seasonOfGameId(g.gameId);
        for (const t of [g.home, g.away]) {
          const ranked = t.players.filter((x) => x.sec > 0).sort((a, b) => b.sec - a.sec);
          ranked.forEach((x, r) => {
            const k = `${gs}|${t.id}|${x.id}`;
            const a = acc.get(k) ?? { sum: 0, n: 0 };
            a.sum += r;
            a.n++;
            acc.set(k, a);
          });
        }
      }
    }
    for (const [k, a] of acc) preseasonRanks.set(k, { rank: a.sum / a.n, n: a.n });
  }
  return preseasonRanks.get(`${season}|${teamId}|${pid}`);
}

/** Minutes attendues et courbes de présence par minute. */
function assignMinutes(ctx: Ctx, team: TeamInfo, players: PlayerModel[], curSeason: string, actual?: GameRecord, lineup?: number[], playoffs = false): void {
  const f = ctx.feats;
  const T = f.league.presenceTemplate;
  // Minutes pondérées séparément quand le joueur a commencé le match et quand il est sorti du banc.
  const roleMin = new Map<number, { wS: number; mS: number; wB: number; mB: number }>();
  for (const p of players) {
    const pf = f.players.get(p.id);
    const lines = pf?.games ?? [];
    const withTeam = lines.filter((x) => x.tm === team.id);
    const recentTeam = withTeam.filter((x) => x.season === curSeason);
    const pickLines = recentTeam.length >= 3 ? recentTeam : withTeam.length >= 5 ? withTeam : lines;
    // Minutes d'un match « normal » : on écarte les matchs anormalement courts (sortie sur blessure),
    // la saison en cours révèle le rôle actuel (×3), les playoffs (rotations courtes) comptent moitié.
    // Les blowouts ne sont pas retirés ici : le moteur les simule lui-même via le garbage time.
    let recent = pickLines.slice(-40);
    const lastMins = recent.slice(-20).map((x) => x.sec / 60).sort((a, b) => a - b);
    const med = lastMins.length ? lastMins[Math.floor(lastMins.length / 2)] : 0;
    if (med >= 16) recent = recent.filter((x) => x.sec / 60 >= 0.5 * med);
    let wS = 0, mS = 0, qGs = 0, qMin = 0;
    const rm = { wS: 0, mS: 0, wB: 0, mB: 0 };
    recent.forEach((x, i, arr) => {
      // En playoffs, les rotations se resserrent : les matchs de playoffs de la saison deviennent la référence.
      const po = x.gameId.startsWith('004');
      const poW = playoffs ? (po && x.season === curSeason ? 3 : 0.7) : po ? 0.5 : 1;
      const w = 0.92 ** (arr.length - 1 - i) * (x.season === curSeason ? 3 : 1) * poW;
      wS += w;
      mS += w * (x.sec / 60);
      if (x.starter) (rm.wS += w), (rm.mS += w * (x.sec / 60));
      else (rm.wB += w), (rm.mB += w * (x.sec / 60));
      qGs += w * gameScore(x);
      qMin += w * (x.sec / 60);
    });
    roleMin.set(p.id, rm);
    // Niveau (Game Score / 36 min) rétréci vers un remplaçant type : la hiérarchie qu'un coach respecte.
    p.quality = (36 * qGs + QUALITY_K * QUALITY_FLOOR) / (qMin + QUALITY_K);
    // Momentum du joueur : niveau des 15 derniers matchs contre celui des saisons précédentes.
    const played = lines.filter((x) => x.sec > 0);
    const rec = played.slice(-15);
    const old = played.slice(0, -15).filter((x) => x.season !== curSeason);
    const per36 = (a: GameLine[]) => (36 * sum(a.map(gameScore))) / Math.max(1, sum(a.map((x) => x.sec / 60)));
    if (rec.length >= 8 && sum(old.map((x) => x.sec)) / 60 >= 300) {
      const r = per36(rec);
      const b = per36(old);
      p.momentum = { recent: r, base: b, delta: r - b };
    }
    let exp = wS > 0 ? mS / wS : 0;
    // Début de saison (< 3 matchs cette saison) : la médiane des 50 derniers matchs joués résiste aux périodes
    // de restriction (retour de blessure) et aux sorties prématurées ; on la mélange à la tendance récente.
    const curPlayed = lines.filter((x) => x.season === curSeason && x.sec > 0).length;
    if (curPlayed < 3) {
      const played = lines.filter((x) => x.sec > 0 && !x.gameId.startsWith('004')).slice(-50).map((x) => x.sec / 60).sort((a, b) => a - b);
      if (played.length >= 8) {
        const median = played[Math.floor(played.length / 2)];
        exp = 0.65 * median + 0.35 * exp;
      }
    }
    if (!withTeam.length && lines.length) {
      // Nouvel arrivant (mercato) : un titulaire garde son rôle, un remplaçant doit le confirmer.
      if (exp < 24) exp *= 0.9;
      p.notes.push('nouveau dans l\'équipe (mercato)');
    }
    if (!lines.length) {
      // Rookie / sans historique NBA : rôle estimé selon le rang de draft.
      const pick = Number(ctx.tables.index.get(p.id)?.DRAFT_NUMBER) || 99;
      exp = pick <= 3 ? 28 : pick <= 10 ? 22 : pick <= 20 ? 15 : pick <= 30 ? 10 : 4;
      p.quality = pick <= 3 ? 12 : pick <= 10 ? 10 : pick <= 20 ? 8.5 : QUALITY_FLOOR;
      p.notes.push(`sans historique NBA (draft n° ${pick === 99 ? 'non drafté' : pick})`);
    }
    // Rôle dans la nouvelle rotation (pré-saison) quand il n'y a pas encore 3 matchs officiels avec l'équipe.
    const curWithTeam = withTeam.filter((x) => x.season === curSeason && x.sec > 0).length;
    const pre = preseasonRank(team.id, p.id, curSeason);
    if (curWithTeam < 3 && pre && pre.n >= 2) {
      // Uniquement à la hausse : les cadres sont ménagés en pré-saison, leur rang y est trompeur.
      const tpl = ctx.league.rankMinutes[Math.min(ctx.league.rankMinutes.length - 1, Math.round(pre.rank))] ?? exp;
      if (tpl > exp + 4) {
        exp = 0.5 * exp + 0.5 * tpl;
        p.notes.push(`rôle élargi en pré-saison (rang ${Math.round(pre.rank) + 1})`);
      }
    }
    // Retour après une absence (3 matchs de l'équipe ou plus sans lui) : temps de jeu limité le premier soir.
    // (seulement si son dernier match était avec cette équipe : un transfert n'est pas une absence).
    const lastLine = lines.filter((x) => x.sec > 0).at(-1);
    const lastPlayed = lastLine?.tm === team.id ? lastLine.date : undefined;
    if (lastPlayed && exp >= 15) {
      const missed = (teamLogOf(f).get(team.id) ?? []).filter((g) => g.date > lastPlayed).length;
      if (missed >= 3 && missed < 82) {
        exp *= RETURN_MIN;
        p.notes.push(`retour après ${missed} matchs d'absence (temps de jeu limité)`);
      }
    }
    p.expMin = exp;
    const pres = pf?.presenceByTeam.get(team.id);
    if (pres && pres.w > 3) {
      p.presence = pres.bins.map((b) => clamp(b / pres.w, 0, 1));
      const startShare = pres.starts / pres.w;
      p.starter = startShare >= 0.5;
    } else p.presence = [];
  }
  // Titulaires : dernier match réel (si backtest) sinon dernier match avec l'équipe.
  const avail = players.filter((p) => p.avail > 0.5);
  let starters: number[] = [];
  if (actual) {
    const side = actual.home.id === team.id ? actual.home : actual.away;
    starters = side.players.filter((x) => x.starter).map((x) => x.id);
  } else if (lineup && lineup.length >= 4) {
    // Composition du jour (NBA.com) : un joueur promu titulaire reçoit des minutes de titulaire.
    starters = lineup.filter((id) => players.some((p) => p.id === id));
    for (const p of players) if (starters.includes(p.id)) p.notes.push('titulaire annoncé ce soir');
  } else {
    const last = new Map<number, string>();
    for (const p of players) {
      const l = f.players.get(p.id)?.games.filter((x) => x.tm === team.id && x.season === curSeason && x.starter);
      if (l?.length) last.set(p.id, l[l.length - 1].date);
    }
    const lastDate = [...last.values()].sort().at(-1);
    if (lastDate) starters = [...last.entries()].filter(([, d]) => d === lastDate).map(([id]) => id);
  }
  starters = starters.filter((id) => avail.some((p) => p.id === id));
  // Complète avec la hiérarchie du coach (minutes habituelles et niveau) en respectant les postes.
  const qRef = avail.length ? sum(avail.map((p) => p.quality)) / avail.length : QUALITY_FLOOR;
  const byMin = [...avail].sort((a, b) => b.expMin + (b.quality - qRef) - (a.expMin + (a.quality - qRef)));
  for (const p of byMin) {
    if (starters.length >= 5) break;
    if (starters.includes(p.id)) continue;
    const grp = starters.map((id) => players.find((x) => x.id === id)!.group);
    if (p.group === 'B' && grp.filter((x) => x === 'B').length >= 2) continue;
    if (p.group === 'G' && grp.filter((x) => x === 'G').length >= 3) continue;
    starters.push(p.id);
  }
  for (const p of byMin) {
    if (starters.length >= 5) break;
    if (!starters.includes(p.id)) starters.push(p.id);
  }
  for (const p of players) p.starter = starters.includes(p.id);

  // Minutes selon le rôle du soir (autopsie 2025-26 : un remplaçant promu titulaire recevait ~11 min de moins que
  // la réalité, un titulaire habituel qui sort du banc beaucoup trop). Moyenne du joueur dans ce rôle, rétrécie vers
  // un a priori : minutes de titulaire (~30) pour un promu, trois quarts de ses minutes pour un titulaire relégué.
  const K = 3;
  for (const p of players) {
    const r = roleMin.get(p.id);
    if (!r || p.expMin <= 0) continue;
    const usualStarter = r.wS > r.wB;
    // Écart appliqué aux minutes attendues (qui intègrent déjà mercato, pré-saison, début de saison).
    const base = r.wS + r.wB > 0 ? (r.mS + r.mB) / (r.wS + r.wB) : p.expMin;
    const prior = p.starter ? Math.max(base, 0.35 * base + 0.65 * 30) : usualStarter ? 0.75 * base : base;
    const [w, m] = p.starter ? [r.wS, r.mS] : [r.wB, r.mB];
    const target = clamp(p.expMin + (m + K * prior) / (w + K) - base, 0, 40);
    if (p.starter && !usualStarter && target > p.expMin + 1) p.notes.push(`titulaire ce soir (${Math.round(p.expMin)} → ${Math.round(target)} min)`);
    if (!p.starter && usualStarter && target < p.expMin - 1) p.notes.push(`sort du banc ce soir (${Math.round(p.expMin)} → ${Math.round(target)} min)`);
    p.expMin = target;
  }

  // Courbes manquantes ou rôle modifié : gabarit de ligue selon le rang de minutes.
  const ranked = [...players].sort((a, b) => (b.starter ? 1 : 0) - (a.starter ? 1 : 0) || b.expMin - a.expMin);
  ranked.forEach((p, rank) => {
    const tpl = T[Math.min(rank, 12)];
    const tplMin = sum(tpl);
    const scale = tplMin > 0 ? p.expMin / tplMin : 0;
    const templ = tpl.map((v) => clamp(v * scale, 0, 1));
    if (!p.presence.length) p.presence = templ;
    else {
      // Rôle de titulaire nouveau : mélange 50/50 avec le gabarit de titulaire.
      const wasStarter = (() => {
        const pr = f.players.get(p.id)?.presenceByTeam.get(team.id);
        return pr ? pr.starts / pr.w >= 0.5 : false;
      })();
      if (p.starter !== wasStarter) p.presence = p.presence.map((v, i) => 0.5 * v + 0.5 * templ[i]);
    }
  });
}

function teamModel(ctx: Ctx, info: TeamInfo, players: PlayerModel[], date: string, venue: TeamInfo): TeamModel {
  const { feats: f, tables: t, league } = ctx;
  const T: TeamFeat | undefined = f.teams.get(info.id);
  const adv = t.teamAdv.get(info.id);
  const four = t.teamFour.get(info.id);
  const transOff = Object.fromEntries(START_TYPES.map((s) => [s, shrinkRate(T?.trans[s] ?? 0, T?.starts[s] ?? 0, league.transByStart[s], 120)])) as Record<StartType, number>;
  // Calage sur la part de possessions en transition mesurée par Synergy (signature du coach / de l'effectif).
  const so = t.synT.get(info.id);
  const synTot = so ? sum(PT_LIST.map((p) => so[p].poss)) : 0;
  const lgTot = sum(PT_LIST.map((p) => t.synLeague[p].poss));
  const targetShare = so && synTot > 500 ? (so.Transition.poss / synTot) * 0.85 + (t.synLeague.Transition.poss / lgTot) * 0.15 : t.synLeague.Transition.poss / lgTot;
  const startTot = T ? sum(START_TYPES.map((s) => T.starts[s])) : 0;
  const curShare = startTot ? sum(START_TYPES.map((s) => (T!.starts[s] / startTot) * transOff[s])) : 0.14;
  const transMult = clamp(targetShare / Math.max(0.02, curShare), 0.7, 1.8);
  for (const s of START_TYPES) transOff[s] = clamp(transOff[s] * transMult, 0, s === 'steal' ? 0.92 : 0.8);
  let oppTrans = 0, oppExp = 0;
  for (const s of START_TYPES) {
    oppTrans += T?.oppTrans[s] ?? 0;
    oppExp += (T?.oppStarts[s] ?? 0) * league.transByStart[s];
  }
  const transDefMult = clamp((oppTrans + 150) / (oppExp + 150), 0.7, 1.35);
  const td = t.synTD.get(info.id);
  const tdTot = td ? sum(PT_LIST.map((p) => td[p].poss)) : 0;
  const ptDefMult = Object.fromEntries(PT_LIST.map((p) => {
    const fr = td && tdTot ? td[p].poss / tdTot : league.ptFreq[p];
    const n = td?.[p].poss ?? 0;
    const m = (fr / Math.max(1e-6, league.ptFreq[p])) * (n / (n + 250)) + 1 * (250 / (n + 250));
    return [p, clamp(m, 0.6, 1.6)];
  })) as Record<PT, number>;
  const oppFgaTot = T ? sum(T.oppFga) : 0;
  const zoneDefMult = (T ? T.oppFga : [0, 0, 0, 0, 0, 0]).map((n, z) => {
    const fr = oppFgaTot ? n / oppFgaTot : league.zoneFreq[z];
    const w = oppFgaTot / (oppFgaTot + 1500);
    return clamp(w * (fr / league.zoneFreq[z]) + (1 - w), 0.75, 1.3);
  }) as Z6;
  const zoneDefFg = (T ? T.oppFga : [0, 0, 0, 0, 0, 0]).map((n, z) => {
    if (!T || n <= 0) return 0;
    const exp = T.oppExpFgm[z] / n;
    const act = T.oppFgm[z] / n;
    return clamp((logit(act) - logit(exp)) * (n / (n + 400)), -0.25, 0.25);
  }) as Z6;
  const foulRate = T && T.defPoss > 0 ? shrinkRate(T.nonShootFouls, T.defPoss, league.nonShootFoulRate, 400) : league.nonShootFoulRate;
  const tovForceMult = four ? clamp(Math.pow(four.oppTovPct / t.leagueTovPct, 0.8), 0.8, 1.25) : 1;

  // Taux de switch : part des duels avec écart de taille ≥ 5 pouces (proxy des changements sur écran).
  let mis = 0, all = 0, lmis = 0, lall = 0;
  const ids = new Set(players.map((p) => p.id));
  for (const r of t.matchups) {
    const hd = ctx.heights.get(r.DEF_PLAYER_ID);
    const ho = ctx.heights.get(r.OFF_PLAYER_ID);
    if (hd == null || ho == null) continue;
    const w = r.PARTIAL_POSS * r._w;
    const m = Math.abs(hd - ho) >= 5 ? w : 0;
    lmis += m; lall += w;
    if (ids.has(r.DEF_PLAYER_ID)) {
      mis += m; all += w;
    }
  }
  const switchRate = clamp(0.32 * ((all ? mis / all : 0) / Math.max(1e-6, lall ? lmis / lall : 1)), 0.12, 0.7);

  // Repos.
  const lastGame = [...f.players.values()]
    .flatMap((p) => p.games.filter((g) => g.tm === info.id && g.date < date).map((g) => g.date))
    .sort()
    .at(-1);
  const restDays = lastGame ? Math.max(0, Math.round((Date.parse(date) - Date.parse(lastGame)) / 86_400_000) - 1) : 3;

  // Continuité : minutes attendues des joueurs ayant déjà joué pour cette équipe (saison précédente ou en cours).
  let contNum = 0, contDen = 0;
  for (const p of players) {
    if (p.avail <= 0) continue;
    const g = f.players.get(p.id)?.games ?? [];
    const withTeam = g.filter((x) => x.tm === info.id && x.sec > 0).length;
    const share = g.length ? Math.min(1, withTeam / Math.min(20, g.length)) : 0;
    contNum += p.expMin * p.avail * share;
    contDen += p.expMin * p.avail;
  }
  const continuity = contDen ? contNum / contDen : 0;
  // Incertitude sur la force réelle : un effectif remanié ou un début de saison (peu de matchs ensemble) rendent les
  // notes moins sûres ; tirée à chaque simulation, elle rapproche la probabilité du 50/50 quand le moteur sait peu.
  const season = seasonOfDate(date);
  const gpCur = T?.sched.filter((s) => s.date < date && seasonOfDate(s.date) === season).length ?? 0;
  const strengthSd = 0.1 * (1 - continuity) + 0.06 * Math.max(0, 1 - gpCur / 20);

  // Fatigue : back-to-back, voyage de 2 fuseaux ou plus vers l'est sans jour de repos, altitude pour le visiteur.
  const prevGame = T?.sched.filter((s) => s.date < date).at(-1);
  const shiftEast = prevGame ? TZ[venue.tri] - TZ[teamById(prevGame.venue)?.tri ?? venue.tri] : 0;
  const fatigueWhy: string[] = [];
  let fatigue = 0;
  if (restDays === 0) {
    fatigue += 1;
    fatigueWhy.push('2e match en deux soirs');
  }
  if (shiftEast >= 2 && restDays <= 1) {
    fatigue += 0.5;
    fatigueWhy.push(`voyage de ${shiftEast} fuseaux horaires vers l'est`);
  }
  if (venue.id !== info.id && ALTITUDE[venue.tri]) {
    fatigue += ALTITUDE[venue.tri];
    fatigueWhy.push(`altitude (${venue.city})`);
  }

  // Force des adversaires affrontés (pondérée comme les notes) : corrige un calendrier facile ou difficile.
  const rawO = (x?: TeamFeat) => (x && x.poss > 0 ? x.pts / x.poss : league.ppg / league.pace);
  const rawD = (x?: TeamFeat) => (x && x.defPoss > 0 ? x.ptsAllowed / x.defPoss : league.ppg / league.pace);
  let sw = 0, oppD = 0, oppO = 0;
  for (const s of T?.sched ?? []) {
    if (s.date >= date) continue;
    const o = f.teams.get(s.opp);
    sw += s.w;
    oppD += s.w * rawD(o);
    oppO += s.w * rawO(o);
  }
  const lgPP = league.ppg / league.pace;
  const sos: [number, number] = sw > 0 ? [oppD / sw - lgPP, oppO / sw - lgPP] : [0, 0];

  return {
    ortg: T && T.poss > 0 ? T.pts / T.poss : league.ppg / league.pace,
    drtg: T && T.defPoss > 0 ? T.ptsAllowed / T.defPoss : league.ppg / league.pace,
    continuity,
    gpCur,
    strengthSd,
    id: info.id, tri: info.tri, name: info.name, city: info.city, color: info.color, color2: info.color2, players,
    pace: adv?.pace ?? league.pace,
    hcDurOff: T && T.durN > 50 ? T.durSum / T.durN : league.hcDur,
    hcDurDef: T && T.oppDurN > 50 ? T.oppDurSum / T.oppDurN / league.hcDur : 1,
    transOff, transDefMult, ptDefMult, tovForceMult, zoneDefMult, zoneDefFg, foulRate, switchRate,
    restDays, b2b: restDays === 0, fatigue, fatigueWhy, sos,
    defContest: shares(t.contestT.get(info.id), shares(t.contestL), 200),
    ratings: {
      offRtg: adv?.offRtg ?? 0, defRtg: adv?.defRtg ?? 0, netRtg: adv?.netRtg ?? 0, pace: adv?.pace ?? 0,
      tovPct: four?.tovPct ?? 0, oppTovPct: four?.oppTovPct ?? 0, orebPct: four?.orebPct ?? 0,
    },
  };
}

// Résultats par équipe et par match (points de chaque équipe reconstitués depuis les lignes de match des joueurs).
type TeamGame = { date: string; margin: number; home: boolean; opp: number; pts: number; oppPts: number };
const teamLogs = new WeakMap<FeatureSet, Map<number, TeamGame[]>>();
function teamLogOf(f: FeatureSet): Map<number, TeamGame[]> {
  let out = teamLogs.get(f);
  if (out) return out;
  const pts = new Map<string, { date: string; home: boolean; tm: number; opp: number; gameId: string; pts: number }>();
  for (const pf of f.players.values()) {
    for (const x of pf.games) {
      const k = `${x.gameId}:${x.tm}`;
      const e = pts.get(k) ?? { date: x.date, home: x.home, tm: x.tm, opp: x.opp, gameId: x.gameId, pts: 0 };
      e.pts += x.pts;
      pts.set(k, e);
    }
  }
  out = new Map();
  for (const e of pts.values()) {
    const o = pts.get(`${e.gameId}:${e.opp}`);
    if (!o) continue;
    let l = out.get(e.tm);
    if (!l) out.set(e.tm, (l = []));
    l.push({ date: e.date, margin: e.pts - o.pts, home: e.home, opp: e.opp, pts: e.pts, oppPts: o.pts });
  }
  for (const l of out.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  teamLogs.set(f, out);
  return out;
}

/**
 * Momentum d'équipe : écart moyen (corrigé du terrain) des 15 derniers matchs, playoffs compris, contre celui des deux
 * saisons précédentes. Une équipe qui fait ce qu'elle n'a jamais fait ces dernières années, ou l'inverse.
 */
function teamMomentum(f: FeatureSet, teamId: number, date: string, homeMargin: number): TeamMomentum | undefined {
  const games = (teamLogOf(f).get(teamId) ?? []).filter((g) => g.date < date);
  if (games.length < 25) return undefined;
  const adj = (g: { margin: number; home: boolean }) => g.margin - (g.home ? homeMargin : -homeMargin);
  const recent = games.slice(-15);
  const cur = seasonOfDate(date);
  const from = String(Number(cur.slice(0, 4)) - 2);
  const base = games.slice(0, -15).filter((g) => seasonOfDate(g.date).slice(0, 4) >= from);
  if (base.length < 20) return undefined;
  const avg = (a: typeof games) => sum(a.map(adj)) / a.length;
  let streak = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    const win = games[i].margin > 0;
    if (streak === 0) streak = win ? 1 : -1;
    else if (win === streak > 0) streak += win ? 1 : -1;
    else break;
  }
  const r = avg(recent);
  const b = avg(base);
  return { recent: r, base: b, delta: r - b, n: recent.length, nBase: base.length, streak };
}

/**
 * Confrontations des deux dernières années. Avant chaque match, l'écart attendu vient de la forme des deux équipes sur
 * leurs 30 matchs précédents (corrigée du terrain). Chat noir : une équipe favorite au moins 3 fois qui a perdu au moins
 * 3 de ces matchs (70 % ou plus), très en dessous de l'attendu. Rare par construction.
 */
// Noms d'équipe au singulier en français (le Heat, le Magic...).
const SINGULAR_TEAMS = new Set(['Heat', 'Magic', 'Thunder', 'Jazz']);

function teamH2H(f: FeatureSet, home: TeamModel, away: TeamModel, date: string, homeMargin: number): TeamH2H | undefined {
  const logs = teamLogOf(f);
  const since = new Date(Date.parse(date) - 730 * 86_400_000).toISOString().slice(0, 10);
  const meets = (logs.get(home.id) ?? []).filter((g) => g.opp === away.id && g.date < date && g.date >= since);
  if (!meets.length) return undefined;
  const adj = (g: TeamGame) => g.margin - (g.home ? homeMargin : -homeMargin);
  const formBefore = (id: number, d: string) => {
    const l = (logs.get(id) ?? []).filter((g) => g.date < d).slice(-30);
    return l.length ? sum(l.map(adj)) / l.length : 0;
  };
  const meetings = meets.map((g) => {
    const exp = formBefore(home.id, g.date) - formBefore(away.id, g.date) + (g.home ? homeMargin : -homeMargin); // pour l'équipe à domicile ce soir
    return { date: g.date, homeTri: g.home ? home.tri : away.tri, hs: g.home ? g.pts : g.oppPts, as: g.home ? g.oppPts : g.pts, expHome: g.home ? exp : -exp, exp, real: g.margin };
  });
  const res = sum(meetings.map((m) => m.real - m.exp)) / meetings.length;
  const out: TeamH2H = {
    meetings: meetings.map(({ exp: _e, real: _r, ...m }) => m),
    residualHome: (res * meetings.length) / (meetings.length + 4),
  };
  for (const victim of ['home', 'away'] as const) {
    // Écart attendu et réel du point de vue de la victime potentielle (exp et real sont vus de l'équipe à domicile ce soir).
    const sign = victim === 'home' ? 1 : -1;
    const favored = meetings.map((m) => ({ exp: sign * m.exp, real: sign * m.real })).filter((x) => x.exp >= 2);
    const lost = favored.filter((x) => x.real < 0).length;
    const resid = favored.length ? sum(favored.map((x) => x.real - x.exp)) / favored.length : 0;
    if (favored.length >= 3 && lost >= 3 && lost / favored.length >= 0.7 && resid <= -6) {
      const v = victim === 'home' ? home : away;
      const c = victim === 'home' ? away : home;
      const one = SINGULAR_TEAMS.has(v.name);
      out.blackCat = {
        victim, favored: favored.length, lost, residual: resid,
        text: `${one ? 'Le' : 'Les'} ${v.name} ${one ? 'a' : 'ont'} perdu ${lost} de ${one ? 'ses' : 'leurs'} ${favored.length} derniers matchs contre ${SINGULAR_TEAMS.has(c.name) ? 'le' : 'les'} ${c.name} en étant ${one ? 'favori' : 'favoris'} (${Math.abs(resid).toFixed(1).replace('.', ',')} pts sous l'écart attendu en moyenne).`,
      };
    }
  }
  return out;
}

function shortNames(all: PlayerModel[]): void {
  const lastOf = (n: string) => n.split(' ').slice(1).join(' ') || n;
  const counts = new Map<string, number>();
  for (const p of all) counts.set(lastOf(p.name), (counts.get(lastOf(p.name)) ?? 0) + 1);
  for (const p of all) {
    const last = lastOf(p.name);
    if (p.name === 'Shai Gilgeous-Alexander') p.short = 'SGA';
    else if ((counts.get(last) ?? 0) > 1) p.short = `${p.name.slice(0, 3)}. ${last}`;
    else p.short = last;
  }
}

async function attachPasses(t: Tables, players: PlayerModel[], log: (...a: unknown[]) => void): Promise<void> {
  const ids = new Set(players.map((p) => p.id));
  await pool(players, 2, async (p) => {
    for (const [season, ttl] of [[t.prev, Infinity], [t.cur, 6]] as const) {
      try {
        const r = await playerPasses(season, SEASON_TYPES.regular, p.id, ttl);
        for (const row of r.made) {
          const to = row.PASS_TEAMMATE_PLAYER_ID;
          if (!ids.has(to)) continue;
          const w = season === t.cur ? 1.5 : 0.8;
          p.passTo[to] = (p.passTo[to] ?? 0) + w * (row.PASS ?? 0);
          p.astTo[to] = (p.astTo[to] ?? 0) + w * (row.AST ?? 0);
        }
      } catch (e) {
        log(`  passes indisponibles pour ${p.name} (${season})`);
      }
    }
  });
}

function insightsFor(ctx: Ctx, home: TeamModel, away: TeamModel, h2h?: TeamH2H): string[] {
  const out: string[] = [];
  const t = ctx.tables;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const rank = (vals: Map<number, number>, id: number, desc: boolean) => {
    const arr = [...vals.entries()].sort((a, b) => (desc ? b[1] - a[1] : a[1] - b[1]));
    return arr.findIndex(([k]) => k === id) + 1;
  };
  const tov = new Map([...t.teamFour].map(([k, v]) => [k, v.tovPct]));
  const forced = new Map([...t.teamFour].map(([k, v]) => [k, v.oppTovPct]));
  const n1 = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(1).replace('.', ',')}`;
  if (h2h?.blackCat) out.push(`Chat noir : ${h2h.blackCat.text}`);
  const last = h2h?.meetings.at(-1);
  if (last && Math.abs(last.hs - last.as) >= 15) {
    const lostTri = (last.hs > last.as) === (last.homeTri === home.tri) ? away.tri : home.tri;
    const loser = lostTri === home.tri ? home : away;
    out.push(`Revanche : ${loser.name} ${SINGULAR_TEAMS.has(loser.name) ? 'avait' : 'avaient'} perdu de ${Math.abs(last.hs - last.as)} points le dernier face-à-face (${last.date.split('-').reverse().join('/')}).`);
  }
  for (const [tm, opp] of [[home, away], [away, home]] as const) {
    for (const p of tm.players) {
      if (p.avail < 0.5 || p.expMin < 15) continue;
      const withOpp = ctx.feats.players.get(p.id)?.games.filter((g) => g.tm === opp.id && g.sec > 0).length ?? 0;
      if (withOpp >= 20) out.push(`${p.name} retrouve son ancienne équipe (${withOpp} matchs avec ${SINGULAR_TEAMS.has(opp.name) ? 'le' : 'les'} ${opp.name}).`);
    }
    if (tm.noStakes) out.push(`${tm.name} : fin de saison sans enjeu (${tm.record!.w}-${tm.record!.l}).`);
  }
  for (const tm of [away, home]) {
    const mo = tm.momentum;
    if (mo && Math.abs(mo.delta) >= 4) {
      out.push(`${tm.name} ${mo.delta > 0 ? 'en pleine montée' : 'en baisse'} : ${n1(mo.recent)} pts d'écart par match sur les ${mo.n} derniers matchs, contre ${n1(mo.base)} les deux saisons précédentes.`);
    }
    const riser = tm.players.filter((p) => p.avail > 0.5 && p.expMin >= 18 && p.momentum).sort((a, b) => Math.abs(b.momentum!.delta) - Math.abs(a.momentum!.delta))[0];
    if (riser && Math.abs(riser.momentum!.delta) >= 3) {
      const m = riser.momentum!;
      out.push(`${riser.name} ${m.delta > 0 ? 'en pleine progression' : 'en recul'} : niveau ${m.recent.toFixed(1).replace('.', ',')} sur 36 min ces 15 derniers matchs, contre ${m.base.toFixed(1).replace('.', ',')} les saisons précédentes.`);
    }
  }
  for (const tm of [away, home]) {
    const f4 = t.teamFour.get(tm.id);
    if (f4) out.push(`${tm.tri} : pertes de balle ${pct(f4.tovPct)} des possessions (rang ${rank(tov, tm.id, false)}), en provoque ${pct(f4.oppTovPct)} (rang ${rank(forced, tm.id, true)}).`);
    const T = ctx.feats.teams.get(tm.id);
    if (T) {
      const tot = sum(T.oppFga);
      const rimFg = T.oppFga[0] ? T.oppFgm[0] / T.oppFga[0] : 0;
      const three = (T.oppFga[3] + T.oppFga[4] + T.oppFga[5]) / tot;
      const three3 = (T.oppFgm[3] + T.oppFgm[4] + T.oppFgm[5]) / Math.max(1, T.oppFga[3] + T.oppFga[4] + T.oppFga[5]);
      out.push(`${tm.tri} en défense : adversaires à ${pct(rimFg)} au cercle (ligue ${pct(ctx.league.zoneFg[0])}), ${pct(three)} de leurs tirs à 3 pts, à ${pct(three3)}.`);
    }
    // Joueur le plus "chassé" (pire impact défensif pondéré par minutes attendues).
    const hunted = tm.players.filter((p) => p.avail > 0.5 && p.expMin > 12).sort((a, b) => b.dOverall - a.dOverall)[0];
    if (hunted && hunted.dOverall > 0.04) out.push(`Cible probable en défense chez ${tm.tri} : ${hunted.name} (impact au tir adverse ${hunted.dOverall > 0 ? '+' : ''}${(hunted.dOverall * 100 / 4).toFixed(1)} pts de %, ${(hunted.d3 * 100 / 4).toFixed(1)} sur les 3 pts).`);
    const protector = tm.players.filter((p) => p.avail > 0.5 && p.expMin > 15).sort((a, b) => a.dRim - b.dRim)[0];
    if (protector && protector.dRim < -0.1) out.push(`Protection du cercle ${tm.tri} : ${protector.name} (${(protector.dRim * 100 / 4).toFixed(1)} pts de % au cercle).`);
    // Moteur offensif : type de jeu principal du joueur le plus utilisé.
    const star = [...tm.players].filter((p) => p.avail > 0.5).sort((a, b) => b.usg * b.expMin - a.usg * a.expMin)[0];
    if (star) {
      const syn = t.synP.get(star.id);
      if (syn) {
        const best = HALF_COURT_PT.map((p) => [p, syn[p]] as const).sort((a, b) => b[1].poss - a[1].poss).slice(0, 2);
        out.push(`${star.name} : ${best.map(([p, a]) => `${p} ${a.poss ? (a.pts / a.poss).toFixed(2) : '-'} pt/poss`).join(', ')}.`);
      }
    }
  }
  return out;
}

export async function buildGameModel(opts: BuildOpts): Promise<GameModel> {
  const log = opts.log ?? (() => {});
  const season = seasonOfDate(opts.date);
  const { prev2, prev, cur } = seasonsInScope(season);
  const homeInfo = teamByTri(opts.homeTri);
  const awayInfo = teamByTri(opts.awayTri);

  log('chargement des tableaux stats.nba.com…');
  const tables = await loadTablesCached(cur, prev, prev2, opts.pastTablesOnly);
  const heights = new Map<number, number>();
  const posOf = new Map<number, string>();
  for (const [id, r] of tables.index) {
    heights.set(id, heightToIn(r.HEIGHT));
    posOf.set(id, r.POSITION);
  }
  const groupCache = new Map<number, 'G' | 'W' | 'B'>();
  const groupOf = (pid: number) => {
    let g = groupCache.get(pid);
    if (!g) groupCache.set(pid, (g = groupOfPos(posOf.get(pid), heights.get(pid) ?? 78)));
    return g;
  };
  log('agrégation des play-by-play (forme récente)…');
  const feats = buildFeaturesCached(opts.date, groupOf);
  const ctx = makeCtx(feats, tables, groupOf, heights);

  // Effectifs actuels (index joueurs saison courante = transferts / mercato pris en compte).
  const rosterOf = (info: TeamInfo): number[] => {
    const ids = new Set<number>();
    if (opts.actual) {
      const side = opts.actual.home.id === info.id ? opts.actual.home : opts.actual.away;
      for (const p of side.players) ids.add(p.id);
      return [...ids];
    }
    for (const [id, r] of tables.index) if (r.TEAM_ID === info.id) ids.add(id);
    return [...ids];
  };

  // Blessures.
  const useInj = opts.injuries ?? !opts.actual;
  let injuries: InjuryItem[] = [];
  if (useInj) injuries = await getInjuries().catch(() => []);
  const outSet = new Set((opts.out ?? []).map(normName));
  const inSet = new Set((opts.in ?? []).map(normName));

  // Compositions du jour (match à venir uniquement).
  const lineups = opts.actual ? [] : await dailyLineups(opts.date).catch(() => []);
  const lineupFor = (teamId: number): number[] | undefined => {
    for (const g of lineups) {
      for (const sd of [g.home, g.away]) if (sd.teamId === teamId) return sd.starters.filter((x) => !/inactive/i.test(x.roster)).map((x) => x.id);
    }
    return undefined;
  };

  const buildTeam = async (info: TeamInfo) => {
    const ids = rosterOf(info);
    const players: PlayerModel[] = [];
    for (const id of ids) {
      const r = tables.index.get(id);
      const box = opts.actual ? [opts.actual.home, opts.actual.away].flatMap((s) => s.players).find((x) => x.id === id) : undefined;
      const name = r ? `${r.PLAYER_FIRST_NAME} ${r.PLAYER_LAST_NAME}` : box?.name ?? String(id);
      const pos = r?.POSITION ?? box?.pos ?? '';
      const heightIn = heights.get(id) ?? 78;
      let status = 'Active';
      let avail = 1;
      if (box && box.status !== 'ACTIVE') {
        status = `Out (${(box.reason ?? 'inactive').toLowerCase()})`;
        avail = 0;
      }
      const inj = injuries.find((x) => x.team === `${info.city} ${info.name}` && normName(x.name) === normName(name))
        ?? injuries.find((x) => normName(x.name) === normName(name) && x.team.endsWith(info.name));
      if (inj) {
        status = inj.status;
        avail = STATUS_AVAIL[inj.status.toLowerCase()] ?? 0.7;
      }
      if (outSet.has(normName(name))) {
        status = 'Out (manuel)';
        avail = 0;
      }
      if (inSet.has(normName(name))) {
        status = 'Active (manuel)';
        avail = 1;
      }
      players.push(buildPlayer(ctx, id, { name, jersey: r?.JERSEY_NUMBER ?? box?.jersey ?? '', pos, heightIn, teamId: info.id }, { status, avail }, cur));
    }
    assignMinutes(ctx, info, players, cur, opts.actual, lineupFor(info.id), (opts.gameId ?? opts.actual?.gameId ?? '').startsWith('004'));
    return players;
  };

  log('modèles joueurs…');
  const homePlayers = await buildTeam(homeInfo);
  const awayPlayers = await buildTeam(awayInfo);
  shortNames([...homePlayers, ...awayPlayers]);
  for (const ps of [homePlayers, awayPlayers]) {
    for (const p of ps) {
      // Réseau de passes décisives issu du PBP (point-in-time).
      const m = feats.astPairs.get(p.id);
      if (m) for (const q of ps) if (m.has(q.id)) p.astTo[q.id] = (p.astTo[q.id] ?? 0) + m.get(q.id)!;
    }
  }
  if (opts.passes ?? !opts.actual) {
    log('réseaux de passes (tracking)…');
    await attachPasses(tables, homePlayers, log);
    await attachPasses(tables, awayPlayers, log);
  }

  const home = teamModel(ctx, homeInfo, homePlayers, opts.date, homeInfo);
  const away = teamModel(ctx, awayInfo, awayPlayers, opts.date, homeInfo);
  home.momentum = teamMomentum(feats, home.id, opts.date, ctx.league.homeMargin);
  away.momentum = teamMomentum(feats, away.id, opts.date, ctx.league.homeMargin);
  for (const t of [home, away]) {
    const cur = (teamLogOf(feats).get(t.id) ?? []).filter((g) => g.date < opts.date && seasonOfDate(g.date) === season);
    t.record = { w: cur.filter((g) => g.margin > 0).length, l: cur.filter((g) => g.margin < 0).length };
    const md = opts.date.slice(5);
    t.noStakes = md >= '02-15' && md <= '06-30' && t.record.w + t.record.l >= 40 && t.record.w / (t.record.w + t.record.l) < 0.33;
  }
  const teamH2h = teamH2H(feats, home, away, opts.date, ctx.league.homeMargin);

  // H2H : minutes de duel entre attaquants d'une équipe et défenseurs de l'autre.
  const h2h: Record<string, Record<string, number>> = {};
  const hIds = new Set(homePlayers.map((p) => p.id));
  const aIds = new Set(awayPlayers.map((p) => p.id));
  for (const r of tables.matchups) {
    const o = r.OFF_PLAYER_ID;
    const d = r.DEF_PLAYER_ID;
    if ((hIds.has(o) && aIds.has(d)) || (aIds.has(o) && hIds.has(d))) {
      (h2h[o] ??= {})[d] = (h2h[o][d] ?? 0) + r.PARTIAL_POSS * r._w;
    }
  }
  // Historique joueur vs cet adversaire (box scores).
  for (const [ps, opp] of [[homePlayers, away.id], [awayPlayers, home.id]] as const) {
    for (const p of ps) {
      const lines = feats.players.get(p.id)?.games.filter((g) => g.sec > 0) ?? [];
      const vs = lines.filter((g) => g.opp === opp);
      if (vs.length) {
        p.h2h = {
          games: vs.length, pts: sum(vs.map((g) => g.pts)) / vs.length, reb: sum(vs.map((g) => g.reb)) / vs.length,
          ast: sum(vs.map((g) => g.ast)) / vs.length, ptsAll: lines.length ? sum(lines.map((g) => g.pts)) / lines.length : 0,
          last: { date: vs[vs.length - 1].date, pts: vs[vs.length - 1].pts }, best: Math.max(...vs.map((g) => g.pts)),
        };
      }
    }
  }

  // Duels tireur / défenseur : adresse réelle du tireur face à ce défenseur, rétrécie vers son adresse habituelle.
  const duel: Record<number, Record<number, number>> = {};
  const acc = new Map<string, { fga: number; fgm: number }>();
  for (const r of tables.matchups) {
    const o = r.OFF_PLAYER_ID;
    const d = r.DEF_PLAYER_ID;
    if (!((hIds.has(o) && aIds.has(d)) || (aIds.has(o) && hIds.has(d)))) continue;
    const k = `${o}:${d}`;
    const a = acc.get(k) ?? { fga: 0, fgm: 0 };
    a.fga += (r.MATCHUP_FGA ?? 0) * r._w;
    a.fgm += (r.MATCHUP_FGM ?? 0) * r._w;
    acc.set(k, a);
  }
  for (const [k, a] of acc) {
    const [o, d] = k.split(':').map(Number);
    const pf = feats.players.get(o);
    const fga = pf ? sum(pf.fga) : 0;
    const p0 = fga > 20 ? sum(pf!.fgm) / fga : 0.46;
    if (a.fga < 3) continue;
    const adj = logit((a.fgm + 50 * p0) / (a.fga + 50)) - logit(p0);
    (duel[o] ??= {})[d] = clamp(adj, -0.3, 0.3);
  }

  const model: GameModel = {
    meta: {
      gameId: opts.gameId ?? '', date: opts.date, season: cur, builtAt: new Date().toISOString(), dataThrough: feats.lastGameDate,
      gamesUsed: feats.gamesUsed,
      sources: ['cdn.nba.com play-by-play', 'stats.nba.com Synergy', 'stats.nba.com tracking défensif', 'stats.nba.com matchups', 'stats.nba.com passes', 'ESPN blessures', 'ESPN/DraftKings cotes'],
    },
    league: ctx.league, duel, h2h: teamH2h, home, away, h2hMatchups: h2h, params: { ...DEFAULT_PARAMS }, insights: [],
  };
  model.insights = insightsFor(ctx, home, away, teamH2h);

  if (opts.market ?? !opts.actual) {
    const m = await getMarket(opts.date, homeInfo.tri, awayInfo.tri).catch(() => undefined);
    if (m) {
      model.market = { provider: m.provider, spreadHome: m.spreadHome, total: m.total, mlHome: m.mlHome, mlAway: m.mlAway };
      if (m.mlHome != null && m.mlAway != null) model.market.pHomeNoVig = noVig(m.mlHome, m.mlAway)[0];
      model.props = await getProps(m.eventId).catch(() => []);
    }
  }
  return model;
}

export const _internals = { isThree, zi };
