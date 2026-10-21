// Calibration des props : empilement logistique (sims + marché) ajusté sur l'historique, par famille de marché.
//   logit P(Over) = a + b·logit(p_sims) + c·logit(p_marché)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from '../../data/http.ts';

export interface PropCalGroup {
  a: number;
  b: number;
  c: number;
  n: number;
}
export interface PropCal {
  fittedAt: string;
  rows: number;
  games: number;
  groups: Record<string, PropCalGroup>;
}

export const PROPCAL_FILE = join(ROOT, 'data', 'calibration', 'props.json');

export function marketGroup(market: string): string {
  if (market === 'Total Points') return 'points';
  if (market === 'Total Rebounds') return 'rebounds';
  if (market === 'Total Assists') return 'assists';
  if (market === 'Total 3-Point Field Goals') return 'threes';
  if (/Steals|Blocks|Turnovers/.test(market)) return 'defense';
  return 'combos';
}

const clampP = (p: number) => Math.min(0.985, Math.max(0.015, p));
export const lg = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sig = (x: number) => 1 / (1 + Math.exp(-x));

/** Régression logistique (Newton-Raphson, légère pénalité L2 hors constante). */
export function fitLogit(X: number[][], y: number[], l2 = 1): number[] {
  const k = X[0].length;
  let w = new Array(k).fill(0);
  w[k - 1] = 1; // départ : le marché seul
  for (let it = 0; it < 50; it++) {
    const g = new Array(k).fill(0);
    const Hm = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((a, v, j) => a + v * w[j], 0);
      const p = sig(z);
      const r = p - y[i];
      const s = p * (1 - p);
      for (let j = 0; j < k; j++) {
        g[j] += r * X[i][j];
        for (let l = 0; l < k; l++) Hm[j][l] += s * X[i][j] * X[i][l];
      }
    }
    for (let j = 1; j < k; j++) {
      g[j] += l2 * (w[j] - (j === k - 1 ? 1 : 0));
      Hm[j][j] += l2;
    }
    // Résolution H·d = g (Gauss).
    const A = Hm.map((row, i) => [...row, g[i]]);
    for (let c = 0; c < k; c++) {
      let p = c;
      for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < k; r++) {
        if (r === c || !A[c][c]) continue;
        const f = A[r][c] / A[c][c];
        for (let l = c; l <= k; l++) A[r][l] -= f * A[c][l];
      }
    }
    const d = A.map((row, i) => (row[i] ? row[k] / row[i] : 0));
    w = w.map((v, j) => v - d[j]);
    if (Math.max(...d.map(Math.abs)) < 1e-7) break;
  }
  return w;
}

let cached: PropCal | null | undefined;
export function loadPropCal(): PropCal | null {
  if (cached !== undefined) return cached;
  cached = existsSync(PROPCAL_FILE) ? (JSON.parse(readFileSync(PROPCAL_FILE, 'utf8')) as PropCal) : null;
  return cached;
}

export function savePropCal(cal: PropCal): void {
  mkdirSync(dirname(PROPCAL_FILE), { recursive: true });
  writeFileSync(PROPCAL_FILE, JSON.stringify(cal, null, 1));
  cached = cal;
}

/**
 * Probabilité calibrée d'Over. `modelTrust` (0..1) réduit le poids des sims quand le contexte est incertain
 * (début de saison, transfert, rookie) : le coefficient des sims est multiplié d'autant, celui du marché complété.
 */
export function calibratedOver(cal: PropCal, market: string, pModel: number, pMkt: number, modelTrust = 1): number {
  const g = cal.groups[marketGroup(market)] ?? cal.groups.all;
  if (!g) return pMkt;
  const b = g.b * modelTrust;
  const c = g.c + g.b * (1 - modelTrust);
  return sig(g.a + b * lg(pModel) + c * lg(pMkt));
}
