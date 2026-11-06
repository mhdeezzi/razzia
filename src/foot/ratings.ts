// Forces des équipes (attaque, défense) et avantage du terrain par championnat, recalculés à une date donnée à partir des
// seuls matchs joués avant : modèle de Poisson multiplicatif (à la Dixon-Coles) ajusté sur un mélange buts/xG.
//   buts attendus du domicile  = exp(c + dom[champ] + att[dom] − def[ext])
//   buts attendus de l'extérieur = exp(c + att[ext] − def[dom])
// Les matchs comptent de moins en moins avec le temps (demi-vie), les coupes d'Europe relient les championnats entre
// eux (une équipe moyenne de Ligue 1 et une de Premier League n'ont pas la même force), et une équipe sans historique
// (promue, nouvelle en coupe d'Europe) part d'un a priori de petite équipe.
import type { Game } from './data.ts';

export interface RatingParams {
  halfLifeDays: number; // demi-vie d'un match
  goalsWeight: number; // part des buts réels dans la cible (le reste : xG)
  priorSd: number; // écart-type de l'a priori (log), plus petit = plus de prudence
  newcomer: number; // a priori (log) d'une équipe sans historique : attaque −x, défense −x
  cupWeight: number; // poids d'un match de coupe d'Europe (rotations, contexte)
  homeSd: number; // a priori de l'avantage du terrain par championnat
}
// Réglés sur 2022-2024 (src/dev/foottune.ts) : log-perte 1N2 0,9740 contre 0,979 avec les premières valeurs.
export const DEFAULT_RATING: RatingParams = { halfLifeDays: 150, goalsWeight: 0.35, priorSd: 1.2, newcomer: 0.5, cupWeight: 0.9, homeSd: 0.15 };

export interface Ratings {
  c: number;
  home: Map<number, number>; // championnat -> avantage (log)
  att: Map<number, number>;
  def: Map<number, number>;
  weight: Map<number, number>; // poids cumulé des matchs de l'équipe (confiance)
  league: Map<number, number>; // championnat principal de l'équipe (pour l'a priori)
  lgAtt: Map<number, number>; lgDef: Map<number, number>; // niveau moyen de chaque championnat
  at: string;
}

const CUPS = new Set([42, 73]);

/** Ajuste les forces sur les matchs joués avant `before` (exclu). */
export function fitRatings(games: Game[], before: string, p: RatingParams = DEFAULT_RATING, prev?: Ratings): Ratings {
  const t0 = Date.parse(before);
  const rows: Array<{ h: number; a: number; lg: number; yh: number; ya: number; w: number }> = [];
  const teamLeague = new Map<number, Map<number, number>>();
  for (const g of games) {
    const t = Date.parse(g.date);
    if (!(t < t0)) break;
    const age = (t0 - t) / 864e5;
    if (age > 5 * p.halfLifeDays) continue;
    let w = Math.pow(0.5, age / p.halfLifeDays) * (CUPS.has(g.lg) ? p.cupWeight : 1);
    const [gh, ga] = g.score;
    const yh = g.xg ? p.goalsWeight * gh + (1 - p.goalsWeight) * g.xg[0] : gh;
    const ya = g.xg ? p.goalsWeight * ga + (1 - p.goalsWeight) * g.xg[1] : ga;
    if (!g.xg) w *= 0.7; // sans xG, le score seul est plus bruité
    rows.push({ h: g.home.id, a: g.away.id, lg: g.lg, yh, ya, w });
    if (!CUPS.has(g.lg))
      for (const id of [g.home.id, g.away.id]) {
        const m = teamLeague.get(id) ?? new Map<number, number>();
        m.set(g.lg, (m.get(g.lg) ?? 0) + w);
        teamLeague.set(id, m);
      }
  }
  const att = new Map<number, number>(), def = new Map<number, number>(), weight = new Map<number, number>(), home = new Map<number, number>();
  const league = new Map<number, number>();
  for (const [id, m] of teamLeague) league.set(id, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  for (const r of rows) for (const id of [r.h, r.a]) { att.set(id, prev?.att.get(id) ?? 0); def.set(id, prev?.def.get(id) ?? 0); weight.set(id, (weight.get(id) ?? 0) + r.w); }
  for (const r of rows) if (!home.has(r.lg)) home.set(r.lg, prev?.home.get(r.lg) ?? 0.2);
  // A priori hiérarchique : chaque équipe est tirée vers la moyenne de SON championnat (mesurée à chaque tour, les coupes
  // d'Europe situant les championnats entre eux), une équipe peu connue vers « petite équipe » de son championnat.
  const lgAtt = new Map<number, number>(), lgDef = new Map<number, number>();
  const lgOf = (id: number) => league.get(id) ?? -1;
  const fresh = (id: number) => ((weight.get(id) ?? 0) < 4 ? -p.newcomer * (1 - (weight.get(id) ?? 0) / 4) : 0);
  const priorA = (id: number) => (lgAtt.get(lgOf(id)) ?? 0) + fresh(id);
  const priorD = (id: number) => (lgDef.get(lgOf(id)) ?? 0) + fresh(id);
  const updLeagues = () => {
    const sa = new Map<number, [number, number]>(), sd = new Map<number, [number, number]>();
    for (const [id, w] of weight) {
      const l = lgOf(id);
      if (l < 0) continue;
      const a = sa.get(l) ?? [0, 0], d = sd.get(l) ?? [0, 0];
      sa.set(l, [a[0] + w * att.get(id)!, a[1] + w]); sd.set(l, [d[0] + w * def.get(id)!, d[1] + w]);
    }
    for (const [l, [x, w]] of sa) lgAtt.set(l, x / w);
    for (const [l, [x, w]] of sd) lgDef.set(l, x / w);
  };
  let c = prev?.c ?? Math.log(1.35);
  const inv = 1 / (p.priorSd * p.priorSd);
  for (let it = 0; it < 25; it++) {
    if (it % 3 === 0) updLeagues();
    // Constante : moyenne des buts.
    { let num = 0, den = 0; for (const r of rows) { num += r.w * (r.yh + r.ya); den += r.w * (Math.exp(home.get(r.lg)! + att.get(r.h)! - def.get(r.a)!) + Math.exp(att.get(r.a)! - def.get(r.h)!)); } c = Math.log(num / den); }
    // Avantage du terrain par championnat (pas en coupe : souvent sur deux matchs, il compte quand même ; même traitement).
    const gH = new Map<number, number>(), hH = new Map<number, number>();
    for (const r of rows) { const lh = Math.exp(c + home.get(r.lg)! + att.get(r.h)! - def.get(r.a)!); gH.set(r.lg, (gH.get(r.lg) ?? 0) + r.w * (r.yh - lh)); hH.set(r.lg, (hH.get(r.lg) ?? 0) + r.w * lh); }
    for (const [lg, g] of gH) { const hv = home.get(lg)!; const step = (g - (hv - 0.2) / (p.homeSd * p.homeSd)) / (hH.get(lg)! + 1 / (p.homeSd * p.homeSd)); home.set(lg, hv + step); }
    // Attaques puis défenses (Newton par équipe, a priori gaussien).
    const gA = new Map<number, number>(), hA = new Map<number, number>();
    for (const r of rows) {
      const lh = Math.exp(c + home.get(r.lg)! + att.get(r.h)! - def.get(r.a)!), la = Math.exp(c + att.get(r.a)! - def.get(r.h)!);
      gA.set(r.h, (gA.get(r.h) ?? 0) + r.w * (r.yh - lh)); hA.set(r.h, (hA.get(r.h) ?? 0) + r.w * lh);
      gA.set(r.a, (gA.get(r.a) ?? 0) + r.w * (r.ya - la)); hA.set(r.a, (hA.get(r.a) ?? 0) + r.w * la);
    }
    for (const [id, g] of gA) { const v = att.get(id)!; att.set(id, v + (g - (v - priorA(id)) * inv) / (hA.get(id)! + inv)); }
    const gD = new Map<number, number>(), hD = new Map<number, number>();
    for (const r of rows) {
      const lh = Math.exp(c + home.get(r.lg)! + att.get(r.h)! - def.get(r.a)!), la = Math.exp(c + att.get(r.a)! - def.get(r.h)!);
      gD.set(r.a, (gD.get(r.a) ?? 0) - r.w * (r.yh - lh)); hD.set(r.a, (hD.get(r.a) ?? 0) + r.w * lh);
      gD.set(r.h, (gD.get(r.h) ?? 0) - r.w * (r.ya - la)); hD.set(r.h, (hD.get(r.h) ?? 0) + r.w * la);
    }
    for (const [id, g] of gD) { const v = def.get(id)!; def.set(id, v + (g - (v - priorD(id)) * inv) / (hD.get(id)! + inv)); }
  }
  updLeagues();
  return { c, home, att, def, weight, league, lgAtt, lgDef, at: before };
}

/** Buts attendus (avant ajustements de contexte) d'un match. `neutral` : finale sur terrain neutre. */
export function expectedGoals(R: Ratings, lg: number, h: number, a: number, newcomer: number, neutral = false): [number, number] {
  // Équipe inconnue : petite équipe du championnat du match (ou moyenne générale en coupe).
  const att = (id: number) => R.att.get(id) ?? (R.lgAtt.get(lg) ?? 0) - newcomer, def = (id: number) => R.def.get(id) ?? (R.lgDef.get(lg) ?? 0) - newcomer;
  const hv = neutral ? 0 : R.home.get(lg) ?? 0.2;
  return [Math.exp(R.c + hv + att(h) - def(a)), Math.exp(R.c + att(a) - def(h))];
}
