import { Flashscore, type Board, type Detail, type Fields, type Match } from '../flashscore.ts';
import type { LiveSource, SourceMatch, SourceOptions } from '../source.ts';

const get = (fields: Fields, key: string) => fields.find(([k]) => k === key)?.[1];
const integer = (s: string | undefined): number | undefined => s != null && /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : undefined;
const setWon = ([a, b]: [number, number]) => {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6)) || (hi >= 8 && hi - lo === 2);
};

/** Score lu sur le tableau (jeux BA/BB…, points WA/WB, serveur WC) ; aucune fin de point inventée. */
export function flashscoreTennis(match: Match): SourceMatch['tennis'] {
  const sets: Array<[number, number]> = [];
  let games: [number, number] | undefined;
  for (const [a, b] of [['BA', 'BB'], ['BC', 'BD'], ['BE', 'BF'], ['BG', 'BH'], ['BI', 'BJ']]) {
    const h = integer(get(match.fields, a)), w = integer(get(match.fields, b));
    if (h == null && w == null) break;
    if (h == null || w == null || games) throw new Error('Score des sets Flashscore incomplet');
    const pair: [number, number] = [h, w];
    if (setWon(pair)) sets.push(pair);
    else games = pair;
  }
  const won: [number, number] = [sets.filter(([a, b]) => a > b).length, sets.filter(([a, b]) => b > a).length];
  if (match.score.some((value, i) => value == null || value !== won[i])) throw new Error('Score des sets Flashscore en cours de synchronisation');
  if (!sets.length && !games) throw new Error('Score des jeux Flashscore indisponible');
  const point = (key: string): number | undefined => {
    const value = get(match.fields, key);
    if (games?.[0] === 6 && games[1] === 6) return integer(value);
    return ({ '0': 0, '15': 1, '30': 2, '40': 3, A: 4, AD: 4 } as Record<string, number>)[value ?? ''];
  };
  const a = point('WA'), b = point('WB');
  const serving = get(match.fields, 'WC');
  return { sets, games, ...(games && a != null && b != null ? { points: [a, b] as [number, number] } : {}), ...(serving === '1' || serving === '2' ? { server: serving === '1' ? 0 as const : 1 as const } : {}) };
}

export function flashscoreSourceMatch(detail: Detail, board: Board): SourceMatch {
  const match = detail.match;
  if (board.stale || detail.feeds.statistics?.stale || !match.home || !match.away || match.state === 'unknown') throw new Error('Données Flashscore anciennes ou incomplètes : repli sur la source principale');
  const errors = { ...detail.errors };
  const { odds, ...native } = detail;
  let tennis: SourceMatch['tennis'];
  if (match.sport === 'tennis') {
    try { tennis = flashscoreTennis(match); }
    catch (error) { errors.tennisScore = error instanceof Error ? error.message : 'Score tennis indisponible'; }
  }
  // L'historique et les stats joueurs sont conservés dans leur format source. Un score point par point
  // ne donne pas la nature du coup (ace, faute directe…) : ne pas créer de faux événements/points typés.
  return {
    id: match.id, sport: match.sport, home: match.home, away: match.away, state: match.state, score: match.score,
    stats: detail.statistics.map((s) => ({ label: s.label, home: s.home, away: s.away, period: s.period })),
    tennis,
    quality: { at: detail.collectedAt, stale: false, complete: !Object.keys(errors).length, errors },
    native: { home: match.home, away: match.away, data: native },
    ...(odds ? { odds: { home: match.home, away: match.away, data: odds } } : {}),
  };
}

export function createFlashscoreSource(client = new Flashscore()): LiveSource {
  return {
    name: 'flashscore', sports: ['foot', 'nba', 'tennis'],
    ready: () => process.env.LIVE_FLASHSCORE !== '0',
    async live(sport) {
      const board = await client.board(sport);
      if (board.stale) throw new Error('Tableau Flashscore ancien');
      return board.matches.filter((m) => m.state === 'in' && m.home && m.away && (sport !== 'tennis' || (!m.home.includes('/') && !m.away.includes('/')))).map((m) => ({
        id: m.id, sport, home: m.home, away: m.away, start: m.start ?? undefined, tourney: m.league,
      }));
    },
    async match(sport, id, options: SourceOptions = {}) {
      const board = await client.board(sport);
      const match = board.matches.find((m) => m.id === id);
      if (!match) throw new Error('Match Flashscore absent du tableau');
      const detail = await client.detail(match, board, options);
      return flashscoreSourceMatch(detail, board);
    },
  };
}

export const flashscore = createFlashscoreSource();
