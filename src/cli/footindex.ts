// Reconstruit foot/index.json (branche resultats) à partir des simulations foot présentes (simulate-foot.yml).
//   node src/cli/footindex.ts <dossier foot> <ids publiés maintenant, séparés par des virgules>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, list = ''] = process.argv.slice(2);
const fresh = new Set(list.split(','));
const file = join(dir, 'index.json');
const before = new Map<string, { at: string }>();
if (existsSync(file)) for (const e of JSON.parse(readFileSync(file, 'utf8'))) before.set(e.id, e);
const out = [];
for (const f of existsSync(join(dir, 'sims')) ? readdirSync(join(dir, 'sims')) : []) {
  if (!f.endsWith('.json')) continue;
  const s = JSON.parse(readFileSync(join(dir, 'sims', f), 'utf8'));
  const at = fresh.has(s.id) || !before.has(s.id) ? new Date().toISOString() : before.get(s.id)!.at;
  out.push({ id: s.id, lg: s.lg, start: s.start, home: s.home.name, away: s.away.name, final: s.final, tier: s.tier, pick: s.pick ? { id: s.pick.id, label: s.pick.label, p: s.pick.p } : null, at, ...(s.market ? {} : { noOdds: true }), lineup: s.lineupType });
}
out.sort((a, b) => b.at.localeCompare(a.at));
writeFileSync(file, JSON.stringify(out));
console.log(`index foot : ${out.length} simulations`);
