// Lectures légères des cotes, sans relire les simulations, les blessures ni tout le calendrier.
import { freshMarket, mainLine, type BookPrice, type OddsGame, type OddsResponse, type OddsTarget } from '../../src/odds/prices.ts';
import type { Sport } from '../../src/live/flashscore.ts';
import type { Game, Odds } from './data.ts';

const cache = new Map<string, { at: number; data: OddsResponse }>();
const pending = new Map<string, Promise<OddsResponse>>();
/** Même horizon que le calendrier : aujourd'hui à J+7, nuits comprises, sans limite arbitraire de 36 heures. */
export const withinPriceHorizon = (t: OddsTarget, now = Date.now()) => t.state !== 'post' && Date.parse(t.start) > now - 18 * 3600_000 && Date.parse(t.start) < (Math.floor(now / 86_400_000) + 8) * 86_400_000;
export async function readPrices(sport: Sport, matches: OddsTarget[]): Promise<Map<string, OddsGame>> {
  const chunks: OddsTarget[][] = [];
  for (let i = 0; i < matches.length; i += 40) chunks.push(matches.slice(i, i + 40));
  const results = await Promise.all(chunks.map(async (group) => {
    const body = JSON.stringify({ sport, matches: group }), old = cache.get(body);
    if (old && Date.now() - old.at < 5000) return old.data;
    const existing = pending.get(body);
    if (existing) return existing;
    const promise = (async () => {
      const r = await fetch('/api/cotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, cache: 'no-store', signal: AbortSignal.timeout(25_000) });
      const data = await r.json();
      if (!r.ok || !Array.isArray(data.games)) throw new Error(data.error ?? 'Cotes indisponibles');
      cache.set(body, { at: Date.now(), data });
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      return data as OddsResponse;
    })();
    pending.set(body, promise);
    try { return await promise; } finally { if (pending.get(body) === promise) pending.delete(body); }
  }));
  return new Map(results.flatMap((r) => r.games.map((g) => [g.id, g] as const)));
}

/** Une fiche d'avant-match ne reçoit jamais une cote live, ancienne ou plus vieille que sa cote existante datée. */
export function currentBook(game?: OddsGame, baselineAt?: string, now = Date.now()): BookPrice | undefined {
  if (!game || game.state !== 'pre' || Date.parse(game.start) <= now) return undefined;
  const b = game.books.find((b) => b.key === game.selected && b.phase === 'prematch');
  if (!b) return undefined;
  const markets = b.markets.filter((m) => freshMarket(m, now));
  const win = mainLine(markets, 'win');
  if (!win || (game.selection?.reason !== 'preferred' && baselineAt && Date.parse(baselineAt) > Date.parse(win.updated))) return undefined;
  return { ...b, markets };
}
export const bookmakerLabel = (b: BookPrice) => b.source === 'flashscore' ? `${b.title} · Flashscore` : b.title;
const american = (v: number) => v >= 2 ? 100 * (v - 1) : -100 / (v - 1);
export function nbaMarket(game?: OddsGame, baselineAt?: string): Odds | undefined {
  const b = currentBook(game, baselineAt);
  if (!b) return undefined;
  const win = mainLine(b.markets, 'win')!, spread = mainLine(b.markets, 'spread'), total = mainLine(b.markets, 'total');
  return { provider: bookmakerLabel(b), updated: win.updated, source: b.source,
    mlHome: american(win.home!), mlAway: american(win.away!), spreadHome: spread?.line, spreadOddsHome: spread && american(spread.home!), spreadOddsAway: spread && american(spread.away!), total: total?.line, overOdds: total && american(total.over!), underOdds: total && american(total.under!) };
}
export function tennisMarket(game?: OddsGame, baselineAt?: string) {
  const b = currentBook(game, baselineAt);
  if (!b) return undefined;
  const win = mainLine(b.markets, 'win')!, set1 = mainLine(b.markets, 'set1');
  const pairs = (kind: 'sets' | 'games') => b.markets.filter((m) => m.kind === kind).map((m) => ({ line: m.line!, home: m.home!, away: m.away! }));
  const totals = (kind: 'totalSets' | 'totalGames') => b.markets.filter((m) => m.kind === kind).map((m) => ({ line: m.line!, over: m.over!, under: m.under! }));
  return { provider: bookmakerLabel(b), source: b.source, at: win.updated, ml: [win.home!, win.away!] as [number, number], set1: set1 && [set1.home!, set1.away!] as [number, number], sets: pairs('sets'), games: pairs('games'), totalSets: totals('totalSets'), totalGames: totals('totalGames') };
}
export function footMarket(game?: OddsGame, baselineAt?: string) {
  const b = currentBook(game, baselineAt);
  if (!b) return undefined;
  const win = mainLine(b.markets, 'win')!, total = b.markets.find((m) => m.kind === 'total' && m.line === 2.5);
  if (win.draw == null) return undefined;
  return { h: win.home!, d: win.draw, a: win.away!, src: bookmakerLabel(b), at: win.updated, over25: total?.over, under25: total?.under };
}
export const nbaTarget = (g: Game): OddsTarget => ({ id: g.id, home: g.home.tri, away: g.away.tri, start: g.start, state: g.state });
export const resultTarget = (r: { id: string; start: string; home: { name: string }; away: { name: string } }): OddsTarget => ({ id: String(r.id), start: r.start, home: r.home.name, away: r.away.name, state: Date.parse(r.start) > Date.now() ? 'pre' : 'in' });
export function withNbaPrices(g: Game, prices?: OddsGame): Game {
  const odds = nbaMarket(prices, g.odds?.updated), state = prices?.sourceId && prices.state !== 'pre' ? prices.state : g.state;
  return odds || state !== g.state ? { ...g, state, odds: odds ?? g.odds } : g;
}
export function withTennisPrices<T extends { market: { odds?: { at?: string; ml?: [number, number] } } }>(r: T, prices?: OddsGame): T {
  const odds = tennisMarket(prices, r.market.odds?.at);
  return odds ? { ...r, market: { ...r.market, odds } } : r;
}
export function withFootPrices<T extends { market?: { odds: { h: number; d: number; a: number; at?: string }; src?: string } }>(r: T, prices?: OddsGame): T {
  const odds = footMarket(prices, r.market?.odds.at);
  return odds ? { ...r, market: { ...r.market, odds } } : r;
}
