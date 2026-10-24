// Page « Badges » : ce que veut dire chaque badge de l'app, basket et tennis, avec ce qu'il a donné sur les saisons passées.
import type { ReactNode } from 'react';
import { ArrowsSplit, Cat, ChartLineDown, ChartLineUp, ClipboardText, CoinVertical, Fire, HouseLine, Mountains, ShieldCheck, Trophy } from '@phosphor-icons/react';

interface Badge { icon: ReactNode; tone: string; title: string; text: ReactNode }

function BadgeList({ items }: { items: Badge[] }) {
  return (
    <div className="badge-list">
      {items.map((b) => (
        <div key={b.title} className={`signal badge-item ${b.tone}`}>
          <span className="signal-icon">{b.icon}</span>
          <div>
            <p className="signal-title">{b.title}</p>
            <p>{b.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const common: Badge[] = [
  {
    icon: <span className="badge-dot safe" />, tone: 'badge-safe', title: 'Safe (point bleu)',
    text: "Sur l'onglet du pari plus sûr que le simple vainqueur : le handicap au basket, « Un set » au tennis. Il passe plus souvent que la victoire, pour une cote plus basse.",
  },
  {
    icon: <span className="badge-dot warn" />, tone: 'badge-warn', title: 'Déconseillé (point rouge)',
    text: "Sur le vainqueur quand le match est en pile ou face : le pari plus sûr passe devant, et c'est lui qui compte au bilan.",
  },
];

const nba: Badge[] = [
  {
    icon: <ShieldCheck size={20} weight="bold" />, tone: 'badge-sure', title: 'Razzia assuré',
    text: 'Favori à 77 % ou plus : le moteur a vu juste 85 % du temps sur la saison passée (un match sur quatre).',
  },
  {
    icon: <CoinVertical size={20} weight="bold" />, tone: 'badge-flip', title: 'Pile ou face',
    text: "Favori sous 66 %, ou sous 70 % quand une équipe a joué moins de 5 matchs (début de saison : tout repart de zéro). Le handicap « plus sûr » passe devant, le vainqueur est déconseillé.",
  },
  {
    icon: <ArrowsSplit size={20} weight="bold" />, tone: 'badge-market', title: 'Désaccord avec le marché',
    text: "En début de saison, quand le marché voit l'autre équipe favorite avec un gros écart : le moteur n'avait raison qu'une fois sur deux. Prudence.",
  },
  {
    icon: <Cat size={20} weight="fill" />, tone: 'signal-cat', title: 'Chat noir',
    text: "Une équipe qui perd contre l'autre même quand elle est favorite (au moins 3 défaites en étant favorite sur deux ans, 70 % ou plus, bien sous l'écart attendu). Rare.",
  },
  {
    icon: <ChartLineUp size={20} weight="bold" />, tone: 'signal-up', title: 'En pleine montée',
    text: "L'équipe joue nettement mieux sur ses 15 derniers matchs que les saisons d'avant (au moins 4 points d'écart par match de mieux).",
  },
  {
    icon: <ChartLineDown size={20} weight="bold" />, tone: 'signal-down', title: 'En baisse',
    text: "L'inverse : au moins 4 points d'écart par match de moins sur les 15 derniers matchs.",
  },
  {
    icon: <Fire size={20} weight="bold" />, tone: 'badge-fire', title: 'En feu ce soir',
    text: 'Les joueurs que les simulations voient le plus souvent faire un gros match, rangés par chance de réussir, avec les raisons (forme, défense adverse, minutes…).',
  },
  {
    icon: <ClipboardText size={20} weight="bold" />, tone: 'badge-info', title: 'Compositions non officielles',
    text: "La simulation a été faite avant l'annonce des cinq de départ (environ 30 minutes avant le match) : à relancer avec les compos.",
  },
];

const tennis: Badge[] = [
  {
    icon: <ShieldCheck size={20} weight="bold" />, tone: 'badge-sure', title: 'Razzia assuré',
    text: 'Favori à 80 % ou plus : il a gagné 88 % du temps sur 2024-2025.',
  },
  {
    icon: <CoinVertical size={20} weight="bold" />, tone: 'badge-flip', title: 'Pile ou face',
    text: "Favori sous 60 %, ou outsider en hausse (le favori perdait alors plus souvent que prévu). « Un set » passe devant, le vainqueur est déconseillé.",
  },
  {
    icon: <Cat size={20} weight="fill" />, tone: 'signal-cat', title: 'Chat noir',
    text: "Au moins 4 confrontations en 6 ans, dont 75 % ou plus gagnées par le même joueur, avec 3 victoires d'avance.",
  },
  {
    icon: <ChartLineUp size={20} weight="bold" />, tone: 'signal-up', title: 'En hausse',
    text: "Au moins 2 victoires de plus que ce qu'annonçait son niveau sur ses 10 derniers matchs (un joueur sur dix). Flèche verte à côté du nom dans le programme.",
  },
  {
    icon: <ChartLineDown size={20} weight="bold" />, tone: 'signal-down', title: 'En baisse',
    text: "Au moins 2 victoires de moins qu'attendu sur ses 10 derniers matchs. Flèche rouge à côté du nom.",
  },
  {
    icon: <HouseLine size={20} weight="bold" />, tone: 'signal-home', title: 'À domicile',
    text: "Il joue dans son pays, devant son public. À savoir : le marché surcote déjà les joueurs à domicile, encore plus quand ils sont en hausse. Petite maison à côté du nom.",
  },
  {
    icon: <Trophy size={20} weight="bold" />, tone: 'signal-goal', title: 'Objectif Masters',
    text: "Un top 20 en ATP 250 ou 500 après le 10 octobre : la course au Masters de fin d'année. Ces favoris ont gagné 82 % de leurs matchs quand le marché en annonçait 72 %. Petit trophée à côté du nom.",
  },
  {
    icon: <Mountains size={20} weight="bold" />, tone: 'signal-surface', title: 'Sa surface',
    text: "Il joue nettement mieux sur la surface du jour que d'habitude (au moins 60 points d'Elo de mieux que son adversaire). Le marché et le moteur en tiennent déjà compte.",
  },
];

export function BadgesPage() {
  return (
    <div className="page">
      <header className="page-head">
        <h1>Badges</h1>
        <p className="lede">Ce que veut dire chaque badge, et ce qu'il a donné sur les saisons passées.</p>
      </header>
      <section className="badge-sec">
        <h2 className="caps">Partout</h2>
        <BadgeList items={common} />
      </section>
      <section className="badge-sec">
        <h2 className="caps">Basket (NBA)</h2>
        <BadgeList items={nba} />
      </section>
      <section className="badge-sec">
        <h2 className="caps">Tennis (ATP)</h2>
        <BadgeList items={tennis} />
      </section>
    </div>
  );
}
