// Données en direct : lecture des sources publiques et mise au format du moteur live (src/live/foot.ts, nba.ts, tennis.ts).
//   Foot   : FotMob (liste du jour, puis fiche du match : minute, buts, rouges, tirs avec xG, statistiques, momentum)
//   NBA    : ESPN (tableau du soir, puis fiche : play-by-play, stats d'équipe, cotes DraftKings d'avant-match)
//   Tennis : ESPN (tableau du tournoi : sets et jeux en cours). Pas de points, de serveur ni de statistiques chez ESPN.
// Chaque appel a un délai maximal, une nouvelle tentative et un cache en mémoire (une instance sert beaucoup de visiteurs
// sans relancer la source à chaque requête). Les erreurs remontent en clair : la page affiche alors le dernier état connu.
import type { FootTimeline, Side } from './foot.ts';
import type { NbaState } from './nba.ts';
import type { TennisState } from './tennis.ts';

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', Accept: 'application/json' };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

// ---------------------------------------------------------------------------------------------------------------------
// Client : délai, nouvelle tentative, cache court, requêtes identiques regroupées.
const cache = new Map<string, { at: number; v: unknown }>();
const pending = new Map<string, Promise<unknown>>();

export async function getJson<T>(url: string, ttlMs: number, tries = 2): Promise<T> {
  const c = cache.get(url);
  if (c && Date.now() - c.at < ttlMs) return c.v as T;
  const p = pending.get(url);
  if (p) return p as Promise<T>;
  const run = (async () => {
    let err: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`${new URL(url).host} : ${r.status}`);
        const v = await r.json();
        cache.set(url, { at: Date.now(), v });
        if (cache.size > 500) for (const k of [...cache.keys()].slice(0, 100)) cache.delete(k);
        return v as T;
      } catch (e) {
        err = e;
        if (i < tries - 1) await new Promise((res) => setTimeout(res, 400 * (i + 1)));
      }
    }
    // Source en panne : dernier état connu s'il n'est pas trop vieux (5 minutes).
    if (c && Date.now() - c.at < 300_000) return c.v as T;
    throw err;
  })();
  pending.set(url, run);
  try { return await run; } finally { pending.delete(url); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Foot (FotMob)
export interface FootListItem { id: number; league: string; leagueId: number; home: string; away: string; homeId: number; awayId: number; score: [number, number]; minute: number; clock: string; reds: [number, number]; state: 'live' | 'ht' }

const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');
/** Minute jouée à partir de l'horloge FotMob (« 67’ », « 45+2’ », « HT ») : 45e et 90e comprennent le temps additionnel. */
export function fotmobMinute(st: any): number {
  const lt = st?.liveTime;
  const s = String(lt?.short ?? '').replace(/[^\d+A-Za-z]/g, '');
  if (/^HT$/i.test(s) || st?.reason?.short === 'HT') return 45;
  const m = s.match(/^(\d+)(?:\+(\d+))?/);
  if (m) return Math.min(90, Number(m[1]));
  const long = String(lt?.long ?? '').match(/^(\d+):/);
  return long ? Math.min(90, Number(long[1]) + 1) : 0;
}

export async function fotmobLive(now = new Date()): Promise<FootListItem[]> {
  // Matchs commencés la veille (UTC) encore en cours après minuit : deux jours lus.
  const days = [new Date(now.getTime() - 86_400_000), now];
  const lists = await Promise.all(days.map((d) => getJson<any>(`https://www.fotmob.com/api/data/matches?date=${ymd(d)}`, 20_000).catch(() => ({ leagues: [] }))));
  const out = new Map<number, FootListItem>();
  for (const l of lists.flatMap((x) => x.leagues ?? [])) for (const m of l.matches ?? []) {
    const st = m.status ?? {};
    if (!st.started || st.finished || st.cancelled) continue;
    const ht = st.reason?.short === 'HT' || /HT/.test(String(st.liveTime?.short ?? ''));
    out.set(m.id, {
      id: m.id, league: l.name, leagueId: l.primaryId ?? l.id, home: m.home?.name, away: m.away?.name, homeId: m.home?.id, awayId: m.away?.id,
      score: [Number(m.home?.score) || 0, Number(m.away?.score) || 0], minute: fotmobMinute(st), clock: String(st.liveTime?.short ?? '').replace(/[‎]/g, ''),
      reds: [Number(st.numberOfHomeRedCards) || 0, Number(st.numberOfAwayRedCards) || 0], state: ht ? 'ht' : 'live',
    });
  }
  return [...out.values()];
}

export interface FootDetail {
  id: number;
  league: string;
  home: { id: number; name: string };
  away: { id: number; name: string };
  state: 'pre' | 'live' | 'ht' | 'post';
  clock: string;
  timeline: FootTimeline;
  /** Statistiques du match (domicile, extérieur) : possession, tirs, tirs cadrés, grosses occasions, corners, fautes… */
  stats: Record<string, [number, number]>;
  /** Courbe de domination minute par minute de FotMob (positif : domicile). */
  momentum: Array<[number, number]>;
  xg: [number, number];
}

const STAT: Record<string, string> = {
  'Ball possession': 'poss', 'Total shots': 'shots', 'Shots on target': 'sot', 'Big chances': 'bigc', 'Big chances missed': 'bigcm', 'Corners': 'corners',
  'Fouls committed': 'fouls', 'Yellow cards': 'yellow', 'Red cards': 'red', 'Expected goals (xG)': 'xg', 'Touches in opposition box': 'tbox', 'Accurate passes': 'accp',
  'Offsides': 'offsides', 'Keeper saves': 'saves', 'Duels won': 'duels', 'Hit woodwork': 'wood', 'Shots inside box': 'sibox',
};
const num = (v: unknown) => { const n = parseFloat(String(v ?? '').replace('%', '').replace(/\s*\(.*$/, '')); return Number.isFinite(n) ? n : NaN; };

export async function fotmobMatch(id: number): Promise<FootDetail> {
  const d = await getJson<any>(`https://www.fotmob.com/api/data/matchDetails?matchId=${id}`, 15_000);
  const h = d.header ?? {}, st = h.status ?? {}, c = d.content ?? {};
  const teams = h.teams ?? [];
  const homeId = Number(teams[0]?.id);
  const state: FootDetail['state'] = st.finished ? 'post' : !st.started ? 'pre' : st.reason?.short === 'HT' || /HT/.test(String(st.liveTime?.short ?? '')) ? 'ht' : 'live';
  const minute = state === 'post' ? 90 : state === 'pre' ? 0 : fotmobMinute(st);
  const goals: Array<[number, Side]> = [], reds: Array<[number, Side]> = [];
  for (const e of c.matchFacts?.events?.events ?? []) {
    if (e.isPenaltyShootoutEvent) continue;
    const side: Side = e.isHome ? 0 : 1;
    const m = Math.max(1, Math.min(90, Number(e.time) || 1));
    if (e.type === 'Goal') goals.push([m, side]);
    if (e.type === 'Card' && /red/i.test(String(e.card ?? ''))) reds.push([m, side]);
  }
  const shots: Array<[number, Side, number]> = (c.shotmap?.shots ?? []).map((s: any) => [Math.max(1, Math.min(90, Number(s.min) || 1)), Number(s.teamId) === homeId ? 0 : 1, Number(s.expectedGoals) || 0]);
  const stats: Record<string, [number, number]> = {};
  for (const p of c.stats?.Periods?.All?.stats ?? []) for (const s of p.stats ?? []) {
    const k = STAT[s.title];
    const pair = s.stats;
    if (k && Array.isArray(pair) && !stats[k]) { const a = num(pair[0]), b = num(pair[1]); if (Number.isFinite(a) && Number.isFinite(b)) stats[k] = [a, b]; }
  }
  const xg: [number, number] = [0, 0];
  for (const [, s, x] of shots) xg[s] += x;
  const momentum: Array<[number, number]> = (c.momentum?.main?.data ?? []).map((p: any) => [Number(p.minute), Number(p.value)]);
  return {
    id, league: String(h.leagueName ?? c.matchFacts?.infoBox?.Tournament?.leagueName ?? ''),
    home: { id: homeId, name: teams[0]?.name }, away: { id: Number(teams[1]?.id), name: teams[1]?.name },
    state, clock: String(st.liveTime?.short ?? st.reason?.short ?? '').replace(/[‎]/g, ''),
    timeline: { minute, goals, reds, shots }, stats, momentum, xg,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// NBA (ESPN)
/** Abréviations ESPN -> NBA (celles des simulations Razzia). */
const NBA_TRI: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX', BRK: 'BKN' };
export const nbaTri = (a: string) => NBA_TRI[a] ?? a;

export interface NbaListItem { id: string; home: string; away: string; score: [number, number]; period: number; clock: string; state: 'pre' | 'in' | 'post'; espnHomeWin?: number; date: string }

/** Date du match à New York (les simulations Razzia sont rangées par date américaine). */
export const usDate = (iso: string) => new Date(new Date(iso).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

export async function espnNbaBoard(date?: string): Promise<NbaListItem[]> {
  const d = await getJson<any>(`${ESPN}/basketball/nba/scoreboard${date ? `?dates=${date.replaceAll('-', '')}` : ''}`, 15_000);
  return (d.events ?? []).map((e: any) => {
    const c = e.competitions?.[0] ?? {};
    const H = c.competitors?.find((x: any) => x.homeAway === 'home'), A = c.competitors?.find((x: any) => x.homeAway === 'away');
    return {
      id: String(e.id), home: nbaTri(H?.team?.abbreviation ?? ''), away: nbaTri(A?.team?.abbreviation ?? ''),
      score: [Number(H?.score) || 0, Number(A?.score) || 0], period: Number(e.status?.period) || 0, clock: String(e.status?.displayClock ?? ''),
      state: e.status?.type?.state ?? 'pre', espnHomeWin: c.situation?.lastPlay?.probability?.homeWinPercentage, date: usDate(e.date),
    } as NbaListItem;
  });
}

export interface NbaDetail {
  id: string; home: string; away: string; date: string; state: 'pre' | 'in' | 'post'; period: number; clock: string;
  st: NbaState;
  /** Écart (domicile - extérieur) et total d'avant-match chez DraftKings, si ESPN les donne. */
  market?: { spread: number; total: number };
  /** Statistiques d'équipe (domicile, extérieur). */
  stats: Record<string, [number, number]>;
  espnHomeWin?: number;
  /** Fil des actions marquantes (dernières en premier). */
  plays: Array<{ t: number; text: string; score: [number, number]; scoring: boolean }>;
}

const clockSec = (s: string) => { const m = String(s).match(/^(\d+):(\d+)(?:\.(\d+))?$/); return m ? Number(m[1]) * 60 + Number(m[2]) : Number(s) || 0; };
const elapsedOf = (period: number, clock: string) => (period <= 4 ? (period - 1) * 12 + (12 - clockSec(clock) / 60) : 48);

export async function espnNbaGame(id: string): Promise<NbaDetail> {
  const d = await getJson<any>(`${ESPN}/basketball/nba/summary?event=${id}`, 10_000);
  const comp = d.header?.competitions?.[0] ?? {};
  const H = comp.competitors?.find((x: any) => x.homeAway === 'home'), A = comp.competitors?.find((x: any) => x.homeAway === 'away');
  const homeTeamId = String(H?.team?.id ?? H?.id);
  const status = comp.status ?? {};
  const period = Number(status.period) || 0, clock = String(status.displayClock ?? '12:00');
  const state = status.type?.state ?? 'pre';
  const plays = (d.plays ?? []) as any[];
  // Stats d'équipe : boxscore.teams (l'ordre n'est pas garanti : rangées par identifiant).
  const stats: Record<string, [number, number]> = {};
  const fg3: [[number, number], [number, number]] = [[0, 0], [0, 0]], ft: [[number, number], [number, number]] = [[0, 0], [0, 0]];
  for (const t of d.boxscore?.teams ?? []) {
    const side = String(t.team?.id) === homeTeamId ? 0 : 1;
    for (const s of t.statistics ?? []) {
      const v = String(s.displayValue ?? '');
      const mm = v.match(/^(\d+)-(\d+)$/);
      if (s.name === 'threePointFieldGoalsMade-threePointFieldGoalsAttempted' && mm) fg3[side] = [Number(mm[1]), Number(mm[2])];
      if (s.name === 'freeThrowsMade-freeThrowsAttempted' && mm) ft[side] = [Number(mm[1]), Number(mm[2])];
      const n = Number(v);
      if (!mm && Number.isFinite(n)) (stats[s.name] ??= [0, 0])[side] = n;
    }
  }
  const e = state === 'post' ? 48 : state === 'pre' ? 0 : elapsedOf(period, clock);
  // Écart il y a 5 minutes, fautes d'équipe du quart-temps en cours, équipe qui vient de jouer (possession approchée).
  let diff5: number | undefined;
  const fouls: [number, number] = [0, 0];
  let possession: 0 | 1 | undefined;
  for (const p of plays) {
    const t = elapsedOf(Number(p.period?.number) || 1, p.clock?.displayValue ?? '12:00');
    if (t <= e - 5) diff5 = Number(p.homeScore) - Number(p.awayScore);
    if (Number(p.period?.number) === period && /foul/i.test(p.type?.text ?? '') && !/offensive|technical/i.test(p.type?.text ?? '')) {
      const side = String(p.team?.id) === homeTeamId ? 0 : 1;
      fouls[side]++;
    }
  }
  const last = plays.at(-1);
  if (last?.team?.id) {
    const by = String(last.team.id) === homeTeamId ? 0 : 1;
    // Après un panier, une perte de balle ou un rebond défensif adverse, le ballon change de camp.
    const flips = last.scoringPlay || /turnover|defensive rebound/i.test(last.type?.text ?? '');
    possession = (flips ? (1 - by) : by) as 0 | 1;
  }
  const pc = (d.pickcenter ?? [])[0];
  const market = pc && Number.isFinite(Number(pc.spread)) ? { spread: -Number(pc.spread), total: Number(pc.overUnder) || 225 } : undefined;
  const score: [number, number] = [Number(H?.score) || 0, Number(A?.score) || 0];
  return {
    id, home: nbaTri(H?.team?.abbreviation ?? ''), away: nbaTri(A?.team?.abbreviation ?? ''), date: usDate(comp.date ?? d.header?.competitions?.[0]?.date ?? new Date().toISOString()),
    state, period, clock,
    st: { elapsed: e, score, fg3, ft, diff5: e >= 5 ? diff5 ?? 0 : undefined, possession, fouls },
    market, stats, espnHomeWin: d.winprobability?.at?.(-1)?.homeWinPercentage,
    plays: plays.filter((p) => p.scoringPlay || /timeout|end period|foul/i.test(p.type?.text ?? '')).slice(-40).reverse()
      .map((p) => ({ t: elapsedOf(Number(p.period?.number) || 1, p.clock?.displayValue ?? '12:00'), text: String(p.text ?? ''), score: [Number(p.homeScore), Number(p.awayScore)] as [number, number], scoring: !!p.scoringPlay })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Tennis (ESPN) : sets terminés et jeux du set en cours.
export interface TennisLiveItem {
  id: string; tourney: string; round: string; state: 'pre' | 'in' | 'post';
  /** Joueurs dans l'ordre ESPN (A puis B). */
  players: [string, string];
  st: TennisState;
  detail: string;
}

const SLAMS = /australian open|roland garros|french open|wimbledon|us open/i;

export async function espnTennisLive(tour: 'atp' | 'wta' = 'atp'): Promise<TennisLiveItem[]> {
  const d = await getJson<any>(`${ESPN}/tennis/${tour}/scoreboard`, 15_000);
  const out: TennisLiveItem[] = [];
  for (const ev of d.events ?? []) for (const g of ev.groupings ?? []) {
    if (!/singles/i.test(g.grouping?.displayName ?? 'singles')) continue;
    for (const c of g.competitions ?? []) {
      const state = c.status?.type?.state ?? 'pre';
      if (state === 'pre') continue;
      const ps = [...(c.competitors ?? [])].sort((x: any, y: any) => (x.order ?? 0) - (y.order ?? 0));
      if (ps.length !== 2) continue;
      const bestOf: 3 | 5 = SLAMS.test(ev.name ?? '') && tour === 'atp' ? 5 : 3;
      const la = (ps[0].linescores ?? []) as any[], lb = (ps[1].linescores ?? []) as any[];
      const n = Math.max(la.length, lb.length);
      const sets: Array<[number, number]> = [];
      let games: [number, number] | undefined;
      for (let i = 0; i < n; i++) {
        const a = Number(la[i]?.value) || 0, b = Number(lb[i]?.value) || 0;
        const done = la[i]?.winner || lb[i]?.winner || (state === 'post') || (Math.max(a, b) >= 6 && Math.abs(a - b) >= 2) || Math.max(a, b) === 7;
        if (done && i < n - 1) sets.push([a, b]);
        else if (done && state === 'post') sets.push([a, b]);
        else if (done && (la[i]?.winner || lb[i]?.winner)) sets.push([a, b]);
        else games = [a, b];
      }
      out.push({
        id: String(c.id), tourney: String(ev.name ?? ''), round: String(c.round?.displayName ?? ''), state,
        players: [ps[0].athlete?.displayName ?? '', ps[1].athlete?.displayName ?? ''],
        st: { bestOf, sets, games }, detail: String(c.status?.type?.detail ?? ''),
      });
    }
  }
  return out;
}
