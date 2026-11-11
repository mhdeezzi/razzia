import { SPORTS, type Sport } from '../live/flashscore.ts';
import { sameParticipant } from '../live/sources/matching.ts';
import { FlashscoreOddsProvider } from './flashscore-provider.ts';
import { TheOddsProvider } from './the-odds-provider.ts';
import { flattenBook, freshMarket, withReference, type BookPrice, type OddsGame, type OddsTarget } from './prices.ts';

const headers = { 'Cache-Control': 'no-store' };
const bad = (error: string, status = 400) => Response.json({ error }, { status, headers });
const order = (a: OddsTarget, b: OddsTarget, sport: Sport) => {
  const same = sameParticipant(a.home, b.home, sport) && sameParticipant(a.away, b.away, sport);
  const flipped = sameParticipant(a.home, b.away, sport) && sameParticipant(a.away, b.home, sport);
  return same !== flipped ? flipped : undefined;
};
function align(b: BookPrice, flip: boolean, now: number): BookPrice {
  return flattenBook({ ...b, markets: b.markets.filter((m) => freshMarket(m, now)).map((m) => !flip ? m : { ...m, home: m.away, away: m.home, line: m.line != null && ['spread', 'sets', 'games'].includes(m.kind) ? -m.line : m.line }) });
}
function validTarget(m: unknown): m is OddsTarget {
  if (!m || typeof m !== 'object') return false;
  const v = m as Record<string, unknown>;
  return typeof v.id === 'string' && /^[\w@:.+-]{1,100}$/.test(v.id) && ['home', 'away'].every((k) => typeof v[k] === 'string' && (v[k] as string).trim().length > 0 && (v[k] as string).length <= 150)
    && typeof v.start === 'string' && Number.isFinite(Date.parse(v.start)) && ['pre', 'in', 'post'].includes(String(v.state));
}

export function oddsApi(options: { flashscore?: FlashscoreOddsProvider; existing?: TheOddsProvider; now?: () => number } = {}) {
  const flashscore = options.flashscore ?? new FlashscoreOddsProvider(), existing = options.existing ?? new TheOddsProvider(), now = options.now ?? Date.now;
  // Sous Vercel, une variante CDN séparée protège le quota payant même entre plusieurs instances.
  // Elle ne contient que des cotes publiques. Les lectures Flashscore conservent leur cadence propre.
  const readExisting = async (request: Request) => {
    if (options.existing || !process.env.VERCEL || !existing.configured()) return existing.read();
    try {
      const url = new URL('/api/cotes?provider=the-odds-api', request.url);
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.games)) throw new Error();
      return data as Awaited<ReturnType<TheOddsProvider['read']>>;
    } catch { return { games: [], error: 'Cache The Odds API indisponible' }; }
  };
  return async (request: Request): Promise<Response> => {
    const q = new URL(request.url).searchParams;
    if (request.method === 'GET' && q.get('provider') === 'the-odds-api') {
      const value = await existing.read();
      return Response.json(value, { headers: { 'Cache-Control': `public, s-maxage=${value.error ? 60 : 600}` } });
    }
    let sport = q.get('sport') ?? 'nba';
    let targets: OddsTarget[] | undefined;
    if (request.method === 'POST') {
      if (Number(request.headers.get('content-length')) > 40_000) return bad('Demande trop volumineuse', 413);
      const text = await request.text();
      if (text.length > 40_000) return bad('Demande trop volumineuse', 413);
      let body: unknown;
      try { body = JSON.parse(text); } catch { return bad('JSON invalide'); }
      const b = body as { sport?: string; matches?: unknown[] } | null;
      sport = b?.sport ?? '';
      if (!Array.isArray(b?.matches) || b.matches.length > 40 || !b.matches.every(validTarget)) return bad('Entre 0 et 40 matchs valides sont attendus');
      targets = b.matches as OddsTarget[];
      if (new Set(targets.map((m) => m.id)).size !== targets.length) return bad('Identifiants de matchs répétés');
    } else if (request.method !== 'GET') return bad('Méthode refusée', 405);
    if (!SPORTS.includes(sport as Sport)) return bad('Sport invalide');
    const s = sport as Sport, id = q.get('id');
    if (id && !/^[a-zA-Z0-9]{8}$/.test(id)) return bad('Identifiant Flashscore invalide');
    if (request.method === 'GET' && s !== 'nba' && !id) return bad('Envoyer les matchs à rafraîchir avec POST, ou un identifiant Flashscore avec GET');
    if (targets?.length === 0) return Response.json({ games: [], at: new Date(now()).toISOString(), refreshAfterMs: 5000, errors: {} }, { headers });
    const errors: Record<string, string> = {};
    const [base, source] = await Promise.allSettled([s === 'nba' ? readExisting(request) : Promise.resolve({ games: [] as OddsGame[] }), flashscore.board(s)]);
    const legacy = base.status === 'fulfilled' ? base.value : { games: [], error: 'Fournisseur existant indisponible' };
    if ('error' in legacy && legacy.error) errors['the-odds-api'] = legacy.error;
    if (source.status === 'rejected') errors.flashscore = 'Cotes Flashscore indisponibles';
    if (!targets) {
      const matches = source.status === 'fulfilled' ? source.value.matches.filter((m) => id ? m.id === id : m.state === 'pre' || m.state === 'in') : [];
      if (id && source.status === 'fulfilled' && !matches.length) {
        const future = await Promise.allSettled(Array.from({ length: 7 }, (_, i) => flashscore.board(s, i + 1)));
        for (const r of future) if (r.status === 'fulfilled') for (const m of r.value.matches) if (m.id === id && !matches.some((x) => x.id === id)) matches.push(m);
        if (!matches.length) return bad(future.some((r) => r.status === 'rejected') ? 'Calendrier Flashscore partiellement indisponible' : 'Match Flashscore introuvable', future.some((r) => r.status === 'rejected') ? 503 : 404);
      }
      targets = matches.filter((m) => m.start).map((m) => ({ id: m.id, home: m.home, away: m.away, start: m.start!, state: m.state === 'in' ? 'in' : m.state === 'post' ? 'post' : 'pre' }));
      for (const b of legacy.games) if (!targets.some((t) => order(t, b, s) !== undefined && Math.abs(Date.parse(t.start) - Date.parse(b.start)) < 18 * 3600_000)) targets.push(b);
    }
    let fresh: OddsGame[] = targets.map((t) => ({ ...t, sport: s, books: [] }));
    if (source.status === 'fulfilled') {
      try { fresh = await flashscore.read(s, targets, source.value); }
      catch { errors.flashscore = 'Lecture des cotes Flashscore indisponible'; }
    }
    const games = fresh.map((game) => {
      if (game.state === 'post') return { ...game, books: [], selected: undefined, ref: undefined };
      const candidates = legacy.games.filter((b) => order(game, b, s) !== undefined && Math.abs(Date.parse(game.start) - Date.parse(b.start)) < 18 * 3600_000);
      const b = candidates.length === 1 ? candidates[0] : undefined;
      const books = [...(b ? b.books.map((book) => align(book, order(game, b, s)!, now())) : []), ...game.books.map((book) => align(book, false, now()))].filter((b) => b.markets.length && b.phase === (game.state === 'pre' ? 'prematch' : 'live'));
      return withReference({ ...game, books }, now());
    });
    const status = !games.some((g) => g.books.length) && source.status === 'rejected' && !legacy.games.length ? 503 : 200;
    return Response.json({ games, at: new Date(now()).toISOString(), refreshAfterMs: 5000, errors, ...('creditsLeft' in legacy ? { creditsLeft: legacy.creditsLeft } : {}), ...(status !== 200 ? { error: 'Fournisseurs de cotes indisponibles' } : {}) }, { status, headers });
  };
}

const handler = oddsApi();
export const GET = handler;
export const POST = handler;
