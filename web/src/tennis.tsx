// Onglet Tennis (ATP) : programme d'après les cotes Pinnacle notées, fiche de match avec la simulation (5 000 matchs point
// par point), mêmes principes que la NBA : vainqueur ou « Un set », pile ou face, Razzia assuré.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowClockwise, ArrowLeft, ArrowSquareOut, CaretRight, Cat, Scales, ShieldCheck, Sparkle, TrendDown, TrendUp, WarningCircle, X } from '@phosphor-icons/react';
import { Empty, Link, Ring } from './ui.tsx';
import { PickTabs } from './results.tsx';
import { buildTennisCategories, favOf, T_FLIP, T_SURE } from './tennispicks.ts';
import { shown } from './picks.ts';

// ——— Données ———
export interface TennisPlayer {
  name: string; ioc?: string; hand?: string; ht?: number; age?: number; rank?: number; matches: number; elo: number; serve: number; ret: number;
  daysOff: number; tourneyMinutes: number; played14: number; layoff: boolean; photo?: string; photoAlt?: string; atp?: string;
  form10?: number; trend?: 'up' | 'down';
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
interface SlateMatch { id: string; day: string; league: string; start: string; home: string; away: string; odds?: Odds; oddsOpen?: Odds }
interface SimIndex { id: string; day: string; home: string; away: string; pHome: number; at: string; cat?: string; trend?: { home?: 'up' | 'down'; away?: 'up' | 'down' } }
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
const initials = (n: string) => n.split(' ').map((x) => x[0]).slice(0, 2).join('');

/** Photo officielle ATP d'après le code du joueur. */
const atpHeadshot = (code: string) => `https://www.atptour.com/-/media/alias/player-headshot/${code.toLowerCase()}`;

/** Photo du joueur : officielle ATP, sinon Wikipédia, sinon ses initiales. */
export function Avatar({ name, photo, alt, size = 'md' }: { name: string; photo?: string; alt?: string; size?: 'sm' | 'row' | 'md' | 'lg' }) {
  const srcs = [photo, alt].filter((x): x is string => !!x);
  const [i, setI] = useState(0);
  return (
    <span className={`t-ava t-ava-${size}`} aria-hidden="true">
      {i < srcs.length ? <img key={srcs[i]} src={srcs[i]} alt="" loading="lazy" decoding="async" onError={() => setI(i + 1)} /> : initials(name)}
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

/** Suivi de la journée : un segment par match (en calcul, publié, échec), le chrono et le lien GitHub. */
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
          {live ? 'Simulation de la journée' : failed ? 'Journée simulée, avec des échecs' : 'Journée simulée'} <span>· {run.day}</span>
        </p>
        <span className="batch-clock mono">
          {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
        </span>
        {run.url && (
          <a className="batch-link" href={run.url} target="_blank" rel="noreferrer">
            Suivre sur GitHub <ArrowSquareOut size={12} />
          </a>
        )}
        {!live && (
          <button className="batch-x" onClick={onClose} aria-label="Fermer le suivi">
            <X size={14} weight="bold" />
          </button>
        )}
      </div>
      <div className="batch-bar" role="progressbar" aria-valuemin={0} aria-valuemax={run.ids.length} aria-valuenow={done} aria-label={`${done} matchs publiés sur ${run.ids.length}`}>
        {run.ids.map((id) => (
          <span key={id} className={`is-${state(id)}`} />
        ))}
      </div>
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
export function TennisSchedulePage() {
  const [data, setData] = useState<{ matches: SlateMatch[]; sims: SimIndex[]; players?: Record<string, PlayerCard> }>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => api('?slate=1').then(setData, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);
  const { run, start, dismiss } = useDayRun(load);
  const groups = useMemo(() => {
    const now = Date.now() - 3 * 3_600_000;
    const up = (data?.matches ?? []).filter((m) => Date.parse(m.start) > now).sort((a, b) => a.start.localeCompare(b.start));
    const g = new Map<string, SlateMatch[]>();
    for (const m of up) {
      const k = `${dayName(m.start)}|${tourneyOf(m.league)}`;
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g];
  }, [data]);
  const sims = new Map((data?.sims ?? []).map((s) => [s.id, s]));
  // Toute la journée : les matchs pas encore commencés du premier jour qui en a.
  const todo = useMemo(() => {
    const up = (data?.matches ?? []).filter((m) => Date.parse(m.start) > Date.now()).sort((a, b) => a.start.localeCompare(b.start));
    const first = up[0] && dayName(up[0].start);
    return { label: first, list: up.filter((m) => dayName(m.start) === first) };
  }, [data]);
  const busy = !ended(run);
  // Comme les équipes NBA : photo à côté du nom, classement et pays dessous.
  const who = (name: string, away = false) => {
    const c = data?.players?.[name];
    const sub = [c?.rank != null ? `n° ${c.rank}` : '', c?.ioc ?? ''].filter(Boolean).join(' · ');
    const ava = <Avatar name={name} photo={c?.atp ? atpHeadshot(c.atp) : undefined} alt={c?.wiki ?? undefined} size="row" />;
    return (
      <div className={`vs-team${away ? ' away' : ''}`}>
        {!away && ava}
        <span>
          <span className="vs-name">
            <span className="t-lg">{name}</span>
            <span className="t-sm">{short(name)}</span>
          </span>
          <span className="vs-rec">{sub}</span>
        </span>
        {away && ava}
      </div>
    );
  };
  return (
    <div className="page">
      <header className="page-head">
        <h1>Programme ATP</h1>
        <p className="lede">Circuit principal, matchs avec une cote Pinnacle. Heures dans votre fuseau.</p>
      </header>
      {error && <Empty title="Le programme n'a pas pu être chargé.">{error}</Empty>}
      {!data && !error && <span className="sk sk-hero" aria-busy="true" />}
      {run && <DayTracker run={run} sims={sims} onClose={dismiss} />}
      {(todo.list.length > 0 || busy) && (
        <div className="sheet-bar">
          {!busy && <p className="sheet-hint" style={{ textTransform: 'capitalize' }}>{todo.label}</p>}
          <button className="btn-soiree" disabled={busy} onClick={() => void start(todo.label!, todo.list)} title={busy ? undefined : `Simule les ${todo.list.length} matchs à venir de ce jour, en un seul passage`}>
            {busy ? 'Journée en cours' : 'Simuler toute la journée'}
            <span className="n">{busy ? `${run!.ids.length} matchs` : `${todo.list.length} match${todo.list.length > 1 ? 's' : ''}`}</span>
          </button>
        </div>
      )}
      {data && groups.length === 0 && <Empty title="Aucun match ATP coté pour le moment." />}
      {groups.map(([k, list]) => {
        const [dayName, tourney] = k.split('|');
        return (
          <section className="league-card" key={k}>
            <div className="league-top">
              <h2>{tourney}</h2>
              <span className="badge-n">{list.length}</span>
              <span className="muted" style={{ textTransform: 'capitalize' }}>{dayName}</span>
            </div>
            <ol className="rows">
              {list.map((m, i) => {
                const s = sims.get(m.id);
                const fav = s ? (s.pHome >= 0.5 ? { n: s.home, p: s.pHome } : { n: s.away, p: 1 - s.pHome }) : undefined;
                return (
                  <li key={m.id}>
                    <Link href={`/tennis/match/${m.day}/${m.id}`} className="row t-row" style={{ '--i': i } as CSSProperties}>
                      <div className="row-time">
                        <span className="t">{timeLocal(m.start)}</span>
                        <span className="pill-tag">
                          <span className="t-lg">{ROUND_FR[roundOf(m.league)] ?? roundOf(m.league)}</span>
                          <span className="t-sm">{ROUND_SHORT[roundOf(m.league)] ?? ROUND_FR[roundOf(m.league)] ?? roundOf(m.league)}</span>
                        </span>
                      </div>
                      <div className="vs-line">
                        {who(m.home, true)}
                        <span className="vs-at">vs</span>
                        {who(m.away)}
                      </div>
                      <span className="cell-odds">{m.odds?.ml ? `${dec(m.odds.ml[0])} / ${dec(m.odds.ml[1])}` : '-'}</span>
                      <span style={{ textAlign: 'center' }}>
                        {fav ? <span className="conf-pill sim">{fav.n.split(' ').at(-1)} {pct0(fav.p)}</span> : <span className="conf-pill go">Simuler</span>}
                      </span>
                      <CaretRight size={16} className="row-caret" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
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
            {'url' in state && state.url && (
              <>
                {' '}
                <a href={state.url} target="_blank" rel="noreferrer">
                  Suivre le calcul <ArrowSquareOut size={12} />
                </a>
              </>
            )}
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
          <button className="btn btn-primary btn-lg" onClick={launch} disabled={busy}>
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
      <TennisVerdict r={r} />
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
  if (!cat && !moves.length) return null;
  const n1 = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}`;
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
                {wins} victoire{wins > 1 ? 's' : ''} sur ses {p.form.length} derniers matchs, soit {n1(p.form10 ?? 0)} par rapport à ce qu'annonçait son niveau face à ces adversaires.
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TennisVerdict({ r }: { r: TennisResult }) {
  const { side, p } = favOf(r);
  const fav = r[side], dog = r[side === 'home' ? 'away' : 'home'];
  const i = side === 'home' ? 0 : 1;
  const book = r.market.pHome != null ? (side === 'home' ? r.market.pHome : 1 - r.market.pHome) : undefined;
  const tier = p >= T_SURE ? 'sure' : shown(p) < T_FLIP ? 'flip' : 'normal';
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
                {fav.name} reste favori, mais d'un rien : match imprévisible. Plus sûr : <b>{fav.name} gagne au moins un set</b> ({pct(sets)} des simulations).
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
        <div>
          <dt>Score le plus probable</dt>
          <dd>{topScore(r)}</dd>
        </div>
        {book != null && (
          <div>
            <dt>Marché sans marge</dt>
            <dd>
              {pct(book)} <span className={`delta ${p - book >= 0 ? 'up' : 'down'}`}>{`${p - book >= 0 ? '+' : ''}${((p - book) * 100).toFixed(1).replace('.', ',')} pt`}</span>
            </dd>
          </div>
        )}
        <div>
          <dt>Jeux (médiane)</dt>
          <dd>
            {r.sim.games.p50} <span className="muted small">({r.sim.games.p10}-{r.sim.games.p90})</span>
          </dd>
        </div>
        <div>
          <dt>{dog.name.split(' ').at(-1)} prend un set</dt>
          <dd>{pct(r.sim.atLeast1[1 - i])}</dd>
        </div>
      </dl>
    </section>
  );
}

function topScore(r: TennisResult): string {
  const [k] = Object.entries(r.sim.scores).sort((a, b) => b[1] - a[1])[0] ?? [''];
  if (!k) return '-';
  const [a, b] = k.split('-').map(Number);
  return a > b ? `${r.home.name.split(' ').at(-1)} ${a}-${b}` : `${r.away.name.split(' ').at(-1)} ${b}-${a}`;
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
                {b.tiers.advised.n} matchs ; pile ou face (favori sous 60 %) : {rateTxt(b.tiers.flip)} sur {b.tiers.flip.n}
              </small>
            </div>
          </section>
          <p className="note" style={{ margin: '12px 0 18px' }}>
            Le pronostic compté est celui que la fiche met en avant : le vainqueur, ou « Un set » quand le favori est à 75 % ou moins. Une simulation lancée après le début du match ne compte pas.
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
