// Variance structurelle : σ de la marge / du total selon les effets aléatoires activés.
import { buildGameModel } from '../nba/model/build.ts';
import { calibratePace, runSims, summarize } from '../nba/engine/montecarlo.ts';
import { getGame } from '../data/cdn.ts';
const g = (await getGame('0022501000'))!;
const m = await buildGameModel({ date: g.date, homeTri: g.home.tri, awayTri: g.away.tri, actual: g, injuries: false, market: false, passes: false });
calibratePace(m);
const base = { ...m.params };
const variants: Record<string, Partial<typeof base>> = {
  'tous effets': {},
  'sans effets': { sdTeamNight: 0, sdTeam3Night: 0, sdPlayerNight: 0, sdUsage: 0, sdMinutes: 0, sdPace: 0 },
  'pace seul': { sdTeamNight: 0, sdTeam3Night: 0, sdPlayerNight: 0, sdUsage: 0, sdMinutes: 0 },
};
for (const [name, v] of Object.entries(variants)) {
  m.params = { ...base, ...v };
  const s = summarize(m, await runSims(m, 3000, 9));
  const blow = s.margin; void blow;
  console.log(`${name.padEnd(12)} marge σ ${s.margin.sd.toFixed(2)} | total σ ${s.total.sd.toFixed(2)} | pts dom σ ${s.homePts.sd.toFixed(2)} ext σ ${s.awayPts.sd.toFixed(2)} | poss ${s.poss.mean.toFixed(1)}±${s.poss.sd.toFixed(1)} | total ${s.total.mean.toFixed(1)}`);
}
