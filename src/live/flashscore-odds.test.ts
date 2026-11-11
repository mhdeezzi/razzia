import test from 'node:test';
import assert from 'node:assert/strict';
import { Flashscore, collect, parseBoard, type Feed } from './flashscore.ts';
import { oddsData, parseLiveOdds, parsePrematchOdds, readOdds, type OddsQuery } from './flashscore-odds.ts';
import { flashscoreApi } from './flashscore-api.ts';
import { options } from '../cli/flashscore.ts';

const rawBoard = (state = '1') => 'ZA÷Test league¬~AA÷test0001¬AB÷' + state + '¬AE÷Home¬AF÷Away¬JA÷home0001¬JB÷away0001¬PX÷global01¬AG÷0¬AH÷0¬~';
const jsonFeed = (data: unknown, extras: Partial<Feed> = {}): Feed => ({ raw: JSON.stringify(data), fetchedAt: '2026-11-11T06:00:00Z', sourceDate: null, ageSeconds: 0, stale: false, ...extras });
const fixture = (state = '1') => parseBoard('foot', { ...jsonFeed(null), raw: rawBoard(state) }).matches[0];
const books = { bookmakers: [{ bookmaker: { id: 16, name: 'Book A' } }, { bookmaker: { id: 5, name: 'Book B' } }] };
const price = (id: string | null, value: unknown = '2.10', active: boolean | null = true) => ({ eventParticipantId: id, value, opening: '1.90', active });
const comparison = (items: Array<Record<string, unknown>> = [price('home0001'), price(null, '3.50'), price('away0001', '4.00')], market = 'HOME_DRAW_AWAY', scope = 'FULL_TIME') => ({ data: { findOddsByEventId: { eventId: 'test0001', settings: books, odds: [{ bookmakerId: 16, bettingType: market, bettingScope: scope, hasLiveBettingOffers: true, odds: items }] } } });
const liveData = (overview: unknown) => ({ data: { findLiveOddsForBookmaker: { eventOddsOverview: overview } } });
const query: OddsQuery = { hash: 'ole2', eventId: 'test0001', bookmakerId: 16, market: 'HOME_AWAY', scope: 'FULL_TIME' };
const config = () => new Response('window.environment = {"config":{"app":{"feed_sign":"fixture"}}};');
const reply = (value: unknown) => new Response(JSON.stringify(value), { headers: { Age: '4' } });

test('cotes 1N2 : bookmaker, côtés JA/JB, ouverture et horodatage exacts', () => {
  const quotes = parsePrematchOdds(jsonFeed(comparison()), fixture());
  assert.deepEqual(quotes.map((q) => q.side), ['home', 'draw', 'away']);
  assert.deepEqual(quotes.map((q) => q.odds), [2.1, 3.5, 4]);
  assert.equal(quotes[0].bookmakerName, 'Book A');
  assert.equal(quotes[0].openingOdds, 1.9);
  assert.equal(quotes[0].label, 'Cote');
  assert.equal(quotes[0].kind, 'bookmaker');
  assert.equal(quotes[0].fetchedAt, '2026-11-11T06:00:00Z');
  assert.equal(quotes[0].phase, 'prematch');
  assert.equal(quotes[0].status, 'active');
});

test('les lignes et périodes restent séparées, sans inventer un côté depuis l’ordre des sélections', () => {
  const payload = comparison([{ ...price(null), selection: 'OVER', handicap: { value: '2.5', type: 'GOALS' } }, { ...price(null, '1.70'), selection: 'UNDER', handicap: { value: '3.5', type: 'GOALS' } }], 'OVER_UNDER', 'FIRST_HALF');
  const quotes = parsePrematchOdds(jsonFeed(payload), fixture());
  assert.deepEqual(quotes.map((q) => [q.scope, q.outcome, q.handicap?.value, q.side]), [['FIRST_HALF', 'OVER', '2.5', null], ['FIRST_HALF', 'UNDER', '3.5', null]]);
  const foreignId = parsePrematchOdds(jsonFeed(comparison([price('global01')])), fixture())[0];
  assert.equal(foreignId.side, null);
});

test('double chance, score exact, cote absente et sélection suspendue restent explicites', () => {
  assert.deepEqual(parsePrematchOdds(jsonFeed(comparison(undefined, 'DOUBLE_CHANCE')), fixture()).map((q) => q.outcome), ['1X', '12', 'X2']);
  const quotes = parsePrematchOdds(jsonFeed(comparison([{ ...price(null, 'SP'), score: '2:1' }, price('home0001', '1.0', false), price('away0001', null, null)])), fixture());
  assert.equal(quotes[0].outcome, '2:1');
  assert.equal(quotes[0].odds, null);
  assert.equal(quotes[0].rawValue, 'SP');
  assert.equal(quotes[0].status, 'unknown');
  assert.equal(quotes[1].status, 'suspended');
  assert.equal(quotes[1].odds, 1);
  assert.equal(quotes[2].active, null);
});

test('les cotes d’avant-match ne deviennent pas des cotes live quand le match commence', () => {
  const quotes = parsePrematchOdds(jsonFeed(comparison()), fixture('2'));
  assert.ok(quotes.every((q) => q.phase === 'prematch' && q.status === 'historical'));
});

test('JSON erroné, erreurs GraphQL et mauvais identifiant ne deviennent pas une absence de cotes', () => {
  assert.deepEqual(parsePrematchOdds(jsonFeed({ data: { findOddsByEventId: null } }), fixture()), []);
  for (const value of [{}, { data: {} }, { data: { findOddsByEventId: null }, errors: [{ message: 'error' }] }, { data: { findOddsByEventId: null }, errors: 'error' }]) {
    assert.throws(() => oddsData(jsonFeed(value), 'findOddsByEventId'));
  }
  const wrongMatch = comparison(); wrongMatch.data.findOddsByEventId.eventId = 'another1';
  assert.throws(() => parsePrematchOdds(jsonFeed(wrongMatch), fixture()));
});

test('live : prix, mouvement, suspension et âge du cache restent ceux de la source', () => {
  const feed = jsonFeed(liveData({ bookmakerId: 16, home: { ...price('home0001', '20.0', false), change: { type: 'UP', previous: '3.9' } }, away: price('away0001', '1.0', false) }), { ageSeconds: 94 });
  const quotes = parseLiveOdds(feed, fixture('2'), query, new Map([[16, 'Book A']]));
  assert.equal(quotes[0].phase, 'live');
  assert.equal(quotes[0].previousOdds, 3.9);
  assert.equal(quotes[0].status, 'suspended');
  assert.equal(quotes[0].ageSeconds, 94);
  assert.deepEqual(parseLiveOdds(jsonFeed(liveData(null)), fixture('2'), query), []);
  assert.throws(() => parseLiveOdds(jsonFeed(liveData({ bookmakerId: 5 })), fixture('2'), query));
});

test('live : toutes les lignes over/under sont conservées avec leur seuil', () => {
  const feed = jsonFeed(liveData({ opportunities: [
    { handicap: { value: '2.5', type: 'GOALS' }, over: price(null), under: price(null, '1.80') },
    { handicap: { value: '3.5', type: 'GOALS' }, under: price(null, '1.40'), over: price(null, '3.10') },
  ] }));
  const quotes = parseLiveOdds(feed, fixture('2'), { ...query, market: 'OVER_UNDER' });
  assert.deepEqual(quotes.map((q) => [q.outcome, q.handicap?.value]), [['OVER', '2.5'], ['UNDER', '2.5'], ['UNDER', '3.5'], ['OVER', '3.5']]);
});

test('live : les issues combinées et aucun prochain but ne sont pas confondus avec un vainqueur', () => {
  const dc = parseLiveOdds(jsonFeed(liveData({ homeOrDraw: price(null), awayOrDraw: price(null), noDraw: price(null) })), fixture('2'), { ...query, market: 'DOUBLE_CHANCE' });
  assert.deepEqual(dc.map((q) => q.outcome), ['1X', 'X2', '12']);
  assert.equal(parseLiveOdds(jsonFeed(liveData({ none: price(null) })), fixture('2'), { ...query, market: 'NEXT_GOAL' })[0].outcome, 'none');
});

test('les marchés live annoncés sont dédupliqués et une erreur ne supprime pas les autres bookmakers', async () => {
  const queries: OddsQuery[] = [];
  const result = await readOdds(fixture('2'), async (q) => {
    queries.push(q);
    if (q.hash === 'oce') return jsonFeed(comparison());
    if (q.hash === 'lobtm') return jsonFeed({ data: { getLiveOddsBettingTypeMenu: { settings: books, items: [
      { bettingType: 'HOME_AWAY', bettingScope: 'FULL_TIME', bookmakerIds: [16, 16, 5], isActive: true, types: ['LIVE'] },
      { bettingType: 'OVER_UNDER', bettingScope: 'FIRST_HALF', bookmakerIds: [16], isActive: true, types: ['LIVE'] },
      { bettingType: 'HOME_DRAW_AWAY', bettingScope: 'FULL_TIME', bookmakerIds: [16], isActive: false, types: ['LIVE'] },
    ] } } });
    if (q.bookmakerId === 5) throw new Error('Book B unavailable');
    return jsonFeed(liveData({ home: price('home0001') }));
  });
  assert.equal(result.liveMarkets, 3);
  assert.equal(result.liveReads, 2);
  assert.equal(queries.length, 5);
  assert.equal(result.complete, false);
  assert.ok(result.quotes.some((q) => q.phase === 'prematch'));
  assert.ok(result.quotes.some((q) => q.phase === 'live' && q.bookmakerName === 'Book A'));
  assert.ok(result.errors['live:5:HOME_AWAY:FULL_TIME']);
});

test('une limitation des cotes ne coupe pas les statistiques et son Retry-After est respecté', async () => {
  let now = 0, oddsCalls = 0;
  const client = new Flashscore({ now: () => now, ttlMs: 0, fetch: async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'www.flashscore.com') return config();
    if (u.hostname.endsWith('flashscore.ninja')) return new Response(rawBoard());
    oddsCalls++;
    return new Response('', { status: 429, headers: { 'Retry-After': '120' } });
  } });
  assert.equal((await client.odds(fixture())).complete, false);
  assert.equal(client.oddsRetryAfterMs(), 120_000);
  assert.equal(client.retryAfterMs(), 0);
  assert.equal((await client.board('foot')).matches.length, 1);
  now = 119_999;
  await client.odds(fixture());
  assert.equal(oddsCalls, 1);
  now = 120_001;
  await client.odds(fixture());
  assert.equal(oddsCalls, 2);
});

test('une réponse 202 reporte la lecture des cotes sans être présentée comme un tableau vide', async () => {
  let now = 0, calls = 0;
  const client = new Flashscore({ now: () => now, fetch: async () => { calls++; return new Response('', { status: 202, headers: { 'x-retry-after-ms': '15000' } }); } });
  const data = await client.odds(fixture());
  assert.equal(data.complete, false);
  assert.equal(data.retryAfterMs, 15000);
  now = 10_000;
  await client.odds(fixture());
  assert.equal(calls, 1);
});

test('les réponses GraphQL sont regroupées sans recourir à x-fsign', async () => {
  let calls = 0;
  const client = new Flashscore({ fetch: async (url, init) => {
    assert.equal(new Headers(init?.headers).get('x-fsign'), null);
    assert.ok(String(url).includes('_hash=oce'));
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    return reply(comparison());
  } });
  const [a, b] = await Promise.all([client.odds(fixture()), client.odds(fixture())]);
  assert.equal(calls, 1);
  assert.deepEqual(a.quotes, b.quotes);
});

test('les anciennes cotes gardent leur date, sont signalées et expirent après une minute', async () => {
  let now = 0, failing = false;
  const client = new Flashscore({ now: () => now, ttlMs: 0, fetch: async () => failing ? new Response('', { status: 500 }) : reply(comparison()) });
  const first = await client.odds(fixture());
  failing = true; now = 2000;
  const old = await client.odds(fixture());
  assert.equal(old.complete, false);
  assert.equal(old.quotes[0].status, 'stale');
  assert.equal(old.quotes[0].fetchedAt, first.quotes[0].fetchedAt);
  now = 60_001;
  const expired = await client.odds(fixture());
  assert.equal(expired.quotes.length, 0);
  assert.ok(expired.errors.prematch);
});

test('API : cotes accessibles sur la fiche pré-match avec odds=1, sans simulation ni requête implicite sur la liste', async () => {
  let oddsCalls = 0;
  const client = new Flashscore({ fetch: async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'www.flashscore.com') return config();
    if (u.hostname.endsWith('flashscore.ninja')) return new Response(u.pathname.includes('/f_') ? rawBoard() : 'A1÷version¬~');
    oddsCalls++;
    return reply(comparison());
  } });
  const api = flashscoreApi(client);
  assert.equal((await api(new Request('https://razzia.me/api/flashscore?sport=foot&odds=1'))).status, 400);
  await api(new Request('https://razzia.me/api/flashscore?sport=foot'));
  assert.equal(oddsCalls, 0);
  const r = await api(new Request('https://razzia.me/api/flashscore?sport=foot&id=test0001&odds=1'));
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.complete, true);
  assert.equal(data.odds.quotes.length, 3);
  assert.equal(data.odds.liveRequested, false);
});

test('CLI : cotes activées par défaut et inclusion pré-match explicite', async () => {
  assert.equal(options([]).odds, true);
  assert.equal(options(['--no-odds']).odds, false);
  assert.equal(options(['--prematch']).prematch, true);
  assert.equal(options([]).oddsLocale, 'fr');
  assert.equal(options(['--odds-locale=global']).oddsLocale, 'global');
  assert.throws(() => options(['--odds-locale=france']));
  const client = new Flashscore({ fetch: async (url) => String(url).endsWith('/nba/') ? config() : new Response(String(url).includes('/f_') ? rawBoard() : 'A1÷version¬~') });
  assert.equal((await collect(client, ['foot'])).matches.length, 0);
  assert.equal((await collect(client, ['foot'], undefined, undefined, { prematch: true })).matches.length, 1);
});

test('Flashscore.fr : projet 16, pays FR et hôte live français, avec provenance dans la réponse', async () => {
  const paths: string[] = [];
  const client = new Flashscore({ oddsLocale: 'fr', fetch: async (url, init) => {
    const u = new URL(String(url)), hash = u.searchParams.get('_hash'); paths.push(u.hostname);
    assert.equal(new Headers(init?.headers).get('x-fsign'), null);
    if (hash === 'ole2') {
      assert.equal(u.hostname, '16.ds.lsapp.eu');
      assert.equal(u.searchParams.get('bookmakerId'), '141');
      return reply(liveData({ bookmakerId: 141, home: price('home0001'), away: price('away0001', '1.80') }));
    }
    assert.equal(u.searchParams.get('projectId'), '16');
    assert.equal(u.searchParams.get('geoIpCode'), 'FR');
    if (hash === 'oce') return reply(comparison());
    assert.equal(u.hostname, '16.ds.lsapp.eu');
    return reply({ data: { getLiveOddsBettingTypeMenu: { settings: { bookmakers: [{ bookmaker: { id: 141, name: 'Betclic.fr' } }] }, items: [{ bettingType: 'HOME_AWAY', bettingScope: 'FULL_TIME', bookmakerIds: [141], isActive: true, types: ['LIVE'] }] } } });
  } });
  const data = await client.odds(fixture('2'));
  assert.equal(data.complete, true); assert.equal(data.projectId, 16); assert.equal(data.countryCode, 'FR');
  assert.deepEqual(paths.sort(), ['16.ds.lsapp.eu', '16.ds.lsapp.eu', 'global.ds.lsapp.eu']);
  assert.equal(data.quotes.find((q) => q.phase === 'live')?.bookmakerName, 'Betclic.fr');
});

test('un refus du marché français est signalé et temporisé, sans passage au projet international', async () => {
  let calls = 0;
  const client = new Flashscore({ oddsLocale: 'fr', fetch: async (url) => {
    calls++; const u = new URL(String(url));
    assert.equal(u.searchParams.get('projectId'), '16');
    return new Response('', { status: 403, headers: { 'Retry-After': '60' } });
  } });
  assert.equal((await client.odds(fixture())).complete, false);
  assert.ok(client.oddsRetryAfterMs() > 0);
  await client.odds(fixture()); assert.equal(calls, 1);
});

test('un séparateur initial légitime de flux ne déclenche pas un faux renouvellement', async () => {
  let configs = 0;
  const client = new Flashscore({ fetch: async (url) => {
    if (String(url).endsWith('/nba/')) { configs++; return config(); }
    return new Response('~A1÷¬~');
  } });
  assert.equal((await client.feed('df_dos_1_test0001_')).raw, '~A1÷¬~');
  assert.equal(configs, 1);
});

test('statistiques et cotes partagent réellement la même limite de concurrence', async () => {
  let active = 0, maximum = 0;
  const client = new Flashscore({ concurrency: 2, fetch: async (url) => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    const u = new URL(String(url));
    if (u.hostname === 'www.flashscore.com') return config();
    if (u.hostname.endsWith('flashscore.ninja')) return new Response(rawBoard('2'));
    if (u.searchParams.get('_hash') === 'oce') return reply(comparison());
    if (u.searchParams.get('_hash') === 'lobtm') return reply({ data: { getLiveOddsBettingTypeMenu: { settings: books, items: [{ bettingType: 'HOME_AWAY', bettingScope: 'FULL_TIME', bookmakerIds: [16, 5], isActive: true, types: ['LIVE'] }] } } });
    return reply(liveData({ home: price('home0001') }));
  } });
  const [board, odds] = await Promise.all([client.board('foot'), client.odds(fixture('2'))]);
  assert.equal(board.matches.length, 1);
  assert.equal(odds.complete, true);
  assert.equal(maximum, 2);
});

test('HTTP 202 respecte le plus long des deux délais Retry-After fournis', async () => {
  const client = new Flashscore({ now: () => 0, fetch: async () => new Response('', { status: 202, headers: { 'x-retry-after-ms': '1000', 'Retry-After': '60' } }) });
  assert.equal((await client.odds(fixture())).retryAfterMs, 60_000);
});

test('API : un échec des cotes garde les statistiques et signale une fiche partielle', async () => {
  const client = new Flashscore({ fetch: async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'www.flashscore.com') return config();
    if (u.hostname.endsWith('flashscore.ninja')) return new Response(u.pathname.includes('/f_') ? rawBoard() : 'A1÷version¬~');
    return new Response('', { status: 500 });
  } });
  const r = await flashscoreApi(client)(new Request('https://razzia.me/api/flashscore?sport=foot&id=test0001&odds=1'));
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.complete, false);
  assert.equal(data.odds.complete, false);
  assert.ok(data.errors.odds);
  assert.ok(data.feeds.summary);
  assert.equal(data.errors.summary, undefined);
  assert.equal(client.retryAfterMs(), 0);
});

test('un nouveau format live ne devient pas un marché vide et une suspension peut omettre le prix', () => {
  assert.throws(() => parseLiveOdds(jsonFeed(liveData({ bookmakerId: 16, unexpected: { newPrice: '2.0' } })), fixture('2'), query));
  const suspended = parseLiveOdds(jsonFeed(liveData({ home: { active: false } })), fixture('2'), query);
  assert.equal(suspended[0].odds, null);
  assert.equal(suspended[0].status, 'suspended');
  assert.deepEqual(parseLiveOdds(jsonFeed(liveData({ opportunities: [] })), fixture('2'), query), []);
});
