// Moteur live NBA : apprentissage sur 2024-25, contrôle sur 2025-26 (play-by-play complet de chaque match).
//   node src/cli/livenba.ts       écrit src/live/nba-params.json et affiche le contrôle
// L'écart attendu avant chaque match vient ici d'une note simple (écart de points pondéré dans le temps, terrain compris),
// calculée seulement avec les matchs déjà joués : en vrai, le moteur d'avant-match (plus précis) la remplace.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DEFAULT_NBA, nbaLive, type NbaLiveParams, type NbaPre, type NbaState } from '../live/nba.ts';

const DIR = join(import.meta.dirname, '..', '..', 'data', 'cache', 'games');
interface Snap { e: number; st: NbaState }
interface G { id: string; date: string; season: 24 | 25; h: number; a: number; final: [number, number]; reg: [number, number]; snaps: Snap[]; pre?: NbaPre }

function load(): G[] {
  const out: G[] = [];
  for (const f of readdirSync(DIR)) {
    const m = f.match(/^00(2|4)(24|25)\d+\.json\.gz$/);
    if (!m) continue;
    const g = JSON.parse(gunzipSync(readFileSync(join(DIR, f))).toString());
    const H = g.home.id, acts = g.actions as any[];
    if (!acts?.length) continue;
    const snaps: Snap[] = [];
    const fg3: [[number, number], [number, number]] = [[0, 0], [0, 0]], ft: [[number, number], [number, number]] = [[0, 0], [0, 0]];
    const fouls: [number, number] = [0, 0];
    let hs = 0, as = 0, pos: 0 | 1 | undefined, next = 0, curP = 1, reg: [number, number] | undefined;
    const hist: number[] = [];
    const snap = (e: number) => {
      hist[e] = hs - as;
      snaps.push({ e, st: { elapsed: e, score: [hs, as], fg3: [[...fg3[0]], [...fg3[1]]] as any, ft: [[...ft[0]], [...ft[1]]] as any, diff5: e >= 5 ? hist[e - 5] : undefined, possession: pos, fouls: [...fouls] as [number, number] } });
    };
    for (const a of acts) {
      if (a.p > 4) { if (!reg) reg = [hs, as]; break; }
      const e = (a.p - 1) * 12 + (12 - a.c / 60);
      while (next <= 47 && e >= next) { snap(next); next++; }
      if (a.p !== curP) { curP = a.p; fouls[0] = fouls[1] = 0; }
      const side = a.tm === H ? 0 : a.tm ? 1 : undefined;
      if (a.at === '3pt' && side != null) { fg3[side][1]++; if (a.res) fg3[side][0]++; }
      if (a.at === 'freethrow' && side != null) { ft[side][1]++; if (a.res) ft[side][0]++; }
      if (a.at === 'foul' && side != null && a.st !== 'offensive' && a.st !== 'technical') fouls[side]++;
      if (a.pos) pos = a.pos === H ? 0 : 1;
      hs = a.hs; as = a.as;
    }
    while (next <= 47) { snap(next); next++; }
    if (!reg) reg = [hs, as];
    const final: [number, number] = [g.home.score, g.away.score];
    if (snaps.length < 48) continue;
    out.push({ id: g.gameId, date: g.date, season: m[2] === '24' ? 24 : 25, h: H, a: g.away.id, final, reg, snaps });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
}

/** Notes d'avant-match calculées au fil des matchs (seulement avec le passé). */
function rate(games: G[], K: number, HCA: number, carry: number): number {
  const R = new Map<number, number>(), PT = new Map<number, number>();
  let season = 0, se = 0, n = 0;
  for (const g of games) {
    if (g.season !== season) { for (const [k, v] of R) R.set(k, v * carry); season = g.season; }
    const pred = (R.get(g.h) ?? 0) - (R.get(g.a) ?? 0) + HCA;
    const tot = ((PT.get(g.h) ?? 226) + (PT.get(g.a) ?? 226)) / 2;
    g.pre = { spread: pred, total: tot };
    const err = g.final[0] - g.final[1] - pred;
    if (g.season === 24 && g.date >= '2024-12-01') { se += err * err; n++; }
    R.set(g.h, (R.get(g.h) ?? 0) + K * err);
    R.set(g.a, (R.get(g.a) ?? 0) - K * err);
    const T = g.reg[0] + g.reg[1];
    PT.set(g.h, 0.92 * (PT.get(g.h) ?? 226) + 0.08 * T);
    PT.set(g.a, 0.92 * (PT.get(g.a) ?? 226) + 0.08 * T);
  }
  return Math.sqrt(se / n);
}

const games = load();
console.log(`matchs : ${games.length} (2024-25 : ${games.filter((g) => g.season === 24).length}, 2025-26 : ${games.filter((g) => g.season === 25).length})`);
let bestR = { rmse: Infinity, K: 0, HCA: 0 };
for (const K of [0.01, 0.015, 0.02, 0.03, 0.04, 0.06]) for (const HCA of [0, 0.75, 1.5, 2.5]) {
  const rmse = rate(games, K, HCA, 0.7);
  if (rmse < bestR.rmse) bestR = { rmse, K, HCA };
}
rate(games, bestR.K, bestR.HCA, 0.7);
console.log(`note d'avant-match : K=${bestR.K}, terrain=${bestR.HCA}, erreur type ${bestR.rmse.toFixed(2)} pts`);

const train = games.filter((g) => g.season === 24 && g.date >= '2024-12-01');
const test = games.filter((g) => g.season === 25 && g.date >= '2025-11-15');

function score(P: NbaLiveParams, gs: G[], step = 1): number {
  let ll = 0;
  for (const g of gs) for (let e = 1; e <= 47; e += step) {
    const o = nbaLive(P, g.pre!, g.snaps[e].st);
    const M = g.reg[0] - g.reg[1];
    const z = (M - o.margin.mean) / o.margin.sd;
    ll += -0.5 * z * z - Math.log(o.margin.sd);
    const T = g.reg[0] + g.reg[1];
    const zt = (T - o.total.mean) / o.total.sd;
    ll += -0.5 * zt * zt - Math.log(o.total.sd);
  }
  return ll;
}
// Recherche par coordonnées sur la vraisemblance de l'écart et du total en fin de temps réglementaire.
const P: NbaLiveParams = { ...DEFAULT_NBA };
const keys: Array<[keyof NbaLiveParams, number[]]> = [
  ['s', [1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.6]], ['tau', [0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2]], ['kappa', [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]],
  ['luck', [0, 0.5, 0.75, 1, 1.25, 1.5]], ['run', [-0.15, -0.1, -0.05, 0, 0.05]], ['poss', [0, 0.4, 0.8, 1.2]], ['sT', [2.2, 2.4, 2.6, 2.8, 3, 3.2]], ['tauT', [0.01, 0.02, 0.03, 0.05, 0.1]],
];
for (let round = 0; round < 3; round++) {
  for (const [k, vals] of keys) {
    let best = { v: P[k] as number, ll: -Infinity };
    for (const v of vals) { const Q = { ...P, [k]: v }; const ll = score(Q, train, 2); if (ll > best.ll) best = { v, ll }; }
    (P as any)[k] = best.v;
  }
}
P.builtAt = new Date().toISOString().slice(0, 10);
writeFileSync(join(import.meta.dirname, '..', 'live', 'nba-params.json'), JSON.stringify(P));
console.log('coefficients :', JSON.stringify(P));

// ---------------------------------------------------------------------------------------------------------------------
const NAIVE: NbaLiveParams = { ...P, kappa: 0, luck: 0, run: 0, poss: 0 };
const CK = [0, 12, 24, 36, 42, 45, 47];
const TH = [0.7, 0.8, 0.85, 0.9, 0.95];
const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
const bin = () => Array.from({ length: 10 }, () => ({ n: 0, p: 0, ok: 0 }));
const cbB = bin(), cbN = bin(), ovB = bin();
let cbn = 0, cbBr = 0, cbBrN = 0;
console.log(`\n=== Contrôle 2025-26 (${test.length} matchs jamais vus) : vainqueur ===`);
console.log('minutes jouées | log-loss (sans les réglages live) | favori juste | pronostic >=70 % / 80 % / 85 % / 90 % / 95 % : réussite (part des matchs)');
for (const e of CK) {
  let ll = 0, lln = 0, hit = 0;
  const pk = TH.map(() => ({ n: 0, ok: 0 }));
  for (const g of test) {
    const st = g.snaps[e].st;
    const o = nbaLive(P, g.pre!, st), on = nbaLive(NAIVE, g.pre!, st);
    const hw = g.final[0] > g.final[1] ? 0 : 1;
    ll -= Math.log(Math.max(1e-9, o.win[hw])); lln -= Math.log(Math.max(1e-9, on.win[hw]));
    const fav = o.win[0] >= 0.5 ? 0 : 1;
    if (fav === hw) hit++;
    TH.forEach((T, i) => { if (Math.max(...o.win) >= T) { pk[i].n++; if (fav === hw) pk[i].ok++; } });
    if (o.comeback && e > 0) {
      const ok = hw === o.comeback.side ? 1 : 0;
      const b = cbB[Math.min(9, Math.floor(o.comeback.win * 10))]; b.n++; b.p += o.comeback.win; b.ok += ok;
      const bn = cbN[Math.min(9, Math.floor(on.comeback!.win * 10))]; bn.n++; bn.p += on.comeback!.win; bn.ok += ok;
      cbn++; cbBr += (o.comeback.win - ok) ** 2; cbBrN += (on.comeback!.win - ok) ** 2;
    }
    if (e > 0) { const line = Math.round(o.total.mean) + 0.5; const pO = o.over(line); const b = ovB[Math.min(9, Math.floor(pO * 10))]; b.n++; b.p += pO; b.ok += g.reg[0] + g.reg[1] > line ? 1 : 0; }
  }
  const n = test.length;
  console.log(`${String(e).padStart(2)} | ${(ll / n).toFixed(4)} (${(lln / n).toFixed(4)}) | ${pc(hit / n)} | ${pk.map((k) => (k.n ? `${pc(k.ok / k.n)} (${pc(k.n / n)})` : '-')).join(' | ')}`);
}
const table = (name: string, B: ReturnType<typeof bin>) => { console.log(`\n${name} : annoncé -> réel (situations)`); for (const b of B) if (b.n) console.log(`  ${pc(b.p / b.n).padStart(7)} -> ${pc(b.ok / b.n).padStart(7)}  (${b.n})`); };
table("Remontée (l'équipe menée gagne quand même), moteur complet", cbB);
table('Remontée, sans les réglages live (chance, avance qui fond, possession)', cbN);
console.log(`Brier remontée : ${(cbBr / cbn).toFixed(4)} (sans ${(cbBrN / cbn).toFixed(4)}), ${cbn} situations`);
table('Total : plus de la ligne la plus proche du total attendu', ovB);
