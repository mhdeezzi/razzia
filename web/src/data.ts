// Accès aux données de l'app : programme (ESPN via /api/games) et simulations (GitHub via /api/sim).
import type { Summary } from '../../src/nba/engine/montecarlo.ts';
import { TEAMS } from '../../src/nba/teams.ts';

export interface Team {
  tri: string;
  city: string;
  name: string;
  color?: string;
  logo?: string;
  record?: string;
  homeAwayRecord?: string;
  score?: number;
}

export interface Odds {
  provider?: string;
  spreadHome?: number;
  total?: number;
  mlHome?: number;
  mlAway?: number;
  spreadOddsHome?: number;
  spreadOddsAway?: number;
  overOdds?: number;
  underOdds?: number;
}

export interface Game {
  id: string;
  date: string; // date du match à New York (AAAA-MM-JJ)
  start: string; // ISO UTC
  state: 'pre' | 'in' | 'post';
  detail: string;
  seasonType: number;
  note?: string;
  venue?: string;
  city?: string;
  tv: string[];
  home: Team;
  away: Team;
  odds?: Odds;
}

export interface Injury {
  name: string;
  status: string;
  detail: string;
}

export interface Programme {
  generatedAt: string;
  dates: string[];
  games: Game[];
  injuries: Record<string, Injury[]>;
}

export interface TLine {
  id: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  stl: number;
  blk: number;
  tov: number;
  pm: number;
  started: boolean;
}

/** Match typique allégé (src/cli/typicalcompact.ts). */
export interface Typical {
  index: number;
  n: number;
  home: { pts: number; q: number[]; lines: TLine[] };
  away: { pts: number; q: number[]; lines: TLine[] };
  periods: number;
  leadChanges: number;
  largestLead: [number, number]; // [domicile, extérieur]
  players: Array<{ id: number; name: string; side: 0 | 1 }>;
  flow: Array<{ t: number; h: number; a: number; wp?: number }>;
  moments: Array<{ when: string; side?: 0 | 1; text: string; score: string }>;
  shots?: Array<{ x: number; y: number; m: 0 | 1; s: 0 | 1; p?: number; z?: number; c?: number }>;
}

export type Result = Summary & {
  insights?: string[];
  meta?: { dataThrough: string; gamesUsed: number; date: string; builtAt?: string; lineupsConfirmed?: boolean };
  typical?: Typical;
};

export type SimState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'queued' | 'running'; startedAt?: string; url?: string; previous?: Result }
  | { status: 'failed'; url?: string; error?: string }
  | { status: 'done'; result: Result; relaunchFailed?: boolean; url?: string };

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Erreur ${r.status}`);
  return body as T;
}

// Programme gardé 5 minutes dans l'onglet (blessures, cotes et scores bougent pendant la soirée).
let programme: Promise<Programme> | undefined;
let programmeAt = 0;
export function loadProgramme(): Promise<Programme> {
  if (programme && Date.now() - programmeAt > 5 * 60_000) programme = undefined;
  if (!programme) {
    programmeAt = Date.now();
    programme = getJson<Programme>('/api/games?days=7').catch((e) => {
      programme = undefined;
      throw e;
    });
  }
  return programme;
}

export const simKey = (g: { date: string; away: { tri: string }; home: { tri: string } }) => `${g.date}_${g.away.tri}@${g.home.tri}`;
export const matchPath = (g: Game) => `/match/${g.date}/${g.away.tri}-${g.home.tri}`;

export interface SimEntry {
  dir: string;
  pHome: number;
  pAway: number;
  at: string;
  cat?: string; // équipe victime d'un chat noir dans ce match
  gp?: number; // matchs joués par l'équipe qui en a le moins
  trend?: { home?: 'up' | 'down'; away?: 'up' | 'down' }; // équipe en pleine montée ou en baisse
  hot?: { id: number; side: 0 | 1; name: string }; // joueur le plus chaud (side 0 : domicile)
  injured?: Array<{ side: 'home' | 'away'; name: string }>; // stars du cinq de départ absentes (avertissement)
}
let sims: Promise<Map<string, SimEntry>> | undefined;
/** `bust` contourne le cache du CDN (20 s) : sert juste après une publication. */
export function listSims(fresh = false, bust = false): Promise<Map<string, SimEntry>> {
  if (fresh || !sims)
    sims = getJson<{ sims: SimEntry[] }>(`/api/sim?list=1${bust ? `&v=${Date.now()}` : ''}`)
      .then((j) => new Map(j.sims.map((e) => [e.dir, e])))
      .catch(() => new Map());
  return sims;
}

export function simStatus(g: Game, req?: string): Promise<SimState> {
  const q = new URLSearchParams({ date: g.date, away: g.away.tri, home: g.home.tri });
  if (req) q.set('req', req);
  return getJson<SimState>(`/api/sim?${q}`);
}

export async function startSim(g: Game): Promise<string> {
  const j = await getJson<{ req: string }>('/api/sim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: g.date, away: g.away.tri, home: g.home.tri }),
  });
  return j.req;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed';
/** État de plusieurs demandes en un seul appel (simulation de toute une soirée). */
export function simRuns(reqs: string[]): Promise<{ runs: Record<string, { status: RunStatus; startedAt?: string; url?: string }>; actions: string }> {
  return getJson(`/api/sim?reqs=${reqs.join(',')}`);
}

// Demande en cours, gardée dans le navigateur pour reprendre le suivi après un rechargement.
export interface Pending {
  req: string;
  at: number;
}
export const pending = {
  get(key: string): Pending | undefined {
    try {
      const v = JSON.parse(localStorage.getItem(`sim:${key}`) ?? 'null');
      return v && Date.now() - v.at < 2 * 3600e3 ? v : undefined;
    } catch {
      return undefined;
    }
  },
  set(key: string, p: Pending) {
    try {
      localStorage.setItem(`sim:${key}`, JSON.stringify(p));
    } catch {
      /* stockage indisponible : le suivi s'arrête au rechargement */
    }
  },
  clear(key: string) {
    try {
      localStorage.removeItem(`sim:${key}`);
    } catch {
      /* idem */
    }
  },
};

// Logos servis par ESPN, qui utilise ses propres codes pour quelques franchises.
const ESPN_CODE: Record<string, string> = { GSW: 'gs', NYK: 'ny', SAS: 'sa', NOP: 'no', UTA: 'utah', WAS: 'wsh' };
export const teamLogo = (tri: string) => `https://a.espncdn.com/i/teamlogos/nba/500/${ESPN_CODE[tri] ?? tri.toLowerCase()}.png`;

export const teamColor = (t: { tri: string; color?: string }) => TEAMS.find((x) => x.tri === t.tri)?.color ?? t.color ?? '#3a3d44';

// Formats (fr-FR).
const pctFmt = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct0Fmt = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
const n1Fmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const pct = (v: number) => pctFmt.format(v);
export const pct0 = (v: number) => pct0Fmt.format(v);
export const n1 = (v: number) => n1Fmt.format(v);
export const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '-' : '') + n1Fmt.format(Math.abs(v)).replace(/,0$/, '');
export const line = (v: number) => n1Fmt.format(v).replace(/,0$/, '');
/** Cote décimale (format européen) à partir d'une cote américaine. */
export const decimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
export const odds = (a?: number) => (a == null ? '-' : decimal(a).toFixed(2).replace('.', ','));
export const impliedFromAmerican = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
/** Probabilités sans marge d'un marché à deux issues (cotes américaines). */
export function noVig(a?: number, b?: number): [number, number] | undefined {
  if (a == null || b == null) return undefined;
  const pa = impliedFromAmerican(a);
  const pb = impliedFromAmerican(b);
  return [pa / (pa + pb), pb / (pa + pb)];
}

export const timeLocal = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const localDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
const atNoon = (d: string) => new Date(`${d}T12:00:00`);
export const dayShort = (d: string) => atNoon(d).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
export const dayNum = (d: string) => atNoon(d).getDate();
export const dayLong = (d: string) => atNoon(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
export const isToday = (d: string) => d === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
