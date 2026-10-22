// Ingestion des données NBA : tous les matchs (PBP + box) de la saison précédente et de la saison en cours,
// plus les tableaux de saison (Synergy, tracking défensif, catch & shoot / pull-up, matchups, stats avancées).
//   node src/cli/ingest.ts            -> tout
//   node src/cli/ingest.ts --games    -> uniquement les matchs
//   node src/cli/ingest.ts --stats    -> uniquement les tableaux de saison
import { getGame, getSchedule } from '../data/cdn.ts';
import { pool } from '../data/http.ts';
import * as S from '../data/nbaStats.ts';
import { seasonsInScope } from '../nba/seasons.ts';
import { isCompetitiveGame } from '../nba/model/features.ts';

const args = new Set(process.argv.slice(2));
const doGames = args.has('--games') || (!args.has('--stats'));
const doStats = args.has('--stats') || (!args.has('--games'));

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function listGameIds(season: string, current: string): Promise<string[]> {
  const ttl = S.ttlFor(season, current);
  const ids = new Set<string>();
  for (const st of [S.SEASON_TYPES.regular, S.SEASON_TYPES.playin, S.SEASON_TYPES.playoffs]) {
    const rows = await S.teamGameLog(season, st, ttl).catch(() => []);
    for (const r of rows) ids.add(String(r.GAME_ID));
  }
  return [...ids].sort();
}

async function ingestGames(): Promise<void> {
  const sched = await getSchedule(1);
  const { prev2, prev, cur } = seasonsInScope(sched.season);
  // Deux saisons d'historique : indispensable pour les joueurs revenant d'une saison blanche (blessure longue).
  const prevIds = [...(await listGameIds(prev2, cur)), ...(await listGameIds(prev, cur))];
  const curDone = sched.games.filter((g) => g.status === 3 && isCompetitiveGame(g.gameId)).map((g) => g.gameId);
  const curLog = await listGameIds(cur, cur);
  const all = [...new Set([...prevIds, ...curDone, ...curLog])];
  log(`matchs à récupérer : ${all.length} (${prev2}+${prev}: ${prevIds.length}, ${cur}: ${new Set([...curDone, ...curLog]).size})`);
  let done = 0;
  let missing = 0;
  await pool(all, 8, async (id) => {
    const g = await getGame(id);
    if (!g) missing++;
    if (++done % 100 === 0) log(`  ${done}/${all.length}`);
  });
  log(`matchs OK : ${done - missing}, indisponibles : ${missing}`);
  // Pré-saison de la saison en cours : stockée à part, utilisée uniquement pour la hiérarchie des rotations.
  const pre = sched.games.filter((g) => g.status === 3 && g.gameId.startsWith('001'));
  await pool(pre, 8, (g) => getGame(g.gameId, { ns: '_preseason' }));
  log(`pré-saison : ${pre.length} matchs (rôles dans les nouvelles rotations)`);
}

async function ingestSeasonTables(season: string, current: string): Promise<void> {
  const ttl = S.ttlFor(season, current);
  const types = [S.SEASON_TYPES.regular, S.SEASON_TYPES.playoffs];
  log(`tableaux ${season}`);
  await S.playerIndex(current, 6);
  for (const st of types) {
    await S.playerDash(season, st, 'Base', ttl).catch(() => []);
    await S.playerDash(season, st, 'Advanced', ttl).catch(() => []);
    await S.teamDash(season, st, 'Advanced', ttl).catch(() => []);
    await S.teamDash(season, st, 'Four Factors', ttl).catch(() => []);
  }
  for (const st of types) {
    for (const pt of S.PLAY_TYPES) {
      for (const who of ['P', 'T'] as const) {
        for (const grp of ['offensive', 'defensive'] as const) {
          if (who === 'P' && grp === 'defensive' && pt !== 'Isolation' && pt !== 'PRBallHandler' && pt !== 'PRRollman' && pt !== 'Postup' && pt !== 'Spotup' && pt !== 'Handoff' && pt !== 'OffScreen') continue;
          await S.synergy(season, st, pt, who, grp, ttl).catch((e) => log('  synergy KO', pt, who, grp, e.message));
        }
      }
    }
    log(`  synergy ${st} OK`);
    for (const cat of S.DEFENSE_CATEGORIES) await S.ptDefend(season, st, cat, ttl).catch(() => []);
    for (const m of ['CatchShoot', 'PullUpShot', 'Drives', 'Passing', 'Rebounding'] as const) await S.ptStats(season, st, m, 'Player', ttl).catch(() => []);
    if (st === S.SEASON_TYPES.regular) {
      for (const range of S.CLOSE_DEF) {
        await S.closeDefShots(season, st, range, 'Player', ttl).catch(() => []);
        await S.closeDefShots(season, st, range, 'Opp', ttl).catch(() => []);
      }
    }
    log(`  tracking ${st} OK`);
  }
  // Matchups défensifs (qui défend sur qui) — par équipe en défense, saison régulière.
  const teams = await S.teamDash(season, S.SEASON_TYPES.regular, 'Advanced', ttl).catch(() => []);
  for (const t of teams) await S.seasonMatchups(season, S.SEASON_TYPES.regular, ttl, { defTeam: t.TEAM_ID }).catch(() => []);
  log(`  matchups ${season} OK (${teams.length} équipes)`);
}

const sched = await getSchedule(1);
const { prev2, prev, cur } = seasonsInScope(sched.season);
log(`saison courante ${cur}, saisons précédentes ${prev} et ${prev2}`);
if (doStats) {
  await ingestSeasonTables(prev2, cur);
  await ingestSeasonTables(prev, cur);
  await ingestSeasonTables(cur, cur);
}
if (doGames) await ingestGames();
log('ingestion terminée');
