// Cotes réellement publiées par les bookmakers via Flashscore ; aucune cote calculée par Razzia.
import type { Feed, Match } from './flashscore.ts';

export interface OddsQuery {
  hash: 'oce' | 'lobtm' | 'ole2'; eventId: string;
  bookmakerId?: number; market?: string; scope?: string;
}
export interface OddsQuote {
  kind: 'bookmaker'; label: 'Cote'; phase: 'prematch' | 'live';
  bookmakerId: number; bookmakerName: string | null;
  market: string; scope: string; outcome: string;
  side: 'home' | 'away' | 'draw' | null; participantId: string | null;
  handicap: { value: string; type: string | null } | null;
  odds: number | null; openingOdds: number | null; previousOdds: number | null;
  rawValue: string | null; active: boolean | null;
  status: 'active' | 'suspended' | 'unknown' | 'historical' | 'stale';
  fetchedAt: string; ageSeconds: number | null; feedKey: string;
}
export interface OddsSnapshot {
  source: 'flashscore'; label: 'Cote'; complete: boolean;
  quotes: OddsQuote[]; feeds: Record<string, Feed>; errors: Record<string, string>;
  liveRequested: boolean; liveMarkets: number; liveReads: number;
  retryAfterMs: number;
}

type ObjectValue = Record<string, unknown>;
const obj = (v: unknown): ObjectValue | undefined => v != null && typeof v === 'object' && !Array.isArray(v) ? v as ObjectValue : undefined;
const text = (v: unknown): string | null => typeof v === 'string' ? v : null;
const array = (v: unknown, name: string): unknown[] => { if (!Array.isArray(v)) throw new Error('Format des cotes modifié : ' + name); return v; };
const idOf = (v: unknown): number => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new Error('Identifiant bookmaker absent ou invalide'); return v; };
const decimal = (v: unknown): number | null => {
  const s = typeof v === 'number' ? String(v) : text(v);
  return s && /^\d+(?:\.\d+)?$/.test(s) && Number.isFinite(Number(s)) && Number(s) >= 1 ? Number(s) : null;
};

export function oddsData(feed: Feed, key: string): ObjectValue | null {
  const root = obj(JSON.parse(feed.raw));
  const data = obj(root?.data);
  if (!root || (root.errors != null && (!Array.isArray(root.errors) || root.errors.length > 0)) || !data || !Object.hasOwn(data, key)) throw new Error('Réponse de cotes incomplète : ' + key);
  if (data[key] === null) return null;
  const value = obj(data[key]);
  if (!value) throw new Error('Format des cotes modifié : ' + key);
  return value;
}

function bookmakerNames(settings: unknown): Map<number, string> {
  const entries = obj(settings)?.bookmakers;
  const names = new Map<number, string>();
  if (entries == null) return names;
  for (const entry of array(entries, 'bookmakers')) {
    const book = obj(obj(entry)?.bookmaker);
    if (book && typeof book.name === 'string') names.set(idOf(book.id), book.name);
  }
  return names;
}

function quote(match: Match, feed: Feed, feedKey: string, phase: 'prematch' | 'live', book: number, names: Map<number, string>, market: string, scope: string, value: ObjectValue, context: ObjectValue = {}): OddsQuote {
  const participantId = text(value.eventParticipantId);
  // JA/JB sont les identifiants des participants dans CE match, pas PX/PY (équipe/joueur global).
  const homeId = match.fields.find(([k]) => k === 'JA')?.[1], awayId = match.fields.find(([k]) => k === 'JB')?.[1];
  let side: OddsQuote['side'] = participantId && participantId === homeId ? 'home' : participantId && participantId === awayId ? 'away' : null;
  const explicit = text(context.outcome);
  if (!side && ['home', 'away', 'draw'].includes(explicit ?? '')) side = explicit as OddsQuote['side'];
  if (!side && participantId == null && market === 'HOME_DRAW_AWAY') side = 'draw';
  const handicap = obj(value.handicap) ?? obj(context.handicap);
  const line = handicap && text(handicap.value);
  const change = obj(value.change);
  const active = typeof value.active === 'boolean' ? value.active : null;
  const historical = phase === 'prematch' && match.state !== 'pre';
  const doubleChance = market === 'DOUBLE_CHANCE' ? side === 'home' ? '1X' : side === 'away' ? 'X2' : participantId == null ? '12' : null : null;
  const outcome = text(value.selection) ?? text(value.score) ?? text(value.winner) ??
    (typeof value.bothTeamsToScore === 'boolean' ? value.bothTeamsToScore ? 'yes' : 'no' : null) ??
    text(context.score) ?? explicit ?? doubleChance ?? side ?? participantId ?? 'unknown';
  return {
    kind: 'bookmaker', label: 'Cote', phase, bookmakerId: book, bookmakerName: names.get(book) ?? null,
    market, scope, outcome, side, participantId,
    handicap: line != null ? { value: line, type: text(handicap?.type) } : null,
    odds: decimal(value.value), openingOdds: decimal(value.opening), previousOdds: decimal(change?.previous),
    rawValue: text(value.value), active,
    status: feed.stale ? 'stale' : historical ? 'historical' : active === false ? 'suspended' : decimal(value.value) == null ? 'unknown' : active === true ? 'active' : 'unknown',
    fetchedAt: feed.fetchedAt, ageSeconds: feed.ageSeconds, feedKey,
  };
}

export function parsePrematchOdds(feed: Feed, match: Match): OddsQuote[] {
  const data = oddsData(feed, 'findOddsByEventId');
  if (!data) return [];
  if (data.eventId !== match.id) throw new Error('Les cotes reçues concernent un autre match');
  const names = bookmakerNames(data.settings);
  const quotes: OddsQuote[] = [];
  for (const entry of array(data.odds, 'odds')) {
    const market = obj(entry);
    if (!market || typeof market.bettingType !== 'string' || typeof market.bettingScope !== 'string') throw new Error('Marché de cotes invalide');
    const book = idOf(market.bookmakerId);
    for (const item of array(market.odds, 'market.odds')) {
      const value = obj(item);
      if (!value) throw new Error('Sélection de cote invalide');
      quotes.push(quote(match, feed, 'prematch', 'prematch', book, names, market.bettingType, market.bettingScope, value));
    }
  }
  return quotes;
}

export function parseLiveOdds(feed: Feed, match: Match, query: OddsQuery, names = new Map<number, string>()): OddsQuote[] {
  const data = oddsData(feed, 'findLiveOddsForBookmaker');
  if (!data) return [];
  if (!Object.hasOwn(data, 'eventOddsOverview')) throw new Error('Marché live absent de la réponse');
  const root = data.eventOddsOverview;
  if (root === null) return [];
  if (!obj(root) && !Array.isArray(root)) throw new Error('Marché live invalide');
  const book = idOf(query.bookmakerId), market = query.market!, scope = query.scope!;
  if (obj(root)?.bookmakerId != null && obj(root)?.bookmakerId !== book) throw new Error('Les cotes live reçues concernent un autre bookmaker');
  const feedKey = 'live:' + book + ':' + market + ':' + scope;
  const quotes: OddsQuote[] = [];
  let explicitEmpty = false;
  const outcomes: Record<string, string> = { home: 'home', away: 'away', draw: 'draw', over: 'OVER', under: 'UNDER', yes: 'yes', no: 'no', odd: 'ODD', even: 'EVEN', homeOrDraw: '1X', awayOrDraw: 'X2', noDraw: '12', none: 'none' };
  const walk = (node: unknown, context: ObjectValue = {}) => {
    if (Array.isArray(node)) { if (!node.length) explicitEmpty = true; for (const item of node) walk(item, context); return; }
    const value = obj(node);
    if (!value) return;
    const inherited = { ...context, ...(obj(value.handicap) ? { handicap: value.handicap } : {}), ...(typeof value.score === 'string' ? { score: value.score } : {}) };
    const priceFields = Object.hasOwn(value, 'active') || Object.hasOwn(value, 'opening') || Object.hasOwn(value, 'eventParticipantId');
    if (value.__typename === 'EventOddsOverviewItem' || (priceFields && (Object.hasOwn(value, 'value') || context.outcome != null))) {
      quotes.push(quote(match, feed, feedKey, 'live', book, names, market, scope, value, inherited));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (['handicap', 'change', 'subscriptionSubjects'].includes(key)) continue;
      if (outcomes[key] && child === null) explicitEmpty = true;
      walk(child, { ...inherited, ...(outcomes[key] ? { outcome: outcomes[key] } : {}) });
    }
  };
  walk(root);
  if (!quotes.length && !explicitEmpty) throw new Error('Structure du marché live non reconnue');
  return quotes;
}

export async function readOdds(match: Match, request: (query: OddsQuery) => Promise<Feed>): Promise<OddsSnapshot> {
  const feeds: Record<string, Feed> = {}, errors: Record<string, string> = {};
  const quotes: OddsQuote[] = [];
  let liveMarkets = 0, liveReads = 0;
  const get = async (key: string, query: OddsQuery) => {
    const feed = await request(query);
    feeds[key] = feed;
    if (feed.stale) errors[key] = feed.staleReason ?? 'Dernières cotes connues, source indisponible';
    return feed;
  };
  const prematch = (async () => {
    try { quotes.push(...parsePrematchOdds(await get('prematch', { hash: 'oce', eventId: match.id }), match)); }
    catch (e) { errors.prematch = e instanceof Error ? e.message : 'Cotes indisponibles'; }
  })();
  const live = (async () => {
    if (match.state !== 'in') return;
    try {
      const menu = oddsData(await get('liveMenu', { hash: 'lobtm', eventId: match.id }), 'getLiveOddsBettingTypeMenu');
      if (!menu) return;
      const names = bookmakerNames(menu.settings);
      const jobs = new Map<string, OddsQuery>();
      for (const entry of array(menu.items, 'liveMenu.items')) {
        const item = obj(entry);
        if (!item || typeof item.bettingType !== 'string' || typeof item.bettingScope !== 'string') throw new Error('Menu de marchés live invalide');
        if (item.isActive === false || !array(item.types, 'liveMenu.types').includes('LIVE')) continue;
        for (const book of array(item.bookmakerIds, 'liveMenu.bookmakerIds')) {
          const id = idOf(book), key = 'live:' + id + ':' + item.bettingType + ':' + item.bettingScope;
          jobs.set(key, { hash: 'ole2', eventId: match.id, bookmakerId: id, market: item.bettingType, scope: item.bettingScope });
        }
      }
      liveMarkets = jobs.size;
      const entries = [...jobs];
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (index < entries.length) {
          const [key, query] = entries[index++];
          try {
            quotes.push(...parseLiveOdds(await get(key, query), match, query, names));
            liveReads++;
          } catch (e) { errors[key] = e instanceof Error ? e.message : 'Cote live indisponible'; }
        }
      }));
    } catch (e) { errors.liveMenu = e instanceof Error ? e.message : 'Menu des cotes live indisponible'; }
  })();
  await Promise.all([prematch, live]);
  quotes.sort((a, b) => (a.phase + a.bookmakerId + a.market + a.scope + a.outcome).localeCompare(b.phase + b.bookmakerId + b.market + b.scope + b.outcome));
  return { source: 'flashscore', label: 'Cote', complete: !Object.keys(errors).length, quotes, feeds, errors, liveRequested: match.state === 'in', liveMarkets, liveReads, retryAfterMs: 0 };
}
