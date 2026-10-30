// Page d'accueil payante, cachée (pas de lien depuis le site) : /accueil et ses pages Fonctionnalités, Tarifs, Questions.
// Les affiches de pub (Poster 1 à 6) restent une maquette sans route.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowRight, ArrowsLeftRight, Basketball, Bell, ChartLineUp, Check, CheckCircle, Crown, Fire, Infinity as InfinityIcon, Lightning, ListChecks,
  Scales, ShieldCheck, SoccerBall, Stack, TennisBall, Ticket as TicketIcon,
} from '@phosphor-icons/react';
import { Link, Ring, TeamMark } from './ui.tsx';
import { WarpBg } from './shaders.tsx';
import logo from './assets/razzia-logo.webp';
import './landing.css';

const pct = (v: number) => `${Math.round(v * 100)} %`;
const T = (tri: string, name: string) => ({ tri, name });
const AMBRE = ['#c98a3d', '#3b4a5e'] as const;
const NUIT = ['#2a4f9a', '#7a3a6e'] as const;

// ——— Morceaux réutilisés (mêmes classes que le site) ———

function MatchCard({ a, h, p, fav, flip, odds, i = 0 }: { a: ReturnType<typeof T>; h: ReturnType<typeof T>; p: number; fav: string; flip?: boolean; odds: string; i?: number }) {
  return (
    <div className="card card-a lp-card" style={{ '--i': i, '--w': '5.6' } as CSSProperties}>
      <span className="card-a-top mono">20:00 · NBA</span>
      <div className="card-a-t">
        <p className="card-a-team">
          <TeamMark team={{ tri: a.tri }} size="md" />
          <span className="card-a-name">{a.name}</span>
        </p>
        <p className="card-a-team">
          <TeamMark team={{ tri: h.tri }} size="md" />
          <span className="card-a-name">
            <i>@</i>
            {h.name}
          </span>
        </p>
      </div>
      <div className="card-a-f">
        <span className={`card-a-p${flip ? ' flip' : ''}`}>
          {fav} {pct(p)}
        </span>
        <span className="mono muted">{odds}</span>
      </div>
    </div>
  );
}

/** Ticket qui se valide tout seul, sélection après sélection (boucle). */
function LiveTicket({ loop = true }: { loop?: boolean }) {
  const [k, setK] = useState(loop ? 0 : 2);
  useEffect(() => {
    if (!loop) return;
    const t = window.setInterval(() => setK((x) => (x + 1) % 4), 1700);
    return () => window.clearInterval(t);
  }, [loop]);
  const legs = [
    ['Victoire des Knicks', 'Celtics – Knicks', '1,63'],
    ['Nuggets +8,5', 'Thunder – Nuggets', '1,23'],
    ['Sinner gagne', 'Rune – Sinner', '1,55'],
  ];
  const st = (j: number) => (j < k ? 'won' : j === k ? 'live' : 'pending');
  const done = k >= 3;
  return (
    <article className={`tk lp-ticket ${done ? 'won' : 'live'}`}>
      <header className="tk-head">
        <span className="tk-kind">
          <Stack size={16} /> Combiné · 3 sélections
        </span>
        <span className={`tk-st ${done ? 'won' : 'live'}`}>{done ? 'Gagné' : `${Math.min(k, 3)}/3 validées`}</span>
      </header>
      <ol className="tk-legs">
        {legs.map(([t, m, o], j) => (
          <li key={t} className={st(j)}>
            {st(j) === 'won' ? (
              <span className="lm won"><Check size={13} weight="bold" /></span>
            ) : st(j) === 'live' ? (
              <span className="lm live"><i /></span>
            ) : (
              <span className="lm" />
            )}
            <div className="tk-leg-main">
              <b>{t}</b>
              <span>
                {j === 2 ? <TennisBall size={13} /> : <Basketball size={13} />} {m}
              </span>
            </div>
            <span className="tk-odd mono">{o}</span>
          </li>
        ))}
      </ol>
      <div className="tk-line">
        {legs.map((_, j) => (
          <span key={j} className={st(j)} />
        ))}
      </div>
      <footer className="tk-foot">
        <div>
          <span>Mise</span>
          <b>10,00 €</b>
        </div>
        <div>
          <span>Cote</span>
          <b>3,10</b>
        </div>
        <div className="tk-gain">
          <span>{done ? 'Gain' : 'Gain potentiel'}</span>
          <b className={done ? 'won' : ''}>31,07 €</b>
        </div>
      </footer>
    </article>
  );
}

function RingCard({ p = 0.82, title = 'Knicks +8,5' }: { p?: number; title?: string }) {
  return (
    <div className="lp-ring">
      <Ring value={p} format={pct} label="Fréquence" />
      <div>
        <h4>
          <TeamMark team={{ tri: 'NYK' }} size="md" />
          <span>{title}</span>
        </h4>
        <span className="odds-pill">
          Cote <b>1,23</b>
        </span>
        <p className="muted small">Passe dans 20 405 des 25 000 matchs simulés.</p>
      </div>
    </div>
  );
}

function FeuMini() {
  return (
    <div className="feu-card lp-feu">
      <div className="feu-who">
        <span className="feu-face">
          <span className="feu-photo">
            <img src="https://cdn.nba.com/headshots/nba/latest/260x190/1628973.png" alt="" />
          </span>
          <TeamMark team={{ tri: 'NYK' }} size="sm" />
        </span>
        <div className="feu-id">
          <p className="feu-name">Jalen Brunson</p>
          <p className="feu-team">Knicks · seuil 34+ pts</p>
        </div>
      </div>
      <p className="feu-lab">Chance de gros match</p>
      <p className="feu-p">40 %</p>
      <div className="feu-meter">
        <span style={{ width: '100%' }} />
      </div>
      <p className="feu-why">En forme : 31,2 pts sur 10 matchs · À domicile</p>
    </div>
  );
}

function MoneyMini() {
  return (
    <div className="lp-money">
      <p className="money-k">Cote Knicks</p>
      <p className="money-v">
        1,58<span className="up">↓ depuis 1,72</span>
      </p>
      <svg viewBox="0 0 400 90" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lpm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2272e0" stopOpacity="0.35" />
            <stop offset="1" stopColor="#2272e0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points="0,70 130,62 260,40 400,18 400,90 0,90" fill="url(#lpm)" />
        <polyline points="0,70 130,62 260,40 400,18" className="money-line" />
      </svg>
      <span className="money-tag up">L'argent va sur Knicks</span>
    </div>
  );
}

function Logo() {
  return <img className="lp-logo" src={logo} alt="Razzia" width={1200} height={645} />;
}

const FEATS: Array<{ icon: ReactNode; t: string; d: string }> = [
  { icon: <ChartLineUp size={20} />, t: '25 000 simulations par match', d: 'Chaque match rejoué possession par possession, avec les compos et les cotes du moment.' },
  { icon: <ShieldCheck size={20} />, t: 'Razzia assuré', d: 'Quand le favori dépasse 77 %, le moteur a vu juste 85 % du temps la saison passée.' },
  { icon: <Scales size={20} />, t: 'Pile ou face et paris plus sûrs', d: 'Les matchs trop serrés signalés, avec le handicap qui passe plus souvent.' },
  { icon: <ListChecks size={20} />, t: 'Suivi de tes tickets', d: 'Simples et combinés, cotes en direct, chaque sélection validée toute seule.' },
  { icon: <Fire size={20} />, t: 'En feu ce soir', d: 'Les joueurs qui vont faire un gros match, et pourquoi. Suis leurs points.' },
  { icon: <ArrowsLeftRight size={20} />, t: 'Où va l’argent', d: 'La cote du favori depuis l’ouverture : tu vois de quel côté le marché bascule.' },
];

// ——— Page d'accueil (cachée : /accueil, /accueil/fonctionnalites, /accueil/tarifs, /accueil/questions) ———

type LpPage = 'home' | 'features' | 'pricing' | 'faq';
const PAGES: Record<string, LpPage> = { '/accueil': 'home', '/accueil/fonctionnalites': 'features', '/accueil/tarifs': 'pricing', '/accueil/questions': 'faq' };
export const landingPage = (path: string): LpPage | undefined => PAGES[path.replace(/\/$/, '')];
// Pas de paiement branché pour l'instant : l'essai mène à la création de compte.
const TRIAL = '/compte?mode=up&next=/';

/** Apparition douce au défilement (une fois), sans écouter le scroll. */
function useReveal(dep: unknown) {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.lp [data-reveal]')];
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return void els.forEach((e) => e.classList.add('is-in'));
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [dep]);
}

/** Bouton principal : texte et flèche dans sa propre case, qui glisse au survol. */
function Cta({ href, children, ghost }: { href: string; children: ReactNode; ghost?: boolean }) {
  return (
    <Link href={href} className={`btn btn-lg lp-btn ${ghost ? 'glass' : 'btn-primary'}`}>
      {children}
      {!ghost && (
        <span className="lp-btn-ic">
          <ArrowRight size={16} weight="bold" />
        </span>
      )}
    </Link>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="lp-eyebrow">{children}</span>;
}

/** Carte à double contour : plaque extérieure fine, cœur noir à l'intérieur. */
function Bezel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`lp-bezel ${className}`} data-reveal>
      <div className="lp-bezel-in">{children}</div>
    </div>
  );
}

function LpNav({ page }: { page: LpPage }) {
  const links: Array<[LpPage, string, string]> = [
    ['features', 'Fonctionnalités', '/accueil/fonctionnalites'],
    ['pricing', 'Tarifs', '/accueil/tarifs'],
    ['faq', 'Questions', '/accueil/questions'],
  ];
  return (
    <nav className="lp-nav">
      <Link href="/accueil" aria-label="Razzia, accueil">
        <Logo />
      </Link>
      <div className="lp-links">
        {links.map(([id, label, href]) => (
          <Link key={id} href={href} className={page === id ? 'is-on' : undefined} aria-current={page === id ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </div>
      <div className="lp-nav-r">
        <Link className="btn glass" href="/compte">
          Se connecter
        </Link>
        <Link className="btn btn-primary" href="/accueil/tarifs">
          Essai gratuit
        </Link>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header className="lp-hero3 mesh has-shader">
      <WarpBg c1={NUIT[0]} c2={NUIT[1]} />
      <span className="lp-eyebrow on-dark lp-in" style={{ '--d': 0 } as CSSProperties}>
        NBA · ATP · 25 000 simulations par match
      </span>
      <h1 className="lp-in" style={{ '--d': 1 } as CSSProperties}>
        Le match,
        <br />
        25 000 fois
        <br />
        <em>avant le vrai.</em>
      </h1>
      <p className="lp-lede center lp-in" style={{ '--d': 2 } as CSSProperties}>
        Razzia rejoue chaque match avant le coup d’envoi : qui gagne, de combien, et quel pari passe le plus souvent.
      </p>
      <div className="lp-cta center lp-in" style={{ '--d': 3 } as CSSProperties}>
        <Cta href="/accueil/tarifs">Débloquer Razzia</Cta>
        <Cta href="/accueil/fonctionnalites" ghost>
          Voir ce qu’il fait
        </Cta>
      </div>
      <p className="lp-trial lp-in" style={{ '--d': 4 } as CSSProperties}>
        3 jours d’essai gratuit · sans engagement
      </p>
      <div className="lp-marquee" aria-hidden="true">
        <div>
          {[0, 1].map((n) => (
            <div key={n} className="lp-marquee-row">
              <MatchCard a={T('BOS', 'Celtics')} h={T('NYK', 'Knicks')} p={0.59} fav="NYK" flip odds="2,35 / 1,63" />
              <MatchCard a={T('OKC', 'Thunder')} h={T('DEN', 'Nuggets')} p={0.78} fav="DEN" odds="2,05 / 1,83" />
              <MatchCard a={T('LAL', 'Lakers')} h={T('GSW', 'Warriors')} p={0.71} fav="LAL" odds="1,75 / 2,25" />
              <MatchCard a={T('MIA', 'Heat')} h={T('ORL', 'Magic')} p={0.63} fav="ORL" flip odds="2,40 / 1,60" />
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

function Proof() {
  return (
    <section className="lp-proof" data-reveal>
      <div>
        <b>11</b>
        <span>types de jeu simulés à chaque possession, du pick and roll à l’isolation</span>
      </div>
      <div>
        <b>10</b>
        <span>joueurs sur le terrain, chacun avec sa carte de tir, son défenseur et sa note d’impact</span>
      </div>
      <div>
        <b className="up">25 000</b>
        <span>matchs rejoués avant chaque coup d’envoi, compos et arbitres du soir compris</span>
      </div>
    </section>
  );
}

function Bento() {
  return (
    <div className="lp-bento">
      <Bezel className="lp-b-big">
        <div className="lp-b-t">
          <h3>25 000 matchs avant le vrai</h3>
          <p>Qui gagne, de combien, le score le plus probable, et le pari qui passe le plus souvent.</p>
        </div>
        <RingCard />
      </Bezel>
      <Bezel className="lp-b-tall">
        <div className="lp-b-t">
          <h3>Suivi de tes tickets</h3>
          <p>Simple ou combiné, cotes relues en direct, chaque sélection cochée toute seule.</p>
        </div>
        <LiveTicket />
      </Bezel>
      <Bezel>
        <div className="lp-b-t">
          <h3>En feu ce soir</h3>
          <p>Les joueurs partis pour un gros match.</p>
        </div>
        <FeuMini />
      </Bezel>
      <Bezel>
        <div className="lp-b-t">
          <h3>Où va l’argent</h3>
          <p>La cote du favori depuis l’ouverture.</p>
        </div>
        <MoneyMini />
      </Bezel>
    </div>
  );
}

/** Ce que le moteur regarde vraiment, sport par sport : pour les connaisseurs. */
const ENGINE: Array<{ g: string; items: Array<[ReactNode, string, string]> }> = [
  {
    g: 'Basket · chaque possession',
    items: [
      [<Basketball size={20} />, 'La possession, décomposée', 'Départ (rebond, perte, panier encaissé), contre-attaque ou attaque placée, puis le type de jeu parmi 11 : pick and roll côté porteur ou côté roll man, isolation, poste bas, catch-and-shoot, sortie d’écran, hand-off, coupe, rebond offensif…'],
      [<ChartLineUp size={20} />, 'Le tir, comme sur le parquet', 'Zone et position tirées de la vraie carte de tir du joueur, adresse par zone et par type de jeu, forme récente, niveau de contestation. Un joueur qui ne tire jamais de loin ne tirera jamais à 3 points.'],
      [<ArrowsLeftRight size={20} />, 'Qui défend sur qui', 'Les assignations défensives réelles (duels suivis par le tracking), les changements sur écran, et le défenseur qui conteste chaque tir.'],
      [<ListChecks size={20} />, 'Les rotations du coach', 'Les minutes de chaque joueur prévues comme le ferait le coach, la hiérarchie du banc (même pré-saison pour un effectif tout neuf), les fautes, le bonus et l’horloge.'],
      [<Stack size={20} />, 'Les cinq, ensemble', 'Cohésion des duos et trios (possessions jouées ensemble sur l’année), écartement quand deux non-shooteurs sont sur le terrain, et la note d’impact de chacun des dix joueurs.'],
      [<Scales size={20} />, 'La chance, mise de côté', 'Chaque tir vaut ce qu’il vaut d’habitude à cet endroit et de cette façon (dunk, lay-up, tir après dribble…). On sépare les occasions créées de la réussite, qui sur quelques matchs relève surtout de la chance.'],
    ],
  },
  {
    g: 'Basket · le contexte du soir',
    items: [
      [<ShieldCheck size={20} />, 'Les trois arbitres', 'Chaque arbitre siffle plus ou moins que la moyenne : le trio du soir change le nombre de fautes et de lancers francs.'],
      [<Lightning size={20} />, 'Fatigue et repos', 'Fuseaux horaires et altitude du déplacement, second soir d’un back-to-back, et l’habitude de chaque star de souffler ce soir-là.'],
      [<Bell size={20} />, 'Absences et compos', 'Blessures et raisons d’absence, transferts, changement d’entraîneur. Les cinq de départ tombent 30 minutes avant : la simulation se relance toute seule.'],
      [<Fire size={20} />, 'Momentum et chat noir', 'La forme des 15 derniers matchs face aux deux saisons d’avant, le chat noir en confrontation directe, et le chat noir de style (rythme, volume à 3 points, tirs au cercle…).'],
      [<ChartLineUp size={20} />, 'Notes d’impact', 'Chaque possession explique les points par les dix joueurs sur le terrain : on isole l’apport réel de chacun, coéquipiers et adversaires pris en compte.'],
      [<ArrowsLeftRight size={20} />, 'Le marché', 'Cotes DraftKings, mouvement depuis l’ouverture, mélange moteur et marché selon la confiance, et comparateur des bookmakers français.'],
    ],
  },
  {
    g: 'Tennis · point par point',
    items: [
      [<TennisBall size={20} />, 'Chaque point joué', 'Le match est rejoué point par point, au service et au retour, avec une forme du jour qui rend les sets liés entre eux, comme en vrai.'],
      [<ChartLineUp size={20} />, 'Des notes par surface', 'Elo général et par surface, qualité au service et au retour corrigée du niveau des adversaires affrontés.'],
      [<Lightning size={20} />, 'L’état du joueur', 'Repos, fatigue du tournoi, forme, abandon récent, longue absence, changement de surface, joueur à domicile, course aux Masters.'],
    ],
  },
];

function Engine({ short }: { short?: boolean }) {
  const groups = short ? [{ ...ENGINE[0], items: ENGINE[0].items.slice(0, 3) }, { ...ENGINE[1], items: ENGINE[1].items.slice(0, 3) }] : ENGINE;
  return (
    <div className="lp-engine">
      {groups.map((g) => (
        <div key={g.g} className="lp-engine-g">
          <p className="lp-engine-t" data-reveal>
            {g.g}
          </p>
          <div className="lp-engine-grid">
            {g.items.map(([ic, t, d], i) => (
              <div key={t} className="lp-engine-i" data-reveal style={{ '--d': i % 3 } as CSSProperties}>
                <span>{ic}</span>
                <b>{t}</b>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** D'où viennent les données, et ce que disent les tests : chiffres vérifiables. */
function Data() {
  return (
    <div className="lp-data">
      {[
        ['2 600+', 'matchs NBA en play-by-play', 'Trois saisons rejouées action par action, avec les types de jeu, le suivi défensif, les duels et les passes.'],
        ['82 %', 'des scores réels dans la fourchette', 'Sur 80 matchs testés, 82 % des scores tombent dans la fourchette annoncée à 80 %.'],
        ['85 %', 'quand Razzia est sûr', 'Favori à 77 % ou plus dans les simulations : il a gagné 85 % du temps la saison passée.'],
        ['12 289', 'lignes de props testées', 'Les stats joueurs testées sur les playoffs, face aux lignes d’ouverture et de clôture.'],
      ].map(([n, t, d], i) => (
        <div key={t} data-reveal style={{ '--d': i } as CSSProperties}>
          <b>{n}</b>
          <span>{t}</span>
          <p>{d}</p>
        </div>
      ))}
    </div>
  );
}

function Steps() {
  return (
    <section className="lp-sec lp-steps">
      <div className="lp-sec-head" data-reveal>
        <Eyebrow>Comment ça marche</Eyebrow>
        <h2>Trois gestes, chaque soir.</h2>
      </div>
      <ol>
        {[
          ['Choisis un match', 'Le programme NBA et ATP du jour, avec les cotes et les compos.'],
          ['Razzia le joue 25 000 fois', 'En une minute : vainqueur, handicap plus sûr, joueurs en feu, badges.'],
          ['Suis ton ticket', 'Ajoute les paris, valide, et regarde chaque sélection passer au vert.'],
        ].map(([t, d], i) => (
          <li key={t} data-reveal style={{ '--d': i } as CSSProperties}>
            <b>0{i + 1}</b>
            <h3>{t}</h3>
            <p>{d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Plans() {
  const [year, setYear] = useState(false);
  const plans = [
    {
      id: 'pro', name: 'Razzia Pro', m: '9,99', y: '7,99', pitch: 'Tout ce qu’il faut pour suivre chaque soirée.',
      items: [[<InfinityIcon size={17} />, 'Simulations illimitées'], [<Lightning size={17} />, 'Toute la soirée en un clic'], [<Scales size={17} />, 'Handicaps et paris plus sûrs'], [<ListChecks size={17} />, 'Suivi des tickets et bilan']] as Array<[ReactNode, string]>,
    },
    {
      id: 'elite', name: 'Razzia Elite', m: '24,99', y: '19,99', pitch: 'Pour tout voir avant tout le monde.', top: true,
      items: [[<Check size={17} />, 'Tout Razzia Pro'], [<Bell size={17} />, 'Alertes : compos, cotes qui bougent, chat noir'], [<Crown size={17} />, 'Nouveaux sports en avant-première'], [<CheckCircle size={17} />, 'Support prioritaire']] as Array<[ReactNode, string]>,
    },
  ];
  return (
    <>
      <div className="lp-period" role="group" aria-label="Période">
        <button className={!year ? 'is-on' : ''} onClick={() => setYear(false)}>
          Mensuel
        </button>
        <button className={year ? 'is-on' : ''} onClick={() => setYear(true)}>
          Annuel <em>−20 %</em>
        </button>
      </div>
      <div className="lp-plans">
        {plans.map((p, i) => (
          <div key={p.id} className={`lp-bezel lp-plan-shell${p.top ? ' is-top' : ''}`} data-reveal style={{ '--d': i } as CSSProperties}>
            <div className={`lp-bezel-in lp-plan${p.top ? ' mesh has-shader' : ''}`}>
              {p.top && (
                <div className="lp-dim">
                  <WarpBg c1={NUIT[0]} c2={NUIT[1]} />
                </div>
              )}
              {p.top && <span className="lp-plan-tag">Le plus complet</span>}
              <span className="caps">{p.name}</span>
              <p className="lp-price-v">
                {year ? p.y : p.m} €<small>/mois</small>
              </p>
              <p className="lp-plan-sub">{year ? 'Facturé à l’année, ' : ''}après 3 jours d’essai gratuit.</p>
              <p className="muted">{p.pitch}</p>
              <ul>
                {p.items.map(([ic, t]) => (
                  <li key={t}>
                    {ic} {t}
                  </li>
                ))}
              </ul>
              <Cta href={TRIAL}>Essai gratuit 3 jours</Cta>
              <span className="lp-plan-note">Aucun prélèvement avant la fin de l’essai</span>
            </div>
          </div>
        ))}
      </div>
      <p className="lp-pay">Paiement sécurisé · Carte, Apple Pay, Google Pay · Sans engagement, résiliable en un clic</p>
    </>
  );
}

const QA: Array<[string, string]> = [
  ['Qu’est-ce que Razzia fait qu’une IA généraliste ne fait pas ?', 'Une IA généraliste résume ce qu’elle a lu. Razzia rejoue le match : 25 000 fois, possession par possession, avec la carte de tir de chaque joueur, ses défenseurs, les rotations, les arbitres et la fatigue du soir, sur des données mises à jour avant chaque simulation. Le résultat est une distribution chiffrée, pas une opinion.'],
  ['Comment est simulé un tir ?', 'Le moteur choisit le type de jeu (pick and roll, isolation, catch-and-shoot…), qui finit l’action, la zone et la position du tir sur la vraie carte du joueur, puis l’adresse selon la zone, le type de jeu, sa forme récente, le défenseur qui conteste et le domicile.'],
  ['Comment sont prévues les minutes ?', 'Comme le ferait le coach : hiérarchie de la rotation, titulaires annoncés, fautes, écart au score. Pour un effectif remanié, la pré-saison sert à lire la nouvelle hiérarchie, jamais à juger le niveau.'],
  ['Le moteur tient-il compte des arbitres et de la fatigue ?', 'Oui. Chaque arbitre a sa tendance à siffler, mesurée sur ses matchs : le trio du soir change le nombre de fautes. La fatigue compte les fuseaux traversés, l’altitude, le back-to-back et l’habitude d’un joueur de se reposer ce soir-là.'],
  ['Et la chance dans tout ça ?', 'Chaque tir est évalué à sa valeur habituelle (emplacement, type de tir), qu’il rentre ou non. On distingue ce qu’une équipe crée de ce qu’elle convertit : une série de tirs réussis sur quelques matchs ne fait pas d’elle une meilleure équipe.'],
  ['Comment Razzia utilise les cotes ?', 'Les cotes servent de repère : la probabilité affichée mêle le moteur et le marché selon la confiance, et le mouvement de cote depuis l’ouverture est un signal à part entière. Tu vois aussi de quel côté va l’argent.'],
  ['Est-ce testé ?', 'Oui, sur des matchs passés que le moteur n’avait pas vus : stats d’équipe proches du réel, 82 % des scores dans la fourchette annoncée à 80 %, et 85 % de réussite quand Razzia est sûr. Le marché reste plus précis sur le vainqueur à la clôture : on te le dit.'],
  ['Comment marche le tennis ?', 'Point par point, au service et au retour, avec des notes Elo par surface et la qualité de service et de retour corrigée des adversaires. L’état du joueur compte : repos, fatigue du tournoi, abandon récent, longue absence.'],
  ['Razzia prend-il mes paris ?', 'Non. Razzia analyse les matchs. Tu joues chez ton bookmaker, Razzia t’aide à choisir et suit ton ticket.'],
  ['Comment marche l’essai gratuit ?', 'Tu as accès à tout pendant 3 jours. Rien n’est prélevé avant la fin de l’essai, et tu peux arrêter avant en un clic.'],
  ['Je peux arrêter quand je veux ?', 'Oui, sans engagement. L’abonnement s’arrête à la fin de la période en cours.'],
  ['C’est réservé aux majeurs ?', 'Oui, Razzia est réservé aux plus de 18 ans. Jouer comporte des risques : endettement, dépendance. Appelle le 09 74 75 13 13 (appel non surtaxé) si besoin.'],
];

function Faq({ items = QA }: { items?: Array<[string, string]> }) {
  return (
    <div className="lp-faq-list">
      {items.map(([q, a], i) => (
        <details key={q} data-reveal style={{ '--d': i % 4 } as CSSProperties}>
          <summary>
            {q}
            <span className="lp-plus" aria-hidden="true" />
          </summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}

function Final() {
  return (
    <section className="lp-final mesh has-shader" data-reveal>
      <WarpBg c1={NUIT[0]} c2={NUIT[1]} />
      <Eyebrow>3 jours d’essai gratuit</Eyebrow>
      <h2>
        Ce soir,
        <br />
        parie en sachant.
      </h2>
      <Cta href="/accueil/tarifs">Débloquer Razzia</Cta>
    </section>
  );
}

function PageHead({ eyebrow, title, lede }: { eyebrow: string; title: ReactNode; lede?: string }) {
  return (
    <header className="lp-page-head">
      <span className="lp-in" style={{ '--d': 0 } as CSSProperties}>
        <Eyebrow>{eyebrow}</Eyebrow>
      </span>
      <h1 className="lp-in" style={{ '--d': 1 } as CSSProperties}>
        {title}
      </h1>
      {lede && (
        <p className="lp-lede lp-in" style={{ '--d': 2 } as CSSProperties}>
          {lede}
        </p>
      )}
    </header>
  );
}

export function Landing({ path }: { path: string }) {
  const page = landingPage(path) ?? 'home';
  useReveal(page);
  useEffect(() => window.scrollTo({ top: 0 }), [page]);
  return (
    <div className="lp">
      <LpNav page={page} />
      {page === 'home' && (
        <>
          <Hero />
          <section className="lp-sports" data-reveal>
            <span><Basketball size={18} /> NBA</span>
            <span><TennisBall size={18} /> ATP</span>
            <span className="soon"><SoccerBall size={18} /> Football bientôt</span>
            <span className="soon"><Lightning size={18} /> Simulation en direct bientôt</span>
          </section>
          <Proof />
          <section className="lp-sec">
            <div className="lp-sec-head" data-reveal>
              <Eyebrow>Ce que tu débloques</Eyebrow>
              <h2>Tout pour une soirée de paris lucide.</h2>
            </div>
            <Bento />
            <div className="lp-more" data-reveal>
              <Link href="/accueil/fonctionnalites" className="lp-link">
                Toutes les fonctionnalités <ArrowRight size={15} weight="bold" />
              </Link>
            </div>
          </section>
          <section className="lp-sec">
            <div className="lp-sec-head" data-reveal>
              <Eyebrow>Sous le capot</Eyebrow>
              <h2>Pas un pronostic. Un match rejoué.</h2>
              <p className="lp-lede">Ce que le moteur regarde, possession après possession, avant de te donner un chiffre.</p>
            </div>
            <Engine short />
            <div className="lp-more" data-reveal>
              <Link href="/accueil/fonctionnalites" className="lp-link">
                Tout ce qu’on analyse <ArrowRight size={15} weight="bold" />
              </Link>
            </div>
          </section>
          <Steps />
          <section className="lp-sec">
            <div className="lp-sec-head center" data-reveal>
              <Eyebrow>Tarifs</Eyebrow>
              <h2>Choisis ta formule.</h2>
              <p className="lp-lede center">Les deux formules commencent par 3 jours d’essai gratuit.</p>
            </div>
            <Plans />
          </section>
          <section className="lp-sec lp-faq-short">
            <div className="lp-sec-head" data-reveal>
              <Eyebrow>Questions</Eyebrow>
              <h2>Avant de te lancer.</h2>
            </div>
            <Faq items={QA.slice(0, 4)} />
            <div className="lp-more" data-reveal>
              <Link href="/accueil/questions" className="lp-link">
                Toutes les questions <ArrowRight size={15} weight="bold" />
              </Link>
            </div>
          </section>
        </>
      )}
      {page === 'features' && (
        <>
          <PageHead eyebrow="Fonctionnalités" title={<>Tout ce que<br />Razzia fait.</>} lede="Chaque match rejoué 25 000 fois, possession par possession ou point par point : les paris qui passent le plus souvent, les signaux à connaître, et ton ticket suivi jusqu’au coup de sifflet final." />
          <section className="lp-sec lp-sec-tight">
            <Bento />
          </section>
          <section className="lp-sec">
            <div className="lp-sec-head" data-reveal>
              <Eyebrow>Dans le détail</Eyebrow>
              <h2>Ce que tu trouves sur chaque match.</h2>
            </div>
            <div className="lp-feats">
              {[
                ...FEATS,
                { icon: <TicketIcon size={20} />, t: 'Compléter un ticket', d: 'Ajoute un pari d’un autre match à un ticket simple : même mise, cote multipliée.' },
                { icon: <ShieldCheck size={20} />, t: 'Badges du soir', d: 'Chat noir, équipe en pleine montée ou en baisse, compos non officielles : les signaux à connaître.' },
                { icon: <TennisBall size={20} />, t: 'Tennis ATP', d: 'Points simulés un par un, surface, forme et confrontations, pour chaque match du jour.' },
              ].map((f, i) => (
                <div key={f.t} data-reveal style={{ '--d': i % 3 } as CSSProperties}>
                  <span>{f.icon}</span>
                  <b>{f.t}</b>
                  <p>{f.d}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="lp-sec">
            <div className="lp-sec-head" data-reveal>
              <Eyebrow>Sous le capot</Eyebrow>
              <h2>Tout ce que le moteur analyse.</h2>
              <p className="lp-lede">Pour ceux qui veulent savoir d’où vient chaque pourcentage : le match est rejoué, pas deviné.</p>
            </div>
            <Engine />
          </section>
          <section className="lp-sec">
            <div className="lp-sec-head" data-reveal>
              <Eyebrow>Données et tests</Eyebrow>
              <h2>Des chiffres qu’on peut vérifier.</h2>
            </div>
            <Data />
          </section>
          <Steps />
        </>
      )}
      {page === 'pricing' && (
        <>
          <PageHead eyebrow="Tarifs" title={<>3 jours<br />pour essayer.</>} lede="Choisis ta formule et profite de tout Razzia gratuitement pendant 3 jours. Rien n’est prélevé avant la fin de l’essai." />
          <section className="lp-sec lp-sec-tight">
            <Plans />
          </section>
          <section className="lp-sec">
            <div className="lp-sec-head" data-reveal>
              <Eyebrow>Abonnement</Eyebrow>
              <h2>Questions sur l’essai.</h2>
            </div>
            <Faq items={[QA[9], QA[10], QA[8]]} />
          </section>
        </>
      )}
      {page === 'faq' && (
        <>
          <PageHead eyebrow="Questions" title={<>Tout ce que<br />tu te demandes.</>} />
          <section className="lp-sec lp-sec-tight">
            <Faq />
          </section>
        </>
      )}
      <Final />
      <footer className="lp-foot">
        <Logo />
        <div className="lp-foot-links">
          <Link href="/accueil/fonctionnalites">Fonctionnalités</Link>
          <Link href="/accueil/tarifs">Tarifs</Link>
          <Link href="/accueil/questions">Questions</Link>
          <Link href="/compte">Se connecter</Link>
          <Link href="/mentions-legales">Mentions légales</Link>
          <Link href="/cgv">CGV</Link>
          <Link href="/confidentialite">Confidentialité</Link>
        </div>
        <p>Razzia analyse les matchs, il ne prend pas de paris. Réservé aux plus de 18 ans. Jouer comporte des risques : endettement, dépendance. Appelez le 09 74 75 13 13 (appel non surtaxé).</p>
      </footer>
    </div>
  );
}

// ——— Affiches de pub (1080 × 1350) ———

export function Poster({ n }: { n: number }) {
  const legal = <p className="po-legal">Razzia ne prend pas de paris · 18+ · Jouer comporte des risques : 09 74 75 13 13</p>;
  if (n === 1)
    return (
      <div className="po mesh has-shader">
        <WarpBg c1={AMBRE[0]} c2={AMBRE[1]} />
        <Logo />
        <h1>
          25 000 matchs.
          <br />
          <em>Avant le vrai.</em>
        </h1>
        <div className="po-center">
          <div className="po-vs">
            <TeamMark team={{ tri: 'BOS' }} size="xl" />
            <div className="po-ring">
              <Ring value={0.82} format={pct} label="Knicks +8,5" />
            </div>
            <TeamMark team={{ tri: 'NYK' }} size="xl" />
          </div>
        </div>
        <p className="po-sub">Chaque match NBA et ATP rejoué 25 000 fois avant le coup d’envoi.</p>
        <span className="po-cta">razzia · simule avant de parier</span>
        {legal}
      </div>
    );
  if (n === 2)
    return (
      <div className="po po-dark">
        <div className="po-glow mesh has-shader">
          <WarpBg c1={AMBRE[0]} c2={AMBRE[1]} />
        </div>
        <Logo />
        <h1>
          Ton ticket,
          <br />
          <em>validé en direct.</em>
        </h1>
        <div className="po-ticket">
          <LiveTicket loop={false} />
        </div>
        <p className="po-sub">Simples et combinés · cotes relues en direct · chaque sélection cochée toute seule.</p>
        {legal}
      </div>
    );
  if (n === 3)
    return (
      <div className="po po-dark po-fire">
        <Logo />
        <span className="po-kicker">
          <Fire size={22} weight="fill" /> En feu ce soir
        </span>
        <h1>
          Il va
          <br />
          <em>exploser.</em>
        </h1>
        <div className="po-feu">
          <FeuMini />
        </div>
        <p className="po-sub">Les joueurs partis pour un gros match, avec les raisons. Suis leurs points en un geste.</p>
        {legal}
      </div>
    );
  if (n === 4)
    return (
      <div className="po po-dark po-list">
        <Logo />
        <h1>
          Tout
          <br />
          <em>Razzia.</em>
        </h1>
        <ul>
          {[...FEATS, { icon: <TicketIcon size={20} />, t: 'Compléter un ticket', d: '' }, { icon: <TennisBall size={20} />, t: 'NBA et tennis ATP', d: '' }].map((f) => (
            <li key={f.t}>
              <span>{f.icon}</span>
              {f.t}
            </li>
          ))}
        </ul>
        <span className="po-cta">Football et simulation en direct : bientôt</span>
        {legal}
      </div>
    );
  if (n === 5)
    return (
      <div className="po po-dark po-stat">
        <Logo />
        <span className="po-kicker green">
          <ShieldCheck size={22} weight="bold" /> Razzia assuré
        </span>
        <p className="po-big">85 %</p>
        <h2>de favoris trouvés quand Razzia est sûr.</h2>
        <p className="po-sub">Favori à 77 % ou plus dans les simulations : le moteur a vu juste 85 % du temps la saison passée. Et quand c’est serré, il te le dit : pile ou face.</p>
        <div className="po-pills">
          <span className="card-a-p">NYK 82 %</span>
          <span className="card-a-p flip">BOS 59 %</span>
        </div>
        {legal}
      </div>
    );
  return (
    <div className="po mesh has-shader">
      <WarpBg c1={NUIT[0]} c2={NUIT[1]} />
      <Logo />
      <h1>
        Le tennis
        <br />
        <em>aussi.</em>
      </h1>
      <div className="po-tennis">
        <div className="card card-a lp-card" style={{ '--w': '5.6' } as CSSProperties}>
          <span className="card-a-top mono">15:00 · Paris · Quart</span>
          <div className="card-a-t">
            <p className="card-a-team">
              <span className="po-ini">CA</span>
              <span className="card-a-name">Alcaraz</span>
            </p>
            <p className="card-a-team">
              <span className="po-ini">TP</span>
              <span className="card-a-name">
                <i>vs</i>Paul
              </span>
            </p>
          </div>
          <div className="card-a-f">
            <span className="card-a-p">Alcaraz 78 %</span>
            <span className="mono muted">1,27 / 4,16</span>
          </div>
        </div>
      </div>
      <p className="po-sub">Points simulés un par un, surface, forme, chat noir : le programme ATP chaque jour.</p>
      {legal}
    </div>
  );
}
