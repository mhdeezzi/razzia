// Page d'accueil v2 : visuels des campagnes (fonds photo, iPhone avec de vrais écrans du site), trois sports, simulation
// en direct à venir, formules Gratuit / Premium / À vie.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ArrowRight, Broadcast, Check, Lightning, Minus } from '@phosphor-icons/react';
import { Link } from './ui.tsx';
import { loadRecord } from './record.tsx';
import { WarpBg } from './shaders.tsx';
import './landinghome.css';
import progFoot from './assets/lp/prog-foot.webp';
import progNba from './assets/lp/prog-nba.webp';
import vilTop from './assets/lp/foot-vil-top.webp';
import vilPick from './assets/lp/foot-vil-pick.webp';
import flip from './assets/lp/nba-flip-verdict.webp';
import suivi from './assets/lp/suivi-tk.webp';
import steps from './assets/lp/foot-steps.webp';
import atp from './assets/lp/atp-fin-top.webp';

export const SIGNUP = '/compte?mode=up&next=/';

/** iPhone dessiné en CSS (titane, Dynamic Island, barre d'état) avec une vraie capture du site. 1em = 1 % de sa largeur.
 * Plusieurs captures : un seul téléphone, l'écran `on` affiché en fondu (plus léger que plusieurs téléphones superposés). */
export function Phone({ src, on = 0, color = 'noir', className = '', style, lazy }: { src: string | string[]; on?: number; color?: 'noir' | 'bleu' | 'argent' | 'graphite'; className?: string; style?: CSSProperties; lazy?: boolean }) {
  const list = Array.isArray(src) ? src : [src];
  return (
    <div className={`iph c-${color} ${className}`} style={style} aria-hidden="true">
      <i className="bt b1" /><i className="bt b2" /><i className="bt b3" /><i className="bt b4" />
      <div className="bz">
        <div className={`sc${list.length > 1 ? ' multi' : ''}`}>
          {list.map((x, i) => (
            <img key={x} className={`site${i === on ? ' is-on' : ''}`} src={x} alt="" decoding="async" loading={lazy ? 'lazy' : undefined} />
          ))}
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

const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Écran étroit (téléphone, tablette en portrait) : suit les changements de taille et d'orientation. */
function useNarrow(max = 980): boolean {
  const q = `(max-width: ${max}px)`;
  const [v, setV] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setV(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return v;
}
/** Vrai tant que l'élément est à l'écran : les animations en boucle s'arrêtent hors champ. */
function useSeen<T extends HTMLElement>(threshold = 0.3): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => setSeen(e.isIntersecting)), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen];
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

const NUIT = ['#2a4f9a', '#7a3a6e'] as const;

/** Haut de page : le marbre, le slogan, et trois iPhone en éventail (tennis, foot, NBA) qui sortent du bas. */
export function HeroV3() {
  return (
    <header className="lp-hero3 lh3-hero mesh has-shader">
      <WarpBg c1={NUIT[0]} c2={NUIT[1]} />
      <span className="lp-eyebrow on-dark lp-in" style={{ '--d': 0 } as CSSProperties}>
        <span>
          Foot · NBA · Tennis ATP<span className="lh3-wide"> · 25 000 simulations par match</span>
        </span>
      </span>
      <h1 className="lp-in" style={{ '--d': 1 } as CSSProperties}>
        <span>Le match,</span>
        <span>25 000 fois</span>
        <em>avant le vrai.</em>
      </h1>
      <p className="lp-lede center lp-in" style={{ '--d': 2 } as CSSProperties}>
        Razzia rejoue chaque match avant le coup d’envoi : qui gagne, de combien, et quel pari passe le plus souvent.
      </p>
      <div className="lp-cta center lp-in" style={{ '--d': 3 } as CSSProperties}>
        <Btn href={SIGNUP}>Commencer gratuitement</Btn>
        <Btn href="/accueil/tarifs" ghost>
          Voir les formules
        </Btn>
      </div>
      <p className="lp-trial lp-in" style={{ '--d': 4 } as CSSProperties}>
        Gratuit pour toujours · Premium sans engagement
      </p>
      <div className="lh3-fan" aria-hidden="true">
        <Phone src={atp} className="lh3-f l" />
        <Phone src={progFoot} color="bleu" className="lh3-f c" />
        <Phone src={progNba} className="lh3-f r" />
      </div>
      <i className="lh3-fade" aria-hidden="true" />
    </header>
  );
}

/** Bilan du jour, le même que sous les programmes du site ; les derniers chiffres relevés à la main en attendant (ou si
 * le bilan ne répond pas). */
const PROOF: Array<{ sport: 'foot' | 'nba' | 'atp'; name: string; won: number; n: number }> = [
  { sport: 'foot', name: 'Football', won: 37, n: 40 },
  { sport: 'nba', name: 'NBA', won: 124, n: 143 },
  { sport: 'atp', name: 'Tennis ATP', won: 85, n: 102 },
];
const PROOF_DAY = '11 novembre 2026';

export function ProofV3() {
  const [rows, setRows] = useState(PROOF);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let on = true;
    void Promise.all(PROOF.map((p) => loadRecord(p.sport).then((r) => ({ ...p, won: r.rows.filter((x) => x.won).length, n: r.rows.length }))))
      .then((list) => { if (on && list.every((x) => x.n >= 5)) { setRows(list); setLive(true); } })
      .catch(() => undefined);
    return () => { on = false; };
  }, []);
  return (
    <section className="lp-proof lh3-proof" data-reveal>
      {rows.map((r) => (
        <div key={r.sport}>
          <b className="up">{Math.round((r.won / r.n) * 100)} %</b>
          <span>
            <strong>{r.name}</strong> · {r.won} pronos passés sur {r.n} depuis le début de la saison
          </span>
        </div>
      ))}
      <p>{live ? 'Bilan public, mis à jour après chaque match.' : `Bilan public au ${PROOF_DAY}.`} Tout est compté, même les ratés.</p>
    </section>
  );
}

const STEPS: Array<{ n: string; t: string; d: ReactNode; src: string }> = [
  { n: '01', t: 'Choisis ton match', d: 'Le programme du jour en foot, NBA et tennis, avec les cotes, les compos et le favori de Razzia sur chaque carte.', src: progFoot },
  { n: '02', t: 'Razzia le joue 25 000 fois', d: 'Le score le plus probable, les buteurs, le déroulé du match : tout sort des simulations, avec la forme, la fatigue et les absents du soir.', src: vilTop },
  { n: '03', t: 'Le pari qui passe le plus souvent', d: 'Vainqueur, double chance, handicap plus sûr, un set ou un combiné testé : chaque pari avec sa vraie chance et la cote juste à côté de celle du marché.', src: vilPick },
  { n: '04', t: 'Les compos tombent, on relance', d: 'Au foot, la fiche est resimulée 30 minutes avant le match avec les compos officielles. Au basket, les absents de dernière minute sont pris en compte.', src: steps },
  { n: '05', t: 'Quand c’est trop serré, on te le dit', d: 'Un match à pile ou face est marqué « Déconseillé », avec le pari plus sûr à la place. Le meilleur pari, c’est parfois de ne pas parier.', src: flip },
  { n: '06', t: 'Ton ticket, en direct', d: 'Ajoute tes paris d’un geste. Simples ou combinés, chaque sélection se coche toute seule quand elle passe.', src: suivi },
];

const SHOTS = STEPS.map((x) => x.src);
const AUTO_MS = 5200;

/** Ordinateur : le téléphone reste à l'écran pendant qu'on fait défiler les étapes ; son écran suit l'étape lue. */
function StoryScroll() {
  const [on, setOn] = useState(0);
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setOn(Number((e.target as HTMLElement).dataset.i))), { rootMargin: '-45% 0px -45% 0px' });
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <div className="lh3-story-grid">
      <div className="lh3-story-phone" aria-hidden="true">
        <div className="lh3-glow" />
        <Phone src={SHOTS} on={on} lazy />
      </div>
      <div className="lh3-steps">
        {STEPS.map((x, i) => (
          <div key={x.n} ref={(el) => void (refs.current[i] = el)} data-i={i} className={`lh3-step${i === on ? ' is-on' : ''}`}>
            <span className="lh3-n">{x.n}</span>
            <h3>{x.t}</h3>
            <p>{x.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Téléphone : un seul iPhone, les étapes en cartes qu'on fait glisser au doigt. Sans y toucher, l'étape suivante arrive
 * toute seule (la barre du haut se remplit, comme une story) ; le doigt posé met en pause, et rien ne tourne hors champ.
 */
function StoryPlayer() {
  const [on, setOn] = useState(0);
  const [hold, setHold] = useState(false);
  const [box, seen] = useSeen<HTMLDivElement>(0.4);
  const track = useRef<HTMLDivElement>(null);
  // L'étape affichée est la carte la plus visible : le glissement au doigt et l'avance automatique passent par là.
  useEffect(() => {
    const t = track.current;
    if (!t) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setOn(Number((e.target as HTMLElement).dataset.i))), { root: t, threshold: 0.6 });
    [...t.children].forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, []);
  const go = (i: number) => {
    const t = track.current;
    if (!t) return;
    const n = ((i % STEPS.length) + STEPS.length) % STEPS.length;
    // Retour à la première étape : d'un coup (repasser par toutes les cartes ferait défiler tous les écrans).
    t.scrollTo({ left: n * t.clientWidth, behavior: still() || Math.abs(n - on) > 1 ? 'auto' : 'smooth' });
  };
  const press = { onPointerDown: () => setHold(true), onPointerUp: () => setHold(false), onPointerCancel: () => setHold(false), onPointerLeave: () => setHold(false) };
  return (
    <div className={`lh3-player${seen && !hold ? ' is-playing' : ''}`} ref={box} {...press}>
      <div className="lh3-bars" role="tablist" aria-label="Étapes">
        {STEPS.map((x, i) => (
          <button key={x.n} type="button" role="tab" aria-selected={i === on} aria-label={`Étape ${i + 1} : ${x.t}`} className={`lh3-bar${i < on ? ' is-done' : i === on ? ' is-on' : ''}`} onClick={() => go(i)}>
            <i key={i === on ? 'on' : 'off'} style={{ animationDuration: `${AUTO_MS}ms` }} onAnimationEnd={() => i === on && go(on + 1)} />
          </button>
        ))}
      </div>
      <button type="button" className="lh3-player-phone" tabIndex={-1} aria-hidden="true" onClick={() => go(on + 1)}>
        <span className="lh3-glow" />
        <Phone src={SHOTS} on={on} lazy />
      </button>
      <div className="lh3-track" ref={track}>
        {STEPS.map((x, i) => (
          <article key={x.n} data-i={i} className="lh3-card">
            <span className="lh3-n">
              {x.n} <i>/ 0{STEPS.length}</i>
            </span>
            <h3>{x.t}</h3>
            <p>{x.d}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function ScrollStory() {
  const narrow = useNarrow();
  return (
    <section className="lp-sec lh3-story">
      <div className="lp-sec-head" data-reveal>
        <span className="lp-eyebrow">Comment ça marche</span>
        <h2>Du programme au coup de sifflet final.</h2>
      </div>
      {narrow ? <StoryPlayer /> : <StoryScroll />}
    </section>
  );
}

/** Scénario de la carte « En direct » : minute, score, chances (Villarreal, nul, Getafe), action. */
const LIVE: Array<{ min: string; score: string; p: [number, number, number]; ev: string }> = [
  { min: '12’', score: '0 - 0', p: [65, 22, 13], ev: 'Coup d’envoi : le pronostic d’avant-match' },
  { min: '38’', score: '1 - 0', p: [84, 12, 4], ev: 'But de Villarreal : la victoire se confirme' },
  { min: '71’', score: '1 - 1', p: [41, 43, 16], ev: 'Getafe égalise : le nul passe devant' },
  { min: '88’', score: '2 - 1', p: [91, 7, 2], ev: 'Villarreal reprend l’avantage' },
];

/** Simulation en direct (bientôt), dans le fil de la page : la probabilité qui bouge avec le score. La carte est animée
 * par le composant (et non par des animations CSS de texte, que Safari sur iPhone ne joue pas). */
export function LiveV3() {
  const [i, setI] = useState(0);
  const [card, seen] = useSeen<HTMLDivElement>(0.5);
  useEffect(() => {
    if (!seen || still()) return;
    const t = setInterval(() => setI((k) => (k + 1) % LIVE.length), 3200);
    return () => clearInterval(t);
  }, [seen]);
  const f = LIVE[i];
  const lead = f.p[0] >= f.p[1] && f.p[0] >= f.p[2] ? 0 : f.p[1] >= f.p[2] ? 1 : 2;
  return (
    <section className="lp-sec lh3-live">
      <div className="lh3-live-copy" data-reveal>
        <span className="lh-soon">
          <Broadcast size={15} weight="bold" /> Bientôt
        </span>
        <h2>
          En direct, le match
          <br />
          <em>se rejoue à chaque action.</em>
        </h2>
        <p className="lp-lede">
          Un but, un carton rouge, un break : Razzia relance la simulation à partir du score et du temps qui reste. La probabilité bouge avec le match, et tu sais tout de suite si ton pari tient
          toujours.
        </p>
      </div>
      <div className="lh-live-card" data-reveal aria-hidden="true" ref={card}>
        <div className="lh-live-top">
          <span className="lh-live-dot" /> En direct · <b>{f.min}</b>
        </div>
        <div className="lh-live-teams">
          <span>Villarreal</span>
          <b className="lh-score" key={f.score}>{f.score}</b>
          <span>Getafe</span>
        </div>
        <div className="lh-live-bar">
          <i className="h" style={{ flexGrow: f.p[0] }} />
          <i className="d" style={{ flexGrow: f.p[1] }} />
          <i className="a" style={{ flexGrow: f.p[2] }} />
        </div>
        <div className="lh-live-legend">
          {(['Villarreal', 'Nul', 'Getafe'] as const).map((n, k) => (
            <span key={n} className={k === lead ? 'is-lead' : undefined}>
              {n} <b>{f.p[k]} %</b>
            </span>
          ))}
        </div>
        <div className="lh-live-feed">
          <span key={i}>
            <Lightning size={13} weight="fill" /> {f.ev}
          </span>
          <small>25 000 simulations relancées après chaque action</small>
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

/** Formules : cartes à double contour, le marbre pour Premium. */
export function PlansV3() {
  return (
    <>
      <div className="lh-plans">
        {PLANS.map((p, i) => (
          <div key={p.id} className={`lp-bezel lp-plan-shell${p.top ? ' is-top' : ''}`} data-reveal style={{ '--d': i } as CSSProperties}>
            <div className={`lp-bezel-in lh-plan${p.top ? ' mesh has-shader' : ''}`}>
              {p.top && (
                <div className="lp-dim">
                  <WarpBg c1={NUIT[0]} c2={NUIT[1]} />
                </div>
              )}
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
  ['Est-ce que ça marche vraiment ?', 'Le bilan est public et compte tout, même les ratés : les chiffres du jour sont en haut de la page d’accueil et sous chaque programme, sport par sport. Les règles ont aussi été testées sur les deux saisons précédentes, sur des matchs que le moteur n’avait jamais vus.'],
  ['Comment Razzia utilise les cotes ?', 'Les cotes servent de repère : la probabilité affichée mêle le moteur et le marché selon la confiance. Un pari est « Value » quand il passe dans au moins 65 % des simulations avec une cote du marché d’au moins 1,35. Tu vois aussi de quel côté va l’argent.'],
  ['Razzia prend-il mes paris ?', 'Non. Razzia analyse les matchs. Tu joues chez ton bookmaker, Razzia t’aide à choisir et suit ton ticket.'],
  ['Je peux arrêter quand je veux ?', 'Oui. Premium est sans engagement : l’abonnement s’arrête à la fin du mois en cours, en un clic.'],
  ['C’est réservé aux majeurs ?', 'Oui, Razzia est réservé aux plus de 18 ans. Jouer comporte des risques : endettement, dépendance. Appelle le 09 74 75 13 13 (appel non surtaxé) si besoin.'],
];

/** Fin de page : le marbre, comme le haut. */
export function FinalV3() {
  return (
    <section className="lp-final mesh has-shader" data-reveal>
      <WarpBg c1={NUIT[0]} c2={NUIT[1]} />
      <span className="lp-eyebrow">Gratuit pour commencer</span>
      <h2>
        Ce soir,
        <br />
        parie en sachant.
      </h2>
      <div className="lp-cta center">
        <Btn href={SIGNUP}>Commencer gratuitement</Btn>
        <Btn href="/accueil/tarifs" ghost>
          Voir les formules
        </Btn>
      </div>
    </section>
  );
}
