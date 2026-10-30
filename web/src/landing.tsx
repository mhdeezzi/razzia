// MAQUETTE (non branchée, aucune route) : page d'accueil payante (Landing, versions 1 à 3) et affiches de pub (Poster 1 à 6).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowRight, ArrowsLeftRight, Basketball, Bell, ChartLineUp, Check, CheckCircle, Crown, Fire, Infinity as InfinityIcon, Lightning, ListChecks,
  Scales, ShieldCheck, SoccerBall, Stack, TennisBall, Ticket as TicketIcon,
} from '@phosphor-icons/react';
import { Ring, TeamMark } from './ui.tsx';
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
        <p className="muted small">Passe dans 4 081 des 5 000 matchs simulés.</p>
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
  { icon: <ChartLineUp size={20} />, t: '5 000 simulations par match', d: 'Chaque match rejoué possession par possession, avec les compos et les cotes du moment.' },
  { icon: <ShieldCheck size={20} />, t: 'Razzia assuré', d: 'Quand le favori dépasse 77 %, le moteur a vu juste 85 % du temps la saison passée.' },
  { icon: <Scales size={20} />, t: 'Pile ou face et paris plus sûrs', d: 'Les matchs trop serrés signalés, avec le handicap qui passe plus souvent.' },
  { icon: <ListChecks size={20} />, t: 'Suivi de tes tickets', d: 'Simples et combinés, cotes en direct, chaque sélection validée toute seule.' },
  { icon: <Fire size={20} />, t: 'En feu ce soir', d: 'Les joueurs qui vont faire un gros match, et pourquoi. Suis leurs points.' },
  { icon: <ArrowsLeftRight size={20} />, t: 'Où va l’argent', d: 'La cote du favori depuis l’ouverture : tu vois de quel côté le marché bascule.' },
];

// ——— Page d'accueil ———

export function Landing({ v }: { v: number }) {
  const [year, setYear] = useState(false);
  return (
    <div className={`lp lp-v${v}`}>
      <nav className="lp-nav">
        <Logo />
        <div className="lp-links">
          <a href="#features">Fonctionnalités</a>
          <a href="#prix">Tarifs</a>
          <a href="#faq">Questions</a>
        </div>
        <div className="lp-nav-r">
          <a className="btn glass" href="#prix">
            Se connecter
          </a>
          <a className="btn btn-primary" href="#prix">
            Commencer
          </a>
        </div>
      </nav>

      {v === 1 && (
        <header className="lp-hero1 mesh has-shader">
          <WarpBg c1={AMBRE[0]} c2={AMBRE[1]} />
          <div className="lp-hero1-copy">
            <span className="caps">NBA · ATP · 5 000 simulations par match</span>
            <h1>
              Simule
              <br />
              avant de
              <br />
              parier.
            </h1>
            <p className="lp-lede">Razzia rejoue chaque match 5 000 fois avant le coup d’envoi. Tu vois qui gagne, de combien, et quel pari passe le plus souvent.</p>
            <div className="lp-cta">
              <a className="btn btn-primary btn-lg" href="#prix">
                Voir les formules <ArrowRight size={17} weight="bold" />
              </a>
              <a className="btn glass btn-lg" href="#features">
                Comment ça marche
              </a>
            </div>
          </div>
          <div className="lp-hero1-stack">
            <MatchCard a={T('BOS', 'Celtics')} h={T('NYK', 'Knicks')} p={0.59} fav="NYK" flip odds="2,35 / 1,63" />
            <RingCard />
          </div>
        </header>
      )}

      {v === 2 && (
        <header className="lp-hero2">
          <div className="lp-hero2-copy">
            <span className="lp-chip">
              <span className="lm live"><i /></span> En direct ce soir
            </span>
            <h1>
              Ton ticket,
              <br />
              <em>validé en direct.</em>
            </h1>
            <p className="lp-lede">Les simulations te montrent les paris qui passent le plus souvent. Mets-les dans ton ticket : Razzia relit les cotes, puis coche chaque sélection à la fin du match.</p>
            <div className="lp-cta">
              <a className="btn btn-primary btn-lg" href="#prix">
                Commencer <ArrowRight size={17} weight="bold" />
              </a>
            </div>
            <dl className="lp-mini-stats">
              <div>
                <dt>Simulations</dt>
                <dd>5 000</dd>
              </div>
              <div>
                <dt>Razzia assuré</dt>
                <dd className="up">85 %</dd>
              </div>
              <div>
                <dt>Sports</dt>
                <dd>2 + 1</dd>
              </div>
            </dl>
          </div>
          <div className="lp-hero2-art">
            <div className="lp-hero2-glow mesh has-shader">
              <WarpBg c1={AMBRE[0]} c2={AMBRE[1]} />
            </div>
            <LiveTicket />
          </div>
        </header>
      )}

      {v === 3 && (
        <header className="lp-hero3 mesh has-shader">
          <WarpBg c1={NUIT[0]} c2={NUIT[1]} />
          <span className="caps">Razzia · sports analysis specialist</span>
          <h1>
            Le match,
            <br />
            5 000 fois
            <br />
            avant le vrai.
          </h1>
          <div className="lp-cta center">
            <a className="btn btn-primary btn-lg" href="#prix">
              Débloquer Razzia <ArrowRight size={17} weight="bold" />
            </a>
          </div>
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
      )}

      <section className="lp-sports">
        <span>
          <Basketball size={18} /> NBA
        </span>
        <span>
          <TennisBall size={18} /> ATP
        </span>
        <span className="soon">
          <SoccerBall size={18} /> Football bientôt
        </span>
        <span className="soon">
          <Lightning size={18} /> Simulation en direct bientôt
        </span>
      </section>

      <section id="features" className="lp-sec">
        <div className="lp-sec-head">
          <span className="caps">Ce que tu débloques</span>
          <h2>Tout ce qu’il faut pour une soirée de paris lucide.</h2>
        </div>
        <div className="lp-bento">
          <div className="lp-b lp-b-big">
            <div className="lp-b-t">
              <h3>5 000 matchs avant le vrai</h3>
              <p>Qui gagne, de combien, le score le plus probable, et le pari qui passe le plus souvent.</p>
            </div>
            <RingCard />
          </div>
          <div className="lp-b lp-b-tall">
            <div className="lp-b-t">
              <h3>Suivi de tes tickets</h3>
              <p>Simple ou combiné, cotes relues en direct, chaque sélection cochée toute seule.</p>
            </div>
            <LiveTicket loop={false} />
          </div>
          <div className="lp-b">
            <div className="lp-b-t">
              <h3>En feu ce soir</h3>
              <p>Les joueurs partis pour un gros match.</p>
            </div>
            <FeuMini />
          </div>
          <div className="lp-b">
            <div className="lp-b-t">
              <h3>Où va l’argent</h3>
              <p>La cote du favori depuis l’ouverture.</p>
            </div>
            <MoneyMini />
          </div>
        </div>
        <div className="lp-feats">
          {FEATS.map((f) => (
            <div key={f.t}>
              <span>{f.icon}</span>
              <b>{f.t}</b>
              <p>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-sec lp-steps">
        <div className="lp-sec-head">
          <span className="caps">Comment ça marche</span>
          <h2>Trois gestes, chaque soir.</h2>
        </div>
        <ol>
          <li>
            <b>01</b>
            <h3>Choisis un match</h3>
            <p>Le programme NBA et ATP du jour, avec les cotes et les compos.</p>
          </li>
          <li>
            <b>02</b>
            <h3>Razzia le joue 5 000 fois</h3>
            <p>En une minute : vainqueur, handicap plus sûr, joueurs en feu, badges.</p>
          </li>
          <li>
            <b>03</b>
            <h3>Suis ton ticket</h3>
            <p>Ajoute les paris, valide, et regarde chaque sélection passer au vert.</p>
          </li>
        </ol>
      </section>

      <section id="prix" className="lp-sec lp-price">
        <div className="lp-sec-head center">
          <span className="caps">Tarifs</span>
          <h2>Choisis ta formule.</h2>
          <div className="lp-period">
            <button className={!year ? 'is-on' : ''} onClick={() => setYear(false)}>
              Mensuel
            </button>
            <button className={year ? 'is-on' : ''} onClick={() => setYear(true)}>
              Annuel <em>−20 %</em>
            </button>
          </div>
        </div>
        <div className="lp-plans">
          <div className="lp-plan">
            <span className="caps">Razzia Pro</span>
            <p className="lp-price-v">
              {year ? '7,99' : '9,99'} €<small>/mois</small>
            </p>
            <p className="muted">Tout ce qu’il faut pour suivre chaque soirée.</p>
            <ul>
              <li><InfinityIcon size={17} /> Simulations illimitées</li>
              <li><Lightning size={17} /> Toute la soirée en un clic</li>
              <li><Scales size={17} /> Handicaps et paris plus sûrs</li>
              <li><ListChecks size={17} /> Suivi des tickets et bilan</li>
            </ul>
            <a className="btn btn-primary btn-lg" href="#prix">
              Passer à Pro
            </a>
          </div>
          <div className="lp-plan is-top mesh has-shader">
            <div className="lp-dim">
              <WarpBg c1={AMBRE[0]} c2={AMBRE[1]} />
            </div>
            <span className="lp-plan-tag">Le plus complet</span>
            <span className="caps">Razzia Elite</span>
            <p className="lp-price-v">
              {year ? '19,99' : '24,99'} €<small>/mois</small>
            </p>
            <p className="lp-plan-sub">Pour tout voir avant tout le monde.</p>
            <ul>
              <li><Check size={17} /> Tout Razzia Pro</li>
              <li><Bell size={17} /> Alertes : compos, cotes qui bougent, chat noir</li>
              <li><Crown size={17} /> Nouveaux sports en avant-première</li>
              <li><CheckCircle size={17} /> Support prioritaire</li>
            </ul>
            <a className="btn btn-primary btn-lg" href="#prix">
              Choisir Elite
            </a>
          </div>
        </div>
        <p className="lp-pay">Paiement sécurisé · Carte, Apple Pay, Google Pay · Sans engagement, résiliable en un clic</p>
      </section>

      <section id="faq" className="lp-sec lp-faq">
        <div className="lp-sec-head">
          <span className="caps">Questions</span>
          <h2>Avant de te lancer.</h2>
        </div>
        <div className="lp-faq-list">
          {[
            ['Razzia prend-il mes paris ?', 'Non. Razzia analyse les matchs. Tu joues chez ton bookmaker, Razzia t’aide à choisir et suit ton ticket.'],
            ['D’où viennent les cotes ?', 'DraftKings pour la NBA, Pinnacle pour le tennis, relues avant chaque validation.'],
            ['Le moteur a-t-il toujours raison ?', 'Non. Il donne des probabilités : un favori à 80 % perd une fois sur cinq. Les badges disent quand se méfier.'],
            ['Je peux arrêter quand je veux ?', 'Oui, sans engagement. L’abonnement s’arrête à la fin du mois en cours.'],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-final mesh has-shader">
        <WarpBg c1={v === 3 ? NUIT[0] : AMBRE[0]} c2={v === 3 ? NUIT[1] : AMBRE[1]} />
        <h2>
          Ce soir,
          <br />
          parie en sachant.
        </h2>
        <a className="btn btn-primary btn-lg" href="#prix">
          Débloquer Razzia <ArrowRight size={17} weight="bold" />
        </a>
      </section>
      <footer className="lp-foot">
        <Logo />
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
          5 000 matchs.
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
        <p className="po-sub">Chaque match NBA et ATP rejoué 5 000 fois avant le coup d’envoi.</p>
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
