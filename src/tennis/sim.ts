// Simulation d'un match de tennis point par point, N fois. Chaque match tire une forme du jour (bruit en logit sur les
// points de service : +e pour A, -e pour B) : sans elle, les sets seraient indépendants et le favori « prendrait un set »
// bien plus souvent qu'en vrai (deux saisons ATP : 80,6 % annoncés, 77,2 % réels). L'ampleur 0,165 au point équivaut à
// 1,05 au set, la valeur qui reproduit les vrais taux « au moins un set / deux sets » (2024-2025).
// La force est calée pour que la victoire moyenne égale la probabilité visée (moteur + marché).
import { Rng } from '../core/rng.ts';
import { match as matchProb } from './score.ts';

export const FORM_SD = 0.165;

const Sg = (z: number) => 1 / (1 + Math.exp(-z));
const Lg = (p: number) => Math.log(p / (1 - p));
// Gauss-Hermite (forme du jour) : 24 points réguliers sur ±3,5 écarts-types, pondérés par la loi normale.
const NODES = (() => {
  const n = 24, xs: Array<[number, number]> = [];
  let t = 0;
  for (let i = 0; i < n; i++) { const z = -3.5 + (7 * (i + 0.5)) / n, w = Math.exp((-z * z) / 2); xs.push([z, w]); t += w; }
  return xs.map(([z, w]) => [z, w / t] as [number, number]);
})();

/** Victoire moyenne de A sur toutes les formes du jour. */
export function expectedWin(pA: number, pB: number, bestOf: 3 | 5, sd = FORM_SD): number {
  let e = 0;
  for (const [z, w] of NODES) e += w * matchProb(Sg(Lg(pA) + sd * z), Sg(Lg(pB) - sd * z), bestOf);
  return e;
}

/** Décale les points de service (+d pour A, -d pour B, en logit) pour que la victoire moyenne de A vaille `target`. */
export function calibrate(pA: number, pB: number, bestOf: 3 | 5, target: number, sd = FORM_SD): { pA: number; pB: number } {
  let lo = -3, hi = 3;
  for (let i = 0; i < 40; i++) {
    const d = (lo + hi) / 2;
    if (expectedWin(Sg(Lg(pA) + d), Sg(Lg(pB) - d), bestOf, sd) < target) lo = d;
    else hi = d;
  }
  const d = (lo + hi) / 2;
  return { pA: Sg(Lg(pA) + d), pB: Sg(Lg(pB) - d) };
}

export interface SimResult {
  n: number;
  pA: number; // points gagnés au service, après calage
  pB: number;
  win: number; // victoire de A
  firstSet: number; // A gagne le premier set
  scores: Record<string, number>; // scores en sets vus par A (« 2-0 », « 1-2 »…), en part des simulations
  atLeast1: [number, number]; // A, B gagnent au moins un set
  atLeast2: [number, number]; // au moins deux sets (3 sets gagnants)
  straight: [number, number]; // victoire sans perdre de set
  tiebreak: number; // au moins un jeu décisif
  games: { mean: number; p10: number; p50: number; p90: number }; // jeux joués
  gamesLadder: Array<{ line: number; pACover: number }>; // handicap en jeux : A couvre si jeux A + line > jeux B
}

/** Joue un match point par point ; renvoie les sets et les jeux de chacun. */
function play(rng: Rng, pa: number, pb: number, bestOf: 3 | 5): { sa: number; sb: number; ga: number; gb: number; tb: number; first: number } {
  const need = bestOf === 5 ? 3 : 2;
  let sa = 0, sb = 0, ga = 0, gb = 0, tb = 0, first = -1;
  let aServes = rng.next() < 0.5;
  while (sa < need && sb < need) {
    let a = 0, b = 0;
    const decisive = sa === need - 1 && sb === need - 1;
    for (;;) {
      if (a === 6 && b === 6) {
        // Jeu décisif à 7 points (10 dans le set décisif d'un Grand Chelem), services alternés tous les deux points.
        const to = decisive && bestOf === 5 ? 10 : 7;
        let x = 0, y = 0, k = 0;
        const startA = aServes;
        for (;;) {
          const srvA = Math.floor((k + 1) / 2) % 2 === 0 ? startA : !startA;
          const pw = srvA ? pa : 1 - pb;
          if (rng.next() < pw) x++;
          else y++;
          k++;
          if ((x >= to || y >= to) && Math.abs(x - y) >= 2) break;
        }
        if (x > y) a++;
        else b++;
        tb++;
        aServes = !startA; // le relanceur du premier point du jeu décisif sert le set suivant
        break;
      }
      const p = aServes ? pa : pb;
      let w = 0, l = 0;
      for (;;) {
        if (rng.next() < p) w++;
        else l++;
        if ((w >= 4 || l >= 4) && Math.abs(w - l) >= 2) break;
      }
      if ((w > l) === aServes) a++;
      else b++;
      aServes = !aServes;
      if ((a >= 6 || b >= 6) && Math.abs(a - b) >= 2) break;
    }
    ga += a; gb += b;
    if (a > b) sa++;
    else sb++;
    if (first < 0) first = a > b ? 1 : 0;
  }
  return { sa, sb, ga, gb, tb, first };
}

export function simulate(opts: { pA: number; pB: number; bestOf: 3 | 5; target?: number; n?: number; seed?: number; formSd?: number }): SimResult {
  const n = opts.n ?? 25000, sd = opts.formSd ?? FORM_SD;
  const { pA, pB } = opts.target != null ? calibrate(opts.pA, opts.pB, opts.bestOf, opts.target, sd) : { pA: opts.pA, pB: opts.pB };
  const rng = new Rng(opts.seed ?? 1);
  const scores: Record<string, number> = {};
  const games: number[] = [];
  const diff: number[] = [];
  let win = 0, first = 0, tbs = 0, a1 = 0, b1 = 0, a2 = 0, b2 = 0, aS = 0, bS = 0;
  for (let i = 0; i < n; i++) {
    const e = rng.normal(0, sd);
    const r = play(rng, Sg(Lg(pA) + e), Sg(Lg(pB) - e), opts.bestOf);
    const k = `${r.sa}-${r.sb}`;
    scores[k] = (scores[k] ?? 0) + 1;
    if (r.sa > r.sb) win++;
    first += r.first;
    if (r.tb) tbs++;
    if (r.sa >= 1) a1++;
    if (r.sb >= 1) b1++;
    if (r.sa >= 2) a2++;
    if (r.sb >= 2) b2++;
    if (r.sb === 0) aS++;
    if (r.sa === 0) bS++;
    games.push(r.ga + r.gb);
    diff.push(r.ga - r.gb);
  }
  games.sort((x, y) => x - y);
  const q = (f: number) => games[Math.min(n - 1, Math.floor(f * n))];
  const gamesLadder: SimResult['gamesLadder'] = [];
  for (let line = -15.5; line <= 15.5; line++) gamesLadder.push({ line, pACover: diff.filter((d) => d + line > 0).length / n });
  for (const k of Object.keys(scores)) scores[k] /= n;
  return {
    n, pA, pB, win: win / n, firstSet: first / n, scores, atLeast1: [a1 / n, b1 / n], atLeast2: [a2 / n, b2 / n], straight: [aS / n, bS / n],
    tiebreak: tbs / n, games: { mean: games.reduce((s, x) => s + x, 0) / n, p10: q(0.1), p50: q(0.5), p90: q(0.9) }, gamesLadder,
  };
}
