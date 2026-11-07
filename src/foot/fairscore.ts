/**
 * Score exact « le plus juste » : pas toujours le score le plus fréquent (sinon 1-0 et 2-1 partout, jamais de nul ni de
 * 3-1), mais le score qui colle à la physionomie de chaque match, avec sur une saison autant de 1-0, 1-1, 2-2, 3-1… qu'en
 * vrai. Chaque score possible du match (victoire du favori ou nul) reçoit sa probabilité multipliée par un poids par
 * score : poids réglés sur 3 569 matchs affichés de 2024 à 2026 pour que la répartition des scores affichés suive celle
 * des vrais résultats (réglé sur 2024-2025, vérifié sur 2025-2026 avec le garde-fou : 1-0 350 affichés pour 286 vrais,
 * 1-1 228 pour 204, 2-2 100 pour 94, 3-1 129 pour 133 ; 10,6 % de scores exacts trouvés).
 */
const W: Record<string, number> = { '1-0': 0.0, '2-1': 0.067, '2-0': 0.246, '1-1': -0.237, '3-1': 0.581, '3-0': 0.663, '2-2': 0.338, '0-0': 0.236, '3-2': 0.849, '4-0': 1.166, '4-1': 1.163, '4-2': 1.5, '5-1': 1.749, '3-3': 1.357, '5-0': 1.606, '4-3': 1.983, '5-2': 2.141 };
/** Garde-fou : le score affiché garde au moins 40 % de la probabilité du score le plus fréquent (pas de 5-2 à 2 %). */
const GUARD = 0.4;

/** `allow` : scores compatibles avec les pronostics mis en avant (le score retenu ne doit jamais les contredire). */
export function fairScore(scores: Array<{ h: number; a: number; p: number }>, fin: { h: number; d: number; a: number }, allow?: (h: number, a: number) => boolean): { h: number; a: number; p: number } | undefined {
  if (allow && scores.some((x) => x.p > 0 && allow(x.h, x.a))) {
    const ok = scores.filter((x) => allow(x.h, x.a));
    const r = fairScore(ok, fin);
    if (r && allow(r.h, r.a)) return r;
    return ok.sort((x, y) => y.p - x.p)[0];
  }
  const homeFav = fin.h >= fin.a;
  const side = (x: { h: number; a: number; p: number }) => x.p > 0 && !(homeFav ? x.a > x.h : x.h > x.a) && W[`${Math.max(x.h, x.a)}-${Math.min(x.h, x.a)}`] != null;
  const floor = GUARD * Math.max(0, ...scores.filter(side).map((x) => x.p));
  let best: { h: number; a: number; p: number } | undefined, bestV = -Infinity;
  for (const x of scores) {
    if (!side(x) || x.p < floor) continue;
    const v = Math.log(x.p) + W[`${Math.max(x.h, x.a)}-${Math.min(x.h, x.a)}`];
    if (v > bestV) (bestV = v), (best = x);
  }
  return best ?? scores[0];
}
