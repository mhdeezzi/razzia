// Historique des matchs ATP au format Sackmann (circuit principal, Challengers et qualifications) : lecture et mise en
// forme commune. Les fichiers viennent de la copie publique des données Sackmann (GitHub), en cache dans
// data/cache/tennis/sackmann.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Surface = 'Hard' | 'Clay' | 'Grass';
export interface Serve { svpt: number; firstIn: number; firstWon: number; secondWon: number; svGms: number; bpSaved: number; bpFaced: number; ace: number; df: number }
export interface Side { id: string; name: string; ioc: string; hand: string; ht?: number; age?: number; rank?: number; pts?: number; entry: string; seed?: number; serve?: Serve }
export interface Match {
  key: string; // tournoi + numéro du match
  date: string; // jour estimé du match (début du tournoi + jours selon le tour)
  tid: string;
  tourney: string;
  level: string; // G Grand Chelem, M Masters 1000, A ATP 250/500, F Finales, O JO, C Challenger
  qual: boolean;
  surface: Surface;
  bo: 3 | 5;
  round: string;
  w: Side;
  l: Side;
  score: string;
  minutes?: number;
  retired: boolean; // le perdant a abandonné en cours de match
  walkover: boolean;
  wSets: number;
  lSets: number;
}

export interface Player { id: string; first: string; last: string; hand: string; dob?: string; ioc: string; ht?: number; wikidata?: string }

const ROUND_DAY_SLAM: Record<string, number> = { Q1: -4, Q2: -3, Q3: -2, R128: 1, R64: 3, R32: 5, R16: 7, QF: 9, SF: 11, F: 13 };
const ROUND_DAY: Record<string, number> = { Q1: -2, Q2: -1, Q3: 0, R128: 0, R64: 1, R32: 2, R16: 3, QF: 4, SF: 5, RR: 3, BR: 6, F: 6 };
export const ROUND_ORDER: Record<string, number> = { Q1: 0, Q2: 1, Q3: 2, R128: 3, R64: 4, R32: 5, R16: 6, RR: 7, QF: 8, SF: 9, BR: 9.5, F: 10 };

function csv(file: string): Array<Record<string, string>> {
  const [h, ...rows] = readFileSync(file, 'utf8').trim().split('\n');
  const H = h.split(',');
  return rows.map((l) => {
    const c = l.split(',');
    return Object.fromEntries(H.map((k, i) => [k, c[i] ?? '']));
  });
}
const num = (s: string) => (s === '' || s == null ? undefined : Number(s));

export function loadPlayers(dir: string): Map<string, Player> {
  const out = new Map<string, Player>();
  for (const p of csv(join(dir, 'atp_players.csv')))
    out.set(p.player_id, { id: p.player_id, first: p.name_first, last: p.name_last, hand: p.hand, dob: p.dob || undefined, ioc: p.ioc, ht: num(p.height), wikidata: p.wikidata_id || undefined });
  return out;
}

/** Sets gagnés par chacun, abandon et forfait, d'après le score (« 6-4 3-6 7-6(5) », « 6-3 2-1 RET », « W/O »). */
export function parseScore(score: string): { wSets: number; lSets: number; retired: boolean; walkover: boolean } {
  const walkover = /W\/O|walkover/i.test(score);
  const retired = /RET|DEF|ABD|ABN/i.test(score);
  let wSets = 0, lSets = 0;
  for (const s of score.split(' ')) {
    const m = /^(\d+)-(\d+)/.exec(s);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    const done = (a >= 6 || b >= 6) && (Math.abs(a - b) >= 2 || a === 7 || b === 7 || a >= 10 || b >= 10);
    if (!done) continue;
    if (a > b) wSets++;
    else lSets++;
  }
  return { wSets, lSets, retired, walkover };
}

/** Matchs des années demandées (circuit principal, et Challengers + qualifications si présents), dans l'ordre. */
export function loadMatches(dir: string, from: number, to: number, opts: { challengers?: boolean } = {}): Match[] {
  const out: Match[] = [];
  const files: string[] = [];
  for (let y = from; y <= to; y++) {
    files.push(`atp_matches_${y}.csv`);
    if (opts.challengers !== false) files.push(`atp_matches_qual_chall_${y}.csv`);
  }
  for (const f of files) {
    if (!existsSync(join(dir, f))) continue;
    for (const r of csv(join(dir, f))) {
      if (!['G', 'M', 'A', 'F', 'O', 'C'].includes(r.tourney_level) || !r.winner_id || !r.loser_id) continue;
      const surface: Surface = r.surface === 'Clay' ? 'Clay' : r.surface === 'Grass' ? 'Grass' : 'Hard';
      const d = r.tourney_date;
      const start = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
      const offset = (r.tourney_level === 'G' ? ROUND_DAY_SLAM : ROUND_DAY)[r.round] ?? 3;
      const sc = parseScore(r.score);
      const side = (p: 'winner' | 'loser', s: 'w' | 'l'): Side => ({
        id: r[`${p}_id`], name: r[`${p}_name`], ioc: r[`${p}_ioc`], hand: r[`${p}_hand`], ht: num(r[`${p}_ht`]), age: num(r[`${p}_age`]),
        rank: num(r[`${p}_rank`]), pts: num(r[`${p}_rank_points`]), entry: r[`${p}_entry`], seed: num(r[`${p}_seed`]),
        serve: r[`${s}_svpt`] ? { svpt: +r[`${s}_svpt`], firstIn: +r[`${s}_1stIn`], firstWon: +r[`${s}_1stWon`], secondWon: +r[`${s}_2ndWon`], svGms: +r[`${s}_SvGms`], bpSaved: +r[`${s}_bpSaved`], bpFaced: +r[`${s}_bpFaced`], ace: +r[`${s}_ace`], df: +r[`${s}_df`] } : undefined,
      });
      out.push({
        key: `${r.tourney_id}-${r.match_num}`, date: new Date(start + offset * 86_400_000).toISOString().slice(0, 10), tid: r.tourney_id, tourney: r.tourney_name,
        level: r.tourney_level, qual: r.round.startsWith('Q'), surface, bo: r.best_of === '5' ? 5 : 3, round: r.round,
        w: side('winner', 'w'), l: side('loser', 'l'), score: r.score, minutes: num(r.minutes), ...sc,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.tid.localeCompare(b.tid) || (ROUND_ORDER[a.round] ?? 5) - (ROUND_ORDER[b.round] ?? 5));
}
