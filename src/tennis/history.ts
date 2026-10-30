// Historique des matchs ATP au format Sackmann (circuit principal, Challengers et qualifications) : lecture et mise en
// forme commune. Deux sources au même format : la copie publique des données Sackmann (2015 à mai 2026) et
// TennisMyLife (2026 à jour, tournois de la semaine). Les joueurs sont reconnus par leur nom complet, écrit pareil chez
// Sackmann, TennisMyLife et Pinnacle.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Surface = 'Hard' | 'Clay' | 'Grass';
export interface Serve { svpt: number; firstIn: number; firstWon: number; secondWon: number; svGms: number; bpSaved: number; bpFaced: number; ace: number; df: number }
/** Un joueur dans un match ; `id` : nom complet normalisé (voir nameKey). */
export interface Side { id: string; atp?: string; name: string; ioc: string; hand: string; ht?: number; age?: number; rank?: number; pts?: number; entry: string; seed?: number; serve?: Serve }
export interface Match {
  key: string; // tournoi + numéro du match
  date: string; // jour estimé du match (début du tournoi + jours selon le tour)
  tid: string;
  tourney: string;
  level: string; // G Grand Chelem, M Masters 1000, A ATP 250/500, F Finales, O JO, C Challenger
  qual: boolean;
  surface: Surface;
  indoor?: boolean;
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

/** Une ligne CSV : champs entre guillemets (virgules et guillemets doublés à l'intérieur) acceptés. */
function cells(l: string): string[] {
  if (!l.includes('"')) return l.split(',');
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) {
      if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function csv(file: string): Array<Record<string, string>> {
  // Fins de ligne Windows (certains fichiers TennisMyLife) et marqueur BOM retirés : sinon la dernière colonne est perdue.
  const [h, ...rows] = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split('\n');
  const H = cells(h);
  return rows.map((l) => {
    const c = cells(l);
    return Object.fromEntries(H.map((k, i) => [k, c[i] ?? '']));
  });
}
const num = (s: string) => (s === '' || s == null ? undefined : Number(s));

/** Identifiant d'un joueur : nom complet sans accents ni ponctuation (« Felix Auger-Aliassime » -> « felix auger aliassime »). */
export const nameKey = (name: string) =>
  (name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

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
    // Super tie-break de fin de match, « [10-8] » : un set gagné par celui qui atteint 10 avec 2 points d'écart.
    const tb = /^\[(\d+)-(\d+)\]$/.exec(s);
    if (tb) {
      const a = +tb[1], b = +tb[2];
      if (Math.max(a, b) >= 10 && Math.abs(a - b) >= 2) a > b ? wSets++ : lSets++;
      continue;
    }
    const m = /^(\d+)-(\d+)/.exec(s);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    // Set fini : 6 jeux et 2 d'écart, 7-5, 7-6 (tie-break), ou avantage prolongé (8-6, 12-10…) ; 7-7 ou 10-9 ne sont pas finis.
    const done = Math.max(a, b) >= 6 && (Math.abs(a - b) >= 2 || (Math.max(a, b) === 7 && Math.min(a, b) === 6));
    if (!done) continue;
    if (a > b) wSets++;
    else lSets++;
  }
  return { wSets, lSets, retired, walkover };
}

/** Matchs des années demandées (circuit principal, et Challengers + qualifications si présents), dans l'ordre. */
export function loadMatches(dir: string, from: number, to: number, opts: { challengers?: boolean } = {}): Match[] {
  const files: string[] = [];
  for (let y = from; y <= to; y++) {
    files.push(join(dir, `atp_matches_${y}.csv`));
    if (opts.challengers !== false) files.push(join(dir, `atp_matches_qual_chall_${y}.csv`));
  }
  return sortMatches(readFiles(files));
}

/** Niveau de tournoi commun : TennisMyLife écrit « 250 » et « 500 » là où Sackmann écrit « A ». */
const LEVEL: Record<string, string> = { '250': 'A', '500': 'A' };

/**
 * Lit des fichiers au format Sackmann ou TennisMyLife (mêmes colonnes, plus « indoor » chez TennisMyLife).
 * `matchDates` : la date de chaque ligne est déjà celle du match (TennisMyLife) ; sinon c'est le début du tournoi
 * (Sackmann) et on ajoute les jours habituels selon le tour.
 */
export function readFiles(files: string[], matchDates = false): Match[] {
  const out: Match[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const r of csv(f)) {
      r.tourney_level = LEVEL[r.tourney_level] ?? r.tourney_level;
      if (!['G', 'M', 'A', 'F', 'O', 'C'].includes(r.tourney_level) || !r.winner_name || !r.loser_name) continue;
      const surface: Surface = r.surface === 'Clay' ? 'Clay' : r.surface === 'Grass' ? 'Grass' : 'Hard';
      const d = r.tourney_date;
      const start = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
      const offset = matchDates ? 0 : ((r.tourney_level === 'G' ? ROUND_DAY_SLAM : ROUND_DAY)[r.round] ?? 3);
      const sc = parseScore(r.score);
      const side = (p: 'winner' | 'loser', s: 'w' | 'l'): Side => ({
        id: nameKey(r[`${p}_name`]), atp: /^[A-Z0-9]{4}$/.test(r[`${p}_id`]) ? r[`${p}_id`] : undefined, name: r[`${p}_name`], ioc: r[`${p}_ioc`], hand: r[`${p}_hand`], ht: num(r[`${p}_ht`]), age: num(r[`${p}_age`]),
        rank: num(r[`${p}_rank`]), pts: num(r[`${p}_rank_points`]), entry: r[`${p}_entry`], seed: num(r[`${p}_seed`]),
        serve: r[`${s}_svpt`] ? { svpt: +r[`${s}_svpt`], firstIn: +r[`${s}_1stIn`], firstWon: +r[`${s}_1stWon`], secondWon: +r[`${s}_2ndWon`], svGms: +r[`${s}_SvGms`], bpSaved: +r[`${s}_bpSaved`], bpFaced: +r[`${s}_bpFaced`], ace: +r[`${s}_ace`], df: +r[`${s}_df`] } : undefined,
      });
      out.push({
        key: `${r.tourney_id}-${r.match_num}`, date: new Date(start + offset * 86_400_000).toISOString().slice(0, 10), tid: r.tourney_id, tourney: r.tourney_name,
        level: r.tourney_level, qual: /^Q\d$/.test(r.round) /* Q1, Q2, Q3 ; pas QF */, surface, indoor: r.indoor ? r.indoor === 'I' : undefined, bo: r.best_of === '5' ? 5 : 3, round: r.round,
        w: side('winner', 'w'), l: side('loser', 'l'), score: r.score, minutes: num(r.minutes), ...sc,
      });
    }
  }
  return out;
}

export function sortMatches(out: Match[]): Match[] {
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.tid.localeCompare(b.tid) || (ROUND_ORDER[a.round] ?? 5) - (ROUND_ORDER[b.round] ?? 5));
}
