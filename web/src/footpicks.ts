// Catégories de pronostics du foot, partagées par la fiche (foot.tsx) et le bilan (src/cli/footbilan.ts) : le bilan
// compte exactement le premier onglet affiché (orderCats). La fiche ajoute seulement l'habillage (logos, couleurs).
import { fairScore } from './fairscore.ts';
import type { Category, Outcome } from './picks.ts';
import type { FootResult } from './foot.tsx';

/** Vainqueur seul : déconseillé sous 60 %, risqué de 60 à 70 % (pastilles rouge et orange, comme au basket et au tennis). */
export const WIN_FLIP = 0.6, WIN_RISKY = 0.7;
export const LDEM_MIN = 0.65;
export const BIG_FAV_ODDS = 1.25;

export interface FootDeco {
  /** Habillage d'un pari (logo, marbre) ; `id` est l'identifiant du marché. */
  item?: (id: string, out: Outcome) => Outcome;
  /** Habillage du score exact. */
  exact?: (sc: { h: number; a: number; p: number }, out: Outcome) => Outcome;
}

/** Catégories de paris : combiné, vainqueur, double chance, score exact, LDEM (l'ordre affiché vient d'orderCats). */
export function footCategories(r: FootResult, deco: FootDeco = {}): Category[] {
  const P = r.probs, L = r.labels;
  const o = r.market?.odds;
  const homeFav = r.final.h >= r.final.a;
  const nv = o ? (() => { const s = 1 / o.h + 1 / o.d + 1 / o.a; return { '1': 1 / o.h / s, X: 1 / o.d / s, '2': 1 / o.a / s } as Record<string, number>; })() : undefined;
  const oddsOf: Record<string, number | undefined> = { '1': o?.h, X: o?.d, '2': o?.a, 'o2.5': o?.over25, 'u2.5': o?.under25 };
  const item = (id: string): Outcome | undefined => {
    const p = P[id];
    if (p == null || !L[id]) return undefined;
    let out: Outcome = { id, title: L[id], p, fair: p > 0 ? 1 / p : undefined, odds: oddsOf[id], implied: nv?.[id] };
    if (deco.item) out = deco.item(id, out);
    if (r.pick?.id === id) if (r.tier === 'sure') out.safe = 'Razzia assuré';
    if (r.combo.id === id) {
      if (r.combo.risky) out.warn = 'Risqué';
      else if (!out.safe) out.safe = 'Combiné rattaché';
    }
    return out;
  };
  const list = (ids: string[]) => ids.map(item).filter((x): x is Outcome => !!x);
  // Un seul choix par catégorie, celui qui tombe le plus souvent.
  const top = (ids: string[]) => ids.reduce((a, b) => ((P[b] ?? 0) > (P[a] ?? 0) ? b : a));
  const winner = list([top(homeFav ? ['1', '2', 'X'] : ['2', '1', 'X'])]);
  const wp = winner[0]?.p ?? 0;
  const winWarn = wp < WIN_FLIP ? 'Déconseillé' : wp < WIN_RISKY ? 'Risqué' : undefined;
  if (winner[0] && winWarn && !winner[0].warn) winner[0] = { ...winner[0], warn: winWarn, safe: undefined };
  const double = list([top(['1X', 'X2', '12'])]);
  const combos = list([r.combo.id]);
  // Gros favori (cote de la victoire sous 1,25, ou 80 % sans cote) : pas de double chance.
  const favOdds = o ? (homeFav ? o.h : o.a) : undefined;
  const bigFav = favOdds != null ? favOdds < BIG_FAV_ODDS : (homeFav ? r.final.h : r.final.a) >= 0.8;
  const cats: Category[] = [
    { id: 'combo', label: 'Combiné', items: combos, risky: r.combo.risky },
    { id: 'win', label: 'Vainqueur', items: winner, warn: winWarn === 'Déconseillé', risky: winWarn === 'Risqué' },
    ...(bigFav ? [] : [{ id: 'double', label: 'Double chance', items: double }]),
  ];
  // Score exact : le plus juste, pas le plus prudent ; toujours « Déconseillé ».
  const sc = fairScore(r.scores, r.final);
  if (sc) {
    let out: Outcome = { id: `exact-${sc.h}-${sc.a}`, title: `${r.home.name} ${sc.h}-${sc.a} ${r.away.name}`, p: sc.p, fair: 1 / sc.p, warn: 'Déconseillé', text: 'Le score qui colle le mieux à la physionomie du match (buts attendus de chaque équipe), pas le plus prudent.' };
    if (deco.exact) out = deco.exact(sc, out);
    cats.push({ id: 'exact', label: 'Score exact', warn: true, items: [out] });
  }
  // LDEM (les deux équipes marquent) : seulement à plus de 65 %.
  if ((P.btts ?? 0) > LDEM_MIN) cats.push({ id: 'btts', label: 'LDEM', items: list(['btts']) });
  return cats.filter((c) => c.items.length);
}
