// Contrôle de justesse du moteur foot, sans jamais regarder le futur : apprentissage sur 2021-2024, test sur 2024-2026.
//   node src/cli/footbacktest.ts [--sims 3000] [--quick]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adjusted, fitCoefs, type Coefs, ZERO } from '../foot/adjust.ts';
import { loadGames, type Game } from '../foot/data.ts';
import { FOOT_DIR } from '../foot/fotmob.ts';
import { DEFAULT_RATING, type RatingParams } from '../foot/ratings.ts';
import { probs, MARKETS } from '../foot/markets.ts';
import { gameState, outcome, reweight, simulateMatch } from '../foot/sim.ts';
import { walk, type WalkRow } from '../foot/walk.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SPLIT = arg('--split', '2024-07-01');
const MAIN = new Set([47, 87, 55, 54, 53, 42]);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

export const noVig = (o: { h: number; d: number; a: number }) => { const s = 1 / o.h + 1 / o.d + 1 / o.a; return { h: 1 / o.h / s, d: 1 / o.d / s, a: 1 / o.a / s }; };
export const noVigOU = (o?: number, u?: number) => (o && u ? (1 / o) / (1 / o + 1 / u) : undefined);

/** Grille de Poisson indépendante avec correction des petits scores (Dixon-Coles). */
export function poissonGrid(lh: number, la: number, rho = -0.05): number[][] {
  const pf = (l: number) => { const p = [Math.exp(-l)]; for (let k = 1; k <= 10; k++) p.push((p[k - 1] * l) / k); return p; };
  const ph = pf(lh), pa = pf(la);
  const g = ph.map((x, i) => pa.map((y, j) => {
    let t = 1;
    if (i === 0 && j === 0) t = 1 - lh * la * rho; else if (i === 0 && j === 1) t = 1 + lh * rho; else if (i === 1 && j === 0) t = 1 + la * rho; else if (i === 1 && j === 1) t = 1 - rho;
    return x * y * t;
  }));
  const s = g.flat().reduce((a, b) => a + b, 0);
  return g.map((r) => r.map((x) => x / s));
}

export const ll = (p: number) => -Math.log(Math.max(1e-9, p));
const res = (g: Game) => (g.score[0] > g.score[1] ? 'h' : g.score[0] === g.score[1] ? 'd' : 'a') as 'h' | 'd' | 'a';

export function blend(e: { h: number; d: number; a: number }, m: { h: number; d: number; a: number } | undefined, w: number) {
  if (!m) return e;
  const z = { h: Math.exp((1 - w) * Math.log(e.h) + w * Math.log(m.h)), d: Math.exp((1 - w) * Math.log(e.d) + w * Math.log(m.d)), a: Math.exp((1 - w) * Math.log(e.a) + w * Math.log(m.a)) };
  const s = z.h + z.d + z.a;
  return { h: z.h / s, d: z.d / s, a: z.a / s };
}

function evalRows(rows: WalkRow[], b: Coefs, rho: number, w: number) {
  let n = 0, lE = 0, lM = 0, lB = 0, accE = 0, accM = 0, accB = 0, nM = 0;
  for (const r of rows) {
    const [lh, la] = adjusted(r, b);
    const e = outcome(poissonGrid(lh, la, rho));
    const y = res(r.g);
    n++; lE += ll(e[y]);
    const am = (o: { h: number; d: number; a: number }) => (o.h >= o.d && o.h >= o.a ? 'h' : o.a >= o.d ? 'a' : 'd');
    accE += am(e) === y ? 1 : 0;
    if (r.g.odds) {
      const m = noVig(r.g.odds), bl = blend(e, m, w);
      nM++; lM += ll(m[y]); lB += ll(bl[y]); accM += am(m) === y ? 1 : 0; accB += am(bl) === y ? 1 : 0;
    }
  }
  return { n, nM, llE: lE / n, llM: nM ? lM / nM : NaN, llB: nM ? lB / nM : NaN, accE: accE / n, accM: nM ? accM / nM : NaN, accB: nM ? accB / nM : NaN };
}

if (import.meta.main ?? process.argv[1]?.endsWith('footbacktest.ts')) {
  const games = loadGames();
  log(`matchs : ${games.length}, avec cotes : ${games.filter((g) => g.odds).length}, avec xG : ${games.filter((g) => g.xg).length}`);
  const P: RatingParams = { ...DEFAULT_RATING, ...JSON.parse(arg('--params', '{}')) };
  const rows = walk(games, '2021-08-01', P, MAIN);
  const train = rows.filter((r) => r.g.date < SPLIT), test = rows.filter((r) => r.g.date >= SPLIT);
  log(`déroulé : ${rows.length} matchs (apprentissage ${train.length}, test ${test.length})`);
  const b = process.argv.includes('--nofeat') ? ZERO : fitCoefs(train, P.goalsWeight);
  log('coefficients', JSON.stringify(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, +v.toFixed(3)]))));
  for (const w of [0, 0.3, 0.5, 0.7, 0.85]) {
    const tr = evalRows(train, b, -0.05, w), te = evalRows(test, b, -0.05, w);
    if (process.argv.includes('--quick')) log(`marché ${w} | apprentissage : moteur ll ${tr.llE.toFixed(4)} acc ${(tr.accE * 100).toFixed(1)} · marché ${tr.llM.toFixed(4)} ${(tr.accM * 100).toFixed(1)} · mélange ${tr.llB.toFixed(4)} ${(tr.accB * 100).toFixed(1)} | test : moteur ${te.llE.toFixed(4)} ${(te.accE * 100).toFixed(1)} · marché ${te.llM.toFixed(4)} ${(te.accM * 100).toFixed(1)} · mélange ${te.llB.toFixed(4)} ${(te.accB * 100).toFixed(1)} (${te.nM}/${te.n} avec cotes)`);
  }
  if (!process.argv.includes('--quick')) {
    const W = Number(arg('--w', '0.7')), K = Number(arg('--k', '0.5')), N = Number(arg('--sims', '2000'));
    const evalSet = process.argv.includes('--train') ? train : test;
    const stats = new Map<string, { n: number; win: number; p: number }>();
    const add = (k: string, p: number, ok: boolean) => { const s = stats.get(k) ?? { n: 0, win: 0, p: 0 }; s.n++; s.win += ok ? 1 : 0; s.p += p; stats.set(k, s); };
    let llS = 0, llP = 0, nn = 0;
    const out: unknown[] = [];
    const t0 = Date.now();
    const WC = Number(arg('--wcup', '0'));
    for (const r of evalSet) {
      // Coupes d'Europe : pas de cotes historiques, moteur seul.
      if (!r.g.odds && ![42, 73].includes(r.g.lg)) continue;
      const fg = finalGrid(r, b, r.g.odds ? W : WC, K, N);
      const pm = probs(fg.grid);
      const [i, j] = r.g.score;
      const y = res(r.g);
      nn++; llS += ll(outcome(fg.grid)[y]);
      llP += ll(r.g.odds ? blend(outcome(poissonGrid(...adjusted(r, b))), noVig(r.g.odds), W)[y] : outcome(poissonGrid(...adjusted(r, b)))[y]);
      for (const mk of MARKETS) { const pp = pm.get(mk.id)!; const b10 = Math.min(9, Math.floor(pp * 10)); add(`calib ${b10}`, pp, mk.win(Math.min(i, 10), Math.min(j, 10))); }
      for (const T of [0.7, 0.75, 0.8, 0.85, 0.9]) {
        const f = featured(pm, T);
        if (f) { const ok = MARKETS.find((m) => m.id === f.id)!.win(i, j); add(`T${T} mis en avant`, f.p, ok); add(`T${T} champ ${r.g.lg}`, f.p, ok); add(`T${T} saison ${r.g.season}`, f.p, ok); add(`T${T} ${f.id.replace(/^(1X|X2)/, 'DC').replace(/^[12](?=\+|$)/, 'V')}`, f.p, MARKETS.find((m) => m.id === f.id)!.win(i, j)); }
        else add(`T${T} aucun`, 0, false);
      }
      out.push({ id: r.g.id, lg: r.g.lg, date: r.g.date, h: r.g.home.name, a: r.g.away.name, score: r.g.score, p: Object.fromEntries([...pm].map(([k, v]) => [k, +v.toFixed(4)])) });
    }
    log(`simulation : ${nn} matchs en ${((Date.now() - t0) / 1000).toFixed(0)} s ; 1N2 log-perte simulation+marché ${(llS / nn).toFixed(4)}, Poisson+marché ${(llP / nn).toFixed(4)}`);
    for (const [k, s] of [...stats].sort()) console.log(`${k.padEnd(28)} n=${String(s.n).padStart(5)}  réussite ${(100 * s.win / s.n).toFixed(1).padStart(5)} %  proba moyenne ${(100 * s.p / s.n).toFixed(1).padStart(5)} %`);
    writeFileSync(join(FOOT_DIR, 'backtest.json'), JSON.stringify(out));
  }
}

/** Grille finale d'un match : simulation tir par tir puis recalage sur le mélange moteur/marché (1N2 et 2,5 buts). */
export function finalGrid(r: WalkRow, b: Coefs, w: number, k: number, n: number, wOU = w) {
  const [lh, la] = adjusted(r, b);
  const sim = simulateMatch({ lambda: lh, shotQ: r.shotQ[0], redRate: r.red[0] }, { lambda: la, shotQ: r.shotQ[1], redRate: r.red[1] }, { n, seed: Number(r.g.id) % 100000, gs: gameState(k) });
  const e = outcome(sim.grid);
  if (!r.g.odds) return { grid: sim.grid, engine: e, sim };
  const m = noVig(r.g.odds), bl = blend(e, m, w);
  let eo = 0;
  sim.grid.forEach((row, i) => row.forEach((p, j) => { if (i + j > 2.5) eo += p; }));
  const mo = noVigOU(r.g.odds.over25, r.g.odds.under25);
  const over25 = mo != null ? Math.exp((1 - wOU) * Math.log(eo) + wOU * Math.log(mo)) / (Math.exp((1 - wOU) * Math.log(eo) + wOU * Math.log(mo)) + Math.exp((1 - wOU) * Math.log(1 - eo) + wOU * Math.log(1 - mo))) : undefined;
  return { grid: reweight(sim.grid, { ...bl, over25 }), engine: e, sim };
}

/** Pronostic mis en avant : la double chance du favori, ou le combiné le plus intéressant qui reste au-dessus du seuil
 * de sûreté ; rien si même la double chance n'est pas assez sûre (match trop ouvert). */
export function featured(p: Map<string, number>, T: number): { id: string; p: number } | undefined {
  const fav = p.get('1')! >= p.get('2')! ? '1X' : 'X2';
  const win = fav === '1X' ? '1' : '2';
  const cands = [win, fav, `${fav}+o0.5`, `${fav}+o1.5`, `${fav}+u3.5`, `${fav}+u4.5`, `${fav}+u5.5`, `${fav}+o0.5+u5.5`, `${fav}+o0.5+u4.5`, `${win}+o1.5`]
    .map((id) => ({ id, p: p.get(id)! })).filter((c) => c.p >= T).sort((a, b) => a.p - b.p);
  return cands[0];
}
