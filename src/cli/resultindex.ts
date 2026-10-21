// Reconstruit sims/index.json sur la branche resultats à partir des résumés présents (appelé par simulate.yml).
// Recalculé entièrement à chaque publication : deux simulations publiées en même temps ne peuvent pas entrer en conflit.
//   node src/cli/resultindex.ts <dossier sims> <match publié maintenant>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, fresh] = process.argv.slice(2);
const file = join(dir, 'index.json');
const before = new Map<string, { at: string }>();
if (existsSync(file)) for (const e of JSON.parse(readFileSync(file, 'utf8'))) before.set(e.dir, e);

const out = [];
for (const d of readdirSync(dir, { withFileTypes: true })) {
  const f = join(dir, d.name, 'summary.json');
  if (!d.isDirectory() || !existsSync(f)) continue;
  const s = JSON.parse(readFileSync(f, 'utf8'));
  const at = d.name === fresh || !before.has(d.name) ? new Date().toISOString() : before.get(d.name)!.at;
  out.push({ dir: d.name, pHome: s.pHome, pAway: s.pAway, at });
}
out.sort((a, b) => b.at.localeCompare(a.at));
writeFileSync(file, JSON.stringify(out));
console.log(`index : ${out.length} simulations`);
