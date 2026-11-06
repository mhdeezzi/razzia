// Onglet Football : programme (Premier League, LaLiga, Ligue 1, Ligue des Champions, Serie A quand un grand club joue),
// fiche de match avec la simulation (25 000 matchs tir par tir), mêmes principes que le basket et le tennis : un
// pronostic mis en avant, un combiné rattaché, Razzia assuré (vert), risqué (orange), pile ou face (rouge).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, CaretRight, Coins, ListBullets, ShieldCheck, SoccerBall, SquaresFour, WarningCircle } from '@phosphor-icons/react';
import { Callout, Empty, glow, Link, PageHero, Ring, Segmented, SimProgress, TeamMark } from './ui.tsx';
import { marbleVars, PickTabs } from './results.tsx';
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
  home: Team; away: Team; lineupType: 'official' | 'predicted' | 'unknown';
  lineups: Array<{ formation?: string; coach?: string; starters: string[]; out: Array<{ name: string; why: string }> }>;
  lambda: [number, number]; engine: { h: number; d: number; a: number }; final: { h: number; d: number; a: number };
  market?: { odds: Odds; src?: string };
  probs: Record<string, number>; labels: Record<string, string>;
  scores: Array<{ h: number; a: number; p: number }>; firstGoal: [number, number, number]; ht: number[][];
  pick: { id: string; label: string; p: number } | null; combo: { id: string; label: string; p: number; risky: boolean };
  tier: Tier; T: number; scorers: Array<{ id: number; name: string; side: 'home' | 'away'; p: number }>; n: number;
  meta: { builtAt: string; gamesUsed: number; model?: string };
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
const LEAGUE_FR: Record<number, string> = { 42: 'Ligue des Champions', 47: 'Premier League', 87: 'LaLiga', 55: 'Serie A', 53: 'Ligue 1' };
const LEAGUE_ORDER = [42, 47, 87, 55, 53];
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
  'VfB Stuttgart': 'Stuttgart', 'RB Leipzig': 'Leipzig', 'Club Brugge': 'Bruges', 'Sporting CP': 'Sporting', 'FC Porto': 'Porto',
  'Bodø/Glimt': 'Bodø/Glimt', 'AEK Athens': 'AEK Athènes', 'Athletic Club': 'Bilbao', 'Celta Vigo': 'Celta', 'Real Betis': 'Betis', 'Sabah FK': 'Sabah',
};
const short = (n: string) => SHORT[n] ?? n;
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
  8640: '#ed1c24', 178475: '#dd0741', 951893: '#2c6fb7', 9728: '#f07d00', 7787: '#c8102e', 6019: '#4aa3df', 9768: '#00804a', 10269: '#e32219', 8478: '#0b5aa6',
};
const colorOf = (id: number) => glow(COLOR[id] ?? '#5a5f69');
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
  const fav = short(homeFav ? sim.home : sim.away);
  const cls = sim.tier === 'flip' ? ' flip' : sim.tier === 'risky' ? ' risky' : '';
  if (sim.pick) {
    const id = sim.pick.id ?? '';
    const base = id.split('+')[0];
    const text =
      base === '1' ? short(sim.home) : base === '2' ? short(sim.away) : base === '1X' ? `${short(sim.home)} ou nul` : base === 'X2' ? `${short(sim.away)} ou nul` : base === '12' ? 'Pas de nul' : '';
    return { text: text ? `${text}${id.includes('+') ? ' +' : ''}` : sim.pick.label, p: sim.pick.p, cls };
  }
  return { text: sim.tier === 'flip' ? 'Pile ou face' : `${fav} ou nul`, p: homeFav ? sim.final.h + sim.final.d : sim.final.a + sim.final.d, cls };
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

/** Affiche du jour : la Ligue des Champions et les grands clubs d'abord. */
const BIG = new Set([9847, 8633, 8634, 9823, 8456, 8650, 9825, 8455, 10260, 9885, 8636, 8564, 9906, 9789, 8592, 9875, 8586, 10261]);
const hypeOf = (m: SlateMatch) => (({ 42: 3, 47: 2.5, 87: 2, 55: 2, 53: 2 }) as Record<number, number>)[m.lg] ?? 1;
const score = (m: SlateMatch) => hypeOf(m) + (BIG.has(m.home.id) ? 2 : 0) + (BIG.has(m.away.id) ? 2 : 0) + (BIG.has(m.home.id) && BIG.has(m.away.id) ? 3 : 0);

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
  const firstWithMatches = dates.slice(1).find((d) => (byDay.get(d)?.length ?? 0) > 0) ?? today;
  const current = day && byDay.has(day) ? day : firstWithMatches;
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
      <PageHero sport="foot" title="Programme Football" day={cap(dayLongOf(current))} count={dayMatches.length} feature={<FootUne matches={dayMatches} sims={sims} />}>
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
            <Empty title="Pas de match ce jour-là dans les championnats suivis." />
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
  const lost = st === 'post' && m.score && (side === 'home' ? m.score[0] < m.score[1] : m.score[1] < m.score[0]);
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

function FootSimPill({ sim, running }: { sim?: SimIndex; running: boolean }) {
  if (running)
    return (
      <span className="conf-pill run">
        <span className="spin spin-xs" /> Calcul
      </span>
    );
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
        <FootSimPill sim={sim} running={running} />
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
    const lost = st === 'post' && m.score && (side === 'home' ? m.score[0] < m.score[1] : m.score[1] < m.score[0]);
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
          <FootSimPill sim={sim} running={running} />
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
  const m = slate?.matches.find((x) => x.id === id);
  if (!r && !m) return slate ? null : <span className="sk sk-hero" aria-busy="true" />;
  const st = m ? stateOf(m) : 'pre';
  const home = r?.home ?? m!.home, away = r?.away ?? m!.away;
  const start = r?.start ?? m!.start;
  const round = r?.round ?? m?.round;
  const team = (t: Team, k: 'home' | 'away') => {
    const lost = st === 'post' && m?.score && (k === 'home' ? m.score[0] < m.score[1] : m.score[1] < m.score[0]);
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
      <WarpBg c1={colorOf(home.id)} c2={colorOf(away.id)} />
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
  return (
    <div className="page">
      <Link href="/foot" className="back">
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
const SURE_TEXT = 'À 85 % ou plus, ce pronostic est passé 91 % du temps sur 2024 à 2026 (un match sur cinq).';

/** Catégories de paris : vainqueur, double chance, combinés (le combiné rattaché en tête), buts. */
function buildFootCategories(r: FootResult): Category[] {
  const P = r.probs, L = r.labels;
  const o = r.market?.odds;
  const homeFav = r.final.h >= r.final.a;
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
    const out: Outcome = { id, title: L[id], p, who: whoOf(id), fair: p > 0 ? 1 / p : undefined, odds: oddsOf[id], implied: nv?.[id] };
    if (r.pick?.id === id) out.safe = r.tier === 'sure' ? 'Razzia assuré' : 'Pronostic Razzia';
    if (r.combo.id === id) {
      if (r.combo.risky) out.warn = 'Risqué';
      else if (!out.safe) out.safe = 'Combiné rattaché';
    }
    return out;
  };
  const list = (ids: string[]) => ids.map(item).filter((x): x is Outcome => !!x);
  const winner = list(homeFav ? ['1', 'X', '2'] : ['2', 'X', '1']);
  const double = list(homeFav ? ['1X', '12', 'X2'] : ['X2', '12', '1X']);
  const dc = homeFav ? '1X' : 'X2';
  const combos = list([r.combo.id, ...Object.keys(P).filter((k) => (k.startsWith(`${dc}+`) || k === `${homeFav ? '1' : '2'}+o1.5`) && k !== r.combo.id).sort((a, b) => P[b] - P[a]).slice(0, 4)]);
  const more = (a: string, b: string) => ((P[a] ?? 0) >= (P[b] ?? 0) ? a : b);
  const goals = list([more('o1.5', 'u1.5'), more('o2.5', 'u2.5'), more('o3.5', 'u3.5'), more('btts', 'nobtts'), more('h05', 'u0.5') === 'h05' ? 'h05' : '', more('a05', 'u0.5') === 'a05' ? 'a05' : ''].filter(Boolean));
  const cats: Category[] = [
    { id: 'double', label: 'Double chance', items: double },
    { id: 'win', label: 'Vainqueur', items: winner },
    { id: 'combo', label: 'Combiné', items: combos, risky: r.combo.risky },
    { id: 'goals', label: 'Buts', items: goals },
  ];
  // L'onglet du pronostic mis en avant passe en premier, avec le point bleu.
  const at = cats.findIndex((c) => c.items.some((x) => x.id === r.pick?.id));
  if (at >= 0) cats[at] = { ...cats[at], good: true };
  if (at > 0) cats.unshift(...cats.splice(at, 1));
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
      {r.tier === 'flip' && <span className="odds-warn verdict-warn">Pile ou face</span>}
      <div className="verdict-ring">
        <Ring value={p} format={pct0} label={r.pick ? 'Pronostic' : 'Double chance'} marble={colorOf(fav.id)} />
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
          <dt>Buts attendus</dt>
          <dd>
            {r.lambda[0].toFixed(1).replace('.', ',')} - {r.lambda[1].toFixed(1).replace('.', ',')}
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
  const cols = useMemo(() => ({ home: colorOf(r.home.id), away: colorOf(r.away.id) }), [r]);
  const homeFav = r.final.h >= r.final.a;
  const maxScore = r.scores[0]?.p ?? 1;
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
        <Section title="Scores probables" tag={`${r.n.toLocaleString('fr-FR')} matchs simulés`}>
          <ul className="f-scores">
            {r.scores.slice(0, 9).map((s) => (
              <li key={`${s.h}-${s.a}`} className={s.h > s.a ? 'h' : s.h < s.a ? 'a' : 'd'}>
                <b className="mono">
                  {s.h}-{s.a}
                </b>
                <span className="f-bar">
                  <span style={{ width: `${(s.p / maxScore) * 100}%` }} />
                </span>
                <span className="mono muted">{pct(s.p)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Premier but" tag="qui ouvre le score">
          <div className="f-first">
            {(
              [
                [r.home.name, r.firstGoal[0], 'h'],
                ['Pas de but', r.firstGoal[2], 'd'],
                [r.away.name, r.firstGoal[1], 'a'],
              ] as const
            ).map(([name, p, k]) => (
              <div key={k} className={`f-first-i ${k}`}>
                <span>{short(name)}</span>
                <b className="mono">{pct0(p)}</b>
              </div>
            ))}
          </div>
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
        <Section title="Compositions" tag={r.lineupType === 'official' ? 'officielles' : r.lineupType === 'predicted' ? 'probables' : 'pas encore connues'}>
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
        <p className="footnote">
          Données jusqu'au {new Date(r.meta.builtAt).toLocaleDateString('fr-FR')} : {r.meta.gamesUsed.toLocaleString('fr-FR')} matchs (FotMob : buts, xG, tirs, compositions)
          {r.market ? `, cotes ${r.market.src === 'pinnacle' ? 'Pinnacle' : 'moyennes'} (football-data)` : ''}. Probabilité Razzia : 80 % marché, 20 % moteur en championnat quand une cote
          existe, moteur seul sinon. Les probabilités décrivent le modèle, pas une certitude. Jouer comporte des risques.
        </p>
      </div>
    </SideColors.Provider>
  );
}
