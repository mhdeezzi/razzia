// Simulation d'un match de foot, tir par tir, par tranches de 5 minutes, en tenant compte du score : l'équipe menée pousse
// (plus de tirs, souvent de moins bonne qualité), celle qui mène gère ; un carton rouge change le rapport de forces.
// Chaque tir est tiré dans le profil de tirs réel de l'équipe (distribution des xG), son tireur parmi les joueurs sur le
// terrain selon leur part des tirs. Sortie : la grille des scores et des compteurs pour les marchés.

/** Multiplicateurs mesurés sur les matchs réels (src/dev/footstates.ts), par rapport au score égal sur la même période :
 * tirs (rate) et xG par tir (q), avant et après l'heure de jeu ; `late` : hausse du volume en dernière demi-heure à score
 * égal ; rouge : volume d'xG de l'équipe réduite à dix (own) et de son adversaire (opp). */
export interface GameState {
  lead: [number, number, number, number]; // rate tôt, q tôt, rate tard, q tard
  trail: [number, number, number, number];
  late: number;
  redOwn: number;
  redOpp: number;
}
// La mesure directe sur les matchs (src/dev/footstates.ts) exagère l'effet : le tir qui fait passer devant est compté
// « à égalité », l'égalisation « mené ». Les valeurs retenues sont donc calées sur la vraie distribution des scores
// (proportion de nuls, de 0-0, de matchs à 3 buts et plus) par footbacktest.ts : seule l'intensité k est ajustée.
export const gameState = (k: number): GameState => ({ lead: [1 - 0.2 * k, 1, 1 - 0.3 * k, 1], trail: [1 + 0.2 * k, 1, 1 + 0.3 * k, 1], late: 1.15, redOwn: 0.6, redOpp: 1.5 });
export const GAME_STATE: GameState = gameState(0.5);
export interface SimTeam {
  lambda: number; // buts attendus sur 90 minutes à score égal
  shotQ: number[]; // xG des tirs récents de l'équipe (échantillon), pour la forme de la distribution
  redRate: number; // probabilité d'un rouge par match
  shooters?: Array<{ id: number; share: number; finish: number }>; // part des tirs, réussite relative (1 = moyenne)
}
export interface SimOpts { n: number; seed?: number; gs?: GameState }
export interface SimOut {
  n: number;
  grid: number[][]; // grid[i][j] = proba du score i-j (i domicile)
  ht: number[][]; // score à la mi-temps
  firstGoal: [number, number, number]; // domicile, extérieur, aucun
  scorers: Map<number, number>; // joueur -> proba de marquer
  // Déroulé : à la fin de chaque tranche de 5 minutes, part des matchs où le domicile mène, nul, l'extérieur mène.
  flow: Array<[number, number, number]>;
  // Scénarios par score final (« 2-1 ») : suite des buts (« HAH ») -> nombre de matchs et somme des minutes de chaque but.
  seqs: Map<string, Map<string, { n: number; min: number[] }>>;
}

class Rng {
  s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next() { let t = (this.s += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  poisson(l: number) { if (l <= 0) return 0; let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= this.next(); } while (p > L); return k - 1; }
}

const BLOCKS = 19; // 95 minutes, temps additionnel compris
export function simulateMatch(h: SimTeam, a: SimTeam, o: SimOpts): SimOut {
  const rng = new Rng(o.seed ?? 12345);
  const gs = o.gs ?? GAME_STATE;
  const prep = (t: SimTeam) => {
    const q = t.shotQ.length >= 30 ? t.shotQ : [0.03, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.3, 0.45, 0.76];
    const meanQ = q.reduce((s, x) => s + x, 0) / q.length;
    // Tirs par tranche à score égal : profil du match (dernière demi-heure plus ouverte), total = lambda.
    const rate = t.lambda / meanQ / (12 + 7 * gs.late);
    const cum: number[] = [];
    let acc = 0;
    for (const s of t.shooters ?? []) { acc += s.share; cum.push(acc); }
    return { q, rate, cum, tot: acc };
  };
  const H = prep(h), A = prep(a);
  const grid = Array.from({ length: 11 }, () => new Array(11).fill(0));
  const ht = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const first: [number, number, number] = [0, 0, 0];
  const scorers = new Map<number, number>();
  const scoredBy = new Set<number>();
  const flow: Array<[number, number, number]> = Array.from({ length: BLOCKS }, () => [0, 0, 0]);
  const seqs = new Map<string, Map<string, { n: number; min: number[] }>>();
  let seq = '';
  const mins: number[] = [];
  const shoot = (T: ReturnType<typeof prep>, t: SimTeam, qMul: number) => {
    let x = T.q[Math.floor(rng.next() * T.q.length)] * qMul;
    let who = 0;
    if (T.cum.length) {
      const r = rng.next() * T.tot;
      let i = 0;
      while (i < T.cum.length - 1 && T.cum[i] < r) i++;
      who = t.shooters![i].id;
      x *= t.shooters![i].finish;
    }
    return rng.next() < Math.min(0.95, x) ? who || -1 : 0;
  };
  for (let s = 0; s < o.n; s++) {
    let gh = 0, ga = 0, fg = 2, redH = 0, redA = 0;
    scoredBy.clear();
    seq = '';
    mins.length = 0;
    for (let b = 0; b < BLOCKS; b++) {
      if (b === 9) { ht[Math.min(5, gh)][Math.min(5, ga)]++; }
      // Rouges : rares, plutôt en seconde période.
      if (!redH && rng.next() < (h.redRate * (b >= 9 ? 1.4 : 0.6)) / BLOCKS) redH = 1;
      if (!redA && rng.next() < (a.redRate * (b >= 9 ? 1.4 : 0.6)) / BLOCKS) redA = 1;
      const d = gh - ga;
      const late = b >= 12;
      const tm = late ? gs.late : 1;
      let rh = H.rate * tm, ra = A.rate * tm, qh = 1, qa = 1;
      const L = late ? 2 : 0;
      if (d > 0) { rh *= gs.lead[L]; qh = gs.lead[L + 1]; ra *= gs.trail[L]; qa = gs.trail[L + 1]; }
      else if (d < 0) { ra *= gs.lead[L]; qa = gs.lead[L + 1]; rh *= gs.trail[L]; qh = gs.trail[L + 1]; }
      if (redH) { rh *= gs.redOwn; ra *= gs.redOpp; }
      if (redA) { ra *= gs.redOwn; rh *= gs.redOpp; }
      const nh = rng.poisson(rh), na = rng.poisson(ra);
      // Ordre des tirs dans la tranche : au hasard.
      let ih = nh, ia = na;
      // Minute d'un but : sa place parmi les tirs de la tranche (sans tirage de plus : les résultats ne bougent pas).
      const k = nh + na;
      const minute = () => Math.min(95, b * 5 + 1 + Math.floor((5 * (k - ih - ia - 0.5)) / k));
      while (ih + ia > 0) {
        const home = rng.next() < ih / (ih + ia);
        if (home) { ih--; const w = shoot(H, h, qh); if (w) { gh++; if (fg === 2) fg = 0; if (w > 0) scoredBy.add(w); seq += 'H'; mins.push(minute()); } }
        else { ia--; const w = shoot(A, a, qa); if (w) { ga++; if (fg === 2) fg = 1; if (w > 0) scoredBy.add(w); seq += 'A'; mins.push(minute()); } }
      }
      flow[b][gh > ga ? 0 : gh === ga ? 1 : 2]++;
    }
    if (gh <= 5 && ga <= 5) {
      const key = `${gh}-${ga}`;
      const bySeq = seqs.get(key) ?? seqs.set(key, new Map()).get(key)!;
      const e = bySeq.get(seq) ?? bySeq.set(seq, { n: 0, min: new Array(seq.length).fill(0) }).get(seq)!;
      e.n++;
      for (let i = 0; i < mins.length; i++) e.min[i] += mins[i];
    }
    grid[Math.min(10, gh)][Math.min(10, ga)]++;
    first[fg]++;
    for (const id of scoredBy) scorers.set(id, (scorers.get(id) ?? 0) + 1);
  }
  const n = o.n;
  for (const r of grid) for (let j = 0; j < r.length; j++) r[j] /= n;
  for (const r of ht) for (let j = 0; j < r.length; j++) r[j] /= n;
  for (const [k, v] of scorers) scorers.set(k, v / n);
  return { n, grid, ht, firstGoal: [first[0] / n, first[1] / n, first[2] / n], scorers, flow: flow.map((f) => [f[0] / n, f[1] / n, f[2] / n] as [number, number, number]), seqs };
}

/** Grille de scores ajustée pour coller à des probabilités cibles (1X2, plus de 2,5 buts), en gardant sa forme. */
export function reweight(grid: number[][], target: { h: number; d: number; a: number; over25?: number }): number[][] {
  const g = grid.map((r) => [...r]);
  for (let it = 0; it < 30; it++) {
    const s = { h: 0, d: 0, a: 0 };
    for (let i = 0; i < g.length; i++) for (let j = 0; j < g[i].length; j++) s[i > j ? 'h' : i === j ? 'd' : 'a'] += g[i][j];
    for (let i = 0; i < g.length; i++) for (let j = 0; j < g[i].length; j++) { const k = i > j ? 'h' : i === j ? 'd' : 'a'; if (s[k] > 0) g[i][j] *= target[k] / s[k]; }
    if (target.over25 != null) {
      let o = 0, u = 0;
      for (let i = 0; i < g.length; i++) for (let j = 0; j < g[i].length; j++) (i + j > 2.5 ? (o += g[i][j]) : (u += g[i][j]));
      for (let i = 0; i < g.length; i++) for (let j = 0; j < g[i].length; j++) g[i][j] *= i + j > 2.5 ? target.over25 / o : (1 - target.over25) / u;
    }
  }
  return g;
}

export const outcome = (grid: number[][]) => {
  let h = 0, d = 0, a = 0;
  for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[i].length; j++) (i > j ? (h += grid[i][j]) : i === j ? (d += grid[i][j]) : (a += grid[i][j]));
  return { h, d, a };
};
