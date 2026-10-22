// Chargement et fusion des tableaux stats.nba.com (saison précédente + saison en cours, saison régulière + playoffs).
import * as S from '../../data/nbaStats.ts';
import { PT_LIST, type PT } from './types.ts';
import { seasonOfDate } from '../seasons.ts';

export interface SynAgg {
  poss: number;
  pts: number;
  fga: number;
  fgm: number;
  tov: number;
  sf: number;
  and1: number;
  ft: number;
}
const emptySyn = (): SynAgg => ({ poss: 0, pts: 0, fga: 0, fgm: 0, tov: 0, sf: 0, and1: 0, ft: 0 });

export interface DefAgg {
  // par catégorie : tirs défendus, réussis, % "normal" des tireurs
  [cat: string]: { dfga: number; dfgm: number; normal: number; gp: number };
}

/** Tirs à 2 et 3 pts par niveau de contestation (0 = très serré ... 3 = grand ouvert). */
export interface ContestAgg {
  fg2a: number[];
  fg2m: number[];
  fg3a: number[];
  fg3m: number[];
}
const emptyContest = (): ContestAgg => ({ fg2a: [0, 0, 0, 0], fg2m: [0, 0, 0, 0], fg3a: [0, 0, 0, 0], fg3m: [0, 0, 0, 0] });

export interface Tables {
  cur: string;
  prev: string;
  index: Map<number, S.Row>; // playerindex saison courante
  synP: Map<number, Record<PT, SynAgg>>;
  synT: Map<number, Record<PT, SynAgg>>; // attaque équipe
  synTD: Map<number, Record<PT, SynAgg>>; // défense équipe (concédé)
  synLeague: Record<PT, SynAgg>;
  adv: Map<number, { poss: number; min: number; gp: number; usg: number; astPct: number; orebPct: number; drebPct: number }>;
  base: Map<number, { gp: number; min: number; pts: number; fga: number; fta: number; tov: number; ast: number }>;
  age: Map<number, { season: string; age: number }>; // âge du joueur lors de sa saison la plus récente
  def: Map<number, DefAgg>;
  teamAdv: Map<number, { pace: number; gp: number; offRtg: number; defRtg: number; netRtg: number }>;
  teamFour: Map<number, { tovPct: number; oppTovPct: number; orebPct: number; oppOrebPct: number; ftaRate: number; oppFtaRate: number; gp: number }>;
  matchups: S.Row[]; // lignes saison (attaquant, défenseur)
  contestP: Map<number, ContestAgg>; // tirs du joueur par niveau de contestation
  contestT: Map<number, ContestAgg>; // tirs concédés par chaque défense par niveau de contestation
  contestL: ContestAgg; // ligue
  leagueTovPct: number;
}

/** Poids des saisons : la saison précédente est escomptée, la saison en cours sur-pondérée (forme récente). */
export const SEASON_W = { prev2: 0.35, prev: 0.8, cur: 1.5, playoffs: 0.9 };

const DEF_KEYS: Record<string, [string, string, string]> = {
  Overall: ['D_FGA', 'D_FGM', 'NORMAL_FG_PCT'],
  '3 Pointers': ['FG3A', 'FG3M', 'NS_FG3_PCT'],
  '2 Pointers': ['FG2A', 'FG2M', 'NS_FG2_PCT'],
  'Less Than 6Ft': ['FGA_LT_06', 'FGM_LT_06', 'NS_LT_06_PCT'],
  'Less Than 10Ft': ['FGA_LT_10', 'FGM_LT_10', 'NS_LT_10_PCT'],
  'Greater Than 15Ft': ['FGA_GT_15', 'FGM_GT_15', 'NS_GT_15_PCT'],
};

const tablesMemo = new Map<string, Promise<Tables>>();

/** Version mémoïsée (utile pour les backtests qui construisent beaucoup de modèles). */
export function loadTablesCached(cur: string, prev: string, prev2?: string, pastOnly = false): Promise<Tables> {
  const k = `${cur}|${prev}|${prev2 ?? ''}|${pastOnly}`;
  let t = tablesMemo.get(k);
  if (!t) tablesMemo.set(k, (t = loadTables(cur, prev, prev2, pastOnly)));
  return t;
}

/** pastOnly : sans la saison `cur` (pour rejouer un match passé sans voir les totaux de fin de saison). */
export async function loadTables(cur: string, prev: string, prev2?: string, pastOnly = false): Promise<Tables> {
  // Saison réellement en cours : rafraîchie toutes les 6 h ; saisons terminées : cache permanent.
  const ttlCur = cur === seasonOfDate(new Date().toISOString().slice(0, 10)) ? 6 : Infinity;
  const ttlPrev = Infinity;
  const scopes: Array<{ season: string; st: string; w: number; ttl: number }> = [
    { season: prev, st: S.SEASON_TYPES.regular, w: SEASON_W.prev, ttl: ttlPrev },
    { season: prev, st: S.SEASON_TYPES.playoffs, w: SEASON_W.prev * SEASON_W.playoffs, ttl: ttlPrev },
    ...(pastOnly ? [] : [{ season: cur, st: S.SEASON_TYPES.regular, w: SEASON_W.cur, ttl: ttlCur }]),
  ];
  // Saison N-2 (poids réduit) : indispensable pour les joueurs revenant d'une saison blanche.
  if (prev2) {
    scopes.unshift(
      { season: prev2, st: S.SEASON_TYPES.regular, w: SEASON_W.prev2, ttl: ttlPrev },
      { season: prev2, st: S.SEASON_TYPES.playoffs, w: SEASON_W.prev2 * SEASON_W.playoffs, ttl: ttlPrev },
    );
  }

  const index = new Map<number, S.Row>();
  // Index joueurs : saison demandée (effectifs) complété par la saison réellement en cours (tailles, postes, draft).
  const today = seasonOfDate(new Date().toISOString().slice(0, 10));
  for (const r of await S.playerIndex(today, 6)) index.set(r.PERSON_ID, r);
  if (cur !== today) for (const r of await S.playerIndex(cur, Infinity).catch(() => [] as S.Row[])) index.set(r.PERSON_ID, r);

  const synP = new Map<number, Record<PT, SynAgg>>();
  const synT = new Map<number, Record<PT, SynAgg>>();
  const synTD = new Map<number, Record<PT, SynAgg>>();
  const synLeague = Object.fromEntries(PT_LIST.map((p) => [p, emptySyn()])) as Record<PT, SynAgg>;
  const addSyn = (m: Map<number, Record<PT, SynAgg>>, id: number, pt: PT, r: S.Row, w: number) => {
    let rec = m.get(id);
    if (!rec) m.set(id, (rec = Object.fromEntries(PT_LIST.map((p) => [p, emptySyn()])) as Record<PT, SynAgg>));
    const a = rec[pt];
    const poss = (r.POSS ?? 0) * w;
    a.poss += poss;
    a.pts += (r.PTS ?? 0) * w;
    a.fga += (r.FGA ?? 0) * w;
    a.fgm += (r.FGM ?? 0) * w;
    a.tov += (r.TOV_POSS_PCT ?? 0) * poss;
    a.sf += (r.SF_POSS_PCT ?? 0) * poss;
    a.and1 += (r.PLUSONE_POSS_PCT ?? 0) * poss;
    a.ft += (r.FT_POSS_PCT ?? 0) * poss;
  };

  const adv = new Map<number, { poss: number; min: number; gp: number; usg: number; astPct: number; orebPct: number; drebPct: number }>();
  const age = new Map<number, { season: string; age: number }>();
  const base = new Map<number, { gp: number; min: number; pts: number; fga: number; fta: number; tov: number; ast: number }>();
  const def = new Map<number, DefAgg>();
  const teamAdv = new Map<number, { pace: number; gp: number; offRtg: number; defRtg: number; netRtg: number }>();
  const teamFour = new Map<number, { tovPct: number; oppTovPct: number; orebPct: number; oppOrebPct: number; ftaRate: number; oppFtaRate: number; gp: number }>();
  let lgTov = 0;
  let lgTovN = 0;

  for (const sc of scopes) {
    for (const pt of PT_LIST) {
      const rows = await S.synergy(sc.season, sc.st, pt, 'P', 'offensive', sc.ttl).catch(() => [] as S.Row[]);
      for (const r of rows) addSyn(synP, r.PLAYER_ID, pt, r, sc.w);
      const t = await S.synergy(sc.season, sc.st, pt, 'T', 'offensive', sc.ttl).catch(() => [] as S.Row[]);
      for (const r of t) {
        addSyn(synT, r.TEAM_ID, pt, r, sc.w);
        if (sc.st === S.SEASON_TYPES.regular && sc.season === prev) {
          const a = synLeague[pt];
          a.poss += r.POSS;
          a.pts += r.PTS;
          a.fga += r.FGA;
          a.fgm += r.FGM;
          a.tov += r.TOV_POSS_PCT * r.POSS;
          a.sf += r.SF_POSS_PCT * r.POSS;
          a.and1 += r.PLUSONE_POSS_PCT * r.POSS;
          a.ft += r.FT_POSS_PCT * r.POSS;
        }
      }
      const td = await S.synergy(sc.season, sc.st, pt, 'T', 'defensive', sc.ttl).catch(() => [] as S.Row[]);
      for (const r of td) addSyn(synTD, r.TEAM_ID, pt, r, sc.w);
    }

    for (const r of await S.playerDash(sc.season, sc.st, 'Advanced', sc.ttl).catch(() => [] as S.Row[])) {
      const a = adv.get(r.PLAYER_ID) ?? { poss: 0, min: 0, gp: 0, usg: 0, astPct: 0, orebPct: 0, drebPct: 0 };
      const poss = (r.POSS ?? 0) * sc.w;
      a.usg = (a.usg * a.poss + (r.USG_PCT ?? 0) * poss) / Math.max(1e-9, a.poss + poss);
      a.astPct = (a.astPct * a.poss + (r.AST_PCT ?? 0) * poss) / Math.max(1e-9, a.poss + poss);
      a.orebPct = (a.orebPct * a.poss + (r.OREB_PCT ?? 0) * poss) / Math.max(1e-9, a.poss + poss);
      a.drebPct = (a.drebPct * a.poss + (r.DREB_PCT ?? 0) * poss) / Math.max(1e-9, a.poss + poss);
      a.poss += poss;
      a.gp += (r.GP ?? 0) * sc.w;
      a.min += (r.MIN ?? 0) * (r.GP ?? 0) * sc.w;
      adv.set(r.PLAYER_ID, a);
      const known = age.get(r.PLAYER_ID);
      if (r.AGE != null && (!known || known.season < sc.season)) age.set(r.PLAYER_ID, { season: sc.season, age: r.AGE });
    }
    for (const r of await S.playerDash(sc.season, sc.st, 'Base', sc.ttl).catch(() => [] as S.Row[])) {
      const b = base.get(r.PLAYER_ID) ?? { gp: 0, min: 0, pts: 0, fga: 0, fta: 0, tov: 0, ast: 0 };
      b.gp += (r.GP ?? 0) * sc.w;
      b.min += (r.MIN ?? 0) * sc.w;
      b.pts += (r.PTS ?? 0) * sc.w;
      b.fga += (r.FGA ?? 0) * sc.w;
      b.fta += (r.FTA ?? 0) * sc.w;
      b.tov += (r.TOV ?? 0) * sc.w;
      b.ast += (r.AST ?? 0) * sc.w;
      base.set(r.PLAYER_ID, b);
    }
    for (const cat of S.DEFENSE_CATEGORIES) {
      const [fa, fm, nm] = DEF_KEYS[cat];
      for (const r of await S.ptDefend(sc.season, sc.st, cat, sc.ttl).catch(() => [] as S.Row[])) {
        const d = def.get(r.CLOSE_DEF_PERSON_ID) ?? {};
        const c = d[cat] ?? { dfga: 0, dfgm: 0, normal: 0, gp: 0 };
        const n = (r[fa] ?? 0) * sc.w;
        c.normal = (c.normal * c.dfga + (r[nm] ?? 0) * n) / Math.max(1e-9, c.dfga + n);
        c.dfga += n;
        c.dfgm += (r[fm] ?? 0) * sc.w;
        c.gp += (r.GP ?? 0) * sc.w;
        d[cat] = c;
        def.set(r.CLOSE_DEF_PERSON_ID, d);
      }
    }
    if (sc.st === S.SEASON_TYPES.regular) {
      for (const r of await S.teamDash(sc.season, sc.st, 'Advanced', sc.ttl).catch(() => [] as S.Row[])) {
        const t = teamAdv.get(r.TEAM_ID) ?? { pace: 0, gp: 0, offRtg: 0, defRtg: 0, netRtg: 0 };
        const g = (r.GP ?? 0) * sc.w;
        const tot = t.gp + g;
        if (tot > 0) {
          t.pace = (t.pace * t.gp + r.PACE * g) / tot;
          t.offRtg = (t.offRtg * t.gp + r.OFF_RATING * g) / tot;
          t.defRtg = (t.defRtg * t.gp + r.DEF_RATING * g) / tot;
          t.netRtg = (t.netRtg * t.gp + r.NET_RATING * g) / tot;
        }
        t.gp = tot;
        teamAdv.set(r.TEAM_ID, t);
      }
      for (const r of await S.teamDash(sc.season, sc.st, 'Four Factors', sc.ttl).catch(() => [] as S.Row[])) {
        const t = teamFour.get(r.TEAM_ID) ?? { tovPct: 0, oppTovPct: 0, orebPct: 0, oppOrebPct: 0, ftaRate: 0, oppFtaRate: 0, gp: 0 };
        const g = (r.GP ?? 0) * sc.w;
        const tot = t.gp + g;
        const mix = (a: number, b: number) => (tot > 0 ? (a * t.gp + b * g) / tot : 0);
        t.tovPct = mix(t.tovPct, r.TM_TOV_PCT);
        t.oppTovPct = mix(t.oppTovPct, r.OPP_TOV_PCT);
        t.orebPct = mix(t.orebPct, r.OREB_PCT);
        t.oppOrebPct = mix(t.oppOrebPct, r.OPP_OREB_PCT);
        t.ftaRate = mix(t.ftaRate, r.FTA_RATE);
        t.oppFtaRate = mix(t.oppFtaRate, r.OPP_FTA_RATE);
        t.gp = tot;
        teamFour.set(r.TEAM_ID, t);
        if (sc.season === prev) {
          lgTov += r.TM_TOV_PCT * r.GP;
          lgTovN += r.GP;
        }
      }
    }
  }

  // Matchups (qui défend sur qui) : toutes les équipes, saison précédente + en cours.
  const matchups: S.Row[] = [];
  for (const sc of scopes.filter((s) => s.st === S.SEASON_TYPES.regular)) {
    const teams = await S.teamDash(sc.season, sc.st, 'Advanced', sc.ttl).catch(() => [] as S.Row[]);
    for (const t of teams) {
      const rows = await S.seasonMatchups(sc.season, sc.st, sc.ttl, { defTeam: t.TEAM_ID }).catch(() => [] as S.Row[]);
      for (const r of rows) matchups.push({ ...r, _w: sc.w, _season: sc.season });
    }
  }

  // Contestation (distance du défenseur le plus proche) : saison régulière, pondérée comme le reste.
  const contestP = new Map<number, ContestAgg>();
  const contestT = new Map<number, ContestAgg>();
  const contestL = emptyContest();
  for (const sc of scopes.filter((s) => s.st === S.SEASON_TYPES.regular)) {
    for (const [c, range] of S.CLOSE_DEF.entries()) {
      for (const [who, map, key] of [['Player', contestP, 'PLAYER_ID'], ['Opp', contestT, 'TEAM_ID']] as const) {
        const rows = await S.closeDefShots(sc.season, sc.st, range, who, sc.ttl).catch(() => [] as S.Row[]);
        for (const r of rows) {
          const a = map.get(r[key]) ?? emptyContest();
          a.fg2a[c] += sc.w * (r.FG2A ?? 0);
          a.fg2m[c] += sc.w * (r.FG2M ?? 0);
          a.fg3a[c] += sc.w * (r.FG3A ?? 0);
          a.fg3m[c] += sc.w * (r.FG3M ?? 0);
          map.set(r[key], a);
          if (who === 'Player') {
            contestL.fg2a[c] += sc.w * (r.FG2A ?? 0);
            contestL.fg2m[c] += sc.w * (r.FG2M ?? 0);
            contestL.fg3a[c] += sc.w * (r.FG3A ?? 0);
            contestL.fg3m[c] += sc.w * (r.FG3M ?? 0);
          }
        }
      }
    }
  }

  return {
    cur, prev, index, synP, synT, synTD, synLeague, adv, base, age, def, teamAdv, teamFour, matchups, contestP, contestT, contestL,
    leagueTovPct: lgTovN ? lgTov / lgTovN : 0.135,
  };
}

export function heightToIn(h: string | undefined): number {
  if (!h) return 78;
  const m = /(\d+)-(\d+)/.exec(h);
  return m ? Number(m[1]) * 12 + Number(m[2]) : 78;
}

export function groupOfPos(pos: string | undefined, heightIn: number): 'G' | 'W' | 'B' {
  const p = (pos ?? '').toUpperCase();
  if (p.startsWith('C') || p === 'F-C') return 'B';
  if (p === 'G') return heightIn >= 79 ? 'W' : 'G';
  if (p === 'G-F' || p === 'F-G') return 'W';
  if (p === 'F') return heightIn >= 82 ? 'B' : 'W';
  return heightIn >= 82 ? 'B' : heightIn <= 76 ? 'G' : 'W';
}
