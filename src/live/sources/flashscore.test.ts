import test from 'node:test';
import assert from 'node:assert/strict';
import { Flashscore, parseBoard, type Board, type Detail, type Match } from '../flashscore.ts';
import { GET } from '../api.ts';
import { enrich, SOURCES, swap, type LiveSource, type SourceMatch } from '../source.ts';
import { createFlashscoreSource, flashscoreTennis } from './flashscore.ts';
import { sameParticipant } from './matching.ts';

const settings = 'window.environment = {"config":{"app":{"feed_sign":"fixture"}}};';
const tennisBoard = (extra = '') => 'ZA÷ATP Test Singles¬~AA÷test0001¬AB÷2¬AE÷Tomic B.¬AF÷Jasika O.¬JA÷home0001¬JB÷away0001¬AG÷1¬AH÷0¬BA÷7¬BB÷6¬BC÷2¬BD÷2¬WA÷15¬WB÷30¬WC÷1¬' + extra + '~';
const nbaBoard = 'ZA÷USA: NBA¬~AA÷nba00001¬AB÷2¬AE÷Los Angeles Lakers¬AF÷Golden State Warriors¬AG÷62¬AH÷60¬~';
const footBoard = 'ZA÷France: Ligue 1¬~AA÷foot0001¬AB÷2¬AE÷Paris SG¬AF÷FC Nantes¬AG÷1¬AH÷0¬~';
const stats = 'SE÷Match¬~SF÷Service¬~SG÷Service Points Won¬SH÷60% (30/50)¬SI÷55% (22/40)¬~SG÷New provider stat¬SH÷custom value¬~';
const reply = (raw: string) => new Response(raw, { headers: { Age: '7' } });
const json = (value: unknown) => Response.json(value);
const boardOf = (raw = tennisBoard(), sport: Board['sport'] = 'tennis') => parseBoard(sport, { raw, fetchedAt: '2026-11-11T08:00:00Z', sourceDate: null, ageSeconds: 7 });
const matchOf = (fields: Record<string, string>, score: Match['score'] = [0, 0]): Match => ({ ...boardOf().matches[0], score, fields: Object.entries(fields) });
function fixture() {
  const state = { now: 0, failing: false, statisticsFail: false, board: tennisBoard(), oddsCalls: 0 };
  const client = new Flashscore({ now: () => state.now, ttlMs: 0, fetch: async (url) => {
    const u = new URL(String(url));
    if (state.failing) return new Response('', { status: 403 });
    if (u.hostname === 'www.flashscore.com') return reply(settings);
    if (u.hostname.endsWith('flashscore.ninja')) {
      if (u.pathname.includes('/f_2_')) return reply(state.board);
      if (u.pathname.includes('/f_3_')) return reply(nbaBoard);
      if (u.pathname.includes('/f_1_')) return reply(footBoard);
      if (u.pathname.includes('df_st_')) return state.statisticsFail ? new Response('', { status: 500 }) : reply(stats);
      return reply('A1÷version¬~');
    }
    state.oddsCalls++;
    if (u.searchParams.get('_hash') === 'oce') return json({ data: { findOddsByEventId: { eventId: u.searchParams.get('eventId'), settings: { bookmakers: [] }, odds: [{ bookmakerId: 16, bettingType: 'HOME_AWAY', bettingScope: 'FULL_TIME', odds: [{ eventParticipantId: 'home0001', value: '2.10', active: true }] }] } } });
    if (u.searchParams.get('_hash') === 'lobtm') return json({ data: { getLiveOddsBettingTypeMenu: { items: [] } } });
    throw new Error('Unexpected fixture URL: ' + u);
  } });
  return { state, client, source: createFlashscoreSource(client) };
}

test('rapprochement NBA : codes ESPN, noms complets et franchises distinctes', () => {
  for (const [a, b] of [['LAL', 'Los Angeles Lakers'], ['GS', 'Golden State Warriors'], ['BRK', 'Brooklyn Nets'], ['PHO', 'Phoenix Suns'], ['WSH', 'Washington Wizards']]) assert.ok(sameParticipant(a, b, 'nba'));
  assert.equal(sameParticipant('LAL', 'Los Angeles Clippers', 'nba'), false);
  assert.equal(sameParticipant('', '', 'nba'), false);
});

test('rapprochement foot : alias explicites, sans mélanger clubs, femmes et jeunes', () => {
  assert.ok(sameParticipant('PSG', 'Paris Saint-Germain FC', 'foot'));
  assert.ok(sameParticipant('FC Nantes', 'Nantes', 'foot'));
  assert.ok(sameParticipant('Man Utd', 'Manchester United', 'foot'));
  for (const [a, b] of [['Manchester United', 'Newcastle United'], ['PSG', 'PSG W'], ['Nantes', 'Nantes U23'], ['FC', '']]) assert.equal(sameParticipant(a, b, 'foot'), false);
});

test('rapprochement tennis : initiales, accents et noms composés, sans seul patronyme', () => {
  for (const [a, b] of [['Tomic B.', 'Bernard Tomic'], ['R. Bautista Agut', 'Roberto Bautista Agut'], ['Van Assche L.', 'Luca Van Assche'], ['Alexandre Müller', 'Muller A.']]) assert.ok(sameParticipant(a, b, 'tennis'), a + ' / ' + b);
  for (const [a, b] of [['Zverev A.', 'Mischa Zverev'], ['John Smith', 'Jack Smith'], ['Zverev', 'Alexander Zverev'], ['J. Smith', 'John Smith / Jack Doe']]) assert.equal(sameParticipant(a, b, 'tennis'), false);
});

test('score tennis : sets, points du jeu, avantage, serveur et jeu décisif', () => {
  assert.deepEqual(flashscoreTennis(boardOf().matches[0]), { sets: [[7, 6]], games: [2, 2], points: [1, 2], server: 0 });
  assert.deepEqual(flashscoreTennis(matchOf({ BA: '6', BB: '6', WA: '2', WB: '5', WC: '2' })), { sets: [], games: [6, 6], points: [2, 5], server: 1 });
  assert.deepEqual(flashscoreTennis(matchOf({ BA: '4', BB: '4', WA: 'AD', WB: '40' }))?.points, [4, 3]);
  assert.equal(flashscoreTennis(matchOf({ BA: '0', BB: '0' }))?.points, undefined);
  assert.throws(() => flashscoreTennis(matchOf({ BA: '7', BB: '6' }, [0, 0])), /synchronisation/);
  assert.throws(() => flashscoreTennis(matchOf({ BA: '2' })), /incomplet/);
});

test('adaptateur : trois sports, statistiques et données natives conservées, cotes sur demande', async () => {
  const { source, state } = fixture();
  for (const sport of ['tennis', 'foot', 'nba'] as const) {
    const list = await source.live(sport);
    assert.equal(list.length, 1);
    const match = await source.match(sport, list[0].id);
    assert.equal(match.stats?.[0].home, '60% (30/50)');
    assert.equal(match.stats?.[1].home, 'custom value');
    assert.equal(match.stats?.[1].away, null);
    assert.equal(match.quality?.complete, true);
    assert.equal(match.native?.home, list[0].home);
    assert.equal((match.native?.data as Detail).feeds.statistics.ageSeconds, 7);
    assert.equal(match.tennis?.pointLog, undefined);
    assert.equal(match.odds, undefined);
  }
  assert.equal(state.oddsCalls, 0);
  const match = await source.match('tennis', 'test0001', { odds: true });
  assert.equal(state.oddsCalls, 2);
  assert.equal(match.odds?.home, 'Tomic B.');
  assert.equal((match.odds?.data as Detail['odds'])?.quotes[0].label, 'Cote');
  assert.equal((match.native?.data as Detail).odds, undefined);
});

test('score en cours de synchronisation : stats disponibles, score principal conservé', async () => {
  const { source, state } = fixture();
  state.board = tennisBoard().replace('AG÷1', 'AG÷0');
  const m = await source.match('tennis', 'test0001');
  assert.equal(m.tennis, undefined);
  assert.equal(m.quality?.complete, false);
  assert.match(m.quality?.errors.tennisScore ?? '', /synchronisation/);
  assert.equal(m.stats?.length, 2);
});

test('un tableau ou des stats périmés ne nourrissent pas le moteur', async () => {
  const { source, state } = fixture();
  await source.match('tennis', 'test0001');
  state.now = 2000; state.statisticsFail = true;
  await assert.rejects(source.match('tennis', 'test0001'), /anciennes/);
  assert.equal(await enrich('tennis', { home: 'Bernard Tomic', away: 'Omar Jasika' }, {}, [source]), undefined);
  state.failing = true;
  await assert.rejects(source.live('tennis'), /ancien/);
});

test('ordre inversé : statistiques et score alignés, cotes et données natives explicitement étiquetées', async () => {
  const { source } = fixture();
  const extra = await enrich('tennis', { home: 'Omar Jasika', away: 'Bernard Tomic' }, { odds: true }, [source]);
  assert.equal(extra?.source, 'flashscore');
  const m = extra!.match;
  assert.equal(m.home, 'Jasika O.');
  assert.deepEqual(m.score, [0, 1]);
  assert.deepEqual(m.tennis?.sets, [[6, 7]]);
  assert.deepEqual(m.tennis?.points, [2, 1]);
  assert.equal(m.tennis?.server, 1);
  assert.equal(m.stats?.[0].home, '55% (22/40)');
  assert.equal(m.native?.home, 'Tomic B.');
  assert.equal(m.odds?.home, 'Tomic B.');
  assert.deepEqual(swap(m).tennis, { ...(await source.match('tennis', 'test0001')).tennis, pointLog: undefined });
});

test('association ambiguë ou réponse incompatible : aucune donnée appliquée au mauvais match', async () => {
  const names = { home: 'Bernard Tomic', away: 'Omar Jasika' };
  let calls = 0;
  const m: SourceMatch = { ...names, id: 'one', sport: 'tennis', state: 'in' };
  const source: LiveSource = { name: 'fixture', sports: ['tennis'], ready: () => true, live: async () => [{ ...m }, { ...m, id: 'two' }], match: async () => { calls++; return m; } };
  assert.equal(await enrich('tennis', names, {}, [source]), undefined);
  assert.equal(calls, 0);
  source.live = async () => [m];
  for (const changed of [{ id: 'wrong' }, { sport: 'nba' as const }, { home: 'Another Player' }, { state: 'pre' as const }]) {
    source.match = async () => ({ ...m, ...changed });
    assert.equal(await enrich('tennis', names, {}, [source]), undefined);
  }
  source.match = async () => { throw new Error('provider down'); };
  const fallback = { ...source, name: 'fallback', match: async () => m };
  assert.equal((await enrich('tennis', names, {}, [source, fallback]))?.source, 'fallback');
});

test('activation sans clé et désactivation explicite par LIVE_FLASHSCORE=0', () => {
  const previous = process.env.LIVE_FLASHSCORE;
  try {
    delete process.env.LIVE_FLASHSCORE;
    assert.ok(createFlashscoreSource().ready());
    process.env.LIVE_FLASHSCORE = '0';
    assert.equal(createFlashscoreSource().ready(), false);
  } finally { if (previous == null) delete process.env.LIVE_FLASHSCORE; else process.env.LIVE_FLASHSCORE = previous; }
});

test('API /live : tennis dans le moteur, foot/NBA dans more, cotes optionnelles et repli ESPN/FotMob', async () => {
  const previousFetch = globalThis.fetch, previousSources = [...SOURCES];
  const { source, state } = fixture();
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.github.com') return new Response('', { status: 404 });
    if (u.pathname.includes('/tennis/wta/')) return json({ events: [] });
    if (u.pathname.includes('/tennis/atp/')) return json({ events: [{ name: 'Test ATP', groupings: [{ grouping: { displayName: 'Singles' }, competitions: [{ id: '123456', status: { type: { state: 'in', detail: '2nd set' } }, competitors: [
      { order: 1, athlete: { displayName: 'Bernard Tomic' }, linescores: [{ value: 7, winner: true }, { value: 1 }] },
      { order: 2, athlete: { displayName: 'Omar Jasika' }, linescores: [{ value: 6 }, { value: 1 }] },
    ] }] }] }] });
    if (u.pathname.includes('/basketball/nba/summary')) return json({ header: { competitions: [{ date: '2026-11-11T01:00:00Z', status: { period: 3, displayClock: '10:00', type: { state: 'in' } }, competitors: [{ homeAway: 'home', team: { abbreviation: 'LAL' }, score: '62' }, { homeAway: 'away', team: { abbreviation: 'GS' }, score: '60' }] }] } });
    if (u.hostname === 'www.fotmob.com') return json({ header: { teams: [{ id: 1, name: 'Paris Saint-Germain' }, { id: 2, name: 'Nantes' }], status: { started: true, liveTime: { short: '30' } } }, content: { matchFacts: { events: { events: [{ type: 'Goal', isHome: true, time: 10 }] } } } });
    throw new Error('Unexpected primary URL: ' + u);
  };
  SOURCES.splice(0, SOURCES.length, source);
  try {
    const response = await GET(new Request('https://razzia.me/api/live?sport=tennis&id=123456'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const tennis = await response.json();
    assert.equal(tennis.source, 'flashscore');
    assert.equal(tennis.id, '123456');
    assert.equal(tennis.sourceId, 'test0001');
    assert.deepEqual(tennis.st.games, [2, 2]);
    assert.deepEqual(tennis.st.points, [1, 2]);
    assert.equal(tennis.engine.read.level, 'stats');
    assert.deepEqual(tennis.engine.read.servePts, [[30, 50], [22, 40]]);
    assert.ok(Math.abs(tennis.engine.win[0] + tennis.engine.win[1] - 1) < 0.002);
    assert.equal(tennis.engine.read.streak, undefined);
    assert.equal(state.oddsCalls, 0);
    const priced = await (await GET(new Request('https://razzia.me/api/live?sport=tennis&id=123456&odds=1'))).json();
    assert.equal(priced.odds.home, 'Tomic B.');
    assert.equal(priced.odds.data.quotes[0].odds, 2.1);
    for (const [sport, id, nativeId] of [['foot', '12345', 'foot0001'], ['nba', '401234567', 'nba00001']]) {
      const r = await GET(new Request(`https://razzia.me/api/live?sport=${sport}&id=${id}`));
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.equal(data.more.source, 'flashscore');
      assert.equal(data.more.id, nativeId);
      assert.ok(data.more.native.data.feeds.summary);
      assert.ok(data.engine);
    }
    // Entre deux sets, ne pas reprendre les jeux de l'ancien tableau ESPN.
    state.board = tennisBoard().replace('BC÷2¬BD÷2¬', '');
    const between = await (await GET(new Request('https://razzia.me/api/live?sport=tennis&id=123456'))).json();
    assert.equal(between.st.games, undefined);
    state.failing = true; state.now = 2000;
    for (const [sport, id] of [['tennis', '123456'], ['foot', '12345'], ['nba', '401234567']]) {
      const r = await GET(new Request(`https://razzia.me/api/live?sport=${sport}&id=${id}`));
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.equal(data.source, undefined);
      assert.equal(data.more, undefined);
      assert.ok(data.engine);
    }
  } finally {
    globalThis.fetch = previousFetch;
    SOURCES.splice(0, SOURCES.length, ...previousSources);
  }
});
