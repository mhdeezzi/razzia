// Tennis : à partir de quel pourcentage du favori mettre « Un set » (ou « Deux sets ») devant la victoire ? Rejoue
// 2024-2026 (matchs du circuit reliés aux cotes Pinnacle) avec la probabilité affichée (moteur + marché) et compare le
// taux de bons pronostics selon le seuil. Probabilité d'un set déduite de celle du match (sets indépendants).
//   node src/dev/tennisthreshold.ts
import { readFileSync } from 'node:fs';
import { loadHistory } from '../tennis/data.ts';
import { Ratings } from '../tennis/ratings.ts';
import { blend, engineProb } from '../tennis/engine.ts';

type TD = { Date: string; Winner: string; Loser: string; PSW?: number; PSL?: number };
const td = (JSON.parse(readFileSync('data/cache/tennis/tennisdata/td.json', 'utf8')) as TD[]).filter((r) => r.PSW && r.PSL);
const norm = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-'.]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const short = (full: string) => { const p = norm(full).split(' '); return `${p.slice(1).join(' ')} ${p[0][0]}`; };
const odds = new Map<string, TD[]>();
for (const r of td) { const k = `${norm(r.Winner)}|${norm(r.Loser)}`; (odds.get(k) ?? odds.set(k, []).get(k)!).push(r); }

const winBo = (s: number, bo: 3 | 5) => bo === 3 ? s * s * (3 - 2 * s) : s ** 3 * (10 - 15 * s + 6 * s * s);
const setP = (p: number, bo: 3 | 5) => { let lo = 0, hi = 1; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; winBo(m, bo) < p ? (lo = m) : (hi = m); } return (lo + hi) / 2; };

const rows: Array<{ p: number; favWon: boolean; favSets: number; bo: 3 | 5 }> = [];
const R = new Ratings();
for (const m of await loadHistory('data/cache/tennis/tml', 2015)) {
  if (m.date >= '2024-01-01' && !m.walkover && !m.retired && m.level !== 'C' && !m.qual) {
    const c = odds.get(`${short(m.w.name)}|${short(m.l.name)}`)?.find((r) => Math.abs(Date.parse(r.Date) - Date.parse(m.date)) < 12 * 86_400_000);
    if (c) {
      const a = R.snapshot(m.w.id, m), b = R.snapshot(m.l.id, m);
      const pm = (1 / c.PSW!) / (1 / c.PSW! + 1 / c.PSL!);
      const p = blend(engineProb(R, a, b, m.surface, m.bo).p, pm); // probabilité du vainqueur réel
      const favIsW = p >= 0.5;
      rows.push({ p: Math.max(p, 1 - p), favWon: favIsW, favSets: favIsW ? m.wSets : m.lSets, bo: m.bo });
    }
  }
  R.update(m);
}
console.log(`${rows.length} matchs`);
for (const T of [1.0, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]) {
  let ok = 0, nSets = 0, okSets = 0, nWin = 0, okWin = 0;
  for (const r of rows) {
    const s = setP(r.p, r.bo);
    const lines = r.bo === 3 ? [{ need: 1, c: 1 - (1 - s) ** 2 }] : [{ need: 1, c: 1 - (1 - s) ** 3 }, { need: 2, c: 1 - (1 - s) ** 3 - 3 * s * (1 - s) ** 3 }];
    const L = lines.filter((x) => x.c <= 1 / 1.15 && x.c > r.p).sort((a, b) => b.c - a.c)[0];
    const sets = L && r.p <= T;
    const won = sets ? r.favWon || r.favSets >= L.need : r.favWon;
    ok += won ? 1 : 0;
    if (sets) { nSets++; okSets += won ? 1 : 0; } else { nWin++; okWin += won ? 1 : 0; }
  }
  console.log(`seuil ${T === 1 ? 'toujours « un set »' : `${T * 100} %`} : ${((ok / rows.length) * 100).toFixed(1)} % de bons pronos | « set » ${nSets} matchs à ${((okSets / Math.max(1, nSets)) * 100).toFixed(1)} % | « vainqueur » ${nWin} à ${((okWin / Math.max(1, nWin)) * 100).toFixed(1)} %`);
}
