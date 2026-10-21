// Fidélité du moteur : taux simulés par 36 min vs taux réels (pondérés forme) des joueurs.
import { buildGameModel } from '../nba/model/build.ts';
import { calibratePace, runSims, summarize } from '../nba/engine/montecarlo.ts';
import { buildFeaturesCached } from '../nba/model/features.ts';
import { getGame } from '../data/cdn.ts';

const [away, home, date, gid] = process.argv.slice(2);
const actual = gid ? await getGame(gid) : undefined;
const m = await buildGameModel({ date, homeTri: home, awayTri: away, actual, injuries: false, market: false, passes: false });
calibratePace(m);
const b = await runSims(m, 2000, 5);
const s = summarize(m, b);
const f = buildFeaturesCached(date, () => 'W');
let sim3 = 0, real3 = 0, simF = 0, realF = 0, simFta = 0, realFta = 0;
console.log('joueur'.padEnd(24), 'FGA/36 sim/réel', ' 3PA/36 sim/réel', ' FTA/36 sim/réel', ' FG% sim/réel');
for (const p of s.players.filter((x) => x.stats.min.mean > 12)) {
  const pf = f.players.get(p.id);
  if (!pf || pf.sec < 3000) continue;
  const per36 = (v: number) => (v / (pf.sec / 60)) * 36;
  const fga = pf.fga.reduce((a, v) => a + v, 0);
  const fg3a = pf.fga[3] + pf.fga[4] + pf.fga[5];
  const fgm = pf.fgm.reduce((a, v) => a + v, 0);
  const sm = p.stats.min.mean;
  const sFga = (p.stats.fga.mean / sm) * 36, sF3 = (p.stats.fg3a.mean / sm) * 36, sFta = (p.stats.fta.mean / sm) * 36;
  sim3 += p.stats.fg3a.mean; simF += p.stats.fga.mean; simFta += p.stats.fta.mean;
  real3 += (fg3a / (pf.sec / 60)) * sm; realF += (fga / (pf.sec / 60)) * sm; realFta += (pf.fta / (pf.sec / 60)) * sm;
  console.log(p.name.padEnd(24), `${sFga.toFixed(1)}/${per36(fga).toFixed(1)}`.padStart(15), `${sF3.toFixed(1)}/${per36(fg3a).toFixed(1)}`.padStart(16), `${sFta.toFixed(1)}/${per36(pf.fta).toFixed(1)}`.padStart(16), `${(p.stats.fgm.mean / p.stats.fga.mean * 100).toFixed(1)}/${(fgm / fga * 100).toFixed(1)}`.padStart(14));
}
console.log(`\nTotal (minutes simulées) : FGA ${simF.toFixed(1)} vs ${realF.toFixed(1)} | 3PA ${sim3.toFixed(1)} vs ${real3.toFixed(1)} | FTA ${simFta.toFixed(1)} vs ${realFta.toFixed(1)}`);
