// Représentation compacte des résultats de N simulations (tableaux typés, transférables entre workers).
import type { GameModel } from '../model/types.ts';
import type { GameResult } from './game.ts';
import { simulateGame } from './game.ts';

export const STAT_KEYS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk', 'tov', 'min', 'fga', 'fgm', 'fg3a', 'fta', 'ftm', 'oreb', 'dreb', 'pf', 'pm', 'played'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const NK = STAT_KEYS.length;
export const MAXQ = 8; // 4 quarts-temps + 4 prolongations max
export const ZK = 19; // profil de tir par équipe : 6 zones tentées, 6 réussies, passes décisives, contre-attaques tentées / réussies, 4 niveaux de contestation

export interface Batch {
  n: number;
  seeds: Int32Array;
  home: Int16Array;
  away: Int16Array;
  periods: Uint8Array;
  qHome: Int16Array; // n × MAXQ
  qAway: Int16Array;
  poss: Int16Array; // n × 2
  firstScorer: Int32Array;
  leadChanges: Int16Array;
  players: number[]; // ordre des joueurs (domicile puis extérieur)
  stats: Float32Array; // n × players × NK
  shots: Float32Array; // n × 2 × ZK
}

export function playerOrder(m: GameModel): number[] {
  return [...m.home.players.map((p) => p.id), ...m.away.players.map((p) => p.id)];
}

export function emptyBatch(n: number, players: number[]): Batch {
  return {
    n, seeds: new Int32Array(n), home: new Int16Array(n), away: new Int16Array(n), periods: new Uint8Array(n),
    qHome: new Int16Array(n * MAXQ), qAway: new Int16Array(n * MAXQ), poss: new Int16Array(n * 2), firstScorer: new Int32Array(n),
    leadChanges: new Int16Array(n), players, stats: new Float32Array(n * players.length * NK), shots: new Float32Array(n * 2 * ZK),
  };
}

export function store(b: Batch, i: number, r: GameResult): void {
  b.seeds[i] = r.seed;
  b.home[i] = r.home.pts;
  b.away[i] = r.away.pts;
  b.periods[i] = r.periods;
  for (let q = 0; q < MAXQ; q++) {
    b.qHome[i * MAXQ + q] = r.home.q[q] ?? 0;
    b.qAway[i * MAXQ + q] = r.away.q[q] ?? 0;
  }
  b.poss[i * 2] = r.home.poss;
  b.poss[i * 2 + 1] = r.away.poss;
  b.firstScorer[i] = r.firstScorer;
  b.leadChanges[i] = r.leadChanges;
  [r.home, r.away].forEach((t, side) => {
    const o = (i * 2 + side) * ZK;
    for (let z = 0; z < 6; z++) {
      b.shots[o + z] = t.zFga?.[z] ?? 0;
      b.shots[o + 6 + z] = t.zFgm?.[z] ?? 0;
    }
    b.shots[o + 12] = t.astM ?? 0;
    b.shots[o + 13] = t.transFga ?? 0;
    b.shots[o + 14] = t.transFgm ?? 0;
    for (let c = 0; c < 4; c++) b.shots[o + 15 + c] = t.cont?.[c] ?? 0;
  });
  const idx = new Map(b.players.map((id, k) => [id, k]));
  const P = b.players.length;
  for (const l of [...r.home.lines, ...r.away.lines]) {
    const k = idx.get(l.id);
    if (k == null) continue;
    const o = (i * P + k) * NK;
    const s = b.stats;
    s[o + 0] = l.pts;
    s[o + 1] = l.oreb + l.dreb;
    s[o + 2] = l.ast;
    s[o + 3] = l.fg3m;
    s[o + 4] = l.stl;
    s[o + 5] = l.blk;
    s[o + 6] = l.tov;
    s[o + 7] = l.sec / 60;
    s[o + 8] = l.fga;
    s[o + 9] = l.fgm;
    s[o + 10] = l.fg3a;
    s[o + 11] = l.fta;
    s[o + 12] = l.ftm;
    s[o + 13] = l.oreb;
    s[o + 14] = l.dreb;
    s[o + 15] = l.pf;
    s[o + 16] = l.pm;
    s[o + 17] = l.played ? 1 : 0;
  }
}

export function runRange(m: GameModel, seeds: number[], players: number[]): Batch {
  const b = emptyBatch(seeds.length, players);
  seeds.forEach((seed, i) => store(b, i, simulateGame(m, seed)));
  return b;
}

export function merge(parts: Batch[], players: number[]): Batch {
  const n = parts.reduce((a, p) => a + p.n, 0);
  const b = emptyBatch(n, players);
  let o = 0;
  for (const p of parts) {
    b.seeds.set(p.seeds, o);
    b.home.set(p.home, o);
    b.away.set(p.away, o);
    b.periods.set(p.periods, o);
    b.qHome.set(p.qHome, o * MAXQ);
    b.qAway.set(p.qAway, o * MAXQ);
    b.poss.set(p.poss, o * 2);
    b.firstScorer.set(p.firstScorer, o);
    b.leadChanges.set(p.leadChanges, o);
    b.stats.set(p.stats, o * players.length * NK);
    if (p.shots) b.shots.set(p.shots, o * 2 * ZK);
    o += p.n;
  }
  return b;
}

export function stat(b: Batch, sim: number, playerIdx: number, key: StatKey): number {
  return b.stats[(sim * b.players.length + playerIdx) * NK + STAT_KEYS.indexOf(key)];
}
