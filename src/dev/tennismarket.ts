// Tennis : notre moteur contre le marché (Pinnacle sans marge, tennis-data.co.uk), 2024-2026. Quand ils ne sont pas
// d'accord sur le favori, qui a raison ? Et quelle part de marché donne les meilleurs pronostics ?
//   node src/dev/tennismarket.ts
import { readFileSync } from 'node:fs';
import { loadHistory } from '../tennis/data.ts';
import { Ratings } from '../tennis/ratings.ts';
import { engineProb } from '../tennis/engine.ts';

type TD = { Date: string; Winner: string; Loser: string; PSW?: number; PSL?: number };
const td = (JSON.parse(readFileSync('data/cache/tennis/tennisdata/td.json', 'utf8')) as TD[]).filter((r) => r.PSW && r.PSL);
const short = (full: string) => {
  const p = full.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-']/g, ' ').trim().split(/\s+/);
  return `${p.slice(1).join(' ')} ${p[0][0]}`.toLowerCase();
};
const tdKey = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-'.]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const odds = new Map<string, TD[]>();
for (const r of td) { const k = `${tdKey(r.Winner)}|${tdKey(r.Loser)}`; (odds.get(k) ?? odds.set(k, []).get(k)!).push(r); }

const history = await loadHistory('data/cache/tennis/tml', 2015);
const R = new Ratings();
const rows: Array<{ pe: number; pm: number }> = []; // probabilités du vainqueur réel : moteur, marché
for (const m of history) {
  if (m.date >= '2024-01-01' && !m.walkover && !m.retired && m.level !== 'C' && !m.qual) {
    const c = odds.get(`${short(m.w.name)}|${short(m.l.name)}`)?.find((r) => Math.abs(Date.parse(r.Date) - Date.parse(m.date)) < 12 * 86_400_000);
    if (c) {
      const a = R.snapshot(m.w.id, m), b = R.snapshot(m.l.id, m);
      const pe = engineProb(R, a, b, m.surface, m.bo).p;
      const pm = (1 / c.PSW!) / (1 / c.PSW! + 1 / c.PSL!);
      rows.push({ pe, pm });
    }
  }
  R.update(m);
}
const lg = (p: number) => Math.log(p / (1 - p)), sg = (z: number) => 1 / (1 + Math.exp(-z));
console.log(`${rows.length} matchs du circuit reliés aux cotes`);
for (const w of [0, 0.25, 0.5, 0.75, 1]) {
  const ok = rows.filter((r) => sg((1 - w) * lg(r.pe) + w * lg(r.pm)) > 0.5).length;
  const ll = rows.reduce((s, r) => s - Math.log(sg((1 - w) * lg(r.pe) + w * lg(r.pm))), 0) / rows.length;
  console.log(`part du marché ${w * 100} % : bon vainqueur ${((ok / rows.length) * 100).toFixed(1)} %, log loss ${ll.toFixed(4)}`);
}
const dis = rows.filter((r) => (r.pe > 0.5) !== (r.pm > 0.5));
console.log(`moteur pas d'accord avec le marché : ${dis.length} fois (${((dis.length / rows.length) * 100).toFixed(1)} %), le moteur avait raison ${dis.filter((r) => r.pe > 0.5).length} fois`);
for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 0.7], [0.7, 1]]) {
  const d = dis.filter((r) => { const c = Math.max(r.pe, 1 - r.pe); return c >= lo && c < hi; });
  if (d.length) console.log(`  moteur sûr à ${lo * 100}-${hi * 100} % contre le marché : ${d.length} matchs, moteur juste ${((d.filter((r) => r.pe > 0.5).length / d.length) * 100).toFixed(0)} %`);
}
