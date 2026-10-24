// Onglet Tennis (ATP) : programme d'après les cotes Pinnacle notées, fiche de match avec la simulation (5 000 matchs point
// par point), mêmes principes que la NBA : vainqueur ou « Un set », pile ou face, Razzia assuré.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowClockwise, ArrowLeft, CalendarBlank, CaretRight, Cat, Flag, House, Mountains, ListBullets, Scales, ShieldCheck, Sparkle, SquaresFour, TrendDown, TrendUp, WarningCircle, X } from '@phosphor-icons/react';
import { Empty, Link, ProgressLine, Ring, Segmented, Wordmark } from './ui.tsx';
import { PickOdds, PickTabs } from './results.tsx';
import { buildTennisCategories, favOf, flipOf, T_FLIP, T_SURE } from './tennispicks.ts';
import { shown, type Outcome } from './picks.ts';

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
  sim: { n: number; pA: number; pB: number; win: number; firstSet: number; scores: Record<string, number>; atLeast1: [number, number]; atLeast2: [number, number]; straight: [number, number]; tiebreak: number; games: { mean: number; p10: number; p50: number; p90: number } };
  h2h: Array<{ date: string; tourney: string; round: string; surface: string; won: boolean; score: string }>;
  h2hCount?: { home: number; away: number; since: string };
  blackCat?: { victim: 'home' | 'away'; lost: number; n: number; since: string; text: string };
  meta: { builtAt: string; matchesUsed: number; n: number };
}
type Live = { state: 'pre' | 'in' | 'post'; detail?: string; home: Array<{ g: number; tb?: number; w?: boolean }>; away: Array<{ g: number; tb?: number; w?: boolean }>; winner?: 'home' | 'away' };
interface SlateMatch { id: string; day: string; league: string; start: string; home: string; away: string; odds?: Odds; oddsOpen?: Odds; live?: Live }
interface SimIndex { id: string; day: string; home: string; away: string; pHome: number; at: string; cat?: string; trend?: { home?: 'up' | 'down'; away?: 'up' | 'down' }; goal?: { home?: boolean; away?: boolean } }
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
export function Avatar({ name, photo, alt, size = 'md' }: { name: string; photo?: string; alt?: string; size?: 'sm' | 'row' | 'md' | 'lg' }) {
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
function DayTracker({ run, sims, onClose }: { run: DayRun; sims: Map<string, SimIndex>; onClose: () => void }) {
  const live = !ended(run);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  const since = Date.parse(run.startedAt ?? new Date(run.at).toISOString()) - 60e3;
  const state = (id: string) => (sims.get(id) && Date.parse(sims.get(id)!.at) >= since ? 'done' : live ? (run.status === 'running' ? 'running' : 'queued') : 'failed');
  const done = run.ids.filter((id) => state(id) === 'done').length;
  const failed = run.ids.length - done;
  const s = Math.max(0, Math.round(((run.endedAt ?? now) - run.at) / 1000));
  return (
    <section className="batch" aria-live="polite">
      <div className="batch-head">
        <p className="batch-title">
          {live ? 'Simulation de la journée' : failed ? 'Journée simulée, avec des échecs' : 'Journée simulée'} <span>· {dayLongOf(run.day)}</span>
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
  const load = useCallback(() => api('?slate=1').then(setData, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => store.set('vue', view), [view]);
  const { run, start, dismiss } = useDayRun(load);
  const busy = !ended(run);
  const sims = new Map((data?.sims ?? []).map((s) => [s.id, s]));

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
  const todo = dayMatches.filter((m) => stateOf(m) === 'pre');
  const inRun = (id: string) => busy && run!.ids.includes(id);

  return (
    <div className="page">
      <Wordmark />
      <header className="dash-head">
        <div>
          <h1>Programme ATP</h1>
          <p className="dash-meta">
            <CalendarBlank size={16} /> <span>{cap(dayLongOf(current))}</span>
            <span className="count">
              {dayMatches.length} match{dayMatches.length > 1 ? 's' : ''}
            </span>
          </p>
        </div>
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
      </header>

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
            <div className="cards" key={`${current}-${status}`}>
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
        <span className="pill-tag final">Final</span>
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
  const lost = m.live?.winner && m.live.winner !== side;
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
            <Flag size={13} weight="fill" />
          </span>
        )}
        {atHome(m.league, c?.ioc) && (
          <span className="t-home" title="À domicile" aria-label="À domicile">
            <House size={13} weight="fill" />
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

/** Pastille de simulation, comme au basket : chat noir, favori et son pourcentage ; « Calcul » pendant la journée. */
function TennisSimPill({ sim, running }: { sim?: SimIndex; running: boolean }) {
  if (running)
    return (
      <span className="conf-pill run">
        <span className="spin spin-xs" /> Calcul
      </span>
    );
  if (!sim) return <span className="conf-pill go">Simuler</span>;
  const fav = sim.pHome >= 0.5 ? { n: sim.home, p: sim.pHome } : { n: sim.away, p: 1 - sim.pHome };
  // Pile ou face (même règle que la fiche) : favori sous 60 %, ou outsider en hausse.
  const flip = shown(fav.p) < T_FLIP || sim.trend?.[sim.pHome >= 0.5 ? 'away' : 'home'] === 'up';
  return (
    <span className="pill-group">
      {sim.cat && (
        <span className="cat-mini" title={`Chat noir pour ${sim.cat}`} aria-label={`Chat noir pour ${sim.cat}`}>
          <Cat size={13} weight="fill" />
        </span>
      )}
      <span className={`conf-pill sim${flip ? ' flip' : ''}`}>
        <TrendUp size={13} weight="bold" /> {fav.n.split(' ').at(-1)} {pct0(fav.p)}
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
      <span className="cell-odds">{m.odds?.ml ? `${dec(m.odds.ml[0])} / ${dec(m.odds.ml[1])}` : '-'}</span>
      <span style={{ textAlign: 'center' }}>
        <TennisSimPill sim={sim} running={running} />
      </span>
      <CaretRight size={16} className="row-caret" />
    </Link>
  );
}

function TennisCard({ m, sim, players, running, i }: { m: SlateMatch; sim?: SimIndex; players?: Record<string, PlayerCard>; running: boolean; i: number }) {
  const st = stateOf(m);
  return (
    <Link href={`/tennis/match/${m.day}/${m.id}`} className="card t-card" style={{ '--i': i } as CSSProperties}>
      <div className="card-top">
        <span className="mono strong">{st === 'pre' || !m.live ? timeLocal(m.start) : `${setsWon(m.live, 'home')}-${setsWon(m.live, 'away')}`}</span>
        <span className="muted small">{tourneyOf(m.league)}</span>
      </div>
      <div className="card-vs">
        <Who m={m} side="home" players={players} sim={sim} size="lg" />
        <span className="card-x">VS</span>
        <Who m={m} side="away" players={players} sim={sim} size="lg" />
      </div>
      <div className="card-foot">
        <span>{m.odds?.ml ? `${dec(m.odds.ml[0])} / ${dec(m.odds.ml[1])}` : 'Cotes à venir'}</span>
        <TennisSimPill sim={sim} running={running} />
      </div>
    </Link>
  );
}

// ——— Fiche de match ———
function useTennisSim(id: string, day: string) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const poll = useCallback(async () => {
    window.clearTimeout(timer.current);
    const req = store.get(pendingKey(id));
    try {
      const s = await api(`?id=${id}&day=${day}${req ? `&req=${req}` : ''}`);
      setState(s);
      if (s.status === 'queued' || s.status === 'running') timer.current = window.setTimeout(poll, 5000);
      else if (req) store.set(pendingKey(id), null);
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
      setState({ status: 'queued' });
      timer.current = window.setTimeout(poll, 4000);
    } catch (e) {
      setState({ status: 'failed', error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return { state, busy, launch };
}

export function TennisMatchPage({ day, id }: { day: string; id: string }) {
  const { state, busy, launch } = useTennisSim(id, day);
  return (
    <div className="page">
      <Link href="/tennis" className="back">
        <ArrowLeft size={16} /> Programme ATP
      </Link>
      {state.status === 'loading' && <span className="sk sk-hero" aria-busy="true" />}
      {state.status === 'done' && <TennisResults r={state.result} onRelaunch={launch} busy={busy} />}
      {(state.status === 'queued' || state.status === 'running') && (
        <section className="progress" aria-live="polite">
          <div className="progress-top">
            <h2>On joue le match, point par point.</h2>
          </div>
          <div className="track" />
          <p className="small muted">
            Compter 1 à 3 minutes : historique ATP, notes des joueurs, cotes Pinnacle, puis 5 000 matchs simulés. La page se met à jour seule.
          </p>
        </section>
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
            Ce match, <em>joué 5 000 fois.</em>
          </h2>
          <p className="lede">
            Point par point : service et retour de chaque joueur sur cette surface, forme du jour, jeux décisifs. Il en sort la victoire, « Un set », le score en
            sets et les jeux.
          </p>
          <button className="btn btn-primary btn-blue btn-lg" onClick={launch} disabled={busy}>
            {busy ? <span className="spin" /> : <Sparkle size={18} weight="fill" />} {busy ? 'Lancement' : 'Lancer la simulation'}
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

function TennisResults({ r, onRelaunch, busy }: { r: TennisResult; onRelaunch: () => void; busy: boolean }) {
  const cats = useMemo(() => buildTennisCategories(r), [r]);
  return (
    <div className="results">
      <div className="res-head">
        <span className="slash">
          {r.tourney} · {ROUND_FR[r.round] ?? r.round} · {surfaceFr[r.surface] ?? r.surface}
          {r.indoor ? ' (salle)' : ''} · {r.bestOf === 5 ? '3 sets gagnants' : '2 sets gagnants'} · {new Date(r.start).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
        <button className="btn btn-ghost" onClick={onRelaunch} disabled={busy}>
          {busy ? <span className="spin" /> : <ArrowClockwise size={16} />} Relancer
        </button>
      </div>
      <TennisVerdict r={r} pick={cats[0]?.items[0]} />
      <Section title="Pronostics par catégorie" tag="issue la plus fréquente">
        <PickTabs cats={cats} n={r.sim.n} />
      </Section>
      <TennisSignals r={r} />
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
            <Cat size={20} weight="fill" />
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
            <House size={20} weight="fill" />
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
            <Flag size={20} weight="fill" />
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
            <Mountains size={20} weight="fill" />
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
            <span className="signal-icon">{p.trend === 'up' ? <TrendUp size={20} weight="bold" /> : <TrendDown size={20} weight="bold" />}</span>
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

function TennisVerdict({ r, pick }: { r: TennisResult; pick?: Outcome }) {
  const { side, p } = favOf(r);
  const fav = r[side], dog = r[side === 'home' ? 'away' : 'home'];
  const i = side === 'home' ? 0 : 1;
  const book = r.market.pHome != null ? (side === 'home' ? r.market.pHome : 1 - r.market.pHome) : undefined;
  const flip = flipOf(r);
  const tier = flip ? 'flip' : p >= T_SURE ? 'sure' : 'normal';
  const sets = r.sim.atLeast1[i];
  return (
    <section className={`verdict verdict-${tier}`}>
      <Ring value={p} format={pct0} label="Victoire" />
      <div>
        <span className="caps">Favori Razzia</span>
        <p className="verdict-team">
          <Avatar name={fav.name} photo={fav.photo} alt={fav.photoAlt} size="md" /> {fav.name}
        </p>
        <p className="verdict-sub">
          Probabilité de victoire <b className="num">{pct(p)}</b>.
        </p>
        <PickOdds o={pick} />
        {tier === 'sure' && (
          <div className="conf-badge sure">
            <ShieldCheck size={20} weight="fill" />
            <div>
              <p className="conf-badge-title">Razzia assuré</p>
              <p>Quand Razzia est aussi sûr, le favori a gagné 88 % du temps sur 2024 et 2025 (un match sur six).</p>
            </div>
          </div>
        )}
        {tier === 'flip' && (
          <div className="conf-badge flip">
            <Scales size={20} weight="bold" />
            <div>
              <p className="conf-badge-title">Pile ou face</p>
              <p>
                {flip === 'dogUp' ? `${dog.name} est en hausse : avec un outsider dans cette forme, le favori perd plus souvent que prévu.` : `${fav.name} reste favori, mais d'un rien : match imprévisible.`} Plus sûr : <b>{fav.name} gagne au moins un set</b> ({pct(sets)} des simulations).
              </p>
            </div>
          </div>
        )}
        <div className="split" role="img" aria-label={`${r.home.name} ${pct(r.pHome)}, ${r.away.name} ${pct(r.pAway)}`}>
          <div className="split-bar">
            <span style={{ flexGrow: r.pHome }} />
            <span style={{ flexGrow: r.pAway }} />
          </div>
          <div className="split-legend">
            <span>
              {r.home.name.split(' ').at(-1)} {pct(r.pHome)}
            </span>
            <span>
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


// ——— Bilan ———
interface Rate { n: number; won: number }
interface TennisBilan {
  at: string; games: number; voided?: number; late?: number; pick: Rate; sets: Rate;
  tiers: { sure: Rate; mid: Rate; flip: Rate; advised: Rate };
  accuracy: { razzia?: number; market?: number };
  rows: Array<{ id: string; day: string; start: string; tourney: string; round: string; home: string; away: string; pHome: number; homeWon: boolean; score: string; tier: 'sure' | 'mid' | 'flip'; pick: { kind: 'vainqueur' | 'sets'; label: string; won: boolean } }>;
  error?: string;
}
const rateTxt = (r?: Rate) => (r?.n ? pct(r.won / r.n) : '-');
const label = (r: TennisBilan['rows'][number]) => (r.pick.kind === 'sets' ? r.pick.label : `Victoire ${r.pick.label}`);

/** Bilan tennis : le pronostic mis en avant par chaque fiche face au résultat, par niveau de confiance. */
export function TennisBilanPage() {
  const [b, setB] = useState<TennisBilan>();
  useEffect(() => {
    api('?bilan=1').then(setB, (e: Error) => setB({ error: e.message } as TennisBilan));
  }, []);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Bilan tennis</h1>
        <p className="lede">Les simulations ATP publiées face aux résultats. Mis à jour toutes les 3 heures.</p>
      </header>
      {!b && <span className="sk sk-panel" aria-busy="true" />}
      {b && (b.error || !b.games) && <Empty title={b.error ?? 'Aucun match terminé parmi les simulations publiées.'} />}
      {b && b.games > 0 && (
        <>
          <section className="league-card bilan-kpis">
            <div>
              <span className="caps">Matchs terminés</span>
              <b className="mono">{b.games}</b>
              <small>{b.voided ? `${b.voided} abandons ou forfaits non comptés` : 'Abandons et forfaits non comptés'}</small>
            </div>
            <div>
              <span className="caps">Bon pronostic</span>
              <b className="mono">{rateTxt(b.pick)}</b>
              <small>
                {b.sets.n ? `dont ${b.sets.n} « Un set » (${b.sets.won} passés), ` : ''}vainqueur seul {b.accuracy.razzia != null ? pct(b.accuracy.razzia) : '-'}, marché {b.accuracy.market != null ? pct(b.accuracy.market) : '-'}
              </small>
            </div>
            <div>
              <span className="caps">Razzia assuré</span>
              <b className="mono">{rateTxt(b.tiers.sure)}</b>
              <small>favoris à 80 % ou plus, {b.tiers.sure.n} matchs</small>
            </div>
            <div>
              <span className="caps">Hors pile ou face</span>
              <b className="mono">{rateTxt(b.tiers.advised)}</b>
              <small>
                {b.tiers.advised.n} matchs ; pile ou face (favori sous 60 % ou outsider en hausse) : {rateTxt(b.tiers.flip)} sur {b.tiers.flip.n}
              </small>
            </div>
          </section>
          <p className="note" style={{ margin: '12px 0 18px' }}>
            Le pronostic compté est celui que la fiche met en avant : le vainqueur, ou « Un set » quand le favori est à 80 % ou moins ou que l'outsider est en hausse. Une simulation lancée après le début du match ne compte pas.
          </p>
          <section className="league-card">
            <ol className="rows">
              {b.rows.map((r) => {
                const fav = r.pHome >= 0.5 ? { n: r.home, p: r.pHome } : { n: r.away, p: 1 - r.pHome };
                return (
                  <li key={r.id}>
                    <Link href={`/tennis/match/${r.day}/${r.id}`} className="row t-bilan-row">
                      <span className="muted">{new Date(r.start ?? `${r.day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                      <span className="t-bl-match">
                        <span className="strong">{r.home} - {r.away}</span>
                        <span className="mono muted">{r.score}</span>
                        <span className="t-sm muted">{label(r)}</span>
                      </span>
                      <span className="t-bl-fav">
                        <span className="mono">{fav.n.split(' ').at(-1)} {pct0(fav.p)}</span>
                        {r.tier !== 'mid' && <span className={`pill-tag${r.tier === 'flip' ? ' final' : ''}`}>{r.tier === 'sure' ? 'Assuré' : 'Pile ou face'}</span>}
                      </span>
                      <span className="t-bl-pick">
                        <span className={`t-res ${r.pick.won ? 'w' : 'l'}`}>{r.pick.won ? 'Passé' : 'Raté'}</span>
                        <span className="t-lg">{label(r)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
