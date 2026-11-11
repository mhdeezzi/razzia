// Moteur live tennis : à n'importe quel moment (sets, jeux, points, serveur), chance de victoire de chaque joueur.
//
// Chaque joueur gagne ses points de service avec une probabilité tirée du niveau d'avant-match (calé sur la probabilité
// Razzia ou le marché). Le jour même, la forme varie : une part durable sur tout le match (forme du jour) et une part
// propre à chaque set (passage à vide, réveil). Ce que le match a déjà montré (scores des sets joués, jeux du set en cours,
// et si on les a : points gagnés au service et en retour) révise la forme du jour à la manière bayésienne ; la suite du
// match est ensuite calculée exactement (jeu, jeu décisif, set, match) en moyennant sur la forme possible.
// C'est ce qui donne le « facteur de remontée » : un set perdu 7-6 ne dit presque rien, un 6-1 dit beaucoup.
// Coefficients appris par src/cli/livetennis.ts sur 2024, contrôlés sur 2025-2026.

export interface TennisLiveParams {
  /** Forme du jour (logit des points de service, + pour A et - pour B) : écart-type a priori. */
  formSd: number;
  /** Variation propre à chaque set (logit), non durable. */
  setSd: number;
  /** Points de service gagnés en moyenne sur le circuit, par surface. */
  base: Record<string, number>;
  /** Poids d'un point observé dans la révision de la forme (par défaut : part durable de la forme). */
  pointW?: number;
  builtAt?: string;
}
export const DEFAULT_TENNIS: TennisLiveParams = { formSd: 0.165, setSd: 0.1, base: { Hard: 0.645, Clay: 0.625, Grass: 0.665, Carpet: 0.65 } };

export interface TennisState {
  bestOf: 3 | 5;
  /** Scores des sets terminés, en jeux : [jeux A, jeux B]. */
  sets: Array<[number, number]>;
  /** Set en cours : jeux de A et de B. */
  games?: [number, number];
  /** Jeu en cours : points de A et de B (0, 1, 2, 3, 4… ; dans un jeu décisif, points du jeu décisif). */
  points?: [number, number];
  /** Qui sert maintenant (0 : A, 1 : B). Inconnu : moyenne des deux. */
  server?: 0 | 1;
  /** Points gagnés au service depuis le début du match, si connus : [gagnés, joués] pour A puis pour B. */
  servePts?: [[number, number], [number, number]];
  /** Points au service joués dans le set en cours seulement : ils révisent la variation propre à ce set (passage à vide en
   * cours, réveil), qui ne durera pas au set suivant. */
  curSetPts?: [[number, number], [number, number]];
  /** Set décisif joué avec un super jeu décisif à 10 points (Grand Chelem depuis 2022) : true par défaut en 5 sets. */
  superTb?: boolean;
}

const Sg = (z: number) => 1 / (1 + Math.exp(-z));
const Lg = (p: number) => Math.log(p / (1 - p));
const nodes = (n: number, span: number) => {
  const xs: Array<[number, number]> = [];
  let t = 0;
  for (let i = 0; i < n; i++) { const z = -span + (2 * span * (i + 0.5)) / n, w = Math.exp((-z * z) / 2); xs.push([z, w]); t += w; }
  return xs.map(([z, w]) => [z, w / t] as [number, number]);
};
const N_FORM = nodes(17, 3.2), N_SET = nodes(5, 2.4);

/** Le serveur gagne le jeu, depuis un score en points (a pour le serveur, b pour le relanceur). */
export function holdFrom(p: number, a = 0, b = 0): number {
  const q = 1 - p;
  // Égalité ou avantage : à partir de 3-3, se ramène à deux points d'écart.
  const deuce = (p * p) / (p * p + q * q);
  const memo = new Map<number, number>();
  const go = (x: number, y: number): number => {
    if (x >= 4 && x - y >= 2) return 1;
    if (y >= 4 && y - x >= 2) return 0;
    if (x >= 3 && y >= 3) { if (x === y) return deuce; return x > y ? p + q * deuce : p * deuce; }
    const k = x * 16 + y;
    const c = memo.get(k);
    if (c != null) return c;
    const v = p * go(x + 1, y) + q * go(x, y + 1);
    memo.set(k, v);
    return v;
  };
  return go(a, b);
}

/** A gagne un jeu décisif à `to` points depuis (a, b) ; `aFirst` : A a servi le premier point du jeu décisif. */
export function tbFrom(pA: number, pB: number, to: number, a = 0, b = 0, aFirst = true): number {
  const aServes = (n: number) => { const first = n === 0 || Math.floor((n + 1) / 2) % 2 === 0; return aFirst ? first : !first; };
  const win = (n: number) => (aServes(n) ? pA : 1 - pB);
  const memo = new Map<number, number>();
  const go = (x: number, y: number): number => {
    if (x >= to && x - y >= 2) return 1;
    if (y >= to && y - x >= 2) return 0;
    const n = x + y;
    if (x >= to - 1 && y >= to - 1 && x === y) {
      // Égalité : deux points (un service chacun) jusqu'à deux points d'écart.
      const w1 = win(n), w2 = win(n + 1), both = w1 * w2, none = (1 - w1) * (1 - w2);
      return both / (both + none);
    }
    const k = x * 64 + y;
    const c = memo.get(k);
    if (c != null) return c;
    const w = win(n);
    const v = w * go(x + 1, y) + (1 - w) * go(x, y + 1);
    memo.set(k, v);
    return v;
  };
  return go(a, b);
}

/** A gagne le set depuis (ga, gb) jeux, `aServes` : A sert le jeu en cours ; points du jeu en cours (vus du serveur). */
export function setFrom(pA: number, pB: number, ga: number, gb: number, aServes: boolean, tb: number, pts?: [number, number]): number {
  const hA = holdFrom(pA), hB = holdFrom(pB);
  const memo = new Map<number, number>();
  const go = (a: number, b: number, aSrv: boolean, first: boolean): number => {
    if ((a >= 6 && a - b >= 2) || a === 7) return 1;
    if ((b >= 6 && b - a >= 2) || b === 7) return 0;
    if (a === 6 && b === 6) {
      // Jeu décisif : le joueur qui doit servir le 13e jeu sert le premier point.
      if (first && pts) return tbFrom(pA, pB, tb, pts[0], pts[1], aSrv);
      return tbFrom(pA, pB, tb, 0, 0, aSrv);
    }
    const k = a * 32 + b * 2 + (aSrv ? 1 : 0);
    if (!first) { const c = memo.get(k); if (c != null) return c; }
    // Jeu en cours : points vus du joueur A ; holdFrom prend (serveur, relanceur).
    let w: number;
    if (first && pts) w = aSrv ? holdFrom(pA, pts[0], pts[1]) : 1 - holdFrom(pB, pts[1], pts[0]);
    else w = aSrv ? hA : 1 - hB;
    const v = w * go(a + 1, b, !aSrv, false) + (1 - w) * go(a, b + 1, !aSrv, false);
    if (!first) memo.set(k, v);
    return v;
  };
  return go(ga, gb, aServes, true);
}

/** Jeu décisif depuis 0-0, en tableaux (appelé des milliers de fois). */
function tbFast(pA: number, pB: number, to: number, aFirst: boolean): number {
  const W = to + 1, P = new Float64Array(W * W);
  P[0] = 1;
  let total = 0;
  const win = (n: number) => { const f = n === 0 || Math.floor((n + 1) / 2) % 2 === 0; return (aFirst ? f : !f) ? pA : 1 - pB; };
  for (let n = 0; n < 2 * to - 2; n++) {
    for (let a = 0; a <= n; a++) {
      const b = n - a;
      if (a >= to || b >= to) continue;
      const pr = P[a * W + b];
      if (!pr) continue;
      const w = win(n);
      if (a + 1 === to) total += pr * w; else P[(a + 1) * W + b] += pr * w;
      if (b + 1 < to) P[a * W + b + 1] += pr * (1 - w);
    }
  }
  const tie = P[(to - 1) * W + (to - 1)];
  const n0 = 2 * to - 2, w1 = win(n0), w2 = win(n0 + 1), both = w1 * w2, none = (1 - w1) * (1 - w2);
  return total + tie * (both / (both + none));
}
/** Set depuis 0-0, en tableaux. */
function setFast(pA: number, pB: number, aFirst: boolean, tb: number): number {
  const hA = holdFrom(pA), hB = holdFrom(pB);
  const P = new Float64Array(64);
  P[0] = 1;
  let total = 0;
  for (let n = 0; n < 12; n++) {
    for (let a = 0; a <= n; a++) {
      const b = n - a;
      if (a > 7 || b > 7) continue;
      const pr = P[a * 8 + b];
      if (!pr) continue;
      if ((a === 6 && b <= 4) || (b === 6 && a <= 4) || a === 7 || b === 7) continue;
      const aSrv = (n % 2 === 0) === aFirst;
      const w = aSrv ? hA : 1 - hB;
      const na = a + 1, nb = b + 1;
      if ((na === 6 && b <= 4) || (na === 7 && b === 5)) total += pr * w;
      else P[na * 8 + b] += pr * w;
      if (!((nb === 6 && a <= 4) || (nb === 7 && a === 5))) P[a * 8 + nb] += pr * (1 - w);
    }
  }
  // 12 jeux joués : le premier serveur du set sert le premier point du jeu décisif.
  return total + P[6 * 8 + 6] * tbFast(pA, pB, tb, aFirst);
}

/** Probabilité exacte de chaque score de set (A sert le premier jeu) : clé « 6-4 », « 7-6 »… */
export function setScoreDist(pA: number, pB: number, tb: number): Map<string, number> {
  const hA = holdFrom(pA), hB = holdFrom(pB);
  const out = new Map<string, number>();
  const P = new Float64Array(8 * 8);
  P[0] = 1;
  for (let n = 0; n < 12; n++) {
    for (let a = 0; a <= n; a++) {
      const b = n - a;
      if (a > 7 || b > 7) continue;
      const pr = P[a * 8 + b];
      if (!pr) continue;
      if ((a >= 6 && a - b >= 2) || (b >= 6 && b - a >= 2)) continue;
      const w = n % 2 === 0 ? hA : 1 - hB;
      const add = (x: number, y: number, v: number) => {
        if ((x >= 6 && x - y >= 2) || (y >= 6 && y - x >= 2)) out.set(`${x}-${y}`, (out.get(`${x}-${y}`) ?? 0) + v);
        else P[x * 8 + y] += v;
      };
      add(a + 1, b, pr * w);
      add(a, b + 1, pr * (1 - w));
    }
  }
  const t = P[6 * 8 + 6];
  if (t) { const w = tbFast(pA, pB, tb, true); out.set('7-6', (out.get('7-6') ?? 0) + t * w); out.set('6-7', (out.get('6-7') ?? 0) + t * (1 - w)); }
  return out;
}

/** Série de sets : A gagne le match depuis (sa, sb), chaque set gagné avec `s`, le décisif avec `last`. */
function series(s: number, last: number, need: number, sa: number, sb: number): number {
  const memo = new Map<number, number>();
  const go = (i: number, j: number): number => {
    if (i === need) return 1;
    if (j === need) return 0;
    const k = i * 8 + j;
    const c = memo.get(k);
    if (c != null) return c;
    const x = i === need - 1 && j === need - 1 ? last : s;
    const v = x * go(i + 1, j) + (1 - x) * go(i, j + 1);
    memo.set(k, v);
    return v;
  };
  return go(sa, sb);
}

/** A gagne le match depuis l'état, à forme fixée (pA, pB), en moyennant la variation propre à chaque set à venir. */
function winFrom(P: TennisLiveParams, pA: number, pB: number, st: TennisState, aServesNow: boolean): number {
  const need = st.bestOf === 5 ? 3 : 2;
  let sa = 0, sb = 0;
  for (const [a, b] of st.sets) { if (a > b) sa++; else sb++; }
  if (sa >= need) return 1;
  if (sb >= need) return 0;
  const decisiveNow = sa === need - 1 && sb === need - 1;
  const superTb = st.superTb ?? st.bestOf === 5;
  const tbNow = decisiveNow && superTb ? 10 : 7;
  // Sets à venir (hors set en cours) : variation propre moyennée, serveur du premier jeu moyenné.
  let s = 0, last = 0;
  for (const [z, w] of P.setSd ? N_SET : [[0, 1] as [number, number]]) {
    const a = Sg(Lg(pA) + P.setSd * z), b = Sg(Lg(pB) - P.setSd * z);
    const s7 = (setFast(a, b, true, 7) + setFast(a, b, false, 7)) / 2;
    s += w * s7;
    last += w * (superTb ? (setFast(a, b, true, 10) + setFast(a, b, false, 10)) / 2 : s7);
  }
  const g = st.games ?? [0, 0];
  if (!st.games && !st.points) return series(s, last, need, sa, sb);
  // Set en cours : sa propre variation, révisée par les points déjà joués dans ce set quand on les a.
  let cur = 0, tw = 0;
  const cp = st.curSetPts;
  for (const [z, w0] of P.setSd ? N_SET : [[0, 1] as [number, number]]) {
    const a = Sg(Lg(pA) + P.setSd * z), b = Sg(Lg(pB) - P.setSd * z);
    const w = cp ? w0 * Math.exp(cp[0][0] * Math.log(a) + (cp[0][1] - cp[0][0]) * Math.log(1 - a) + cp[1][0] * Math.log(b) + (cp[1][1] - cp[1][0]) * Math.log(1 - b)) : w0;
    cur += w * setFrom(a, b, g[0], g[1], aServesNow, tbNow, st.points);
    tw += w;
  }
  cur = tw > 0 ? cur / tw : cur;
  return cur * series(s, last, need, sa + 1, sb) + (1 - cur) * series(s, last, need, sa, sb + 1);
}

/** Vraisemblance de ce qu'on a vu, à forme fixée : scores des sets joués (serveur du 1er jeu du match inconnu). */
function likelihood(P: TennisLiveParams, pA: number, pB: number, st: TennisState): number {
  // Points au service connus : ils contiennent tout ce que disent les scores des sets (inutile de compter deux fois). Une
  // partie de l'écart observé est propre au set (passage à vide) et ne dure pas : les points comptent pour la part durable
  // de la forme, formSd² / (formSd² + setSd²), sauf réglage appris (pointW).
  if (st.servePts && st.servePts[0][1] + st.servePts[1][1] >= 8) {
    const k = P.pointW ?? P.formSd ** 2 / (P.formSd ** 2 + P.setSd ** 2);
    const [[wa, na], [wb, nb]] = st.servePts;
    return Math.exp(k * (wa * Math.log(pA) + (na - wa) * Math.log(1 - pA) + wb * Math.log(pB) + (nb - wb) * Math.log(1 - pB)));
  }
  let total = 0;
  for (const aFirst of [true, false]) {
    let lik = 1, aSrv = aFirst;
    const need = st.bestOf === 5 ? 3 : 2;
    let sa = 0, sb = 0;
    for (const [a, b] of st.sets) {
      const tb = sa === need - 1 && sb === need - 1 && (st.superTb ?? st.bestOf === 5) ? 10 : 7;
      // Variation propre au set : moyennée.
      let l = 0;
      for (const [z, w] of P.setSd ? N_SET : [[0, 1] as [number, number]]) {
        const x = Sg(Lg(pA) + P.setSd * z), y = Sg(Lg(pB) - P.setSd * z);
        const d = aSrv ? setScoreDist(x, y, tb) : setScoreDist(y, x, tb);
        l += w * (aSrv ? d.get(`${a}-${b}`) ?? 0 : d.get(`${b}-${a}`) ?? 0);
      }
      lik *= Math.max(1e-12, l);
      if ((a + b) % 2 === 1) aSrv = !aSrv;
      if (a > b) sa++; else sb++;
    }
    total += 0.5 * lik;
  }
  // Points au service, si on les a (loi binomiale, sans la constante).
  if (st.servePts) {
    const [[wa, na], [wb, nb]] = st.servePts;
    total *= Math.exp(wa * Math.log(pA) + (na - wa) * Math.log(1 - pA) + wb * Math.log(pB) + (nb - wb) * Math.log(1 - pB));
  }
  return total;
}

/** Points de service de base (A, B) qui donnent la probabilité d'avant-match `p0`, forme du jour moyennée. */
export function calibrateTennis(P: TennisLiveParams, p0: number, surface: string, bestOf: 3 | 5): [number, number] {
  const base = P.base[surface] ?? 0.645;
  const st: TennisState = { bestOf, sets: [] };
  let lo = -2.5, hi = 2.5;
  for (let it = 0; it < 22; it++) {
    const d = (lo + hi) / 2;
    let w = 0;
    for (const [z, wt] of N_FORM) w += wt * winFrom(P, Sg(Lg(base) + d + P.formSd * z), Sg(Lg(base) - d - P.formSd * z), st, true);
    if (w < p0) lo = d; else hi = d;
  }
  const d = (lo + hi) / 2;
  return [Sg(Lg(base) + d), Sg(Lg(base) - d)];
}

export interface TennisLiveOut {
  /** Victoire de A, de B. */
  win: [number, number];
  /** Forme du jour estimée (logit, + : A au-dessus de son niveau), et son incertitude. */
  form: { mean: number; sd: number };
  /** Joueur mené en sets (ou au set en cours si égalité) : chance de gagner quand même. */
  comeback?: { side: 0 | 1; win: number };
  /** A gagne le set en cours (si un set est commencé). */
  setNow?: number;
  /** Le serveur tient le jeu en cours (si on sait qui sert) : avant le point, l'avertissement « break possible ». */
  holdNow?: number;
}

/** Pronostic depuis l'état du match ; (pA, pB) : points de service de base calés avant le match. */
export function tennisLive(P: TennisLiveParams, base: [number, number], st: TennisState): TennisLiveOut {
  const post: Array<[number, number]> = [];
  let tot = 0;
  for (const [z, w] of N_FORM) {
    const e = P.formSd * z;
    const pA = Sg(Lg(base[0]) + e), pB = Sg(Lg(base[1]) - e);
    const l = w * (st.sets.length || st.servePts ? likelihood(P, pA, pB, st) : 1);
    post.push([e, l]);
    tot += l;
  }
  let win = 0, m = 0, m2 = 0, setNow = 0;
  for (const [e, l] of post) {
    const q = l / tot;
    const pA = Sg(Lg(base[0]) + e), pB = Sg(Lg(base[1]) - e);
    const srv = st.server;
    const w = srv == null ? (winFrom(P, pA, pB, st, true) + winFrom(P, pA, pB, st, false)) / 2 : winFrom(P, pA, pB, st, srv === 0);
    win += q * w;
    m += q * e; m2 += q * e * e;
    if (st.games || st.points) {
      const g = st.games ?? [0, 0];
      setNow += q * (srv == null ? (setFrom(pA, pB, g[0], g[1], true, 7, st.points) + setFrom(pA, pB, g[0], g[1], false, 7, st.points)) / 2 : setFrom(pA, pB, g[0], g[1], srv === 0, 7, st.points));
    }
  }
  const out: TennisLiveOut = { win: [win, 1 - win], form: { mean: m, sd: Math.sqrt(Math.max(0, m2 - m * m)) } };
  let sa = 0, sb = 0;
  for (const [a, b] of st.sets) { if (a > b) sa++; else sb++; }
  const g = st.games ?? [0, 0];
  if (sa !== sb || g[0] !== g[1]) {
    const side: 0 | 1 = sa > sb || (sa === sb && g[0] > g[1]) ? 1 : 0;
    out.comeback = { side, win: side === 0 ? win : 1 - win };
  }
  if (st.games || st.points) out.setNow = setNow;
  if (st.server != null) {
    let h = 0;
    for (const [e, l] of post) {
      const pS = st.server === 0 ? Sg(Lg(base[0]) + e) : Sg(Lg(base[1]) - e);
      const pts = st.points ?? [0, 0];
      h += (l / tot) * holdFrom(pS, st.server === 0 ? pts[0] : pts[1], st.server === 0 ? pts[1] : pts[0]);
    }
    out.holdNow = h;
  }
  return out;
}
