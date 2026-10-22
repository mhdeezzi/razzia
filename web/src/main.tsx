// Point d'entrée : coque façon édition du soir (barre latérale, contenu), routes (programme, fiche de match,
// simulations, méthode).
import { StrictMode, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { CaretDown, CaretRight, Cat, List, MagnifyingGlass, X } from '@phosphor-icons/react';
import './styles.css';
import { isToday, listSims, loadProgramme, matchPath, timeLocal, type Game, type Programme, type SimEntry } from './data.ts';
import { MatchPage } from './match.tsx';
import { SchedulePage } from './schedule.tsx';
import { Empty, Link, navigate, useLocation } from './ui.tsx';

/** Marque Razzia : un ballon et trois traits de vitesse. */
export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1" y="9.5" width="9" height="2.2" rx="1.1" fill="currentColor" opacity="0.55" />
      <rect x="0" y="14.9" width="11" height="2.2" rx="1.1" fill="currentColor" opacity="0.8" />
      <rect x="2.5" y="20.3" width="8" height="2.2" rx="1.1" fill="currentColor" opacity="0.55" />
      <circle cx="21.5" cy="16" r="9" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12.8 14.2c5.6 2.2 11.8 2.2 17.4 0M21.5 7c-2.8 2.7-2.8 15.3 0 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const dayName = (d: string, first: string) =>
  isToday(d) ? "Aujourd'hui" : isToday(first) && d > first && Date.parse(d) - Date.parse(first) <= 86_400_000 ? 'Demain' : new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' });

function App() {
  const { path, search } = useLocation();
  const m = path.match(/^\/match\/(\d{4}-\d{2}-\d{2})\/([A-Z]{3})-([A-Z]{3})\/?$/);
  const [open, setOpen] = useState(false);
  const [prog, setProg] = useState<Programme>();
  useEffect(() => {
    loadProgramme().then(setProg, () => undefined);
  }, []);
  useEffect(() => setOpen(false), [path, search.toString()]);
  useEffect(() => {
    document.title = m ? `${m[2]} @ ${m[3]} | Razzia` : path === '/simulations' ? 'Simulations | Razzia' : path === '/methode' ? 'Méthode | Razzia' : 'Razzia | Simulations NBA';
  }, [path]);

  const page = m ? (
    <MatchPage key={path} date={m[1]} away={m[2]} home={m[3]} />
  ) : path === '/simulations' ? (
    <SimsPage />
  ) : path === '/methode' ? (
    <MethodPage />
  ) : (
    <SchedulePage day={search.get('jour')} />
  );

  return (
    <>
      <a href="#contenu" className="skip">
        Aller au contenu
      </a>
      <div className="mobile-bar">
        <Link href="/" className="brand">
          <BrandMark /> <span className="word">Razzia</span>
        </Link>
        <button className="menu-btn" aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <X size={20} /> : <List size={20} />}
        </button>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="shell">
        <Sidebar open={open} path={path} day={search.get('jour')} prog={prog} />
        <main id="contenu" className="content">
          {page}
        </main>
      </div>
    </>
  );
}

function Sidebar({ open, path, day, prog }: { open: boolean; path: string; day: string | null; prog?: Programme }) {
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const g of prog?.games ?? []) c.set(g.date, (c.get(g.date) ?? 0) + 1);
    return c;
  }, [prog]);
  const first = prog?.dates[0] ?? '';
  const currentDay = path === '/' ? day ?? prog?.dates.find((d) => counts.get(d)) : undefined;
  const [daysOpen, setDaysOpen] = useState(true);
  return (
    <aside className={`side${open ? ' is-open' : ''}`} aria-label="Navigation">
      <Link href="/" className="brand brand-desk">
        <BrandMark /> <span className="word">Razzia</span>
      </Link>
      <Search prog={prog} />
      <nav className="nav" aria-label="Pages">
        <Link href="/" className={path === '/' ? 'is-on' : ''}>
          Programme
        </Link>
        <Link href="/simulations" className={path === '/simulations' ? 'is-on' : ''}>
          Simulations
        </Link>
        <Link href="/methode" className={path === '/methode' ? 'is-on' : ''}>
          Méthode
        </Link>
      </nav>
      {prog && (
        <div>
          <button className="nav-label" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setDaysOpen((o) => !o)} aria-expanded={daysOpen}>
            Cette semaine <CaretDown size={12} style={{ transform: daysOpen ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />
          </button>
          {daysOpen && (
            <nav className="nav nav-days" aria-label="Jours">
              {prog.dates.map((d) => (
                <Link key={d} href={`/?jour=${d}`} className={d === currentDay ? 'is-on' : ''}>
                  <span style={{ textTransform: 'capitalize' }}>{dayName(d, first)}</span>
                  <span className="n">{counts.get(d) ?? 0}</span>
                </Link>
              ))}
            </nav>
          )}
        </div>
      )}
      <div>
        <p className="nav-label">Sports</p>
        <nav className="nav" aria-label="Sports">
          <Link href="/" className="is-on">
            Basketball <span className="soon">NBA</span>
          </Link>
          <button disabled>
            Football <span className="soon">Bientôt</span>
          </button>
          <button disabled>
            Tennis <span className="soon">Bientôt</span>
          </button>
        </nav>
      </div>
      <div className="side-foot">
        <p>
          <b>Razzia</b> analyse les matchs, il ne prend pas de paris.
        </p>
        <p>Jouer comporte des risques : endettement, dépendance. Appelez le 09 74 75 13 13 (appel non surtaxé).</p>
        <nav>
          <Link href="/methode">Méthode</Link>
          <Link href="/simulations">Historique</Link>
        </nav>
      </div>
    </aside>
  );
}

/** Recherche d'une équipe dans les matchs de la semaine (⌘K / Ctrl K). */
function Search({ prog }: { prog?: Programme }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const hits = useMemo(() => {
    const t = norm(q.trim());
    if (!t || !prog) return [];
    const hay = (g: Game) => norm([g.away.city, g.away.name, g.away.tri, g.home.city, g.home.name, g.home.tri].join(' '));
    return prog.games.filter((g) => hay(g).includes(t)).slice(0, 8);
  }, [q, prog]);
  useEffect(() => setSel(0), [q]);
  const go = (g: Game) => {
    setQ('');
    input.current?.blur();
    navigate(matchPath(g));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(hits.length - 1, s + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
    else if (e.key === 'Enter' && hits[sel]) go(hits[sel]);
    else if (e.key === 'Escape') (setQ(''), input.current?.blur());
  };
  return (
    <div className="search">
      <label className="search-box">
        <MagnifyingGlass size={17} />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Une équipe" aria-label="Chercher une équipe" />
        <span className="kbd">⌘K</span>
      </label>
      {q.trim() && (
        <ul className="search-pop" role="listbox">
          {hits.length === 0 && <li className="none">Aucun match cette semaine.</li>}
          {hits.map((g, i) => (
            <li key={g.id}>
              <Link href={matchPath(g)} className={i === sel ? 'is-on' : ''}>
                <span>
                  {g.away.name} @ {g.home.name}
                </span>
                <small>
                  {new Date(`${g.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })} à {timeLocal(g.start)}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Simulations déjà calculées (branche resultats), reliées aux matchs du programme. */
function SimsPage() {
  const [sims, setSims] = useState<SimEntry[]>();
  const [prog, setProg] = useState<Programme>();
  useEffect(() => {
    listSims(true).then((s) => setSims([...s.values()].sort((a, b) => b.at.localeCompare(a.at))));
    loadProgramme().then(setProg, () => undefined);
  }, []);
  return (
    <div className="page">
      <header className="ed-head">
        <h1 className="ed-date">Simulations</h1>
        <p className="ed-edition">Les matchs déjà simulés, du plus récent au plus ancien.</p>
      </header>
      {!sims && [0, 1, 2, 3].map((i) => <span key={i} className="sk sk-row" aria-busy="true" />)}
      {sims && sims.length === 0 && (
        <Empty title="Aucune simulation pour l'instant.">
          <Link href="/" className="btn btn-ghost">
            Choisir un match
          </Link>
        </Empty>
      )}
      {sims && sims.length > 0 && (
        <ol className="rows">
          {sims.map((e, i) => {
            const [date, teams] = e.dir.split('_');
            const [away, home] = teams.split('@');
            const g = prog?.games.find((x) => x.date === date && x.away.tri === away && x.home.tri === home);
            const homeFav = e.pHome >= e.pAway;
            const fav = homeFav ? g?.home.name ?? home : g?.away.name ?? away;
            return (
              <li key={e.dir}>
                <Link href={g ? matchPath(g) : `/match/${date}/${away}-${home}`} className="ed-row" style={{ '--i': i } as CSSProperties}>
                  <div className="ed-time">
                    <span className="t">{new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                    <span className="when">simulé à {new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div>
                    <p className="ed-title">
                      <span className="ed-title-txt">
                        {g?.away.name ?? away} <span className="at">@</span> {g?.home.name ?? home}
                      </span>
                      {e.cat && (
                        <span className="cat-mini" title={`Chat noir pour ${e.cat}`}>
                          <Cat size={13} weight="fill" />
                        </span>
                      )}
                    </p>
                    <p className="ed-meta">
                      Vainqueur le plus fréquent : <b className="fav">{fav} {Math.round(Math.max(e.pHome, e.pAway) * 100)} %</b>
                    </p>
                  </div>
                  <span className="ed-go">
                    Voir <CaretRight size={14} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {sims && sims.length > 0 && <p className="note" style={{ marginTop: 16 }}>Seuls les matchs des 7 prochains jours s'ouvrent avec leur fiche complète.</p>}
    </div>
  );
}

function MethodPage() {
  return (
    <div className="page prose">
      <header className="ed-head" style={{ marginBottom: 8 }}>
        <h1 className="ed-date">Méthode</h1>
        <p className="ed-edition">Ce que fait le moteur, avec quelles données, et ce que disent nos tests.</p>
      </header>
      <h2>Un match rejoué 5 000 fois</h2>
      <p>
        Chaque simulation joue le match possession par possession : qui est sur le terrain minute par minute, qui tire, d'où, contre quel défenseur, avec
        les fautes, le bonus et les fins de match serrées. Les 5 000 issues donnent les probabilités affichées : victoire, handicap, total, stats de chaque
        joueur.
      </p>
      <h2>Les données</h2>
      <p>
        Le play-by-play de plus de 2 600 matchs NBA sur trois saisons, les profils de tir par zone et par distance, la distance du défenseur sur chaque tir,
        les duels joueur contre joueur et les passes, mis à jour avant chaque simulation avec les absences annoncées et les cotes du moment.
      </p>
      <h2>Le contexte du match</h2>
      <p>
        Le moteur pense aussi comme un coach : qui garde qui, qui joue combien de minutes quand l'effectif change, la fatigue des déplacements, le momentum
        d'une équipe par rapport à ses saisons précédentes et les confrontations récentes entre les deux équipes, le « chat noir ».
      </p>
      <h2>Ce que disent les tests</h2>
      <p>
        Chaque réglage passe par un contrôle de justesse : le moteur rejoue des matchs passés avec les seules données disponibles avant chaque match, et on
        compare au résultat réel et aux cotes de clôture. Seuls les réglages qui améliorent ces résultats sont gardés.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
