// Copie de src/foot/fairscore.ts (le site ne lit pas le dossier du moteur).
/**
 * Score exact « le plus juste » : pas le score le plus fréquent (presque toujours 1-0, 2-1 ou 1-1), mais celui qui colle
 * à la physionomie du match. On prend, dans les simulations où l'issue la plus probable se produit (victoire du favori,
 * ou nul s'il est devant), le nombre moyen de buts de chaque équipe, arrondi au-dessus à partir de ,6. Un match
 * ouvert donne 3-1 ou 2-2, un match fermé 1-0.
 */
export function fairScore(scores: Array<{ h: number; a: number; p: number }>, fin: { h: number; d: number; a: number }): { h: number; a: number; p: number } | undefined {
  const homeFav = fin.h >= fin.a, drawFirst = fin.d > Math.max(fin.h, fin.a);
  const ok = (x: { h: number; a: number }) => (drawFirst ? x.h === x.a : homeFav ? x.h > x.a : x.a > x.h);
  const S = scores.filter(ok), t = S.reduce((s, x) => s + x.p, 0);
  if (!t) return scores[0];
  const r = (v: number) => Math.floor(v + 0.4);
  const eh = S.reduce((s, x) => s + x.h * x.p, 0) / t, ea = S.reduce((s, x) => s + x.a * x.p, 0) / t;
  let h = r(eh), a = r(ea);
  if (drawFirst) h = a = r((eh + ea) / 2);
  else if (homeFav && h <= a) h = a + 1;
  else if (!homeFav && a <= h) a = h + 1;
  return scores.find((x) => x.h === h && x.a === a) ?? S[0];
}
