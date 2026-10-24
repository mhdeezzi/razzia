// Reconstruit tennis/index.json sur la branche resultats à partir des simulations tennis présentes (appelé par
// simulate-tennis.yml). Recalculé entièrement à chaque publication.
//   node src/cli/tennisindex.ts <dossier tennis> <ids publiés maintenant, séparés par des virgules>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, list = ''] = process.argv.slice(2);
// Pile ou face, même règle que la fiche (web/src/tennispicks.ts) : la ligne de sets passe devant le vainqueur, c'est-à-dire
// favori à 80 % ou moins (ou outsider en hausse) avec une ligne de sets qui paie encore 1,15 et passe plus souvent ;
// jamais quand l'outsider est la victime d'un chat noir du favori.
const shown = (p: number) => Math.round(p * 1000) / 1000;
function flipOf(s: any): boolean {
  const side = s.pHome >= 0.5 ? 'home' : 'away', i = side === 'home' ? 0 : 1, winP = Math.max(s.pHome, 1 - s.pHome);
  const dogUp = s[side === 'home' ? 'away' : 'home'].trend === 'up';
  if (s.blackCat && s.blackCat.victim !== side) return false;
  const lines = s.bestOf === 5 ? [s.sim.atLeast1[i], s.sim.atLeast2[i]] : [s.sim.atLeast1[i]];
  return lines.some((c: number) => (dogUp || c <= 1 / 1.15) && c > winP) && (dogUp || shown(winP) <= 0.8);
}
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
  const goal = s.home.goal || s.away.goal ? { home: s.home.goal, away: s.away.goal } : undefined;
  out.push({ id: s.id, day: s.day, start: s.start, tourney: s.tourney, round: s.round, home: s.home.name, away: s.away.name, pHome: s.pHome, at, cat, trend, goal, flip: flipOf(s) });
}
out.sort((a, b) => b.at.localeCompare(a.at));
writeFileSync(file, JSON.stringify(out));
console.log(`index tennis : ${out.length} simulations`);
