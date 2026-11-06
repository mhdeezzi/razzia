// Données FotMob (calendrier, xG, carte des tirs, compositions, coachs, absences, stats des joueurs), réduites à
// l'essentiel pour le moteur foot. Une fiche compacte par match dans data/cache/foot/m/<id>.json (le détail brut fait
// ~250 Ko, la fiche ~15 Ko). Rien de tout ça n'est affiché sur le site tant que le moteur n'est pas validé.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FOOT_DIR = join(import.meta.dirname, '..', '..', 'data', 'cache', 'foot');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

/** Compétitions suivies. `main` : les 5 grands championnats et les coupes d'Europe ; les autres servent à noter les
 * clubs qu'on retrouve en Ligue des Champions (Benfica, PSV, Celtic…). */
export const LEAGUES: Array<{ id: number; key: string; name: string; main: boolean; cup?: boolean }> = [
  { id: 47, key: 'ENG', name: 'Premier League', main: true },
  { id: 87, key: 'ESP', name: 'LaLiga', main: true },
  { id: 55, key: 'ITA', name: 'Serie A', main: true },
  { id: 54, key: 'GER', name: 'Bundesliga', main: true },
  { id: 53, key: 'FRA', name: 'Ligue 1', main: true },
  { id: 42, key: 'UCL', name: 'Ligue des Champions', main: true, cup: true },
  { id: 73, key: 'UEL', name: 'Ligue Europa', main: true, cup: true },
  { id: 57, key: 'NED', name: 'Eredivisie', main: false },
  { id: 61, key: 'POR', name: 'Liga Portugal', main: false },
  { id: 40, key: 'BEL', name: 'Pro League', main: false },
  { id: 64, key: 'SCO', name: 'Premiership', main: false },
  { id: 71, key: 'TUR', name: 'Süper Lig', main: false },
  { id: 38, key: 'AUT', name: 'Bundesliga autrichienne', main: false },
  { id: 69, key: 'SUI', name: 'Super League', main: false },
  { id: 122, key: 'CZE', name: '1. Liga', main: false },
  { id: 135, key: 'GRE', name: 'Super League grecque', main: false },
  { id: 46, key: 'DEN', name: 'Superligaen', main: false },
  { id: 59, key: 'NOR', name: 'Eliteserien', main: false },
];

let last = 0;
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const wait = Math.max(0, last + 250 - Date.now());
    last = Date.now() + wait;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return undefined;
      if (attempt >= 4) throw new Error(`FotMob ${r.status} ${url}`);
    } catch (e) {
      if (attempt >= 4) throw e;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

export interface Fixture { id: string; lg: number; season: string; date: string; round?: string; home: { id: number; name: string }; away: { id: number; name: string }; finished: boolean; cancelled: boolean; score?: [number, number] }

/** Calendrier d'une compétition pour une saison (« 2024/2025 », ou « 2024 » pour les championnats sur l'année civile). */
export async function fixtures(lg: number, season: string, fresh = false): Promise<{ seasons: string[]; matches: Fixture[] }> {
  const dir = join(FOOT_DIR, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${lg}_${season.replace('/', '-')}.json`);
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const d = await getJson(`https://www.fotmob.com/api/data/leagues?id=${lg}&season=${encodeURIComponent(season)}`);
  const all: any[] = d?.fixtures?.allMatches ?? [];
  const out = {
    seasons: d?.allAvailableSeasons ?? [],
    matches: all.map((m) => {
      const s = String(m.status?.scoreStr ?? '').match(/(\d+)\s*-\s*(\d+)/);
      return {
        id: String(m.id), lg, season, date: m.status?.utcTime, round: m.round != null ? String(m.round) : undefined,
        home: { id: Number(m.home?.id), name: m.home?.name }, away: { id: Number(m.away?.id), name: m.away?.name },
        finished: !!m.status?.finished, cancelled: !!m.status?.cancelled, score: s ? [Number(s[1]), Number(s[2])] as [number, number] : undefined,
      };
    }),
  };
  // Une saison terminée ne bouge plus : gardée telle quelle ; la saison en cours est relue à chaque passage.
  writeFileSync(file, JSON.stringify(out));
  return out;
}

const SIT: Record<string, number> = { RegularPlay: 0, FromCorner: 1, SetPiece: 2, FreeKick: 3, Penalty: 4, FastBreak: 5, ThrowInSetPiece: 6, IndividualPlay: 7, OwnGoal: 8 };
export const SITUATIONS = Object.fromEntries(Object.entries(SIT).map(([k, v]) => [v, k]));

/** Fiche compacte d'un match terminé. Tirs : [équipe 0 dom/1 ext, joueur, minute, x, y, xG, situation, but, cadré, tête]. */
export interface MatchRec {
  id: string; lg: number; season: string; date: string; round?: string;
  home: { id: number; name: string }; away: { id: number; name: string }; score: [number, number];
  xg?: [number, number]; xgnp?: [number, number]; xgot?: [number, number];
  stats: Record<string, [number, number]>;
  shots: Array<[number, number, number, number, number, number, number, number, number, number]>;
  events: Array<[string, number, number, number]>; // [type G/OG/PG/R, minute, équipe, joueur]
  sides: Array<{ formation?: string; coach?: { id: number; name: string }; rating?: number; marketValue?: number; age?: number;
    starters: Array<[number, string, number, number]>; // [id, nom, poste, valeur marchande]
    subs: Array<[number, string, number]>; // [id, nom, minute d'entrée (-1 : pas entré)]
    unavailable: Array<[number, string, string]>; }>; // [id, nom, raison]
  players: Record<string, number[]>; // id -> [équipe, minutes, xG, xA, tirs, passes clés, touches surface, actions déf., note, buts, passes D, xGOT subis (gardien), buts évités]
  ref?: string; stadium?: string; attendance?: number;
}

const STAT_KEYS: Record<string, string> = {
  'Ball possession': 'poss', 'Total shots': 'shots', 'Shots on target': 'sot', 'Big chances': 'bigc', 'Big chances missed': 'bigcm',
  'Touches in opposition box': 'tbox', 'Passes': 'passes', 'Accurate passes': 'accp', 'Opposition half': 'opph', 'Own half': 'ownh',
  'Accurate long balls': 'long', 'Accurate crosses': 'cross', 'Tackles': 'tackles', 'Interceptions': 'inter', 'Blocks': 'blocks',
  'Clearances': 'clear', 'Keeper saves': 'saves', 'Duels won': 'duels', 'Aerial duels won': 'aerial', 'Successful dribbles': 'dribbles',
  'Fouls committed': 'fouls', 'Yellow cards': 'yellow', 'Red cards': 'red', 'Corners': 'corners', 'Offsides': 'offsides',
  'xG open play': 'xgop', 'xG set play': 'xgsp', 'Shots inside box': 'sibox', 'Shots outside box': 'sobox', 'Hit woodwork': 'wood',
};
const num = (v: any) => { const n = parseFloat(String(v ?? '').replace('%', '').replace(/\s*\(.*$/, '')); return Number.isFinite(n) ? n : NaN; };

function compact(d: any, f: Fixture): MatchRec | undefined {
  const c = d?.content;
  if (!c) return undefined;
  const teams = d.header?.teams ?? [];
  const homeId = Number(teams[0]?.id ?? f.home.id);
  const stats: Record<string, [number, number]> = {};
  let xg: [number, number] | undefined, xgnp: [number, number] | undefined, xgot: [number, number] | undefined;
  for (const g of c.stats?.Periods?.All?.stats ?? [])
    for (const s of g.stats ?? []) {
      const v = s.stats;
      if (!Array.isArray(v) || v.length < 2) continue;
      const pair: [number, number] = [num(v[0]), num(v[1])];
      if (Number.isNaN(pair[0]) || Number.isNaN(pair[1])) continue;
      if (s.title === 'Expected goals (xG)') xg = pair;
      else if (s.title === 'xG non-penalty') xgnp = pair;
      else if (s.title === 'xG on target (xGOT)') xgot = pair;
      const k = STAT_KEYS[s.title];
      if (k && !stats[k]) stats[k] = pair;
      if (s.title === 'Passes' && s.key === 'passes') stats.passes = pair;
    }
  const shots: MatchRec['shots'] = (c.shotmap?.shots ?? []).map((s: any) => [
    Number(s.teamId) === homeId ? 0 : 1, Number(s.playerId) || 0, Number(s.min) || 0, +(+s.x).toFixed(1), +(+s.y).toFixed(1),
    +(+s.expectedGoals || 0).toFixed(4), SIT[s.situation] ?? 0, s.eventType === 'Goal' && !s.isOwnGoal ? 1 : 0, s.isOnTarget ? 1 : 0, s.shotType === 'Header' ? 1 : 0,
  ]);
  const events: MatchRec['events'] = [];
  for (const e of c.matchFacts?.events?.events ?? []) {
    if (e.isPenaltyShootoutEvent) continue;
    const side = e.isHome ? 0 : 1;
    if (e.type === 'Goal') events.push([e.ownGoal ? 'OG' : e.goalDescriptionKey === 'penalty' || /pen/i.test(String(e.suffix ?? '')) ? 'PG' : 'G', Number(e.time) || 0, side, Number(e.player?.id) || 0]);
    if (e.type === 'Card' && /red/i.test(String(e.card ?? ''))) events.push(['R', Number(e.time) || 0, side, Number(e.player?.id) || 0]);
  }
  const side = (t: any) => {
    const subs: Array<[number, string, number]> = (t?.subs ?? []).map((p: any) => {
      const inn = (p.performance?.substitutionEvents ?? []).find((x: any) => x.type === 'subIn');
      return [Number(p.id), p.name, inn ? Number(inn.time) || 0 : -1];
    });
    return {
      formation: t?.formation, coach: t?.coach ? { id: Number(t.coach.id), name: t.coach.name } : undefined,
      rating: t?.rating, marketValue: t?.totalStarterMarketValue, age: t?.averageStarterAge,
      starters: (t?.starters ?? []).map((p: any) => [Number(p.id), p.name, Number(p.positionId ?? p.usualPlayingPositionId ?? 0), Number(p.marketValue) || 0]),
      subs,
      unavailable: (t?.unavailable ?? []).map((p: any) => [Number(p.id), p.name, String(p.unavailability?.type ?? '')]),
    };
  };
  const players: MatchRec['players'] = {};
  for (const p of Object.values<any>(c.playerStats ?? {})) {
    const flat: Record<string, number> = {};
    for (const s of p.stats ?? []) for (const v of Object.values<any>(s.stats ?? {})) if (v?.key) flat[v.key] = Number(v.stat?.value) || 0;
    const name = (k: string) => {
      for (const s of p.stats ?? []) for (const [n, v] of Object.entries<any>(s.stats ?? {})) if (n === k) return Number(v?.stat?.value) || 0;
      return 0;
    };
    players[p.id] = [
      Number(p.teamId) === homeId ? 0 : 1, flat.minutes_played ?? 0, flat.expected_goals ?? 0, flat.expected_assists ?? 0, flat.total_shots ?? 0,
      flat.chances_created ?? 0, flat.touches_opp_box ?? 0, flat.defensive_actions ?? 0, flat.rating_title ?? 0, flat.goals ?? 0, flat.assists ?? 0,
      name('xGOT faced'), name('Goals prevented'),
    ];
  }
  const info = c.matchFacts?.infoBox ?? {};
  return {
    id: f.id, lg: f.lg, season: f.season, date: f.date, round: f.round, home: f.home, away: f.away,
    score: [Number(teams[0]?.score ?? f.score?.[0] ?? 0), Number(teams[1]?.score ?? f.score?.[1] ?? 0)],
    xg, xgnp, xgot, stats, shots, events,
    sides: [side(c.lineup?.homeTeam), side(c.lineup?.awayTeam)], players,
    ref: info.Referee?.text, stadium: info.Stadium?.name, attendance: Number(info.Attendance) || undefined,
  };
}

/** Fiche compacte d'un match terminé (téléchargée une seule fois). */
export async function match(f: Fixture): Promise<MatchRec | undefined> {
  const dir = join(FOOT_DIR, 'm');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${f.id}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const d = await getJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${f.id}`);
  const rec = compact(d, f);
  if (rec) writeFileSync(file, JSON.stringify(rec));
  return rec;
}

/** Détail brut (avant-match : compositions probables/officielles, absences). */
export async function matchRaw(id: string): Promise<any> {
  return getJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${id}`);
}
