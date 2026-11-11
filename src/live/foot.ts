// Moteur live foot : à n'importe quelle minute, probabilités de fin de match à partir de l'état réel (score, cartons
// rouges, tirs et xG de chaque équipe), puis chaîne minute par minute jusqu'au coup de sifflet final.
//
// Intensité de but d'une équipe à la minute m (loi de Poisson) :
//   lambda (buts attendus sur 90 min, tirés du marché d'avant-match) x profil de la minute (temps additionnel compris)
//   x effet du score (mène / mené / égalité, selon la période) x effet des rouges x force du jour.
// Force du jour : ce que l'équipe produit vraiment dans ce match (xG, buts, pression des 15 dernières minutes) comparé à
// ce qu'on attendait d'elle à ce stade, rétréci vers 1 (k minutes-xG d'a priori). Tous les coefficients sont appris par
// src/cli/livefoot.ts sur les saisons passées, puis vérifiés sur la saison suivante (jamais vue à l'apprentissage).

export interface FootLiveParams {
  /** Part des buts marqués à chaque minute 1..90 (la 45e et la 90e contiennent le temps additionnel). */
  share: number[];
  /** Effet du score sur l'intensité de l'équipe : [écart vu par l'équipe -2..+2][période 0 (1-45), 1 (46-70), 2 (71-90)]. */
  state: number[][];
  /** Effet des rouges : [rouges de l'équipe (0, 1+)][rouges adverses (0, 1+)]. */
  red: number[][];
  /** A priori de la force du jour, en buts attendus (plus il est grand, moins le match en cours pèse). */
  k: number;
  /** Part des buts réels (le reste : xG) dans la production observée. */
  goalW: number;
  /** Exposant de la pression récente (xG des 15 dernières minutes rapportés à l'attendu). */
  gamma: number;
  /** Force de l'effet du score sur la fin de match (1 = tel que mesuré minute par minute). */
  stateK: number;
  /** Bonus d'intensité des deux équipes quand le score est serré en fin de match (relances, matchs ouverts). */
  closeLate: number;
  /** Facteur de remontée : intensité en plus de l'équipe menée, au-delà de l'effet du score mesuré minute par minute. */
  trail: number;
  /** Appris le : */
  builtAt?: string;
}

export const DEFAULT_PARAMS: FootLiveParams = {
  share: Array.from({ length: 91 }, (_, m) => (m === 0 ? 0 : m === 45 ? 2.2 / 90 : m === 90 ? 4.5 / 90 : 1 / 90)),
  state: [[1.3, 1.35, 1.45], [1.15, 1.2, 1.3], [1, 1, 1], [0.92, 0.88, 0.85], [0.9, 0.85, 0.8]],
  red: [[1, 1.5], [0.65, 1]],
  k: 1.5,
  goalW: 0.25,
  gamma: 0.15,
  stateK: 1,
  closeLate: 1,
  trail: 1,
};

export type Side = 0 | 1; // 0 domicile, 1 extérieur
export interface FootTimeline {
  /** Minute jouée (1..90 ; 45 et 90 incluent le temps additionnel). 0 : avant le coup d'envoi. */
  minute: number;
  goals: Array<[number, Side]>; // [minute, équipe qui marque] (contre son camp compté pour l'équipe qui en profite)
  reds: Array<[number, Side]>;
  shots: Array<[number, Side, number]>; // [minute, équipe, xG]
}

const clampD = (d: number) => Math.max(-2, Math.min(2, d));
const period = (m: number) => (m <= 45 ? 0 : m <= 70 ? 1 : 2);
const r1 = (n: number) => (n > 0 ? 1 : 0);

/** Probabilités sans marge d'un 1X2 (et d'un plus/moins de 2,5 buts) -> buts attendus de chaque équipe (lois de Poisson). */
export function marketLambdas(o: { h: number; d: number; a: number; over25?: number; under25?: number }): [number, number] {
  const ih = 1 / o.h, id = 1 / o.d, ia = 1 / o.a, s = ih + id + ia;
  const ph = ih / s, pa = ia / s;
  let pOver: number | undefined;
  if (o.over25 && o.under25) { const io = 1 / o.over25, iu = 1 / o.under25; pOver = io / (io + iu); }
  const pmf = (l: number) => { const p = [Math.exp(-l)]; for (let i = 1; i <= 10; i++) p.push((p[i - 1] * l) / i); return p; };
  const eval_ = (lh: number, la: number) => {
    const H = pmf(lh), A = pmf(la);
    let h = 0, a = 0, u = 0;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = H[i] * A[j]; if (i > j) h += p; else if (j > i) a += p; if (i + j <= 2) u += p; }
    return { h, a, over: 1 - u };
  };
  const loss = (lh: number, la: number) => {
    const e = eval_(lh, la);
    return (e.h - ph) ** 2 + (e.a - pa) ** 2 + (pOver != null ? 0.5 * (e.over - pOver) ** 2 : 0.15 * (lh + la - 2.65) ** 2 / 4);
  };
  // Descente par coordonnées sur une grille de plus en plus fine.
  let lh = 1.45, la = 1.15;
  for (const step of [0.4, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005]) {
    for (let it = 0; it < 20; it++) {
      let best = loss(lh, la), moved = false;
      for (const [dh, da] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) {
        const nh = lh + dh, na = la + da;
        if (nh < 0.05 || na < 0.05) continue;
        const l = loss(nh, na);
        if (l < best - 1e-12) { best = l; lh = nh; la = na; moved = true; }
      }
      if (!moved) break;
    }
  }
  return [lh, la];
}

/** Intensité de base (sans force du jour) d'une équipe à la minute m, selon l'écart (vu par elle) et les rouges. */
export function baseRate(P: FootLiveParams, lambda: number, m: number, diff: number, redOwn: number, redOpp: number): number {
  const st = 1 + (P.stateK ?? 1) * (P.state[clampD(diff) + 2][period(m)] - 1);
  const close = m > 70 && Math.abs(diff) <= 1 ? (P.closeLate ?? 1) : 1;
  const tr = diff < 0 ? (P.trail ?? 1) : 1;
  return lambda * P.share[Math.min(90, Math.max(1, m))] * st * close * tr * P.red[r1(redOwn)][r1(redOpp)];
}

export interface Evidence {
  /** Buts attendus jusqu'ici (selon le déroulé réel : score et rouges minute par minute), par équipe. */
  expected: [number, number];
  xg: [number, number];
  goals: [number, number];
  /** 15 dernières minutes : attendu et xG. */
  expRecent: [number, number];
  xgRecent: [number, number];
  /** Force du jour retenue (multiplie l'intensité restante). */
  strength: [number, number];
  /** Pression récente (avant exposant). */
  pressure: [number, number];
}

/** Ce que le match en cours dit de chaque équipe, à la fin de la minute `tl.minute`. */
export function evidence(P: FootLiveParams, lam: [number, number], tl: FootTimeline): Evidence {
  const t = tl.minute;
  const exp: [number, number] = [0, 0], expR: [number, number] = [0, 0];
  const xg: [number, number] = [0, 0], xgR: [number, number] = [0, 0], gl: [number, number] = [0, 0];
  let gh = 0, ga = 0, rh = 0, ra = 0;
  const goalsAt = new Map<number, Array<Side>>(), redsAt = new Map<number, Array<Side>>();
  for (const [m, s] of tl.goals) (goalsAt.get(m) ?? goalsAt.set(m, []).get(m)!).push(s);
  for (const [m, s] of tl.reds) (redsAt.get(m) ?? redsAt.set(m, []).get(m)!).push(s);
  for (let m = 1; m <= t; m++) {
    for (const s of [0, 1] as const) {
      const d = s === 0 ? gh - ga : ga - gh;
      const e = baseRate(P, lam[s], m, d, s === 0 ? rh : ra, s === 0 ? ra : rh);
      exp[s] += e;
      if (m > t - 15) expR[s] += e;
    }
    for (const s of goalsAt.get(m) ?? []) { if (s === 0) gh++; else ga++; }
    for (const s of redsAt.get(m) ?? []) { if (s === 0) rh++; else ra++; }
  }
  for (const [m, s, x] of tl.shots) { if (m > t) continue; xg[s] += x; if (m > t - 15) xgR[s] += x; }
  for (const [m, s] of tl.goals) if (m <= t) gl[s]++;
  const strength: [number, number] = [1, 1], pressure: [number, number] = [1, 1];
  for (const s of [0, 1] as const) {
    const obs = (1 - P.goalW) * xg[s] + P.goalW * gl[s];
    const kk = P.k * (lam[s] / 1.35); // a priori proportionnel au niveau attendu
    const base = (kk + obs) / (kk + exp[s]);
    const kr = 0.35 * (lam[s] / 1.35);
    pressure[s] = t >= 10 ? (kr + xgR[s]) / (kr + expR[s]) : 1;
    strength[s] = base * pressure[s] ** P.gamma;
  }
  return { expected: exp, xg, goals: gl, expRecent: expR, xgRecent: xgR, strength, pressure };
}

export interface FootLiveOut {
  minute: number;
  score: [number, number];
  /** Victoire domicile, nul, victoire extérieur. */
  p1x2: [number, number, number];
  /** Prochain but : domicile, extérieur, plus aucun but. */
  nextGoal: [number, number, number];
  /** But dans les 10 prochaines minutes, par équipe. */
  goalSoon: [number, number];
  /** Buts restants attendus, par équipe. */
  remaining: [number, number];
  /** Score final : grid[i][j] = proba que le domicile finisse avec i buts et l'extérieur j (à partir de 0). */
  grid: number[][];
  /** Plus de x,5 buts au total (x = 0..6). */
  over: number[];
  /** Équipe menée : chance d'égaliser au moins (remontée partielle) et de gagner (remontée complète). */
  comeback?: { side: Side; draw: number; win: number };
  /** Équipe qui mène : le résultat tient (victoire). */
  hold?: { side: Side; win: number };
  ev: Evidence;
}

/** Chaîne de Markov minute par minute (au plus un but par équipe et par minute) depuis l'état du match. */
export function footLive(P: FootLiveParams, lam: [number, number], tl: FootTimeline): FootLiveOut {
  const t = Math.max(0, Math.min(90, tl.minute));
  const ev = evidence(P, lam, tl);
  let gh = 0, ga = 0, rh = 0, ra = 0;
  for (const [m, s] of tl.goals) if (m <= t) { if (s === 0) gh++; else ga++; }
  for (const [m, s] of tl.reds) if (m <= t) { if (s === 0) rh++; else ra++; }
  const G = 9; // buts restants suivis au plus par équipe
  // dp[i][j] : i buts de plus pour le domicile, j pour l'extérieur ; first[k] : proba que le premier but restant soit k.
  let dp = Array.from({ length: G }, () => new Float64Array(G));
  dp[0][0] = 1;
  let none = 1; // aucun but encore marqué depuis t
  const first: [number, number] = [0, 0];
  const soon: [number, number] = [0, 0];
  const rem: [number, number] = [0, 0];
  for (let m = t + 1; m <= 90; m++) {
    const nx = Array.from({ length: G }, () => new Float64Array(G));
    const late = m - t <= 10;
    let gotH = 0, gotA = 0;
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const p = dp[i][j];
      if (p < 1e-14) continue;
      const d = gh + i - (ga + j);
      const lh = baseRate(P, lam[0], m, d, rh, ra) * ev.strength[0];
      const la = baseRate(P, lam[1], m, -d, ra, rh) * ev.strength[1];
      const qh = 1 - Math.exp(-lh), qa = 1 - Math.exp(-la);
      rem[0] += p * lh; rem[1] += p * la;
      const ii = Math.min(G - 1, i + 1), jj = Math.min(G - 1, j + 1);
      nx[i][j] += p * (1 - qh) * (1 - qa);
      nx[ii][j] += p * qh * (1 - qa);
      nx[i][jj] += p * (1 - qh) * qa;
      nx[ii][jj] += p * qh * qa;
      if (i === 0 && j === 0) { gotH = qh; gotA = qa; }
    }
    // Premier but restant : depuis l'état « aucun but » (dp[0][0] = none).
    const both = gotH * gotA;
    first[0] += none * (gotH * (1 - gotA) + both / 2);
    first[1] += none * (gotA * (1 - gotH) + both / 2);
    if (late) { /* buts dans les 10 minutes : calculés plus bas sur des chaînes séparées */ }
    none *= (1 - gotH) * (1 - gotA);
    dp = nx;
  }
  // But d'une équipe dans les 10 prochaines minutes : intensité au score actuel (approximation fidèle, l'effet du score
  // sur 10 minutes reste faible).
  for (const s of [0, 1] as const) {
    let L = 0;
    for (let m = t + 1; m <= Math.min(90, t + 10); m++) {
      const d = s === 0 ? gh - ga : ga - gh;
      L += baseRate(P, lam[s], m, d, s === 0 ? rh : ra, s === 0 ? ra : rh) * ev.strength[s];
    }
    soon[s] = 1 - Math.exp(-L);
  }
  const grid = Array.from({ length: gh + G }, () => new Array(ga + G).fill(0));
  let pH = 0, pD = 0, pA = 0;
  const over = new Array(7).fill(0);
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const p = dp[i][j];
    const fh = gh + i, fa = ga + j;
    grid[fh][fa] += p;
    if (fh > fa) pH += p; else if (fh === fa) pD += p; else pA += p;
    for (let x = 0; x <= 6; x++) if (fh + fa > x) over[x] += p;
  }
  const out: FootLiveOut = { minute: t, score: [gh, ga], p1x2: [pH, pD, pA], nextGoal: [first[0], first[1], none], goalSoon: soon, remaining: rem, grid, over, ev };
  if (gh !== ga) {
    const lead: Side = gh > ga ? 0 : 1, trail: Side = lead === 0 ? 1 : 0;
    out.hold = { side: lead, win: lead === 0 ? pH : pA };
    out.comeback = { side: trail, draw: pD + (trail === 0 ? pH : pA), win: trail === 0 ? pH : pA };
  }
  return out;
}
