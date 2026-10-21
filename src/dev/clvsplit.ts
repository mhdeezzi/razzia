// L'edge à l'ouverture tient-il hors des gros mouvements de ligne (souvent liés aux forfaits annoncés tard) ?
import { readFileSync } from 'node:fs';
import { noVig } from '../data/espn.ts';
const rows = JSON.parse(readFileSync('out/backtests/props_rows.json', 'utf8')) as any[];
const profit = (o: number, w: boolean) => (w ? (o > 0 ? o / 100 : 100 / -o) : -1);
const R = rows.filter((r) => r.openLine != null && r.openA != null && r.openB != null && r.actual !== r.openLine);
const buckets: Record<string, (r: any) => boolean> = {
  'ligne inchangée': (r) => r.line === r.openLine,
  'mouvement ≤ 1': (r) => r.line !== r.openLine && Math.abs(r.line - r.openLine) <= 1,
  'mouvement > 1': (r) => Math.abs(r.line - r.openLine) > 1,
  'saison régulière': (r) => !r.playoffs,
  'playoffs': (r) => r.playoffs,
};
for (const [w, t] of [[0.5, 0.08], [0.3, 0.04], [0.5, 0.04]] as const) {
  console.log(`\nmélange ${w}, edge ≥ ${t * 100}%`);
  for (const [name, f] of Object.entries(buckets)) {
    let n = 0, won = 0, pnl = 0;
    const games = new Set<string>();
    for (const r of R.filter(f)) {
      const pm = noVig(r.openA, r.openB)[0];
      const p = w * r.pOverOpen + (1 - w) * pm;
      const e = p - pm;
      if (Math.abs(e) < t) continue;
      const over = e > 0;
      const y = r.actual > r.openLine ? 1 : 0;
      const win = over ? y === 1 : y === 0;
      n++; if (win) won++; pnl += profit(over ? r.openA : r.openB, win); games.add(r.date + r.game);
    }
    if (n) console.log(`  ${name.padEnd(18)} ${String(n).padStart(5)} paris (${games.size} matchs), gagnés ${(won / n * 100).toFixed(1)}%, ROI ${(pnl / n * 100).toFixed(1)}% ± ${(100 / Math.sqrt(n)).toFixed(1)}`);
  }
}
