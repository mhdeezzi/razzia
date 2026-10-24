// Reconstruit tennis/index.json sur la branche resultats à partir des simulations tennis présentes (appelé par
// simulate-tennis.yml). Recalculé entièrement à chaque publication.
//   node src/cli/tennisindex.ts <dossier tennis> <ids publiés maintenant, séparés par des virgules>
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
  // Badges du programme : victime d'un chat noir, joueurs en hausse ou en baisse.
  const cat = s.blackCat ? s[s.blackCat.victim].name : undefined;
  const trend = { home: s.home.trend, away: s.away.trend };
  out.push({ id: s.id, day: s.day, start: s.start, tourney: s.tourney, round: s.round, home: s.home.name, away: s.away.name, pHome: s.pHome, at, cat, trend });
}
out.sort((a, b) => b.at.localeCompare(a.at));
writeFileSync(file, JSON.stringify(out));
console.log(`index tennis : ${out.length} simulations`);
