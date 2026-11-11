// Simulation en direct, version de démonstration : six matchs fictifs (foot, tennis, basket) joués en boucle par une
// horloge commune. Chaque match suit un scénario écrit (buts, breaks, séries) et ses probabilités sont recalculées à
// chaque instant à partir du score et du temps restant (loi de Poisson au foot, écart au basket, chaîne de points au
// tennis) : les chiffres affichés restent cohérents avec le score. Le vrai moteur live remplacera ce fichier ; les
// pages (live.tsx) ne lisent que ce qui est exporté ici.
import { n1, pct0, teamColor, teamLogo } from './data.ts';

export type Sport = 'foot' | 'tennis' | 'nba';
/** Probabilités : domicile, nul, extérieur (nul à 0 hors foot). */
export type P3 = [number, number, number];
export interface Side { name: string; short: string; tri: string; color: string; logo?: string; mark?: string; photo?: string }
export type EvKind = 'kick' | 'goal' | 'red' | 'yellow' | 'chance' | 'sub' | 'pause' | 'break' | 'set' | 'run' | 'three' | 'timeout' | 'signal' | 'end';
export type Gauge = 'energy' | 'fouls' | 'rhythm' | 'luck' | 'comeback';
export interface Ev {
  t: number;
  kind: EvKind;
  side?: 0 | 1;
  title: string;
  text?: string;
  /** Action qui relance les 25 000 simulations à l'écran (et fait passer le mot en grand sur le bandeau). */
  big?: boolean;
  word?: string;
  gauge?: Gauge;
  tone?: 'up' | 'down';
  /** Durée couverte par l'action (une série au basket), pour mesurer son effet. */
  span?: number;
  /** Effet sur l'avantage du camp à domicile (de -1 à 1), calculé. */
  impact?: number;
  at?: string;
  score?: string;
}
export interface Pt { t: number; adv: number }
export interface Row { k: string; pre: string; now: string; d: number }
export type PickState = 'won' | 'lost' | 'safe' | 'ok' | 'warn' | 'bad';
export interface Frame {
  t: number;
  progress: number;
  ended: boolean;
  clock: string;
  phase: string;
  score: [number, number];
  p: P3;
  /** Avantage du camp à domicile : sa victoire plus la moitié du nul (1 = gagné, 0 = perdu). */
  adv: number;
  nEv: number;
  last?: Ev;
  tennis?: { sets: Array<[number, number]>; pts: [string, string]; server: 0 | 1 };
  quarters?: Array<[number, number]>;
  pick: { p: number; state: PickState };
  rows: Row[];
  gauges: { energy: [number, number]; fouls: [number, number]; rhythm: [number, number]; luck: [number, number]; comeback?: { side: 0 | 1; p: number } };
}
export interface Demo {
  id: string;
  sport: Sport;
  league: string;
  where: string;
  home: Side;
  away: Side;
  len: number;
  pace: number;
  phase0: number;
  events: Ev[];
  marks: Array<{ t: number; label: string }>;
  axis: string[];
  series: Pt[];
  ghost: Pt[];
  ghostScore: string;
  mom: number[];
  pre: { p: P3; pick: number };
  pick: { label: string; odds: number };
  at(t: number): Frame;
}

// ——— Outils ———
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const pad = (n: number) => String(n).padStart(2, '0');
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Valeur à l'avancement x (0 à 1) d'une suite de points clés [x, domicile, extérieur]. */
function key(keys: number[][], x: number, i: number): number {
  if (x <= keys[0][0]) return keys[0][i];
  for (let j = 1; j < keys.length; j++) if (x <= keys[j][0]) return lerp(keys[j - 1][i], keys[j][i], (x - keys[j - 1][0]) / (keys[j][0] - keys[j - 1][0] || 1));
  return keys[keys.length - 1][i];
}

/** Courbe lissée (moyenne glissante) : le scénario d'avant-match se lit comme une tendance, pas point par point. */
function smooth(pts: Pt[], w: number): Pt[] {
  return pts.map((p, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(pts.length - 1, i + w); j++) { s += pts[j].adv; n++; }
    return { t: p.t, adv: s / n };
  });
}

/** « 1 simulation sur 7 », « 4 simulations sur 10 » : une chance dite avec des mots simples. */
const outOf = (p: number) => (p > 0.45 ? `${Math.round(p * 10)} simulations sur 10` : `1 simulation sur ${Math.max(3, Math.round(1 / Math.max(p, 0.005)))}`);
/** « de Sinner », « d'Alcaraz ». */
const de = (n: string) => (/^[AEIOUYÉÈ]/i.test(n) ? `d'${n}` : `de ${n}`);

interface Core {
  clock: string;
  phase: string;
  score: [number, number];
  p: P3;
  pick: number;
  vals: string[];
  nums: number[];
  /** Camp mené au score, s'il y en a un. */
  trail?: 0 | 1;
  /** Chance du camp mené de ne pas perdre (foot) ou de gagner. */
  back?: number;
  at: string;
  tennis?: Frame['tennis'];
  quarters?: Frame['quarters'];
}
interface Gauges { energy: number[][]; fouls: number[][]; rhythm: number[][]; luck: number[][]; dom: number[][] }
interface Base { id: string; league: string; where: string; home: Side; away: Side; phase0: number; pick: { label: string; odds: number }; g: Gauges }

function build(sport: Sport, b: Base, len: number, pace: number, core: (t: number) => Core, keys: string[], script: Ev[], marks: Demo['marks'], axis: string[], ghost: Pt[], ghostScore: string, eps: number, grid: number[]): Demo {
  const adv = (t: number) => {
    const p = core(t).p;
    return p[0] + p[1] / 2;
  };
  const events = [...script].sort((x, y) => x.t - y.t).map((e) => {
    const c = core(e.kind === 'pause' ? e.t - 1e-4 : e.t);
    const moves = e.big || e.kind === 'goal';
    return { ...e, text: e.text?.replace('{back}', outOf(c.back ?? 0)), impact: moves ? adv(e.t) - adv(Math.max(0, e.t - (e.span ?? eps))) : 0, at: c.at, score: c.score.join('-') };
  });
  // Courbe du match : un point par pas, plus un point juste avant chaque action (les sauts restent nets).
  const ts = [...new Set([...grid, ...events.flatMap((e) => [Math.max(0, e.t - eps), e.t]), len])].sort((x, y) => x - y);
  const series = ts.map((t) => ({ t, adv: adv(t) }));
  const pre = core(0);
  const seed = [...b.id].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const noise = rng(seed);
  const mom = Array.from({ length: 96 }, (_, i) => clamp(key(b.g.dom, (i + 0.5) / 96, 1) + (noise() - 0.5) * 0.75, -1, 1));
  return {
    id: b.id, sport, league: b.league, where: b.where, home: b.home, away: b.away, len, pace, phase0: b.phase0, events, marks, axis, series, ghost, ghostScore, mom,
    pre: { p: pre.p, pick: pre.pick }, pick: b.pick,
    at(t) {
      const tt = clamp(t, 0, len);
      const c = core(tt);
      const ended = tt >= len;
      const x = tt / len;
      const nEv = events.filter((e) => e.t <= tt).length;
      const pp = c.pick;
      const state: PickState = pp >= 0.999 ? 'won' : pp <= 0.001 ? 'lost' : pp >= 0.85 ? 'safe' : pp >= Math.min(0.5, pre.pick - 0.12) ? 'ok' : pp >= 0.3 ? 'warn' : 'bad';
      const pair = (k: number[][]): [number, number] => [key(k, x, 1), key(k, x, 2)];
      return {
        t: tt, progress: x, ended, clock: c.clock, phase: c.phase, score: c.score, p: c.p, adv: c.p[0] + c.p[1] / 2, nEv, last: events[nEv - 1],
        tennis: c.tennis, quarters: c.quarters, pick: { p: pp, state },
        rows: keys.map((k, i) => ({ k, pre: pre.vals[i], now: c.vals[i], d: c.nums[i] - pre.nums[i] })),
        gauges: { energy: pair(b.g.energy), fouls: pair(b.g.fouls), rhythm: pair(b.g.rhythm), luck: pair(b.g.luck), comeback: c.trail != null && !ended ? { side: c.trail, p: c.back ?? 0 } : undefined },
      };
    },
  };
}

// ——— Football : buts restants selon une loi de Poisson, carton rouge compris ———
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880];
const pois = (k: number, l: number) => (Math.exp(-l) * l ** k) / FACT[k];
const FLEN = 97; // 45 + 2, deux unités de pause, 45 + 3
/** Minute affichée → instant du match. */
const fMin = (m: number) => (m <= 45 ? m - 0.5 : m + 3.5);
const fRem = (t: number) => ((t < 47 ? 47 - t : 0) + (t < 49 ? 48 : Math.max(0, FLEN - t))) / 95;
function fClock(t: number): [string, string] {
  if (t >= FLEN) return ['Terminé', 'Fin du match'];
  if (t <= 45) return [`${Math.max(1, Math.ceil(t))}'`, '1re mi-temps'];
  if (t <= 47) return [`45+${Math.ceil(t - 45)}'`, '1re mi-temps'];
  if (t < 49) return ['Mi-temps', 'Pause'];
  if (t <= 94) return [`${Math.ceil(t - 4)}'`, '2e mi-temps'];
  return [`90+${Math.ceil(t - 94)}'`, '2e mi-temps'];
}
type FootEv = [number, EvKind, 0 | 1 | undefined, string, string?, Partial<Ev>?];
interface FootDef extends Base { lam: [number, number]; typical: Array<[number, 0 | 1]>; test: (h: number, a: number) => boolean; script: FootEv[] }

function footCore(lam: [number, number], goals: Array<{ t: number; side?: 0 | 1 }>, reds: Array<{ t: number; side?: 0 | 1 }>, test: (h: number, a: number) => boolean) {
  return (t: number): Core => {
    let gh = 0, ga = 0, rh = 0, ra = 0;
    for (const g of goals) if (g.t <= t) g.side === 0 ? gh++ : ga++;
    for (const r of reds) if (r.t <= t) r.side === 0 ? rh++ : ra++;
    const r = fRem(t);
    const lh = lam[0] * r * 0.7 ** rh * 1.22 ** ra, la = lam[1] * r * 0.7 ** ra * 1.22 ** rh;
    let h = 0, d = 0, a = 0, pick = 0, best = '', bq = 0;
    for (let i = 0; i < 10; i++)
      for (let j = 0; j < 10; j++) {
        const q = pois(i, lh) * pois(j, la), x = gh + i, y = ga + j;
        if (x > y) h += q; else if (x === y) d += q; else a += q;
        if (test(x, y)) pick += q;
        if (q > bq) { bq = q; best = `${x}-${y}`; }
      }
    const s = h + d + a;
    const p: P3 = [h / s, d / s, a / s];
    const total = gh + ga + lh + la;
    const [clock, phase] = fClock(t);
    const trail = gh === ga ? undefined : gh < ga ? 0 : 1;
    return {
      clock, phase, score: [gh, ga], p, pick: pick / s, at: clock, trail, back: trail === 0 ? p[0] + p[1] : trail === 1 ? p[2] + p[1] : undefined,
      vals: [pct0(p[0]), pct0(p[1]), pct0(p[2]), best, n1(total)], nums: [p[0], p[1], p[2], 0, total],
    };
  };
}
function foot(d: FootDef): Demo {
  const base: Ev[] = [
    { t: 0, kind: 'kick', title: "Coup d'envoi" },
    ...d.script.map(([m, kind, side, title, text, more]): Ev => ({ t: fMin(m), kind, side, title, text, ...more })),
    { t: 47, kind: 'pause', title: 'Mi-temps' },
    { t: FLEN, kind: 'end', title: 'Fin du match' },
  ];
  const script = base.map((e): Ev => (e.kind === 'goal' ? { ...e, big: true, word: 'But' } : e.kind === 'red' ? { ...e, big: true, word: 'Rouge' } : e));
  const of = (k: EvKind) => script.filter((e) => e.kind === k);
  const core = footCore(d.lam, of('goal'), of('red'), d.test);
  const typ = d.typical.map(([m, side]) => ({ t: fMin(m), side }));
  const gcore = footCore(d.lam, typ, [], d.test);
  const grid = Array.from({ length: 195 }, (_, i) => i / 2);
  const gts = [...new Set([...grid, ...typ.flatMap((g) => [g.t - 0.02, g.t])])].sort((x, y) => x - y);
  const ghost = gts.map((t) => {
    const p = gcore(t).p;
    return { t, adv: p[0] + p[1] / 2 };
  });
  return build('foot', d, FLEN, 0.42, core, [`Victoire ${d.home.short}`, 'Match nul', `Victoire ${d.away.short}`, 'Score final le plus probable', 'Buts attendus au total'], script,
    [{ t: 48, label: 'Mi-temps' }], ['1re mi-temps', '2e mi-temps'], ghost, gcore(FLEN).score.join('-'), 0.02, grid);
}

// ——— Basket : écart au score et temps restant ———
const erf = (x: number) => {
  const a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return Math.sign(x) * y;
};
const phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
/** Paniers tirés au hasard (graine fixe) pour que chaque tronçon [début, fin, points domicile, points extérieur] tombe juste. */
function baskets(segs: number[][], fixed: number[][], seed: number) {
  const rnd = rng(seed);
  const out: Array<{ t: number; side: 0 | 1; v: number }> = [];
  for (const [t0, t1, ph, pa] of segs)
    [ph, pa].forEach((total, side) => {
      const mine = fixed.filter((f) => f[1] === side && f[0] >= t0 && f[0] < t1);
      let left = total - mine.reduce((s, f) => s + f[2], 0);
      const vals: number[] = [];
      while (left > 0) {
        const u = rnd();
        const v = Math.min(left, left <= 2 ? left : u < 0.5 ? 2 : u < 0.82 ? 3 : 1);
        vals.push(v);
        left -= v;
      }
      vals.forEach((v, i) => out.push({ t: t0 + ((i + 0.15 + 0.7 * rnd()) / vals.length) * (t1 - t0), side: side as 0 | 1, v }));
      mine.forEach((f) => out.push({ t: f[0], side: side as 0 | 1, v: f[2] }));
    });
  return out.sort((x, y) => x.t - y.t);
}
const QUARTS = ['1er quart-temps', '2e quart-temps', '3e quart-temps', '4e quart-temps'];
interface NbaDef extends Base { spread: number; total: number; segs: number[][]; fixed: number[][]; typical: number[][]; pickP: (mean: number, sd: number) => number; script: Ev[] }

function nbaCore(d: NbaDef, list: ReturnType<typeof baskets>) {
  return (t: number): Core => {
    let h = 0, a = 0;
    const q: Array<[number, number]> = [[0, 0], [0, 0], [0, 0], [0, 0]];
    for (const b of list) {
      if (b.t > t) break;
      q[Math.min(3, Math.floor(b.t / 12))][b.side] += b.v;
      if (b.side === 0) h += b.v; else a += b.v;
    }
    const r = Math.max(0, (48 - t) / 48);
    const mean = h - a + d.spread * r, sd = 12.5 * Math.sqrt(r) + 0.35;
    const ph = phi(mean / sd);
    const qi = Math.min(3, Math.floor(t / 12));
    const left = 12 - (t - qi * 12);
    const clock = t >= 48 ? 'Terminé' : `Q${qi + 1} ${Math.floor(left)}:${pad(Math.floor((left % 1) * 60))}`;
    const fh = h + (d.total / 2 + d.spread / 2) * r, fa = a + (d.total / 2 - d.spread / 2) * r;
    const trail = h === a ? undefined : h < a ? 0 : 1;
    return {
      clock, phase: t >= 48 ? 'Fin du match' : QUARTS[qi], score: [h, a], p: [ph, 0, 1 - ph], pick: d.pickP(mean, sd), at: clock, trail, back: trail === 0 ? ph : trail === 1 ? 1 - ph : undefined,
      quarters: q.slice(0, t >= 48 ? 4 : qi + 1),
      vals: [pct0(ph), pct0(1 - ph), `${Math.round(fh)}-${Math.round(fa)}`, String(Math.round(fh + fa))], nums: [ph, 1 - ph, 0, fh + fa],
    };
  };
}
function nba(d: NbaDef, seed: number): Demo {
  const core = nbaCore(d, baskets(d.segs, d.fixed, seed));
  const gcore = nbaCore(d, baskets(d.typical, [], seed + 7));
  const grid = Array.from({ length: 241 }, (_, i) => i / 5);
  const script: Ev[] = [
    { t: 0, kind: 'kick', title: 'Entre-deux' },
    { t: 12, kind: 'pause', title: 'Fin du 1er quart-temps' },
    { t: 24, kind: 'pause', title: 'Mi-temps' },
    { t: 36, kind: 'pause', title: 'Fin du 3e quart-temps' },
    ...d.script,
    { t: 48, kind: 'end', title: 'Fin du match' },
  ];
  return build('nba', d, 48, 0.2, core, [`Victoire ${d.home.short}`, `Victoire ${d.away.short}`, 'Score final projeté', 'Total de points projeté'], script,
    [{ t: 12, label: 'Q2' }, { t: 24, label: 'Mi-temps' }, { t: 36, label: 'Q4' }], ['Q1', 'Q2', 'Q3', 'Q4'],
    smooth(grid.map((t) => ({ t, adv: gcore(t).p[0] })), 9), gcore(48).score.join('-'), 0.05, grid);
}

// ——— Tennis : chaque point compte (jeu, set, match), service compris ———
function gameP(a: number, b: number, p: number): number {
  if (a >= 4 && a - b >= 2) return 1;
  if (b >= 4 && b - a >= 2) return 0;
  if (a >= 3 && b >= 3) {
    const d = (p * p) / (p * p + (1 - p) * (1 - p));
    return a === b ? d : a > b ? p + (1 - p) * d : p * d;
  }
  return p * gameP(a + 1, b, p) + (1 - p) * gameP(a, b + 1, p);
}
/** Chances du joueur 0 à partir de l'état exact du match (deux sets gagnants). */
function tennisModel(ps: [number, number]) {
  const hold = [gameP(0, 0, ps[0]), gameP(0, 0, ps[1])];
  const tb = clamp(0.5 + (ps[0] - ps[1]) * 2.2, 0.05, 0.95);
  const memo = new Map<string, number>();
  const set = (a: number, b: number, srv: number): number => {
    if ((a >= 6 && a - b >= 2) || a === 7) return 1;
    if ((b >= 6 && b - a >= 2) || b === 7) return 0;
    if (a === 6 && b === 6) return tb;
    const k = `${a},${b},${srv}`;
    const m = memo.get(k);
    if (m != null) return m;
    const w = srv === 0 ? hold[0] : 1 - hold[1];
    const v = w * set(a + 1, b, 1 - srv) + (1 - w) * set(a, b + 1, 1 - srv);
    memo.set(k, v);
    return v;
  };
  const s0 = (set(0, 0, 0) + set(0, 0, 1)) / 2;
  const match = (sa: number, sb: number) => (sa === 2 ? 1 : sb === 2 ? 0 : sa === 1 && sb === 1 ? s0 : sa === 1 ? s0 + (1 - s0) * s0 : sb === 1 ? s0 * s0 : s0 * s0 * (3 - 2 * s0));
  return (sa: number, sb: number, ga: number, gb: number, pa: number, pb: number, srv: number) => {
    if (sa === 2) return { m: 1, x: 1, three: sb === 1 ? 1 : 0 };
    if (sb === 2) return { m: 0, x: 0, three: sa === 1 ? 1 : 0 };
    const g = gameP(srv === 0 ? pa : pb, srv === 0 ? pb : pa, ps[srv]);
    const w = srv === 0 ? g : 1 - g;
    const x = w * set(ga + 1, gb, 1 - srv) + (1 - w) * set(ga, gb + 1, 1 - srv);
    const three = sa === 1 && sb === 1 ? 1 : sa === 1 ? 1 - x : sb === 1 ? x : x * (1 - s0) + (1 - x) * s0;
    return { m: x * match(sa + 1, sb) + (1 - x) * match(sa, sb + 1), x, three };
  };
}
interface TState { sets: Array<[number, number]>; won: [number, number]; pts: [number, number]; server: 0 | 1 }
/** Déroulé point par point d'un match dont les vainqueurs de chaque jeu sont écrits d'avance (graine fixe). */
function tennisPoints(sets: number[][], first: 0 | 1, ps: [number, number], seed: number) {
  const rnd = rng(seed);
  const states: TState[] = [{ sets: [[0, 0]], won: [0, 0], pts: [0, 0], server: first }];
  const starts: number[][] = [];
  const breaks: Array<{ t: number; side: 0 | 1 }> = [];
  const setEnds: Array<{ t: number; side: 0 | 1 }> = [];
  const done: Array<[number, number]> = [];
  let won: [number, number] = [0, 0];
  let server = first;
  sets.forEach((games, si) => {
    let g: [number, number] = [0, 0];
    starts.push([]);
    games.forEach((winner, gi) => {
      starts[si].push(states.length - 1);
      let seq: number[] = [];
      for (let tries = 0; tries < 500; tries++) {
        seq = [];
        let a = 0, b = 0;
        while (!((a >= 4 || b >= 4) && Math.abs(a - b) >= 2)) {
          const w = rnd() < ps[server] ? 0 : 1;
          seq.push(w);
          if (w === 0) a++; else b++;
        }
        if ((a > b ? server : 1 - server) === winner && seq.length <= 12) break;
      }
      const pts: [number, number] = [0, 0];
      seq.forEach((w, i) => {
        pts[w === 0 ? server : 1 - server]++;
        if (i < seq.length - 1) return void states.push({ sets: [...done, [g[0], g[1]]], won: [won[0], won[1]], pts: [pts[0], pts[1]], server });
        g = winner === 0 ? [g[0] + 1, g[1]] : [g[0], g[1] + 1];
        const t = states.length;
        if (winner !== server) breaks.push({ t, side: winner as 0 | 1 });
        server = (1 - server) as 0 | 1;
        if (gi === games.length - 1) {
          done.push(g);
          won = winner === 0 ? [won[0] + 1, won[1]] : [won[0], won[1] + 1];
          setEnds.push({ t, side: winner as 0 | 1 });
          states.push({ sets: si === sets.length - 1 ? [...done] : [...done, [0, 0]], won: [won[0], won[1]], pts: [0, 0], server });
        } else states.push({ sets: [...done, [g[0], g[1]]], won: [won[0], won[1]], pts: [0, 0], server });
      });
    });
  });
  return { states, starts, breaks, setEnds };
}
const PT = ['0', '15', '30', '40'];
const ptLabel = (a: number, b: number): [string, string] => (a >= 3 && b >= 3 ? (a === b ? ['40', '40'] : a > b ? ['A', '40'] : ['40', 'A']) : [PT[a], PT[b]]);
const ORD = ['1er', '2e', '3e'];
type TennisEv = [number, number, Gauge, 'up' | 'down', 0 | 1 | undefined, string, string];
interface TennisDef extends Base { ps: [number, number]; sets: number[][]; typical: number[][]; first: 0 | 1; script: TennisEv[] }

function tennisCore(d: TennisDef, states: TState[]) {
  const model = tennisModel(d.ps);
  const n = states.length - 1;
  const pre = model(0, 0, 0, 0, 0, 0, d.first);
  return (t: number): Core => {
    const k = Math.min(n, Math.floor(t + 1e-6));
    const s = states[k];
    const cur = s.sets[s.sets.length - 1];
    const over = s.won[0] === 2 || s.won[1] === 2;
    const r = over ? { m: s.won[0] === 2 ? 1 : 0, x: s.won[0] === 2 ? 1 : 0, three: s.sets.length === 3 ? 1 : 0 } : model(s.won[0], s.won[1], cur[0], cur[1], s.pts[0], s.pts[1], s.server);
    const mins = Math.round(k * 0.78);
    const setNo = Math.min(3, s.won[0] + s.won[1] + (over ? 0 : 1));
    const lead = s.won[0] !== s.won[1] ? s.won[0] - s.won[1] : over ? 0 : cur[0] - cur[1];
    const trail = lead === 0 ? undefined : lead < 0 ? 0 : 1;
    const at = over ? 'Terminé' : `${ORD[setNo - 1]} set`;
    return {
      clock: at, phase: over ? 'Fin du match' : `${Math.floor(mins / 60)} h ${pad(mins % 60)} de jeu`, score: s.won, p: [r.m, 0, 1 - r.m], pick: r.m, at: over ? at : `${at} · ${cur[0]}-${cur[1]}`, trail,
      back: trail === 0 ? r.m : trail === 1 ? 1 - r.m : undefined,
      tennis: { sets: s.sets, pts: ptLabel(s.pts[0], s.pts[1]), server: s.server },
      vals: [pct0(r.m), pct0(1 - r.m), over ? '-' : pct0(r.x), pct0(r.three)], nums: [r.m, 1 - r.m, over ? pre.x : r.x, r.three],
    };
  };
}
function tennis(d: TennisDef, seed: number): Demo {
  const real = tennisPoints(d.sets, d.first, d.ps, seed);
  const len = real.states.length - 1;
  const core = tennisCore(d, real.states);
  const typ = tennisPoints(d.typical, d.first, d.ps, seed + 13);
  const glen = typ.states.length - 1;
  const gcore = tennisCore(d, typ.states);
  const side = (s: 0 | 1) => (s === 0 ? d.home : d.away);
  const script: Ev[] = [
    { t: 0, kind: 'kick', title: 'Premier point' },
    ...real.breaks.map((b): Ev => ({ t: b.t, kind: 'break', side: b.side, title: `Break ${de(side(b.side).short)}`, text: `${side(b.side).short} prend le service adverse.`, big: true, word: 'Break', span: 4 })),
    ...real.setEnds.slice(0, -1).map((s, i): Ev => ({ t: s.t + 0.01, kind: 'set', side: s.side, title: `${ORD[i]} set pour ${side(s.side).short}`, text: `${d.sets[i].filter((w) => w === 0).length}-${d.sets[i].filter((w) => w === 1).length}`, big: true, word: 'Set', span: 2 })),
    ...d.script.map(([si, gi, gauge, tone, sd, title, text]): Ev => ({ t: real.starts[si][gi] + 0.5, kind: 'signal', gauge, tone, side: sd, title, text })),
    { t: len, kind: 'end', title: 'Jeu, set et match', side: real.setEnds[real.setEnds.length - 1].side },
  ];
  const marks = real.setEnds.slice(0, -1).map((s, i) => ({ t: s.t, label: `${ORD[i + 1]} set` }));
  const gs = typ.states[glen];
  return build('tennis', d, len, 0.7, core, [`Victoire ${d.home.short}`, `Victoire ${d.away.short}`, `${d.home.short} gagne le set en cours`, 'Match en trois sets'], script, marks,
    d.sets.map((_, i) => `${ORD[i]} set`), smooth(Array.from({ length: glen + 1 }, (_, k) => ({ t: (k / glen) * len, adv: gcore(k).p[0] })), 4), gs.sets.map((s) => s.join('-')).join(' '), 1,
    Array.from({ length: len + 1 }, (_, k) => k));
}

// ——— Les matchs ———
const club = (id: number, name: string, short: string, tri: string, color: string): Side => ({ name, short, tri, color, logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`, mark: `f${id}` });
const franchise = (tri: string, name: string, color?: string): Side => ({ name, short: name, tri, color: color ?? teamColor({ tri }), logo: teamLogo(tri), mark: tri });
const player = (name: string, short: string, tri: string, code: string, color: string): Side => ({ name, short, tri, color, photo: `https://www.atptour.com/-/media/alias/player-headshot/${code}` });
const sig = (m: number, gauge: Gauge, tone: 'up' | 'down', side: 0 | 1 | undefined, title: string, text: string): FootEv => [m, 'signal', side, title, text, { gauge, tone }];
const nsig = (t: number, gauge: Gauge, tone: 'up' | 'down', side: 0 | 1 | undefined, title: string, text: string): Ev => ({ t, kind: 'signal', gauge, tone, side, title, text });

export const DEMOS: Demo[] = [
  foot({
    id: 'villarreal-getafe', league: 'La Liga', where: 'Estadio de la Cerámica', phase0: 0.62,
    home: club(10205, 'Villarreal', 'Villarreal', 'VIL', '#f5d63d'), away: club(8305, 'Getafe', 'Getafe', 'GET', '#2f7fe0'),
    lam: [1.75, 0.85], typical: [[23, 0], [68, 0]], pick: { label: 'Villarreal vainqueur', odds: 1.65 }, test: (h, a) => h > a,
    script: [
      [14, 'goal', 1, 'But de Getafe', 'Le n° 9, sur le premier tir cadré de son équipe.'],
      sig(16, 'luck', 'up', 1, 'Getafe a de la réussite', "Un but pour 0,08 but attendu : le score ne raconte pas le match."),
      [27, 'chance', 0, 'Poteau pour Villarreal', 'Frappe du n° 19 sur le montant, 0,41 but attendu.'],
      [31, 'yellow', 1, 'Carton jaune pour Getafe', 'Le n° 2, en retard sur son adversaire.'],
      sig(36, 'fouls', 'down', 1, 'Pluie de fautes côté Getafe', '9 fautes en 36 minutes et deux joueurs avertis : le rouge se rapproche.'),
      [41, 'goal', 0, 'But de Villarreal', 'Le n° 7 égalise de la tête.'],
      [54, 'red', 1, 'Carton rouge pour Getafe', 'Second jaune pour le n° 2 : Getafe finit à dix.'],
      sig(61, 'energy', 'down', 1, 'Getafe baisse de régime', 'À dix depuis 7 minutes : 18 % de courses rapides en moins.'),
      [67, 'goal', 0, 'But de Villarreal', 'Le n° 19 conclut un mouvement de dix passes.'],
      [74, 'sub', 1, 'Changement à Getafe', 'Le n° 12 remplace le n° 9.'],
      sig(80, 'comeback', 'down', 1, 'Retour de Getafe peu probable', 'Getafe revient au score dans {back}.'),
      [88, 'goal', 0, 'But de Villarreal', 'Le n° 16, en contre.'],
    ],
    g: {
      energy: [[0, 1, 1], [0.45, 0.86, 0.82], [0.6, 0.8, 0.7], [0.75, 0.74, 0.5], [1, 0.66, 0.34]],
      fouls: [[0, 0, 0], [0.37, 4, 9], [0.6, 6, 13], [1, 10, 18]],
      rhythm: [[0, 0.55, 0.5], [0.3, 0.7, 0.42], [0.6, 0.78, 0.3], [1, 0.72, 0.22]],
      luck: [[0, 0, 0], [0.14, -0.05, 0.05], [0.16, -0.25, 0.85], [0.42, -0.2, 0.7], [0.7, 0, 0.5], [1, 0.15, 0.35]],
      dom: [[0, 0.2], [0.12, 0.35], [0.16, -0.1], [0.3, 0.5], [0.45, 0.4], [0.52, 0.1], [0.6, 0.6], [0.8, 0.7], [0.9, 0.3], [1, 0.4]],
    },
  }),
  tennis({
    id: 'sinner-alcaraz', league: 'ATP Finals', where: 'Turin · Dur intérieur', phase0: 0.27,
    home: player('Jannik Sinner', 'Sinner', 'SIN', 's0ag', '#f08a24'), away: player('Carlos Alcaraz', 'Alcaraz', 'ALC', 'a0e2', '#3aa0e8'),
    ps: [0.66, 0.65], first: 0, pick: { label: 'Sinner vainqueur', odds: 1.85 },
    sets: [[0, 1, 0, 1, 0, 1, 0, 0, 0], [1, 0, 1, 0, 1, 1, 1, 0, 1], [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0]],
    typical: [[0, 1, 0, 1, 0, 1, 0, 1, 0, 0], [0, 1, 1, 1, 0, 1, 0, 1, 0, 1], [0, 1, 0, 0, 0, 1, 0, 1, 0]],
    script: [
      [0, 4, 'rhythm', 'up', undefined, 'Échanges courts', '3,1 coups par point : les deux joueurs tiennent leur service sans trembler.'],
      [1, 3, 'fouls', 'down', 0, 'Sinner se dérègle', '9 fautes directes dans ce set, contre 4 dans le premier.'],
      [2, 2, 'luck', 'up', 1, "Alcaraz s'en sort bien", '5 balles de break sauvées sur 6 depuis le début du match.'],
      [2, 7, 'energy', 'down', 1, 'Alcaraz moins explosif', '2 heures de jeu : son premier service a perdu 9 km/h.'],
      [2, 11, 'comeback', 'down', 1, 'Alcaraz sert pour rester dans le match', 'À 5-6 dans le dernier set, chaque point pèse double.'],
    ],
    g: {
      energy: [[0, 1, 1], [0.4, 0.9, 0.9], [0.7, 0.8, 0.74], [0.85, 0.74, 0.55], [1, 0.7, 0.44]],
      fouls: [[0, 0, 0], [0.3, 5, 7], [0.62, 16, 12], [1, 24, 26]],
      rhythm: [[0, 0.62, 0.6], [0.3, 0.7, 0.58], [0.45, 0.5, 0.66], [0.62, 0.44, 0.7], [0.8, 0.62, 0.6], [1, 0.68, 0.5]],
      luck: [[0, 0, 0], [0.3, 0.1, -0.1], [0.62, -0.2, 0.35], [0.75, -0.3, 0.75], [1, 0.1, 0.3]],
      dom: [[0, 0.05], [0.25, 0.3], [0.32, 0.5], [0.4, -0.1], [0.6, -0.5], [0.66, -0.2], [0.85, 0.1], [0.95, 0.55], [1, 0.6]],
    },
  }, 41),
  nba({
    id: 'celtics-knicks', league: 'NBA', where: 'TD Garden · Boston', phase0: 0.06,
    home: franchise('BOS', 'Celtics'), away: franchise('NYK', 'Knicks', '#f58426'),
    spread: 5.5, total: 222, pick: { label: 'Boston vainqueur', odds: 1.42 }, pickP: (mean, sd) => phi(mean / sd),
    segs: [[0, 12, 27, 31], [12, 24, 26, 29], [24, 30, 13, 14], [30, 33.5, 14, 2], [33.5, 36, 6, 7], [36, 42, 14, 15], [42, 45, 4, 9], [45, 48, 11, 5]],
    fixed: [[46.6, 0, 3]],
    typical: [[0, 12, 29, 26], [12, 24, 28, 27], [24, 36, 29, 27], [36, 48, 28, 26]],
    script: [
      nsig(7.5, 'rhythm', 'up', 1, 'Les Knicks sont chauds', '7 tirs réussis sur 9 pour commencer, dont 4 sur 5 à 3 points.'),
      nsig(16.2, 'fouls', 'down', 0, 'Boston dans les fautes', 'Troisième faute pour le n° 0 des Celtics : il sort jusqu’à la pause.'),
      { t: 33.5, kind: 'run', side: 0, title: 'Série de Boston', text: '14-2 en 3 min 30 : trois tirs à 3 points et deux ballons volés.', big: true, word: '14-2', span: 3.5 },
      nsig(38.5, 'energy', 'down', 1, 'Les Knicks tirent la langue', 'Deuxième match en deux soirs : leurs titulaires ont déjà 31 minutes dans les jambes.'),
      nsig(43, 'luck', 'up', 1, 'New York au-dessus de son niveau de loin', '15 sur 29 à 3 points, contre 36 % d’habitude : ça tient rarement 48 minutes.'),
      { t: 45, kind: 'timeout', side: 0, title: 'Temps mort de Boston', text: 'Les Knicks viennent de repasser devant.' },
      { t: 46.6, kind: 'three', side: 0, title: 'Tir à 3 points de Boston', text: 'Le n° 0, dans le coin, à 1 min 23 de la fin.', big: true, word: '+3', span: 0.05 },
    ],
    g: {
      energy: [[0, 1, 1], [0.5, 0.86, 0.8], [0.8, 0.74, 0.56], [1, 0.66, 0.42]],
      fouls: [[0, 0, 0], [0.34, 9, 6], [0.5, 12, 9], [1, 21, 19]],
      rhythm: [[0, 0.45, 0.8], [0.3, 0.48, 0.7], [0.62, 0.52, 0.66], [0.7, 0.72, 0.6], [1, 0.62, 0.5]],
      luck: [[0, 0, 0], [0.16, -0.1, 0.6], [0.6, -0.15, 0.55], [0.9, 0, 0.7], [1, 0.1, 0.4]],
      dom: [[0, -0.2], [0.15, -0.35], [0.5, -0.2], [0.62, 0], [0.66, 0.9], [0.7, 0.8], [0.75, 0.1], [0.88, -0.4], [0.94, -0.5], [0.96, 0.6], [1, 0.7]],
    },
  }, 7),
  nba({
    id: 'lakers-warriors', league: 'NBA', where: 'Crypto.com Arena · Los Angeles', phase0: 0.78,
    home: franchise('LAL', 'Lakers'), away: franchise('GSW', 'Warriors', '#ffc72c'),
    spread: -1.5, total: 226, pick: { label: 'Warriors +8,5', odds: 1.38 }, pickP: (mean, sd) => 1 - phi((mean - 8.5) / sd),
    segs: [[0, 12, 31, 22], [12, 18, 15, 13], [18, 21.5, 13, 2], [21.5, 24, 4, 8], [24, 28, 9, 10], [28, 32, 4, 15], [32, 36, 7, 9], [36, 42, 12, 16], [42, 48, 13, 10]],
    fixed: [[47.2, 0, 3]],
    typical: [[0, 12, 27, 29], [12, 24, 28, 28], [24, 36, 28, 27], [36, 48, 27, 28]],
    script: [
      nsig(6, 'rhythm', 'down', 1, 'Golden State ne règle pas la mire', '1 sur 9 à 3 points : les tirs sont ouverts, ils ne rentrent pas.'),
      { t: 21.5, kind: 'run', side: 0, title: 'Série de Los Angeles', text: '13-2 en 3 min 30 : les Lakers comptent 22 points d’avance.', big: true, word: '13-2', span: 3.5 },
      nsig(25, 'luck', 'down', 1, 'Warriors malchanceux', 'De bons tirs : 54 points attendus à la pause, 45 marqués.'),
      { t: 32, kind: 'run', side: 1, title: 'Série de Golden State', text: '15-4 en 4 minutes : l’écart tombe à 6 points.', big: true, word: '15-4', span: 4 },
      nsig(34, 'comeback', 'up', 1, 'Golden State revient', 'De -22 à -8 : les Warriors gagnent maintenant dans {back}.'),
      nsig(40, 'energy', 'down', 0, 'Los Angeles ralentit', 'Rythme en baisse de 8 possessions depuis la pause.'),
      nsig(42.5, 'fouls', 'down', 0, 'Lakers dans le bonus', '5 fautes d’équipe en 6 minutes : chaque faute envoie Golden State aux lancers.'),
      { t: 47.2, kind: 'three', side: 0, title: 'Tir à 3 points de Los Angeles', text: 'Le n° 15, à 48 secondes de la fin.', big: true, word: '+3', span: 0.05 },
    ],
    g: {
      energy: [[0, 1, 1], [0.5, 0.84, 0.86], [0.8, 0.58, 0.74], [1, 0.46, 0.64]],
      fouls: [[0, 0, 0], [0.5, 8, 10], [0.86, 15, 15], [0.9, 19, 16], [1, 22, 19]],
      rhythm: [[0, 0.7, 0.2], [0.3, 0.72, 0.25], [0.55, 0.6, 0.4], [0.66, 0.4, 0.8], [1, 0.5, 0.62]],
      luck: [[0, 0, 0], [0.2, 0.3, -0.6], [0.5, 0.35, -0.7], [0.7, 0.1, -0.2], [1, 0.2, 0.1]],
      dom: [[0, 0.4], [0.3, 0.3], [0.42, 0.9], [0.46, 0.2], [0.58, -0.3], [0.66, -0.9], [0.7, -0.5], [0.85, -0.3], [0.95, 0.2], [1, 0.5]],
    },
  }, 23),
  tennis({
    id: 'fritz-de-minaur', league: 'ATP Finals', where: 'Turin · Dur intérieur', phase0: 0.9,
    home: player('Taylor Fritz', 'Fritz', 'FRI', 'fb98', '#e5484d'), away: player('Alex de Minaur', 'De Minaur', 'DEM', 'dh58', '#f1c35b'),
    ps: [0.67, 0.62], first: 0, pick: { label: 'Fritz vainqueur', odds: 1.48 },
    sets: [[0, 1, 0, 1, 1, 1, 0, 1, 0, 1], [0, 1, 0, 0, 0, 1, 0, 1, 0], [0, 0, 1, 0, 0, 0, 1, 0]],
    typical: [[0, 1, 0, 1, 0, 1, 0, 1, 0, 0], [0, 1, 0, 1, 0, 0, 0, 1, 0]],
    script: [
      [0, 5, 'fouls', 'down', 0, 'Fritz multiplie les fautes directes', '11 fautes directes en cinq jeux, dont 7 en coup droit.'],
      [0, 7, 'rhythm', 'down', 0, 'Fritz cherche son service', '49 % de premières balles : il en passe 66 % d’habitude.'],
      [1, 4, 'rhythm', 'up', 0, 'Fritz a retrouvé son service', '8 premières balles sur 9 dans ce set, deux aces dans le dernier jeu.'],
      [2, 1, 'energy', 'down', 1, 'De Minaur ralentit', '1 h 50 de jeu : il couvre 6 % de terrain en moins depuis le 2e set.'],
      [2, 3, 'comeback', 'down', 1, 'Retour de De Minaur peu probable', 'Il renverse le match dans {back}.'],
    ],
    g: {
      energy: [[0, 1, 1], [0.4, 0.9, 0.88], [0.7, 0.82, 0.66], [1, 0.76, 0.4]],
      fouls: [[0, 0, 0], [0.2, 11, 4], [0.4, 15, 9], [1, 24, 27]],
      rhythm: [[0, 0.5, 0.6], [0.3, 0.3, 0.62], [0.5, 0.75, 0.55], [1, 0.8, 0.4]],
      luck: [[0, 0, 0], [0.35, -0.3, 0.4], [0.7, 0, 0.1], [1, 0.2, -0.2]],
      dom: [[0, 0], [0.15, -0.4], [0.38, -0.3], [0.45, 0.4], [0.7, 0.5], [0.8, 0.8], [1, 0.7]],
    },
  }, 5),
  foot({
    id: 'lyon-marseille', league: 'Ligue 1', where: 'Groupama Stadium', phase0: 0.14,
    home: club(9748, 'Lyon', 'Lyon', 'OL', '#e0202b'), away: club(8592, 'Marseille', 'Marseille', 'OM', '#2faee0'),
    lam: [1.6, 1.25], typical: [[18, 0], [49, 1], [72, 0]], pick: { label: 'Lyon ou nul', odds: 1.3 }, test: (h, a) => h >= a,
    script: [
      [9, 'goal', 0, 'But de Lyon', 'Le n° 7 ouvre le score sur corner.'],
      [28, 'goal', 0, 'But de Lyon', 'Le n° 9, lancé dans la profondeur.'],
      sig(30, 'luck', 'up', 0, 'Lyon très réaliste', '2 buts pour 0,9 but attendu : pas de marge si la réussite tourne.'),
      [52, 'goal', 1, 'But de Marseille', "Le n° 11 réduit l'écart."],
      sig(60, 'energy', 'down', 0, 'Lyon fatigue', 'Troisième match en 7 jours : le bloc a reculé de 9 mètres depuis la pause.'),
      [66, 'yellow', 0, 'Carton jaune pour Lyon', 'Le n° 5 coupe un contre.'],
      sig(70, 'comeback', 'up', 1, 'Marseille revient', 'Marseille prend au moins un point dans {back}.'),
      [76, 'goal', 1, 'But de Marseille', 'Le n° 8, d’une frappe de 20 mètres.'],
      [84, 'sub', 0, 'Changement à Lyon', 'Le n° 14 remplace le n° 9.'],
      [92, 'goal', 1, 'But de Marseille', 'Le n° 9, au bout d’un contre à trois contre deux.'],
    ],
    g: {
      energy: [[0, 1, 1], [0.5, 0.8, 0.86], [0.75, 0.52, 0.76], [1, 0.36, 0.66]],
      fouls: [[0, 0, 0], [0.5, 5, 6], [0.8, 11, 8], [1, 14, 10]],
      rhythm: [[0, 0.7, 0.5], [0.3, 0.74, 0.45], [0.55, 0.5, 0.66], [1, 0.3, 0.8]],
      luck: [[0, 0, 0], [0.1, 0.4, 0], [0.3, 0.8, -0.2], [0.6, 0.5, 0], [1, 0, 0.3]],
      dom: [[0, 0.5], [0.3, 0.6], [0.48, 0.2], [0.55, -0.4], [0.8, -0.6], [0.9, -0.3], [1, -0.7]],
    },
  }),
];

export const demoOf = (id: string) => DEMOS.find((m) => m.id === id);

// ——— Horloge commune : même état sur toutes les pages, et d'un rechargement à l'autre ———
const HOLD = 16; // secondes d'affichage du score final avant de reprendre au coup d'envoi
let rate = 1;
let anchor = { real: Date.now(), virt: Date.now() / 1000 };
const shift: Record<string, number> = {};
const subs = new Set<() => void>();
const vnow = () => anchor.virt + ((Date.now() - anchor.real) / 1000) * rate;
const cycle = (m: Demo) => m.len / m.pace + HOLD;
const emit = () => subs.forEach((f) => f());
export const clock = {
  /** Instant du match (dans son unité : minute, point) et s'il est fini (score final affiché avant de reprendre). */
  of(m: Demo): { t: number; ended: boolean } {
    const c = cycle(m);
    const x = (((vnow() + (shift[m.id] ?? 0) + m.phase0 * c) % c) + c) % c;
    return { t: Math.min(m.len, x * m.pace), ended: x * m.pace >= m.len };
  },
  /** Place le match à un moment donné (0 = coup d'envoi, 1 = fin). */
  seek(m: Demo, k: number) {
    shift[m.id] = (k * m.len) / m.pace - vnow() - m.phase0 * cycle(m);
    emit();
  },
  get rate() {
    return rate;
  },
  setRate(r: number) {
    anchor = { real: Date.now(), virt: vnow() };
    rate = r;
    emit();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};

/** Avantage à l'instant t, lu sur une courbe déjà calculée. */
export function advAt(series: Pt[], t: number): number {
  let lo = 0, hi = series.length - 1;
  if (t <= series[0].t) return series[0].adv;
  if (t >= series[hi].t) return series[hi].adv;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = series[lo], b = series[hi];
  return a.adv + ((b.adv - a.adv) * (t - a.t)) / (b.t - a.t || 1);
}
