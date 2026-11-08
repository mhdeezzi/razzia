// Page d'accueil v2 : visuels des campagnes (fonds photo, iPhone avec de vrais écrans du site), trois sports, simulation
// en direct à venir, formules Gratuit / Premium / À vie.
import { type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Basketball, Broadcast, Check, Lightning, Minus, SoccerBall, TennisBall } from '@phosphor-icons/react';
import { Link } from './ui.tsx';
import './landinghome.css';
import bgMarine from './assets/lp/bg-marine.webp';
import bgNeon from './assets/lp/bg-neon.webp';
import bgLilas from './assets/lp/bg-lilas.webp';
import bgCiel from './assets/lp/bg-ciel.webp';
import bgAurore from './assets/lp/bg-aurore.webp';
import bgGlace from './assets/lp/bg-glace.webp';
import progFoot from './assets/lp/prog-foot.webp';
import progNba from './assets/lp/prog-nba.webp';
import vilTop from './assets/lp/foot-vil-top.webp';
import vilPick from './assets/lp/foot-vil-pick.webp';
import flip from './assets/lp/nba-flip-verdict.webp';
import suivi from './assets/lp/suivi-tk.webp';
import steps from './assets/lp/foot-steps.webp';
import atp from './assets/lp/atp-fin-top.webp';

export const SIGNUP = '/compte?mode=up&next=/';

/** iPhone dessiné en CSS (titane, Dynamic Island, barre d'état) avec une vraie capture du site. 1em = 1 % de sa largeur. */
export function Phone({ src, color = 'noir', className = '', style }: { src: string; color?: 'noir' | 'bleu' | 'argent' | 'graphite'; className?: string; style?: CSSProperties }) {
  return (
    <div className={`iph c-${color} ${className}`} style={style} aria-hidden="true">
      <i className="bt b1" /><i className="bt b2" /><i className="bt b3" /><i className="bt b4" />
      <div className="bz">
        <div className="sc">
          <img className="site" src={src} alt="" decoding="async" />
          <div className="sb">
            <span className="tm"><b>9:41</b></span>
            <span className="ic">
              <i className="sg"><b /><b /><b /><b /></i>
              <i className="wf" />
              <i className="bat"><b /></i>
            </span>
          </div>
          <i className="di" />
          <i className="hi" />
        </div>
      </div>
    </div>
  );
}

const Btn = ({ href, children, ghost }: { href: string; children: ReactNode; ghost?: boolean }) => (
  <Link href={href} className={`btn btn-lg lp-btn ${ghost ? 'glass' : 'btn-primary'}`}>
    {children}
    {!ghost && (
      <span className="lp-btn-ic">
        <ArrowRight size={16} weight="bold" />
      </span>
    )}
  </Link>
);

export function HeroV2() {
  return (
    <header className="lh-hero" style={{ '--bg': `url(${bgMarine})` } as CSSProperties}>
      <div className="lh-hero-copy">
        <span className="lh-kick lp-in" style={{ '--d': 0 } as CSSProperties}>
          Foot · NBA · Tennis ATP
        </span>
        <h1 className="lp-in" style={{ '--d': 1 } as CSSProperties}>
          Le match,
          <br />
          25 000 fois
          <br />
          <em>avant le vrai.</em>
        </h1>
        <p className="lh-lede lp-in" style={{ '--d': 2 } as CSSProperties}>
          Avant chaque coup d’envoi, Razzia rejoue le match 25 000 fois. Tu vois qui gagne, de combien, et quel pari passe le plus souvent.
        </p>
        <div className="lp-cta lp-in" style={{ '--d': 3 } as CSSProperties}>
          <Btn href={SIGNUP}>Commencer gratuitement</Btn>
          <Btn href="/accueil/tarifs" ghost>
            Voir les formules
          </Btn>
        </div>
        <p className="lh-small lp-in" style={{ '--d': 4 } as CSSProperties}>
          Gratuit pour toujours · Premium sans engagement
        </p>
      </div>
      <div className="lh-hero-art">
        <Phone src={vilTop} className="lh-ph-back" />
        <Phone src={progFoot} color="bleu" className="lh-ph-front refl" />
      </div>
    </header>
  );
}

/** Bilans réels, datés. */
export function Record() {
  const rows: Array<[ReactNode, string, string, string]> = [
    [<SoccerBall size={18} />, 'Football', '91 %', '30 pronos passés sur 33'],
    [<Basketball size={18} />, 'NBA', '86 %', '105 pronos passés sur 122'],
    [<TennisBall size={18} />, 'Tennis ATP', '84 %', '75 pronos passés sur 89'],
  ];
  return (
    <section className="lh-record" data-reveal>
      {rows.map(([ic, s, v, d]) => (
        <div key={s}>
          <span className="lh-record-s">
            {ic} {s}
          </span>
          <b>{v}</b>
          <span>{d}</span>
        </div>
      ))}
      <p>Bilan Razzia depuis le début de la saison, au 8 novembre 2026. Tout est compté, même les ratés.</p>
    </section>
  );
}

type Story = { bg: string; dark?: boolean; kick: string; title: ReactNode; text: ReactNode; shots: Array<{ src: string; color?: 'noir' | 'bleu' | 'argent' | 'graphite' }>; flip?: boolean };
const STORIES: Story[] = [
  {
    bg: bgNeon, kick: 'La fiche de match', shots: [{ src: vilTop }, { src: vilPick }],
    title: <>Avant de parier,<br /><em>regarde le match</em><br />se jouer.</>,
    text: <>Le score le plus probable, les buteurs, le déroulé du match et le pronostic qui passe le plus souvent : tout sort de <b>25 000 simulations</b>, avec les compos et les cotes du moment.</>,
  },
  {
    bg: bgLilas, kick: 'Pile ou face', flip: true, shots: [{ src: flip, color: 'graphite' }],
    title: <>Le meilleur pari,<br />c’est parfois<br /><em>de ne pas parier.</em></>,
    text: <>Quand un match est trop serré, Razzia le marque <b>« Déconseillé »</b> et te propose le pari plus sûr : handicap, double chance ou un set. Même si ça veut dire passer ton tour.</>,
  },
  {
    bg: bgCiel, dark: true, kick: 'Mon suivi', shots: [{ src: suivi, color: 'argent' }],
    title: <>Chaque match<br />passé,<br /><em>une coche verte.</em></>,
    text: <>Ajoute tes paris d’un geste. Simples ou combinés, chaque sélection se valide toute seule en direct, et <b>le gain possible</b> reste sous les yeux.</>,
  },
  {
    bg: bgAurore, kick: 'Avant le coup d’envoi', flip: true, shots: [{ src: steps, color: 'graphite' }],
    title: <>Les compos<br />tombent.<br /><em>On relance.</em></>,
    text: <>Au foot, la fiche est <b>resimulée 30 minutes avant</b> le match avec les compos officielles. Au basket, les absents de dernière minute sont pris en compte. Rien à faire de ton côté.</>,
  },
];

export function Stories() {
  return (
    <div className="lh-stories">
      {STORIES.map((s, i) => (
        <section key={i} className={`lh-story${s.flip ? ' flip' : ''}${s.dark ? ' dk' : ''}`} style={{ '--bg': `url(${s.bg})` } as CSSProperties} data-reveal>
          <div className="lh-story-copy">
            <span className="lh-kick">{s.kick}</span>
            <h2>{s.title}</h2>
            <p>{s.text}</p>
          </div>
          <div className={`lh-story-art n${s.shots.length}`}>
            {s.shots.map((x, k) => (
              <Phone key={k} src={x.src} color={x.color} className={`lh-ph-${k}`} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Trois sports : programme de chaque sport dans un iPhone. */
export function Sports() {
  const s: Array<[ReactNode, string, string, string]> = [
    [<SoccerBall size={20} />, 'Football', 'Ligue 1, Premier League, LaLiga, Serie A, Bundesliga et Ligue des Champions. Double chance, handicap, buts, buteurs et combinés.', progFoot],
    [<Basketball size={20} />, 'NBA', 'Chaque possession rejouée : rotations, arbitres, fatigue, absents. Vainqueur, handicap plus sûr et les joueurs en feu.', progNba],
    [<TennisBall size={20} />, 'Tennis ATP', 'Point par point, au service et au retour, selon la surface. Vainqueur, au moins un set, score en sets et nombre de jeux.', atp],
  ];
  return (
    <div className="lh-sports">
      {s.map(([ic, t, d, src], i) => (
        <div key={t} className="lh-sport" data-reveal style={{ '--d': i } as CSSProperties}>
          <div className="lh-sport-art" style={{ '--bg': `url(${[bgMarine, bgGlace, bgNeon][i]})` } as CSSProperties}>
            <Phone src={src} color={i === 1 ? 'argent' : 'noir'} />
          </div>
          <span className="lh-sport-t">
            {ic} {t}
          </span>
          <p>{d}</p>
        </div>
      ))}
    </div>
  );
}

/** Simulation en direct (bientôt) : la probabilité qui bouge avec le score. */
export function LiveSim() {
  return (
    <section className="lh-live" style={{ '--bg': `url(${bgNeon})` } as CSSProperties} data-reveal>
      <div className="lh-live-copy">
        <span className="lh-soon">
          <Broadcast size={15} weight="bold" /> Bientôt
        </span>
        <h2>
          En direct,
          <br />
          <em>le match se rejoue</em>
          <br />
          à chaque action.
        </h2>
        <p>
          Un but, un carton rouge, un break : Razzia relance la simulation à partir du score et du temps qui reste. La probabilité bouge avec le match, et tu sais tout de suite si ton pari tient
          toujours.
        </p>
      </div>
      <div className="lh-live-card" aria-hidden="true">
        <div className="lh-live-top">
          <span className="lh-live-dot" /> En direct · <b className="lh-min" />
        </div>
        <div className="lh-live-teams">
          <span>Villarreal</span>
          <b className="lh-score" />
          <span>Getafe</span>
        </div>
        <div className="lh-live-bar">
          <i className="h" />
          <i className="d" />
          <i className="a" />
        </div>
        <div className="lh-live-legend">
          <span className="lh-ph" /> <span>Nul</span> <span>Getafe</span>
        </div>
        <div className="lh-live-feed">
          <span>
            <Lightning size={13} weight="fill" /> 25 000 simulations relancées après chaque action
          </span>
        </div>
      </div>
    </section>
  );
}

const PLANS: Array<{ id: string; name: string; price: string; unit: string; sub: string; pitch: string; items: Array<[boolean, ReactNode]>; cta: string; top?: boolean; tag?: string }> = [
  {
    id: 'free', name: 'Gratuit', price: '0', unit: '€', sub: 'Pour toujours', pitch: 'Pour découvrir Razzia.', cta: 'Commencer gratuitement',
    items: [
      [true, 'Un match par sport et par jour (foot, NBA, tennis)'],
      [true, 'Le pronostic Razzia et sa vraie chance'],
      [true, 'Le bilan public, match par match'],
      [false, 'Les matchs phares de la journée'],
      [false, 'Pronostics par catégorie et combinés'],
      [false, 'Mon suivi des tickets'],
    ],
  },
  {
    id: 'premium', name: 'Premium', price: '14,99', unit: '€/mois', sub: 'Sans engagement, résiliable en un clic', pitch: 'Tous les matchs, tous les paris.', cta: 'Passer Premium', top: true, tag: 'Recommandé',
    items: [
      [true, <><b>Tous les matchs</b> des trois sports, matchs phares compris</>],
      [true, 'Toute la journée simulée en un clic'],
      [true, 'Pronostics par catégorie : vainqueur, double chance, handicap, sets, buts, buteurs'],
      [true, 'Combinés testés : foot et tennis'],
      [true, 'Razzia assuré, pile ou face et Value'],
      [true, 'Compos officielles et relance automatique avant le match'],
      [true, 'En feu ce soir, chat noir, où va l’argent'],
      [true, 'Mon suivi : simples et combinés validés en direct'],
      [true, <><b>Simulation en direct</b> dès sa sortie</>],
    ],
  },
  {
    id: 'life', name: 'À vie', price: '149', unit: '€', sub: 'Un seul paiement, jamais d’abonnement', pitch: 'Tout Premium, pour toujours.', cta: 'Prendre l’accès à vie', tag: 'Le prix de 10 mois',
    items: [
      [true, <><b>Tout Premium</b>, sans limite de durée</>],
      [true, 'La simulation en direct incluse dès sa sortie'],
      [true, 'Les nouveaux sports et compétitions inclus'],
      [true, 'Toutes les améliorations du moteur'],
      [true, 'Aucun renouvellement, aucune hausse de prix'],
    ],
  },
];

export function PlansV2() {
  return (
    <>
      <div className="lh-plans">
        {PLANS.map((p, i) => (
          <div key={p.id} className={`lh-plan${p.top ? ' is-top' : ''}`} data-reveal style={{ '--d': i, ...(p.top ? { '--bg': `url(${bgMarine})` } : {}) } as CSSProperties}>
            {p.tag && <span className="lh-plan-tag">{p.tag}</span>}
            <span className="lh-plan-n">{p.name}</span>
            <p className="lh-plan-p">
              {p.price}
              <small>{p.unit}</small>
            </p>
            <p className="lh-plan-sub">{p.sub}</p>
            <p className="lh-plan-pitch">{p.pitch}</p>
            <Btn href={SIGNUP} ghost={!p.top}>
              {p.cta}
            </Btn>
            <ul>
              {p.items.map(([ok, t], k) => (
                <li key={k} className={ok ? '' : 'no'}>
                  {ok ? <Check size={16} weight="bold" /> : <Minus size={16} weight="bold" />} <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="lh-pay">Sans engagement · Résiliable en un clic · Réservé aux plus de 18 ans</p>
    </>
  );
}

export const QA_V2: Array<[string, string]> = [
  ['Qu’est-ce que Razzia fait qu’une IA généraliste ne fait pas ?', 'Une IA généraliste résume ce qu’elle a lu. Razzia rejoue le match : 25 000 fois, avec les compos, la forme, la fatigue et les cotes du moment, sur des données mises à jour avant chaque simulation. Le résultat est une probabilité chiffrée, pas une opinion.'],
  ['Quels sports et quelles compétitions ?', 'Le football (Ligue 1, Premier League, LaLiga, Serie A, Bundesliga, Ligue des Champions), la NBA et le tennis ATP. D’autres sports suivront : ils sont inclus dans Premium et dans l’accès à vie.'],
  ['Que contient la formule gratuite ?', 'Un match par sport et par jour, choisi par Razzia, avec son pronostic et sa vraie chance, et le bilan public. Les matchs phares, les pronostics par catégorie, les combinés et le suivi des tickets sont dans Premium.'],
  ['Quelle différence entre Premium et l’accès à vie ?', 'Le contenu est le même : tous les matchs et tous les paris. Premium se paie 14,99 € par mois, sans engagement. L’accès à vie se paie une seule fois, 149 €, le prix de 10 mois, et comprend tout ce qui sortira ensuite, la simulation en direct comprise.'],
  ['C’est quoi, la simulation en direct ?', 'Bientôt : pendant le match, Razzia relance la simulation après chaque action importante (but, carton, break) à partir du score et du temps qui reste. Elle sera incluse dans Premium et dans l’accès à vie.'],
  ['Est-ce que ça marche vraiment ?', 'Le bilan est public et compte tout, même les ratés. Au 8 novembre 2026, depuis le début de la saison : 91 % des pronos passés au foot, 86 % en NBA, 84 % au tennis. Les règles ont aussi été testées sur les deux saisons précédentes, sur des matchs que le moteur n’avait jamais vus.'],
  ['Comment Razzia utilise les cotes ?', 'Les cotes servent de repère : la probabilité affichée mêle le moteur et le marché selon la confiance. Un pari est « Value » quand il passe dans au moins 65 % des simulations avec une cote du marché d’au moins 1,35. Tu vois aussi de quel côté va l’argent.'],
  ['Razzia prend-il mes paris ?', 'Non. Razzia analyse les matchs. Tu joues chez ton bookmaker, Razzia t’aide à choisir et suit ton ticket.'],
  ['Je peux arrêter quand je veux ?', 'Oui. Premium est sans engagement : l’abonnement s’arrête à la fin du mois en cours, en un clic.'],
  ['C’est réservé aux majeurs ?', 'Oui, Razzia est réservé aux plus de 18 ans. Jouer comporte des risques : endettement, dépendance. Appelle le 09 74 75 13 13 (appel non surtaxé) si besoin.'],
];

export function FinalV2() {
  return (
    <section className="lh-final" style={{ '--bg': `url(${bgMarine})` } as CSSProperties} data-reveal>
      <div className="lh-final-copy">
        <h2>
          Ce soir,
          <br />
          <em>parie en sachant.</em>
        </h2>
        <p>Gratuit pour commencer. Premium quand tu veux tout voir.</p>
        <div className="lp-cta">
          <Btn href={SIGNUP}>Commencer gratuitement</Btn>
          <Btn href="/accueil/tarifs" ghost>
            Voir les formules
          </Btn>
        </div>
      </div>
      <div className="lh-final-art">
        <Phone src={progNba} className="lh-ph-0" />
      </div>
    </section>
  );
}
