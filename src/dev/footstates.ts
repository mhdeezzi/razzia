// Effet du score mesuré sur les matchs réels : rythme de tirs et qualité des tirs (xG par tir) d'une équipe quand elle
// mène, quand elle est menée, par rapport à quand le score est égal, à équipe et match égaux (effet fixe par
// équipe-match), en distinguant la première heure et la dernière demi-heure. Effet d'un carton rouge pareil.
import { loadGames } from '../foot/data.ts';

const games = loadGames().filter((g) => g.shots.length && g.xg && [47, 87, 55, 54, 53, 42, 73].includes(g.lg));
type Seg = { st: number; late: number; bin: number; red: number; min: number; shots: number; xg: number };
const segs: Seg[][] = [];
for (const g of games) {
  const goals = g.events.filter((e) => e[0] !== 'R').map((e) => ({ t: e[1], side: e[0] === 'OG' ? e[2] : e[2] })).sort((a, b) => a.t - b.t);
  const reds = g.events.filter((e) => e[0] === 'R');
  for (const side of [0, 1]) {
    const per: Seg[] = [];
    for (let t = 0; t < 95; t++) {
      const gf = goals.filter((x) => x.t < t && x.side === side).length, ga = goals.filter((x) => x.t < t && x.side !== side).length;
      const st = Math.sign(gf - ga);
      const rOwn = reds.some((r) => r[2] === side && r[1] < t), rOpp = reds.some((r) => r[2] !== side && r[1] < t);
      const red = rOwn && !rOpp ? -1 : rOpp && !rOwn ? 1 : 0;
      const late = t >= 60 ? 1 : 0, bin = Math.min(5, Math.floor(t / 15));
      let s = per.find((x) => x.st === st && x.bin === bin && x.red === red);
      if (!s) { s = { st, late, bin, red, min: 0, shots: 0, xg: 0 }; per.push(s); }
      s.min++;
      for (const sh of g.shots) if (sh[0] === side && sh[2] === t && sh[6] !== 8) { s.shots++; s.xg += sh[5]; }
    }
    segs.push(per);
  }
}
// Effets fixes équipe-match + effets d'état (Poisson), par itérations.
const keys = ['lead-early', 'lead-late', 'trail-early', 'trail-late', 'b1', 'b2', 'b3', 'b4', 'b5', 'redOwn', 'redOpp'];
const kOf = (s: Seg) => [s.st > 0 ? (s.late ? 'lead-late' : 'lead-early') : s.st < 0 ? (s.late ? 'trail-late' : 'trail-early') : '', s.bin ? `b${s.bin}` : '', s.red < 0 ? 'redOwn' : s.red > 0 ? 'redOpp' : ''].filter(Boolean);
for (const what of ['shots', 'xg'] as const) {
  const beta: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const alpha = segs.map(() => 0);
  for (let it = 0; it < 30; it++) {
    segs.forEach((per, i) => { const y = per.reduce((s, x) => s + x[what], 0); const e = per.reduce((s, x) => s + x.min * Math.exp(kOf(x).reduce((t, k) => t + beta[k], 0)), 0); alpha[i] = Math.log(Math.max(1e-6, y) / e); });
    for (const k of keys) {
      let y = 0, e = 0;
      segs.forEach((per, i) => { for (const x of per) if (kOf(x).includes(k)) { y += x[what]; e += x.min * Math.exp(alpha[i] + kOf(x).reduce((t, kk) => t + beta[kk], 0)); } });
      beta[k] += Math.log(y / e);
    }
  }
  console.log(what, Object.fromEntries(keys.map((k) => [k, +Math.exp(beta[k]).toFixed(3)])));
}
console.log('matchs', games.length);
