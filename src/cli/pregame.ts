// Relance d'avant-match : liste les matchs qui débutent dans 5 à 30 minutes (absents annoncés environ 30 minutes avant),
// sauf ceux déjà simulés depuis l'annonce. Même règle que l'horloge du site (GET /api/sim?tick=1), dont ceci est le secours. Une ligne par match : "date away home". Appelé par avant-match.yml.
//   node src/cli/pregame.ts [index.json de la branche resultats]
import { existsSync, readFileSync } from 'node:fs';
import { getSchedule } from '../data/cdn.ts';

const indexFile = process.argv[2];
const index: Array<{ dir: string; at: string }> = indexFile && existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : [];
const now = Date.now();
const sched = await getSchedule(0.1);
for (const g of sched.games) {
  if (g.status !== 1 || !g.timeUTC) continue;
  const tip = Date.parse(g.timeUTC);
  const mins = (tip - now) / 60_000;
  if (mins < 5 || mins > 30) continue;
  const dir = `${g.date}_${g.away.tri}@${g.home.tri}`;
  const done = index.find((e) => e.dir === dir && Date.parse(e.at) >= tip - 35 * 60_000);
  if (done) continue;
  console.log(`${g.date} ${g.away.tri} ${g.home.tri}`);
}
