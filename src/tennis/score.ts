// Probabilités exactes du tennis à partir des points gagnés au service (points indépendants) : jeu, tie-break, set,
// match. Sert à caler la force des joueurs avant la simulation et à lire vite une prévision.
//   pA, pB : probabilité que A (resp. B) gagne un point sur son propre service.

/** A tient son service (jeu classique, avantage). */
export function hold(p: number): number {
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q) + (20 * p ** 3 * q ** 3 * p * p) / (1 - 2 * p * q);
}

/**
 * A gagne un tie-break à `to` points (7, ou 10 pour le super tie-break), A sert le premier point, puis les services
 * alternent tous les deux points. Récurrence exacte jusqu'à l'égalité, puis série géométrique (deux points d'écart).
 */
export function tiebreak(pA: number, pB: number, to = 7): number {
  // A sert au point n (0, 1, 2…) si n = 0 ou si (n + 1) / 2 est pair : 0 A, 1-2 B, 3-4 A, 5-6 B…
  const aServes = (n: number) => n === 0 || Math.floor((n + 1) / 2) % 2 === 0;
  const win = (n: number) => (aServes(n) ? pA : 1 - pB);
  const P = new Map<string, number>([['0,0', 1]]);
  let total = 0;
  for (let n = 0; n < 2 * to; n++) {
    for (let a = 0; a <= n; a++) {
      const b = n - a, pr = P.get(`${a},${b}`);
      if (!pr || a >= to || b >= to) continue;
      if (a === to - 1 && b === to - 1) continue; // égalité : traitée à part
      const w = win(n);
      if (a + 1 === to && b <= to - 2) total += pr * w;
      else P.set(`${a + 1},${b}`, (P.get(`${a + 1},${b}`) ?? 0) + pr * w);
      if (b + 1 < to || a === to - 1) P.set(`${a},${b + 1}`, (P.get(`${a},${b + 1}`) ?? 0) + pr * (1 - w));
    }
  }
  // Égalité (to-1, to-1) : deux points, un service chacun, jusqu'à prendre deux points d'avance.
  const tie = P.get(`${to - 1},${to - 1}`) ?? 0;
  const n0 = 2 * to - 2, w1 = win(n0), w2 = win(n0 + 1);
  const both = w1 * w2, none = (1 - w1) * (1 - w2);
  return total + tie * (both / (both + none));
}

/** A gagne un set (jeu décisif à 6-6, à `tb` points ; A sert le premier jeu). */
export function set(pA: number, pB: number, tb = 7): number {
  const hA = hold(pA), hB = hold(pB);
  const P = new Map<string, number>([['0,0', 1]]);
  let total = 0;
  for (let n = 0; n < 12; n++) {
    for (let a = 0; a <= n; a++) {
      const b = n - a, pr = P.get(`${a},${b}`);
      if (!pr) continue;
      if ((a === 6 && b <= 4) || (b === 6 && a <= 4) || a === 7 || b === 7) continue;
      const w = n % 2 === 0 ? hA : 1 - hB; // A sert les jeux pairs
      const na = a + 1, nb = b + 1;
      if ((na === 6 && b <= 4) || (na === 7 && b === 5)) total += pr * w;
      else P.set(`${na},${b}`, (P.get(`${na},${b}`) ?? 0) + pr * w);
      if (!((nb === 6 && a <= 4) || (nb === 7 && a === 5))) P.set(`${a},${nb}`, (P.get(`${a},${nb}`) ?? 0) + pr * (1 - w));
    }
  }
  return total + (P.get('6,6') ?? 0) * tiebreak(pA, pB, tb);
}

/** A gagne le match en 2 ou 3 sets gagnants ; set décisif avec super tie-break à 10 points en Grand Chelem. */
export function match(pA: number, pB: number, bestOf: 3 | 5): number {
  // Le serveur du premier jeu de chaque set dépend du set d'avant : la moyenne des deux ordres suffit ici.
  const s = (set(pA, pB) + 1 - set(pB, pA)) / 2;
  const last = bestOf === 5 ? (set(pA, pB, 10) + 1 - set(pB, pA, 10)) / 2 : s;
  return seriesWin(s, last, bestOf);
}

/** Probabilité de gagner une série de sets (sets indépendants, le dernier set peut avoir sa propre probabilité). */
export function seriesWin(s: number, last: number, bestOf: 3 | 5): number {
  const need = bestOf === 5 ? 3 : 2;
  // Avant le set décisif : scores (i, j) avec i, j < need.
  let p = 0;
  const memo = new Map<string, number>();
  const go = (i: number, j: number): number => {
    if (i === need) return 1;
    if (j === need) return 0;
    const k = `${i},${j}`;
    if (memo.has(k)) return memo.get(k)!;
    const decisive = i === need - 1 && j === need - 1;
    const x = decisive ? last : s;
    const v = x * go(i + 1, j) + (1 - x) * go(i, j + 1);
    memo.set(k, v);
    return v;
  };
  p = go(0, 0);
  return p;
}

/**
 * Probabilités des scores en sets (indépendants) pour le joueur qui gagne chaque set avec `s` : au moins un set, au moins
 * deux sets, victoire sans perdre de set.
 */
export function setOutcomes(s: number, last: number, bestOf: 3 | 5): { win: number; atLeast1: number; atLeast2: number; straight: number } {
  const need = bestOf === 5 ? 3 : 2;
  const dist = new Map<string, number>();
  const go = (i: number, j: number, pr: number) => {
    if (i === need || j === need) { dist.set(`${i}-${j}`, (dist.get(`${i}-${j}`) ?? 0) + pr); return; }
    const x = i === need - 1 && j === need - 1 ? last : s;
    go(i + 1, j, pr * x);
    go(i, j + 1, pr * (1 - x));
  };
  go(0, 0, 1);
  let win = 0, atLeast1 = 0, atLeast2 = 0;
  for (const [k, v] of dist) {
    const [i, j] = k.split('-').map(Number);
    if (i === need) win += v;
    if (i >= 1) atLeast1 += v;
    if (i >= 2) atLeast2 += v;
  }
  return { win, atLeast1, atLeast2, straight: dist.get(`${need}-0`) ?? 0 };
}
