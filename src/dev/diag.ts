// Diagnostic : modèle d'un match + statistiques simulées vs réalité.
import { buildGameModel } from '../nba/model/build.ts';
import { calibratePace, runSims, summarize } from '../nba/engine/montecarlo.ts';
import { getGame } from '../data/cdn.ts';

const [away, home, date, gid] = process.argv.slice(2);
const actual = gid ? await getGame(gid) : undefined;
const m = await buildGameModel({ date, homeTri: home, awayTri: away, actual, injuries: false, market: false, passes: false });
for (const t of [m.home, m.away]) {
  console.log(`\n${t.tri} pace=${t.pace.toFixed(1)} hcDur=${t.hcDurOff.toFixed(1)} defDur=${t.hcDurDef.toFixed(2)} foul=${t.foulRate.toFixed(3)} sw=${t.switchRate.toFixed(2)} tovF=${t.tovForceMult.toFixed(2)} trans=${JSON.stringify(Object.fromEntries(Object.entries(t.transOff).map(([k, v]) => [k, +v.toFixed(2)])))}`);
  for (const p of [...t.players].sort((a, b) => b.expMin - a.expMin)) {
    if (p.avail <= 0) { console.log(`  ${p.name.padEnd(26)} OUT ${p.status}`); continue; }
    const pres = p.presence.reduce((a, b) => a + b, 0);
    console.log(`  ${p.name.padEnd(26)} ${p.starter ? 'S' : ' '} exp=${p.expMin.toFixed(1)} pres=${pres.toFixed(1)} usg=${p.usg.toFixed(3)} fg=${p.fg.map((v) => v.toFixed(2)).join('/')} ft=${p.ft.toFixed(2)} orb=${p.orb.toFixed(3)} drb=${p.drb.toFixed(3)} dRim=${p.dRim.toFixed(2)} d3=${p.d3.toFixed(2)} stl=${p.stl.toFixed(3)} ${p.notes.join('; ')}`);
  }
}
const cal = calibratePace(m);
console.log('\npace', cal, 'durScale', m.params.durScale.toFixed(3));
const b = await runSims(m, 2000, 3);
const s = summarize(m, b);
console.log(`pHome ${s.pHome.toFixed(3)} margin ${s.margin.mean.toFixed(1)}±${s.margin.sd.toFixed(1)} total ${s.total.mean.toFixed(1)}±${s.total.sd.toFixed(1)} poss ${s.poss.mean.toFixed(1)} OT ${s.pOT.toFixed(3)}`);
for (const k of ['home', 'away'] as const) {
  const t = s.teamStats[k];
  console.log(`${k}: pts ${t.pts.toFixed(1)} fga ${t.fga.toFixed(1)} fg% ${(t.fgm / t.fga * 100).toFixed(1)} 3pa ${t.fg3a.toFixed(1)} 3p% ${(t.fg3m / t.fg3a * 100).toFixed(1)} fta ${t.fta.toFixed(1)} tov ${t.tov.toFixed(1)} oreb ${t.oreb.toFixed(1)} reb ${t.reb.toFixed(1)} ast ${t.ast.toFixed(1)} stl ${t.stl.toFixed(1)} blk ${t.blk.toFixed(1)} pf ${t.pf.toFixed(1)}`);
}
for (const p of s.players.filter((x) => x.playRate > 0.3).sort((a, b) => b.stats.min.mean - a.stats.min.mean)) {
  console.log(`  ${p.team} ${p.name.padEnd(26)} min ${p.stats.min.mean.toFixed(1)} pts ${p.stats.pts.mean.toFixed(1)} [${p.stats.pts.p10}-${p.stats.pts.p90}] reb ${p.stats.reb.mean.toFixed(1)} ast ${p.stats.ast.mean.toFixed(1)} | L10 ${p.form.ptsL10.toFixed(1)}pts ${p.form.minL10.toFixed(1)}min`);
}
if (actual) {
  console.log(`\nRÉEL ${actual.away.tri} ${actual.away.score} - ${actual.home.tri} ${actual.home.score}`);
  for (const t of [actual.home, actual.away]) for (const p of t.players.filter((x) => x.sec > 0)) console.log(`  ${t.tri} ${p.name.padEnd(26)} min ${(p.sec / 60).toFixed(1)} pts ${p.stats.points} reb ${p.stats.reboundsTotal} ast ${p.stats.assists}`);
}
