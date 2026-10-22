// Programme : édition du soir. Les matchs d'un jour (heure de New York) en fil d'actualité, filtrés par statut, et la
// colonne de droite : matchs en direct, dernières simulations, chats noirs.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CaretRight, Cat } from '@phosphor-icons/react';
import { dayLong, isToday, line, listSims, loadProgramme, matchPath, noVig, odds, pct0, simKey, timeLocal, type Game, type Programme, type SimEntry } from './data.ts';
import { Empty, Link, TeamMark } from './ui.tsx';

type Status = 'pre' | 'in' | 'post';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Barres segmentées : confiance du favori (simulation, sinon cotes sans marge), de 50 % (0 bloc) à 80 % et plus (6 blocs). */
export function Bars({ p, hot }: { p?: number; hot?: boolean }) {
  const n = p == null ? 0 : Math.max(1, Math.min(6, Math.round(((Math.max(p, 1 - p) - 0.5) / 0.3) * 6)));
  return (
    <span className={`bars${hot ? ' lit' : ''}`} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

export function SchedulePage({ day }: { day: string | null }) {
  const [prog, setProg] = useState<Programme>();
  const [error, setError] = useState<string>();
  const [sims, setSims] = useState<Map<string, SimEntry>>(new Map());
  const [status, setStatus] = useState<Status>('pre');

  useEffect(() => {
    loadProgramme().then(setProg, (e: Error) => setError(e.message));
    listSims(true).then(setSims);
  }, []);

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
  const simulated = dayGames.filter((g) => sims.has(simKey(g))).length;

  return (
    <div className="page">
      <div className="cols">
        <div>
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
              <header className="ed-head">
                <h1 className="ed-date">{cap(dayLong(current))}</h1>
                <p className="ed-edition">
                  {isToday(current) ? 'Édition du soir' : 'Programme'} · {dayGames.length} match{dayGames.length > 1 ? 's' : ''} NBA
                </p>
                <p className="ed-by">
                  Simulé 5 000 fois par match{simulated ? ` · ${simulated} déjà simulé${simulated > 1 ? 's' : ''}` : ''} ·{' '}
                  <Link href="/methode" className="link-u">
                    Comment ça marche
                  </Link>
                </p>
                <div className="ed-tabs" role="tablist" aria-label="Statut">
                  {(
                    [
                      ['pre', 'À venir'],
                      ['in', 'En direct'],
                      ['post', 'Terminés'],
                    ] as const
                  ).map(([s, label]) => (
                    <button key={s} role="tab" aria-selected={status === s} className={`ed-tab${status === s ? ' is-on' : ''}`} disabled={!count(s)} onClick={() => setStatus(s)}>
                      {s === 'in' && count('in') > 0 && <span className="live-dot" />}
                      {label} <span className="n">{count(s)}</span>
                    </button>
                  ))}
                </div>
              </header>

              {dayGames.length === 0 ? (
                <Empty title="Pas de match NBA ce soir-là.">
                  <p>Choisissez un autre jour dans la colonne de gauche.</p>
                </Empty>
              ) : (
                <ol className="rows" key={`${current}-${status}`}>
                  {games.map((g, i) => (
                    <li key={g.id}>
                      <Row g={g} sim={sims.get(simKey(g))} i={i} />
                    </li>
                  ))}
                </ol>
              )}
              <p className="note" style={{ marginTop: 14 }}>
                Heures dans votre fuseau. Barres : confiance du favori, d'après la simulation ou, à défaut, les cotes.
              </p>
            </>
          )}
        </div>
        {prog && <Rail prog={prog} sims={sims} />}
      </div>
    </div>
  );
}

function Row({ g, sim, i }: { g: Game; sim?: SimEntry; i: number }) {
  const o = g.odds;
  const book = o?.mlHome != null && o.mlAway != null ? noVig(o.mlHome, o.mlAway)?.[0] : undefined;
  const p = sim ? sim.pHome : book;
  const favHome = sim ? sim.pHome >= sim.pAway : undefined;
  return (
    <Link href={matchPath(g)} className="ed-row" style={{ '--i': i } as CSSProperties}>
      <div className="ed-time">
        {g.state === 'pre' ? (
          <span className="t">{timeLocal(g.start)}</span>
        ) : g.state === 'in' ? (
          <span className="pill-tag live">
            <span className="live-dot" /> {g.detail || 'Direct'}
          </span>
        ) : (
          <span className="pill-tag final">Final</span>
        )}
        <Bars p={p} hot={!!sim} />
      </div>
      <div>
        <p className="ed-title">
          <TeamMark team={g.away} size="sm" />
          <span className="ed-title-txt">
            {g.away.name} <span className="at">@</span> {g.home.name}
          </span>
          <TeamMark team={g.home} size="sm" />
          {g.state !== 'pre' && (
            <span className="ed-score">
              {g.away.score ?? '-'}-{g.home.score ?? '-'}
            </span>
          )}
          {sim?.cat && (
            <span className="cat-mini" title={`Chat noir pour ${sim.cat}`} aria-label={`Chat noir pour ${sim.cat}`}>
              <Cat size={13} weight="fill" />
            </span>
          )}
        </p>
        <p className="ed-sub">
          {g.away.city}
          {g.away.record ? ` (${g.away.record})` : ''} chez {g.home.city}
          {g.home.record ? ` (${g.home.record})` : ''}
          {g.venue ? ` · ${g.venue}` : ''}
        </p>
        <p className="ed-meta">
          {o?.mlAway != null && (
            <span>
              Cotes <span className="mono">{odds(o.mlAway)} / {odds(o.mlHome)}</span>
            </span>
          )}
          {o?.total != null && (
            <span>
              Total <span className="mono">{line(o.total)}</span>
            </span>
          )}
          {sim ? (
            <span>
              Simulé : <b className="fav">{favHome ? g.home.name : g.away.name} {pct0(Math.max(sim.pHome, sim.pAway))}</b>
            </span>
          ) : (
            g.state === 'pre' && <span>Pas encore simulé</span>
          )}
        </p>
      </div>
      <span className="ed-go">
        {sim ? 'Voir' : g.state === 'post' ? 'Fiche' : 'Simuler'} <CaretRight size={14} />
      </span>
    </Link>
  );
}

/** Colonne de droite : en direct, dernières simulations, chats noirs. */
function Rail({ prog, sims }: { prog: Programme; sims: Map<string, SimEntry> }) {
  const live = prog.games.filter((g) => g.state === 'in');
  const find = (dir: string) => {
    const [date, teams] = dir.split('_');
    const [away, home] = teams.split('@');
    return { date, away, home, g: prog.games.find((x) => x.date === date && x.away.tri === away && x.home.tri === home) };
  };
  const recent = [...sims.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const cats = [...sims.values()].filter((e) => e.cat).map((e) => ({ e, ...find(e.dir) })).filter((x) => x.g);
  return (
    <aside className="rail" aria-label="En ce moment">
      <section className="rail-block">
        <h2>{live.length > 0 && <span className="live-dot" />}En direct</h2>
        {live.length === 0 ? (
          <p className="rail-note" style={{ paddingTop: 12 }}>
            Aucun match en cours.
          </p>
        ) : (
          <ul className="rail-list">
            {live.map((g) => (
              <li key={g.id}>
                <Link href={matchPath(g)} className="rail-item">
                  <span className="t">{g.detail}</span>
                  <span>
                    {g.away.tri} <b className="mono">{g.away.score}</b> - <b className="mono">{g.home.score}</b> {g.home.tri}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rail-block">
        <h2>Dernières simulations</h2>
        {recent.length === 0 ? (
          <p className="rail-note" style={{ paddingTop: 12 }}>
            Aucune pour l'instant : choisissez un match.
          </p>
        ) : (
          <ul className="rail-list">
            {recent.map((e) => {
              const { date, away, home, g } = find(e.dir);
              const homeFav = e.pHome >= e.pAway;
              return (
                <li key={e.dir}>
                  <Link href={g ? matchPath(g) : `/match/${date}/${away}-${home}`} className="rail-item">
                    <span className="t">{new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>
                      {away} @ {home}
                      <small>
                        {homeFav ? g?.home.name ?? home : g?.away.name ?? away} {pct0(Math.max(e.pHome, e.pAway))}
                      </small>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/simulations" className="rail-more">
          Toutes les simulations
        </Link>
      </section>
      {cats.length > 0 && (
        <section className="rail-block">
          <h2>
            <span className="cat-mini">
              <Cat size={13} weight="fill" />
            </span>
            Chats noirs
          </h2>
          <ul className="rail-list">
            {cats.map(({ e, g }) => (
              <li key={e.dir}>
                <Link href={matchPath(g!)} className="rail-item">
                  <span className="t">{timeLocal(g!.start)}</span>
                  <span>
                    {g!.away.name} @ {g!.home.name}
                    <small>Chat noir pour {e.cat}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="rail-note">Razzia analyse les matchs, il ne prend pas de paris. Jouer comporte des risques : 09 74 75 13 13.</p>
    </aside>
  );
}

function ScheduleSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement du programme">
      <span className="sk sk-title" />
      <span className="sk" style={{ height: 22, width: '40%', marginBottom: 28 }} />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="sk sk-row" />
      ))}
    </div>
  );
}
