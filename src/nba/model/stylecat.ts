// Chat noir de style : une équipe qui, d'habitude, fait moins bien que prévu contre un TYPE d'adversaire (rythme, volume
// à 3 pts, tirs au cercle concédés, pertes provoquées, rebond offensif, qualité des tirs concédés, contre-attaques).
// Contrairement aux confrontations directes (trop peu de matchs, effectifs qui changent), le style se mesure sur toutes
// les rencontres face aux adversaires qui jouent ainsi. Pour chaque équipe : régression ridge de son écart réel - attendu
// sur le style adverse, apprise sur les deux dernières années avant la date ; contrôle hors échantillon : l'effet se
// répète (corrélation 0,04 à 0,05, pente 0,4 à 0,6 sur 1 000 à 1 700 matchs testés), petit mais présent.
import { loadGames } from './features.ts';
import { occLogs, occProfile, type OccGame } from './xpts.ts';

export const STYLE_KEYS = ['rythme', 'volume à 3 pts', 'tirs au cercle concédés', 'pertes provoquées', 'rebond offensif', 'qualité des tirs concédés', 'contre-attaques'] as const;
const LAMBDA = 300;
const HCA = 2.5;

let logs: Map<number, OccGame[]> | undefined;
const styleMemo = new Map<string, number[] | undefined>();

/** Style d'une équipe d'après ses 30 matchs précédant la date (valeurs brutes). */
function styleOf(id: number, date: string): number[] | undefined {
  const k = `${id}:${date}`;
  if (styleMemo.has(k)) return styleMemo.get(k);
  const l = (logs!.get(id) ?? []).filter((x) => x.date < date).slice(-30);
  let v: number[] | undefined;
  if (l.length >= 15) {
    const p = occProfile(l)!;
    const fga = l.reduce((s, x) => s + x.for.fga, 0) || 1;
    const fgaA = l.reduce((s, x) => s + x.against.fga, 0) || 1;
    v = [
      l.reduce((s, x) => s + x.for.poss, 0) / l.length,
      l.reduce((s, x) => s + x.for.zones[3] + x.for.zones[4] + x.for.zones[5], 0) / fga,
      l.reduce((s, x) => s + x.against.zones[0], 0) / fgaA,
      p.tovForced, p.orb, p.xFgAllowed, p.trans,
    ];
  }
  styleMemo.set(k, v);
  return v;
}

const adj = (g: OccGame) => g.margin - (g.home ? HCA : -HCA);
const formBefore = (id: number, date: string): number | undefined => {
  const l = (logs!.get(id) ?? []).filter((x) => x.date < date).slice(-30);
  return l.length >= 15 ? l.reduce((a, x) => a + adj(x), 0) / l.length : undefined;
};

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export interface StyleEffect {
  pts: number; // écart attendu en plus (négatif : l'équipe souffre contre ce style), points par match
  driver?: { key: string; pts: number; high: boolean }; // trait de style adverse qui pèse le plus (adversaire fort ou faible sur ce trait)
}

/** Effet de style pour une équipe face à un adversaire, à une date (matchs antérieurs uniquement). */
export function styleEffect(teamId: number, oppId: number, date: string): StyleEffect | undefined {
  logs ??= occLogs(loadGames());
  const from = new Date(Date.parse(date) - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
  const own = (logs.get(teamId) ?? []).filter((g) => g.date < date && g.date >= from);
  const rows: Array<{ z: number[]; r: number }> = [];
  for (const g of own) {
    const s = styleOf(g.opp, g.date);
    const a = formBefore(teamId, g.date);
    const b = formBefore(g.opp, g.date);
    if (!s || a == null || b == null) continue;
    rows.push({ z: s, r: g.margin - (a - b + (g.home ? HCA : -HCA)) });
  }
  const tonight = styleOf(oppId, date);
  if (rows.length < 40 || !tonight) return undefined;
  const K = tonight.length;
  const mu = Array.from({ length: K }, (_, k) => rows.reduce((a, x) => a + x.z[k], 0) / rows.length);
  const sd = Array.from({ length: K }, (_, k) => Math.sqrt(rows.reduce((a, x) => a + (x.z[k] - mu[k]) ** 2, 0) / rows.length) || 1);
  const zs = (v: number[]) => v.map((x, k) => (x - mu[k]) / sd[k]);
  const A = Array.from({ length: K }, () => new Array(K).fill(0));
  const b = new Array(K).fill(0);
  for (const x of rows) {
    const z = zs(x.z);
    for (let i = 0; i < K; i++) {
      b[i] += z[i] * x.r;
      for (let j = 0; j < K; j++) A[i][j] += z[i] * z[j];
    }
    void z;
  }
  for (let i = 0; i < K; i++) A[i][i] += LAMBDA;
  const beta = solve(A, b);
  const z = zs(tonight);
  const parts = beta.map((v, i) => v * z[i]);
  const pts = parts.reduce((a, v) => a + v, 0);
  const top = parts.map((v, i) => ({ i, v })).sort((a, c) => Math.abs(c.v) - Math.abs(a.v))[0];
  return { pts, driver: top ? { key: STYLE_KEYS[top.i], pts: top.v, high: z[top.i] > 0 } : undefined };
}
