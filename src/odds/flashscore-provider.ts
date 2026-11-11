import { Flashscore, type Board, type Sport } from '../live/flashscore.ts';
import { sameParticipant } from '../live/sources/matching.ts';
import { flashscoreBooks, withReference, type OddsGame, type OddsTarget } from './prices.ts';

export class FlashscoreOddsProvider {
  private client: Flashscore;
  private now: () => number;
  private cache = new Map<string, { at: number; value: OddsGame }>();
  private pending = new Map<string, Promise<OddsGame>>();
  constructor(options: { client?: Flashscore; now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    this.client = options.client ?? new Flashscore({ ttlMs: 5000 });
  }
  async board(sport: Sport): Promise<Board> {
    if (process.env.ODDS_FLASHSCORE === '0') throw new Error('Fournisseur Flashscore désactivé');
    const b = await this.client.board(sport);
    if (b.stale) throw new Error('Tableau Flashscore ancien');
    return b;
  }
  async read(sport: Sport, targets: OddsTarget[], board?: Board): Promise<OddsGame[]> {
    const b = board ?? await this.board(sport);
    let index = 0;
    const games: OddsGame[] = Array(targets.length);
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (index < targets.length) {
        const i = index++, target = targets[i];
        const order = (home: string, away: string) => sameParticipant(target.home, home, sport) && sameParticipant(target.away, away, sport);
        const candidates = b.matches.filter((m) => m.state !== 'unknown' && m.start && Math.abs(Date.parse(m.start) - Date.parse(target.start)) < 18 * 3600_000 && (order(m.home, m.away) !== order(m.away, m.home)));
        if (target.state === 'post' || candidates.length !== 1) { games[i] = { ...target, sport, books: [] }; continue; }
        const match = candidates[0], flip = !order(match.home, match.away);
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
