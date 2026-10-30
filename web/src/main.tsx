// Point d'entrée : en-tête, routes (programme, fiche de match, simulations), pied de page.
import { StrictMode, useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist'; // texte, menus et badges
import '@fontsource-variable/geist-mono'; // heures, cotes, scores
import '@fontsource-variable/archivo/wdth.css'; // titres très gras et serrés de l'affiche RAZZIA, cote sous le rond
import '@fontsource-variable/host-grotesk'; // chiffres des cercles de probabilité
import { CaretRight } from '@phosphor-icons/react';
import './styles.css';
import { listSims, loadProgramme, matchPath, type Programme, type SimEntry } from './data.ts';
import { MatchPage } from './match.tsx';
import { SchedulePage } from './schedule.tsx';
import { TopBar } from './topbar.tsx';
import { SlipBar, SuiviPage, TicketWatcher } from './suivipage.tsx';
import { Toasts } from './toast.tsx';
import { TennisMatchPage, TennisSchedulePage } from './tennis.tsx';
import { Empty, Link, TeamMark, useLocation } from './ui.tsx';
import { AccountPage, PricingPage } from './billing.tsx';
import { Landing, landingPage } from './landing.tsx';
import { LEGAL, LegalLinks, LegalPage, NotFound } from './legal.tsx';
import logo from './assets/razzia-logo.webp';

// Compte (connexion) en ligne, sans paiement branché ; abonnement prêt, activé seulement par VITE_BILLING=1 au build.
const BILLING = import.meta.env.VITE_BILLING === '1';

function App() {
  const { path, search } = useLocation();
  const m = path.match(/^\/match\/(\d{4}-\d{2}-\d{2})\/([A-Z]{3})-([A-Z]{3})\/?$/);
  const t = path.match(/^\/tennis\/match\/(\d{4}-\d{2}-\d{2})\/(\d+)\/?$/);
  const page = m ? (
    <MatchPage key={path} date={m[1]} away={m[2]} home={m[3]} />
  ) : t ? (
    <TennisMatchPage key={path} day={t[1]} id={t[2]} />
  ) : path === '/tennis' ? (
    <TennisSchedulePage day={search.get('jour')} />
  ) : path === '/simulations' ? (
    <SimsPage />
  ) : BILLING && path === '/abonnement' ? (
    <PricingPage />
  ) : path === '/compte' ? (
    <AccountPage />
  ) : path === '/suivi' ? (
    <SuiviPage />
  ) : LEGAL[path] ? (
    <LegalPage path={path} />
  ) : path === '/' ? (
    <SchedulePage day={search.get('jour')} />
  ) : (
    <NotFound />
  );
  useEffect(() => {
    document.title = m ? `${m[2]} @ ${m[3]} | Razzia` : path.startsWith('/tennis') ? 'Razzia | Tennis ATP' : path === '/simulations' ? 'Simulations | Razzia' : BILLING && path === '/abonnement' ? 'Abonnement | Razzia' : path === '/compte' ? 'Compte | Razzia' : path === '/suivi' ? 'Suivi | Razzia' : landingPage(path) ? 'Razzia | Simule avant de parier' : LEGAL[path] ? `${LEGAL[path].title} | Razzia` : 'Razzia | Simulations NBA';
  }, [path]);
  // Page d'accueil payante : cachée (aucun lien), visible seulement en tapant /accueil, en attendant de l'activer.
  if (landingPage(path))
    return (
      <>
        <Landing path={path} />
        <Toasts />
      </>
    );
  return (
    <>
      <TopBar />
      <TicketWatcher />
      <main>{page}</main>
      <SlipBar path={path} />
      <Toasts />
      <footer className="foot">
        <div className="foot-brand">
          <img src={logo} alt="Razzia" width={1200} height={645} />
        </div>
        <div className="foot-text">
          <p>
            <b>Razzia</b> analyse les matchs, il ne prend pas de paris.
          </p>
          <p>Jouer comporte des risques : endettement, dépendance. Appelez le 09 74 75 13 13 (appel non surtaxé).</p>
          <LegalLinks />
          <p className="foot-legal">© {new Date().getFullYear()} RAZZIA</p>
        </div>
      </footer>
    </>
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
      <header className="page-head">
        <h1>Simulations</h1>
        <p className="lede">Les matchs déjà simulés, du plus récent au plus ancien.</p>
      </header>
      {!sims && <span className="sk sk-panel" aria-busy="true" />}
      {sims && sims.length === 0 && (
        <Empty title="Aucune simulation pour l'instant.">
          <Link href="/" className="btn btn-primary">
            Choisir un match
          </Link>
        </Empty>
      )}
      {sims && sims.length > 0 && (
        <section className="league-card">
          <ol className="rows">
            {sims.map((e, i) => {
              const [date, teams] = e.dir.split('_');
              const [away, home] = teams.split('@');
              const g = prog?.games.find((x) => x.date === date && x.away.tri === away && x.home.tri === home);
              const homeFav = e.pHome >= e.pAway;
              return (
                <li key={e.dir}>
                  <Link href={g ? matchPath(g) : `/match/${date}/${away}-${home}`} className="row row-sim" style={{ '--i': i } as CSSProperties}>
                    <div className="row-time">
                      <span className="t">{new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                      <span className="pill-tag final">{new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="vs-line">
                      <div className="vs-team away">
                        <span className="vs-name">{g?.away.name ?? away}</span>
                        <TeamMark team={g?.away ?? { tri: away }} size="md" />
                      </div>
                      <span className="vs-at">@</span>
                      <div className="vs-team">
                        <TeamMark team={g?.home ?? { tri: home }} size="md" />
                        <span className="vs-name">{g?.home.name ?? home}</span>
                      </div>
                    </div>
                    <span style={{ textAlign: 'center' }}>
                      <span className="conf-pill sim">
                        {homeFav ? home : away} {Math.round(Math.max(e.pHome, e.pAway) * 100)} %
                      </span>
                    </span>
                    <CaretRight size={16} className="row-caret" />
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {sims && sims.length > 0 && <p className="note" style={{ marginTop: 14 }}>Seuls les matchs des 7 prochains jours s'ouvrent avec leur fiche complète.</p>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
