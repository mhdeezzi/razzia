import { Flashscore, type Board, type Match, type Sport } from '../live/flashscore.ts';
import { sameParticipant } from '../live/sources/matching.ts';
import { flashscoreBooks, withReference, type OddsGame, type OddsTarget } from './prices.ts';

const DAY = 86_400_000;
const futureDays = (start: string, now: number): number[] => {
  const d = Math.floor(Date.parse(start) / DAY) - Math.floor(now / DAY);
  // Le jour affiché par Flashscore peut déborder sur la date UTC voisine (tournois et matchs de nuit).
  return [d - 1, d, d + 1].filter((n) => n >= 0 && n <= 7);
};
const order = (target: OddsTarget, m: Match, sport: Sport) => {
  const same = sameParticipant(target.home, m.home, sport) && sameParticipant(target.away, m.away, sport);
  const flip = sameParticipant(target.home, m.away, sport) && sameParticipant(target.away, m.home, sport);
  return same !== flip ? flip : undefined;
};
const candidatesFor = (target: OddsTarget, matches: Match[], sport: Sport) => matches.filter((m) => m.state !== 'unknown' && m.start && Math.abs(Date.parse(m.start) - Date.parse(target.start)) < 18 * 3600_000 && order(target, m, sport) !== undefined);

export class FlashscoreOddsProvider {
  private client: Flashscore;
  private now: () => number;
  private cache = new Map<string, { at: number; value: OddsGame }>();
  private pending = new Map<string, Promise<OddsGame>>();
  private calendars = new Map<string, { at: number; value: Board }>();
  private calendarPending = new Map<string, Promise<Board>>();
  constructor(options: { client?: Flashscore; now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    this.client = options.client ?? new Flashscore({ ttlMs: 5000, oddsLocale: 'fr' });
  }
  async board(sport: Sport, day = 0): Promise<Board> {
    if (process.env.ODDS_FLASHSCORE === '0') throw new Error('Fournisseur Flashscore désactivé');
    if (!Number.isInteger(day) || day < 0 || day > 7) throw new Error('Jour Flashscore invalide');
    const key = `${sport}:${Math.floor(this.now() / DAY)}:${day}`;
    const old = this.calendars.get(key);
    if (day > 0 && old && this.now() - old.at < 60_000) return old.value;
    let pending = this.calendarPending.get(key);
    if (!pending) {
      pending = (async () => {
        const b = await this.client.board(sport, day);
        if (b.stale) throw new Error('Tableau Flashscore ancien');
        if (day > 0) {
          this.calendars.set(key, { at: this.now(), value: b });
          if (this.calendars.size > 32) this.calendars.delete(this.calendars.keys().next().value!);
        }
        return b;
      })();
      this.calendarPending.set(key, pending);
    }
    try { return await pending; } finally { if (this.calendarPending.get(key) === pending) this.calendarPending.delete(key); }
  }
  async read(sport: Sport, targets: OddsTarget[], board?: Board): Promise<OddsGame[]> {
    const b = board ?? await this.board(sport);
    const missing = targets.filter((t) => t.state !== 'post' && candidatesFor(t, b.matches, sport).length !== 1);
    const days = [...new Set(missing.flatMap((t) => futureDays(t.start, this.now())))].filter((d) => d !== 0);
    const other = await Promise.allSettled(days.map((d) => this.board(sport, d)));
    const indexById = new Map<string, { match: Match; at: number }>();
    const rank = { unknown: 0, pre: 1, in: 2, post: 3 };
    for (const calendar of [b, ...other.flatMap((r) => r.status === 'fulfilled' ? [r.value] : [])]) {
      const at = Date.parse(calendar.fetchedAt) - (calendar.ageSeconds ?? 0) * 1000;
      for (const match of calendar.matches) {
        const previous = indexById.get(match.id);
        if (!previous || rank[match.state] > rank[previous.match.state] || (rank[match.state] === rank[previous.match.state] && at > previous.at)) indexById.set(match.id, { match, at });
      }
    }
    const all = [...indexById.values()].map((m) => m.match);
    const failedDays = days.filter((_, i) => other[i].status === 'rejected');
    let index = 0;
    const games: OddsGame[] = Array(targets.length);
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (index < targets.length) {
        const i = index++, target = targets[i];
        const candidates = candidatesFor(target, all, sport);
        if (target.state === 'post' || candidates.length !== 1) {
          const unavailable = target.state !== 'post' && failedDays.some((d) => futureDays(target.start, this.now()).includes(d));
          games[i] = { ...target, sport, books: [], ...(unavailable ? { errors: { calendar: 'Un tableau Flashscore des prochains jours est indisponible' } } : {}) };
          continue;
        }
        const match = candidates[0], flip = order(target, match, sport)!;
        if (match.state === 'post' || (target.state === 'in' && match.state === 'pre')) {
          games[i] = { ...target, sport, state: match.state === 'post' ? 'post' : 'in', sourceId: match.id, books: [] };
          continue;
        }
        const key = JSON.stringify([sport, match.id, match.state, flip]);
        const cached = this.cache.get(key);
        let value: OddsGame;
        if (cached && this.now() - cached.at < 5000) value = cached.value;
        else {
          let pending = this.pending.get(key);
          if (!pending) {
            pending = (async () => {
              const snapshot = await this.client.odds(match, { liveMarkets: ['HOME_AWAY', 'HOME_DRAW_AWAY', 'ASIAN_HANDICAP', 'OVER_UNDER'], liveScopes: [sport === 'nba' ? 'FULL_TIME_OVER_TIME' : 'FULL_TIME'] });
              const value = withReference({ ...target, sport, state: match.state === 'in' ? 'in' : 'pre', sourceId: match.id, books: flashscoreBooks(snapshot, sport, flip, this.now()), errors: snapshot.errors }, this.now());
              this.cache.set(key, { at: this.now(), value });
              if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
              return value;
            })();
            this.pending.set(key, pending);
          }
          try { value = await pending; } finally { if (this.pending.get(key) === pending) this.pending.delete(key); }
        }
        games[i] = { ...value, id: target.id, home: target.home, away: target.away, start: target.start };
      }
    }));
    return games;
  }
}
