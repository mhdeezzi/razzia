// Réglages du moteur foot, choisis sur les saisons d'apprentissage uniquement (2021-2024) :
// 1) forces : demi-vie, part des buts réels, prudence de l'a priori ;
// 2) ajustements de contexte : chacun gardé seulement s'il améliore la prévision de 2023-24 (appris sur 2021-23) ;
// 3) intensité de l'effet du score (k) : vraisemblance des scores exacts ;
// 4) poids du marché.
import { adjusted, fitCoefs, FEATS, ZERO, type Coefs } from '../foot/adjust.ts';
import { loadGames } from '../foot/data.ts';
import { DEFAULT_RATING, type RatingParams } from '../foot/ratings.ts';
import { gameState, outcome, simulateMatch } from '../foot/sim.ts';
import { walk, type WalkRow } from '../foot/walk.ts';
import { blend, ll, noVig, poissonGrid } from '../cli/footbacktest.ts';

const MAIN = new Set([47, 87, 55, 54, 53, 42]);
const games = loadGames();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const y = (r: WalkRow) => (r.g.score[0] > r.g.score[1] ? 'h' : r.g.score[0] === r.g.score[1] ? 'd' : 'a') as 'h' | 'd' | 'a';
const score = (rows: WalkRow[], b: Coefs, w = 0) => {
  let s = 0, n = 0;
  for (const r of rows) { const e = outcome(poissonGrid(...adjusted(r, b))); const p = w && r.g.odds ? blend(e, noVig(r.g.odds), w) : e; s += ll(p[y(r)]); n++; }
  return s / n;
};
const step = process.argv[2] ?? 'all';
let best: RatingParams = { ...DEFAULT_RATING };
if (step === 'all' || step === 'ratings') {
  let bestS = Infinity;
  for (const halfLifeDays of [120, 200, 320]) for (const goalsWeight of [0.15, 0.3, 0.5]) for (const priorSd of [0.25, 0.4]) for (const newcomer of [0.1, 0.25]) {
    const P = { ...DEFAULT_RATING, halfLifeDays, goalsWeight, priorSd, newcomer };
    const rows = walk(games, '2022-08-01', P, MAIN).filter((r) => r.g.date < '2024-07-01');
    const s = score(rows, ZERO);
    if (s < bestS) { bestS = s; best = P; }
    log(JSON.stringify({ halfLifeDays, goalsWeight, priorSd, newcomer }), s.toFixed(4));
  }
  log('meilleur', JSON.stringify(best), bestS.toFixed(4));
}
if (step === 'all' || step === 'feats') {
  const P = { ...DEFAULT_RATING, ...JSON.parse(process.argv[3] ?? '{}'), ...(step === 'all' ? best : {}) };
  const rows = walk(games, '2021-08-01', P, MAIN);
  const tr = rows.filter((r) => r.g.date < '2023-07-01'), va = rows.filter((r) => r.g.date >= '2023-07-01' && r.g.date < '2024-07-01');
  const all = fitCoefs(tr, P.goalsWeight);
  const base = score(va, all);
  log('tous', JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, +v.toFixed(3)]))), base.toFixed(5), 'sans rien', score(va, ZERO).toFixed(5));
  for (const k of FEATS) {
    const b = fitCoefs(tr, P.goalsWeight, FEATS.filter((x) => x !== k));
    log(`sans ${k.padEnd(6)}`, score(va, b).toFixed(5), (score(va, b) - base > 0 ? 'utile' : 'inutile'), (1e4 * (score(va, b) - base)).toFixed(1));
  }
}
if (step === 'all' || step === 'k') {
  const P = { ...DEFAULT_RATING, ...JSON.parse(process.argv[3] ?? '{}') };
  const rows = walk(games, '2022-08-01', P, MAIN).filter((r) => r.g.date < '2024-07-01');
  const b = fitCoefs(rows, P.goalsWeight);
  for (const k of [0, 0.5, 1, 1.5]) {
    let s = 0, d = 0, d0 = 0, o25 = 0, o25r = 0, n = 0;
    for (const r of rows) {
      const [lh, la] = adjusted(r, b);
      const sim = simulateMatch({ lambda: lh, shotQ: r.shotQ[0], redRate: r.red[0] }, { lambda: la, shotQ: r.shotQ[1], redRate: r.red[1] }, { n: 1500, seed: Number(r.g.id) % 100000, gs: gameState(k) });
      const [i, j] = r.g.score;
      s += ll(0.98 * (sim.grid[Math.min(i, 10)][Math.min(j, 10)]) + 0.02 / 121);
      d += outcome(sim.grid).d; d0 += i === j ? 1 : 0;
      let o = 0; sim.grid.forEach((row, a) => row.forEach((p, c) => { if (a + c > 2.5) o += p; }));
      o25 += o; o25r += i + j > 2.5 ? 1 : 0; n++;
    }
    log(`k ${k} : score exact ${(s / n).toFixed(4)} · nuls prévus ${(100 * d / n).toFixed(1)} % réels ${(100 * d0 / n).toFixed(1)} % · +2,5 buts prévus ${(100 * o25 / n).toFixed(1)} % réels ${(100 * o25r / n).toFixed(1)} %`);
  }
}
