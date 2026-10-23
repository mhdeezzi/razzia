// Programme : les matchs des 7 prochains jours (heure de New York), en liste ou en grille, filtrés par statut.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowSquareOut, CalendarBlank, CaretRight, Cat, Check, ListBullets, SquaresFour, TrendUp, WarningCircle, X } from '@phosphor-icons/react';
import { dayLong, isToday, line, listSims, loadProgramme, matchPath, odds, pct0, simKey, timeLocal, type Game, type Programme, type SimEntry } from './data.ts';
import { dismissBatch, isRunning, startBatch, useBatch, type Batch, type ItemState } from './batch.ts';
import { Empty, Link, Segmented, TeamMark } from './ui.tsx';

type Status = 'pre' | 'in' | 'post';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
type View = 'liste' | 'grille';

const storedView = (): View => {
  try {
    return localStorage.getItem('vue') === 'grille' ? 'grille' : 'liste';
  } catch {
    return 'liste';
  }
};

export function SchedulePage({ day }: { day: string | null }) {
  const [prog, setProg] = useState<Programme>();
  const [error, setError] = useState<string>();
  const [sims, setSims] = useState<Map<string, SimEntry>>(new Map());
  const [view, setView] = useState<View>(storedView);
  const [status, setStatus] = useState<Status>('pre');

  const batch = useBatch();
  useEffect(() => {
    loadProgramme().then(setProg, (e: Error) => setError(e.message));
    listSims(true).then(setSims);
  }, []);
  // Chaque match publié par la soirée en cours rafraîchit les pastilles ; une seconde lecture passe après le cache du CDN.
  const published = batch?.items.filter((i) => i.state === 'done').length ?? 0;
  useEffect(() => {
    if (!published) return;
    listSims(true, true).then(setSims);
    const t = window.setTimeout(() => listSims(true, true).then(setSims), 25_000);
    return () => window.clearTimeout(t);
  }, [published]);
  const runOf = (g: Game): ItemState | undefined => batch?.items.find((i) => i.key === simKey(g))?.state;
  useEffect(() => {
    try {
      localStorage.setItem('vue', view);
    } catch {
      /* préférence non mémorisée */
    }
  }, [view]);

  const byDay = useMemo(() => {
    const m = new Map<string, Game[]>();
    for (const d of prog?.dates ?? []) m.set(d, []);
    for (const g of prog?.games ?? []) m.get(g.date)?.push(g);
    for (const list of m.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  }, [prog]);

  const firstWithGames = prog?.dates.find((d) => (byDay.get(d)?.length ?? 0) > 0) ?? prog?.dates[0];
  const current = day && byDay.has(day) ? day : firstWithGames;
  const dayGames = current ? byDay.get(current) ?? [] : [];
  const count = (s: Status) => dayGames.filter((g) => g.state === s).length;
  // Le filtre suit le jour : on bascule sur un statut qui a des matchs.
  useEffect(() => {
    if (dayGames.length && !dayGames.some((g) => g.state === status)) setStatus((['in', 'pre', 'post'] as const).find((s) => dayGames.some((g) => g.state === s))!);
  }, [current, prog]);
  const games = dayGames.filter((g) => g.state === status);

  return (
    <div className="page">
      <header className="dash-head">
        <div>
          <h1>Programme NBA</h1>
          {current && (
            <p className="dash-meta">
              <CalendarBlank size={16} /> <span>{cap(dayLong(current))}</span>
              <span className="count">
                {dayGames.length} match{dayGames.length > 1 ? 's' : ''}
              </span>
            </p>
          )}
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

      {!prog && !error && <ScheduleSkeleton />}

      {prog && current && (
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
            {prog.dates.map((d, i) => {
              const n = byDay.get(d)?.length ?? 0;
              const name = isToday(d) ? "Aujourd'hui" : i === 1 && isToday(prog.dates[0]) ? 'Demain' : new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short' });
              return (
                <Link key={d} href={`/?jour=${d}`} replace className={`day${d === current ? ' is-on' : ''}${n ? '' : ' is-empty'}`}>
                  <span className="day-name">{name}</span>
                  <span className="day-date">{new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                  <span className="day-count">{n ? `${n} match${n > 1 ? 's' : ''}` : 'repos'}</span>
                </Link>
              );
            })}
          </nav>

          <SheetBar day={current} games={dayGames} batch={batch} />
          {batch?.date === current && <BatchTracker b={batch} />}

          {dayGames.length === 0 ? (
            <Empty title="Pas de match NBA ce soir-là." />
          ) : view === 'liste' ? (
            <section className="league-card" key={`${current}-${status}`}>
              <div className="league-top">
                <h2>NBA</h2>
                <span className="badge-n">{games.length}</span>
                <span className="muted">Heures dans votre fuseau</span>
              </div>
              <div className="thead" aria-hidden="true">
                <span>Heure</span>
                <span className="c">Match</span>
                <span className="c">Cotes</span>
                <span className="c c-total">Total</span>
                <span className="c">Simulation</span>
                <span />
              </div>
              <ol className="rows">
                {games.map((g, i) => (
                  <li key={g.id}>
                    <Row g={g} sim={sims.get(simKey(g))} run={runOf(g)} i={i} />
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <div className="cards" key={`${current}-${status}`}>
              {games.map((g, i) => (
                <Card key={g.id} g={g} sim={sims.get(simKey(g))} run={runOf(g)} i={i} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TimeTag({ g }: { g: Game }) {
  if (g.state === 'in')
    return (
      <span className="pill-tag live">
        <span className="live-dot" /> Direct
      </span>
    );
  if (g.state === 'post') return <span className="pill-tag final">Final</span>;
  const local = new Date(g.start).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  const us = new Date(`${g.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  return local !== us ? <span className="pill-tag">{local.replace('.', '')}</span> : <span className="pill-tag">À venir</span>;
}

function SimPill({ g, sim, run }: { g: Game; sim?: SimEntry; run?: ItemState }) {
  // Match pris dans la soirée en cours : son état passe avant l'ancienne simulation.
  if (run === 'sending' || run === 'queued')
    return (
      <span className="conf-pill wait">
        <span className="wait-dot" /> En file
      </span>
    );
  if (run === 'running')
    return (
      <span className="conf-pill run">
        <span className="spin spin-xs" /> Calcul
      </span>
    );
  if (run === 'failed')
    return (
      <span className="conf-pill fail">
        <WarningCircle size={13} weight="bold" /> Échec
      </span>
    );
  if (!sim && run === 'done')
    return (
      <span className="conf-pill sim">
        <Check size={13} weight="bold" /> Prêt
      </span>
    );
  if (!sim) return <span className="conf-pill go">Simuler</span>;
  const home = sim.pHome >= sim.pAway;
  return (
    <span className="pill-group">
      {sim.cat && (
        <span className="cat-mini" title={`Chat noir pour ${sim.cat}`} aria-label={`Chat noir pour ${sim.cat}`}>
          <Cat size={13} weight="fill" />
        </span>
      )}
      <span className="conf-pill sim">
        <TrendUp size={13} weight="bold" /> {home ? g.home.tri : g.away.tri} {pct0(Math.max(sim.pHome, sim.pAway))}
      </span>
    </span>
  );
}

function Row({ g, sim, run, i }: { g: Game; sim?: SimEntry; run?: ItemState; i: number }) {
  const o = g.odds;
  return (
    <Link href={matchPath(g)} className="row" style={{ '--i': i } as CSSProperties}>
      <div className="row-time">
        <span className="t">{g.state === 'pre' ? timeLocal(g.start) : `${g.away.score ?? '-'}-${g.home.score ?? '-'}`}</span>
        <TimeTag g={g} />
      </div>
      <div className="vs-line">
        <div className="vs-team away">
          <span>
            <span className="vs-name">{g.away.name}</span>
            <span className="vs-rec">{g.away.record ?? ''}</span>
          </span>
          <TeamMark team={g.away} size="md" />
        </div>
        <span className="vs-at">@</span>
        <div className="vs-team">
          <TeamMark team={g.home} size="md" />
          <span>
            <span className="vs-name">{g.home.name}</span>
            <span className="vs-rec">{g.home.record ?? ''}</span>
          </span>
        </div>
      </div>
      <span className="cell-odds">{o?.mlAway != null ? `${odds(o.mlAway)} / ${odds(o.mlHome)}` : '-'}</span>
      <span className="cell-total">{o?.total != null ? line(o.total) : '-'}</span>
      <span style={{ textAlign: 'center' }}>
        <SimPill g={g} sim={sim} run={run} />
      </span>
      <CaretRight size={16} className="row-caret" />
    </Link>
  );
}

function Card({ g, sim, run, i }: { g: Game; sim?: SimEntry; run?: ItemState; i: number }) {
  const o = g.odds;
  const team = (side: 'away' | 'home') => (
    <div className="card-team">
      <TeamMark team={g[side]} size="lg" />
      <span>{g[side].name}</span>
      <small>{g.state === 'pre' ? g[side].record ?? '' : g[side].score ?? ''}</small>
    </div>
  );
  return (
    <Link href={matchPath(g)} className="card" style={{ '--i': i } as CSSProperties}>
      <div className="card-top">
        <span className="mono strong">{g.state === 'pre' ? timeLocal(g.start) : g.detail}</span>
        <TimeTag g={g} />
      </div>
      <div className="card-vs">
        {team('away')}
        <span className="card-x">VS</span>
        {team('home')}
      </div>
      <div className="card-foot">
        <span>
          {o?.mlAway != null ? `${odds(o.mlAway)} / ${odds(o.mlHome)}` : 'Cotes à venir'}
          {o?.total != null ? `  |  ${line(o.total)}` : ''}
        </span>
        <SimPill g={g} sim={sim} run={run} />
      </div>
    </Link>
  );
}

const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });

/** Au-dessus de la feuille, à droite : simuler tous les matchs à venir du jour. Une seule soirée à la fois. */
function SheetBar({ day, games, batch }: { day: string; games: Game[]; batch?: Batch }) {
  const todo = games.filter((g) => g.state === 'pre');
  const running = isRunning(batch);
  const mine = running && batch.date === day;
  const elsewhere = running && batch.date !== day;
  if (!todo.length && !mine) return null;
  const done = batch?.items.filter((i) => i.state === 'done').length ?? 0;
  return (
    <div className="sheet-bar">
      {elsewhere && (
        <p className="sheet-hint">
          Une soirée est déjà en calcul ({shortDay(batch.date)}).{' '}
          <Link href={`/?jour=${batch.date}`} replace>
            Voir
          </Link>
        </p>
      )}
      <button
        className="btn-soiree"
        disabled={running}
        onClick={() => void startBatch(day, todo)}
        title={elsewhere ? undefined : `Simule les ${todo.length} matchs à venir de ce jour, en parallèle`}
      >
        {mine ? 'Soirée en cours' : 'Simuler toute la soirée'}
        <span className="n">{mine ? `${done}/${batch.items.length}` : `${todo.length} match${todo.length > 1 ? 's' : ''}`}</span>
      </button>
    </div>
  );
}

/** Suivi de la soirée : une barre découpée en un segment par match (file, calcul, publié, échec), le chrono et le lien GitHub. */
function BatchTracker({ b }: { b: Batch }) {
  const running = isRunning(b);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  const n = b.items.length;
  const count = (f: (s: ItemState) => boolean) => b.items.filter((i) => f(i.state)).length;
  const done = count((s) => s === 'done');
  const failed = count((s) => s === 'failed');
  const calc = count((s) => s === 'running');
  const wait = count((s) => s === 'queued' || s === 'sending');
  const s = Math.max(0, Math.round(((b.endedAt ?? now) - b.at) / 1000));
  const first = b.items.find((i) => i.state === 'failed' && i.error)?.error;
  const label: Record<ItemState, string> = { sending: 'envoi', queued: 'en file', running: 'en calcul', done: 'publié', failed: 'échec' };
  return (
    <section className="batch" aria-live="polite">
      <div className="batch-head">
        <p className="batch-title">
          {running ? 'Simulation de la soirée' : failed ? 'Soirée simulée, avec des échecs' : 'Soirée simulée'} <span>· {shortDay(b.date)}</span>
        </p>
        <span className="batch-clock mono">
          {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
        </span>
        {b.actions && (
          <a className="batch-link" href={b.actions} target="_blank" rel="noreferrer">
            Suivre sur GitHub <ArrowSquareOut size={12} />
          </a>
        )}
        {!running && (
          <button className="batch-x" onClick={dismissBatch} aria-label="Fermer le suivi">
            <X size={14} weight="bold" />
          </button>
        )}
      </div>
      <div className="batch-bar" role="progressbar" aria-valuemin={0} aria-valuemax={n} aria-valuenow={done} aria-label={`${done} matchs publiés sur ${n}`}>
        {b.items.map((i) => (
          <span key={i.key} className={`is-${i.state === 'sending' ? 'queued' : i.state}`} title={`${i.away} @ ${i.home} : ${label[i.state]}`} />
        ))}
      </div>
      <div className="batch-legend">
        <span>
          <i className="lg-done" /> {done}/{n} publiés
        </span>
        {calc > 0 && (
          <span>
            <i className="lg-run" /> {calc} en calcul
          </span>
        )}
        {wait > 0 && (
          <span>
            <i /> {wait} en file
          </span>
        )}
        {failed > 0 && (
          <span>
            <i className="lg-fail" /> {failed} en échec{first ? ` : ${first}` : ''}
          </span>
        )}
        <span className="muted">{running ? 'Compter 3 à 6 minutes ; le calcul continue si vous quittez la page.' : 'Ouvrez un match pour voir sa simulation.'}</span>
      </div>
    </section>
  );
}

function ScheduleSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement du programme">
      <div className="days">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="sk sk-day" />
        ))}
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="sk sk-row" />
      ))}
    </div>
  );
}
