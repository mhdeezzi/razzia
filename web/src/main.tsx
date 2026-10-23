// Point d'entrée : en-tête, routes (programme, fiche de match, simulations), pied de page.
import { StrictMode, useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/host-grotesk'; // police d'origine des cercles de probabilité
import '@fontsource-variable/jetbrains-mono';
import { CaretRight } from '@phosphor-icons/react';
import './styles.css';
import { listSims, loadProgramme, matchPath, type Programme, type SimEntry } from './data.ts';
import { MatchPage } from './match.tsx';
import { BilanPage } from './bilan.tsx';
import { SchedulePage } from './schedule.tsx';
import { TopBar } from './topbar.tsx';
import { Empty, Link, TeamMark, useLocation } from './ui.tsx';

function App() {
  const { path, search } = useLocation();
  const m = path.match(/^\/match\/(\d{4}-\d{2}-\d{2})\/([A-Z]{3})-([A-Z]{3})\/?$/);
  const page = m ? (
    <MatchPage key={path} date={m[1]} away={m[2]} home={m[3]} />
  ) : path === '/simulations' ? (
    <SimsPage />
  ) : path === '/methode' ? (
    <MethodPage />
  ) : path === '/bilan' ? (
    <BilanPage />
  ) : (
    <SchedulePage day={search.get('jour')} />
  );
  useEffect(() => {
    document.title = m ? `${m[2]} @ ${m[3]} | Razzia` : path === '/simulations' ? 'Simulations | Razzia' : path === '/bilan' ? 'Bilan | Razzia' : 'Razzia | Simulations NBA';
  }, [path]);
  return (
    <>
      <TopBar path={path} />
      <main>{page}</main>
      <footer className="foot">
        <p>
          <b>Razzia</b> analyse les matchs, il ne prend pas de paris.
        </p>
        <p>Jouer comporte des risques : endettement, dépendance. Appelez le 09 74 75 13 13 (appel non surtaxé).</p>
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

function MethodPage() {
  return (
    <div className="page prose">
      <header className="page-head">
        <h1>Méthode</h1>
        <p className="lede">Ce que fait le moteur, avec quelles données, et ce que disent nos tests.</p>
      </header>
      <h2>Un match rejoué 5 000 fois</h2>
      <p>
        Chaque simulation joue le match possession par possession : qui est sur le terrain minute par minute, qui tire, d'où, contre quel défenseur, avec
        les fautes, le bonus et les fins de match serrées. Les 5 000 issues donnent les probabilités affichées : victoire, spread, total, stats de chaque
        joueur.
      </p>
      <h2>Les données</h2>
      <p>
        Le play-by-play de plus de 2 600 matchs NBA sur trois saisons, les profils de tir par zone, le suivi défensif, les duels joueur contre joueur et les
        passes, mis à jour avant chaque simulation avec les absences annoncées et les cotes du moment.
      </p>
      <h2>Ce que disent les tests</h2>
      <p>
        Sur 80 matchs de la saison 2025-26, les stats d'équipe simulées sont proches du réel et 82 % des scores réels tombent dans la fourchette annoncée à
        80 %. Le marché reste plus précis sur le vainqueur à la clôture. Sur les props, testées sur 12 289 lignes de playoffs, le modèle n'a pas d'avantage
        face aux lignes de clôture, mais il en montre un face aux lignes d'ouverture quand elles bougent ensuite. C'est pourquoi les probabilités de props
        sont mêlées au marché selon la confiance.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
