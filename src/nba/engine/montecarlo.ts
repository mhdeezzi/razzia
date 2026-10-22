// Monte Carlo : calibration du rythme, N simulations en parallèle, agrégation, match typique, probabilité de victoire.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import type { Edge, GameModel, PlayerModel, TeamModel } from '../model/types.ts';
import { occEdge } from '../model/build.ts';
import { simulateGame, type GameResult, type SimEvent } from './game.ts';
import { merge, playerOrder, runRange, stat, MAXQ, NK, ZK, STAT_KEYS, type Batch, type StatKey } from './batch.ts';
import { noVig, americanToProb } from '../../data/espn.ts';
import { normName } from '../model/build.ts';
import { loadPropCal, calibratedOver } from '../model/propcal.ts';

export async function runSims(m: GameModel, n: number, seed0 = 1, threads = Math.max(1, availableParallelism() - 1)): Promise<Batch> {
  const players = playerOrder(m);
  const seeds = Array.from({ length: n }, (_, i) => (seed0 * 100_003 + i * 7919) | 0);
  if (threads <= 1 || n < 400) return runRange(m, seeds, players);
  const chunk = Math.ceil(n / threads);
  const parts = await Promise.all(
    Array.from({ length: threads }, (_, k) => seeds.slice(k * chunk, (k + 1) * chunk)).filter((s) => s.length).map(
      (s) =>
        new Promise<Batch>((resolve, reject) => {
          const w = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { model: m, seeds: s, players } });
          w.once('message', (b: Batch) => resolve(b));
          w.once('error', reject);
        }),
    ),
  );
  return merge(parts, players);
}

/** Calibre l'échelle de durée des possessions pour viser le rythme attendu du match. */
export function calibratePace(m: GameModel, sims = 300): { target: number; got: number } {
  const L = m.league;
  const target = (m.home.pace * m.away.pace) / L.pace;
  let got = 0;
  for (let it = 0; it < 3; it++) {
    let poss = 0;
    let mins = 0;
    for (let i = 0; i < sims; i++) {
      const r = simulateGame(m, 900_000 + it * 10_000 + i);
      poss += (r.home.poss + r.away.poss) / 2;
      mins += 48 + (r.periods - 4) * 5;
    }
    got = (poss / mins) * 48;
    m.params.durScale *= Math.pow(got / target, 1.1);
  }
  return { target, got };
}

/**
 * Ancrage de force collective : rapproche l'efficacité simulée de chaque attaque de sa cible
 * (attaque réelle + défense adverse réelle − ligue), avec un poids ∝ continuité des deux effectifs.
 * Capte ce que la construction joueur par joueur rate (coach, schémas, aide défensive, synergies).
 */
export function calibrateStrength(m: GameModel, sims = 600, maxWeight = m.params.strengthPull ?? 0.6): { target: [number, number]; before: [number, number]; after: [number, number]; talentMult: number; rwEff: number } {
  const lg = m.league.ppg / m.league.pace;
  const hca = m.league.homeMargin / 2 / m.league.pace; // avantage du terrain en points par possession, par équipe
  // Notes corrigées du calendrier : une attaque qui a affronté des défenses faibles est revue à la baisse, etc.
  const sw = m.params.sosWeight ?? 0;
  const o = (t: GameModel['home']) => t.ortg - sw * (t.sos?.[0] ?? 0);
  const d = (t: GameModel['home']) => t.drtg - sw * (t.sos?.[1] ?? 0);
  const teamTarget: [number, number] = [o(m.home) + d(m.away) - lg + hca, o(m.away) + d(m.home) - lg - hca];
  // Notes d'impact : qui joue ce soir et combien de minutes (parts normalisées à 5 joueurs sur le terrain).
  const rw = m.params.rapmWeight ?? 0;
  // Le cinq de départ compte en entier ; au banc, seuls les meilleurs remplaçants pèsent vraiment (un remplaçant peut
  // faire la différence, pas tous), davantage s'ils sont en forme. La forme récente d'un joueur (15 derniers matchs de
  // saison régulière contre les saisons d'avant, en Game Score / 36 ; 0,31 point d'impact par point) s'ajoute à sa note.
  const mk = m.params.playerMomentum ?? 0;
  const nTop = m.params.benchTop ?? 99, wTop = m.params.benchTopWeight ?? 1, wRest = m.params.benchRestWeight ?? 1;
  const mom = (p: PlayerModel) => mk * 0.31 * (p.momentum?.delta ?? 0);
  const imp = (t: TeamModel) => {
    const share = t.players.map((p) => p.avail * p.expMin);
    const tot = share.reduce((a, v) => a + v, 0) || 1;
    const val = (p: PlayerModel) => (p.rapm ? p.rapm.o + p.rapm.d : -1.5) + mom(p);
    const top = new Set(t.players.filter((p, i) => !p.starter && share[i] > 0).sort((a, b) => val(b) - val(a)).slice(0, nTop).map((p) => p.id));
    let off = 0, def = 0;
    t.players.forEach((p, i) => {
      const hot = 1 + Math.min(1, Math.max(0, (p.momentum?.delta ?? 0) / 5)); // remplaçant en forme : jusqu'à ×2
      const w = p.starter ? 1 : Math.min(1, (top.has(p.id) ? wTop : wRest) * hot);
      const k = ((5 * share[i]) / tot) * w;
      off += k * ((p.rapm?.o ?? -0.8) + 0.7 * mom(p));
      def += k * ((p.rapm?.d ?? -0.7) + 0.3 * mom(p));
    });
    return { off: off / 100, def: def / 100 };
  };
  const ih = imp(m.home), ia = imp(m.away);
  const rapmTarget: [number, number] = [lg + ih.off - ia.def + hca, lg + ia.off - ih.def - hca];
  // Les notes d'équipe viennent des matchs passés de l'effectif d'alors : elles ne comptent qu'à proportion de la
  // continuité (et des minutes habituelles disponibles ce soir) ; les notes d'impact suivent qui joue vraiment.
  const contShare = Math.sqrt(m.home.continuity * m.away.continuity);
  const wTeam = (1 - rw) * contShare;
  const rwEff = rw > 0 ? rw / (rw + wTeam) : 0;
  // Multiplicateur de talent : quand l'équipe qui domine le collectif a aussi le meilleur talent, ses joueurs
  // s'expriment (soutien, automatismes) ; la part du talent est amplifiée selon la cohésion de son cinq (duos, trios
  // qui ont joué ensemble). Une équipe qui perd le collectif ne tire rien de plus de son talent.
  const coll = teamTarget[0] - teamTarget[1] - 2 * hca, tal = rapmTarget[0] - rapmTarget[1] - 2 * hca;
  const leader = coll > 0 ? m.home : m.away;
  const talentMult = coll * tal > 0 ? 1 + (m.params.talentBoost ?? 0) * (leader.coreCohesion ?? 0) : 1;
  const rwT = rwEff * talentMult;
  const target: [number, number] = [(1 - rwEff) * teamTarget[0] + rwEff * (lg + hca) + rwT * (ih.off - ia.def), (1 - rwEff) * teamTarget[1] + rwEff * (lg - hca) + rwT * (ia.off - ih.def)];
  // Les notes d'équipe ignorent les absences du soir : leur poids baisse avec la part des minutes habituelles disponibles.
  const avail = (t: GameModel['home']) => {
    const usual = t.players.reduce((a, p) => a + (p.form.gp > 0 ? p.form.minL10 : 0), 0);
    const here = t.players.reduce((a, p) => a + (p.form.gp > 0 ? p.form.minL10 * p.avail : 0), 0);
    return usual > 0 ? Math.min(1, here / usual) : 1;
  };
  const share = Math.sqrt(avail(m.home) * avail(m.away));
  // La cible tient déjà compte de la continuité (poids des notes d'équipe) ; seules les absences du soir, que les notes
  // d'équipe ignorent, réduisent encore la part comblée.
  const wt = maxWeight * ((1 - rwEff) * share + rwEff);
  const w: [number, number] = [wt, wt];
  const measure = (seed: number): [number, number] => {
    let hp = 0, ap = 0, hpo = 0, apo = 0;
    for (let i = 0; i < sims; i++) {
      const r = simulateGame(m, seed + i);
      hp += r.home.pts; ap += r.away.pts; hpo += r.home.poss; apo += r.away.poss;
    }
    return [hp / hpo, ap / apo];
  };
  m.params.teamBias = [0, 0];
  const before = measure(700_000);
  // Ajustements de contexte en points par match (ci-dessous), visés dans la même boucle que la force : appliqués après
  // coup avec une pente supposée, ils n'en passaient qu'environ 60 %.
  const shift = contextShift(m);
  const half = shift / 2 / m.league.pace;
  const desired: [number, number] = [before[0] + w[0] * (target[0] - before[0]) + half, before[1] + w[1] * (target[1] - before[1]) - half];
  let cur = before;
  for (let it = 0; it < 3; it++) {
    for (const k of [0, 1] as const) {
      // Pente empirique ≈ 0,45 point/possession par unité de logit d'adresse.
      m.params.teamBias[k] = Math.max(-0.3, Math.min(0.3, m.params.teamBias[k] + (desired[k] - cur[k]) / 0.45));
    }
    cur = measure(710_000 + it * 10_000);
  }
  m.params.edge = composeEdges(m);
  return { target, before, after: cur, talentMult, rwEff };
}

/** Écart de contexte attendu pour l'équipe à domicile, en points par match. */
function contextShift(m: GameModel): number {
  // Confrontations récentes (chat noir) : part de l'écart réel - attendu des deux dernières années.
  let shift = 0;
  if (m.params.h2hWeight && m.h2h) shift += m.params.h2hWeight * m.h2h.residualHome;
  // Chat noir de style : ce que chaque équipe perd (ou gagne) d'habitude contre ce type d'adversaire.
  const sw2 = m.params.styleWeight ?? 0;
  if (sw2 && m.h2h?.style) shift += sw2 * ((m.h2h.style.home?.pts ?? 0) - (m.h2h.style.away?.pts ?? 0)) / 2;
  // Cohésion : une équipe remaniée manque d'automatismes ses premiers matchs. Mesuré sur 2025-26 (matchs 1 à 10) :
  // +14 pts par écart de continuité de 100 % (erreur 6), effet disparu après le 10e match ; s'éteint linéairement.
  const cw = m.params.cohesionWeight ?? 0;
  if (cw) {
    const fade = (t: TeamModel) => Math.max(0, 1 - (t.gpCur ?? 99) / 10);
    shift += cw * (m.home.continuity - m.away.continuity) * Math.max(fade(m.home), fade(m.away));
  }
  // Avantage du terrain propre à l'équipe qui reçoit (une salle qui pèse plus, ou moins, que la moyenne).
  const hw = m.params.hcaWeight ?? 0;
  if (hw && m.home.hcaDev != null) shift += hw * m.home.hcaDev;
  // Fin de saison sans enjeu (équipe hors course) : moins d'intensité.
  const ns = m.params.noStakesPenalty ?? 0;
  if (ns) shift += ns * ((m.away.noStakes ? 1 : 0) - (m.home.noStakes ? 1 : 0));
  return shift;
}

const EDGE_KEYS = ['tov', 'orb', 'trans', 'fta', 'shotQ', 'contest'] as const;
const zeroEdge = (): Edge => ({ tov: 0, orb: 0, trans: 0, fta: 0, shotQ: 0, contest: 0 });
const addEdge = (a: Edge, b: Edge, k: number) => {
  for (const key of EDGE_KEYS) a[key] += k * b[key];
};
const edgeSum = (e: Edge) => EDGE_KEYS.reduce((s, k) => s + e[k], 0);

/**
 * Leviers d'occasions de chaque attaque (points / 100 possessions), appliqués par le moteur.
 * Momentum : une équipe en ascendant se crée plus d'occasions et en concède moins (pertes, rebonds offensifs,
 * contre-attaques, lancers, emplacements de tir). L'ampleur vient de l'écart « 15 derniers matchs - saisons
 * précédentes », mesuré sur le score et sur les occasions (part momentumOcc), au prorata de la continuité de
 * l'effectif ; sa répartition, de ce qui a changé dans son jeu. Pas de levier de réussite : ce n'est qu'une conséquence.
 * Chat noir : ce qui change dans les confrontations (tirs plus loin, plus contestés ou ratés, pertes, rebonds).
 */
export function composeEdges(m: GameModel): [Edge, Edge] {
  const edge: [Edge, Edge] = [zeroEdge(), zeroEdge()];
  const early = Math.max(0, 1 - Math.min(m.home.gpCur ?? 99, m.away.gpCur ?? 99) / 25);
  const mw = (m.params.momentumWeight ?? 0) + (m.params.momentumEarly ?? 0) * early;
  const mo = m.params.momentumOcc ?? 0.5;
  if (mw) {
    for (const [k, T] of [[0, m.home], [1, m.away]] as const) {
      const M = T.momentum;
      if (!M) continue;
      const u = k === 0 ? 1 : 0;
      const dOcc = M.xRecent != null && M.xBase != null ? M.xRecent - M.xBase : M.delta;
      // Seuls les matchs de la saison en cours (même effectif) font un momentum : au premier match, rien.
      const curShare = M.nCur != null ? Math.min(1, M.nCur / Math.max(1, M.n)) : 1;
      const D = mw * T.continuity * curShare * ((1 - mo) * M.delta + mo * dOcc);
      let rest = D;
      if (M.occ) {
        const r = M.occ.recent, b = M.occ.base;
        const off = occEdge({ tov: r.tov - b.tov, orb: r.orb - b.orb, trans: r.trans - b.trans, fta: r.fta - b.fta, xFg: r.xFg - b.xFg, make: 0 });
        const allowed = occEdge({ tov: r.tovForced - b.tovForced, orb: r.orbAllowed - b.orbAllowed, trans: r.transAllowed - b.transAllowed, fta: r.ftaAllowed - b.ftaAllowed, xFg: r.xFgAllowed - b.xFgAllowed, make: 0 });
        const S = edgeSum(off) - edgeSum(allowed);
        const a = Math.abs(S) > 0.5 && Math.sign(S) === Math.sign(D) ? Math.min(2, D / S) : 0;
        addEdge(edge[k], off, a);
        addEdge(edge[u], allowed, a);
        rest = D - a * S;
      }
      // Le reste : meilleurs tirs créés et moins bons tirs concédés.
      edge[k].shotQ += rest / 2;
      edge[u].shotQ -= rest / 2;
    }
  }
  const hw = m.params.h2hShotWeight ?? 0;
  if (hw && m.h2h?.shots) {
    addEdge(edge[0], m.h2h.shots.home, hw);
    addEdge(edge[1], m.h2h.shots.away, hw);
  }
  for (const e of edge) for (const key of EDGE_KEYS) e[key] = Math.max(-8, Math.min(8, e[key]));
  return edge;
}

// ------------------------------------------------------------------ résumé statistique
const quantile = (sorted: ArrayLike<number>, q: number): number => {
  const n = sorted.length;
  if (!n) return 0;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const mean = (a: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
};
const sd = (a: ArrayLike<number>): number => {
  const mu = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - mu) ** 2;
  return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0;
};

export interface Dist {
  mean: number;
  sd: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}
function dist(vals: Float64Array | number[]): Dist {
  const s = Float64Array.from(vals).sort();
  return { mean: mean(s), sd: sd(s), p10: quantile(s, 0.1), p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), p90: quantile(s, 0.9) };
}

export interface PlayerSummary {
  id: number;
  name: string;
  short: string;
  jersey: string;
  team: string;
  side: 0 | 1;
  status: string;
  playRate: number; // part des sims où il joue
  starter: boolean;
  stats: Record<string, Dist>;
  dd: number;
  td: number;
  firstBasket: number;
  form: PlayerModel['form'];
  h2h?: PlayerModel['h2h'];
  notes: string[];
  heat?: Heat;
}

/** Potentiel de « gros match » d'un joueur sur l'ensemble des simulations. */
export interface Heat {
  base: number; // points habituels (moyenne de la saison, ou des 10 derniers matchs en début de saison)
  threshold: number; // seuil du gros match
  pBig: number; // part des simulations où il atteint ce seuil
  mean: number; // points moyens simulés quand il joue
  p90: number; // plafond : 1 simulation sur 10 au-dessus
  index: number; // classement : probabilité de gros match pondérée par son volume de points
  reasons: string[];
}

export interface PropEval {
  player: string;
  market: string;
  line: number;
  pOver: number;
  pUnder: number;
  confidence: 'haute' | 'moyenne' | 'faible';
  confidenceWhy: string;
  pLean?: number; // probabilité du côté recommandé après mélange avec le marché (selon la confiance)
  edgeRaw?: number; // écart brut modèle - marché
  bookOver?: number;
  bookUnder?: number;
  impliedOver?: number;
  edge?: number; // probabilité modèle - probabilité implicite (côté recommandé)
  lean: 'over' | 'under';
}

export interface Summary {
  n: number;
  home: { tri: string; name: string; city: string; color: string };
  away: { tri: string; name: string; city: string; color: string };
  pHome: number; // probabilité affichée (fréquence des simulations, recalibrée par backtest)
  pHomeRaw?: number; // fréquence brute des victoires à domicile dans les simulations
  pAway: number;
  pOT: number;
  homePts: Dist;
  awayPts: Dist;
  margin: Dist; // domicile - extérieur
  total: Dist;
  poss: Dist;
  quarters: { home: number[]; away: number[] };
  firstHalf: { home: number; away: number; pHome: number };
  spreadLadder: Array<{ line: number; pHomeCover: number }>;
  totalLadder: Array<{ line: number; pOver: number }>;
  market?: {
    spreadHome?: number;
    total?: number;
    pHomeCover?: number;
    pOver?: number;
    pHomeML?: number;
    bookHome?: number;
    blendedHome?: number;
    mlHome?: number; // cotes américaines au moment de la simulation (bilan : valeur de clôture, rendement)
    mlAway?: number;
  };
  players: PlayerSummary[];
  props: PropEval[];
  teamStats: Record<'home' | 'away', Record<string, number>>;
  /** Profil de tir moyen par équipe : zones (RA, raquette, mi-distance, coin gauche, coin droit, 3 pts de face). */
  shotProfile?: Record<'home' | 'away', { fga: number[]; fgm: number[]; astM: number; transFga: number; transFgm: number; cont: number[] }>;
  h2h?: GameModel['h2h'];
  momentum?: Record<'home' | 'away', TeamModel['momentum']>;
  edge?: [Edge, Edge]; // leviers d'occasions appliqués (domicile, extérieur)
  uncertainty?: Record<'home' | 'away', number>;
}

/**
 * Gros match = au moins 30 % au-dessus de ses points habituels et 6 points de plus (15 minimum).
 * Les raisons viennent des données qui poussent la simulation vers le haut : forme, face-à-face, minutes, défense.
 */
function heatOf(m: GameModel, pm: PlayerModel, side: 0 | 1, playRate: number, pts: number[], d: Dist, n: number): Heat | undefined {
  if (playRate < 0.5 || !pts.length) return undefined;
  const f = pm.form;
  const base = f.gpCur >= 5 ? f.ptsSeason : f.gp > 0 ? Math.max(f.ptsSeason, f.ptsL10) : d.mean;
  if (base < 6) return undefined;
  const threshold = Math.max(15, Math.ceil(Math.max(base * 1.3, base + 6)));
  const pBig = pts.filter((v) => v >= threshold).length / n;
  const opp = side === 0 ? m.away : m.home;
  const team = side === 0 ? m.home : m.away;
  const r1 = (v: number) => v.toFixed(1).replace('.', ',');
  const reasons: string[] = [];
  if (f.gp >= 5 && f.ptsL10 >= base * 1.12 && f.ptsL10 - base >= 2) reasons.push(`En forme : ${r1(f.ptsL10)} pts sur ses 10 derniers matchs (${r1(base)} habituellement)`);
  const h = pm.h2h;
  if (h && h.games >= 1 && h.pts >= h.ptsAll * 1.12 && h.pts - h.ptsAll >= 2)
    reasons.push(`Réussit contre ${opp.name} : ${r1(h.pts)} pts de moyenne en ${h.games} match${h.games > 1 ? 's' : ''}${h.best != null ? `, record ${h.best}` : ''}`);
  else if (h?.last && h.last.pts >= threshold) reasons.push(`${h.last.pts} pts lors du dernier face-à-face`);
  if (f.minSeason > 0 && pm.expMin >= f.minSeason + 3) reasons.push(`Plus de temps de jeu ce soir : ${Math.round(pm.expMin)} min attendues (${Math.round(f.minSeason)} habituellement)`);
  if (d.mean >= base * 1.08 && d.mean - base >= 1.5) reasons.push(`Défense favorable : ${r1(d.mean)} pts simulés contre ${r1(base)} habituels`);
  if (opp.b2b && !team.b2b) reasons.push(`${opp.name} joue son 2e match en deux soirs`);
  if (side === 0) reasons.push('Joue à domicile');
  return { base, threshold, pBig, mean: d.mean, p90: d.p90, index: pBig * Math.sqrt(base), reasons };
}

/**
 * Recalibration mesurée par le contrôle de justesse : p = σ(a + b · L / (1 + c · |L|)), L = logit(fréquence simulée).
 * Le moteur est timide entre 50 et 75 % (annonce 52 % : gagne 62 % ; annonce 60 % : 62 %) et trop sûr de lui au-delà
 * (annonce 89 % : gagne 81 %) : b > 1 écarte les probabilités du milieu, c les resserre en haut. Le favori ne change pas.
 */
function calibrated(m: GameModel, p: number): number {
  const a = m.params.calA ?? 0;
  const b = m.params.calB ?? 1;
  const c = m.params.calC ?? 0;
  if (a === 0 && b === 1 && c === 0) return p;
  const q = Math.min(0.999, Math.max(0.001, p));
  const L = Math.log(q / (1 - q));
  return 1 / (1 + Math.exp(-(a + (b * L) / (1 + c * Math.abs(L)))));
}

function profileOf(b: Batch, side: 0 | 1) {
  const acc = new Array(ZK).fill(0);
  for (let i = 0; i < b.n; i++) for (let k = 0; k < ZK; k++) acc[k] += b.shots[(i * 2 + side) * ZK + k] / b.n;
  return { fga: acc.slice(0, 6), fgm: acc.slice(6, 12), astM: acc[12], transFga: acc[13], transFgm: acc[14], cont: acc.slice(15, 19) };
}

export function summarize(m: GameModel, b: Batch): Summary {
  const n = b.n;
  const margin = new Float64Array(n);
  const total = new Float64Array(n);
  const possA = new Float64Array(n);
  let homeWins = 0;
  let ot = 0;
  for (let i = 0; i < n; i++) {
    margin[i] = b.home[i] - b.away[i];
    total[i] = b.home[i] + b.away[i];
    possA[i] = (b.poss[i * 2] + b.poss[i * 2 + 1]) / 2;
    if (margin[i] > 0) homeWins++;
    if (b.periods[i] > 4) ot++;
  }
  const qH = [0, 0, 0, 0];
  const qA = [0, 0, 0, 0];
  let h1Home = 0;
  for (let i = 0; i < n; i++) {
    for (let q = 0; q < 4; q++) {
      qH[q] += b.qHome[i * MAXQ + q] / n;
      qA[q] += b.qAway[i * MAXQ + q] / n;
    }
    const h = b.qHome[i * MAXQ] + b.qHome[i * MAXQ + 1];
    const a = b.qAway[i * MAXQ] + b.qAway[i * MAXQ + 1];
    if (h > a) h1Home++;
    else if (h === a) h1Home += 0.5;
  }
  const medMargin = quantile(Float64Array.from(margin).sort(), 0.5);
  const medTotal = quantile(Float64Array.from(total).sort(), 0.5);
  const spreadLadder: Summary['spreadLadder'] = [];
  for (let k = -12; k <= 12; k++) {
    const line = Math.round(-medMargin) + k + 0.5; // spread domicile (négatif = favori)
    let c = 0;
    for (let i = 0; i < n; i++) if (margin[i] + line > 0) c++;
    spreadLadder.push({ line, pHomeCover: c / n });
  }
  const totalLadder: Summary['totalLadder'] = [];
  for (let k = -15; k <= 15; k++) {
    const line = Math.round(medTotal) + k + 0.5;
    let c = 0;
    for (let i = 0; i < n; i++) if (total[i] > line) c++;
    totalLadder.push({ line, pOver: c / n });
  }

  // Joueurs.
  const P = b.players.length;
  const all = [...m.home.players.map((p) => [p, 0] as const), ...m.away.players.map((p) => [p, 1] as const)];
  const players: PlayerSummary[] = [];
  const fb = new Map<number, number>();
  for (let i = 0; i < n; i++) fb.set(b.firstScorer[i], (fb.get(b.firstScorer[i]) ?? 0) + 1);
  const combos: Record<string, StatKey[]> = { pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ra: ['reb', 'ast'], sb: ['stl', 'blk'] };
  all.forEach(([pm, side], k) => {
    void P;
    const played: number[] = [];
    for (let i = 0; i < n; i++) if (stat(b, i, k, 'played') > 0) played.push(i);
    const stats: Record<string, Dist> = {};
    const pick = (key: StatKey) => played.map((i) => stat(b, i, k, key));
    for (const key of STAT_KEYS) if (key !== 'played') stats[key] = dist(pick(key));
    for (const [c, keys] of Object.entries(combos)) stats[c] = dist(played.map((i) => keys.reduce((a, kk) => a + stat(b, i, k, kk), 0)));
    let dd = 0;
    let td = 0;
    for (const i of played) {
      const cats = [stat(b, i, k, 'pts'), stat(b, i, k, 'reb'), stat(b, i, k, 'ast'), stat(b, i, k, 'stl'), stat(b, i, k, 'blk')].filter((v) => v >= 10).length;
      if (cats >= 2) dd++;
      if (cats >= 3) td++;
    }
    players.push({
      id: pm.id, name: pm.name, short: pm.short, jersey: pm.jersey, team: side === 0 ? m.home.tri : m.away.tri, side, status: pm.status,
      playRate: played.length / n, starter: pm.starter, stats, dd: played.length ? dd / n : 0, td: played.length ? td / n : 0,
      firstBasket: (fb.get(pm.id) ?? 0) / n, form: pm.form, h2h: pm.h2h, notes: pm.notes,
      heat: heatOf(m, pm, side, played.length / n, played.map((i) => stat(b, i, k, 'pts')), stats.pts, n),
    });
  });

  // Marché.
  let market: Summary['market'];
  if (m.market) {
    const mk = m.market;
    market = { spreadHome: mk.spreadHome, total: mk.total, bookHome: mk.pHomeNoVig, mlHome: mk.mlHome, mlAway: mk.mlAway };
    if (mk.spreadHome != null) {
      let c = 0;
      for (let i = 0; i < n; i++) if (margin[i] + mk.spreadHome > 0) c++;
      market.pHomeCover = c / n;
    }
    if (mk.total != null) {
      let c = 0;
      for (let i = 0; i < n; i++) if (total[i] > mk.total) c++;
      market.pOver = c / n;
    }
    market.pHomeML = homeWins / n;
    if (mk.pHomeNoVig != null) {
      // Probabilité Razzia : le marché comme base, corrigé par le moteur (mélange en logit, part du moteur mesurée
      // par le contrôle de justesse). Le marché intègre ce que le moteur ignore (infos de dernière minute, avis des pros).
      const w = m.params.blendModel ?? 0.4;
      const lg = (p: number) => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));
      market.blendedHome = 1 / (1 + Math.exp(-(w * lg(calibrated(m, homeWins / n)) + (1 - w) * lg(mk.pHomeNoVig))));
    }
  }

  const props = evalProps(m, b, players);

  const teamStats = { home: {} as Record<string, number>, away: {} as Record<string, number> };
  for (const [side, key] of [[0, 'home'], [1, 'away']] as const) {
    const ids = all.map(([p, s], k) => (s === side ? k : -1)).filter((k) => k >= 0);
    for (const sk of ['pts', 'reb', 'ast', 'fg3m', 'fga', 'fgm', 'fg3a', 'fta', 'ftm', 'tov', 'stl', 'blk', 'oreb', 'pf'] as StatKey[]) {
      let s = 0;
      for (let i = 0; i < n; i++) for (const k of ids) s += stat(b, i, k, sk);
      teamStats[key][sk] = s / n;
    }
  }
  const shotProfile = { home: profileOf(b, 0), away: profileOf(b, 1) };

  return {
    n,
    home: { tri: m.home.tri, name: m.home.name, city: m.home.city, color: m.home.color },
    away: { tri: m.away.tri, name: m.away.name, city: m.away.city, color: m.away.color },
    pHome: calibrated(m, homeWins / n), pAway: 1 - calibrated(m, homeWins / n), pHomeRaw: homeWins / n, pOT: ot / n,
    homePts: dist(Array.from(b.home)), awayPts: dist(Array.from(b.away)), margin: dist(margin), total: dist(total), poss: dist(possA),
    quarters: { home: qH, away: qA }, firstHalf: { home: qH[0] + qH[1], away: qA[0] + qA[1], pHome: h1Home / n },
    spreadLadder, totalLadder, market, players, props, teamStats, shotProfile,
    h2h: m.h2h, momentum: { home: m.home.momentum, away: m.away.momentum }, edge: m.params.edge, uncertainty: { home: m.home.strengthSd, away: m.away.strengthSd },
  };
}

export const PROP_MAP: Record<string, StatKey[]> = {
  'Total Points': ['pts'], 'Total Rebounds': ['reb'], 'Total Assists': ['ast'], 'Total 3-Point Field Goals': ['fg3m'],
  'Total Steals': ['stl'], 'Total Blocks': ['blk'], 'Total Points and Assists': ['pts', 'ast'], 'Total Points and Rebounds': ['pts', 'reb'],
  'Total Assists and Rebounds': ['reb', 'ast'], 'Total Points, Rebounds, and Assists': ['pts', 'reb', 'ast'], 'Total Steals and Blocks': ['stl', 'blk'],
  'Total Turnovers': ['tov'],
};

// Part des sims dans la probabilité finale (backtest des props 2025-26 : le mélange ~0,3 est rentable face aux lignes
// d'ouverture — la ligne bouge ensuite dans le sens du modèle dans ~70 % des cas — mais pas face aux lignes de clôture).
const CONF_WEIGHT = { haute: 0.35, moyenne: 0.25, faible: 0.12 } as const;
const CONF_TRUST = { haute: 1, moyenne: 0.7, faible: 0.35 } as const;

/** Confiance dans la projection d'un joueur : historique avec l'équipe, rôle connu, statut certain. */
function propConfidence(p: PlayerModel | undefined): ['haute' | 'moyenne' | 'faible', string] {
  if (!p) return ['faible', 'joueur inconnu'];
  const risky = p.notes.filter((n) => /mercato|rookie|historique|rôle élargi/.test(n) || (/titulaire annoncé/.test(n) && p.expMin < 26));
  if (p.avail < 0.95) return ['faible', `statut ${p.status}`];
  if (risky.length) return ['faible', risky.join(', ')];
  if ((p.form.gpCur ?? 0) < 5) return ['moyenne', 'moins de 5 matchs cette saison'];
  return ['haute', ''];
}

function evalProps(m: GameModel, b: Batch, players: PlayerSummary[]): PropEval[] {
  if (!m.props?.length) return [];
  const out: PropEval[] = [];
  const models = new Map([...m.home.players, ...m.away.players].map((p) => [normName(p.name), p]));
  const idxByName = new Map(players.map((p, k) => [normName(p.name), k]));
  for (const pr of m.props) {
    const keys = PROP_MAP[pr.market];
    if (!keys || pr.line == null) continue;
    const k = idxByName.get(normName(pr.player));
    if (k == null) continue;
    let over = 0;
    let under = 0;
    for (let i = 0; i < b.n; i++) {
      // Un joueur qui ne joue pas : pari annulé -> exclu.
      if (stat(b, i, k, 'played') <= 0) continue;
      const v = keys.reduce((a, kk) => a + stat(b, i, k, kk), 0);
      if (v > pr.line) over++;
      else if (v < pr.line) under++;
    }
    const tot = over + under || 1;
    const pm = models.get(normName(pr.player));
    const [confidence, confidenceWhy] = propConfidence(pm);
    const e: PropEval = {
      player: pr.player, market: pr.market, line: pr.line, pOver: over / tot, pUnder: under / tot, bookOver: pr.over, bookUnder: pr.under,
      lean: over >= under ? 'over' : 'under', confidence, confidenceWhy,
    };
    if (pr.over != null && pr.under != null) {
      const [io] = noVig(pr.over, pr.under);
      e.impliedOver = io;
      // Probabilité finale : empilement calibré sur l'historique (sims + marché) s'il existe, sinon mélange simple ;
      // dans les deux cas la part des sims diminue quand le contexte est incertain.
      const cal = loadPropCal();
      const pOverBlend = cal
        ? calibratedOver(cal, pr.market, e.pOver, io, CONF_TRUST[confidence])
        : CONF_WEIGHT[confidence] * e.pOver + (1 - CONF_WEIGHT[confidence]) * io;
      e.lean = pOverBlend >= io ? 'over' : 'under';
      e.pLean = e.lean === 'over' ? pOverBlend : 1 - pOverBlend;
      e.edgeRaw = e.lean === 'over' ? e.pOver - io : e.pUnder - (1 - io);
      e.edge = e.lean === 'over' ? pOverBlend - io : 1 - pOverBlend - (1 - io);
    } else if (pr.over != null) {
      e.impliedOver = americanToProb(pr.over);
    }
    out.push(e);
  }
  out.sort((a, b2) => (b2.edge ?? 0) - (a.edge ?? 0));
  return out;
}

// ------------------------------------------------------------------ match typique
/**
 * Règle publiée par RotoBot : « le vainqueur choisi par la majorité des sims, un score proche de la médiane,
 * et chaque joueur proche de sa moyenne ». On minimise une distance standardisée sous ces contraintes.
 */
export function pickTypical(m: GameModel, b: Batch, s: Summary): number {
  const homeFav = s.pHome >= 0.5;
  const players = s.players;
  const weights = players.map((p) => (p.playRate > 0.5 ? Math.min(1, p.stats.min.mean / 30) : 0));
  let best = -1;
  let bestD = Infinity;
  const z = (v: number, d: Dist) => (d.sd > 0 ? (v - d.p50) / d.sd : 0);
  const zm = (v: number, d: Dist) => (d.sd > 0 ? (v - d.mean) / d.sd : 0);
  for (let i = 0; i < b.n; i++) {
    const hw = b.home[i] > b.away[i];
    if (hw !== homeFav) continue;
    if (b.periods[i] > 4 && s.pOT < 0.5) continue;
    let d = 2 * (z(b.home[i], s.homePts) ** 2 + z(b.away[i], s.awayPts) ** 2) + z(b.home[i] - b.away[i], s.margin) ** 2;
    let wsum = 0;
    let pd = 0;
    players.forEach((p, k) => {
      const w = weights[k];
      if (!w) return;
      const played = stat(b, i, k, 'played') > 0;
      if (!played) {
        pd += w * 9;
        wsum += w;
        return;
      }
      pd += w * (zm(stat(b, i, k, 'pts'), p.stats.pts) ** 2 + 0.6 * zm(stat(b, i, k, 'reb'), p.stats.reb) ** 2 + 0.6 * zm(stat(b, i, k, 'ast'), p.stats.ast) ** 2 + 0.4 * zm(stat(b, i, k, 'min'), p.stats.min) ** 2 + 0.3 * zm(stat(b, i, k, 'fg3m'), p.stats.fg3m) ** 2);
      wsum += w;
    });
    d += wsum ? (6 * pd) / wsum : 0;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? 0 : best;
}

const phi = (x: number): number => {
  // Fonction de répartition de la loi normale (Abramowitz-Stegun).
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

/** Probabilité de victoire (domicile) en direct : modèle brownien calé sur la distribution des sims. */
export function attachWinProb(events: SimEvent[], s: Summary): void {
  const mu = s.margin.mean;
  const sigma = Math.max(6, s.margin.sd);
  let possSide: 0 | 1 | undefined;
  for (const e of events) {
    if (e.type === 'poss') possSide = e.side;
    const remaining = e.p <= 4 ? (4 - e.p) * 720 + e.clock : e.clock;
    const r = Math.max(remaining / 2880, 1e-4);
    let margin = e.hs - e.as;
    if (possSide != null && remaining > 0) margin += possSide === 0 ? 0.45 : -0.45;
    if (remaining <= 0.05) e.wp = e.hs > e.as ? 1 : e.hs < e.as ? 0 : 0.5;
    else e.wp = phi((margin + mu * r) / (sigma * Math.sqrt(r)));
  }
}

export function typicalGame(m: GameModel, b: Batch, s: Summary): { index: number; result: GameResult } {
  const index = pickTypical(m, b, s);
  const result = simulateGame(m, b.seeds[index], { log: true });
  if (result.events) attachWinProb(result.events, s);
  return { index, result };
}

export { NK };
