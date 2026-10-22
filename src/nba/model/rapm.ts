// Notes d'impact par joueur (RAPM) : pour chaque possession, les points marqués sont expliqués par les cinq attaquants
// et les cinq défenseurs sur le terrain. Une régression ridge (rétrécie vers 0, ou vers un a priori) isole l'apport de
// chacun, coéquipiers et adversaires pris en compte. Résultat en points pour 100 possessions, attaque et défense
// (défense positive = fait baisser l'attaque adverse). Seuls les matchs antérieurs à la date comptent.
import type { GameRecord } from '../../data/cdn.ts';
import type { ParsedGame } from './pbp.ts';
import { loadGames } from './features.ts';

export interface Rapm {
  o: number; // points / 100 possessions apportés en attaque
  d: number; // points / 100 possessions retirés à l'adversaire en défense
  poss: number; // possessions jouées (pondérées) : fiabilité
}

const HALF_LIFE_DAYS = 365; // une saison de décroissance : la saison passée compte moitié moins que la récente
const LAMBDA = 1500; // rétrécissement (en possessions pondérées)
const HOME_KEY = -1;

interface Row {
  off: number[];
  def: number[];
  home: number; // +1 attaque à domicile, -1 à l'extérieur
  w: number; // poids (possessions pondérées)
  y: number; // points par possession au-dessus de la moyenne (somme pondérée / w)
}

/** Lignes compactées : une par combinaison (cinq en attaque, cinq en défense, terrain). */
function rowsOf(games: Array<{ g: GameRecord; pg: ParsedGame }>, asOf: string): { rows: Row[]; mean: number } {
  const t0 = Date.parse(asOf);
  const acc = new Map<string, Row & { sy: number }>();
  let sw = 0;
  let swy = 0;
  for (const { g, pg } of games) {
    if (!pg.lineupOk) continue;
    const w = Math.pow(0.5, (t0 - Date.parse(g.date)) / 86_400_000 / HALF_LIFE_DAYS);
    for (const p of pg.poss) {
      if (p.off?.length !== 5 || p.def?.length !== 5) continue;
      const off = [...p.off].sort((a, b) => a - b);
      const def = [...p.def].sort((a, b) => a - b);
      const home = p.home ? 1 : -1;
      const key = `${off.join(',')}|${def.join(',')}|${home}`;
      let r = acc.get(key);
      if (!r) acc.set(key, (r = { off, def, home, w: 0, y: 0, sy: 0 }));
      r.w += w;
      r.sy += w * p.pts;
      sw += w;
      swy += w * p.pts;
    }
  }
  const mean = sw ? swy / sw : 1.12;
  const rows = [...acc.values()].map((r) => ({ off: r.off, def: r.def, home: r.home, w: r.w, y: r.sy / r.w - mean }));
  return { rows, mean };
}

/**
 * Résout (X'WX + λI) β = X'Wy par gradient conjugué. Inconnues : attaque et défense de chaque joueur, terrain.
 * Avec un a priori β0 : on résout pour β - β0 (ridge vers l'a priori).
 */
function solve(rows: Row[], prior?: Map<number, Rapm>): Map<number, Rapm> {
  const idx = new Map<number, number>();
  for (const r of rows) for (const id of [...r.off, ...r.def]) if (!idx.has(id)) idx.set(id, idx.size);
  const P = idx.size;
  const n = 2 * P + 1; // [0, P) attaque, [P, 2P) défense (signe : la défense retire des points), 2P terrain
  const H = 2 * P;
  const enc = rows.map((r) => ({ o: r.off.map((id) => idx.get(id)!), d: r.def.map((id) => P + idx.get(id)!), h: r.home, w: r.w, y: r.y }));
  // a priori : on retranche sa prédiction de y
  const b0 = new Float64Array(n);
  if (prior) {
    for (const [id, k] of idx) {
      const pr = prior.get(id);
      if (pr) {
        b0[k] = pr.o / 100;
        b0[P + k] = -pr.d / 100;
      }
    }
  }
  const pred = (x: Float64Array, e: (typeof enc)[number]) => {
    let s = x[H] * e.h;
    for (const k of e.o) s += x[k];
    for (const k of e.d) s += x[k];
    return s;
  };
  const resid = enc.map((e) => e.y - pred(b0, e));
  const Av = (x: Float64Array): Float64Array => {
    const out = new Float64Array(n);
    for (const e of enc) {
      const s = pred(x, e) * e.w;
      out[H] += s * e.h;
      for (const k of e.o) out[k] += s;
      for (const k of e.d) out[k] += s;
    }
    for (let k = 0; k < H; k++) out[k] += LAMBDA * x[k];
    out[H] += 1e-6 * x[H];
    return out;
  };
  const b = new Float64Array(n);
  enc.forEach((e, i) => {
    const s = resid[i] * e.w;
    b[H] += s * e.h;
    for (const k of e.o) b[k] += s;
    for (const k of e.d) b[k] += s;
  });
  const x = new Float64Array(n);
  const r = Float64Array.from(b);
  const p = Float64Array.from(r);
  let rr = r.reduce((a, v) => a + v * v, 0);
  const rr0 = rr;
  for (let it = 0; it < 300 && rr > 1e-10 * rr0; it++) {
    const Ap = Av(p);
    const pAp = p.reduce((a, v, i) => a + v * Ap[i], 0);
    const alpha = rr / pAp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }
    const rrNew = r.reduce((a, v) => a + v * v, 0);
    const beta = rrNew / rr;
    rr = rrNew;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
  }
  const poss = new Float64Array(P);
  for (const e of enc) for (const k of e.o) poss[k] += e.w;
  const out = new Map<number, Rapm>();
  for (const [id, k] of idx) out.set(id, { o: 100 * (x[k] + b0[k]), d: -100 * (x[P + k] + b0[P + k]), poss: poss[k] });
  out.set(HOME_KEY, { o: 100 * x[H], d: 0, poss: 0 });
  return out;
}

// Une estimation par semaine (lundi) : les matchs antérieurs au lundi seulement, donc jamais de données du jour.
const memo = new Map<string, Map<number, Rapm>>();
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

export function rapmAsOf(date: string, prior?: Map<number, Rapm>): Map<number, Rapm> {
  const key = weekStart(date);
  const hit = memo.get(key);
  if (hit && !prior) return hit;
  const from = new Date(Date.parse(key) - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
  const games = loadGames().filter((x) => x.g.date < key && x.g.date >= from);
  const { rows } = rowsOf(games, key);
  const out = solve(rows, prior);
  if (!prior) memo.set(key, out);
  return out;
}
