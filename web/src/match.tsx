// Fiche de match : bandeau, onglets Aperçu / Simulation, lancement et suivi de la simulation.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowSquareOut, Basketball, Check, Clock, FirstAidKit, MapPin, Sparkle, WarningCircle } from '@phosphor-icons/react';
import {
  dayLong, line, listSims, loadProgramme, odds, pending, simKey, simStatus, startSim, teamColor, timeLocal,
  type Game, type Injury, type Programme, type SimState,
} from './data.ts';
import { Results } from './results.tsx';
import { BookOdds } from './books.tsx';
import { Empty, Link, TeamMark } from './ui.tsx';

type Tab = 'apercu' | 'sim';

export function MatchPage({ date, away, home }: { date: string; away: string; home: string }) {
  const [prog, setProg] = useState<Programme>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    loadProgramme().then(setProg, (e: Error) => setError(e.message));
  }, []);
  const g = prog?.games.find((x) => x.date === date && x.away.tri === away && x.home.tri === home);

  return (
    <div className="page">
      <Link href={`/?jour=${date}`} className="back">
        <ArrowLeft size={16} /> Programme
      </Link>
      {error && <Empty title="Le programme n'a pas pu être chargé.">{error}</Empty>}
      {!prog && !error && <span className="sk sk-hero" aria-busy="true" />}
      {prog && !g && <Empty title="Match introuvable dans les 7 prochains jours." />}
      {g && <Match g={g} injuries={prog!.injuries} />}
    </div>
  );
}

/** État de la simulation d'un match, avec reprise du suivi après rechargement. */
function useSim(g: Game) {
  const key = simKey(g);
  const [state, setState] = useState<SimState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const poll = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = pending.get(key);
    try {
      const s = await simStatus(g, p?.req);
      setState(s);
      if (s.status === 'queued' || s.status === 'running') timer.current = window.setTimeout(poll, 5000);
      else if (p) {
        pending.clear(key);
        void listSims(true);
      }
    } catch (e) {
      setState({ status: 'failed', error: (e as Error).message });
    }
  }, [g, key]);

  useEffect(() => {
    void poll();
    return () => window.clearTimeout(timer.current);
  }, [poll]);

  const launch = async () => {
    setBusy(true);
    try {
      const req = await startSim(g);
      pending.set(key, { req, at: Date.now() });
      setState((s) => ({ status: 'queued', previous: s.status === 'done' ? s.result : undefined }));
      timer.current = window.setTimeout(poll, 4000);
    } catch (e) {
      setState({ status: 'failed', error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return { state, busy, launch, since: pending.get(key)?.at };
}

function Match({ g, injuries }: { g: Game; injuries: Record<string, Injury[]> }) {
  const sim = useSim(g);
  const [tab, setTab] = useState<Tab | undefined>();
  const s = sim.state.status;
  // Onglet par défaut : la simulation (lancement si elle n'existe pas encore).
  const current: Tab = tab ?? 'sim';
  const go = async () => {
    setTab('sim');
    if (s !== 'queued' && s !== 'running') await sim.launch();
  };

  return (
    <>
      <Hero g={g} />
      <div className="tabs-row" role="tablist">
        <button role="tab" aria-selected={current === 'apercu'} className={`tab-big${current === 'apercu' ? ' is-on' : ''}`} onClick={() => setTab('apercu')}>
          Aperçu
        </button>
        <button role="tab" aria-selected={current === 'sim'} className={`tab-big glow${current === 'sim' ? ' is-on' : ''}`} onClick={() => setTab('sim')}>
          <Sparkle size={18} weight="fill" /> Simulation
          {(s === 'queued' || s === 'running') && <span className="dot" aria-label="en cours" />}
        </button>
      </div>

      <div className="tab-panel" key={current}>
        {current === 'apercu' ? <Overview g={g} injuries={injuries} sim={sim.state} onSim={go} busy={sim.busy} /> : <SimPanel g={g} {...sim} />}
      </div>
    </>
  );
}

function Hero({ g }: { g: Game }) {
  const team = (side: 'away' | 'home') => (
    <div className={`hero-team ${side}`}>
      <TeamMark team={g[side]} size="xl" />
      <div>
        <p className="hero-name">{g[side].name}</p>
        <p className="hero-rec">
          {g[side].city}
          {g[side].record ? ` | ${g[side].record}` : ''}
        </p>
      </div>
    </div>
  );
  return (
    <header className="hero" style={{ '--away': teamColor(g.away), '--home': teamColor(g.home) } as CSSProperties}>
      <div className="hero-meta">
        <span>
          <Basketball size={15} /> NBA
        </span>
        {g.venue && (
          <>
            <i />
            <span>
              <MapPin size={15} /> {g.venue}
            </span>
          </>
        )}
      </div>
      <div className="hero-grid">
        {team('away')}
        <div className="hero-mid">
          {g.state === 'pre' ? (
            <>
              <span className="hero-vs" aria-hidden="true">
                VS
              </span>
              <span className="hero-time">{timeLocal(g.start)}</span>
            </>
          ) : (
            <>
              <span className="hero-score">
                {g.away.score ?? '-'}
                <span className="muted">:</span>
                {g.home.score ?? '-'}
              </span>
              <span className="hero-time">{g.state === 'in' ? g.detail : 'Final'}</span>
            </>
          )}
        </div>
        {team('home')}
      </div>
      <p className="hero-date">{dayLong(g.date)}</p>
    </header>
  );
}

function Overview({ g, injuries, sim, onSim, busy }: { g: Game; injuries: Record<string, Injury[]>; sim: SimState; onSim: () => void; busy: boolean }) {
  const done = sim.status === 'done';
  const running = sim.status === 'queued' || sim.status === 'running';
  return (
    <div className="results">
      {g.state !== 'post' && (
        <section className="cta-card">
          <div>
            <h3>{done ? 'La simulation est prête.' : running ? 'Simulation en cours.' : 'Rejouer ce match 5 000 fois.'}</h3>
            <p>
              {done
                ? 'Probabilités, paris mis en avant, duel statistique et projections de chaque joueur.'
                : 'Avec les effectifs, les absences et les cotes du moment. Résultat en quelques minutes.'}
            </p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={onSim} disabled={busy}>
            {busy ? <span className="spin" /> : <Sparkle size={18} weight="fill" />} {done || running ? 'Voir la simulation' : 'Lancer la simulation'}
          </button>
        </section>
      )}

      <section className="box">
        <div className="box-head">
          <span className="box-icon">
            <Clock size={18} />
          </span>
          Informations du match
        </div>
        <dl className="info3">
          <div>
            <dt>Salle</dt>
            <dd>{[g.venue, g.city].filter(Boolean).join(', ') || 'Non communiquée'}</dd>
          </div>
          <div>
            <dt>Coup d'envoi</dt>
            <dd>
              {new Date(g.start).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })} à {timeLocal(g.start)}
            </dd>
          </div>
          <div>
            <dt>Diffusion (US)</dt>
            <dd>{g.tv.join(', ') || 'Non communiquée'}</dd>
          </div>
        </dl>
      </section>

      <div className="aside" style={{ position: 'static', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <OddsBox g={g} />
        <Absences g={g} injuries={injuries} />
        {g.state === 'pre' && <BookOdds g={g} />}
      </div>
    </div>
  );
}

function OddsBox({ g }: { g: Game }) {
  const o = g.odds;
  const sp = (v: number) => (v > 0 ? `+${line(v)}` : v === 0 ? 'PK' : line(v));
  return (
    <section className="box">
      <div className="box-head">
        <span className="box-icon">
          <Basketball size={18} />
        </span>
        Cotes{o?.provider ? ` ${o.provider}` : ''}
      </div>
      <div className="box-body">
        {!o ? (
          <p className="muted">Cotes pas encore publiées.</p>
        ) : (
          <table className="odds-t">
            <thead>
              <tr>
                <th />
                <th>Handicap</th>
                <th>Vainqueur</th>
              </tr>
            </thead>
            <tbody>
              {(['away', 'home'] as const).map((side) => (
                <tr key={side}>
                  <td>
                    <span>
                      <TeamMark team={g[side]} size="sm" /> {g[side].name}
                    </span>
                  </td>
                  <td className="mono">
                    {o.spreadHome != null ? sp(side === 'home' ? o.spreadHome : -o.spreadHome) : '-'}{' '}
                    <span className="muted">{odds((side === 'home' ? o.spreadOddsHome : o.spreadOddsAway) ?? undefined)}</span>
                  </td>
                  <td className="mono strong">{odds(side === 'home' ? o.mlHome : o.mlAway)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total de points</td>
                <td className="mono" colSpan={2}>
                  {o.total != null ? line(o.total) : '-'}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </section>
  );
}

function Absences({ g, injuries }: { g: Game; injuries: Record<string, Injury[]> }) {
  const rank = (s: string) => (/out/i.test(s) ? 0 : /doubt/i.test(s) ? 1 : /question/i.test(s) ? 2 : 3);
  return (
    <section className="box">
      <div className="box-head">
        <span className="box-icon">
          <FirstAidKit size={18} />
        </span>
        Absences et incertitudes
      </div>
      <div className="box-body">
        {(['away', 'home'] as const).map((side) => {
          const t = g[side];
          const list = [...(injuries[t.tri] ?? [])].sort((a, b) => rank(a.status) - rank(b.status));
          return (
            <div key={side} className="inj-team">
              <p className="inj-head">
                <TeamMark team={t} size="sm" /> {t.name}
              </p>
              {list.length === 0 ? (
                <p className="muted small">Aucun joueur signalé.</p>
              ) : (
                <ul className="inj">
                  {list.map((i) => (
                    <li key={i.name} title={i.detail}>
                      <span>{i.name}</span>
                      <span className={`inj-st inj-${rank(i.status)}`}>{frStatus(i.status)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <p className="muted small">Absent : exclu des simulations. Incertain ou douteux : joue dans une partie des simulations seulement.</p>
      </div>
    </section>
  );
}
const frStatus = (s: string) =>
  ({ Out: 'Absent', Doubtful: 'Douteux', Questionable: 'Incertain', 'Day-To-Day': 'Au jour le jour', Probable: 'Probable' } as Record<string, string>)[s] ?? s;

function SimPanel({ g, state, busy, launch, since }: { g: Game } & ReturnType<typeof useSim>) {
  if (state.status === 'loading') return <span className="sk sk-panel" aria-busy="true" />;
  if (state.status === 'done') return <Results r={state.result} g={g} onRelaunch={launch} busy={busy} />;
  if (state.status === 'queued' || state.status === 'running') return <Progress state={state} since={since} />;

  return (
    <section className="launch">
      {state.status === 'failed' && (
        <div className="alert" role="alert">
          <WarningCircle size={20} weight="bold" />
          <div>
            <p>La simulation n'a pas abouti.</p>
            {state.error && <p className="small muted">{state.error}</p>}
            {state.url && (
              <a className="small" href={state.url} target="_blank" rel="noreferrer">
                Voir le détail <ArrowSquareOut size={12} />
              </a>
            )}
          </div>
        </div>
      )}
      <h2>
        {g.away.name} contre {g.home.name}, <em>joué 5 000 fois.</em>
      </h2>
      <p className="lede">
        Possession par possession : rotations, fautes, fins de match, adresse par zone et défenseurs probables. Il en sort les probabilités de victoire, du
        handicap, du total et les stats de chaque joueur.
      </p>
      <div className="launch-facts">
        <div>
          <b>5 000</b>
          <span>matchs simulés</span>
        </div>
        <div>
          <b>2 600+</b>
          <span>matchs de play-by-play</span>
        </div>
        <div>
          <b>3-6 min</b>
          <span>pour le résultat</span>
        </div>
      </div>
      <button className="btn btn-primary btn-blue btn-lg" onClick={launch} disabled={busy || g.state === 'post'}>
        {busy ? <span className="spin" /> : <Sparkle size={18} weight="fill" />} {busy ? 'Lancement' : 'Lancer la simulation'}
      </button>
      {g.state === 'post' && <p className="small muted">Match terminé.</p>}
    </section>
  );
}

function Progress({ state, since }: { state: Extract<SimState, { status: 'queued' | 'running' }>; since?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const start = since ?? (state.startedAt ? Date.parse(state.startedAt) : now);
  const s = Math.max(0, Math.round((now - start) / 1000));
  const steps = ['Demande envoyée', 'Données du jour : effectifs, absences, cotes', '5 000 simulations', 'Publication des résultats'];
  // Étape estimée : file d'attente, puis préparation (~1 min), puis calcul.
  const at = state.status === 'queued' ? 0 : s < 70 ? 1 : 2;
  return (
    <section className="progress" aria-live="polite">
      <div className="progress-top">
        <div>
          <h2>On joue le match.</h2>
        </div>
        <span className="clock">
          {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="track" />
      <ol className="steps">
        {steps.map((label, i) => (
          <li key={label} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
            <span className="ic">{i < at ? <Check size={14} weight="bold" /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <p className="small muted">
        Compter 3 à 6 minutes, un peu plus pour la toute première simulation. La page se met à jour seule, et la simulation continue si vous la quittez.
      </p>
    </section>
  );
}
