// Format commun aux fournisseurs. Chaque marché conserve son bookmaker, sa période et sa date réelle de lecture.
import type { OddsQuote, OddsSnapshot } from '../live/flashscore-odds.ts';
import type { Sport } from '../live/flashscore.ts';

export interface OddsTarget { id: string; home: string; away: string; start: string; state: 'pre' | 'in' | 'post' }
export type MarketKind = 'win' | 'spread' | 'total' | 'set1' | 'sets' | 'games' | 'totalSets' | 'totalGames';
export interface MarketPrice {
  kind: MarketKind; scope: string; phase: 'prematch' | 'live'; line?: number;
  home?: number; away?: number; draw?: number; over?: number; under?: number;
  updated: string; observedAt: string; sourceAgeSeconds: number | null;
}
export interface BookPrice {
  key: string; title: string; source: 'flashscore' | 'the-odds-api'; french: boolean;
  phase: 'prematch' | 'live'; updated: string; markets: MarketPrice[];
  projectId?: number; countryCode?: string;
  home?: number; away?: number; draw?: number;
  spread?: { point: number; home: number; away: number };
  total?: { point: number; over: number; under: number };
}
export interface OddsGame extends OddsTarget {
  sport: Sport; sourceId?: string; books: BookPrice[]; selected?: string;
  selection?: { preferred: string; bookmaker: string; source: BookPrice['source']; reason: 'preferred' | 'fallback' };
  ref?: { home: number; away: number }; errors?: Record<string, string>;
}
export interface OddsResponse { games: OddsGame[]; at: string; refreshAfterMs: number; errors: Record<string, string>; creditsLeft?: number; error?: string }

export const MAX_AGE = { prematch: 15 * 60_000, live: 30_000 };
export const decimal = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 1;
/** Age HTTP ajouté au temps écoulé depuis la lecture ; relire un cache ancien ne rajeunit pas son contenu. */
export const quoteTime = (q: Pick<OddsQuote, 'fetchedAt' | 'ageSeconds'>) => Date.parse(q.fetchedAt) - (q.ageSeconds ?? 0) * 1000;
export const freshMarket = (m: MarketPrice, now = Date.now()) => Number.isFinite(Date.parse(m.updated)) && now - Date.parse(m.updated) >= -5000 && now - Date.parse(m.updated) <= MAX_AGE[m.phase];
// Identifiants du marché français, distincts d'Unibet/bet365 internationaux.
const FRENCH_BOOKS: Record<number, string> = { 141: 'betclic_fr', 264: 'winamax_fr', 160: 'unibet_fr', 1195: 'pmu_fr', 905: 'betsson_fr', 1243: 'bet365_fr', 129: 'bwin_fr', 398: 'netbet_fr' };
export const bookmakerKey = (b: BookPrice) => b.source === 'the-odds-api' ? b.key : b.french ? FRENCH_BOOKS[Number(b.key.split(':')[1])] ?? b.key : b.key;

const identity = (q: OddsQuote, sport: Sport): { kind: MarketKind; line?: number; side: string } | undefined => {
  const scope = sport === 'nba' ? 'FULL_TIME_OVER_TIME' : 'FULL_TIME';
  if (sport === 'tennis' && q.market === 'HOME_AWAY' && q.scope === 'FIRST_SET' && q.side) return { kind: 'set1', side: q.side };
  if (q.scope !== scope) return undefined;
  if (q.market === (sport === 'foot' ? 'HOME_DRAW_AWAY' : 'HOME_AWAY') && q.side) return { kind: 'win', side: q.side };
  const rawLine = q.handicap?.value;
  if (rawLine == null || !/^-?\d+(?:\.\d+)?$/.test(rawLine)) return undefined;
  const line = Number(rawLine), unit = q.handicap?.type;
  if (!Number.isFinite(line)) return undefined;
  const tennis = sport === 'tennis';
  if (tennis && unit !== 'GAMES' && unit !== 'SETS') return undefined;
  if (!tennis && unit && !['UNKNOWN', sport === 'nba' ? 'POINTS' : 'GOALS'].includes(unit)) return undefined;
  if (q.market === 'ASIAN_HANDICAP' && (q.side === 'home' || q.side === 'away')) {
    return { kind: tennis ? unit === 'SETS' ? 'sets' : 'games' : 'spread', line: q.side === 'away' ? -line : line, side: q.side };
  }
  if (q.market === 'OVER_UNDER' && ['OVER', 'UNDER'].includes(q.outcome)) return { kind: tennis ? unit === 'SETS' ? 'totalSets' : 'totalGames' : 'total', line, side: q.outcome.toLowerCase() };
  return undefined;
};

/** Un seul bookmaker/phase/période/ligne par paire : aucune meilleure cote composite inventée. */
export function flashscoreBooks(snapshot: OddsSnapshot, sport: Sport, flip = false, now = Date.now()): BookPrice[] {
  const groups = new Map<string, { book: number; title: string; kind: MarketKind; scope: string; phase: 'prematch' | 'live'; line?: number; values: Map<string, OddsQuote[]> }>();
  for (const q of snapshot.quotes) {
    if (q.status !== 'active' || !decimal(q.odds) || !Number.isFinite(quoteTime(q)) || now - quoteTime(q) > MAX_AGE[q.phase] || quoteTime(q) > now + 5000) continue;
    const id = identity(q, sport);
    if (!id) continue;
    const key = JSON.stringify([q.bookmakerId, q.phase, q.scope, id.kind, id.line ?? null]);
    const group = groups.get(key) ?? { book: q.bookmakerId, title: q.bookmakerName ?? `Bookmaker ${q.bookmakerId}`, kind: id.kind, scope: q.scope, phase: q.phase, line: id.line, values: new Map<string, OddsQuote[]>() };
    group.values.set(id.side, [...(group.values.get(id.side) ?? []), q]);
    groups.set(key, group);
  }
  const books = new Map<string, BookPrice>();
  for (const g of groups.values()) {
    const sides = g.kind.startsWith('total') ? ['over', 'under'] : g.kind === 'win' && sport === 'foot' ? ['home', 'draw', 'away'] : ['home', 'away'];
    if (sides.some((s) => g.values.get(s)?.length !== 1)) continue;
    const quotes = sides.map((s) => g.values.get(s)![0]);
    const updated = new Date(Math.min(...quotes.map(quoteTime))).toISOString();
    const m: MarketPrice = { kind: g.kind, scope: g.scope, phase: g.phase, line: g.line, updated, observedAt: new Date(Math.max(...quotes.map((q) => Date.parse(q.fetchedAt)))).toISOString(), sourceAgeSeconds: quotes.some((q) => q.ageSeconds == null) ? null : Math.max(...quotes.map((q) => q.ageSeconds!)) };
    for (const side of sides) {
      const target = flip && side === 'home' ? 'away' : flip && side === 'away' ? 'home' : side;
      Object.assign(m, { [target]: g.values.get(side)![0].odds });
    }
    if (flip && m.line != null && ['spread', 'sets', 'games'].includes(m.kind)) m.line = -m.line;
    const key = `flashscore:${g.book}:${g.phase}`;
    const b = books.get(key) ?? { key, title: g.title, source: 'flashscore', french: (snapshot.countryCode === 'FR' && FRENCH_BOOKS[g.book] != null) || /(?:\.fr\b|\(FR\))/i.test(g.title), projectId: snapshot.projectId, countryCode: snapshot.countryCode, phase: g.phase, updated, markets: [] };
    b.markets.push(m); books.set(key, b);
  }
  return [...books.values()].map(flattenBook);
}

/** La ligne principale est la plus équilibrée du bookmaker ; toutes les autres restent dans markets. */
export function mainLine(markets: MarketPrice[], kind: MarketKind): MarketPrice | undefined {
  return markets.filter((m) => m.kind === kind).sort((a, b) => (Math.abs((a.home ?? a.over ?? 0) - (a.away ?? a.under ?? 0)) - Math.abs((b.home ?? b.over ?? 0) - (b.away ?? b.under ?? 0))) || (a.line ?? 0) - (b.line ?? 0))[0];
}
export function flattenBook(b: BookPrice): BookPrice {
  const win = mainLine(b.markets, 'win'), spread = mainLine(b.markets, 'spread'), total = mainLine(b.markets, 'total');
  return { ...b, updated: win?.updated ?? b.markets[0]?.updated ?? b.updated, home: win?.home, away: win?.away, draw: win?.draw,
    spread: spread && { point: spread.line!, home: spread.home!, away: spread.away! }, total: total && { point: total.line!, over: total.over!, under: total.under! } };
}

export function selectBook(books: BookPrice[], phase: 'prematch' | 'live', now = Date.now(), preferred = 'betclic_fr'): BookPrice | undefined {
  return books.filter((b) => b.phase === phase && b.markets.some((m) => m.kind === 'win' && freshMarket(m, now))).sort((a, b) => {
    const ap = bookmakerKey(a) === preferred, bp = bookmakerKey(b) === preferred;
    // Même bookmaker de référence : le relevé Flashscore est prioritaire, sans comparer son heure de lecture
    // à une date de mise à jour d'un autre service. Sinon le changement de fournisseur changeait aussi le bookmaker.
    return Number(bp) - Number(ap) || (ap && bp ? Number(b.source === 'flashscore') - Number(a.source === 'flashscore') : 0) || Date.parse(b.updated) - Date.parse(a.updated) || Number(/pinnacle/i.test(b.title)) - Number(/pinnacle/i.test(a.title)) || a.key.localeCompare(b.key);
  })[0];
}

export function withReference(game: OddsGame, now = Date.now(), preferred = 'betclic_fr'): OddsGame {
  const phase = game.state === 'pre' ? 'prematch' : 'live';
  const pin = game.books.find((b) => /^pinnacle(?:\s|$)/i.test(b.title) && b.phase === phase && b.markets.some((m) => m.kind === 'win' && freshMarket(m, now)));
  const sum = pin?.home && pin.away ? 1 / pin.home + 1 / pin.away + (pin.draw ? 1 / pin.draw : 0) : 0;
  const selected = selectBook(game.books, phase, now, preferred);
  return { ...game, selected: selected?.key, selection: selected && { preferred, bookmaker: bookmakerKey(selected), source: selected.source, reason: bookmakerKey(selected) === preferred ? 'preferred' : 'fallback' }, ref: sum && pin ? { home: (1 / pin.home!) / sum, away: (1 / pin.away!) / sum } : undefined };
}
