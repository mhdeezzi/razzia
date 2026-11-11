// Moteur live NBA : à n'importe quel moment, loi de l'écart final et du total de points depuis l'état réel du match.
//
// Écart final (domicile - extérieur, fin du temps réglementaire) = écart actuel + reste du match, le reste suivant une loi
// normale :
//   moyenne  = force du soir x minutes restantes + possession en cours - retour d'une partie de l'avance (l'équipe qui
//              mène gère, celle qui est menée force : les avances fondent un peu) + série récente (si elle compte)
//   variance = bruit du jeu x minutes restantes + incertitude sur la force du soir x minutes restantes²
// Force du soir : l'écart attendu avant le match (par minute) corrigé par ce que le match montre, à la manière d'un
// a priori bayésien. L'adresse à 3 points et aux lancers francs au-dessus (ou en dessous) de la normale est en grande
// partie de la chance : elle est retirée en partie de ce que le match « montre ». Tous les coefficients sont appris par
// src/cli/livenba.ts sur la saison 2024-25, puis contrôlés sur 2025-26.

export interface NbaLiveParams {
  /** Bruit du jeu : écart-type de l'écart par minute jouée (points / racine de minute). */
  s: number;
  /** Incertitude a priori sur la force du soir (points par minute). */
  tau: number;
  /** Part de l'avance actuelle qui fond d'ici la fin, à 48 minutes restantes (proportionnelle au temps restant). */
  kappa: number;
  /** Part de la chance (adresse à 3 pts et aux lancers au-dessus de la normale) retirée de ce que le match montre. */
  luck: number;
  /** Poids de la série des 5 dernières minutes (en plus de tout le reste). */
  run: number;
  /** Valeur d'avoir le ballon (points). */
  poss: number;
  /** Total : bruit (points / racine de minute) et incertitude a priori sur le rythme (points par minute). */
  sT: number;
  tauT: number;
  builtAt?: string;
}

export const DEFAULT_NBA: NbaLiveParams = { s: 1.75, tau: 0.12, kappa: 0.1, luck: 0.6, run: 0, poss: 0.6, sT: 2.4, tauT: 0.2 };

export interface NbaPre {
  /** Écart attendu avant le match (domicile - extérieur), terrain compris. */
  spread: number;
  /** Total de points attendu (temps réglementaire). */
  total: number;
}

export interface NbaState {
  /** Minutes jouées (0..48). */
  elapsed: number;
  score: [number, number]; // domicile, extérieur
  /** Paniers à 3 pts réussis et tentés, lancers réussis et tentés, par équipe. */
  fg3: [[number, number], [number, number]];
  ft: [[number, number], [number, number]];
  /** Écart (domicile - extérieur) il y a 5 minutes. */
  diff5?: number;
  /** Équipe en possession (0 domicile, 1 extérieur). */
  possession?: 0 | 1;
  /** Fautes d'équipe dans le quart-temps en cours (bonus à partir de 5). */
  fouls?: [number, number];
}

const LG3 = 0.36, LGFT = 0.78;
const Phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

export interface NbaLiveOut {
  elapsed: number;
  /** Victoire domicile, victoire extérieur. */
  win: [number, number];
  /** Écart final attendu (domicile - extérieur) et son écart-type. */
  margin: { mean: number; sd: number };
  total: { mean: number; sd: number };
  /** Chance que le domicile couvre un handicap : écart final + line > 0. */
  cover: (line: number) => number;
  /** Plus de `line` points au total. */
  over: (line: number) => number;
  /** Équipe menée : chance de gagner quand même. */
  comeback?: { side: 0 | 1; win: number; deficit: number };
  /** Ce que le moteur a retenu : chance au tir (points en trop du domicile), série, force du soir par minute. */
  factors: { luck: number; run: number; strength: number; strengthPre: number; bonus: [boolean, boolean] };
}

/** Pronostic depuis l'état du match. */
export function nbaLive(P: NbaLiveParams, pre: NbaPre, st: NbaState): NbaLiveOut {
  const e = Math.max(0, Math.min(48, st.elapsed)), r = 48 - e;
  const D = st.score[0] - st.score[1];
  // Chance au tir : points marqués au-dessus de l'adresse normale (3 pts et lancers), domicile moins extérieur.
  const l3 = (st.fg3[0][0] - LG3 * st.fg3[0][1]) * 3 - (st.fg3[1][0] - LG3 * st.fg3[1][1]) * 3;
  const lft = (st.ft[0][0] - LGFT * st.ft[0][1]) - (st.ft[1][0] - LGFT * st.ft[1][1]);
  const luck = l3 + lft;
  const Dadj = D - P.luck * luck;
  // Force du soir (points par minute) : a priori N(spread/48, tau²), observation Dadj ~ N(theta e, s² e).
  const m0 = pre.spread / 48;
  const prec = 1 / P.tau ** 2 + e / P.s ** 2;
  const theta = (m0 / P.tau ** 2 + Dadj / P.s ** 2) / prec;
  const varTheta = 1 / prec;
  const run = st.diff5 != null ? D - st.diff5 : 0;
  const posV = st.possession == null ? 0 : st.possession === 0 ? P.poss : -P.poss;
  const muR = theta * r - P.kappa * D * (r / 48) + P.run * run * (r / 48) + (r > 0 ? posV : 0);
  const sdR = Math.sqrt(P.s ** 2 * r + varTheta * r * r + 0.25);
  const mean = D + muR;
  // Total : même logique sur le rythme (points par minute).
  const T = st.score[0] + st.score[1];
  const t0 = pre.total / 48;
  const precT = 1 / P.tauT ** 2 + e / P.sT ** 2;
  const rate = (t0 / P.tauT ** 2 + T / P.sT ** 2) / precT;
  const meanT = T + rate * r;
  const sdT = Math.sqrt(P.sT ** 2 * r + (1 / precT) * r * r + 0.25);
  const pH = r === 0 ? (D > 0 ? 1 : D < 0 ? 0 : 0.5) : Phi(mean / sdR);
  const out: NbaLiveOut = {
    elapsed: e,
    win: [pH, 1 - pH],
    margin: { mean, sd: sdR },
    total: { mean: meanT, sd: sdT },
    cover: (line: number) => Phi((mean + line) / sdR),
    over: (line: number) => 1 - Phi((line - meanT) / sdT),
    factors: { luck, run, strength: theta * 48, strengthPre: pre.spread, bonus: [(st.fouls?.[1] ?? 0) >= 5, (st.fouls?.[0] ?? 0) >= 5] },
  };
  if (D !== 0) {
    const side: 0 | 1 = D > 0 ? 1 : 0;
    out.comeback = { side, win: side === 0 ? pH : 1 - pH, deficit: Math.abs(D) };
  }
  return out;
}
