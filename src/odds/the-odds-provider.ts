import { decimal, flattenBook, freshMarket, type BookPrice, type MarketPrice, type OddsGame } from './prices.ts';

const BOOKS = ['pinnacle', 'betclic_fr', 'unibet_fr', 'winamax_fr', 'parionssport_fr', 'netbet_fr', 'pmu_fr'];
export interface OddsApiRead { games: OddsGame[]; creditsLeft?: number; error?: string }
export class TheOddsProvider {
  private key: string;
  private request: typeof fetch;
  private now: () => number;
  private cache?: { at: number; value: OddsApiRead };
  private pending?: Promise<OddsApiRead>;
  private retryAt = 0;
  constructor(options: { key?: string; fetch?: typeof fetch; now?: () => number } = {}) {
    this.key = (options.key ?? process.env.ODDS_API_KEY ?? '').trim();
    this.request = options.fetch ?? ((...args) => fetch(...args)); this.now = options.now ?? Date.now;
  }
  configured(): boolean { return !!this.key; }
  async read(): Promise<OddsApiRead> {
    if (!this.key) return { games: [], error: 'The Odds API non configuré' };
    if (this.cache && this.now() - this.cache.at < 600_000) return this.cache.value;
    if (this.now() < this.retryAt) return { ...this.cache?.value, games: this.cache?.value.games ?? [], error: 'The Odds API temporairement indisponible' };
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const url = new URL('https://api.the-odds-api.com/v4/sports/basketball_nba/odds');
        url.search = new URLSearchParams({ apiKey: this.key, bookmakers: BOOKS.join(','), markets: 'h2h,spreads,totals', oddsFormat: 'decimal' }).toString();
        const r = await this.request(url, { signal: AbortSignal.timeout(12_000) });
        if (!r.ok) {
          const wait = r.headers.get('retry-after');
          this.retryAt = this.now() + Math.max(60_000, wait && /^\d+$/.test(wait) ? Number(wait) * 1000 : wait ? Math.max(0, Date.parse(wait) - this.now()) || 0 : 0);
          throw new Error(`The Odds API ${r.status}`);
        }
        const data = await r.json();
        if (!Array.isArray(data)) throw new Error('Réponse The Odds API illisible');
        const observedAt = new Date(this.now()).toISOString();
        const games: OddsGame[] = data.flatMap((e: any) => {
          if (typeof e.home_team !== 'string' || typeof e.away_team !== 'string' || !e.home_team || !e.away_team || !Number.isFinite(Date.parse(e.commence_time))) return [];
          const state = Date.parse(e.commence_time) > this.now() ? 'pre' as const : 'in' as const;
          const phase = state === 'pre' ? 'prematch' as const : 'live' as const;
          const books: BookPrice[] = (e.bookmakers ?? []).filter((b: any) => typeof b.key === 'string' && typeof b.title === 'string').map((b: any) => {
            const markets: MarketPrice[] = [];
            for (const m of b.markets ?? []) {
              const outcomes = Array.isArray(m.outcomes) ? m.outcomes : [];
              const pick = (name: string) => { const matches = outcomes.filter((o: any) => o.name === name); return matches.length === 1 ? matches[0] : undefined; };
              const h = pick(e.home_team), a = pick(e.away_team), o = pick('Over'), u = pick('Under');
              const updated = m.last_update ?? b.last_update;
              if (!Number.isFinite(Date.parse(updated))) continue; // une lecture récente n'est pas une mise à jour du bookmaker
              const common = { scope: 'FULL_TIME_OVER_TIME', phase, updated, observedAt, sourceAgeSeconds: null };
              if (m.key === 'h2h' && decimal(h?.price) && decimal(a?.price)) markets.push({ ...common, kind: 'win', home: h.price, away: a.price });
              if (m.key === 'spreads' && decimal(h?.price) && decimal(a?.price) && Number.isFinite(h?.point) && a?.point === -h.point) markets.push({ ...common, kind: 'spread', line: h.point, home: h.price, away: a.price });
              if (m.key === 'totals' && decimal(o?.price) && decimal(u?.price) && Number.isFinite(o?.point) && o.point === u?.point) markets.push({ ...common, kind: 'total', line: o.point, over: o.price, under: u.price });
            }
            return flattenBook({ key: b.key, title: b.title, source: 'the-odds-api', french: BOOKS.includes(b.key) && b.key !== 'pinnacle', phase, updated: b.last_update ?? '', markets: markets.filter((m) => freshMarket(m, this.now())) });
          }).filter((b: BookPrice) => b.markets.length);
          return [{ id: String(e.id), sport: 'nba' as const, home: e.home_team, away: e.away_team, start: e.commence_time, state, books }];
        });
        const remaining = r.headers.get('x-requests-remaining');
        const value = { games, ...(remaining != null && Number.isFinite(Number(remaining)) ? { creditsLeft: Number(remaining) } : {}) };
        this.cache = { at: this.now(), value };
        return value;
      } catch (error) {
        this.retryAt = Math.max(this.retryAt, this.now() + 60_000);
        return { ...this.cache?.value, games: this.cache?.value.games ?? [], error: error instanceof Error && error.message.startsWith('The Odds API ') ? error.message : 'The Odds API indisponible' };
      }
    })();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
}
