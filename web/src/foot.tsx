// Onglet Football : programme (Premier League, LaLiga, Ligue 1, Ligue des Champions, Serie A quand un grand club joue),
// fiche de match avec la simulation (25 000 matchs tir par tir), mêmes principes que le basket et le tennis : un
// pronostic mis en avant, un combiné rattaché, Razzia assuré (vert), risqué (orange), pile ou face (rouge).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, CaretRight, Coins, ListBullets, ShieldCheck, SoccerBall, SquaresFour, WarningCircle } from '@phosphor-icons/react';
import { Callout, Empty, glow, Link, PageHero, Ring, Segmented, SimProgress, TeamMark } from './ui.tsx';
import { marbleVars, PickTabs } from './results.tsx';
import { fairScore } from './fairscore.ts';
import { SideColors } from './flags.ts';
import { WarpBg } from './shaders.tsx';
import { PublicRecord } from './record.tsx';
import { DayTracker, ended, publishing, Section, useDayRun, type DayCfg } from './tennis.tsx';
import type { Category, Outcome } from './picks.ts';

// ——— Données ———
interface Team { id: number; name: string; logo?: string; form?: number; att?: number }
interface Odds { h: number; d: number; a: number; over25?: number; under25?: number; src?: string }
type Tier = 'sure' | 'normal' | 'risky' | 'flip';
export interface FootResult {
  sport: 'foot'; id: string; lg: number; league: string; round?: string; start: string; day: string;
  home: Team; away: Team; lineupType: 'standard' | 'official' | 'predicted' | 'unknown';
  lineups: Array<{ formation?: string; coach?: string; starters: string[]; out: Array<{ name: string; why: string }> }>;
  lambda: [number, number]; engine: { h: number; d: number; a: number }; final: { h: number; d: number; a: number };
  market?: { odds: Odds; src?: string };
  probs: Record<string, number>; labels: Record<string, string>;
  scores: Array<{ h: number; a: number; p: number }>; firstGoal: [number, number, number]; ht: number[][];
  pick: { id: string; label: string; p: number } | null; combo: { id: string; label: string; p: number; risky: boolean };
  tier: Tier; T: number; scorers: Array<{ id: number; name: string; side: 'home' | 'away'; p: number }>; n: number;
  meta: { builtAt: string; gamesUsed: number; model?: string };
  flow?: Array<[number, number, number]>; // toutes les 5 minutes : domicile mène, nul, extérieur mène
  typical?: { given?: 'home' | 'away' | 'draw'; p?: number; score: [number, number]; share: number; goals: Array<{ side: 'home' | 'away'; min: number }> };
  h2h?: Array<{ date: string; lg: number; league?: string; home: number; away: number; score: [number, number] }>;
}
interface SlateMatch { id: string; lg: number; league: string; round?: string; start: string; home: { id: number; name: string }; away: { id: number; name: string }; state: 'pre' | 'in' | 'post'; score?: [number, number]; minute?: string; odds?: Odds }
interface SimIndex { id: string; lg: number; start: string; home: string; away: string; final: { h: number; d: number; a: number }; tier: Tier; pick: { id?: string; label: string; p: number } | null; at: string; noOdds?: boolean }
type State = { status: 'loading' } | { status: 'none' } | { status: 'queued' | 'running'; startedAt?: string; url?: string } | { status: 'done'; result: FootResult } | { status: 'failed'; error?: string; url?: string };
type Slate = { matches: SlateMatch[]; sims: SimIndex[] };

const api = async (q: string, init?: RequestInit) => {
  const r = await fetch(`/api/foot${q}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Erreur ${r.status}`);
  return j;
};
const pendingKey = (id: string) => `foot-req-${id}`;
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* stockage indisponible */ } } };
const FOOT_DAY: DayCfg = { key: 'foot-journee', call: api, pending: pendingKey, body: (list) => ({ ids: list.map((m) => m.id) }) };

const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const pct0 = (v: number) => `${Math.round(v * 100)} %`;
const dec = (v: number) => v.toFixed(2).replace('.', ',');
const timeLocal = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const localDay = (iso: string | number) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLongOf = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

// ——— Compétitions et clubs ———
const LEAGUE_FR: Record<number, string> = { 42: 'Ligue des Champions', 47: 'Premier League', 87: 'LaLiga', 55: 'Serie A', 53: 'Ligue 1', 54: 'Bundesliga' };
const LEAGUE_ORDER = [42, 53, 47, 87, 55, 54];
const leagueOf = (lg: number, name?: string) => LEAGUE_FR[lg] ?? name ?? '';
/** « 10 » -> « 10e journée » ; les tours de coupe restent tels quels. */
const roundFr = (round?: string, short = false) => {
  if (!round) return '';
  if (/^\d+$/.test(round)) return short ? `J${round}` : `${round}${round === '1' ? 're' : 'e'} journée`;
  return round;
};
/** Noms courts (cartes, pastilles, téléphone). */
const SHORT: Record<string, string> = {
  'Paris Saint-Germain': 'PSG', 'Manchester City': 'Man City', 'Manchester United': 'Man United', 'Brighton & Hove Albion': 'Brighton',
  'Tottenham Hotspur': 'Tottenham', 'Newcastle United': 'Newcastle', 'Nottingham Forest': 'Nottingham', 'AFC Bournemouth': 'Bournemouth',
  'Atlético Madrid': 'Atlético', 'Borussia Dortmund': 'Dortmund', 'Bayern München': 'Bayern', 'Deportivo Alavés': 'Alavés',
  'Deportivo A Coruña': 'La Corogne', 'Racing Santander': 'Racing', 'Rayo Vallecano': 'Rayo', 'Real Sociedad': 'Real Sociedad',
  'Shakhtar Donetsk': 'Shakhtar', 'PSV Eindhoven': 'PSV', 'Slovan Bratislava': 'Slovan', 'Slavia Prague': 'Slavia Prague',
  'Crystal Palace': 'Palace', 'Leeds United': 'Leeds', 'Ipswich Town': 'Ipswich', 'Coventry City': 'Coventry', 'Hull City': 'Hull',
  'VfB Stuttgart': 'Stuttgart', 'RB Leipzig': 'Leipzig', 'Bayer Leverkusen': 'Leverkusen', 'Borussia Mönchengladbach': 'Gladbach',
  'Eintracht Frankfurt': 'Francfort', '1. FC Köln': 'Cologne', 'Hamburger SV': 'Hambourg', 'Werder Bremen': 'Brême', 'Union Berlin': 'Union Berlin', 'Club Brugge': 'Bruges', 'Sporting CP': 'Sporting', 'FC Porto': 'Porto',
  'Bodø/Glimt': 'Bodø/Glimt', 'AEK Athens': 'AEK Athènes', 'Athletic Club': 'Bilbao', 'Celta Vigo': 'Celta', 'Real Betis': 'Betis', 'Sabah FK': 'Sabah',
};
const short = (n: string) => SHORT[n] ?? n;
/** Sigles des clubs (pastilles du programme) : « TLS ou nul 70 % ». */
const TRI: Record<string, string> = {
  'AEK Athens': 'AEK', 'AFC Bournemouth': 'BOU', Angers: 'ANG', Arsenal: 'ARS', 'Aston Villa': 'AVL', Atalanta: 'ATA', 'Athletic Club': 'ATH',
  'Atlético Madrid': 'ATM', Auxerre: 'AJA', Barcelona: 'BAR', 'Bayern München': 'BAY', 'Bodø/Glimt': 'BOD', Bologna: 'BOL', 'Borussia Dortmund': 'BVB',
  Brentford: 'BRE', Brest: 'BRE', 'Brighton & Hove Albion': 'BHA', Cagliari: 'CAG', 'Celta Vigo': 'CEL', Chelsea: 'CHE', 'Club Brugge': 'BRU', Como: 'COM',
  'Coventry City': 'COV', 'Crystal Palace': 'CRY', 'Deportivo A Coruña': 'DEP', 'Deportivo Alavés': 'ALA', Elche: 'ELC', Espanyol: 'ESP', Everton: 'EVE',
  'FC Porto': 'POR', Fenerbahçe: 'FEN', Feyenoord: 'FEY', Fiorentina: 'FIO', Frosinone: 'FRO', Fulham: 'FUL', Galatasaray: 'GAL', Genoa: 'GEN',
  Getafe: 'GET', 'Hull City': 'HUL', Inter: 'INT', 'Ipswich Town': 'IPS', Juventus: 'JUV', LASK: 'LASK', Lazio: 'LAZ', 'Le Havre': 'HAC', 'Le Mans': 'LEM',
  Lecce: 'LEC', 'Leeds United': 'LEE', Lens: 'RCL', Levante: 'LEV', Lille: 'LIL', Liverpool: 'LIV', Lorient: 'LOR', Lyon: 'OL', 'Manchester City': 'MCI',
  'Manchester United': 'MUN', Marseille: 'OM', Milan: 'MIL', Monaco: 'ASM', Monza: 'MON', Málaga: 'MAL', Napoli: 'NAP', 'Newcastle United': 'NEW',
  Nice: 'NIC', 'Nottingham Forest': 'NFO', Osasuna: 'OSA', 'PSV Eindhoven': 'PSV', 'Paris FC': 'PFC', 'Paris Saint-Germain': 'PSG', Parma: 'PAR',
  'RB Leipzig': 'RBL', 'Racing Santander': 'RAC', 'Rayo Vallecano': 'RAY', 'Real Betis': 'BET', 'Real Madrid': 'RMA', 'Real Sociedad': 'RSO', Rennes: 'SRFC',
  Roma: 'ROM', 'Sabah FK': 'SAB', Sassuolo: 'SAS', Sevilla: 'SEV', 'Shakhtar Donetsk': 'SHA', 'Slavia Prague': 'SLA', 'Slovan Bratislava': 'SLO',
  'Sporting CP': 'SCP', Strasbourg: 'RCSA', Sunderland: 'SUN', Torino: 'TOR', 'Tottenham Hotspur': 'TOT', Toulouse: 'TLS', Troyes: 'ESTAC', Udinese: 'UDI',
  Valencia: 'VAL', Venezia: 'VEN', 'VfB Stuttgart': 'VFB', Viking: 'VIK', Villarreal: 'VIL',
  '1. FC Köln': 'KOE', Augsburg: 'FCA', 'Bayer Leverkusen': 'B04', 'Borussia Mönchengladbach': 'BMG', 'Eintracht Frankfurt': 'SGE', Elversberg: 'SVE',
  Freiburg: 'SCF', 'Hamburger SV': 'HSV', Hoffenheim: 'TSG', 'Mainz 05': 'M05', Paderborn: 'SCP', 'Schalke 04': 'S04', 'Union Berlin': 'FCU', 'Werder Bremen': 'SVW',
};
const tri = (n: string) => TRI[n] ?? n.replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase();
/** Couleur principale de chaque club (identifiant FotMob) : marbre du bandeau, ronds et barres. Sinon gris. */
const COLOR: Record<number, string> = {
  9825: '#db0007', 10252: '#7a1f3d', 8678: '#d71920', 9937: '#e30613', 10204: '#0057b8', 8455: '#034694', 8669: '#5fb4e5', 9826: '#1b458f',
  8668: '#003399', 9879: '#6b6b6b', 8667: '#f5971d', 9902: '#3a64a3', 8463: '#ffcd00', 8650: '#c8102e', 8456: '#6cabdd', 10260: '#da291c',
  10261: '#6b6b6b', 10203: '#dd0000', 8472: '#eb172b', 8586: '#132257', 8315: '#ee2523', 9906: '#cb3524', 8634: '#a50044', 9910: '#8ac3ee',
  9783: '#1b4d9b', 9866: '#1e4b9c', 10268: '#0b8a3e', 8558: '#1e73be', 8305: '#005999', 8581: '#b4053f', 9864: '#5a9bd8', 8371: '#d91a21',
  8696: '#0e8a43', 8370: '#e53027', 8603: '#0bb363', 8633: '#febe10', 8560: '#0067b1', 8302: '#d4021d', 10267: '#ee3524', 10205: '#ffe667',
  8121: '#6b6b6b', 8583: '#1d4f91', 8521: '#e2001a', 9746: '#5b9bd5', 8682: '#d6001c', 8588: '#ffd800', 8639: '#e01e13', 8689: '#f58220',
  9748: '#1d3e8f', 8592: '#2faee0', 9829: '#e51b22', 9831: '#c8102e', 6379: '#1d3e8f', 9847: '#004170', 9851: '#e13327', 9848: '#009fe3',
  9941: '#6b3fa0', 10242: '#1b4f9c', 8524: '#1e71b8', 9857: '#a21c26', 8529: '#a6192e', 10171: '#1b5fa8', 8535: '#5b2a86', 9891: '#ffd700',
  10233: '#a6192e', 8636: '#0068a8', 9885: '#8a8a8a', 8543: '#87d8f7', 9888: '#ffdd00', 8564: '#fb090b', 6504: '#e2001a', 9875: '#12a0d7',
  10167: '#ffd200', 8686: '#8e1f2f', 7943: '#00a752', 9804: '#8b1a1a', 8600: '#8a8a8a', 7881: '#f47920', 8563: '#ffd200', 9823: '#dc052d',
  8402: '#ffd200', 9789: '#fde100', 8342: '#0067ce', 9773: '#00428c', 8695: '#163962', 10235: '#e30613', 8637: '#a90432', 9977: '#6b6b6b',
  8722: '#ed1c24', 8406: '#ba3733', 8178: '#e32221', 9788: '#1d9053', 9810: '#e1000f', 8232: '#0b2a6b', 8358: '#d40f1a', 9790: '#0a3f86',
  8226: '#1961b5', 9905: '#c3141e', 8460: '#005ca9', 10189: '#004d9d', 8149: '#d4011d', 8697: '#1d9053',
  8640: '#ed1c24', 178475: '#dd0741', 951893: '#2c6fb7', 9728: '#f07d00', 7787: '#c8102e', 6019: '#4aa3df', 9768: '#00804a', 10269: '#e32219', 8478: '#0b5aa6',
};
/** Seconde couleur des clubs dont la principale est neutre (noir, blanc, gris) ou proche d'un rival fréquent. */
const ALT: Record<number, string> = {
  9879: '#cc1f2f', 9885: '#c9a227', 8600: '#d4a017', 8121: '#c8a24a', 9977: '#c8102e', 10261: '#41a7e0', 8456: '#1c2c5b', 9875: '#0b3d91',
  8633: '#6c4fa3', 9823: '#0a3f86', 9788: '#e8e8e8', 8178: '#f5c400', 9810: '#ffffff', 8722: '#ffffff', 8358: '#ffffff', 9905: '#ffffff', 8149: '#ffd800', 8650: '#00a398', 10260: '#fbe122', 8634: '#004d98', 9825: '#9c824a', 8455: '#d1d3d4', 8564: '#e8e8e8',
  8636: '#c9a227', 9847: '#da291c', 8592: '#ffffff', 9748: '#da291c', 8586: '#ffffff', 9906: '#262e61',
};
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const near = (a: string, b: string) => Math.hypot(...hex(a).map((x, i) => x - hex(b)[i])) < 90;
const NEUTRAL = '#5a5f69';
/** Couleurs des deux clubs d'un match : jamais deux fois la même (ni deux gris) ; le domicile prend sa seconde couleur,
 * sinon l'extérieur la sienne, sinon un bleu (ou un or). */
function pairColors(h: number, a: number): { home: string; away: string } {
  let ch = COLOR[h] ?? NEUTRAL, ca = COLOR[a] ?? NEUTRAL;
  if (near(ch, ca)) {
    if (ALT[h] && !near(ALT[h], ca)) ch = ALT[h];
    else if (ALT[a] && !near(ch, ALT[a])) ca = ALT[a];
    else ca = near(ch, '#3b6fd6') ? '#d4a017' : '#3b6fd6';
  }
  return { home: glow(ch), away: glow(ca) };
}
const colorOf = (id: number) => glow(COLOR[id] ?? NEUTRAL);
const logoOf = (id: number) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
/** Pastille du club : logo FotMob. Le code « f<id> » ne croise aucune équipe NBA (couleur donnée à la main). */
const markOf = (t: { id: number; logo?: string }) => ({ tri: `f${t.id}`, color: COLOR[t.id] ?? '#5a5f69', logo: t.logo ?? logoOf(t.id) });
function Crest({ t, size = 'md' }: { t: { id: number; logo?: string }; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return <TeamMark team={markOf(t)} size={size} />;
}

// ——— Paliers ———
/** Pastille du programme : le pronostic mis en avant (ou le favori ou nul quand il n'y en a pas) et sa couleur. */
function simPill(sim: SimIndex) {
  const homeFav = sim.final.h >= sim.final.a;
  const fav = tri(homeFav ? sim.home : sim.away);
  const cls = sim.tier === 'flip' ? ' flip' : sim.tier === 'risky' ? ' risky' : '';
  if (sim.pick) {
    const id = sim.pick.id ?? '';
    const base = id.split('+')[0];
    const text =
      base === '1' ? tri(sim.home) : base === '2' ? tri(sim.away) : base === '1X' ? `${tri(sim.home)} ou nul` : base === 'X2' ? `${tri(sim.away)} ou nul` : base === '12' ? 'Pas de nul' : '';
    return { text: text ? `${text}${id.includes('+') ? ' +' : ''}` : sim.pick.label, p: sim.pick.p, cls };
  }
  return { text: `${fav} ou nul`, p: homeFav ? sim.final.h + sim.final.d : sim.final.a + sim.final.d, cls };
}

// ——— Programme ———
type Status = 'pre' | 'in' | 'post';
type View = 'liste' | 'grille';
/** État du match : FotMob en direct (hier et aujourd'hui), sinon d'après l'heure (en jeu jusqu'à 2 h 15 après le coup d'envoi). */
const stateOf = (m: SlateMatch): Status => {
  if (m.state === 'post') return 'post';
  const t = Date.parse(m.start), now = Date.now();
  if (m.state === 'in') return 'in';
  return t > now ? 'pre' : now - t < 2.25 * 3_600_000 ? 'in' : 'post';
};
const storedView = (): View => {
  try {
    return sessionStorage.getItem('vue') === 'liste' ? 'liste' : 'grille';
  } catch {
    return 'grille';
  }
};
const matchPath = (m: { id: string; start: string }) => `/foot/match/${m.start.slice(0, 10)}/${m.id}`;
// Dernier programme reçu : affiché tout de suite au retour sur la page, puis relu.
let slateLast: Slate | undefined;

/** Affiche du jour : Ligue des Champions et grands clubs d'abord ; entre petits matchs, la Ligue 1 (site français). Mêmes
 * niveaux que le tri du programme (footslate.ts) : 3 les géants, 2 les clubs très suivis, 1 les autres. */
const POP: Record<number, number> = {
  9847: 3, 8633: 3, 8634: 3, 9823: 3, 8456: 3, 8650: 3, 9825: 3, 8455: 3, 10260: 3, 9885: 3, 8636: 3, 8564: 3,
  9906: 2, 8586: 2, 10261: 2, 9789: 2, 8592: 2, 9875: 2, 8686: 2, 9748: 2, 9829: 2, 10252: 2, 8524: 2, 8639: 2, 10171: 2,
  8302: 2, 8315: 2, 8560: 2, 10205: 2, 8588: 2, 9831: 2, 9773: 2, 9768: 2, 8637: 2, 8695: 2, 8640: 2, 10235: 2,
  178475: 2, 10269: 2, 9851: 2, 8543: 2, 8178: 2, 9810: 2, 10189: 2, 9790: 2,
};
const pop = (id: number) => POP[id] ?? 1;
const LG_BONUS: Record<number, number> = { 42: 3, 53: 1.5, 47: 0.35, 87: 0.3, 55: 0.25, 54: 0.2 };
const score = (m: SlateMatch) => pop(m.home.id) + pop(m.away.id) + (pop(m.home.id) >= 2 && pop(m.away.id) >= 2 ? 1 : 0) + (LG_BONUS[m.lg] ?? 0);

export function FootSchedulePage({ day }: { day: string | null }) {
  const [data, setData] = useState<Slate | undefined>(() => slateLast);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<View>(storedView);
  const [status, setStatus] = useState<Status>('pre');
  const load = useCallback(
    (fresh = false) =>
      api(`?slate=1${fresh ? `&v=${Date.now()}` : ''}`).then(
        (d: Slate) => setData((slateLast = d)),
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    try {
      sessionStorage.setItem('vue', view);
    } catch {
      /* préférence non mémorisée */
    }
  }, [view]);
  const reload = useCallback(() => void load(true), [load]);
  const { run, start, dismiss } = useDayRun(reload, FOOT_DAY);
  const busy = !ended(run);
  const sims = useMemo(() => new Map((data?.sims ?? []).map((s) => [s.id, s])), [data]);
  const settling = !!run && publishing(run, sims);
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(reload, 15000);
    return () => window.clearInterval(t);
  }, [busy, reload]);
  useEffect(() => {
    if (!settling) return;
    const t = window.setTimeout(reload, 5000);
    return () => window.clearTimeout(t);
  }, [settling, data, reload]);

  // Hier, aujourd'hui et les sept jours suivants, à l'heure locale (le programme couvre la semaine).
  const dates = useMemo(() => Array.from({ length: 9 }, (_, i) => localDay(Date.now() + (i - 1) * 86_400_000)), [data]);
  const byDay = useMemo(() => {
    const m = new Map<string, SlateMatch[]>(dates.map((d) => [d, []]));
    for (const x of data?.matches ?? []) m.get(localDay(x.start))?.push(x);
    for (const list of m.values()) list.sort((a, b) => a.start.localeCompare(b.start) || LEAGUE_ORDER.indexOf(a.lg) - LEAGUE_ORDER.indexOf(b.lg));
    return m;
  }, [data, dates]);
  const today = dates[1];
  // Toujours aujourd'hui par défaut, même sans match : ouvrir le lendemain tout seul faisait croire que c'était le jour.
  const current = day && byDay.has(day) ? day : today;
  const dayMatches = byDay.get(current) ?? [];
  const count = (st: Status) => dayMatches.filter((m) => stateOf(m) === st).length;
  useEffect(() => {
    if (dayMatches.length && !dayMatches.some((m) => stateOf(m) === status)) setStatus((['in', 'pre', 'post'] as const).find((st) => dayMatches.some((m) => stateOf(m) === st))!);
  }, [current, data]);
  const anyLive = dayMatches.some((m) => stateOf(m) === 'in');
  useEffect(() => {
    if (!anyLive) return;
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [anyLive, load]);
  const shown = dayMatches.filter((m) => stateOf(m) === status);
  const groups = LEAGUE_ORDER.map((lg) => [lg, shown.filter((m) => m.lg === lg)] as const).filter(([, l]) => l.length);
  const todo = dayMatches.filter((m) => stateOf(m) === 'pre' && !sims.has(m.id));
  const inRun = (id: string) => busy && run!.ids.includes(id);
  const w = Math.max(5, ...shown.flatMap((m) => [short(m.home.name).length * 0.6, short(m.away.name).length * 0.6 + 1.3]));

  return (
    <div className="page">
      <PageHero sport="foot" title="Programme Foot" day={cap(dayLongOf(current))} count={dayMatches.length} feature={<FootUne matches={dayMatches} sims={sims} />}>
        <Segmented<View>
          tone="dark"
          ariaLabel="Affichage"
          value={view}
          onChange={setView}
          options={[
            { value: 'grille', label: <><SquaresFour size={16} /> Grille</> },
            { value: 'liste', label: <><ListBullets size={16} /> Liste</> },
          ]}
        />
      </PageHero>
      <PublicRecord sport="foot" />

      {error && (
        <Empty title="Le programme n'a pas pu être chargé.">
          <p>{error}</p>
          <button className="btn btn-ghost" onClick={() => location.reload()}>
            Réessayer
          </button>
        </Empty>
      )}
      {!data && !error && <span className="sk sk-hero" aria-busy="true" />}

      {data && (
        <>
          <div className="filters">
            <Segmented<Status>
              ariaLabel="Statut"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'pre', label: <>À venir {count('pre') > 0 && <span className="mono">{count('pre')}</span>}</> },
                { value: 'in', label: <>{count('in') > 0 && <span className="live-dot" />}En direct {count('in') > 0 && <span className="mono">{count('in')}</span>}</>, disabled: !count('in') },
                { value: 'post', label: <>Terminés {count('post') > 0 && <span className="mono">{count('post')}</span>}</>, disabled: !count('post') },
              ]}
            />
          </div>

          <nav className="days" aria-label="Jours">
            {dates.map((d) => {
              const n = byDay.get(d)?.length ?? 0;
              const name = d === today ? "Aujourd'hui" : d === dates[2] ? 'Demain' : d === dates[0] ? 'Hier' : new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short' });
              return (
                <Link key={d} href={`/foot?jour=${d}`} replace className={`day${d === current ? ' is-on' : ''}${n ? '' : ' is-empty'}`}>
                  <span className="day-name">{name}</span>
                  <span className="day-date">{new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                  <span className="day-count">{n ? `${n} match${n > 1 ? 's' : ''}` : 'repos'}</span>
                </Link>
              );
            })}
          </nav>

          {(todo.length > 0 || (busy && run!.day === current)) && (
            <div className="sheet-bar">
              {busy && run!.day !== current && (
                <p className="sheet-hint">
                  Une journée est déjà en calcul ({dayLongOf(run!.day)}).{' '}
                  <Link href={`/foot?jour=${run!.day}`} replace>
                    Voir
                  </Link>
                </p>
              )}
              <button
                className="btn-soiree"
                disabled={busy}
                onClick={() => void start(current, todo.map((m) => ({ id: m.id, day: m.start.slice(0, 10) })))}
                title={busy ? undefined : `Simule les ${todo.length} matchs à venir de ce jour, en un seul passage`}
              >
                {busy && run!.day === current ? 'Journée en cours' : 'Simuler toute la journée'}
                <span className="n">{busy && run!.day === current ? `${run!.ids.length} matchs` : `${todo.length} match${todo.length > 1 ? 's' : ''}`}</span>
              </button>
            </div>
          )}
          {run && run.day === current && <DayTracker run={run} sims={sims} onClose={dismiss} wait="deux à quatre minutes" />}

          {dayMatches.length === 0 ? (
            <Empty title={current === today ? "Aucun match aujourd'hui dans les championnats suivis." : 'Pas de match ce jour-là dans les championnats suivis.'}>{current === today && <p>Choisis un autre jour dans le calendrier ci-dessus.</p>}</Empty>
          ) : view === 'liste' ? (
            <section className="league-card" key={`${current}-${status}`}>
              <div className="league-top">
                <h2>Football</h2>
                <span className="badge-n">{shown.length}</span>
                <span className="muted">Heures dans votre fuseau</span>
              </div>
              <div className="thead t-row" aria-hidden="true">
                <span>Heure</span>
                <span className="c">Match</span>
                <span className="c">Cotes 1 / N / 2</span>
                <span className="c">Simulation</span>
                <span />
              </div>
              {groups.map(([lg, list]) => (
                <div className="t-group" key={lg}>
                  <p className="t-group-head">
                    {LEAGUE_FR[lg]} <span className="badge-n">{list.length}</span>
                  </p>
                  <ol className="rows">
                    {list.map((m, i) => (
                      <li key={m.id}>
                        <FootRow m={m} sim={sims.get(m.id)} running={inRun(m.id)} i={i} />
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </section>
          ) : (
            <div className="cards" key={`${current}-${status}`} style={{ '--w': w.toFixed(2) } as CSSProperties}>
              {shown.map((m, i) => (
                <FootCard key={m.id} m={m} sim={sims.get(m.id)} running={inRun(m.id)} i={i} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const oddsText = (o?: Odds) => (o ? `${dec(o.h)} / ${dec(o.d)} / ${dec(o.a)}` : undefined);

function TimeCell({ m }: { m: SlateMatch }) {
  const st = stateOf(m);
  return (
    <div className="row-time">
      <span className="t">{st === 'pre' || !m.score ? timeLocal(m.start) : `${m.score[0]}-${m.score[1]}`}</span>
      {st === 'in' ? (
        <span className="pill-tag live">
          <span className="live-dot" /> {m.minute ?? 'Direct'}
        </span>
      ) : st === 'post' ? (
        <span className="pill-tag final">Final</span>
      ) : (
        <span className="pill-tag">{roundFr(m.round, true) || leagueOf(m.lg, m.league)}</span>
      )}
    </div>
  );
}

function Who({ m, side, align }: { m: SlateMatch; side: 'home' | 'away'; align?: 'away' }) {
  const t = m[side];
  const st = stateOf(m);
  // Perdu ou match nul : nom en gris (un nul aux deux noms blancs ressemblait à un match pas commencé).
  const lost = st === 'post' && m.score && (side === 'home' ? m.score[0] <= m.score[1] : m.score[1] <= m.score[0]);
  const label = (
    <span className={lost ? 't-lost' : undefined}>
      <span className="vs-name">
        <span className="t-lg">{t.name}</span>
        <span className="t-sm">{short(t.name)}</span>
      </span>
      <span className="vs-rec">{side === 'home' ? 'Domicile' : 'Extérieur'}</span>
    </span>
  );
  return (
    <div className={`vs-team${align ? ' away' : ''}`}>
      {!align && <Crest t={t} size="sm" />}
      {label}
      {align && <Crest t={t} size="sm" />}
    </div>
  );
}

function FootSimPill({ sim, running, ended }: { sim?: SimIndex; running: boolean; ended?: boolean }) {
  if (running)
    return (
      <span className="conf-pill run">
        <span className="spin spin-xs" /> Calcul
      </span>
    );
  // Match commencé ou fini sans simulation : plus rien à lancer (on ne simule jamais un match commencé).
  if (!sim && ended) return <span className="conf-pill wait">Non simulé</span>;
  if (!sim) return <span className="conf-pill go">Simuler</span>;
  const p = simPill(sim);
  return (
    <span className={`conf-pill sim${p.cls}`} title={sim.pick?.label}>
      {p.text} <b>{pct0(p.p)}</b>
    </span>
  );
}

function FootRow({ m, sim, running, i }: { m: SlateMatch; sim?: SimIndex; running: boolean; i: number }) {
  return (
    <Link href={matchPath(m)} className="row t-row" style={{ '--i': i } as CSSProperties}>
      <TimeCell m={m} />
      <div className="vs-line">
        <Who m={m} side="home" align="away" />
        <span className="vs-at">vs</span>
        <Who m={m} side="away" />
      </div>
      <span className="cell-odds">{oddsText(m.odds) ?? <span className="muted small">Sans cote</span>}</span>
      <span style={{ textAlign: 'center' }}>
        <FootSimPill sim={sim} running={running} ended={stateOf(m) !== 'pre'} />
      </span>
      <CaretRight size={16} className="row-caret" />
    </Link>
  );
}

/** « À la une » : l'affiche du jour (Ligue des Champions, grands clubs), avec le pronostic simulé. */
function FootUne({ matches, sims }: { matches: SlateMatch[]; sims: Map<string, SimIndex> }) {
  const open = matches.filter((m) => stateOf(m) !== 'post');
  const m = [...(open.length ? open : matches)].sort((a, b) => score(b) - score(a) || a.start.localeCompare(b.start))[0];
  if (!m) return null;
  const st = stateOf(m);
  const sim = sims.get(m.id);
  const p = sim && simPill(sim);
  return (
    <Link href={matchPath(m)} className="hb-une">
      <span className="hb-une-k">À la une</span>
      <span className="hb-une-m">
        <Crest t={m.home} size="sm" />
        <b>
          {short(m.home.name)} <i>vs</i> {short(m.away.name)}
        </b>
        <Crest t={m.away} size="sm" />
      </span>
      <span className="hb-une-t mono">
        {st === 'pre' || !m.score ? timeLocal(m.start) : `${m.score[0]}-${m.score[1]}`} · {leagueOf(m.lg, m.league)}
      </span>
      {p && (
        <span className={`card-a-p${p.cls}`}>
          {p.text} {pct0(p.p)}
        </span>
      )}
      <CaretRight size={15} className="hb-une-go" />
    </Link>
  );
}

function FootCard({ m, sim, running, i }: { m: SlateMatch; sim?: SimIndex; running: boolean; i: number }) {
  const st = stateOf(m);
  const p = sim && !running ? simPill(sim) : undefined;
  const who = (side: 'home' | 'away') => {
    const t = m[side];
    const lost = st === 'post' && m.score && (side === 'home' ? m.score[0] <= m.score[1] : m.score[1] <= m.score[0]);
    return (
      <p className={`card-a-team${lost ? ' t-lost' : ''}`}>
        <Crest t={t} size="sm" />
        <span className="card-a-name" title={t.name}>
          {side === 'away' && <i>vs</i>}
          {short(t.name)}
        </span>
        {st !== 'pre' && m.score && <span className="card-a-score mono">{m.score[side === 'home' ? 0 : 1]}</span>}
      </p>
    );
  };
  return (
    <Link href={matchPath(m)} className="card card-a" style={{ '--i': i } as CSSProperties}>
      <CaretRight size={16} weight="bold" className="card-a-go" aria-hidden="true" />
      <span className="card-a-top mono">
        {st === 'pre' ? timeLocal(m.start) : st === 'in' ? `En direct${m.minute ? ` · ${m.minute}` : ''}` : 'Terminé'} · {leagueOf(m.lg, m.league)}
        {m.round && /^\d+$/.test(m.round) ? ` · ${roundFr(m.round, true)}` : ''}
      </span>
      <div className="card-a-t">
        {who('home')}
        {who('away')}
      </div>
      <div className="card-a-f">
        {p ? (
          <span className={`card-a-p${p.cls}`}>
            {p.text} {pct0(p.p)}
          </span>
        ) : (
          <FootSimPill sim={sim} running={running} ended={stateOf(m) !== 'pre'} />
        )}
        <span className="mono muted">{oddsText(m.odds) ?? 'Cotes à venir'}</span>
      </div>
    </Link>
  );
}

// ——— Fiche de match ———
function useFootSim(id: string) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState<number | undefined>(() => Number(store.get(`${pendingKey(id)}-at`)) || undefined);
  const timer = useRef<number | undefined>(undefined);
  const poll = useCallback(async () => {
    window.clearTimeout(timer.current);
    const req = store.get(pendingKey(id));
    try {
      const s = await api(`?id=${id}${req ? `&req=${req}` : ''}`);
      setState(s);
      if (s.status === 'queued' || s.status === 'running') timer.current = window.setTimeout(poll, 5000);
      else if (req) {
        store.set(pendingKey(id), null);
        store.set(`${pendingKey(id)}-at`, null);
      }
    } catch (e) {
      setState({ status: 'failed', error: (e as Error).message });
    }
  }, [id]);
  useEffect(() => {
    void poll();
    return () => window.clearTimeout(timer.current);
  }, [poll]);
  const launch = async () => {
    setBusy(true);
    setState({ status: 'queued' });
    try {
      const { req } = await api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      store.set(pendingKey(id), req);
      const at = Date.now();
      store.set(`${pendingKey(id)}-at`, String(at));
      setSince(at);
      setState({ status: 'queued' });
      timer.current = window.setTimeout(poll, 4000);
    } catch (e) {
      setState({ status: 'failed', error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return { state, busy, launch, since };
}

/** Bandeau de la fiche : marbre aux couleurs des deux clubs, compétition et journée, logos, « VS » et l'heure ou le score. */
function FootHero({ id, r }: { id: string; r?: FootResult }) {
  const [slate, setSlate] = useState<Slate>();
  useEffect(() => {
    void api('?slate=1').then(setSlate, () => setSlate({ matches: [], sims: [] }));
  }, []);
  const m = slate?.matches?.find((x) => x.id === id);
  if (!r && !m) return slate ? null : <span className="sk sk-hero" aria-busy="true" />;
  const st = m ? stateOf(m) : 'pre';
  const home = r?.home ?? m!.home, away = r?.away ?? m!.away;
  const start = r?.start ?? m!.start;
  const round = r?.round ?? m?.round;
  const team = (t: Team, k: 'home' | 'away') => {
    const lost = st === 'post' && m?.score && (k === 'home' ? m.score[0] <= m.score[1] : m.score[1] <= m.score[0]);
    return (
      <div className={`hero-team ${k}${lost ? ' t-lost' : ''}`}>
        <Crest t={t} size="xl" />
        <div>
          <p className="hero-name">{t.name}</p>
          <p className="hero-rec">{k === 'home' ? 'Domicile' : 'Extérieur'}</p>
        </div>
      </div>
    );
  };
  return (
    <header className="hero mesh mesh-foot has-shader">
      <WarpBg c1={pairColors(home.id, away.id).home} c2={pairColors(home.id, away.id).away} />
      <div className="hero-meta">
        <span>
          <SoccerBall size={15} /> {leagueOf(r?.lg ?? m!.lg, r?.league ?? m?.league)}
        </span>
        {round && (
          <>
            <i />
            <span>{roundFr(round)}</span>
          </>
        )}
      </div>
      <div className="hero-grid">
        {team(home, 'home')}
        <div className="hero-mid">
          {st === 'pre' || !m?.score ? (
            <>
              <span className="hero-vs" aria-hidden="true">
                VS
              </span>
              <span className="hero-time">{timeLocal(start)}</span>
            </>
          ) : (
            <>
              <span className="hero-score">
                {m.score[0]}
                <span className="muted">:</span>
                {m.score[1]}
              </span>
              <span className="hero-time">{st === 'in' ? m.minute ?? 'Direct' : 'Final'}</span>
            </>
          )}
        </div>
        {team(away, 'away')}
      </div>
      <p className="hero-date">{new Date(start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    </header>
  );
}

export function FootMatchPage({ id }: { id: string }) {
  const { state, busy, launch, since } = useFootSim(id);
  // Match déjà commencé (programme du jour) : plus de bouton pour le simuler.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    api('?slate=1').then((d: { matches?: SlateMatch[] }) => setStarted(!!d.matches?.some((x) => x.id === id && stateOf(x) !== 'pre')), () => undefined);
  }, [id]);
  return (
    <div className="page">
      <Link href="/" className="back">
        <ArrowLeft size={16} /> Programme Football
      </Link>
      {state.status !== 'loading' && <FootHero id={id} r={state.status === 'done' ? state.result : undefined} />}
      {state.status === 'loading' && <span className="sk sk-hero" aria-busy="true" />}
      {state.status === 'done' && <FootResults r={state.result} />}
      {(state.status === 'queued' || state.status === 'running') && (
        <SimProgress
          queued={state.status === 'queued'}
          start={since ?? (state.startedAt ? Date.parse(state.startedAt) : undefined)}
          title="On joue le match, tir par tir."
          steps={['Demande envoyée', 'Historique, xG, compositions, cotes', '25 000 matchs simulés', 'Publication des résultats']}
          prep={70}
          note="Compter 2 à 4 minutes. La page se met à jour seule, et la simulation continue si vous la quittez."
        />
      )}
      {state.status === 'none' && started && (
        <section className="launch">
          <h2>
            Match commencé, <em>pas de simulation.</em>
          </h2>
          <p className="lede">Ce match n'a pas été simulé avant le coup d'envoi. Razzia ne simule jamais un match déjà commencé.</p>
        </section>
      )}
      {(state.status === 'failed' || (state.status === 'none' && !started)) && (
        <section className="launch">
          {state.status === 'failed' && (
            <div className="alert" role="alert">
              <WarningCircle size={20} weight="bold" />
              <div>
                <p>La simulation n'a pas abouti.</p>
                {state.error && <p className="small muted">{state.error}</p>}
              </div>
            </div>
          )}
          <h2>
            Ce match, <em>joué 25 000 fois.</em>
          </h2>
          <p className="lede">
            Tir par tir : force de chaque équipe en buts et en xG, composition probable ou officielle, forme, score du moment et cartons rouges. Il en sort le
            vainqueur, la double chance, les buts, les scores et les buteurs.
          </p>
          <button className="btn btn-primary btn-blue btn-lg" onClick={launch} disabled={busy}>
            {busy && <span className="spin" />}
            {busy ? 'Lancement' : 'Lancer la simulation'}
          </button>
        </section>
      )}
    </div>
  );
}

// ——— Résultats ———
/** Vainqueur seul : déconseillé sous 60 %, risqué de 60 à 70 % (pastilles rouge et orange, comme au basket et au tennis). */
const WIN_FLIP = 0.6, WIN_RISKY = 0.7;
const LDEM_MIN = 0.65;
const BIG_FAV_ODDS = 1.25;
const SURE_TEXT = 'À 85 % ou plus, ce pronostic est passé 91 % du temps sur 2024 à 2026 (un match sur cinq).';

/** Catégories de paris : double chance, vainqueur, combinés (le combiné rattaché en tête). */
function buildFootCategories(r: FootResult): Category[] {
  const P = r.probs, L = r.labels;
  const o = r.market?.odds;
  const homeFav = r.final.h >= r.final.a;
  const pc = pairColors(r.home.id, r.away.id);
  const nv = o ? (() => { const s = 1 / o.h + 1 / o.d + 1 / o.a; return { '1': 1 / o.h / s, X: 1 / o.d / s, '2': 1 / o.a / s } as Record<string, number>; })() : undefined;
  const oddsOf: Record<string, number | undefined> = { '1': o?.h, X: o?.d, '2': o?.a, 'o2.5': o?.over25, 'u2.5': o?.under25 };
  const whoOf = (id: string): Outcome['who'] => {
    const base = id.split('+')[0];
    const t = base === '1' || base === '1X' || id.startsWith('h') ? r.home : base === '2' || base === 'X2' || id.startsWith('a') ? r.away : undefined;
    return t ? { ...markOf(t), name: t.name } : undefined;
  };
  const item = (id: string): Outcome | undefined => {
    const p = P[id];
    if (p == null || !L[id]) return undefined;
    const who = whoOf(id);
    // Rond au marbre du club concerné ; issue commune aux deux (nul, l'un ou l'autre, les deux marquent) : les deux couleurs.
    const marble = who && who.tri === `f${r.away.id}` ? pc.away : pc.home;
    const out: Outcome = { id, title: L[id], p, who, fair: p > 0 ? 1 / p : undefined, odds: oddsOf[id], implied: nv?.[id], marble, marble2: who ? undefined : pc.away };
    if (r.pick?.id === id) if (r.tier === 'sure') out.safe = 'Razzia assuré';
    if (r.combo.id === id) {
      if (r.combo.risky) out.warn = 'Risqué';
      else if (!out.safe) out.safe = 'Combiné rattaché';
    }
    return out;
  };
  const list = (ids: string[]) => ids.map(item).filter((x): x is Outcome => !!x);
  // Un seul choix par catégorie, celui qui tombe le plus souvent : le vainqueur le plus probable, la double chance la
  // plus probable, le combiné rattaché au match.
  const top = (ids: string[]) => ids.reduce((a, b) => ((P[b] ?? 0) > (P[a] ?? 0) ? b : a));
  const winner = list([top(homeFav ? ['1', '2', 'X'] : ['2', '1', 'X'])]);
  // Vainqueur comme au basket et au tennis : déconseillé (rouge) sous 60 %, risqué (orange) de 60 à 70 %.
  const wp = winner[0]?.p ?? 0;
  const winWarn = wp < WIN_FLIP ? 'Déconseillé' : wp < WIN_RISKY ? 'Risqué' : undefined;
  if (winner[0] && winWarn && !winner[0].warn) winner[0] = { ...winner[0], warn: winWarn, safe: undefined };
  const double = list([top(['1X', 'X2', '12'])]);
  const combos = list([r.combo.id]);
  // Gros favori (cote de la victoire sous 1,25, ou 80 % sans cote) : la double chance ne sert à rien, on l'enlève ; le
  // combiné rattaché va alors chercher la valeur (victoire + buts, victoire par 2 buts ou plus).
  const favOdds = o ? (homeFav ? o.h : o.a) : undefined;
  const bigFav = favOdds != null ? favOdds < BIG_FAV_ODDS : (homeFav ? r.final.h : r.final.a) >= 0.8;
  // Ordre d'affichage : décidé par PickTabs (du plus probable au moins probable, jamais une cote sous 1,20 en premier).
  const cats: Category[] = [
    { id: 'combo', label: 'Combiné', items: combos, risky: r.combo.risky },
    { id: 'win', label: 'Vainqueur', items: winner, warn: winWarn === 'Déconseillé', risky: winWarn === 'Risqué' },
    ...(bigFav ? [] : [{ id: 'double', label: 'Double chance', items: double }]),
  ];
  // Score exact : le plus juste, pas le plus prudent (fairScore : 3-1 dans un match ouvert, 1-1 dans un match équilibré,
  // 1-0 dans un match fermé, réglé pour suivre la vraie répartition des scores) ; toujours « Déconseillé ».
  const sc = fairScore(r.scores, r.final);
  if (sc) {
    const side = sc.h > sc.a ? r.home : sc.h < sc.a ? r.away : undefined;
    cats.push({ id: 'exact', label: 'Score exact', warn: true, items: [{
      id: `exact-${sc.h}-${sc.a}`, title: `${short(r.home.name)} ${sc.h}-${sc.a} ${short(r.away.name)}`, p: sc.p, fair: 1 / sc.p, warn: 'Déconseillé', text: 'Le score qui colle le mieux à la physionomie du match (buts attendus de chaque équipe), pas le plus prudent.',
      who: side ? { ...markOf(side), name: side.name } : undefined, marble: side === r.away ? pc.away : pc.home, marble2: side ? undefined : pc.away,
    }] });
  }
  // LDEM (les deux équipes marquent) : seulement quand c'est à plus de 65 %.
  if ((P.btts ?? 0) > LDEM_MIN) cats.push({ id: 'btts', label: 'LDEM', items: list(['btts']) });
  return cats.filter((c) => c.items.length);
}

function FootVerdict({ r }: { r: FootResult }) {
  const homeFav = r.final.h >= r.final.a;
  const fav = homeFav ? r.home : r.away;
  const dcP = homeFav ? r.final.h + r.final.d : r.final.a + r.final.d;
  const p = r.pick?.p ?? dcP;
  const cls = r.tier === 'flip' ? 'flip' : r.tier === 'sure' ? 'sure' : 'normal';
  const o = r.market?.odds;
  const book = o ? (() => { const s = 1 / o.h + 1 / o.d + 1 / o.a; return (homeFav ? 1 / o.h : 1 / o.a) / s; })() : undefined;
  const favWin = homeFav ? r.final.h : r.final.a;
  return (
    <section className={`verdict verdict-${cls}`}>
      {r.tier === 'risky' && <span className="odds-warn verdict-warn risky">Risqué</span>}
      {r.tier === 'flip' && <span className="odds-warn verdict-warn">Déconseillé</span>}
      <div className="verdict-ring">
        <Ring value={p} format={pct0} label={r.pick ? 'Pronostic' : 'Double chance'} marble={homeFav ? pairColors(r.home.id, r.away.id).home : pairColors(r.home.id, r.away.id).away} />
      </div>
      <div>
        <span className="caps">{r.pick ? 'Pronostic Razzia' : 'Favori Razzia'}</span>
        <p className="verdict-team">
          <Crest t={fav} size="md" /> {r.pick ? r.pick.label : `${short(fav.name)} ou nul`}
        </p>
        <p className="verdict-sub">
          Arrive dans <b className="num">{pct(p)}</b> des simulations.
          {!r.pick && r.tier === 'risky' && ' Aucun pronostic assez sûr ici.'}
        </p>
        {r.tier === 'sure' && (
          <Callout tone="badge-sure" icon={<ShieldCheck size={19} weight="light" />} title="Razzia assuré">
            <p>{SURE_TEXT}</p>
          </Callout>
        )}
        {r.tier === 'flip' && (
          <Callout tone="badge-flip" icon={<Coins size={20} weight="fill" />} title="Pile ou face">
            <p>
              Même {short(fav.name)} ou nul n'arrive que dans {pct(dcP)} des simulations. Match trop ouvert pour un pronostic.
            </p>
          </Callout>
        )}
        <p className="verdict-sub">
          Combiné rattaché : <b>{r.combo.label}</b> ({pct(r.combo.p)}){r.combo.risky ? ', risqué, hors bilan.' : '.'}
        </p>
        <div className="split" role="img" aria-label={`${r.home.name} ${pct(r.final.h)}, nul ${pct(r.final.d)}, ${r.away.name} ${pct(r.final.a)}`}>
          <div className="split-bar">
            <span className={`h${homeFav ? ' is-fav' : ''}`} style={{ flexGrow: r.final.h }} />
            <span className="d" style={{ flexGrow: r.final.d }} />
            <span className={`a${!homeFav ? ' is-fav' : ''}`} style={{ flexGrow: r.final.a }} />
          </div>
          <div className="split-legend">
            <span className={homeFav ? 'is-fav' : ''}>
              {short(r.home.name)} {pct0(r.final.h)}
            </span>
            <span>Nul {pct0(r.final.d)}</span>
            <span className={!homeFav ? 'is-fav' : ''}>
              {pct0(r.final.a)} {short(r.away.name)}
            </span>
          </div>
        </div>
      </div>
      <dl className="verdict-side">
        <div>
          <dt>Victoire {short(fav.name)}</dt>
          <dd>
            {pct(favWin)}{' '}
            {book != null && <span className={`delta ${favWin - book >= 0 ? 'up' : 'down'}`}>{`${favWin - book >= 0 ? '+' : ''}${((favWin - book) * 100).toFixed(1).replace('.', ',')} pt`}</span>}
          </dd>
        </div>
        <div>
          <dt>Les deux marquent</dt>
          <dd>{pct0(r.probs.btts ?? 0)}</dd>
        </div>
      </dl>
    </section>
  );
}

const WHY: Record<string, string> = { injury: 'Blessé', suspension: 'Suspendu', international: 'Sélection', doubtful: 'Incertain', other: 'Absent' };

function FootResults({ r }: { r: FootResult }) {
  const cats = useMemo(() => buildFootCategories(r), [r]);
  const cols = useMemo(() => pairColors(r.home.id, r.away.id), [r]);
  const homeFav = r.final.h >= r.final.a;
  const maxScorer = r.scorers[0]?.p ?? 1;
  return (
    <SideColors.Provider value={cols}>
      <div className="results team-marble" style={marbleVars(cols, homeFav)}>
        <div className="res-head">
          <span className="slash">
            {leagueOf(r.lg, r.league)}
            {r.round ? ` · ${roundFr(r.round)}` : ''} · {new Date(r.start).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {r.market ? '' : ' · sans cote, moteur seul'}
          </span>
        </div>
        <FootVerdict r={r} />
        <Section title="Pronostics par catégorie" tag="issue la plus fréquente">
          <PickTabs cats={cats} n={r.n} />
        </Section>
        {r.flow && (
          <Section title="Le déroulé du match" tag="scénario le plus probable">
            <FootFlow r={r} />
          </Section>
        )}
        <Section title="Premier but" tag="qui ouvre le score">
          <FirstGoal r={r} />
        </Section>
        {r.scorers.length > 0 && (
          <Section title="Buteurs probables" tag="marque au moins un but">
            <ul className="f-scorers">
              {r.scorers.slice(0, 8).map((s) => (
                <li key={s.id} className={s.side === 'home' ? 'h' : 'a'}>
                  <Crest t={r[s.side]} size="sm" />
                  <span className="f-name">{s.name}</span>
                  <span className="f-bar">
                    <span style={{ width: `${(s.p / maxScorer) * 100}%` }} />
                  </span>
                  <b className="mono">{pct0(s.p)}</b>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Compositions" tag={r.lineupType === 'standard' || r.lineupType === 'official' ? 'officielles' : r.lineupType === 'predicted' ? 'probables' : 'pas encore connues'}>
          <div className="f-lineups">
            {(['home', 'away'] as const).map((k, i) => {
              const l = r.lineups[i];
              return (
                <div key={k} className="f-lineup">
                  <p className="f-lineup-head">
                    <Crest t={r[k]} size="sm" /> <b>{short(r[k].name)}</b>
                    {l?.formation && <span className="mono muted">{l.formation}</span>}
                  </p>
                  {l?.coach && <p className="small muted">Entraîneur : {l.coach}</p>}
                  {l?.starters.length ? <p className="f-starters">{l.starters.join(', ')}</p> : <p className="small muted">Composition pas encore publiée.</p>}
                  {l && l.out.length > 0 && (
                    <ul className="f-out">
                      {l.out.map((x) => (
                        <li key={x.name}>
                          <span>{x.name}</span>
                          <span className="muted small">{WHY[x.why] ?? 'Absent'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
        {r.h2h && r.h2h.length > 0 && <H2H r={r} />}
        <p className="footnote">
          Données jusqu'au {new Date(r.meta.builtAt).toLocaleDateString('fr-FR')} : {r.meta.gamesUsed.toLocaleString('fr-FR')} matchs (FotMob : buts, xG, tirs, compositions)
          {r.market ? `, cotes ${r.market.src === 'pinnacle' ? 'Pinnacle' : 'moyennes'} (football-data)` : ''}. Probabilité Razzia : 80 % marché, 20 % moteur en championnat quand une cote
          existe, moteur seul sinon. Les probabilités décrivent le modèle, pas une certitude. Jouer comporte des risques.
        </p>
      </div>
    </SideColors.Provider>
  );
}

/** Premier but : barre aux couleurs des deux clubs (pas de but au milieu), logo et pourcentage de chaque côté. */
function FirstGoal({ r }: { r: FootResult }) {
  const [h, a, none] = r.firstGoal;
  return (
    <div className="f-fg">
      <div className="f-fg-bar" role="img" aria-label={`${r.home.name} ${pct0(h)}, pas de but ${pct0(none)}, ${r.away.name} ${pct0(a)}`}>
        <span className="h" style={{ flexGrow: h }} />
        <span className="d" style={{ flexGrow: none }} />
        <span className="a" style={{ flexGrow: a }} />
      </div>
      <div className="f-fg-legend">
        <div className="f-fg-side h">
          <Crest t={r.home} size="md" />
          <div>
            <b className="mono">{pct0(h)}</b>
            <span><span className="t-lg">{short(r.home.name)}</span><span className="t-sm">{tri(r.home.name)}</span> marque en premier</span>
          </div>
        </div>
        <div className="f-fg-mid">
          <b className="mono">{pct0(none)}</b>
          <span>Pas de but</span>
        </div>
        <div className="f-fg-side a">
          <div>
            <b className="mono">{pct0(a)}</b>
            <span><span className="t-lg">{short(r.away.name)}</span><span className="t-sm">{tri(r.away.name)}</span> marque en premier</span>
          </div>
          <Crest t={r.away} size="md" />
        </div>
      </div>
    </div>
  );
}

/**
 * Le déroulé le plus probable : le scénario le plus fréquent du score le plus probable, sur une frise de 0 à 90 minutes
 * (buts du domicile au-dessus, de l'extérieur en dessous, la frise prend la couleur de l'équipe qui mène), puis qui mène
 * à la mi-temps et à la fin sur l'ensemble des simulations.
 */
function FootFlow({ r }: { r: FootResult }) {
  const flow = r.flow!;
  const t = r.typical;
  const pos = (m: number) => `${(Math.min(m, 90) / 90) * 100}%`;
  let gh = 0, ga = 0;
  const goals = (t?.goals ?? []).map((g) => {
    const d0 = g.side === 'home' ? gh - ga : ga - gh;
    const first = gh + ga === 0;
    if (g.side === 'home') gh++;
    else ga++;
    const kind = first ? 'ouvre le score' : d0 === -1 ? 'égalise' : d0 === 0 ? 'repasse devant' : d0 > 0 ? "creuse l'écart" : "réduit l'écart";
    return { ...g, score: `${gh}-${ga}`, kind, lead: gh > ga ? 'h' : gh < ga ? 'a' : 'd' };
  });
  // Tronçons de la frise : de but en but, à la couleur de l'équipe qui mène.
  const cuts = [0, ...goals.map((g) => Math.min(g.min, 90)), 90];
  const segs = cuts.slice(0, -1).map((from, k) => ({ from, to: cuts[k + 1], lead: k === 0 ? 'd' : goals[k - 1].lead }));
  const ht = flow[8], ft = flow[flow.length - 1];
  const bar = (f: [number, number, number], label: string) => (
    <div className="f-lead">
      <span className="f-lead-k">{label}</span>
      <div className="f-lead-bar">
        <span className="h" style={{ flexGrow: f[0] }}>{f[0] >= 0.12 && `${tri(r.home.name)} ${pct0(f[0])}`}</span>
        <span className="d" style={{ flexGrow: f[1] }}>{f[1] >= 0.12 && `Nul ${pct0(f[1])}`}</span>
        <span className="a" style={{ flexGrow: f[2] }}>{f[2] >= 0.12 && `${tri(r.away.name)} ${pct0(f[2])}`}</span>
      </div>
    </div>
  );
  return (
    <div className="f-flow">
      {t && (
        <p className="f-flow-lede">
          {t.given === 'home' || t.given === 'away' ? (
            <>
              Si {short(r[t.given].name)} gagne ({pct0(t.given === 'home' ? r.final.h : r.final.a)}), le score le plus probable est{' '}
              <b>
                {short(r.home.name)} {t.score[0]}-{t.score[1]} {short(r.away.name)}
              </b>
              .{' '}
            </>
          ) : (
            <>
              Score le plus probable : <b>{short(r.home.name)} {t.score[0]}-{t.score[1]} {short(r.away.name)}</b>.{' '}
            </>
          )}
          {goals.length === 0
            ? 'Aucun but de tout le match.'
            : `Le plus souvent : ${goals.map((g) => `${short(r[g.side].name)} ${g.kind} vers la ${g.min}e`).join(', ')}.`}
        </p>
      )}
      <div className="f-tl">
        <div className="f-tl-row h">
          {goals.filter((g) => g.side === 'home').map((g, i) => (
            <span key={i} className="f-tl-goal" style={{ left: pos(g.min) }}>
              <Crest t={r.home} size="sm" />
              <b className="mono">{g.min}'</b>
              <span className="f-tl-score mono">{g.score}</span>
              <i />
            </span>
          ))}
        </div>
        <div className="f-tl-track">
          {segs.map((sg, i) => (
            <span key={i} className={sg.lead} style={{ left: pos(sg.from), width: `${((sg.to - sg.from) / 90) * 100}%` }} />
          ))}
          <em style={{ left: '50%' }} />
        </div>
        <div className="f-tl-row a">
          {goals.filter((g) => g.side === 'away').map((g, i) => (
            <span key={i} className="f-tl-goal" style={{ left: pos(g.min) }}>
              <i />
              <Crest t={r.away} size="sm" />
              <b className="mono">{g.min}'</b>
              <span className="f-tl-score mono">{g.score}</span>
            </span>
          ))}
        </div>
        <div className="f-tl-axis mono">
          <span>Coup d'envoi</span>
          <span>Mi-temps</span>
          <span>90'</span>
        </div>
      </div>
      <div className="f-leads">
        <p className="f-leads-k">Qui mène, sur les {r.n.toLocaleString('fr-FR')} matchs simulés</p>
        {bar(ht, 'À la mi-temps')}
        {bar(ft, 'À la fin')}
      </div>
    </div>
  );
}

/** Confrontations : les derniers matchs entre les deux équipes, score en clair, vainqueur en gras. */
function H2H({ r }: { r: FootResult }) {
  const list = r.h2h!;
  const name = (id: number) => (id === r.home.id ? r.home.name : r.away.name);
  let wh = 0, wa = 0, d = 0;
  for (const g of list) {
    const w = g.score[0] > g.score[1] ? g.home : g.score[0] < g.score[1] ? g.away : 0;
    if (!w) d++;
    else if (w === r.home.id) wh++;
    else wa++;
  }
  return (
    <Section title="Confrontations" tag={`${tri(r.home.name)} ${wh} · nuls ${d} · ${tri(r.away.name)} ${wa}`}>
      <ul className="f-h2h">
        {list.map((g) => {
          const hw = g.score[0] > g.score[1], aw = g.score[0] < g.score[1];
          return (
            <li key={g.date}>
              <span className="mono muted">{new Date(g.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span className="f-h2h-m">
                <span className={hw ? 'w' : undefined}>{short(name(g.home))}</span>
                <b className="mono">
                  {g.score[0]}-{g.score[1]}
                </b>
                <span className={aw ? 'w' : undefined}>{short(name(g.away))}</span>
              </span>
              <span className="muted small">{leagueOf(g.lg, g.league)}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
