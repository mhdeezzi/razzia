// Validation du parseur PBP : minutes inférées vs box score, convention des corners, cohérence des possessions.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readCache, CACHE_DIR } from '../data/http.ts';
import type { GameRecord } from '../data/cdn.ts';
import { parseGame } from '../nba/model/pbp.ts';

const ids = readdirSync(join(CACHE_DIR, 'games')).map((f) => f.replace('.json.gz', '')).sort();
let errSum = 0, n = 0, big = 0, lineupBad = 0, possTot = 0, gamesN = 0, ptsCheck = 0;
const corner: Record<string, number[]> = { 'Left Corner 3': [0, 0], 'Right Corner 3': [0, 0] };
const t0 = Date.now();
for (const id of ids) {
  const g = readCache<GameRecord>('games', id)!;
  for (const a of g.actions) if (a.ar && corner[a.ar] && a.x != null) corner[a.ar][a.x > 0 ? 0 : 1]++;
  const pg = parseGame(g);
  gamesN++;
  if (!pg.lineupOk) lineupBad++;
  for (const t of [g.home, g.away]) {
    for (const p of t.players) {
      if (p.sec <= 0) continue;
      const inf = pg.players.get(p.id)?.sec ?? 0;
      const e = Math.abs(inf - p.sec);
      errSum += e; n++;
      if (e > 120) big++;
    }
    const tg = pg.teams.get(t.id)!;
    if (tg.pts !== t.score) ptsCheck++;
  }
  for (const t of pg.teams.values()) possTot += t.poss;
}
console.log(`matchs ${gamesN} en ${Date.now() - t0} ms`);
console.log(`erreur moyenne minutes ${(errSum / n).toFixed(1)} s / joueur ; écarts > 2 min : ${big} / ${n} ; périodes à 5 incomplet : ${lineupBad}`);
console.log(`possessions moyennes par équipe et par match : ${(possTot / gamesN / 2).toFixed(1)} ; scores incohérents : ${ptsCheck}`);
console.log('corners (x>0, x<0):', JSON.stringify(corner));
