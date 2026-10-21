// Cibles de calibration : moyennes par équipe et par match (saison régulière 2025-26), et dispersion réelle.
import { loadGames } from '../nba/model/features.ts';
const games = loadGames().filter((x) => x.g.gameId.startsWith('00225'));
const keys = ['points', 'fieldGoalsAttempted', 'fieldGoalsMade', 'threePointersAttempted', 'threePointersMade', 'freeThrowsAttempted', 'freeThrowsMade', 'turnovers', 'reboundsOffensive', 'reboundsTotal', 'assists', 'steals', 'blocks', 'foulsPersonal'];
const acc: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
let n = 0;
const margins: number[] = [], totals: number[] = [], teamPts: number[] = [];
const ptsByTeam = new Map<number, number[]>();
for (const { g } of games) {
  for (const t of [g.home, g.away]) {
    n++;
    for (const k of keys) acc[k] += t.players.reduce((a, p) => a + (p.stats[k] ?? 0), 0);
    teamPts.push(t.score);
    (ptsByTeam.get(t.id) ?? ptsByTeam.set(t.id, []).get(t.id)!).push(t.score);
  }
  margins.push(g.home.score - g.away.score);
  totals.push(g.home.score + g.away.score);
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
for (const k of keys) console.log(k.padEnd(24), (acc[k] / n).toFixed(2));
console.log('FG%', (acc.fieldGoalsMade / acc.fieldGoalsAttempted * 100).toFixed(1), '3P%', (acc.threePointersMade / acc.threePointersAttempted * 100).toFixed(1), 'FT%', (acc.freeThrowsMade / acc.freeThrowsAttempted * 100).toFixed(1));
console.log('games', games.length, 'home margin', mean(margins).toFixed(2), 'margin sd', sd(margins).toFixed(2), 'total mean', mean(totals).toFixed(1), 'total sd', sd(totals).toFixed(2));
// Dispersion intra-équipe des points (écart-type des points d'une équipe autour de sa moyenne) : borne de ce qu'un modèle de match doit reproduire.
const within = [...ptsByTeam.values()].map((a) => sd(a));
console.log('sd intra-équipe des points marqués', mean(within).toFixed(2));
