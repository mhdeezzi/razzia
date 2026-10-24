// Pronostics tennis, mêmes principes que la NBA : vainqueur, ou « Un set » (le favori gagne au moins un set ; « Deux
// sets » en Grand Chelem si c'est la ligne la plus sûre qui paie encore 1,15), et 2-0 / 3-0 pour un gros favori.
// Deux saisons ATP (2024-2025, 4 400 matchs, probabilités apprises sur l'autre saison) : 80,3 % de bons pronostics.
import { shown, MIN_ODDS, type Category, type Outcome } from './picks.ts';
import type { TennisResult } from './tennis.tsx';

/** Favori à 75 % ou moins : « Un set » passe devant, le vainqueur est déconseillé (et c'est « Un set » qui compte au bilan). */
export const T_HEDGE_FIRST = 0.75;
/** Favori sous 60 % : pile ou face. */
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

export function buildTennisCategories(r: TennisResult): Category[] {
  const { side, p: winP } = favOf(r);
  const fav = r[side], dog = r[side === 'home' ? 'away' : 'home'];
  const i = side === 'home' ? 0 : 1;
  const o = r.market.odds ?? {};
  const top = Object.entries(r.sim.scores).filter(([k]) => (side === 'home' ? +k[0] > +k[2] : +k[2] > +k[0])).sort((a, b) => b[1] - a[1])[0];
  const scoreTxt = (k: string) => (side === 'home' ? k : k.split('-').reverse().join('-'));
  // Cotes Pinnacle en sets : ligne = sets donnés au joueur « domicile ».
  const setOdds = (lineFav: number) => {
    const x = o.sets?.find((s) => s.line === (side === 'home' ? lineFav : -lineFav));
    return x ? { odds: side === 'home' ? x.home : x.away, implied: noVig(side === 'home' ? x.home : x.away, side === 'home' ? x.away : x.home) } : {};
  };

  const win: Outcome = {
    id: 'win', title: `Victoire ${de(fav.name)}`, p: winP,
    odds: o.ml ? o.ml[i] : undefined, implied: o.ml ? noVig(o.ml[i], o.ml[1 - i]) : undefined,
    text: `${fav.name} gagne ${Math.round(winP * r.sim.n).toLocaleString('fr-FR')} des ${r.sim.n.toLocaleString('fr-FR')} matchs simulés${top ? `. Score le plus fréquent : ${scoreTxt(top[0])} (${pct(top[1])})` : ''}.`,
  };

  // Ligne de sets la plus sûre qui paie encore 1,15 et passe plus souvent que la victoire.
  const lines = r.bestOf === 5
    ? [{ need: 1, label: 'Un set', c: r.sim.atLeast1[i], line: 2.5 }, { need: 2, label: 'Deux sets', c: r.sim.atLeast2[i], line: 1.5 }]
    : [{ need: 1, label: 'Un set', c: r.sim.atLeast1[i], line: 1.5 }];
  const L = lines.filter((x) => x.c <= 1 / MIN_ODDS && x.c > winP).sort((a, b) => b.c - a.c)[0];
  const sets: Outcome | undefined = L && {
    id: 'sets', title: `${fav.name} gagne au moins ${L.need === 1 ? 'un set' : 'deux sets'}`, p: L.c, fair: 1 / L.c, ...setOdds(L.line),
    text: `Plus sûr que la victoire : ${fav.name} gagne le match, ou perd en prenant au moins ${L.need === 1 ? 'un set' : 'deux sets'} à ${dog.name}. Passe dans ${pct(L.c)} des simulations.`,
  };
  const need = r.bestOf === 5 ? 3 : 2;
  const straight: Outcome = {
    id: 'straight', title: `${fav.name} gagne ${need}-0`, p: r.sim.straight[i], fair: 1 / r.sim.straight[i], ...setOdds(-(need - 0.5)),
    text: `${fav.name} gagne sans perdre de set dans ${pct(r.sim.straight[i])} des simulations : cote plus haute, risque plus grand.`,
  };

  const hedgeFirst = !!sets && shown(winP) <= T_HEDGE_FIRST;
  if (hedgeFirst)
    return [
      { id: 'sets', label: L!.label, items: [sets!] },
      { id: 'win', label: 'Vainqueur', items: [{ ...win, warn: 'Déconseillé' }], warn: true },
    ];
  if (sets) return [{ id: 'win', label: 'Vainqueur', items: [win] }, { id: 'sets', label: L!.label, items: [{ ...sets, safe: 'Safe' }], good: true }];
  return [{ id: 'win', label: 'Vainqueur', items: [win] }, { id: 'straight', label: `${need}-0`, items: [straight] }];
}
