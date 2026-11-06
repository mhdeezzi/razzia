// Ajustements de contexte appris sur les saisons passées (régression de Poisson sur l'écart aux buts attendus) :
// composition alignée (valeur du onze par rapport à l'habitude), forme récente, nouveau coach, repos, coupe d'Europe
// juste avant, face-à-face (chat noir). Un réglage n'est gardé que s'il améliore la prévision sur des matchs qu'il n'a
// pas vus (voir footbacktest.ts).
import type { Feat, WalkRow } from './walk.ts';

export const FEATS = ['lr', 'la', 'gk', 'mom', 'coach', 'rest', 'euro', 'h2h', 'sp', 'press'] as const;
export type Coefs = Record<(typeof FEATS)[number], number>;
export const ZERO: Coefs = { lr: 0, la: 0, gk: 0, mom: 0, coach: 0, rest: 0, euro: 0, h2h: 0, sp: 0, press: 0 };

const teamX = (f: Feat) => ({ lr: f.lr, la: f.la, gk: f.gk, mom: f.momN >= 3 ? f.mom : 0, coach: f.coach, rest: Math.log(f.rest / 7), euro: f.euro });
/** Écart de force (log) en faveur du domicile : + pour le domicile marque plus et encaisse moins. */
export function delta(r: WalkRow, b: Coefs, on: Partial<Record<keyof Coefs, boolean>> = {}): number {
  const h = teamX(r.fh), a = teamX(r.fa);
  let d = 0;
  for (const k of ['lr', 'la', 'gk', 'mom', 'coach', 'rest', 'euro'] as const) if (on[k] !== false) d += b[k] * ((h as any)[k] - (a as any)[k]);
  if (on.h2h !== false && r.h2hN >= 2) d += b.h2h * r.h2h;
  return d / 2;
}
/** Termes propres à chaque camp (rencontre de styles) : [domicile, extérieur], en log. Coups de pied arrêtés : menace de
 * l'un × fragilité de l'autre ; pressing : pressing de l'un × relance courte de l'autre (une équipe qui relance court
 * face à un gros pressing perd des ballons près de son but). */
export function sideX(r: WalkRow): { sp: [number, number]; press: [number, number] } {
  const [h, a] = r.st, m = Math.max(0.05, r.spAvg);
  const sp = (x: typeof h, y: typeof h) => (x.n >= 5 && y.n >= 5 ? Math.max(-1, Math.min(1, (x.spFor * y.spAg) / (m * m) - 1)) * 0.5 : 0);
  const pr = (x: typeof h, y: typeof h) => (x.n >= 5 && y.n >= 5 ? Math.max(-1, Math.min(1, (x.press / r.pressAvg) * (y.buildUp / r.buAvg) - 1)) : 0);
  return { sp: [sp(h, a), sp(a, h)], press: [pr(h, a), pr(a, h)] };
}
export const adjusted = (r: WalkRow, b: Coefs, on?: Partial<Record<keyof Coefs, boolean>>): [number, number] => {
  const d = delta(r, b, on), s = sideX(r);
  const xh = (on?.sp !== false ? b.sp * s.sp[0] : 0) + (on?.press !== false ? b.press * s.press[0] : 0);
  const xa = (on?.sp !== false ? b.sp * s.sp[1] : 0) + (on?.press !== false ? b.press * s.press[1] : 0);
  return [r.base[0] * Math.exp(d + xh), r.base[1] * Math.exp(-d + xa)];
};

/** Coefficients par maximum de vraisemblance (Poisson) sur la cible buts/xG mélangée, petit a priori vers 0. */
export function fitCoefs(rows: WalkRow[], goalsWeight: number, keys: Array<keyof Coefs> = [...FEATS]): Coefs {
  const b: Coefs = { ...ZERO };
  const y = (r: WalkRow, s: 0 | 1) => (r.g.xg ? goalsWeight * r.g.score[s] + (1 - goalsWeight) * r.g.xg[s] : r.g.score[s]);
  const xs = rows.map((r) => {
    const h = teamX(r.fh), a = teamX(r.fa);
    const x: Record<string, number> = {};
    for (const k of ['lr', 'la', 'gk', 'mom', 'coach', 'rest', 'euro'] as const) x[k] = ((h as any)[k] - (a as any)[k]) / 2;
    x.h2h = r.h2hN >= 2 ? r.h2h / 2 : 0;
    const sx = sideX(r);
    x.sp_h = sx.sp[0]; x.sp_a = sx.sp[1]; x.press_h = sx.press[0]; x.press_a = sx.press[1];
    return x;
  });
  const side = new Set(['sp', 'press']);
  for (let it = 0; it < 40; it++) {
    for (const k of keys) {
      let g = 0, H = 0;
      rows.forEach((r, i) => {
        let d = 0, eh = 0, ea = 0;
        for (const kk of keys) if (!side.has(kk)) d += b[kk] * xs[i][kk]; else { eh += b[kk] * xs[i][`${kk}_h`]; ea += b[kk] * xs[i][`${kk}_a`]; }
        const lh = r.base[0] * Math.exp(d + eh), la = r.base[1] * Math.exp(-d + ea);
        if (side.has(k)) { const xh = xs[i][`${k}_h`], xa = xs[i][`${k}_a`]; g += xh * (y(r, 0) - lh) + xa * (y(r, 1) - la); H += xh * xh * lh + xa * xa * la; }
        else { const x = xs[i][k]; g += x * (y(r, 0) - lh) - x * (y(r, 1) - la); H += x * x * (lh + la); }
      });
      b[k] += (g - b[k] * 20) / (H + 20);
    }
  }
  return b;
}
