// cdn.nba.com : calendrier, play-by-play (avec coordonnées de tir, passeur, contreur, intercepteur, faute provoquée)
// et box scores. Le PBP est compacté avant mise en cache pour limiter le disque.
import { createHash } from 'node:crypto';
import { fetchJson, readCache, writeCache, HttpError } from './http.ts';

const CDN = 'https://cdn.nba.com/static/json';

export interface Act {
  n: number; // actionNumber
  p: number; // période
  c: number; // secondes restantes dans la période
  tm?: number; // teamId de l'action
  at: string; // actionType
  st?: string; // subType
  ds?: string; // descriptor
  q?: string[]; // qualifiers
  pid?: number;
  x?: number; // xLegacy (dixièmes de pied, panier = 0, latéral)
  y?: number; // yLegacy (dixièmes de pied depuis le panier vers le milieu de terrain)
  ar?: string; // zone officielle (2025-26+)
  dist?: number;
  res?: 0 | 1; // tir réussi ?
  ast?: number;
  blk?: number;
  stl?: number;
  fd?: number; // faute provoquée par
  sh?: number; // shotActionNumber (rebond -> tir)
  pos?: number; // équipe en possession
  hs: number;
  as: number;
}

export interface BoxPlayer {
  id: number;
  name: string;
  nameI: string;
  jersey: string;
  pos?: string;
  starter: boolean;
  sec: number;
  status: string;
  reason?: string;
  stats: Record<string, number>;
}

export interface BoxTeam {
  id: number;
  tri: string;
  name: string;
  city: string;
  score: number;
  periods: number[];
  players: BoxPlayer[];
}

export interface GameRecord {
  gameId: string;
  date: string; // YYYY-MM-DD (date locale US du match)
  home: BoxTeam;
  away: BoxTeam;
  actions: Act[];
  officials?: Official[];
}

export interface Official {
  id: number;
  name: string;
}
const officialsOfBox = (g: any): Official[] => (g?.officials ?? []).map((o: any) => ({ id: o.personId, name: o.name }));

/**
 * Arbitres d'un match terminé : enregistrés avec le match, ou retrouvés dans la feuille de match brute gardée en cache
 * (matchs téléchargés avant que les arbitres ne soient conservés).
 */
export function officialsOf(g: GameRecord): Official[] | undefined {
  if (g.officials?.length) return g.officials;
  const url = `${CDN}/liveData/boxscore/boxscore_${g.gameId}.json`;
  const raw = readCache<any>('tmp', createHash('sha1').update(url).digest('hex'));
  const o = officialsOfBox(raw?.game);
  return o.length ? o : undefined;
}

/** Arbitres désignés pour un match à venir, s'ils figurent déjà sur la feuille de match en direct (cdn.nba.com). */
export async function upcomingOfficials(gameId: string): Promise<Official[] | undefined> {
  try {
    const box = await fetchJson<any>(`${CDN}/liveData/boxscore/boxscore_${gameId}.json`, { ttlHours: 0.5, namespace: 'pregame', retries: 1 });
    const o = officialsOfBox(box?.game);
    return o.length ? o : undefined;
  } catch {
    return undefined;
  }
}

export function clockToSec(clock: string): number {
  const m = /PT(\d+)M([\d.]+)S/.exec(clock);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function compact(a: any): Act {
  const o: Act = { n: a.actionNumber, p: a.period, c: clockToSec(a.clock), at: a.actionType, hs: Number(a.scoreHome) || 0, as: Number(a.scoreAway) || 0 };
  if (a.teamId) o.tm = a.teamId;
  if (a.subType) o.st = a.subType;
  if (a.descriptor) o.ds = a.descriptor;
  if (a.qualifiers?.length) o.q = a.qualifiers;
  if (a.personId) o.pid = a.personId;
  if (a.xLegacy != null) o.x = a.xLegacy;
  if (a.yLegacy != null) o.y = a.yLegacy;
  if (a.area) o.ar = a.area;
  if (a.shotDistance != null) o.dist = Math.round(a.shotDistance * 10) / 10;
  if (a.shotResult) o.res = a.shotResult === 'Made' ? 1 : 0;
  if (a.assistPersonId) o.ast = a.assistPersonId;
  if (a.blockPersonId) o.blk = a.blockPersonId;
  if (a.stealPersonId) o.stl = a.stealPersonId;
  if (a.foulDrawnPersonId) o.fd = a.foulDrawnPersonId;
  if (a.shotActionNumber) o.sh = a.shotActionNumber;
  if (a.possession) o.pos = a.possession;
  return o;
}

function boxTeam(t: any): BoxTeam {
  return {
    id: t.teamId, tri: t.teamTricode, name: t.teamName, city: t.teamCity, score: t.score,
    periods: (t.periods ?? []).map((p: any) => p.score),
    players: (t.players ?? []).map((p: any): BoxPlayer => ({
      id: p.personId, name: p.name, nameI: p.nameI, jersey: p.jerseyNum ?? '', pos: p.position,
      starter: p.starter === '1' || p.starter === 1, sec: clockToSec(p.statistics?.minutes ?? 'PT0M0S'),
      status: p.status, reason: p.notPlayingReason,
      stats: Object.fromEntries(Object.entries(p.statistics ?? {}).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
    })),
  };
}

/** Récupère un match terminé (PBP + box score). Retourne undefined si indisponible. Permanent en cache une fois terminé. */
export async function getGame(gameId: string, opts: { force?: boolean; ns?: string } = {}): Promise<GameRecord | undefined> {
  const ns = opts.ns ?? 'games';
  if (!opts.force) {
    const c = readCache<GameRecord>(ns, gameId);
    if (c) return c;
  }
  try {
    const [pbp, box] = await Promise.all([
      fetchJson<any>(`${CDN}/liveData/playbyplay/playbyplay_${gameId}.json`, { ttlHours: 0, namespace: 'tmp' }),
      fetchJson<any>(`${CDN}/liveData/boxscore/boxscore_${gameId}.json`, { ttlHours: 0, namespace: 'tmp' }),
    ]);
    const g = box.game;
    if (g.gameStatus !== 3) return undefined; // pas encore terminé
    const rec: GameRecord = {
      gameId,
      date: String(g.gameEt ?? g.gameTimeLocal ?? '').slice(0, 10),
      home: boxTeam(g.homeTeam),
      away: boxTeam(g.awayTeam),
      actions: pbp.game.actions.map(compact),
      officials: officialsOfBox(g),
    };
    writeCache(ns, gameId, rec);
    return rec;
  } catch (e) {
    if (e instanceof HttpError) return undefined;
    throw e;
  }
}

export interface SchedGame {
  gameId: string;
  date: string; // YYYY-MM-DD
  timeUTC: string;
  status: number;
  home: { id: number; tri: string; name: string; city: string };
  away: { id: number; tri: string; name: string; city: string };
  nationalTv: boolean; // diffusé à la télévision nationale (les stars ne peuvent pas y être mises au repos)
}

export async function getSchedule(ttlHours = 6): Promise<{ season: string; games: SchedGame[] }> {
  const s = await fetchJson<any>(`${CDN}/staticData/scheduleLeagueV2.json`, { ttlHours, namespace: 'schedule', cacheKey: 'current' });
  const games: SchedGame[] = [];
  for (const d of s.leagueSchedule.gameDates) {
    for (const g of d.games) {
      const [mm, dd, yyyy] = d.gameDate.slice(0, 10).split('/');
      games.push({
        gameId: g.gameId, date: `${yyyy}-${mm}-${dd}`, timeUTC: g.gameDateTimeUTC, status: g.gameStatus,
        home: { id: g.homeTeam.teamId, tri: g.homeTeam.teamTricode, name: g.homeTeam.teamName, city: g.homeTeam.teamCity },
        away: { id: g.awayTeam.teamId, tri: g.awayTeam.teamTricode, name: g.awayTeam.teamName, city: g.awayTeam.teamCity },
        nationalTv: (g.broadcasters?.nationalBroadcasters ?? []).some((b: any) => b.broadcasterMedia === 'tv') || (g.broadcasters?.nationalOttBroadcasters ?? []).length > 0,
      });
    }
  }
  return { season: s.leagueSchedule.seasonYear, games };
}
