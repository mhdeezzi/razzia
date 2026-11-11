import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, Flashscore, parseBoard, parseStatistics, publicSettings, records, SourceError, type Feed } from './flashscore.ts';
import { flashscoreApi } from './flashscore-api.ts';
import { options, pollDelay } from '../cli/flashscore.ts';

const settings = '<script>window.environment = ' + JSON.stringify({ config: { app: { feed_sign: 'public-test', example: '}; quoted "value"' } } }) + '; window.next = {};</script>';
const rawBoard = (state = '2') => 'ZA÷USA: NBA¬ZEE÷league01¬~AA÷test0001¬AB÷' + state + '¬AE÷Home¬AF÷Away¬AG÷0¬AH÷12¬AD÷1794357000¬AC÷22¬XX÷inconnu¬~';
const feed = (raw: string): Feed => ({ raw, fetchedAt: '2026-11-11T04:00:00Z', sourceDate: null, ageSeconds: 20 });
const response = (raw: string) => new Response(raw, { headers: { Age: '23', Date: 'Wed, 11 Nov 2026 04:00:00 GMT' } });
const fetched = (fn: (url: string) => Promise<Response> | Response): typeof fetch => async (url) => fn(String(url));

test('conserve les champs répétés, les inconnus et les valeurs contenant un séparateur', () => {
  assert.deepEqual(records('PF÷PTS¬PF÷REB¬NEW÷a÷b¬~'), [[['PF', 'PTS'], ['PF', 'REB'], ['NEW', 'a÷b']]]);
});

test('sépare les périodes/groupes et conserve les ratios complets et les données absentes', () => {
  assert.deepEqual(parseStatistics('SE÷Match¬~SF÷Passes¬~SD÷342¬SG÷Passes¬SH÷77% (213/277)¬SI÷61% (87/142)¬~SE÷1st Half¬~SG÷Saves¬SH÷0¬~'), [
    { period: 'Match', group: 'Passes', id: '342', label: 'Passes', home: '77% (213/277)', away: '61% (87/142)' },
    { period: '1st Half', group: 'Passes', id: undefined, label: 'Saves', home: '0', away: null },
  ]);
});

test('ne mélange pas NBA/WNBA et ne transforme pas une donnée absente en zéro', () => {
  const board = parseBoard('nba', feed(rawBoard() + 'ZA÷USA: WNBA¬~AA÷test0002¬AB÷2¬AE÷W home¬AF÷W away¬~'));
  assert.equal(board.matches.length, 1);
  assert.deepEqual(board.matches[0].score, [0, 12]);
  assert.ok(board.matches[0].fields.some(([key]) => key === 'XX'));
  assert.deepEqual(parseBoard('foot', feed('AA÷test0003¬AB÷2¬~')).matches[0].score, [null, null]);
  assert.equal(parseBoard('foot', feed('AA÷test0004¬AB÷2¬AD÷1e308¬~')).matches[0].start, null);
});

test('charge la configuration JSON publique sans exécuter le script', () => {
  assert.equal(publicSettings(settings).sign, 'public-test');
  assert.throws(() => publicSettings('<script>window.environment = alert(1)</script>'));
  assert.throws(() => publicSettings('window.environment = {"config":{}};'));
});

test('regroupe les appels identiques et rafraîchit le cache sans réécrire la date source', async () => {
  let now = 0, calls = 0;
  const client = new Flashscore({ now: () => now, fetch: fetched(async (url) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 2));
    return response(url.includes('/build/') ? '' : url.endsWith('/nba/') ? settings : rawBoard());
  }) });
  const [a, b] = await Promise.all([client.board('nba'), client.board('nba')]);
  assert.equal(calls, 2); // une configuration, un tableau
  assert.deepEqual(a, b);
  assert.equal(a.ageSeconds, 23);
  now = 500;
  assert.equal((await client.board('nba')).fetchedAt, a.fetchedAt);
  now = 1100;
  assert.notEqual((await client.board('nba')).fetchedAt, a.fetchedAt);
  assert.equal(calls, 3);
});

test('borne les requêtes concurrentes et expose les erreurs partielles des onglets', async () => {
  let active = 0, maximum = 0;
  const client = new Flashscore({ concurrency: 2, fetch: fetched(async (url) => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (url.endsWith('/nba/')) return response(settings);
    if (url.includes('df_psn_')) return new Response('', { status: 500 });
    return response(url.includes('df_st_') ? 'SE÷Match¬~SG÷Assists¬SH÷2¬SI÷3¬~' : rawBoard());
  }) });
  const board = await client.board('nba');
  const detail = await client.detail(board.matches[0], board);
  assert.equal(maximum, 2);
  assert.equal(detail.complete, false);
  assert.match(detail.errors.players, /500/);
  assert.equal(detail.statistics[0].label, 'Assists');
  assert.equal(detail.feeds.statistics.ageSeconds, 23);
});

test('respecte Retry-After après 429 et ne relance pas la source pendant la pause', async () => {
  let now = 0, calls = 0;
  const client = new Flashscore({ now: () => now, ttlMs: 0, fetch: fetched((url) => {
    calls++;
    return url.endsWith('/nba/') ? response(settings) : new Response('', { status: 429, headers: { 'Retry-After': '120' } });
  }) });
  await assert.rejects(client.board('nba'), (e) => e instanceof SourceError && e.retryAfterMs === 120_000);
  assert.equal(client.retryAfterMs(), 120_000);
  await assert.rejects(client.board('foot'));
  assert.equal(calls, 2);
  now = 120_001;
  await assert.rejects(client.board('nba'));
  assert.equal(calls, 3);
});

test('un refus 403 n’entraîne pas de tentative sur un autre hôte', async () => {
  let calls = 0;
  const client = new Flashscore({ fetch: fetched(() => { calls++; return new Response('', { status: 403 }); }) });
  await assert.rejects(client.board('nba'), (e) => e instanceof SourceError && e.status === 403);
  await assert.rejects(client.board('tennis'));
  assert.equal(calls, 1);
});

test('collecte une dernière fois le résultat final sans inclure les rencontres à venir', async () => {
  let final = false;
  const client = new Flashscore({ ttlMs: 0, fetch: fetched((url) => response(url.endsWith('/nba/') ? settings : url.includes('/f_') ? rawBoard(final ? '3' : '2') + 'AA÷test0002¬AB÷1¬~' : '')) });
  const first = await collect(client, ['nba']);
  assert.equal(first.matches.length, 1);
  final = true;
  const last = await collect(client, ['nba'], undefined, new Set(['nba:test0001']));
  assert.equal(last.matches[0].match.state, 'post');
  assert.equal((await collect(client, ['nba'])).matches.length, 0);
});

test('API : paramètres invalides rejetés avant tout appel, erreurs source distinctes d’un tableau vide', async () => {
  let calls = 0;
  const client = new Flashscore({ fetch: fetched(() => { calls++; return new Response('', { status: 403 }); }) });
  const api = flashscoreApi(client);
  assert.equal((await api(new Request('https://razzia.me/api/flashscore?id=123'))).status, 400);
  assert.equal((await api(new Request('https://razzia.me/api/flashscore?sport=foot&id=../../xx'))).status, 400);
  assert.equal(calls, 0);
  const result = await api(new Request('https://razzia.me/api/flashscore?sport=nba'));
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.ok(Number(result.headers.get('retry-after')) > 0);
  assert.ok((await result.json()).errors.nba);
});

test('API : sépare les IDs des autres sources et sert les données/erreurs partielles du match', async () => {
  const client = new Flashscore({ fetch: fetched((url) => {
    if (url.endsWith('/nba/')) return response(settings);
    if (url.includes('/f_')) return response(rawBoard());
    return url.includes('df_st_') ? new Response('', { status: 500 }) : response('A1÷version¬~');
  }) });
  const api = flashscoreApi(client);
  assert.equal((await api(new Request('https://razzia.me/api/flashscore?sport=nba&id=401234567'))).status, 400);
  assert.equal((await api(new Request('https://razzia.me/api/flashscore?sport=nba&id=missing1'))).status, 404);
  const result = await api(new Request('https://razzia.me/api/flashscore?sport=nba&id=test0001'));
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.source, 'flashscore');
  assert.equal(data.complete, false);
  assert.match(data.errors.statistics, /500/);
});

test('CLI : intervalle de 1 à 5 secondes et filtres explicites', () => {
  assert.equal(options([]).interval, 5000);
  assert.deepEqual(options(['--sports=tennis,nba', '--ids=test0001', '--interval=1000']).sports, ['tennis', 'nba']);
  for (const interval of ['999', '5001', 'NaN', '1.5']) assert.throws(() => options(['--interval=' + interval]));
  assert.throws(() => options(['--sports=football']));
  assert.throws(() => options(['--unknown']));
});

const settingsFor = (sign: string) => '<script>window.environment = ' + JSON.stringify({ config: { app: { feed_sign: sign } } }) + ';</script>';
const headerSign = (init?: RequestInit) => new Headers(init?.headers).get('x-fsign');
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

for (const status of [401, 403]) test('reprend automatiquement après rotation de signature sur HTTP ' + status, async () => {
  let configs = 0;
  const signs: Array<string | null> = [];
  const client = new Flashscore({ ttlMs: 0, fetch: async (url, init) => {
    if (String(url).endsWith('/nba/')) {
      configs++;
      assert.equal(new Headers(init?.headers).get('cache-control'), 'no-cache');
      return response(settingsFor(configs === 1 ? 'old' : 'new'));
    }
    const sign = headerSign(init);
    signs.push(sign);
    return sign === 'old' ? new Response('', { status }) : response(rawBoard());
  } });
  assert.equal((await client.board('nba')).matches.length, 1);
  assert.deepEqual(signs, ['old', 'new']);
  assert.equal(configs, 2);
  assert.equal(client.retryAfterMs(), 0);
  await client.board('nba');
  assert.equal(signs.at(-1), 'new');
  assert.equal(configs, 2);
});

test('une rotation simultanée sur les trois sports ne recharge la configuration qu’une fois', async () => {
  let configs = 0;
  const client = new Flashscore({ fetch: async (url, init) => {
    if (String(url).endsWith('/nba/')) return response(settingsFor(++configs === 1 ? 'old' : 'new'));
    await new Promise((resolve) => setImmediate(resolve));
    return headerSign(init) === 'old' ? new Response('', { status: 403 }) : response(rawBoard());
  } });
  const boards = await Promise.all([client.board('foot'), client.board('tennis'), client.board('nba')]);
  assert.deepEqual(boards.map((b) => b.matches.length), [1, 1, 1]);
  assert.equal(configs, 2);
  assert.equal(client.retryAfterMs(), 0);
});

test('un refus tardif de l’ancienne signature réutilise la nouvelle sans la révoquer', async () => {
  let configs = 0, rotating = false, oldRequests = 0;
  const bothStarted = gate(), lateResponse = gate();
  const client = new Flashscore({ ttlMs: 0, fetch: async (url, init) => {
    const path = String(url);
    if (path.endsWith('/nba/')) return response(settingsFor(++configs === 1 ? 'old' : 'new'));
    if (rotating && headerSign(init) === 'old') {
      if (++oldRequests === 2) bothStarted.release();
      await bothStarted.promise;
      if (path.includes('/f_2_')) await lateResponse.promise;
      return new Response('', { status: 401 });
    }
    return response(rawBoard());
  } });
  await client.board('nba');
  rotating = true;
  const first = client.board('foot'), late = client.board('tennis');
  assert.equal((await first).matches.length, 1);
  lateResponse.release();
  assert.equal((await late).matches.length, 1);
  assert.equal(configs, 2);
  assert.equal(client.retryAfterMs(), 0);
});

test('une signature inchangée après relecture entraîne une pause, sans boucle de requêtes', async () => {
  let configs = 0, feeds = 0;
  const client = new Flashscore({ fetch: async (url) => {
    if (String(url).endsWith('/nba/')) { configs++; return response(settingsFor('same')); }
    feeds++;
    return new Response('', { status: 403 });
  } });
  await assert.rejects(client.board('nba'), (e) => e instanceof SourceError && e.status === 403);
  assert.equal(configs, 2);
  assert.equal(feeds, 1);
  assert.ok(client.retryAfterMs() > 0);
  await assert.rejects(client.board('tennis'));
  assert.equal(configs, 2);
  assert.equal(feeds, 1);
});

test('un refus après renouvellement ne provoque jamais de troisième essai', async () => {
  let configs = 0, feeds = 0;
  const client = new Flashscore({ fetch: async (url) => {
    if (String(url).endsWith('/nba/')) return response(settingsFor(++configs === 1 ? 'old' : 'new'));
    feeds++;
    return new Response('', { status: 401 });
  } });
  await assert.rejects(client.board('nba'), (e) => e instanceof SourceError && e.status === 401);
  assert.equal(configs, 2);
  assert.equal(feeds, 2);
  assert.ok(client.retryAfterMs() > 0);
});

test('une panne de la page de configuration après expiration est bornée et récupère après la pause', async () => {
  let now = 0, configs = 0, recovered = false;
  const client = new Flashscore({ now: () => now, ttlMs: 0, fetch: async (url, init) => {
    if (String(url).endsWith('/nba/')) {
      configs++;
      return configs === 1 ? response(settingsFor('old')) : recovered ? response(settingsFor('new')) : new Response('', { status: 500 });
    }
    return headerSign(init) === 'old' ? new Response('', { status: 403 }) : response(rawBoard());
  } });
  await assert.rejects(client.board('nba'));
  await assert.rejects(client.board('tennis'));
  assert.equal(configs, 2);
  recovered = true;
  now = 61_000;
  assert.equal((await client.board('nba')).matches.length, 1);
  assert.equal(configs, 3);
});

for (const status of [403, 429]) test('HTTP ' + status + ' avec Retry-After interdit une relecture immédiate de la configuration', async () => {
  let now = 0, configs = 0, feeds = 0;
  const client = new Flashscore({ now: () => now, fetch: async (url) => {
    if (String(url).endsWith('/nba/')) { configs++; return response(settingsFor('old')); }
    feeds++;
    return new Response('', { status, headers: { 'Retry-After': '90' } });
  } });
  await assert.rejects(client.board('nba'));
  now = 89_999;
  await assert.rejects(client.board('tennis'));
  assert.equal(configs, 1);
  assert.equal(feeds, 1);
  assert.equal(client.retryAfterMs(), 1);
});

test('le renouvellement préventif ne bloque pas une signature encore fonctionnelle', async () => {
  let now = 0, configs = 0;
  const slowConfig = gate();
  const signs: Array<string | null> = [];
  const client = new Flashscore({ now: () => now, ttlMs: 0, fetch: async (url, init) => {
    if (String(url).endsWith('/nba/')) {
      if (++configs === 1) return response(settingsFor('old'));
      await slowConfig.promise;
      return response(settingsFor('new'));
    }
    signs.push(headerSign(init));
    return response(rawBoard());
  } });
  await client.board('nba');
  now = 300_001;
  assert.equal((await client.board('nba')).matches.length, 1);
  assert.equal(signs.at(-1), 'old');
  slowConfig.release();
  await new Promise((resolve) => setImmediate(resolve));
  await client.board('nba');
  assert.equal(signs.at(-1), 'new');
  assert.equal(configs, 2);
});

test('une panne du renouvellement préventif conserve la signature valide et temporise la configuration', async () => {
  let now = 0, configs = 0;
  const client = new Flashscore({ now: () => now, ttlMs: 0, fetch: async (url, init) => {
    if (String(url).endsWith('/nba/')) return ++configs === 1 ? response(settingsFor('old')) : new Response('', { status: 500 });
    assert.equal(headerSign(init), 'old');
    return response(rawBoard());
  } });
  await client.board('nba');
  now = 300_001;
  await client.board('nba');
  await new Promise((resolve) => setImmediate(resolve));
  now = 310_001;
  assert.equal((await client.board('nba')).stale, false);
  assert.equal(configs, 2);
});

test('une erreur HTML en HTTP 200 déclenche la reprise et n’est jamais cachée comme donnée de match', async () => {
  let configs = 0;
  const client = new Flashscore({ fetch: async (url, init) => {
    if (String(url).endsWith('/nba/')) return response(settingsFor(++configs === 1 ? 'old' : 'new'));
    return response(headerSign(init) === 'old' ? '<html>Signature expired</html>' : rawBoard());
  } });
  const board = await client.board('nba');
  assert.equal(board.stale, false);
  assert.equal(board.matches.length, 1);
  assert.equal(configs, 2);
});

test('un onglet vide légitime ne provoque aucun renouvellement de signature', async () => {
  let configs = 0;
  const client = new Flashscore({ fetch: fetched((url) => {
    if (url.endsWith('/nba/')) { configs++; return response(settingsFor('same')); }
    return response('');
  }) });
  assert.equal((await client.feed('df_psn_1_test0001')).raw, '');
  assert.equal(configs, 1);
});

test('la conservation temporaire des données ne rajeunit jamais la date et expire au bout d’une minute', async () => {
  let now = 0, failing = false;
  const client = new Flashscore({ now: () => now, ttlMs: 0, fetch: fetched((url) => {
    if (url.endsWith('/nba/')) return response(settingsFor('same'));
    return failing ? new Response('', { status: 500 }) : response(rawBoard());
  }) });
  const initial = await client.board('nba');
  failing = true;
  for (now of [2000, 30_000]) {
    const stale = await client.board('nba');
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, initial.fetchedAt);
    assert.equal(stale.ageSeconds, initial.ageSeconds);
    assert.deepEqual(stale.matches, initial.matches);
  }
  now = 60_001;
  await assert.rejects(client.board('nba'));
});

test('API et collecteur signalent les données conservées comme anciennes et incomplètes', async () => {
  let now = 0, failing = false;
  const client = new Flashscore({ now: () => now, ttlMs: 0, fetch: fetched((url) => {
    if (url.endsWith('/nba/')) return response(settingsFor('same'));
    return failing ? new Response('', { status: 500 }) : response(rawBoard());
  }) });
  await collect(client, ['nba']);
  failing = true;
  now = 2000;
  const api = flashscoreApi(client);
  const listing = await (await api(new Request('https://razzia.me/api/flashscore?sport=nba'))).json();
  assert.equal(listing.complete, false);
  assert.equal(listing.boards.nba.stale, true);
  assert.ok(listing.errors.nba);
  const detail = await (await api(new Request('https://razzia.me/api/flashscore?sport=nba&id=test0001'))).json();
  assert.equal(detail.complete, false);
  assert.equal(detail.boardStale, true);
  assert.equal(detail.feeds.statistics.stale, true);
  assert.ok(detail.errors.board);
  assert.equal((await api(new Request('https://razzia.me/api/flashscore?sport=nba&id=missing1'))).status, 503);
  const snapshot = await collect(client, ['nba']);
  assert.equal(snapshot.matches.length, 1);
  assert.ok(snapshot.errors.nba);
  assert.equal(snapshot.matches[0].complete, false);
});

test('la planification ne soustrait pas la durée du passage au délai Retry-After restant', () => {
  assert.equal(pollDelay(5000, 8000, 60_000, 1), 60_000);
  assert.equal(pollDelay(5000, 3000, 0, 0), 2000);
  assert.equal(pollDelay(5000, 8000, 0, 0), 0);
});

test('une rotation avec concurrence à un ne bloque pas la file et ne multiplie pas les renouvellements', async () => {
  let configs = 0;
  const client = new Flashscore({ concurrency: 1, fetch: async (url, init) => {
    if (String(url).endsWith('/nba/')) return response(settingsFor(++configs === 1 ? 'old' : 'new'));
    return headerSign(init) === 'old' ? new Response('', { status: 403 }) : response(rawBoard());
  } });
  const boards = await Promise.all([client.board('foot'), client.board('tennis'), client.board('nba')]);
  assert.equal(boards.length, 3);
  assert.ok(boards.every((board) => board.matches.length === 1));
  assert.equal(configs, 2);
  assert.equal(client.retryAfterMs(), 0);
});

for (const status of [403, 429]) test('une panne HTTP ' + status + ' du renouvellement préventif ne coupe pas les flux encore valides', async () => {
  let now = 0, configs = 0;
  const client = new Flashscore({ now: () => now, ttlMs: 0, fetch: async (url, init) => {
    if (String(url).endsWith('/nba/')) return ++configs === 1 ? response(settingsFor('old')) : new Response('', { status, headers: { 'Retry-After': '90' } });
    assert.equal(headerSign(init), 'old');
    return response(rawBoard());
  } });
  await client.board('nba');
  now = 300_001;
  await client.board('nba');
  await new Promise((resolve) => setImmediate(resolve));
  now = 380_001;
  assert.equal((await client.board('nba')).stale, false);
  assert.equal(configs, 2);
  assert.equal(client.retryAfterMs(), 0);
});

test('Retry-After de la configuration initiale est respecté même sans signature en cache', async () => {
  let now = 0, calls = 0;
  const client = new Flashscore({ now: () => now, fetch: async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'Retry-After': '120' } });
  } });
  await assert.rejects(client.board('nba'));
  now = 119_999;
  await assert.rejects(client.board('foot'));
  assert.equal(calls, 1);
  assert.equal(client.retryAfterMs(), 1);
  now = 120_001;
  await assert.rejects(client.board('nba'));
  assert.equal(calls, 2);
});
