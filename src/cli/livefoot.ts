// Moteur live foot : apprentissage des coefficients (profil des minutes, effets du score et des rouges, force du jour)
// sur les saisons passées, choix des réglages sur la saison suivante, puis contrôle sur une saison jamais vue.
//   node src/cli/livefoot.ts            apprend, contrôle sur 2025-26, écrit src/live/foot-params.json
// Données : fiches FotMob (tirs avec minute et xG, buts, rouges) et cotes d'avant-match (football-data.co.uk).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGames, type Game } from '../foot/data.ts';
import { DEFAULT_PARAMS, footLive, marketLambdas, type FootLiveParams, type FootTimeline, type Side } from '../live/foot.ts';

const TEST = new Set(['2025/2026', '2025']);
const VALID = new Set(['2024/2025', '2024']);
const LATER = new Set(['2026/2027', '2026']);

interface M { g: Game; lam: [number, number]; season: string; goals: Array<[number, Side]>; reds: Array<[number, Side]>; shots: Array<[number, Side, number]>; res: 0 | 1 | 2 }

function prep(games: Game[]): M[] {
  const out: M[] = [];
  let skipped = 0;
  for (const g of games) {
    if (!g.odds || LATER.has(g.season)) continue;
    const allMin = [...g.events.map((e) => e[1]), ...g.shots.map((s) => s[2])];
    if (allMin.some((m) => m > 91)) { skipped++; continue; } // prolongations
    if (!g.shots.length) { skipped++; continue; }
    const goals: Array<[number, Side]> = [], reds: Array<[number, Side]> = [];
    for (const [t, m, s] of g.events) {
      const mm = Math.max(1, Math.min(90, m));
      if (t === 'R') reds.push([mm, s as Side]);
      else goals.push([mm, s as Side]);
    }
    const sh = [0, 0];
    for (const [, s] of goals) sh[s]++;
    if (sh[0] !== g.score[0] || sh[1] !== g.score[1]) { skipped++; continue; }
    const lam = marketLambdas(g.odds);
    const res = g.score[0] > g.score[1] ? 0 : g.score[0] === g.score[1] ? 1 : 2;
    out.push({ g, lam, season: g.season, goals, reds, shots: g.shots.map((s) => [Math.max(1, Math.min(90, s[2])), s[0] as Side, s[5]]), res });
  }
  console.log(`matchs retenus : ${out.length} (écartés : ${skipped})`);
  return out;
}

/** Profil des minutes : part des buts marqués à chaque minute (45e et 90e : temps additionnel compris). */
function fitShare(ms: M[]): number[] {
  const c = new Array(91).fill(0);
  let tot = 0;
  for (const m of ms) for (const [mm] of m.goals) { c[mm]++; tot++; }
  // Lissage léger (moyenne sur 3 minutes) hors 45e/90e et bords.
  const s = c.map((v, i) => (i === 0 ? 0 : i === 45 || i === 90 || i === 1 || i === 44 || i === 46 || i === 89 ? v : (c[i - 1] + v + c[i + 1]) / 3));
  const z = s.reduce((a, b) => a + b, 0);
  return s.map((v) => v / z);
  void tot;
}

/** Parcourt chaque match minute par minute et appelle `row` avec l'état avant la minute m (force du jour comprise). */
function walk(P: FootLiveParams, ms: M[], row: (y: number, base: number, str: number, d: number, per: number, ro: number, rp: number) => void) {
  for (const x of ms) {
    const G = [new Int8Array(91), new Int8Array(91)], R = [new Int8Array(91), new Int8Array(91)];
    const X = [new Float64Array(91), new Float64Array(91)];
    for (const [m, s] of x.goals) G[s][m]++;
    for (const [m, s] of x.reds) R[s][m]++;
    for (const [m, s, v] of x.shots) X[s][m] += v;
    let gh = 0, ga = 0, rh = 0, ra = 0;
    const exp = [0, 0], xg = [0, 0], gl = [0, 0];
    const expM = [new Float64Array(91), new Float64Array(91)];
    for (let m = 1; m <= 90; m++) {
      const per = m <= 45 ? 0 : m <= 70 ? 1 : 2;
      for (const s of [0, 1] as const) {
        const d = Math.max(-2, Math.min(2, s === 0 ? gh - ga : ga - gh));
        const ro = (s === 0 ? rh : ra) > 0 ? 1 : 0, rp = (s === 0 ? ra : rh) > 0 ? 1 : 0;
        const base = x.lam[s] * P.share[m];
        const e = base * P.state[d + 2][per] * P.red[ro][rp];
        // Force du jour avec ce qui s'est passé jusqu'à la minute m-1.
        const kk = P.k * (x.lam[s] / 1.35);
        const obs = (1 - P.goalW) * xg[s] + P.goalW * gl[s];
        let str = (kk + obs) / (kk + exp[s]);
        if (m - 1 >= 10 && P.gamma) {
          let er = 0, xr = 0;
          for (let u = Math.max(1, m - 15); u < m; u++) { er += expM[s][u]; xr += X[s][u]; }
          const kr = 0.35 * (x.lam[s] / 1.35);
          str *= ((kr + xr) / (kr + er)) ** P.gamma;
        }
        row(G[s][m], base, str, d, per, ro, rp);
        expM[s][m] = e;
        exp[s] += e;
      }
      for (const s of [0, 1] as const) { xg[s] += X[s][m]; gl[s] += G[s][m]; }
      gh += G[0][m]; ga += G[1][m]; rh += R[0][m]; ra += R[1][m];
    }
  }
}

/** Effets du score et des rouges (Poisson, facteurs catégoriels ajustés tour à tour). */
function fitEffects(P: FootLiveParams, ms: M[], passes = 4): void {
  for (let it = 0; it < passes; it++) {
    const num = Array.from({ length: 5 }, () => [0, 0, 0]), den = Array.from({ length: 5 }, () => [0, 0, 0]);
    walk(P, ms, (y, base, str, d, per, ro, rp) => { num[d + 2][per] += y; den[d + 2][per] += base * str * P.red[ro][rp]; });
    for (let d = 0; d < 5; d++) for (let p = 0; p < 3; p++) P.state[d][p] = den[d][p] > 0 ? num[d][p] / den[d][p] : 1;
    const rn = [[0, 0], [0, 0]], rd = [[0, 0], [0, 0]];
    walk(P, ms, (y, base, str, d, per, ro, rp) => { rn[ro][rp] += y; rd[ro][rp] += base * str * P.state[d + 2][per]; });
    for (const a of [0, 1]) for (const b of [0, 1]) P.red[a][b] = rd[a][b] > 0 ? rn[a][b] / rd[a][b] : 1;
    // Rouges rares : rétrécis vers 1 (100 buts d'a priori), normalisés sur la case sans rouge.
    const n0 = P.red[0][0];
    for (const a of [0, 1]) for (const b of [0, 1]) { const w = rn[a][b] / (rn[a][b] + 100); P.red[a][b] = (w * P.red[a][b]) / n0 + (1 - w); }
    P.red[0][0] = 1;
    for (let d = 0; d < 5; d++) for (let p = 0; p < 3; p++) P.state[d][p] *= n0;
  }
}

function loglik(P: FootLiveParams, ms: M[]): number {
  let ll = 0;
  walk(P, ms, (y, base, str, d, per, ro, rp) => { const r = base * str * P.state[d + 2][per] * P.red[ro][rp]; ll += y * Math.log(r) - r; });
  return ll;
}

const clone = (P: FootLiveParams): FootLiveParams => JSON.parse(JSON.stringify(P));

function timeline(x: M, t: number): FootTimeline {
  return { minute: t, goals: x.goals.filter(([m]) => m <= t), reds: x.reds.filter(([m]) => m <= t), shots: x.shots.filter(([m]) => m <= t) };
}

// ---------------------------------------------------------------------------------------------------------------------
const all = prep(loadGames());
const train = all.filter((x) => !TEST.has(x.season) && !VALID.has(x.season));
const valid = all.filter((x) => VALID.has(x.season));
const test = all.filter((x) => TEST.has(x.season));
console.log(`apprentissage ${train.length}, réglage ${valid.length}, contrôle ${test.length}`);

// Effets du score appris sans force du jour (le réglage sur le résultat final décide ensuite s'il faut l'ajouter).
const P0 = { ...clone(DEFAULT_PARAMS), k: 1e9, gamma: 0 };
P0.share = fitShare(train);
fitEffects(P0, train);

// Réglages de la force du jour : choisis sur la saison de réglage.
let best = { ll: -Infinity, k: 0, goalW: 0, gamma: 0 };
const baseLL = loglik({ ...P0, k: 1e9, gamma: 0 }, valid);
for (const k of [0.6, 1, 1.5, 2.5, 4, 8]) for (const goalW of [0, 0.25, 0.5]) for (const gamma of [0, 0.15, 0.3]) {
  const ll = loglik({ ...P0, k, goalW, gamma }, valid);
  if (ll > best.ll) best = { ll, k, goalW, gamma };
}
console.log(`force du jour : k=${best.k} goalW=${best.goalW} gamma=${best.gamma} (gain de vraisemblance ${(best.ll - baseLL).toFixed(1)} sur ${valid.length} matchs)`);

// Réglage sur ce qu'on veut vraiment prévoir : le résultat final depuis plusieurs moments du match (saison de réglage).
{
  const sub = valid.filter((_, i) => i % 3 === 0);
  const score = (Q: FootLiveParams) => {
    let ll = 0, n = 0;
    for (const x of sub) for (const t of [20, 45, 60, 70, 80]) {
      const o = footLive(Q, x.lam, timeline(x, t));
      ll -= Math.log(Math.max(1e-9, o.p1x2[x.res])); n++;
      if (o.comeback) { const tr = o.comeback.side; const av = tr === 0 ? x.res !== 2 : x.res !== 0; ll -= Math.log(Math.max(1e-9, av ? o.comeback.draw : 1 - o.comeback.draw)); n++; }
    }
    return ll / n;
  };
  let b2 = { s: Infinity, stateK: 1, closeLate: 1, trail: 1, k: best.k, goalW: best.goalW, gamma: best.gamma };
  for (const stateK of [1, 1.5, 2]) for (const closeLate of [1, 1.1]) for (const trail of [1, 1.1, 1.2, 1.3]) for (const k of [1e9]) {
    const s = score({ ...P0, stateK, closeLate, trail, k, goalW: best.goalW, gamma: k > 1e8 ? 0 : best.gamma });
    if (s < b2.s) b2 = { s, stateK, closeLate, trail, k, goalW: best.goalW, gamma: k > 1e8 ? 0 : best.gamma };
  }
  console.log(`réglage sur le résultat final : effet du score x${b2.stateK}, fin de match serrée x${b2.closeLate}, remontée x${b2.trail}, k=${b2.k}, goalW=${b2.goalW}, gamma=${b2.gamma}`);
  (P0 as FootLiveParams).trail = b2.trail;
  best = { ...best, k: b2.k, goalW: b2.goalW, gamma: b2.gamma };
  (P0 as FootLiveParams).stateK = b2.stateK; (P0 as FootLiveParams).closeLate = b2.closeLate;
}

// Coefficients finaux : appris sur apprentissage + réglage avec les réglages retenus.
const P: FootLiveParams = { ...clone(P0), k: 1e9, gamma: 0, builtAt: new Date().toISOString().slice(0, 10) };
const fitSet = [...train, ...valid];
P.share = fitShare(fitSet);
fitEffects(P, fitSet);
Object.assign(P, { stateK: P0.stateK, closeLate: P0.closeLate, trail: P0.trail, k: best.k, goalW: best.goalW, gamma: best.gamma });
writeFileSync(join(import.meta.dirname, '..', 'live', 'foot-params.json'), JSON.stringify(P, (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v)));
console.log('effet du score (écart -2..+2 x période) :', P.state.map((r) => r.map((v) => v.toFixed(2)).join(' ')).join(' | '));
console.log('rouges [nous][eux] :', P.red.map((r) => r.map((v) => v.toFixed(2)).join(' ')).join(' | '));

// ---------------------------------------------------------------------------------------------------------------------
// Contrôle sur la saison jamais vue.
const CK = [0, 15, 30, 45, 60, 70, 80, 85];
const TH = [0.7, 0.8, 0.85, 0.9, 0.95];
const NAIVE: FootLiveParams = { ...P, k: 1e9, gamma: 0, stateK: 1, closeLate: 1, trail: 1 }; // même moteur sans force du jour (score et temps seulement)
type Acc = { n: number; ll: number; br: number; hit: number; nll: number; nbr: number; pk: Array<{ n: number; ok: number }> };
const acc = new Map<number, Acc>(CK.map((c) => [c, { n: 0, ll: 0, br: 0, hit: 0, nll: 0, nbr: 0, pk: TH.map(() => ({ n: 0, ok: 0 })) }]));
const cb: Array<{ t: number; pd: number; pw: number; okD: number; okW: number; nd: number; nw: number }> = [];
const bins = (p: number) => Math.min(9, Math.floor(p * 10));
const cbBins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, ok: 0 }));
const cbNaive = Array.from({ length: 10 }, () => ({ n: 0, p: 0, ok: 0 }));
const ngBins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, ok: 0 }));
const soonBins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, ok: 0 }));
let cbN = 0, cbBr = 0, cbBrN = 0;
for (const x of test) {
  for (const t of CK) {
    const tl = timeline(x, t);
    const o = footLive(P, x.lam, tl), on = footLive(NAIVE, x.lam, tl);
    const a = acc.get(t)!;
    a.n++;
    const p = o.p1x2, q = on.p1x2;
    a.ll -= Math.log(Math.max(1e-9, p[x.res])); a.nll -= Math.log(Math.max(1e-9, q[x.res]));
    a.br += p.reduce((s, v, i) => s + (v - (i === x.res ? 1 : 0)) ** 2, 0);
    a.nbr += q.reduce((s, v, i) => s + (v - (i === x.res ? 1 : 0)) ** 2, 0);
    if (p.indexOf(Math.max(...p)) === x.res) a.hit++;
    // Pronostic le plus sûr parmi 1, N, 2 et les doubles chances (1N, N2, 12).
    const opts: Array<[number, (r: number) => boolean]> = [[p[0], (r) => r === 0], [p[1], (r) => r === 1], [p[2], (r) => r === 2], [p[0] + p[1], (r) => r !== 2], [p[1] + p[2], (r) => r !== 0], [p[0] + p[2], (r) => r !== 1]];
    // Parmi ceux qui passent le seuil, le moins probable (le plus « payé »), comme les pronostics du site.
    TH.forEach((T, i) => {
      const ok = opts.filter(([v]) => v >= T).sort((u, w) => u[0] - w[0])[0];
      if (ok) { a.pk[i].n++; if (ok[1](x.res)) a.pk[i].ok++; }
    });
    if (o.comeback && t > 0) {
      const tr = o.comeback.side;
      const avoided = tr === 0 ? x.res !== 2 : x.res !== 0;
      const b = cbBins[bins(o.comeback.draw)]; b.n++; b.p += o.comeback.draw; b.ok += avoided ? 1 : 0;
      const bn = cbNaive[bins(on.comeback!.draw)]; bn.n++; bn.p += on.comeback!.draw; bn.ok += avoided ? 1 : 0;
      cbN++; cbBr += (o.comeback.draw - (avoided ? 1 : 0)) ** 2; cbBrN += (on.comeback!.draw - (avoided ? 1 : 0)) ** 2;
    }
    // Prochain but (domicile) et but dans les 10 minutes.
    const nextG = x.goals.find(([m]) => m > t);
    const nb = ngBins[bins(o.nextGoal[0])]; nb.n++; nb.p += o.nextGoal[0]; nb.ok += nextG && nextG[1] === 0 ? 1 : 0;
    if (t < 80) for (const s of [0, 1] as const) {
      const sb = soonBins[bins(o.goalSoon[s])]; sb.n++; sb.p += o.goalSoon[s]; sb.ok += x.goals.some(([m, ss]) => ss === s && m > t && m <= t + 10) ? 1 : 0;
    }
  }
}
void cb;
const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
console.log('\n=== Contrôle 2025-26 (matchs jamais vus) : résultat final 1N2 ===');
console.log('minute | matchs | log-loss (moteur sans réglages live) | Brier (sans) | favori juste | pronostic >=70 % / 80 % / 85 % / 90 % / 95 % : réussite (part des matchs)');
for (const t of CK) {
  const a = acc.get(t)!;
  const pk = a.pk.map((k) => (k.n ? `${pc(k.ok / k.n)} (${pc(k.n / a.n)})` : '-')).join(' | ');
  console.log(`${String(t).padStart(2)}' | ${a.n} | ${(a.ll / a.n).toFixed(4)} (${(a.nll / a.n).toFixed(4)}) | ${(a.br / a.n).toFixed(4)} (${(a.nbr / a.n).toFixed(4)}) | ${pc(a.hit / a.n)} | ${pk}`);
}
const table = (name: string, B: typeof cbBins) => {
  console.log(`\n${name} : annoncé -> réel (situations)`);
  for (const b of B) if (b.n) console.log(`  ${pc(b.p / b.n).padStart(7)} -> ${pc(b.ok / b.n).padStart(7)}  (${b.n})`);
};
table('Remontée (l\'équipe menée évite la défaite), moteur complet', cbBins);
table('Remontée, sans facteur de remontée ni réglages de fin de match', cbNaive);
console.log(`Brier remontée : ${(cbBr / cbN).toFixed(4)} (sans facteur de remontée ${(cbBrN / cbN).toFixed(4)}), ${cbN} situations`);
table('Prochain but pour le domicile', ngBins);
table('But dans les 10 minutes (par équipe)', soonBins);
