import test from 'node:test';
import assert from 'node:assert/strict';
import { Flashscore } from '../live/flashscore.ts';
import { readOdds, type OddsQuote, type OddsSnapshot } from '../live/flashscore-odds.ts';
import { flashscoreBooks, withReference, type OddsGame, type OddsTarget } from './prices.ts';
import { FlashscoreOddsProvider } from './flashscore-provider.ts';
import { TheOddsProvider } from './the-odds-provider.ts';
import { oddsApi } from './api.ts';
import { currentBook, footMarket, nbaMarket, tennisMarket, withNbaPrices, withTennisPrices, withFootPrices } from '../../web/src/oddsdata.ts';
import type { Game } from '../../web/src/data.ts';

const NOW = Date.now(), at = new Date(NOW).toISOString(), start = new Date(NOW + 3600_000).toISOString();
const target: OddsTarget = { id: 'primary1', home: 'BOS', away: 'MIA', start, state: 'pre' };
const q = (side: 'home' | 'away' | 'draw', overrides: Partial<OddsQuote> = {}): OddsQuote => ({ kind: 'bookmaker', label: 'Cote', phase: 'prematch', bookmakerId: 16, bookmakerName: 'bet365', market: 'HOME_AWAY', scope: 'FULL_TIME_OVER_TIME', outcome: side, side, participantId: side, handicap: null, odds: side === 'home' ? 2 : 1.8, openingOdds: null, previousOdds: null, rawValue: '2.0', active: true, status: 'active', fetchedAt: at, ageSeconds: 0, feedKey: 'prematch', ...overrides });
const snap = (quotes: OddsQuote[]): OddsSnapshot => ({ source: 'flashscore', label: 'Cote', quotes, feeds: {}, errors: {}, complete: true, liveRequested: false, liveMarkets: 0, liveReads: 0, retryAfterMs: 0 });
const game = (quotes = [q('home'), q('away')], sport: OddsGame['sport'] = 'nba') => withReference({ ...target, sport, books: flashscoreBooks(snap(quotes), sport, false, NOW) }, NOW);
const spread = (side: 'home' | 'away', line: string, odds = 1.9, extra: Partial<OddsQuote> = {}) => q(side, { market: 'ASIAN_HANDICAP', handicap: { value: line, type: 'UNKNOWN' }, odds, ...extra });

function fixture() {
  const state = { now: NOW, calls: 0, comparisons: 0, fail: false, boardState: '1', price: '2.10' };
  const client = new Flashscore({ now: () => state.now, ttlMs: 0, fetch: async (url) => {
    const u = new URL(String(url)); state.calls++;
    if (state.fail) return new Response('', { status: 403 });
    if (u.hostname === 'www.flashscore.com') return new Response('window.environment = {"config":{"app":{"feed_sign":"test"}}};');
    if (u.hostname.endsWith('flashscore.ninja')) {
      assert.match(u.pathname, /\/f_/); // aucune lecture de stats/chronologie pour actualiser une cote
      return new Response(`ZA÷USA: NBA¬~AA÷test0001¬AB÷${state.boardState}¬AE÷Boston Celtics¬AF÷Miami Heat¬JA÷home0001¬JB÷away0001¬AD÷${Math.floor(Date.parse(start) / 1000)}¬~`);
    }
    if (u.searchParams.get('_hash') === 'oce') {
      state.comparisons++;
      return Response.json({ data: { findOddsByEventId: { eventId: 'test0001', settings: { bookmakers: [{ bookmaker: { id: 16, name: 'bet365' } }] }, odds: [{ bookmakerId: 16, bettingType: 'HOME_AWAY', bettingScope: 'FULL_TIME_OVER_TIME', odds: [{ eventParticipantId: 'home0001', value: state.price, active: true }, { eventParticipantId: 'away0001', value: '1.80', active: true }] }] } } });
    }
    return Response.json({ data: { getLiveOddsBettingTypeMenu: { items: [] } } });
  } });
  return { state, client, provider: new FlashscoreOddsProvider({ client, now: () => state.now }) };
}
const post = (matches: OddsTarget[] = [target], sport = 'nba') => new Request('https://razzia.me/api/cotes', { method: 'POST', body: JSON.stringify({ sport, matches }) });
const baseData = (updated = at) => [{ id: 'legacy1', home_team: 'Boston Celtics', away_team: 'Miami Heat', commence_time: start, bookmakers: [{ key: 'pinnacle', title: 'Pinnacle', last_update: updated, markets: [{ key: 'h2h', last_update: updated, outcomes: [{ name: 'Boston Celtics', price: 2.2 }, { name: 'Miami Heat', price: 1.7 }] }] }] }];

test('un marché exige deux côtés actifs du même bookmaker et de la même période', () => {
  assert.equal(game().books.length, 1);
  for (const quotes of [[q('home')], [q('home'), q('away', { bookmakerId: 5 })], [q('home'), q('away', { scope: 'FIRST_HALF' })], [q('home'), q('away', { status: 'suspended' })], [q('home'), q('away'), q('away')]]) assert.equal(game(quotes).books.length, 0);
});
test('âge du cache source : une relecture récente ne rajeunit pas la cote', () => {
  const g = game([q('home', { ageSeconds: 300 }), q('away', { ageSeconds: 300 })]);
  assert.equal(Date.parse(g.books[0].updated), NOW - 300_000);
  assert.equal(game([q('home', { ageSeconds: 901 }), q('away', { ageSeconds: 901 })]).books.length, 0);
  assert.equal(game([q('home', { phase: 'live', ageSeconds: 31 }), q('away', { phase: 'live', ageSeconds: 31 })]).books.length, 0);
  assert.equal(game([q('home', { status: 'stale' }), q('away', { status: 'stale' })]).books.length, 0);
});
test('handicap : côtés opposés à la même ligne, inversion vérifiée, total inchangé', () => {
  const quotes = [q('home'), q('away'), spread('home', '-3.5'), spread('away', '3.5'), spread('home', '-4.5', 2.1), spread('away', '4.5', 1.7)];
  const b = flashscoreBooks(snap(quotes), 'nba', true, NOW)[0];
  assert.deepEqual(b.spread, { point: 3.5, home: 1.9, away: 1.9 });
  assert.equal(b.home, 1.8); assert.equal(b.away, 2);
  assert.equal(b.markets.filter((m) => m.kind === 'spread').length, 2);
  const unmatched = game([q('home'), q('away'), spread('home', '-3.5'), spread('away', '4.5')]);
  assert.equal(unmatched.books[0].spread, undefined);
});
test('NBA : prolongation requise ; un marché de temps réglementaire reste distinct', () => {
  assert.equal(game([q('home', { scope: 'FULL_TIME' }), q('away', { scope: 'FULL_TIME' })]).books.length, 0);
  assert.equal(game().books[0].markets[0].scope, 'FULL_TIME_OVER_TIME');
});
test('tennis : ne confond pas handicap en jeux et en sets, ni match et premier set', () => {
  const quotes = [q('home', { scope: 'FULL_TIME' }), q('away', { scope: 'FULL_TIME' }), ...(['SETS', 'GAMES'] as const).flatMap((type) => [spread('home', '-1.5', 1.8, { scope: 'FULL_TIME', handicap: { value: '-1.5', type } }), spread('away', '1.5', 2, { scope: 'FULL_TIME', handicap: { value: '1.5', type } })])];
  const b = game(quotes, 'tennis').books[0];
  assert.equal(b.markets.filter((m) => m.kind === 'sets').length, 1);
  assert.equal(b.markets.filter((m) => m.kind === 'games').length, 1);
  assert.deepEqual(tennisMarket(game(quotes, 'tennis'))?.sets, [{ line: -1.5, home: 1.8, away: 2 }]);
});
test('foot : les trois issues sont requises et le total 2,5 est séparé des autres lignes', () => {
  const quotes = [q('home'), q('away'), q('draw', { odds: 3.2 })].map((p) => ({ ...p, market: 'HOME_DRAW_AWAY', scope: 'FULL_TIME' }));
  assert.equal(game(quotes.slice(0, 2), 'foot').books.length, 0);
  const o = footMarket(game(quotes, 'foot'));
  assert.equal(o?.d, 3.2); assert.equal(o?.over25, undefined);
});
test('sélection : source la plus récente, sans prétendre qu’Unibet global est français', () => {
  const g = game([q('home', { bookmakerName: 'Unibet' }), q('away', { bookmakerName: 'Unibet' }), q('home', { bookmakerId: 5, bookmakerName: 'Pinnacle', ageSeconds: 10 }), q('away', { bookmakerId: 5, bookmakerName: 'Pinnacle', ageSeconds: 10 })]);
  assert.equal(g.selected, 'flashscore:16:prematch');
  assert.equal(g.books.find((b) => b.key === g.selected)?.french, false);
  assert.ok(g.ref);
});
test('fiches : cotes live, retirées, trop anciennes ou antérieures à la cote existante rejetées', () => {
  const g = game();
  assert.ok(currentBook(g));
  assert.equal(currentBook(g, new Date(NOW + 1000).toISOString()), undefined);
  assert.equal(currentBook({ ...g, state: 'in' }), undefined);
  assert.equal(currentBook({ ...g, selected: undefined }), undefined);
  assert.equal(currentBook(g, undefined, NOW + 901_000), undefined);
});
test('conversion NBA décimale/américaine sans confusion, ni relance/changement des probabilités', () => {
  const g = game([q('home', { odds: 2.5 }), q('away', { odds: 1.5 })]);
  assert.equal(nbaMarket(g)?.mlHome, 150); assert.equal(nbaMarket(g)?.mlAway, -200);
  const original = { ...target, home: { tri: 'BOS' }, away: { tri: 'MIA' }, odds: { provider: 'ESPN', mlHome: 100, mlAway: -110 } } as Game;
  assert.equal(withNbaPrices(original).odds, original.odds);
  assert.equal(withNbaPrices(original, g).odds?.provider, 'bet365 · Flashscore');
  const t = { ...target, pHome: 0.62, market: { pHome: 0.64, odds: { ml: [2, 1.8] as [number, number] } }, sim: { n: 25000 }, home: { name: 'A' }, away: { name: 'B' } };
  const tr = withTennisPrices(t, game([q('home', { scope: 'FULL_TIME' }), q('away', { scope: 'FULL_TIME' })], 'tennis'));
  assert.equal(tr.pHome, t.pHome); assert.equal(tr.sim, t.sim); assert.equal(tr.market.pHome, t.market.pHome);
  const f = { ...target, final: { h: 0.6, d: 0.25, a: 0.15 }, market: { odds: { h: 2, d: 3, a: 4 }, src: 'pinnacle' } };
  assert.equal(withFootPrices(f).final, f.final);
});
test('fournisseur rapide : un seul appel de cotes partagé, rafraîchi après cinq secondes', async () => {
  const { state, provider } = fixture();
  const [a, b] = await Promise.all([provider.read('nba', [target]), provider.read('nba', [target])]);
  assert.equal(state.comparisons, 1); assert.equal(a[0].books[0].home, 2.1); assert.equal(b[0].sourceId, 'test0001');
  state.now += 4999; state.price = '2.60';
  assert.equal((await provider.read('nba', [target]))[0].books[0].home, 2.1);
  state.now += 2;
  assert.equal((await provider.read('nba', [target]))[0].books[0].home, 2.6);
  assert.equal(state.comparisons, 2);
});
test('source : inversion des équipes et rencontre d’un autre jour exclue', async () => {
  const { provider } = fixture();
  const a = await provider.read('nba', [{ ...target, home: 'MIA', away: 'BOS' }]);
  assert.equal(a[0].books[0].home, 1.8);
  const b = await provider.read('nba', [{ ...target, start: new Date(NOW + 3 * 86400_000).toISOString() }]);
  assert.equal(b[0].books.length, 0);
});
test('état du match : pas de retour du live au pré-match, ni cote après la fin', async () => {
  const { provider, state } = fixture();
  const a = await provider.read('nba', [{ ...target, state: 'in' }]);
  assert.equal(a[0].state, 'in'); assert.equal(a[0].books.length, 0); assert.equal(state.comparisons, 0);
  state.boardState = '3';
  const b = await provider.read('nba', [target]);
  assert.equal(b[0].state, 'post'); assert.equal(b[0].books.length, 0); assert.equal(state.comparisons, 0);
});
test('The Odds API : crédits préservés pendant dix minutes et requêtes simultanées regroupées', async () => {
  let calls = 0, now = NOW;
  const provider = new TheOddsProvider({ key: 'fixture', now: () => now, fetch: async () => { calls++; await new Promise((r) => setImmediate(r)); return Response.json(baseData(), { headers: { 'x-requests-remaining': '123' } }); } });
  const [a] = await Promise.all([provider.read(), provider.read()]);
  assert.equal(calls, 1); assert.equal(a.creditsLeft, 123);
  now += 599_999; await provider.read(); assert.equal(calls, 1);
  now++; await provider.read(); assert.equal(calls, 2);
});
test('The Odds API : Retry-After est respecté, sans multiplier les appels payants', async () => {
  let calls = 0, now = NOW;
  const provider = new TheOddsProvider({ key: 'fixture', now: () => now, fetch: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); } });
  assert.ok((await provider.read()).error);
  now += 119_999; await provider.read(); assert.equal(calls, 1);
  now++; await provider.read(); assert.equal(calls, 2);
});
test('cache CDN payant indépendant : dix minutes, sans appeler Flashscore', async () => {
  const { provider, state } = fixture();
  const existing = new TheOddsProvider({ key: 'fixture', now: () => NOW, fetch: async () => Response.json(baseData()) });
  const api = oddsApi({ flashscore: provider, existing });
  const r = await api(new Request('https://razzia.me/api/cotes?provider=the-odds-api'));
  assert.equal(r.headers.get('cache-control'), 'public, s-maxage=600');
  assert.equal((await r.json()).games.length, 1);
  assert.equal(state.calls, 0);
});
test('Vercel : agrégation via la variante CDN publique, sans transmettre la clé payante', async () => {
  const previousFetch = globalThis.fetch, previousVercel = process.env.VERCEL, previousKey = process.env.ODDS_API_KEY;
  const { provider } = fixture();
  const value = await new TheOddsProvider({ key: 'fixture', now: () => NOW, fetch: async () => Response.json(baseData()) }).read();
  let calls = 0;
  try {
    process.env.VERCEL = '1'; process.env.ODDS_API_KEY = 'private-fixture';
    globalThis.fetch = async (url, init) => {
      calls++; assert.equal(String(url), 'https://razzia.me/api/cotes?provider=the-odds-api');
      assert.equal(new Headers(init?.headers).get('authorization'), null);
      return Response.json(value);
    };
    const r = await oddsApi({ flashscore: provider, now: () => NOW })(post());
    assert.equal(r.status, 200); assert.equal((await r.json()).games[0].books.length, 2); assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousVercel == null) delete process.env.VERCEL; else process.env.VERCEL = previousVercel;
    if (previousKey == null) delete process.env.ODDS_API_KEY; else process.env.ODDS_API_KEY = previousKey;
  }
});
test('API : les fournisseurs coexistent, le plus récent est choisi, aucune clé requise pour Flashscore', async () => {
  const { provider } = fixture();
  const existing = new TheOddsProvider({ key: 'fixture', now: () => NOW, fetch: async () => Response.json(baseData(new Date(NOW - 60_000).toISOString())) });
  const api = oddsApi({ flashscore: provider, existing, now: () => NOW });
  const r = await api(post()); const data = await r.json();
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(data.games[0].books.length, 2); assert.equal(data.games[0].selected, 'flashscore:16:prematch');
  assert.ok(data.games[0].ref);
  const withoutKey = oddsApi({ flashscore: provider, existing: new TheOddsProvider({ key: '' }), now: () => NOW });
  assert.equal((await withoutKey(post())).status, 200);
});
test('API : panne Flashscore, le fournisseur actuel continue ; panne totale signalée', async () => {
  const { provider, state } = fixture(); state.fail = true;
  const existing = new TheOddsProvider({ key: 'fixture', now: () => NOW, fetch: async () => Response.json(baseData()) });
  const data = await (await oddsApi({ flashscore: provider, existing, now: () => NOW })(post())).json();
  assert.equal(data.games[0].selected, 'pinnacle'); assert.ok(data.errors.flashscore);
  const r = await oddsApi({ flashscore: provider, existing: new TheOddsProvider({ key: '' }), now: () => NOW })(post());
  assert.equal(r.status, 503);
});
test('API : validation avant tout appel, limite des lots et identifiants répétés', async () => {
  const { state, provider } = fixture();
  const api = oddsApi({ flashscore: provider, existing: new TheOddsProvider({ key: '' }), now: () => NOW });
  assert.equal((await api(post([target, target]))).status, 400);
  assert.equal((await api(post([target], 'baseball'))).status, 400);
  assert.equal((await api(post([{ ...target, start: 'invalid' }]))).status, 400);
  assert.equal((await api(post(Array.from({ length: 41 }, (_, i) => ({ ...target, id: String(i) }))))).status, 400);
  assert.equal((await api(new Request('https://razzia.me/api/cotes?sport=foot'))).status, 400);
  assert.equal(state.calls, 0);
});
test('filtrage live : le collecteur complet reste intact, le comparateur ignore les marchés annexes', async () => {
  const match = { id: 'test0001', sport: 'nba' as const, league: '', start, state: 'in' as const, stage: '', home: 'H', away: 'A', fields: [], leagueFields: [], score: [0, 0] as [number, number] };
  const calls: string[] = [];
  const read = await readOdds(match, async (q) => {
    calls.push(q.market ?? q.hash);
    const data = q.hash === 'oce' ? { findOddsByEventId: { eventId: match.id, odds: [] } } : q.hash === 'lobtm' ? { getLiveOddsBettingTypeMenu: { items: ['HOME_AWAY', 'NEXT_GOAL'].map((bettingType) => ({ bettingType, bettingScope: 'FULL_TIME_OVER_TIME', types: ['LIVE'], bookmakerIds: [16], isActive: true })) } } : { findLiveOddsForBookmaker: { eventOddsOverview: null } };
    return { raw: JSON.stringify({ data }), fetchedAt: at, sourceDate: null, ageSeconds: 0 };
  }, { liveMarkets: ['HOME_AWAY'], liveScopes: ['FULL_TIME_OVER_TIME'] });
  assert.equal(read.liveMarkets, 1); assert.equal(calls.includes('NEXT_GOAL'), false);
});
