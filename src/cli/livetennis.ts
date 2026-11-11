// Moteur live tennis : réglage de la forme du jour (durable / propre à chaque set) sur 2024, contrôle sur 2025-2026.
//   node src/cli/livetennis.ts        écrit src/live/tennis-params.json et affiche le contrôle
// Données : tennis-data.co.uk (scores de chaque set, cotes Pinnacle d'avant-match), matchs ATP terminés.
// On ne connaît pas l'ordre des jeux à l'intérieur d'un set : le contrôle se fait aux fins de set (après le 1er, le 2e…).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { calibrateTennis, DEFAULT_TENNIS, tennisLive, type TennisLiveParams, type TennisState } from '../live/tennis.ts';

const ROOT = join(import.meta.dirname, '..', '..');
type Row = Record<string, any>;
interface M { date: string; surface: string; bo: 3 | 5; p0: number; sets: Array<[number, number]>; aWins: boolean }

const rows = JSON.parse(readFileSync(join(ROOT, 'data', 'cache', 'tennis', 'td', 'td.json'), 'utf8')) as Row[];
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const ms: M[] = [];
for (const r of rows) {
  if (r.Comment !== 'Completed' || !r.PSW || !r.PSL) continue;
  const sets: Array<[number, number]> = [];
  for (let i = 1; i <= 5; i++) if (r[`W${i}`] != null && r[`L${i}`] != null) sets.push([Number(r[`W${i}`]), Number(r[`L${i}`])]);
  const bo: 3 | 5 = r['Best of'] === 5 ? 5 : 3;
  const need = bo === 5 ? 3 : 2;
  if (sets.filter(([a, b]) => a > b).length !== need) continue; // score incomplet ou étrange
  if (sets.some(([a, b]) => !((a >= 6 && a - b >= 2) || (b >= 6 && b - a >= 2) || (a === 7 && b === 6) || (a === 6 && b === 7) || (a > 6 && Math.abs(a - b) === 2)))) continue;
  const pw = (1 / r.PSW) / (1 / r.PSW + 1 / r.PSL);
  // Le gagnant n'est pas toujours « A » : sinon le contrôle serait faussé.
  const flip = hash(`${r.Date}${r.Winner}${r.Loser}`) % 2 === 1;
  ms.push({ date: r.Date, surface: r.Surface, bo, p0: flip ? 1 - pw : pw, sets: flip ? sets.map(([a, b]) => [b, a] as [number, number]) : sets, aWins: !flip });
}
const train = ms.filter((m) => m.date < '2025-01-01');
const test = ms.filter((m) => m.date >= '2025-01-01');
console.log(`matchs : ${ms.length} (réglage 2024 : ${train.length}, contrôle 2025-26 : ${test.length})`);

/** Log-loss aux fins de set (après 1 set, 2 sets…), avec la base calée sur la probabilité d'avant-match. */
function score(P: TennisLiveParams, list: M[]): number {
  let ll = 0, n = 0;
  for (const m of list) {
    const base = calibrateTennis(P, m.p0, m.surface, m.bo);
    for (let k = 1; k < m.sets.length; k++) {
      const o = tennisLive(P, base, { bestOf: m.bo, sets: m.sets.slice(0, k) });
      ll -= Math.log(Math.max(1e-9, m.aWins ? o.win[0] : o.win[1])); n++;
    }
  }
  return ll / n;
}

const sub = train.filter((_, i) => i % 3 === 0);
let best = { ll: Infinity, formSd: DEFAULT_TENNIS.formSd, setSd: DEFAULT_TENNIS.setSd };
for (const formSd of [0.1, 0.165, 0.24, 0.32]) for (const setSd of [0, 0.12, 0.24]) {
  const ll = score({ ...DEFAULT_TENNIS, formSd, setSd }, sub);
  console.log(`  forme du jour ${formSd}, variation par set ${setSd} : log-loss ${ll.toFixed(4)}`);
  if (ll < best.ll) best = { ll, formSd, setSd };
}
const P: TennisLiveParams = { ...DEFAULT_TENNIS, formSd: best.formSd, setSd: best.setSd, builtAt: new Date().toISOString().slice(0, 10) };
writeFileSync(join(ROOT, 'src', 'live', 'tennis-params.json'), JSON.stringify(P));
console.log(`retenu : forme du jour ${P.formSd}, variation par set ${P.setSd}`);

// ---------------------------------------------------------------------------------------------------------------------
// Contrôle : moteur complet contre la même chaîne de points sans révision de la forme (sets indépendants).
const NAIVE: TennisLiveParams = { ...P, formSd: 0.001, setSd: 0 };
const TH = [0.7, 0.8, 0.85, 0.9, 0.95];
const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
const bin = () => Array.from({ length: 10 }, () => ({ n: 0, p: 0, ok: 0 }));
const cbB = bin(), cbN = bin();
let cbn = 0, cbBr = 0, cbBrN = 0;
const byK = new Map<number, { n: number; ll: number; lln: number; hit: number; pk: Array<{ n: number; ok: number }> }>();
for (const m of test) {
  const base = calibrateTennis(P, m.p0, m.surface, m.bo), baseN = calibrateTennis(NAIVE, m.p0, m.surface, m.bo);
  for (let k = 0; k < m.sets.length; k++) {
    const st: TennisState = { bestOf: m.bo, sets: m.sets.slice(0, k) };
    const o = tennisLive(P, base, st), on = tennisLive(NAIVE, baseN, st);
    const w = m.aWins ? 0 : 1;
    const a = byK.get(k) ?? byK.set(k, { n: 0, ll: 0, lln: 0, hit: 0, pk: TH.map(() => ({ n: 0, ok: 0 })) }).get(k)!;
    a.n++;
    a.ll -= Math.log(Math.max(1e-9, o.win[w])); a.lln -= Math.log(Math.max(1e-9, on.win[w]));
    const fav = o.win[0] >= 0.5 ? 0 : 1;
    if (fav === w) a.hit++;
    TH.forEach((T, i) => { if (Math.max(...o.win) >= T) { a.pk[i].n++; if (fav === w) a.pk[i].ok++; } });
    if (o.comeback && k > 0) {
      const ok = o.comeback.side === w ? 1 : 0;
      const b = cbB[Math.min(9, Math.floor(o.comeback.win * 10))]; b.n++; b.p += o.comeback.win; b.ok += ok;
      const bn = cbN[Math.min(9, Math.floor(on.comeback!.win * 10))]; bn.n++; bn.p += on.comeback!.win; bn.ok += ok;
      cbn++; cbBr += (o.comeback.win - ok) ** 2; cbBrN += (on.comeback!.win - ok) ** 2;
    }
  }
}
console.log('\n=== Contrôle 2025-26 (matchs jamais vus) : vainqueur ===');
console.log('sets joués | situations | log-loss (sans révision de la forme) | favori juste | pronostic >=70 % / 80 % / 85 % / 90 % / 95 % : réussite (part)');
for (const [k, a] of [...byK].sort((x, y) => x[0] - y[0])) {
  console.log(`${k} | ${a.n} | ${(a.ll / a.n).toFixed(4)} (${(a.lln / a.n).toFixed(4)}) | ${pc(a.hit / a.n)} | ${a.pk.map((x) => (x.n ? `${pc(x.ok / x.n)} (${pc(x.n / a.n)})` : '-')).join(' | ')}`);
}
const table = (name: string, B: ReturnType<typeof bin>) => { console.log(`\n${name} : annoncé -> réel (situations)`); for (const b of B) if (b.n) console.log(`  ${pc(b.p / b.n).padStart(7)} -> ${pc(b.ok / b.n).padStart(7)}  (${b.n})`); };
table('Remontée (le joueur mené en sets gagne quand même), moteur complet', cbB);
table('Remontée, sans révision de la forme', cbN);
console.log(`Brier remontée : ${(cbBr / cbn).toFixed(4)} (sans ${(cbBrN / cbn).toFixed(4)}), ${cbn} situations`);
