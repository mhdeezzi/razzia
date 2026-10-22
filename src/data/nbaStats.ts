// Accès aux endpoints stats.nba.com (tracking, Synergy, matchups, passes, stats avancées).
import { fetchJson } from './http.ts';

export type Row = Record<string, any>;
export type ResultSets = Record<string, Row[]>;

const BASE = 'https://stats.nba.com/stats/';

export const SEASON_TYPES = {
  regular: 'Regular Season',
  playoffs: 'Playoffs',
  playin: 'PlayIn',
} as const;

function toRows(rs: { name: string; headers: any; rowSet: any[][] }): Row[] {
  let headers: string[];
  if (Array.isArray(rs.headers) && typeof rs.headers[0] === 'string') headers = rs.headers;
  else {
    // En-têtes multi-niveaux (ex. shot locations) : on aplatit "GROUPE_COLONNE".
    const levels = rs.headers as Array<{ columnNames: string[]; columnSpan?: number; columnsToSkip?: number }>;
    const top = levels[0];
    const bottom = levels[levels.length - 1].columnNames;
    headers = bottom.slice();
    if (levels.length > 1) {
      const skip = top.columnsToSkip ?? 0;
      const span = top.columnSpan ?? 1;
      for (let i = skip; i < bottom.length; i++) {
        const g = top.columnNames[Math.floor((i - skip) / span)];
        if (g) headers[i] = `${g}__${bottom[i]}`;
      }
    }
  }
  return rs.rowSet.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

export async function statsCall(endpoint: string, params: Record<string, string | number>, ttlHours = 12): Promise<ResultSets> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const url = `${BASE}${endpoint}?${qs}`;
  const body = await fetchJson<any>(url, { ttlHours, namespace: `stats/${endpoint}`, cacheKey: qs, timeoutMs: 90_000 });
  const sets = body.resultSets ?? (body.resultSet ? [body.resultSet] : []);
  const out: ResultSets = {};
  for (const s of Array.isArray(sets) ? sets : [sets]) out[s.name] = toRows(s);
  return out;
}

/** TTL : saison terminée => permanent ; saison en cours => 6 h. */
export function ttlFor(season: string, currentSeason: string): number {
  return season === currentSeason ? 6 : Infinity;
}

const DASH_DEFAULTS = {
  College: '', Conference: '', Country: '', DateFrom: '', DateTo: '', Division: '', DraftPick: '', DraftYear: '',
  GameScope: '', GameSegment: '', Height: '', ISTRound: '', LastNGames: 0, LeagueID: '00', Location: '', Month: 0,
  OpponentTeamID: 0, Outcome: '', PORound: 0, PaceAdjust: 'N', Period: 0, PlayerExperience: '', PlayerPosition: '',
  PlusMinus: 'N', Rank: 'N', SeasonSegment: '', ShotClockRange: '', StarterBench: '', TeamID: 0, TwoWay: 0,
  VsConference: '', VsDivision: '', Weight: '',
};

export async function teamGameLog(season: string, seasonType: string, ttl: number): Promise<Row[]> {
  const r = await statsCall('leaguegamelog', {
    Counter: 0, DateFrom: '', DateTo: '', Direction: 'ASC', LeagueID: '00', PlayerOrTeam: 'T',
    Season: season, SeasonType: seasonType, Sorter: 'DATE',
  }, ttl);
  return r.LeagueGameLog ?? [];
}

export async function playerDash(season: string, seasonType: string, measure: 'Base' | 'Advanced' | 'Misc' | 'Usage', ttl: number, extra: Record<string, string | number> = {}): Promise<Row[]> {
  const r = await statsCall('leaguedashplayerstats', {
    ...DASH_DEFAULTS, MeasureType: measure, PerMode: 'Totals', Season: season, SeasonType: seasonType, ...extra,
  }, ttl);
  return r.LeagueDashPlayerStats ?? [];
}

export async function teamDash(season: string, seasonType: string, measure: 'Base' | 'Advanced' | 'Four Factors' | 'Opponent' | 'Misc', ttl: number, extra: Record<string, string | number> = {}): Promise<Row[]> {
  const r = await statsCall('leaguedashteamstats', {
    ...DASH_DEFAULTS, MeasureType: measure, PerMode: 'Totals', Season: season, SeasonType: seasonType, ...extra,
  }, ttl);
  return r.LeagueDashTeamStats ?? [];
}

export const PLAY_TYPES = [
  'Transition', 'Isolation', 'PRBallHandler', 'PRRollman', 'Postup', 'Spotup', 'Handoff', 'Cut', 'OffScreen', 'OffRebound', 'Misc',
] as const;
export type PlayType = (typeof PLAY_TYPES)[number];

export async function synergy(season: string, seasonType: string, playType: PlayType, who: 'P' | 'T', grouping: 'offensive' | 'defensive', ttl: number): Promise<Row[]> {
  const r = await statsCall('synergyplaytypes', {
    LeagueID: '00', PerMode: 'Totals', PlayType: playType, PlayerOrTeam: who,
    SeasonType: seasonType, SeasonYear: season, TypeGrouping: grouping,
  }, ttl);
  return r.SynergyPlayType ?? [];
}

export const DEFENSE_CATEGORIES = ['Overall', '3 Pointers', '2 Pointers', 'Less Than 6Ft', 'Less Than 10Ft', 'Greater Than 15Ft'] as const;
export type DefenseCategory = (typeof DEFENSE_CATEGORIES)[number];

export async function ptDefend(season: string, seasonType: string, category: DefenseCategory, ttl: number): Promise<Row[]> {
  const r = await statsCall('leaguedashptdefend', {
    ...DASH_DEFAULTS, DefenseCategory: category, PerMode: 'Totals', Season: season, SeasonType: seasonType,
  }, ttl);
  return r.LeagueDashPTDefend ?? [];
}

export async function ptStats(season: string, seasonType: string, measure: 'CatchShoot' | 'PullUpShot' | 'Drives' | 'Passing' | 'Rebounding' | 'Defense' | 'Possessions', who: 'Player' | 'Team', ttl: number): Promise<Row[]> {
  const r = await statsCall('leaguedashptstats', {
    ...DASH_DEFAULTS, PerMode: 'Totals', PlayerOrTeam: who, PtMeasureType: measure, Season: season, SeasonType: seasonType,
  }, ttl);
  return r.LeagueDashPtStats ?? [];
}

/** Niveaux de contestation (distance du défenseur le plus proche au moment du tir). */
export const CLOSE_DEF = ['0-2 Feet - Very Tight', '2-4 Feet - Tight', '4-6 Feet - Open', '6+ Feet - Wide Open'] as const;

/** Tirs par distance du défenseur le plus proche : par joueur (attaque) ou concédés par équipe (défense). */
export async function closeDefShots(season: string, seasonType: string, range: (typeof CLOSE_DEF)[number], who: 'Player' | 'Opp', ttl: number): Promise<Row[]> {
  const r = await statsCall(who === 'Player' ? 'leaguedashplayerptshot' : 'leaguedashoppptshot', {
    ...DASH_DEFAULTS, CloseDefDistRange: range, DribbleRange: '', GeneralRange: '', ShotClockRange: '', ShotDistRange: '', TouchTimeRange: '',
    PerMode: 'Totals', Season: season, SeasonType: seasonType,
  }, ttl);
  return Object.values(r)[0] ?? [];
}

export async function seasonMatchups(season: string, seasonType: string, ttl: number, filt: { offTeam?: number; defTeam?: number; offPlayer?: number; defPlayer?: number }): Promise<Row[]> {
  const r = await statsCall('leagueseasonmatchups', {
    DefPlayerID: filt.defPlayer ?? '', DefTeamID: filt.defTeam ?? '', LeagueID: '00',
    OffPlayerID: filt.offPlayer ?? '', OffTeamID: filt.offTeam ?? '', PerMode: 'Totals', Season: season, SeasonType: seasonType,
  }, ttl);
  return r.SeasonMatchups ?? [];
}

export async function playerPasses(season: string, seasonType: string, playerId: number, ttl: number): Promise<{ made: Row[]; received: Row[] }> {
  const r = await statsCall('playerdashptpass', {
    DateFrom: '', DateTo: '', GameSegment: '', LastNGames: 0, LeagueID: '00', Location: '', Month: 0, OpponentTeamID: 0,
    Outcome: '', PORound: 0, PerMode: 'Totals', Period: 0, PlayerID: playerId, Season: season, SeasonSegment: '',
    SeasonType: seasonType, TeamID: 0, VsConference: '', VsDivision: '',
  }, ttl);
  return { made: r.PassesMade ?? [], received: r.PassesReceived ?? [] };
}

export async function playerIndex(season: string, ttl: number): Promise<Row[]> {
  const r = await statsCall('playerindex', {
    Active: '', AllStar: '', College: '', Country: '', DraftPick: '', DraftRound: '', DraftYear: '', Height: '',
    Historical: 0, LeagueID: '00', Season: season, TeamID: 0, Weight: '',
  }, ttl);
  return r.PlayerIndex ?? [];
}

export async function teamRoster(season: string, teamId: number, ttl: number): Promise<Row[]> {
  const r = await statsCall('commonteamroster', { LeagueID: '00', Season: season, TeamID: teamId }, ttl);
  return r.CommonTeamRoster ?? [];
}

export interface DailyLineup {
  gameId: string;
  home: { teamId: number; starters: Array<{ id: number; status: string; roster: string; pos: string }> };
  away: { teamId: number; starters: Array<{ id: number; status: string; roster: string; pos: string }> };
}

/** Compositions du jour publiées par NBA.com (« Expected » puis « Confirmed »). */
export async function dailyLineups(dateYmd: string): Promise<DailyLineup[]> {
  const d = dateYmd.replaceAll('-', '');
  const { fetchJson: fj } = await import('./http.ts');
  const j = await fj<any>(`https://stats.nba.com/js/data/leaders/00_daily_lineups_${d}.json`, { ttlHours: 0.5, namespace: 'lineups', cacheKey: d }).catch(() => undefined);
  const side = (t: any) => ({
    teamId: t.teamId,
    starters: (t.players ?? []).map((p: any) => ({ id: p.personId, status: p.lineupStatus ?? '', roster: p.rosterStatus ?? '', pos: p.position ?? '' })),
  });
  return (j?.games ?? []).map((g: any) => ({ gameId: g.gameId, home: side(g.homeTeam), away: side(g.awayTeam) }));
}
