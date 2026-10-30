// Simule tous les matchs d'une date et récapitule probabilités, lignes et meilleurs écarts sur les props.
//   node src/cli/slate.ts --date 2026-10-22 [--n 25000]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSchedule } from '../data/cdn.ts';
import { ROOT } from '../data/http.ts';
import { isCompetitiveGame } from '../nba/model/features.ts';
import { simulateMatchup } from './sim.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const date = arg('date', new Date().toISOString().slice(0, 10))!;
const n = Number(arg('n', '25000'));
const sched = await getSchedule(1);
const games = sched.games.filter((g) => g.date === date && isCompetitiveGame(g.gameId));
if (!games.length) {
  console.log(`Aucun match officiel le ${date}.`);
  process.exit(0);
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const lines: string[] = [`# Soirée NBA du ${date} — ${games.length} matchs, ${n} simulations chacun`, ''];
lines.push('| Match | Proba dom. (sims) | Livre (sans marge) | Score moyen | Spread | Couvre | Total | Over |');
lines.push('|---|---|---|---|---|---|---|---|');
const edges: Array<{ game: string; txt: string; edge: number }> = [];
for (const g of games) {
  console.log(`→ ${g.away.tri} @ ${g.home.tri}`);
  try {
    const { summary: s } = await simulateMatchup({ away: g.away.tri, home: g.home.tri, date, n, seed: 7, quiet: true });
    const mk = s.market;
    lines.push(`| ${g.away.tri} @ ${g.home.tri} | ${pct(s.pHome)} | ${mk?.bookHome != null ? pct(mk.bookHome) : '–'} | ${s.awayPts.mean.toFixed(1)}–${s.homePts.mean.toFixed(1)} | ${mk?.spreadHome ?? '–'} | ${mk?.pHomeCover != null ? pct(mk.pHomeCover) : '–'} | ${mk?.total ?? '–'} | ${mk?.pOver != null ? pct(mk.pOver) : '–'} |`);
    // Une seule ligne par joueur (ses props sont fortement corrélées entre elles).
    const seen = new Set<string>();
    const best = s.props.filter((x) => (x.edge ?? 0) > 0.03 && !seen.has(x.player) && seen.add(x.player));
    for (const p of best.slice(0, 5)) {
      edges.push({ game: `${g.away.tri}@${g.home.tri}`, edge: p.edge!, txt: `${p.player} ${p.lean === 'over' ? 'Over' : 'Under'} ${p.line} ${p.market.replace('Total ', '')} — ${pct(p.pLean!)} vs ${pct(p.lean === 'over' ? p.impliedOver! : 1 - p.impliedOver!)} (brut ${pct(p.edgeRaw!)}, confiance ${p.confidence}${p.confidenceWhy ? ` : ${p.confidenceWhy}` : ''})` });
    }
  } catch (e) {
    lines.push(`| ${g.away.tri} @ ${g.home.tri} | erreur : ${(e as Error).message} | | | | | | |`);
  }
}
lines.push('', '## Meilleurs écarts sur les props (probabilité mélangée au marché selon la confiance, vs DraftKings sans marge)');
for (const e of edges.sort((a, b) => b.edge - a.edge).slice(0, 25)) lines.push(`- [${e.game}] ${e.txt} (edge ${pct(e.edge)})`);
lines.push('', '_Les edges très élevés signalent souvent une information manquante (blessure tardive, minutes restreintes) : vérifier avant de parier._');
const out = lines.join('\n');
mkdirSync(join(ROOT, 'out'), { recursive: true });
writeFileSync(join(ROOT, 'out', `slate_${date}.md`), out);
console.log('\n' + out);
