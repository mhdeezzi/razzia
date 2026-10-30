// Onglet Tennis (ATP) : programme d'après les cotes Pinnacle notées, fiche de match avec la simulation (25 000 matchs point
// par point), mêmes principes que la NBA : vainqueur ou « Un set », pile ou face, Razzia assuré.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, CaretRight, PawPrint, HouseLine, HouseSimple, ListBullets, Mountains, Scales, ShieldCheck, SquaresFour, TennisBall, TrendDown, TrendUp, Trophy, WarningCircle, X } from '@phosphor-icons/react';
import { Callout, Empty, Link, PageHero, ProgressLine, Ring, Segmented, SimProgress } from './ui.tsx';
import { PickOdds, PickTabs } from './results.tsx';
import { MoneyFlow } from './money.tsx';
import { WarpBg } from './shaders.tsx';
import { PublicRecord } from './record.tsx';
import { atpHype } from './hype.ts';
import { buildTennisCategories, favOf, flipOf, T_HEDGE_FIRST, T_RISKY, T_SURE } from './tennispicks.ts';
import { shown, type Outcome } from './picks.ts';
import { TennisTypical, type TypicalTennis } from './tennistypical.tsx';

// ——— Données ———
export interface TennisPlayer {
  name: string; ioc?: string; hand?: string; ht?: number; age?: number; rank?: number; matches: number; elo: number; serve: number; ret: number;
  daysOff: number; tourneyMinutes: number; played14: number; layoff: boolean; photo?: string; photoAlt?: string; atp?: string;
  form10?: number; trend?: 'up' | 'down'; goal?: boolean; surfaceEdge?: number;
  surfaceSeason: { won: number; lost: number };
  form: Array<{ date: string; tourney: string; round: string; surface: string; opponent: string; won: boolean; score: string }>;
}
interface Odds { ml?: [number, number]; set1?: [number, number]; sets?: Array<{ line: number; home: number; away: number }>; totalGames?: Array<{ line: number; over: number; under: number }> }
export interface TennisResult {
  id: string; day: string; start: string; league: string; tourney: string; round: string; surface: string; indoor?: boolean; bestOf: 3 | 5;
  home: TennisPlayer; away: TennisPlayer; pHome: number; pAway: number;
  engine: { pHome: number; elo: number; point: number; factors: Array<{ key: string; label: string; z: number }>; marketWeight: number };
  market: { pHome?: number; pHomeOpen?: number; odds?: Odds; oddsOpen?: Odds; moves?: Array<{ at: string; ml: [number, number] }> };
  sim: { n: number; pA: number; pB: number; win: number; firstSet: number; scores: Record<string, number>; atLeast1: [number, number]; atLeast2: [number, number]; straight: [number, number]; tiebreak: number; games: { mean: number; p10: number; p50: number; p90: number }; typical?: TypicalTennis };
  h2h: Array<{ date: string; tourney: string; round: string; surface: string; won: boolean; score: string }>;
  h2hCount?: { home: number; away: number; since: string };
  blackCat?: { victim: 'home' | 'away'; lost: number; n: number; since: string; text: string };
  meta: { builtAt: string; matchesUsed: number; n: number };
}
type Live = { state: 'pre' | 'in' | 'post'; ended?: 'final' | 'retired' | 'walkover'; detail?: string; home: Array<{ g: number; tb?: number; w?: boolean }>; away: Array<{ g: number; tb?: number; w?: boolean }>; winner?: 'home' | 'away' };
// noOdds : match pas encore coté par Pinnacle (calendrier ESPN) : simulé avec le moteur seul.
interface SlateMatch { id: string; day: string; league: string; start: string; home: string; away: string; odds?: Odds; oddsOpen?: Odds; live?: Live; noOdds?: boolean }
interface SimIndex { id: string; day: string; home: string; away: string; pHome: number; at: string; cat?: string; trend?: { home?: 'up' | 'down'; away?: 'up' | 'down' }; goal?: { home?: boolean; away?: boolean }; flip?: boolean }
interface PlayerCard { atp?: string; ioc?: string; rank?: number; age?: number; wiki?: string | null }
type State = { status: 'loading' } | { status: 'none' } | { status: 'queued' | 'running'; startedAt?: string; url?: string } | { status: 'done'; result: TennisResult } | { status: 'failed'; error?: string; url?: string };

const api = async (q: string, init?: RequestInit) => {
  const r = await fetch(`/api/tennis${q}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Erreur ${r.status}`);
  return j;
};
const pendingKey = (id: string) => `tennis-req-${id}`;
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* stockage indisponible */ } } };

const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const pct0 = (v: number) => `${Math.round(v * 100)} %`;
const dec = (v: number) => v.toFixed(2).replace('.', ',');
const timeLocal = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const surfaceFr: Record<string, string> = { Hard: 'Dur', Clay: 'Terre battue', Grass: 'Gazon' };
const tourneyOf = (league: string) => league.replace(/^ATP\s+/, '').split(' - ')[0];
const roundOf = (league: string) => league.split(' - ')[1] ?? '';
const ROUND_FR: Record<string, string> = { F: 'Finale', SF: 'Demi-finale', QF: 'Quart de finale', R16: '8e de finale', R32: '16e de finale', R64: '32e de finale', R128: '64e de finale', R1: '1er tour', R2: '2e tour', R3: '3e tour', R4: '8e de finale' };
const ROUND_SHORT: Record<string, string> = { F: 'Finale', SF: 'Demi', QF: 'Quart', R16: '8e', R32: '16e', R64: '32e', R128: '64e', R4: '8e' };
/** « Nikoloz Basilashvili » -> « N. Basilashvili » (téléphone). */
const short = (n: string) => { const [first, ...rest] = n.split(' '); return rest.length ? `${first[0]}. ${rest.join(' ')}` : n; };
// Pays de chaque tournoi (code CIO, comme le pays des joueurs) : un joueur de ce pays joue à domicile.
const COUNTRY: Record<string, string> = {
  'Australian Open': 'AUS', 'French Open': 'FRA', 'Roland Garros': 'FRA', Wimbledon: 'GBR', 'US Open': 'USA',
  "'s-Hertogenbosch": 'NED', Acapulco: 'MEX', Adelaide: 'AUS', Almaty: 'KAZ', Antwerp: 'BEL', Astana: 'KAZ', Athens: 'GRE', Atlanta: 'USA',
  Auckland: 'NZL', 'Banja Luka': 'BIH', Barcelona: 'ESP', Basel: 'SUI', Bastad: 'SWE', Beijing: 'CHN', Belgrade: 'SRB', Bogota: 'COL',
  Brisbane: 'AUS', Brussels: 'BEL', Bucharest: 'ROU', 'Buenos Aires': 'ARG', Canada: 'CAN', Chengdu: 'CHN', Cincinnati: 'USA',
  Cordoba: 'ARG', Dallas: 'USA', 'Delray Beach': 'USA', Doha: 'QAT', Dubai: 'UAE', Eastbourne: 'GBR', Estoril: 'POR', Florence: 'ITA',
  Geneva: 'SUI', Gijon: 'ESP', Gstaad: 'SUI', Halle: 'GER', Hamburg: 'GER', Hangzhou: 'CHN', 'Hong Kong': 'HKG', Houston: 'USA',
  'Indian Wells': 'USA', Kitzbuhel: 'AUT', London: 'GBR', 'Los Cabos': 'MEX', Lyon: 'FRA', Madrid: 'ESP', Mallorca: 'ESP',
  Marrakech: 'MAR', Marseille: 'FRA', Melbourne: 'AUS', Metz: 'FRA', Miami: 'USA', 'Monte Carlo': 'MON', Montpellier: 'FRA',
  Montreal: 'CAN', Munich: 'GER', Naples: 'ITA', 'New York': 'USA', Newport: 'USA', Paris: 'FRA', Pune: 'IND', 'Queens Club': 'GBR',
  'Rio de Janeiro': 'BRA', Rome: 'ITA', Rotterdam: 'NED', Santiago: 'CHI', Seoul: 'KOR', Shanghai: 'CHN', Sofia: 'BUL',
  Stockholm: 'SWE', Stuttgart: 'GER', Sydney: 'AUS', 'Tel Aviv': 'ISR', Tokyo: 'JPN', Toronto: 'CAN', Turin: 'ITA', Umag: 'CRO',
  Vienna: 'AUT', Washington: 'USA', 'Winston-Salem': 'USA',
};
/** Le joueur joue-t-il dans son pays ? */
const atHome = (league: string, ioc?: string) => !!ioc && COUNTRY[tourneyOf(league)] === ioc;
const initials = (n: string) => n.split(' ').map((x) => x[0]).slice(0, 2).join('');

/** Photo officielle ATP d'après le code du joueur. */
const atpHeadshot = (code: string) => `https://www.atptour.com/-/media/alias/player-headshot/${code.toLowerCase()}`;

/** Photo du joueur : officielle ATP, sinon Wikipédia, sinon ses initiales. */
export function Avatar({ name, photo, alt, size = 'md' }: { name: string; photo?: string; alt?: string; size?: 'sm' | 'row' | 'md' | 'lg' | 'xl' }) {
  const srcs = [photo, alt].filter((x): x is string => !!x);
  const [i, setI] = useState(0);
  return (
    <span className={`t-ava t-ava-${size}`} aria-hidden="true">
      {i < srcs.length ? (
        <img key={srcs[i]} src={srcs[i]} alt="" loading="lazy" decoding="async" className={photo && i === 0 ? 'atp' : undefined} onError={() => setI(i + 1)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

// ——— Toute la journée ———
// Un seul passage GitHub simule tous les matchs à venir d'une journée (une minute ou deux). Une journée à la fois :
// la demande vit dans le navigateur ; chaque match la reprend aussi à son compte, pour le suivi depuis sa fiche.
interface DayRun { req: string; at: number; day: string; ids: string[]; status: 'sending' | 'queued' | 'running' | 'done' | 'failed'; startedAt?: string; url?: string; endedAt?: number; error?: string }
const DAY_KEY = 'tennis-journee';
const DAY_KEEP = 30 * 60e3; // une journée terminée reste affichée une demi-heure
const DAY_MAX = 40 * 60e3; // au-delà, une journée bloquée ne verrouille plus le bouton
const ended = (r?: DayRun) =>
  !r || r.status === 'done' || r.status === 'failed' || Date.now() - r.at > DAY_MAX || (r.status === 'sending' && Date.now() - r.at > 2 * 60e3);
const loadDayRun = (): DayRun | undefined => {
  try {
    const r = JSON.parse(store.get(DAY_KEY) ?? 'null') as DayRun | null;
    return r && Date.now() - (r.endedAt ?? r.at) < (r.endedAt ? DAY_KEEP : DAY_MAX) ? r : undefined;
  } catch {
    return undefined;
  }
};

function useDayRun(onDone: () => void) {
  const [run, setRun] = useState(loadDayRun);
  const save = useCallback((r?: DayRun) => {
    store.set(DAY_KEY, r ? JSON.stringify(r) : null);
    setRun(r);
  }, []);
  useEffect(() => {
    if (!run?.req || ended(run)) return;
    const t = window.setTimeout(async () => {
      try {
        const s = await api(`?req=${run.req}`);
        const done = s.status === 'done' || s.status === 'failed';
        save({ ...run, status: s.status, startedAt: s.startedAt ?? run.startedAt, url: s.url ?? run.url, endedAt: done ? Date.now() : undefined });
        if (done) onDone();
      } catch {
        save({ ...run }); // réseau : nouvel essai au prochain tour
      }
    }, 6000);
    return () => window.clearTimeout(t);
  }, [run, save, onDone]);
  const start = async (day: string, list: SlateMatch[]) => {
    if (!ended(run) || !list.length) return;
    const r: DayRun = { req: '', at: Date.now(), day, ids: list.map((m) => m.id), status: 'sending' };
    save(r);
    try {
      const { req } = await api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: r.ids, days: list.map((m) => m.day) }) });
      for (const id of r.ids) store.set(pendingKey(id), req);
      save({ ...r, req, status: 'queued' });
    } catch (e) {
      save({ ...r, status: 'failed', error: (e as Error).message, endedAt: Date.now() });
    }
  };
  return { run, start, dismiss: () => ended(run) && save(undefined) };
}

const dayName = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Suivi de la journée : une ligne remplie au fil des matchs publiés, et le chrono. */
const SETTLE = 2 * 60e3; // après la fin chez GitHub, le temps laissé à la publication avant de parler d'échec
const publishedSince = (run: DayRun) => Date.parse(run.startedAt ?? new Date(run.at).toISOString()) - 60e3;
/** Journée terminée chez GitHub, dont des matchs manquent encore à la liste depuis moins de 2 minutes. */
function publishing(run: DayRun, sims: Map<string, SimIndex>) {
  if (!ended(run) || run.status === 'sending' || !run.endedAt || Date.now() - run.endedAt > SETTLE) return false;
  return run.ids.some((id) => !(sims.get(id) && Date.parse(sims.get(id)!.at) >= publishedSince(run)));
}

function DayTracker({ run, sims, onClose }: { run: DayRun; sims: Map<string, SimIndex>; onClose: () => void }) {
  const settling = publishing(run, sims);
  const live = !ended(run) || settling;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  const since = publishedSince(run);
  const state = (id: string) => (sims.get(id) && Date.parse(sims.get(id)!.at) >= since ? 'done' : live ? (run.status === 'running' ? 'running' : 'queued') : 'failed');
  const done = run.ids.filter((id) => state(id) === 'done').length;
  const failed = run.ids.length - done;
  const s = Math.max(0, Math.round(((settling ? now : run.endedAt ?? now) - run.at) / 1000));
  // Journée finie : le suivi se ferme seul (un peu plus tard s'il y a des échecs, le temps de les voir).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (live) return;
    const t = window.setTimeout(() => close.current(), failed ? 10000 : 4000);
    return () => window.clearTimeout(t);
  }, [live, failed]);
  return (
    <section className="batch" aria-live="polite">
      <div className="batch-head">
        <p className="batch-title">
          {settling ? 'Publication des résultats' : live ? 'Simulation de la journée' : failed ? 'Journée simulée, avec des échecs' : 'Journée simulée'} <span>· {dayLongOf(run.day)}</span>
        </p>
        <span className="batch-clock mono">
          {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
        </span>
        {!live && (
          <button className="batch-x" onClick={onClose} aria-label="Fermer le suivi">
            <X size={14} weight="bold" />
          </button>
        )}
      </div>
      <ProgressLine done={done} failed={live ? 0 : failed} n={run.ids.length} running={live} />
      <div className="batch-legend">
        <span>
          <i className="lg-done" /> {done}/{run.ids.length} publiés
        </span>
        {!live && failed > 0 && (
          <span>
            <i className="lg-fail" /> {failed} en échec{run.error ? ` : ${run.error}` : ''}
          </span>
        )}
        <span className="muted">{live ? 'Compter une à deux minutes ; le calcul continue si vous quittez la page.' : 'Ouvrez un match pour voir sa simulation.'}</span>
      </div>
    </section>
  );
}

// ——— Programme ———
// Même agencement que le programme NBA : jour en titre, filtre à venir / en direct / terminés, bande des jours,
// « Simuler toute la journée », puis les matchs par tournoi (liste) ou en cartes (grille).
type Status = 'pre' | 'in' | 'post';
type View = 'liste' | 'grille';
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** Jour local (AAAA-MM-JJ) d'une heure ISO. */
const localDay = (iso: string | number) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLongOf = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
/** État du match : celui d'ESPN, sinon d'après l'heure (en direct jusqu'à 4 heures après le début). */
const stateOf = (m: SlateMatch): Status => m.live?.state ?? (Date.parse(m.start) > Date.now() ? 'pre' : Date.now() - Date.parse(m.start) < 4 * 3_600_000 ? 'in' : 'post');
const setsWon = (l: Live, side: 'home' | 'away') => l[side].filter((x) => x.w).length;
const storedView = (): View => (store.get('vue') === 'grille' ? 'grille' : 'liste');

export function TennisSchedulePage({ day }: { day: string | null }) {
  const [data, setData] = useState<{ matches: SlateMatch[]; sims: SimIndex[]; players?: Record<string, PlayerCard> }>();
  const [error, setError] = useState<string>();
  const [view, setView] = useState<View>(storedView);
  const [status, setStatus] = useState<Status>('pre');
  // `fresh` contourne le cache du CDN (60 s) : juste après une simulation, la liste doit déjà la contenir.
  const load = useCallback((fresh = false) => api(`?slate=1${fresh ? `&v=${Date.now()}` : ''}`).then(setData, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => store.set('vue', view), [view]);
  const reload = useCallback(() => void load(true), [load]);
  const { run, start, dismiss } = useDayRun(reload);
  const busy = !ended(run);
  const sims = new Map((data?.sims ?? []).map((s) => [s.id, s]));
  // Journée finie chez GitHub mais pas encore toute dans la liste (publication et caches) : relue toutes les 5 s.
  const settling = !!run && publishing(run, sims);
  useEffect(() => {
    if (!settling) return;
    const t = window.setTimeout(reload, 5000);
    return () => window.clearTimeout(t);
  }, [settling, data, reload]);

  // Hier, aujourd'hui et les six jours suivants, à l'heure locale.
  const dates = useMemo(() => Array.from({ length: 8 }, (_, i) => localDay(Date.now() + (i - 1) * 86_400_000)), [data]);
  const byDay = useMemo(() => {
    const m = new Map<string, SlateMatch[]>(dates.map((d) => [d, []]));
    for (const x of data?.matches ?? []) m.get(localDay(x.start))?.push(x);
    for (const list of m.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  }, [data, dates]);
  const today = dates[1];
  const firstWithMatches = dates.slice(1).find((d) => (byDay.get(d)?.length ?? 0) > 0) ?? today;
  const current = day && byDay.has(day) ? day : firstWithMatches;
  const dayMatches = byDay.get(current) ?? [];
  const count = (st: Status) => dayMatches.filter((m) => stateOf(m) === st).length;
  // Le filtre suit le jour : on bascule sur un statut qui a des matchs.
  useEffect(() => {
    if (dayMatches.length && !dayMatches.some((m) => stateOf(m) === status)) setStatus((['in', 'pre', 'post'] as const).find((st) => dayMatches.some((m) => stateOf(m) === st))!);
  }, [current, data]);
  // Matchs en direct : programme relu chaque minute.
  const anyLive = dayMatches.some((m) => stateOf(m) === 'in');
  useEffect(() => {
    if (!anyLive) return;
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [anyLive, load]);
  const shown = dayMatches.filter((m) => stateOf(m) === status);
  const groups = [...shown.reduce((g, m) => g.set(tourneyOf(m.league), [...(g.get(tourneyOf(m.league)) ?? []), m]), new Map<string, SlateMatch[]>())];
  // À simuler : les matchs à venir pas encore simulés (une fois la journée faite, le bouton disparaît).
  const todo = dayMatches.filter((m) => stateOf(m) === 'pre' && !sims.has(String(m.id)));
  const inRun = (id: string) => busy && run!.ids.includes(id);

  return (
    <div className="page">
      <PageHero sport="atp" title="Programme ATP" day={cap(dayLongOf(current))} count={dayMatches.length} feature={<TennisUne matches={dayMatches} sims={sims} players={data?.players} />}>
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
      <PublicRecord sport="atp" />

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
                <Link key={d} href={`/tennis?jour=${d}`} replace className={`day${d === current ? ' is-on' : ''}${n ? '' : ' is-empty'}`}>
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
                  <Link href={`/tennis?jour=${run!.day}`} replace>
                    Voir
                  </Link>
                </p>
              )}
              <button className="btn-soiree" disabled={busy} onClick={() => void start(current, todo)} title={busy ? undefined : `Simule les ${todo.length} matchs à venir de ce jour, en un seul passage`}>
                {busy && run!.day === current ? 'Journée en cours' : 'Simuler toute la journée'}
                <span className="n">{busy && run!.day === current ? `${run!.ids.length} matchs` : `${todo.length} match${todo.length > 1 ? 's' : ''}`}</span>
              </button>
            </div>
          )}
          {run && run.day === current && <DayTracker run={run} sims={sims} onClose={dismiss} />}

          {dayMatches.length === 0 ? (
            <Empty title="Pas de match ATP coté ce jour-là." />
          ) : view === 'liste' ? (
            // Toute la journée dans une seule carte, comme la NBA ; chaque tournoi séparé par une barre blanche.
            <section className="league-card" key={`${current}-${status}`}>
              <div className="league-top">
                <h2>ATP</h2>
                <span className="badge-n">{shown.length}</span>
                <span className="muted">Heures dans votre fuseau</span>
              </div>
              <div className="thead t-row" aria-hidden="true">
                <span>Heure</span>
                <span className="c">Match</span>
                <span className="c">Cotes</span>
                <span className="c">Simulation</span>
                <span />
              </div>
              {groups.map(([tourney, list]) => (
                <div className="t-group" key={tourney}>
                  <p className="t-group-head">
                    {tourney} <span className="badge-n">{list.length}</span>
                  </p>
                  <ol className="rows">
                    {list.map((m, i) => (
                      <li key={m.id}>
                        <TennisRow m={m} sim={sims.get(m.id)} players={data.players} running={inRun(m.id)} i={i} />
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </section>
          ) : (
            <div className="cards" key={`${current}-${status}`} style={{ '--w': tennisNameWidth(shown).toFixed(2) } as CSSProperties}>
              {shown.map((m, i) => (
                <TennisCard key={m.id} m={m} sim={sims.get(m.id)} players={data.players} running={inRun(m.id)} i={i} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Heure ou sets gagnés, et l'étiquette du tour (à venir), « Direct » ou « Final ». */
function TimeCell({ m }: { m: SlateMatch }) {
  const st = stateOf(m);
  const round = roundOf(m.league);
  return (
    <div className="row-time">
      <span className="t">{st === 'pre' || !m.live ? timeLocal(m.start) : `${setsWon(m.live, 'home')}-${setsWon(m.live, 'away')}`}</span>
      {st === 'in' ? (
        <span className="pill-tag live">
          <span className="live-dot" /> Direct
        </span>
      ) : st === 'post' ? (
        <span className="pill-tag final">{m.live?.ended === 'retired' ? 'Abandon' : m.live?.ended === 'walkover' ? 'Forfait' : 'Final'}</span>
      ) : (
        <span className="pill-tag">
          <span className="t-lg">{ROUND_FR[round] ?? round}</span>
          <span className="t-sm">{ROUND_SHORT[round] ?? ROUND_FR[round] ?? round}</span>
        </span>
      )}
    </div>
  );
}

/** Jeux de chaque set (jeu décisif du perdant du set entre parenthèses), ou classement et pays avant le match. */
function subLine(m: SlateMatch, side: 'home' | 'away', c?: PlayerCard) {
  const l = m.live;
  if (l && l.state !== 'pre' && l[side].length) return l[side].map((x) => `${x.g}${x.tb != null && !x.w ? `(${x.tb})` : ''}`).join('  ');
  return [c?.rank != null ? `n° ${c.rank}` : '', c?.ioc ?? ''].filter(Boolean).join(' · ');
}

/** Joueur comme une équipe NBA : photo à côté du nom, flèche de forme, ligne du dessous (classement ou jeux). */
function Who({ m, side, players, sim, align, size = 'row' }: { m: SlateMatch; side: 'home' | 'away'; players?: Record<string, PlayerCard>; sim?: SimIndex; align?: 'away'; size?: 'row' | 'lg' }) {
  const name = m[side], c = players?.[name];
  const lost = m.live?.state === 'post' && m.live.winner && m.live.winner !== side;
  const trend = sim?.trend?.[side];
  const ava = <Avatar name={name} photo={c?.atp ? atpHeadshot(c.atp) : undefined} alt={c?.wiki ?? undefined} size={size} />;
  const label = (
    <span className={lost ? 't-lost' : undefined}>
      <span className="vs-name">
        <span className="t-lg">{name}</span>
        <span className="t-sm">{short(name)}</span>
        {trend && (
          <span className={`t-trend ${trend}`} title={trend === 'up' ? 'En hausse' : 'En baisse'} aria-label={trend === 'up' ? 'En hausse' : 'En baisse'}>
            {trend === 'up' ? <TrendUp size={13} weight="bold" /> : <TrendDown size={13} weight="bold" />}
          </span>
        )}
        {sim?.goal?.[side] && (
          <span className="t-goal" title="Objectif Masters" aria-label="Objectif Masters">
            <Trophy size={13} weight="bold" />
          </span>
        )}
        {atHome(m.league, c?.ioc) && (
          <span className="t-home" title="À domicile" aria-label="À domicile">
            <HouseLine size={13} weight="bold" />
          </span>
        )}
      </span>
      <span className="vs-rec">{subLine(m, side, c)}</span>
    </span>
  );
  if (size === 'lg')
    return (
      <div className={`card-team${lost ? ' t-lost' : ''}`}>
        {ava}
        {label}
      </div>
    );
  return (
    <div className={`vs-team${align ? ' away' : ''}`}>
      {!align && ava}
      {label}
      {align && ava}
    </div>
  );
}

/** Favori de la simulation et pile ou face. Pile ou face : calculé avec la règle de la fiche lors de la publication
 * (index) ; pour une simulation indexée avant, la même règle sans la ligne de sets (favori à 80 % ou moins, ou outsider
 * en hausse). */
function favFlip(sim: SimIndex) {
  const fav = sim.pHome >= 0.5 ? { n: sim.home, p: sim.pHome } : { n: sim.away, p: 1 - sim.pHome };
  const dog = sim.pHome >= 0.5 ? sim.away : sim.home;
  const dogUp = sim.trend?.[sim.pHome >= 0.5 ? 'away' : 'home'] === 'up';
  // Index publié avant le passage du seuil à 75 % : on réapplique le seuil actuel.
  const flip = (sim.flip ?? sim.cat !== dog) && (shown(fav.p) <= T_HEDGE_FIRST || dogUp);
  // Couleur de la pastille : rouge « Déconseillé » (70 % ou moins), orange « Risqué » au-dessus, vert sinon.
  const cls = flip ? (shown(fav.p) > T_RISKY ? ' risky' : ' flip') : '';
  return { fav, flip, cls };
}

/** Nom de famille (tout après le prénom) : « De Minaur », « Auger-Aliassime ». */
const lastName = (n: string) => n.split(' ').slice(1).join(' ') || n;

/** Comme au basket : une seule taille de noms pour toutes les cartes, choisie pour que le plus long tienne. */
export const tennisNameWidth = (ms: SlateMatch[]) => Math.max(5, ...ms.flatMap((m) => [lastName(m.home).length * 0.6, lastName(m.away).length * 0.6 + 1.3]));

/** Pastille de simulation, comme au basket : chat noir, favori et son pourcentage ; « Calcul » pendant la journée. */
function TennisSimPill({ sim, running }: { sim?: SimIndex; running: boolean }) {
  if (running)
    return (
      <span className="conf-pill run">
        <span className="spin spin-xs" /> Calcul
      </span>
    );
  if (!sim) return <span className="conf-pill go">Simuler</span>;
  const { fav, cls } = favFlip(sim);
  return (
    <span className={`pill-group${sim.cat ? ' has-cat' : ''}`} title={sim.cat ? `Chat noir pour ${sim.cat}` : undefined}>
      <span className={`conf-pill sim${cls}`}>
        {fav.n.split(' ').at(-1)} <b>{pct0(fav.p)}</b>
      </span>
    </span>
  );
}

function TennisRow({ m, sim, players, running, i }: { m: SlateMatch; sim?: SimIndex; players?: Record<string, PlayerCard>; running: boolean; i: number }) {
  return (
    <Link href={`/tennis/match/${m.day}/${m.id}`} className="row t-row" style={{ '--i': i } as CSSProperties}>
      <TimeCell m={m} />
      <div className="vs-line">
        <Who m={m} side="home" players={players} sim={sim} align="away" />
        <span className="vs-at">vs</span>
        <Who m={m} side="away" players={players} sim={sim} />
      </div>
      <span className="cell-odds">{m.odds?.ml ? `${dec(m.odds.ml[0])} / ${dec(m.odds.ml[1])}` : <span className="muted small">Sans cote</span>}</span>
      <span style={{ textAlign: 'center' }}>
        <TennisSimPill sim={sim} running={running} />
      </span>
      <CaretRight size={16} className="row-caret" />
    </Link>
  );
}

/** « À la une » : le match le plus suivi du jour (classements, tour, tournoi, têtes d'affiche), avec le favori simulé. */
function TennisUne({ matches, sims, players }: { matches: SlateMatch[]; sims: Map<string, SimIndex>; players?: Record<string, PlayerCard> }) {
  const open = matches.filter((m) => stateOf(m) !== 'post');
  const m = [...(open.length ? open : matches)].sort((a, b) => atpHype(b, (n) => players?.[n]?.rank) - atpHype(a, (n) => players?.[n]?.rank))[0];
  if (!m) return null;
  const st = stateOf(m);
  const sim = sims.get(m.id);
  const ff = sim && favFlip(sim);
  const round = roundOf(m.league);
  const ava = (name: string) => {
    const c = players?.[name];
    return <Avatar name={name} photo={c?.atp ? atpHeadshot(c.atp) : undefined} alt={c?.wiki ?? undefined} size="sm" />;
  };
  return (
    <Link href={`/tennis/match/${m.day}/${m.id}`} className="hb-une">
      <span className="hb-une-k">À la une</span>
      <span className="hb-une-m">
        {ava(m.home)}
        <b>
          {lastName(m.home)} <i>vs</i> {lastName(m.away)}
        </b>
        {ava(m.away)}
      </span>
      <span className="hb-une-t mono">
        {st === 'pre' || !m.live ? timeLocal(m.start) : `${setsWon(m.live, 'home')}-${setsWon(m.live, 'away')}`}
        {round ? ` · ${ROUND_SHORT[round] ?? ROUND_FR[round] ?? round}` : ''}
      </span>
      {ff && (
        <span className={`card-a-p${ff.cls}`}>
          {lastName(ff.fav.n)} {pct0(ff.fav.p)}
        </span>
      )}
      <CaretRight size={15} className="hb-une-go" />
    </Link>
  );
}

/** Carte de la grille, comme au basket : noms de famille en gros avec la photo, heure et tournoi en haut, favori et cotes en pied. */
function TennisCard({ m, sim, players, running, i }: { m: SlateMatch; sim?: SimIndex; players?: Record<string, PlayerCard>; running: boolean; i: number }) {
  const st = stateOf(m);
  const round = roundOf(m.league);
  const ff = sim && !running ? favFlip(sim) : undefined;
  const who = (side: 'home' | 'away') => {
    const name = m[side], c = players?.[name];
    const lost = m.live?.state === 'post' && m.live.winner && m.live.winner !== side;
    return (
      <p className={`card-a-team${lost ? ' t-lost' : ''}`}>
        <Avatar name={name} photo={c?.atp ? atpHeadshot(c.atp) : undefined} alt={c?.wiki ?? undefined} size="row" />
        <span className="card-a-name" title={name}>
          {side === 'away' && <i>vs</i>}
          {lastName(name)}
        </span>
        {st !== 'pre' && m.live && <span className="card-a-score mono">{setsWon(m.live, side)}</span>}
      </p>
    );
  };
  return (
    <Link href={`/tennis/match/${m.day}/${m.id}`} className="card card-a" style={{ '--i': i } as CSSProperties}>
      <span className="card-a-top mono">
        {st === 'pre' || !m.live ? timeLocal(m.start) : st === 'in' ? 'En direct' : m.live.ended === 'retired' || m.live.ended === 'walkover' ? `${m.live.ended === 'retired' ? 'Abandon' : 'Forfait'}${m.live.winner ? ` · ${short(m[m.live.winner])} qualifié` : ''}` : 'Terminé'} · {tourneyOf(m.league)}
        {round ? ` · ${ROUND_SHORT[round] ?? ROUND_FR[round] ?? round}` : ''}
      </span>
      <div className="card-a-t">
        {who('home')}
        {who('away')}
      </div>
      <div className="card-a-f">
        {ff ? (
          <span className={`card-a-p${ff.cls}`}>
            {lastName(ff.fav.n)} {pct0(ff.fav.p)}
          </span>
        ) : (
          <TennisSimPill sim={sim} running={running} />
        )}
        <span className="mono muted">{m.odds?.ml ? `${dec(m.odds.ml[0])} / ${dec(m.odds.ml[1])}` : 'Cotes à venir'}</span>
      </div>
    </Link>
  );
}

// ——— Fiche de match ———
function useTennisSim(id: string, day: string) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState<number | undefined>(() => Number(store.get(`${pendingKey(id)}-at`)) || undefined);
  const timer = useRef<number | undefined>(undefined);
  const poll = useCallback(async () => {
    window.clearTimeout(timer.current);
    const req = store.get(pendingKey(id));
    try {
      const s = await api(`?id=${id}&day=${day}${req ? `&req=${req}` : ''}`);
      setState(s);
      if (s.status === 'queued' || s.status === 'running') timer.current = window.setTimeout(poll, 5000);
      else if (req) {
        store.set(pendingKey(id), null);
        store.set(`${pendingKey(id)}-at`, null);
      }
    } catch (e) {
      setState({ status: 'failed', error: (e as Error).message });
    }
  }, [id, day]);
  useEffect(() => {
    void poll();
    return () => window.clearTimeout(timer.current);
  }, [poll]);
  const launch = async () => {
    setBusy(true);
    try {
      const { req } = await api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, day }) });
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

/**
 * Bandeau de la fiche, comme au basket : fond lisse vert et bleu, tournoi et tour, les deux joueurs (photo, nom,
 * classement et pays), « VS » et l'heure avant le match, sets gagnés pendant et après. Les joueurs viennent de la
 * simulation, sinon du programme du jour.
 */
function TennisHero({ id, r }: { id: string; r?: TennisResult }) {
  const [slate, setSlate] = useState<{ matches: SlateMatch[]; players?: Record<string, PlayerCard> }>();
  useEffect(() => {
    void api('?slate=1').then(setSlate, () => setSlate({ matches: [] }));
  }, []);
  const m = slate?.matches.find((x) => x.id === id);
  if (!r && !m) return slate ? null : <span className="sk sk-hero" aria-busy="true" />;
  const st = m ? stateOf(m) : 'pre';
  const league = m?.league ?? '';
  const tourney = r?.tourney ?? tourneyOf(league);
  const round = r?.round ?? roundOf(league);
  const start = r?.start ?? m!.start;
  const player = (k: 'home' | 'away') => {
    const name = r?.[k].name ?? m![k];
    const c = slate?.players?.[name];
    const photo = r?.[k].photo ?? (c?.atp ? atpHeadshot(c.atp) : undefined);
    const alt = r?.[k].photoAlt ?? c?.wiki ?? undefined;
    const rank = r?.[k].rank ?? c?.rank;
    const ioc = r?.[k].ioc ?? c?.ioc;
    const lost = m?.live?.state === 'post' && m.live.winner && m.live.winner !== k;
    return (
      <div className={`hero-team ${k}${lost ? ' t-lost' : ''}`}>
        <Avatar name={name} photo={photo} alt={alt} size="xl" />
        <div>
          <p className="hero-name">{name}</p>
          <p className="hero-rec">{[rank != null ? `n° ${rank}` : '', ioc ?? ''].filter(Boolean).join(' | ')}</p>
        </div>
      </div>
    );
  };
  return (
    <header className="hero mesh mesh-atp has-shader">
      <WarpBg c1="#2a4f9a" c2="#7a3a6e" />
      <div className="hero-meta">
        <span>
          <TennisBall size={15} /> ATP
        </span>
        {tourney && (
          <>
            <i />
            <span>{tourney}</span>
          </>
        )}
        {round && (
          <>
            <i />
            <span>{ROUND_FR[round] ?? round}</span>
          </>
        )}
      </div>
      <div className="hero-grid">
        {player('home')}
        <div className="hero-mid">
          {st === 'pre' || !m?.live ? (
            <>
              <span className="hero-vs" aria-hidden="true">
                VS
              </span>
              <span className="hero-time">{timeLocal(start)}</span>
            </>
          ) : (
            <>
              <span className="hero-score">
                {setsWon(m.live, 'home')}
                <span className="muted">:</span>
                {setsWon(m.live, 'away')}
              </span>
              <span className="hero-time">{st === 'in' ? 'Direct' : 'Final'}</span>
            </>
          )}
        </div>
        {player('away')}
      </div>
      <p className="hero-date">{new Date(start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    </header>
  );
}

export function TennisMatchPage({ day, id }: { day: string; id: string }) {
  const { state, busy, launch, since } = useTennisSim(id, day);
  return (
    <div className="page">
      <Link href="/tennis" className="back">
        <ArrowLeft size={16} /> Programme ATP
      </Link>
      {state.status !== 'loading' && <TennisHero id={id} r={state.status === 'done' ? state.result : undefined} />}
      {state.status === 'loading' && <span className="sk sk-hero" aria-busy="true" />}
      {state.status === 'done' && <TennisResults r={state.result} />}
      {(state.status === 'queued' || state.status === 'running') && (
        <SimProgress
          queued={state.status === 'queued'}
          start={since ?? (state.startedAt ? Date.parse(state.startedAt) : undefined)}
          title="On joue le match, point par point."
          steps={['Demande envoyée', 'Historique ATP, notes des joueurs, cotes Pinnacle', '25 000 matchs simulés', 'Publication des résultats']}
          prep={40}
          note="Compter 1 à 3 minutes. La page se met à jour seule, et la simulation continue si vous la quittez."
        />
      )}
      {(state.status === 'none' || state.status === 'failed') && (
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
            Point par point : service et retour de chaque joueur sur cette surface, forme du jour, jeux décisifs. Il en sort la victoire, « Un set », le score en
            sets et les jeux.
          </p>
          <button className="btn btn-primary btn-blue btn-lg" onClick={launch} disabled={busy}>
            {busy && <span className="spin" />}{busy ? 'Lancement' : 'Lancer la simulation'}
          </button>
        </section>
      )}
    </div>
  );
}

function Section({ title, tag, children }: { title: string; tag?: string; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h3>{title}</h3>
        {tag && <span className="slash">{tag}</span>}
      </div>
      {children}
    </section>
  );
}

/** Où va l'argent : cote du favori Razzia à chaque relevé Pinnacle depuis l'ouverture. */
function TennisMoney({ r }: { r: TennisResult }) {
  const { side } = favOf(r);
  const i = side === 'home' ? 0 : 1;
  const hm = (at: string) => new Date(at).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const pts = [
    ...(r.market.oddsOpen?.ml ? [{ label: 'Ouverture', odds: r.market.oddsOpen.ml[i] }] : []),
    ...(r.market.moves ?? []).map((m) => ({ label: hm(m.at), odds: m.ml[i] })),
    ...(r.market.odds?.ml ? [{ label: 'Maintenant', odds: r.market.odds.ml[i] }] : []),
  ].filter((p, k, all) => p.odds > 1 && (k === 0 || p.odds !== all[k - 1].odds || k === all.length - 1));
  if (pts.length < 2) return null;
  return (
    <Section title="Où va l'argent" tag="cote Pinnacle du favori">
      <MoneyFlow fav={r[side].name.split(' ').at(-1)!} other={r[side === 'home' ? 'away' : 'home'].name.split(' ').at(-1)!} points={pts} />
    </Section>
  );
}

function TennisResults({ r }: { r: TennisResult }) {
  const cats = useMemo(() => buildTennisCategories(r), [r]);
  return (
    <div className="results">
      <div className="res-head">
        <span className="slash">
          {r.tourney} · {ROUND_FR[r.round] ?? r.round} · {surfaceFr[r.surface] ?? r.surface}
          {r.indoor ? ' (salle)' : ''} · {r.bestOf === 5 ? '3 sets gagnants' : '2 sets gagnants'} · {new Date(r.start).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <TennisVerdict r={r} win={cats.flatMap((c) => c.items).find((o) => o.id === 'win')} />
      <Section title="Pronostics par catégorie" tag="issue la plus fréquente">
        <PickTabs
          cats={cats}
          n={r.sim.n}
          ctx={{ sport: 'atp', date: r.day, start: r.start, path: `/tennis/match/${r.day}/${r.id}`, match: { id: r.id, home: r.home.name, away: r.away.name, homeName: r.home.name, awayName: r.away.name } }}
        />
      </Section>
      <TennisMoney r={r} />
      <TennisSignals r={r} />
      {r.sim.typical && (
        <Section title="Le match typique" tag="déroulé le plus probable">
          <TennisTypical r={r} t={r.sim.typical} />
        </Section>
      )}
      <Section title="Score en sets" tag={`${r.sim.n.toLocaleString('fr-FR')} matchs simulés`}>
        <SetScores r={r} />
      </Section>
      <Section title="Le duel" tag="avant le match">
        <Duel r={r} />
      </Section>
      <Section title="Pourquoi" tag="ce qui fait pencher le moteur">
        <Why r={r} />
      </Section>
      <Section title="Forme" tag="10 derniers matchs">
        <div className="t-forms">
          <Form p={r.home} />
          <Form p={r.away} />
        </div>
      </Section>
      {r.h2h.length > 0 && (
        <Section title="Confrontations" tag={`${r.h2h.filter((x) => x.won).length}-${r.h2h.filter((x) => !x.won).length} pour ${r.home.name}`}>
          <ul className="t-list">
            {r.h2h.map((h) => (
              <li key={h.date + h.tourney}>
                <span className={`t-res ${h.won ? 'w' : 'l'}`}>{h.won ? r.home.name.split(' ').at(-1) : r.away.name.split(' ').at(-1)}</span>
                <span>
                  {h.tourney} {h.round}, {surfaceFr[h.surface] ?? h.surface}
                </span>
                <span className="mono muted">{h.score}</span>
                <span className="mono muted">{new Date(h.date).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <p className="footnote">
        Données jusqu'au {new Date(r.meta.builtAt).toLocaleDateString('fr-FR')} : {r.meta.matchesUsed.toLocaleString('fr-FR')} matchs ATP, Challengers et qualifications (TennisMyLife),
        cotes Pinnacle. Probabilité Razzia : moitié moteur, moitié marché. Les probabilités décrivent le modèle, pas une certitude. Jouer comporte des risques.
      </p>
    </div>
  );
}

/** Signaux du match, comme au basket : chat noir (confrontations), joueurs en hausse ou en baisse (forme). */
function TennisSignals({ r }: { r: TennisResult }) {
  const cat = r.blackCat;
  const moves = [r.home, r.away].filter((p) => p.trend);
  const home = [r.home, r.away].filter((p) => atHome(r.league, p.ioc));
  const goal = [r.home, r.away].filter((p) => p.goal);
  // Surface favorable : au moins 60 points d'Elo de mieux que l'adversaire sur cette surface par rapport à d'habitude.
  const edge = (r.home.surfaceEdge ?? 0) - (r.away.surfaceEdge ?? 0);
  const better = edge > 0 ? r.home : r.away;
  const surf = Math.abs(edge) >= 60 && (better.surfaceEdge ?? 0) > 0 ? better : undefined;
  if (!cat && !moves.length && !home.length && !goal.length && !surf) return null;
  return (
    <div className="signals">
      {cat && (
        <div className="signal signal-cat">
          <span className="signal-icon">
            <PawPrint size={19} weight="light" />
          </span>
          <div>
            <p className="signal-title">Chat noir pour {r[cat.victim].name}</p>
            <p>{cat.text}</p>
          </div>
        </div>
      )}
      {home.map((p) => (
        <div key={`home-${p.name}`} className="signal signal-home">
          <span className="signal-icon">
            <HouseSimple size={19} weight="light" />
          </span>
          <div>
            <p className="signal-title">
              <Avatar name={p.name} photo={p.photo} alt={p.photoAlt} size="sm" /> {p.name} à domicile
            </p>
            <p>
              Il joue devant son public. À savoir : le marché surcote les joueurs à domicile (45 % de victoires pour 48 % annoncés sur 2024-2025), et encore plus quand ils sont en hausse : outsider à domicile en forme, le favori d'en face a gagné 3 à 10 points de plus que prévu selon la saison.
            </p>
          </div>
        </div>
      ))}
      {goal.length > 0 && (
        <div className="signal signal-goal">
          <span className="signal-icon">
            <Trophy size={19} weight="light" />
          </span>
          <div>
            <p className="signal-title">
              {goal.map((p) => (
                <Avatar key={p.name} name={p.name} photo={p.photo} alt={p.photoAlt} size="sm" />
              ))}{' '}
              {goal.map((p) => p.name).join(' et ')} : objectif Masters
            </p>
            <p>
              {goal.length > 1 ? `Classés ${goal.map((p) => `${p.rank}e`).join(' et ')}, ils jouent` : `Classé ${goal[0].rank}e, il joue`} la course au Masters de fin d'année : chaque match compte. Sur 2024-2025, les top 20 favoris en ATP 250 et 500 après le 10 octobre ont gagné 82 % de leurs matchs quand le marché leur en donnait 72 % (72 matchs, les deux saisons dans le même sens).
            </p>
          </div>
        </div>
      )}
      {surf && (
        <div className="signal signal-surface">
          <span className="signal-icon">
            <Mountains size={19} weight="light" />
          </span>
          <div>
            <p className="signal-title">
              <Avatar name={surf.name} photo={surf.photo} alt={surf.photoAlt} size="sm" /> {surf.name} : sa surface
            </p>
            <p>
              Sur {(surfaceFr[r.surface] ?? r.surface).toLowerCase()}, il joue {surf.surfaceEdge} points d'Elo au-dessus de son niveau habituel, nettement mieux que son adversaire. À savoir : le marché en tient déjà compte (2024-2025 : 50,1 % de victoires pour 50,2 % annoncés), le moteur aussi.
            </p>
          </div>
        </div>
      )}
      {moves.map((p) => {
        const wins = p.form.filter((m) => m.won).length;
        return (
          <div key={p.name} className={`signal ${p.trend === 'up' ? 'signal-up' : 'signal-down'}`}>
            <span className="signal-icon">{p.trend === 'up' ? <TrendUp size={19} weight="light" /> : <TrendDown size={19} weight="light" />}</span>
            <div>
              <p className="signal-title">
                <Avatar name={p.name} photo={p.photo} alt={p.photoAlt} size="sm" /> {p.name} {p.trend === 'up' ? 'en hausse' : 'en baisse'}
              </p>
              <p>
                {wins} victoire{wins > 1 ? 's' : ''} sur ses {p.form.length} derniers matchs : {Math.abs(p.form10 ?? 0).toFixed(1).replace('.', ',')} de {(p.form10 ?? 0) > 0 ? 'plus' : 'moins'} que ce qu'annonçait son niveau face à ces adversaires.
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TennisVerdict({ r, win }: { r: TennisResult; win?: Outcome }) {
  const { side, p } = favOf(r);
  const fav = r[side], dog = r[side === 'home' ? 'away' : 'home'];
  const i = side === 'home' ? 0 : 1;
  const book = r.market.pHome != null ? (side === 'home' ? r.market.pHome : 1 - r.market.pHome) : undefined;
  const flip = flipOf(r);
  const tier = flip ? 'flip' : p >= T_SURE ? 'sure' : 'normal';
  const sets = r.sim.atLeast1[i];
  return (
    <section className={`verdict verdict-${tier}`}>
      {win?.warn && <span className={`odds-warn verdict-warn${win.warn === 'Risqué' ? ' risky' : ''}`}>{win.warn}</span>}
      <div className="verdict-ring">
        <Ring value={p} format={pct0} label="Victoire" />
      </div>
      <div>
        <span className="caps">Favori Razzia</span>
        <p className="verdict-team">
          <Avatar name={fav.name} photo={fav.photo} alt={fav.photoAlt} size="md" /> {fav.name}
        </p>
        <p className="verdict-sub">
          Probabilité de victoire <b className="num">{pct(p)}</b>.
        </p>
        <PickOdds o={win} />
        {tier === 'sure' && (
          <Callout tone="badge-sure" icon={<ShieldCheck size={19} weight="light" />} title="Razzia assuré">
            <p>Quand Razzia est aussi sûr, le favori a gagné 88 % du temps sur 2024 et 2025 (un match sur six).</p>
          </Callout>
        )}
        {tier === 'flip' && (
          <Callout tone="badge-flip" icon={<Scales size={20} weight="light" />} title="Pile ou face">
            <p>
              {flip === 'dogUp'
                ? `${dog.name} est en hausse : avec un outsider dans cette forme, le favori perd plus souvent que prévu.`
                : flip === 'close'
                  ? `${fav.name} reste favori, mais d'un rien : match imprévisible.`
                  : `${fav.name} est favori, mais pas assez pour jouer sa victoire seule.`}{' '}
              Plus sûr : <b>{fav.name} gagne au moins un set</b> ({pct(sets)} des simulations).
            </p>
          </Callout>
        )}
        <div className="split" role="img" aria-label={`${r.home.name} ${pct(r.pHome)}, ${r.away.name} ${pct(r.pAway)}`}>
          <div className="split-bar">
            <span className={side === 'home' ? 'is-fav' : ''} style={{ flexGrow: r.pHome }} />
            <span className={side === 'away' ? 'is-fav' : ''} style={{ flexGrow: r.pAway }} />
          </div>
          <div className="split-legend">
            <span className={side === 'home' ? 'is-fav' : ''}>
              {r.home.name.split(' ').at(-1)} {pct(r.pHome)}
            </span>
            <span className={side === 'away' ? 'is-fav' : ''}>
              {pct(r.pAway)} {r.away.name.split(' ').at(-1)}
            </span>
          </div>
        </div>
      </div>
      <dl className="verdict-side">
        {book != null && (
          <div>
            <dt>Marché sans marge</dt>
            <dd>
              {pct(book)} <span className={`delta ${p - book >= 0 ? 'up' : 'down'}`}>{`${p - book >= 0 ? '+' : ''}${((p - book) * 100).toFixed(1).replace('.', ',')} pt`}</span>
            </dd>
          </div>
        )}
        <div>
          <dt>{dog.name.split(' ').at(-1)} prend un set</dt>
          <dd>{pct(r.sim.atLeast1[1 - i])}</dd>
        </div>
      </dl>
    </section>
  );
}

function SetScores({ r }: { r: TennisResult }) {
  const rows = Object.entries(r.sim.scores)
    .map(([k, v]) => { const [a, b] = k.split('-').map(Number); return { who: a > b ? r.home.name : r.away.name, score: a > b ? `${a}-${b}` : `${b}-${a}`, v, home: a > b }; })
    .sort((x, y) => Number(y.home) - Number(x.home) || x.score.localeCompare(y.score));
  const max = Math.max(...rows.map((x) => x.v));
  return (
    <ul className="t-sets">
      {rows.map((x) => (
        <li key={x.who + x.score}>
          <span className="t-sets-who">
            {x.who.split(' ').at(-1)} <b className="mono">{x.score}</b>
          </span>
          <span className="t-sets-bar">
            <span className={x.home ? 'h' : 'a'} style={{ width: `${(100 * x.v) / max}%` }} />
          </span>
          <span className="mono">{pct(x.v)}</span>
        </li>
      ))}
      <li className="t-sets-note muted small">
        Premier set pour {r.home.name.split(' ').at(-1)} : {pct(r.sim.firstSet)} · au moins un jeu décisif : {pct(r.sim.tiebreak)}
      </li>
    </ul>
  );
}

function Duel({ r }: { r: TennisResult }) {
  const A = r.home, B = r.away;
  const rec = (p: TennisPlayer) => `${p.form.filter((f) => f.won).length}-${p.form.filter((f) => !f.won).length}`;
  const rows: Array<[string, string, string]> = [
    ['Classement ATP', A.rank ? `${A.rank}e` : '-', B.rank ? `${B.rank}e` : '-'],
    ['Âge', A.age ? `${Math.floor(A.age)} ans` : '-', B.age ? `${Math.floor(B.age)} ans` : '-'],
    ['Niveau Elo (général et surface)', String(A.elo), String(B.elo)],
    ['Points gagnés au service (attendus)', pct(r.sim.pA), pct(r.sim.pB)],
    ['Forme (10 derniers matchs)', rec(A), rec(B)],
    [`Saison sur ${(surfaceFr[r.surface] ?? r.surface).toLowerCase()}`, `${A.surfaceSeason.won}-${A.surfaceSeason.lost}`, `${B.surfaceSeason.won}-${B.surfaceSeason.lost}`],
    ['Matchs sur 14 jours', String(A.played14), String(B.played14)],
    ['Minutes dans le tournoi', String(A.tourneyMinutes), String(B.tourneyMinutes)],
    ['Jours depuis le dernier match', A.daysOff < 999 ? String(A.daysOff) : '-', B.daysOff < 999 ? String(B.daysOff) : '-'],
  ];
  return (
    <div className="t-duel">
      <div className="t-duel-head">
        <span>
          <Avatar name={A.name} photo={A.photo} alt={A.photoAlt} size="sm" /> {A.name}
        </span>
        <span />
        <span>
          {B.name} <Avatar name={B.name} photo={B.photo} alt={B.photoAlt} size="sm" />
        </span>
      </div>
      {rows.map(([k, a, b]) => (
        <div key={k} className="t-duel-row">
          <b className="mono">{a}</b>
          <span className="muted">{k}</span>
          <b className="mono">{b}</b>
        </div>
      ))}
    </div>
  );
}

function Why({ r }: { r: TennisResult }) {
  // Apport de chaque ingrédient, en points de probabilité pour le joueur listé en premier.
  const zAll = r.engine.factors.reduce((s, f) => s + f.z, 0);
  const sg = (z: number) => 1 / (1 + Math.exp(-z));
  const items = r.engine.factors
    .map((f) => ({ ...f, pts: (sg(zAll) - sg(zAll - f.z)) * 100 }))
    .filter((f) => Math.abs(f.pts) >= 0.5)
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  return (
    <>
      <ul className="t-why">
        {items.map((f) => (
          <li key={f.key}>
            <span>{f.label}</span>
            <span className={`t-why-bar ${f.pts >= 0 ? 'h' : 'a'}`}>
              <span style={{ width: `${Math.min(100, Math.abs(f.pts) * 4)}%` }} />
            </span>
            <span className="mono">
              {f.pts >= 0 ? '+' : '-'}
              {Math.abs(f.pts).toFixed(1).replace('.', ',')} pt {f.pts >= 0 ? r.home.name.split(' ').at(-1) : r.away.name.split(' ').at(-1)}
            </span>
          </li>
        ))}
      </ul>
      <p className="small muted">
        Moteur seul : {r.home.name.split(' ').at(-1)} {pct(r.engine.pHome)}
        {r.market.pHome != null ? ` · marché sans marge ${pct(r.market.pHome)}` : ''}
        {r.market.pHomeOpen != null && r.market.pHome != null && Math.abs(r.market.pHome - r.market.pHomeOpen) >= 0.01
          ? ` (${pct(r.market.pHomeOpen)} à l'ouverture)`
          : ''}{' '}
        · Razzia {pct(r.pHome)}.
      </p>
    </>
  );
}

function Form({ p }: { p: TennisPlayer }) {
  return (
    <div className="t-form">
      <p className="t-form-head">
        <Avatar name={p.name} photo={p.photo} alt={p.photoAlt} size="sm" /> {p.name}
        {p.layoff && <span className="tag tag-warn">longue absence</span>}
      </p>
      <ul className="t-list">
        {p.form.map((f) => (
          <li key={f.date + f.opponent}>
            <span className={`t-res ${f.won ? 'w' : 'l'}`}>{f.won ? 'V' : 'D'}</span>
            <span>
              {f.opponent} <span className="muted small">· {f.tourney} {f.round}</span>
            </span>
            <span className="mono muted">{f.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
