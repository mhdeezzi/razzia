// Simulation d'un match de tennis point par point, N fois. Chaque match tire une forme du jour (bruit en logit sur les
// points de service : +e pour A, -e pour B) : sans elle, les sets seraient indépendants et le favori « prendrait un set »
// bien plus souvent qu'en vrai (deux saisons ATP : 80,6 % annoncés, 77,2 % réels). L'ampleur 0,165 au point équivaut à
// 1,05 au set, la valeur qui reproduit les vrais taux « au moins un set / deux sets » (2024-2025).
// La force est calée pour que la victoire moyenne égale la probabilité visée (moteur + marché).
import { Rng } from '../core/rng.ts';
import { hold, match as matchProb, seriesWin, set as setProb, tiebreak } from './score.ts';
void setProb;

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

// Variation de forme d'un set à l'autre (logit des points de service, en plus de la forme du jour) : un joueur traverse un
// set sans réussite puis se reprend. Réglable ; 0 par défaut (comportement d'avant).
export let SET_SD = 0;
// Correction de l'outsider qui prend un set (logit, au sommet vers 85 % de favori) : circuit en 3 sets, Grand Chelem.
const DOG_SET_BO3 = 0.39, DOG_SET_BO5 = 0.27;
export function setSetSd(v: number): void { SET_SD = v; }
const NODES12 = (() => {
  const n = 12, xs: Array<[number, number]> = [];
  let t = 0;
  for (let i = 0; i < n; i++) { const z = -3 + (6 * (i + 0.5)) / n, w = Math.exp((-z * z) / 2); xs.push([z, w]); t += w; }
  return xs.map(([z, w]) => [z, w / t] as [number, number]);
})();
/** Set gagné par A (A sert le premier jeu), en tableaux plutôt qu'en dictionnaire : appelé des milliers de fois au calage. */
function setFast(pA: number, pB: number, tb = 7): number {
  const hA = hold(pA), hB = hold(pB);
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
      const w = n % 2 === 0 ? hA : 1 - hB;
      const na = a + 1, nb = b + 1;
      if ((na === 6 && b <= 4) || (na === 7 && b === 5)) total += pr * w;
      else P[na * 8 + b] += pr * w;
      if (!((nb === 6 && a <= 4) || (nb === 7 && a === 5))) P[a * 8 + nb] += pr * (1 - w);
    }
  }
  return total + P[6 * 8 + 6] * tiebreak(pA, pB, tb);
}

/** Match gagné par A, chaque set ayant sa propre variation de forme (sets indépendants à forme du jour donnée). */
function matchWithSetNoise(pa: number, pb: number, bestOf: 3 | 5, ss: number): number {
  if (!ss) return matchProb(pa, pb, bestOf);
  let s = 0, last = 0;
  for (const [z, w] of NODES12) {
    const a = Sg(Lg(pa) + ss * z), b = Sg(Lg(pb) - ss * z);
    const sx = (setFast(a, b) + 1 - setFast(b, a)) / 2;
    s += w * sx;
    last += w * (bestOf === 5 ? (setFast(a, b, 10) + 1 - setFast(b, a, 10)) / 2 : sx);
  }
  return seriesWin(s, last, bestOf);
}

/** Victoire moyenne de A sur toutes les formes du jour. */
export function expectedWin(pA: number, pB: number, bestOf: 3 | 5, sd = FORM_SD): number {
  let e = 0;
  for (const [z, w] of NODES) e += w * matchWithSetNoise(Sg(Lg(pA) + sd * z), Sg(Lg(pB) - sd * z), bestOf, SET_SD);
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
  typical: TypicalMatch;
}

/** Jeu du match typique : set (0, 1…), jeux dans le set après ce jeu, serveur (0 : A), break, chance de victoire de A. */
export interface TypicalGame { s: number; a: number; b: number; srv: 0 | 1; brk?: 1; tb?: [number, number]; wp: number }
export interface TypicalMatch {
  index: number;
  winner: 'A' | 'B';
  sets: Array<[number, number]>; // jeux de A et de B dans chaque set
  games: TypicalGame[];
  wp0: number; // chance de victoire de A avant le premier point
  stats: Array<{ srvPts: number; srvWon: number; pts: number; bp: number; bpWon: number }>; // A puis B
}

/** Journal d'un match rejoué : jeux, points au service, balles de break. */
interface Log {
  games: Array<Omit<TypicalGame, 'wp'>>;
  srvPts: [number, number];
  srvWon: [number, number];
  bp: [number, number]; // balles de break obtenues (en retour)
  bpWon: [number, number];
}

/** Joue un match point par point ; renvoie les sets et les jeux de chacun. */
function play(rng: Rng, pa: number, pb: number, bestOf: 3 | 5, log?: Log): { sa: number; sb: number; ga: number; gb: number; tb: number; first: number } {
  const need = bestOf === 5 ? 3 : 2;
  let sa = 0, sb = 0, ga = 0, gb = 0, tb = 0, first = -1;
  let aServes = rng.next() < 0.5;
  const pa0 = pa, pb0 = pb;
  while (sa < need && sb < need) {
    let a = 0, b = 0;
    const decisive = sa === need - 1 && sb === need - 1;
    if (SET_SD) {
      const e = rng.normal(0, SET_SD);
      pa = Sg(Lg(pa0) + e);
      pb = Sg(Lg(pb0) - e);
    }
    for (;;) {
      if (a === 6 && b === 6) {
        // Jeu décisif à 7 points (10 dans le set décisif d'un Grand Chelem), services alternés tous les deux points.
        const to = decisive && bestOf === 5 ? 10 : 7;
        let x = 0, y = 0, k = 0;
        const startA = aServes;
        for (;;) {
          const srvA = Math.floor((k + 1) / 2) % 2 === 0 ? startA : !startA;
          const pw = srvA ? pa : 1 - pb;
          const won = rng.next() < pw;
          if (won) x++;
          else y++;
          if (log) { const sv = srvA ? 0 : 1; log.srvPts[sv]++; if (won === srvA) log.srvWon[sv]++; }
          k++;
          if ((x >= to || y >= to) && Math.abs(x - y) >= 2) break;
        }
        if (x > y) a++;
        else b++;
        tb++;
        log?.games.push({ s: sa + sb, a, b, srv: startA ? 0 : 1, tb: [x, y] });
        aServes = !startA; // le relanceur du premier point du jeu décisif sert le set suivant
        break;
      }
      const p = aServes ? pa : pb;
      let w = 0, l = 0;
      const sv = aServes ? 0 : 1;
      for (;;) {
        // Balle de break : le relanceur gagne le jeu s'il gagne ce point.
        const bp = l >= 3 && l > w;
        if (log && bp) log.bp[1 - sv]++;
        const won = rng.next() < p;
        if (won) w++;
        else l++;
        if (log) { log.srvPts[sv]++; if (won) log.srvWon[sv]++; if (bp && !won) log.bpWon[1 - sv]++; }
        if ((w >= 4 || l >= 4) && Math.abs(w - l) >= 2) break;
      }
      if ((w > l) === aServes) a++;
      else b++;
      log?.games.push({ s: sa + sb, a, b, srv: sv, ...(w < l ? { brk: 1 as const } : {}) });
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
  const seed = opts.seed ?? 1;
  const scores: Record<string, number> = {};
  const games: number[] = [];
  const diff: number[] = [];
  const setsA = new Int8Array(n), setsB = new Int8Array(n), tbA = new Int8Array(n), form = new Float32Array(n);
  let win = 0, first = 0, tbs = 0, a1 = 0, b1 = 0, a2 = 0, b2 = 0, aS = 0, bS = 0;
  for (let i = 0; i < n; i++) {
    // Un générateur par match simulé : n'importe lequel se rejoue à l'identique (match typique).
    const rng = simRng(seed, i);
    const e = rng.normal(0, sd);
    const r = play(rng, Sg(Lg(pA) + e), Sg(Lg(pB) - e), opts.bestOf);
    setsA[i] = r.sa; setsB[i] = r.sb; tbA[i] = r.tb ? 1 : 0; form[i] = e;
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
  const games0 = [...games];
  games.sort((x, y) => x - y);
  const q = (f: number) => games[Math.min(n - 1, Math.floor(f * n))];
  const gamesLadder: SimResult['gamesLadder'] = [];
  for (let line = -15.5; line <= 15.5; line++) gamesLadder.push({ line, pACover: diff.filter((d) => d + line > 0).length / n });
  const favA = (opts.target ?? win / n) >= 0.5;
  for (const k of Object.keys(scores)) scores[k] /= n;
  // Outsider qui prend un set face à un gros favori : la simulation le sous-estimait (ATP 2025-2026, 2 962 matchs :
  // favori à 80-90 % qui gagne, l'outsider avait pris un set 30,6 % du temps, 24,2 % prévus). Correction apprise sur
  // une année et vérifiée sur l'autre (log-perte -3,3 ‰ et -2,9 ‰), maximale vers 85 %, nulle sous 70 % et à 100 %.
  // La victoire et les jeux décisifs ne bougent pas : une part des victoires sans perdre de set passe aux victoires
  // avec un set perdu.
  const pFav = Math.max(opts.target ?? win / n, 1 - (opts.target ?? win / n));
  const bump = (opts.bestOf === 5 ? DOG_SET_BO5 : DOG_SET_BO3) * Math.max(0, 1 - Math.abs(pFav - 0.85) / 0.15);
  const at1: [number, number] = [a1 / n, b1 / n], straight: [number, number] = [aS / n, bS / n];
  const dog = favA ? 1 : 0, fav = 1 - dog;
  if (bump > 0 && at1[dog] > 0 && at1[dog] < 1) {
    const moved = Math.min(straight[fav], Sg(Lg(at1[dog]) + bump) - at1[dog]);
    const need = opts.bestOf === 5 ? 3 : 2;
    const sweep = favA ? `${need}-0` : `0-${need}`;
    const close = Object.keys(scores).filter((k) => { const [x, y] = k.split('-').map(Number); return favA ? x === need && y >= 1 : y === need && x >= 1; });
    const closeTot = close.reduce((t, k) => t + scores[k], 0);
    if (moved > 0 && scores[sweep] != null && closeTot > 0) {
      scores[sweep] -= moved;
      for (const k of close) scores[k] += (moved * scores[k]) / closeTot;
      at1[dog] += moved;
      straight[fav] -= moved;
    }
  }
  const typical = typicalMatch({
    pA, pB, bestOf: opts.bestOf, sd, seed, favA, scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v * n])), setsA, setsB, games: games0, diff, form, tbA,
    pDogSet: at1[dog], pTb: tbs / n,
  });
  return {
    n, pA, pB, win: win / n, firstSet: first / n, scores, atLeast1: at1, atLeast2: [a2 / n, b2 / n], straight,
    tiebreak: tbs / n, games: { mean: games.reduce((s, x) => s + x, 0) / n, p10: q(0.1), p50: q(0.5), p90: q(0.9) }, gamesLadder, typical,
  };
}

const simRng = (seed: number, i: number) => new Rng((Math.imul(seed >>> 0, 0x85ebca6b) ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0);

/**
 * Match typique : le vainqueur du pronostic affiché, puis ce qui est le plus probable trait par trait. L'outsider prend un
 * set plus d'une fois sur deux : le match typique se joue en 3 sets (ou 4-5 en Grand Chelem) ; un jeu décisif plus d'une
 * fois sur deux : il en a un. Ensuite le score en sets le plus fréquent, un nombre de jeux et un écart proches de la
 * médiane de ces matchs, et une forme du jour proche de la normale. Rejoué point par point. (Avant : toujours la victoire
 * la plus fréquente du favori, presque toujours 6-3 6-4, même quand l'outsider prenait un set une fois sur deux.)
 */
function typicalMatch(o: {
  pA: number; pB: number; bestOf: 3 | 5; sd: number; seed: number; favA: boolean; scores: Record<string, number>;
  setsA: Int8Array; setsB: Int8Array; games: number[]; diff: number[]; form: Float32Array; tbA: Int8Array; pDogSet: number; pTb: number;
}): TypicalMatch {
  const n = o.setsA.length;
  const favWins = (i: number) => (o.setsA[i] > o.setsB[i]) === o.favA;
  const dogSets = (k: string) => { const [a, b] = k.split('-').map(Number); return o.favA ? b : a; };
  const keys = Object.entries(o.scores).filter(([k]) => { const [a, b] = k.split('-').map(Number); return (a > b) === o.favA; });
  const wantSet = o.pDogSet >= 0.5;
  const key = (keys.filter(([k]) => (dogSets(k) >= 1) === wantSet).length ? keys.filter(([k]) => (dogSets(k) >= 1) === wantSet) : keys).sort((x, y) => y[1] - x[1])[0]?.[0];
  let pool: number[] = [];
  for (let i = 0; i < n; i++) if (favWins(i) && `${o.setsA[i]}-${o.setsB[i]}` === key) pool.push(i);
  const wantTb = o.pTb >= 0.5;
  const withTb = pool.filter((i) => (o.tbA[i] === 1) === wantTb);
  if (withTb.length) pool = withTb;
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
  const sdOf = (xs: number[]) => { const m = xs.reduce((s, x) => s + x, 0) / (xs.length || 1); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length || 1)) || 1; };
  const tot = pool.map((i) => o.games[i]), dif = pool.map((i) => o.diff[i]);
  const mt = med(tot), md = med(dif), st = sdOf(tot), sdd = sdOf(dif);
  let best = pool[0] ?? 0, bestD = Infinity;
  for (const i of pool) {
    const d = ((o.games[i] - mt) / st) ** 2 + ((o.diff[i] - md) / sdd) ** 2 + 0.5 * (o.form[i] / o.sd) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  const rng = simRng(o.seed, best);
  const e = rng.normal(0, o.sd);
  const log: Log = { games: [], srvPts: [0, 0], srvWon: [0, 0], bp: [0, 0], bpWon: [0, 0] };
  const r = play(rng, Sg(Lg(o.pA) + e), Sg(Lg(o.pB) - e), o.bestOf, log);
  // Chance de victoire de A après chaque jeu, en moyenne sur les formes du jour (comme la probabilité affichée).
  const sets: Array<[number, number]> = [];
  let sa = 0, sb = 0;
  const games: TypicalGame[] = log.games.map((g, k) => {
    const next = log.games[k + 1];
    const setOver = !next || next.s !== g.s;
    if (setOver) { sets.push([g.a, g.b]); if (g.a > g.b) sa++; else sb++; }
    const done = sa === (o.bestOf === 5 ? 3 : 2) || sb === (o.bestOf === 5 ? 3 : 2);
    // Serveur du jeu suivant : l'autre joueur (après un jeu décisif, le relanceur de son premier point).
    const wp = done ? (sa > sb ? 1 : 0) : winFrom(o, sa, sb, setOver ? 0 : g.a, setOver ? 0 : g.b, g.srv === 1);
    return { ...g, wp: +wp.toFixed(3) };
  });
  const firstSrvA = log.games[0]?.srv === 0;
  return {
    index: best, winner: r.sa > r.sb ? 'A' : 'B', sets, games,
    wp0: +winFrom(o, 0, 0, 0, 0, firstSrvA).toFixed(3),
    stats: [0, 1].map((k) => ({ srvPts: log.srvPts[k], srvWon: log.srvWon[k], pts: log.srvWon[k] + log.srvPts[1 - k] - log.srvWon[1 - k], bp: log.bp[k], bpWon: log.bpWon[k] })),
  };
}

/** Chance de victoire de A à un moment du match (sets, jeux du set en cours, A sert le jeu suivant), sur les formes du jour. */
function winFrom(o: { pA: number; pB: number; bestOf: 3 | 5; sd: number }, sa: number, sb: number, a: number, b: number, aServes: boolean): number {
  const need = o.bestOf === 5 ? 3 : 2;
  let tot = 0;
  for (const [z, w] of NODES) {
    const pa = Sg(Lg(o.pA) + o.sd * z), pb = Sg(Lg(o.pB) - o.sd * z);
    const ha = hold(pa), hb = hold(pb);
    const setP = (to: number) => {
      const memo = new Map<string, number>();
      const go = (x: number, y: number, srvA: boolean): number => {
        if (x === 6 && y === 6) return srvA ? tiebreak(pa, pb, to) : 1 - tiebreak(pb, pa, to);
        if ((x >= 6 || y >= 6) && Math.abs(x - y) >= 2) return x > y ? 1 : 0;
        const k = `${x},${y},${+srvA}`;
        const m = memo.get(k);
        if (m != null) return m;
        const g = srvA ? ha : 1 - hb;
        const v = g * go(x + 1, y, !srvA) + (1 - g) * go(x, y + 1, !srvA);
        memo.set(k, v);
        return v;
      };
      return go;
    };
    const normal = setP(7), last = o.bestOf === 5 ? setP(10) : normal;
    const sAvg = (normal(0, 0, true) + normal(0, 0, false)) / 2, lAvg = (last(0, 0, true) + last(0, 0, false)) / 2;
    const series = (i: number, j: number): number => {
      if (i === need) return 1;
      if (j === need) return 0;
      const x = i === need - 1 && j === need - 1 ? lAvg : sAvg;
      return x * series(i + 1, j) + (1 - x) * series(i, j + 1);
    };
    const cur = (sa === need - 1 && sb === need - 1 ? last : normal)(a, b, aServes);
    tot += w * (cur * series(sa + 1, sb) + (1 - cur) * series(sa, sb + 1));
  }
  return tot;
}
