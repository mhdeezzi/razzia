// Pronostics tennis, mêmes principes que la NBA : vainqueur, ou « Un set » (le favori gagne au moins un set ; « Deux
// sets » en Grand Chelem si c'est la ligne la plus sûre qui paie encore 1,15), et 2-0 / 3-0 pour un gros favori.
// Deux saisons ATP (2024-2025, 4 120 matchs, probabilités apprises sur l'autre saison) : 81,4 % de bons pronostics
// (marché seul avec les mêmes règles 81,3 %, marché avec les anciennes 80,6 %).
import { shown, MIN_ODDS, type Category, type Outcome } from './picks.ts';
import type { TennisResult } from './tennis.tsx';

/** Favori à 80 % ou moins : « Un set » passe devant, le vainqueur est déconseillé (et c'est « Un set » qui compte au bilan). */
export const T_HEDGE_FIRST = 0.8;
/** Favori sous 60 % : match serré (texte du badge « Pile ou face »). */
export const T_FLIP = 0.6;
/** Favori à 80 % ou plus : Razzia assuré. */
export const T_SURE = 0.8;

/** « de Fils », « d'Arthur Fils » : élision devant une voyelle ou un h. */
const de = (name: string) => (/^[aeiouyhâéèêîôûAEIOUYHÂÉÈÊÎÔÛ]/.test(name) ? `d'${name}` : `de ${name}`);
const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const noVig = (a?: number, b?: number) => (a && b ? (1 / a) / (1 / a + 1 / b) : undefined);

export function favOf(r: TennisResult): { side: 'home' | 'away'; p: number } {
  return r.pHome >= 0.5 ? { side: 'home', p: r.pHome } : { side: 'away', p: 1 - r.pHome };
}

/** Outsider en hausse (forme sur 10 matchs) : le favori a gagné 4 points de moins qu'annoncé sur 2024-2025. */
const dogUpOf = (r: TennisResult) => r[favOf(r).side === 'home' ? 'away' : 'home'].trend === 'up';

/** Ligne de sets la plus sûre qui paie encore 1,15 et passe plus souvent que la victoire (outsider en hausse : même sous 1,15). */
function setsLine(r: TennisResult) {
  const { side, p: winP } = favOf(r);
  const i = side === 'home' ? 0 : 1;
  const lines = r.bestOf === 5
    ? [{ need: 1, label: 'Un set', c: r.sim.atLeast1[i], line: 2.5 }, { need: 2, label: 'Deux sets', c: r.sim.atLeast2[i], line: 1.5 }]
    : [{ need: 1, label: 'Un set', c: r.sim.atLeast1[i], line: 1.5 }];
  return lines.filter((x) => (dogUpOf(r) || x.c <= 1 / MIN_ODDS) && x.c > winP).sort((a, b) => b.c - a.c)[0];
}

/**
 * Pile ou face : exactement quand la fiche déconseille le vainqueur et met la ligne de sets devant (favori à 80 % ou
 * moins, ou outsider en hausse), sauf si l'outsider est la victime d'un chat noir du favori : on garde alors la victoire
 * du favori. Le programme, la fiche et le bilan suivent cette seule règle.
 * Raison affichée : outsider en hausse, match serré (favori sous 60 %), ou favori trop juste pour jouer sa victoire seule.
 */
export function flipOf(r: TennisResult): 'dogUp' | 'close' | 'hedge' | undefined {
  const dogUp = dogUpOf(r);
  if (r.blackCat && r.blackCat.victim !== favOf(r).side) return undefined;
  if (!setsLine(r) || !(dogUp || shown(favOf(r).p) <= T_HEDGE_FIRST)) return undefined;
  return dogUp ? 'dogUp' : shown(favOf(r).p) < T_FLIP ? 'close' : 'hedge';
}

export function buildTennisCategories(r: TennisResult): Category[] {
  const { side, p: winP } = favOf(r);
  const fav = r[side], dog = r[side === 'home' ? 'away' : 'home'];
  const i = side === 'home' ? 0 : 1;
  const who = { name: fav.name, photo: fav.photo, alt: fav.photoAlt };
  const o = r.market.odds ?? {};
  const top = Object.entries(r.sim.scores).filter(([k]) => (side === 'home' ? +k[0] > +k[2] : +k[2] > +k[0])).sort((a, b) => b[1] - a[1])[0];
  const scoreTxt = (k: string) => (side === 'home' ? k : k.split('-').reverse().join('-'));
  // Cotes Pinnacle en sets : ligne = sets donnés au joueur « domicile ».
  const setOdds = (lineFav: number) => {
    const x = o.sets?.find((s) => s.line === (side === 'home' ? lineFav : -lineFav));
    return x ? { odds: side === 'home' ? x.home : x.away, implied: noVig(side === 'home' ? x.home : x.away, side === 'home' ? x.away : x.home) } : {};
  };

  const win: Outcome = {
    id: 'win', title: `Victoire ${de(fav.name)}`, who, p: winP, fair: 1 / winP,
    odds: o.ml ? o.ml[i] : undefined, implied: o.ml ? noVig(o.ml[i], o.ml[1 - i]) : undefined,
    text: `${fav.name} gagne ${Math.round(winP * r.sim.n).toLocaleString('fr-FR')} des ${r.sim.n.toLocaleString('fr-FR')} matchs simulés${top ? `. Score le plus fréquent : ${scoreTxt(top[0])} (${pct(top[1])})` : ''}.`,
  };

  const L = setsLine(r);
  const sets: Outcome | undefined = L && {
    id: 'sets', title: `${fav.name} gagne au moins ${L.need === 1 ? 'un set' : 'deux sets'}`, who, p: L.c, fair: 1 / L.c, ...setOdds(L.line),
    text: `Plus sûr que la victoire : ${fav.name} gagne le match, ou perd en prenant au moins ${L.need === 1 ? 'un set' : 'deux sets'} à ${dog.name}. Passe dans ${pct(L.c)} des simulations.`,
  };
  const need = r.bestOf === 5 ? 3 : 2;
  const straight: Outcome = {
    id: 'straight', title: `${fav.name} gagne ${need}-0`, who, p: r.sim.straight[i], fair: 1 / r.sim.straight[i], ...setOdds(-(need - 0.5)),
    text: `${fav.name} gagne sans perdre de set dans ${pct(r.sim.straight[i])} des simulations : cote plus haute, risque plus grand.`,
  };

  if (flipOf(r))
    return [
      { id: 'sets', label: L!.label, items: [sets!] },
      { id: 'win', label: 'Vainqueur', items: [{ ...win, warn: 'Déconseillé' }], warn: true },
    ];
  if (sets) return [{ id: 'win', label: 'Vainqueur', items: [win] }, { id: 'sets', label: L!.label, items: [{ ...sets, safe: 'Safe' }], good: true }];
  return [{ id: 'win', label: 'Vainqueur', items: [win] }, { id: 'straight', label: `${need}-0`, items: [straight] }];
}
