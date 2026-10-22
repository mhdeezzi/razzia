// Arbitres : chaque arbitre siffle plus ou moins que la moyenne. Pour chaque match, l'écart (log) entre les lancers
// francs par possession et l'attendu des deux équipes (leurs habitudes, provoqués et concédés) est expliqué par les
// trois arbitres (régression ridge, rétrécie vers 0). Le trio du soir donne un multiplicateur de fautes pour le moteur.
import { officialsOf, type GameRecord, type Official } from '../../data/cdn.ts';
import type { ParsedGame } from './pbp.ts';
import { loadGames } from './features.ts';

export interface RefModel {
  effect: Map<number, { log: number; games: number; name: string }>;
}
const LAMBDA = 25; // matchs avant de croire l'écart observé d'un arbitre

interface GameFt {
  date: string;
  refs: number[];
  rate: number; // lancers par possession (deux équipes)
  home: number;
  away: number;
  hFor: number; // lancers provoqués / possession par l'équipe à domicile
  aFor: number;
}

function ftOf(g: GameRecord, pg: ParsedGame): GameFt | undefined {
  const refs = officialsOf(g);
  if (!refs?.length) return undefined;
  const fta = (t: GameRecord['home']) => t.players.reduce((s, p) => s + (p.stats.freeThrowsAttempted ?? 0), 0);
  const ph = pg.teams.get(g.home.id)?.poss ?? 0;
  const pa = pg.teams.get(g.away.id)?.poss ?? 0;
  if (ph < 60 || pa < 60) return undefined;
  return { date: g.date, refs: refs.map((r) => r.id), rate: (fta(g.home) + fta(g.away)) / (ph + pa), home: g.home.id, away: g.away.id, hFor: fta(g.home) / ph, aFor: fta(g.away) / pa };
}

const memo = new Map<string, RefModel>();
export function refsAsOf(date: string): RefModel {
  const hit = memo.get(date);
  if (hit) return hit;
  const from = new Date(Date.parse(date) - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
  const names = new Map<number, string>();
  const games: GameFt[] = [];
  for (const { g, pg } of loadGames()) {
    if (g.date >= date || g.date < from) continue;
    const x = ftOf(g, pg);
    if (!x) continue;
    for (const o of officialsOf(g) ?? []) names.set(o.id, o.name);
    games.push(x);
  }
  // Habitudes des équipes : lancers provoqués et concédés par possession.
  const tm = new Map<number, { for: number; against: number; n: number }>();
  for (const x of games) {
    for (const [id, f, a] of [[x.home, x.hFor, x.aFor], [x.away, x.aFor, x.hFor]] as const) {
      const e = tm.get(id) ?? { for: 0, against: 0, n: 0 };
      e.for += f;
      e.against += a;
      e.n++;
      tm.set(id, e);
    }
  }
  const lg = games.reduce((s, x) => s + x.rate, 0) / Math.max(1, games.length);
  const avg = (id: number, k: 'for' | 'against') => {
    const e = tm.get(id);
    return e ? (e[k] + 10 * lg) / (e.n + 10) : lg;
  };
  const resid = games.map((x) => {
    const exp = (avg(x.home, 'for') + avg(x.away, 'against') + avg(x.away, 'for') + avg(x.home, 'against')) / 4;
    return Math.log(Math.max(0.05, x.rate) / exp);
  });
  // Ridge par descente de coordonnées (peu d'arbitres, convergence rapide).
  const eff = new Map<number, number>();
  const cnt = new Map<number, number>();
  for (const x of games) for (const r of x.refs) cnt.set(r, (cnt.get(r) ?? 0) + 1);
  for (let it = 0; it < 30; it++) {
    for (const r of cnt.keys()) {
      let s = 0;
      let n = 0;
      games.forEach((x, i) => {
        if (!x.refs.includes(r)) return;
        const others = x.refs.reduce((a, o) => (o === r ? a : a + (eff.get(o) ?? 0)), 0);
        s += resid[i] - others;
        n++;
      });
      eff.set(r, s / (n + LAMBDA));
    }
  }
  const out: RefModel = { effect: new Map() };
  for (const [r, e] of eff) out.effect.set(r, { log: e, games: cnt.get(r) ?? 0, name: names.get(r) ?? String(r) });
  memo.set(date, out);
  return out;
}

/** Multiplicateur (log) de lancers francs pour un trio d'arbitres. */
export function crewEffect(model: RefModel, crew: Official[]): { log: number; known: number } {
  let log = 0;
  let known = 0;
  for (const o of crew) {
    const e = model.effect.get(o.id);
    if (e) {
      log += e.log;
      known++;
    }
  }
  return { log, known };
}
