// Ce que le moteur live voit venir, à partir de l'état d'un match : le prono du moment (choisi comme avant le match),
// le risque qu'il change, l'annonce (but probable, break en vue, réussite qui va retomber), les scénarios des prochaines
// minutes et les deux graphiques de la fiche (les fins possibles, quand tombe le prochain but / break).
// Tout sort du moteur (src/live), appelé ici dans le navigateur : la page ne montre que de la prédiction.
// Les fins tirées au sort sont stables d'une seconde à l'autre (tirage attaché au match et à la minute, pas à l'horloge).
import { footNow, nbaNow, tennisNow, TENNIS } from '../../src/live/index.ts';
import { calibrateTennis, holdFrom, setFrom, tbFrom, type TennisState } from '../../src/live/tennis.ts';
import type { NbaPre, NbaState } from '../../src/live/nba.ts';
import { n1, pct0 } from './data.ts';

export type Eng =
  | { sport: 'foot'; lam: [number, number]; minute: number; score: [number, number]; reds: [number, number]; ended?: boolean }
  | { sport: 'nba'; pre: NbaPre; st: NbaState; ended?: boolean }
  | { sport: 'tennis'; p0: number; surface: string; st: TennisState; ended?: boolean };

export type Tier = 'sure' | 'safe' | 'ok' | 'risky' | 'flip' | 'done';
export interface Pick { key: string; label: string; side: 0 | 1; p: number; tier: Tier; fair: number }
export interface Scen { label: string; chance: number; p: number; to?: string; tone: 'up' | 'down' | 'flat' }
export interface Signal { kind: 'goal' | 'break' | 'cool' | 'run' | 'none'; side?: 0 | 1; title: string; text: string; p?: number; usual?: number; value?: string }
export interface Fan { xs: number[]; lines: Array<{ v: number[]; win: boolean }>; ticks: Array<{ x: number; s: string }>; wins: number; hold?: number[] }
export interface Waves { title: string; bins: Array<{ s: string; h: number; a: number }>; none?: { s: string; v: number }; say: string; legend: [string, string] }
export interface Ahead {
  key: string; pick: Pick; change: number; stab: 'solide' | 'surveiller' | 'fragile'; why: string; soon?: string;
  signal: Signal; scen: Scen[]; horizon: string; fan?: Fan; waves?: Waves; comeback?: { side: 0 | 1; p: number; label: string };
}

// ——— Outils ———
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const de = (n: string) => (/^[AEIOUYÉÈH]/i.test(n) ? `d'${n}` : `de ${n}`);
const erf = (x: number) => { const a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a); return Math.sign(x) * y; };
const Phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const logit = (p: number) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));
const sig = (x: number) => 1 / (1 + Math.exp(-x));
/** Tirage entre 0 et 1, toujours le même pour (graine, fin n° k, pas i) : les lignes ne tremblent pas d'une seconde à l'autre. */
function hash(seed: number, k: number, i: number): number {
  let x = (Math.imul(seed | 0, 374761393) + Math.imul(k | 0, 668265263) + Math.imul(i | 0, 1274126177)) | 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519); x = Math.imul(x ^ (x >>> 13), 3266489917); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const gauss = (seed: number, k: number, i: number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, hash(seed, k, i * 2)))) * Math.cos(6.283185 * hash(seed, k, i * 2 + 1));
export const seedOf = (s: string) => { let h = 7; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; };
const T_SURE = { foot: 0.85, nba: 0.77, tennis: 0.77 } as const;
const tierOf = (sport: Eng['sport'], p: number): Tier => (p >= 0.995 ? 'done' : p >= T_SURE[sport] ? 'sure' : p >= 0.7 ? 'ok' : p >= 0.6 ? 'risky' : 'flip');
const stabOf = (c: number): Ahead['stab'] => (c < 0.08 ? 'solide' : c < 0.22 ? 'surveiller' : 'fragile');
const LINES = 44;
/** Garde `LINES` fins tirées au sort, avec la bonne part de fins où le prono passe. */
function quota<T extends { win: boolean }>(p: number, draw: (k: number) => T): { lines: T[]; wins: number } {
  const wins = p >= 0.995 ? LINES : p <= 0.005 ? 0 : clamp(Math.round(p * LINES), 1, LINES - 1), W: T[] = [], L: T[] = [];
  for (let k = 0; k < 900 && (W.length < wins || L.length < LINES - wins); k++) { const t = draw(k); if (t.win) { if (W.length < wins) W.push(t); } else if (L.length < LINES - wins) L.push(t); }
  return { lines: [...L, ...W], wins: W.length };
}

// ——— Football ———
interface FO { p: [number, number, number]; soon: [number, number]; next: [number, number, number]; rem: [number, number]; comeback?: { side: 0 | 1; draw: number; win: number } }
const footMemo = new Map<string, FO>();
function fo(lam: [number, number], m: number, gh: number, ga: number, rh: number, ra: number): FO {
  const k = `${lam[0]},${lam[1]},${m},${gh},${ga},${rh},${ra}`;
  let v = footMemo.get(k);
  if (!v) {
    const at = Math.max(1, m), rep = (n: number, s: 0 | 1) => Array.from({ length: n }, (): [number, 0 | 1] => [at, s]);
    const o = footNow(lam, { minute: m, goals: [...rep(gh, 0), ...rep(ga, 1)], reds: [...rep(rh, 0), ...rep(ra, 1)], shots: [] });
    v = { p: o.p1x2, soon: o.goalSoon, next: o.nextGoal, rem: o.remaining, comeback: o.comeback };
    if (footMemo.size > 6000) footMemo.clear();
    footMemo.set(k, v);
  }
  return v;
}
const footVal = (key: string, p: [number, number, number]) => (key === '1' ? p[0] : key === '2' ? p[2] : key === '1X' ? p[0] + p[1] : p[2] + p[1]);
function footPick(p: [number, number, number], names: [string, string]): Pick {
  const side: 0 | 1 = p[0] >= p[2] ? 0 : 1, win = side === 0 ? p[0] : p[2], dc = win + p[1];
  // Comme avant le match : le vainqueur à 60 % ou plus, sinon « favori ou nul » ; en dessous de 60 %, pile ou face.
  const w = win >= 0.6, v = w ? win : dc;
  return { key: w ? (side === 0 ? '1' : '2') : side === 0 ? '1X' : 'X2', label: w ? `${names[side]} gagne` : `${names[side]} ou nul`, side, p: v, tier: tierOf('foot', v), fair: 1 / Math.max(0.01, v) };
}
function footAhead(e: Extract<Eng, { sport: 'foot' }>, names: [string, string], seed: number): Ahead {
  const [gh, ga] = e.score, [rh, ra] = e.reds, M = Math.min(90, e.minute), o = fo(e.lam, M, gh, ga, rh, ra);
  const pick = footPick(o.p, names), key = `f${M},${gh},${ga},${rh},${ra}`;
  if (e.ended || M >= 90) return { key, pick: { ...pick, tier: 'done' }, change: 0, stab: 'solide', why: 'Match terminé.', signal: { kind: 'none', title: 'Match terminé', text: '' }, scen: [], horizon: '' };
  const H = Math.min(10, 90 - M), end = M + H;
  const row = (label: string, chance: number, st: FO): Scen => {
    const np = footPick(st.p, names), p = footVal(pick.key, st.p);
    return { label, chance, p, to: np.key !== pick.key ? `${np.label} (${pct0(np.p)})` : undefined, tone: p > pick.p + 0.02 ? 'up' : p < pick.p - 0.02 ? 'down' : 'flat' };
  };
  const mid = Math.min(89, M + Math.ceil(H / 2));
  const scen = [
    row(`Aucun but d'ici la ${end}e`, (1 - o.soon[0]) * (1 - o.soon[1]), fo(e.lam, end, gh, ga, rh, ra)),
    row(`But ${de(names[0])}`, o.soon[0], fo(e.lam, mid, gh + 1, ga, rh, ra)),
    row(`But ${de(names[1])}`, o.soon[1], fo(e.lam, mid, gh, ga + 1, rh, ra)),
  ];
  const bad = scen.filter((s) => s.to && s.tone === 'down'), change = clamp(bad.reduce((a, s) => a + s.chance, 0), 0, 0.99), risk = bad.sort((a, b) => b.chance - a.chance)[0];
  // Sans but, à quelle minute le prono devient « Razzia assuré » ?
  let soon: string | undefined;
  if (pick.tier !== 'sure' && pick.tier !== 'flip') for (let m = M + 1; m < 90; m++) if (footVal(pick.key, fo(e.lam, m, gh, ga, rh, ra).p) >= T_SURE.foot) { soon = `Sans but, Razzia assuré dès la ${m}e`; break; }
  // Annonce : un but dans les minutes qui viennent, comparé à l'habitude au même moment d'un match à égalité.
  const any = 1 - (1 - o.soon[0]) * (1 - o.soon[1]), usual = 1 - Math.exp((-(e.lam[0] + e.lam[1]) * H) / 90);
  const hot: 0 | 1 = o.soon[0] >= o.soon[1] ? 0 : 1, trail = gh === ga ? undefined : gh < ga ? 0 : 1;
  const signal: Signal = any >= usual * 1.3 && any >= 0.2
    ? { kind: 'goal', side: hot, p: any, usual, title: `But probable d'ici la ${end}e`, text: `${names[hot]} ${trail === hot ? 'est mené et pousse' : (hot === 0 ? ra : rh) > 0 ? 'joue en supériorité numérique' : 'a la main'} : ${pct0(o.soon[hot])} pour ${names[hot]}, ${pct0(o.soon[1 - hot])} pour ${names[1 - hot]}.` }
    : { kind: 'none', p: any, usual, title: 'Rien d’anormal en vue', text: `Un but d'ici la ${end}e : ${pct0(any)}. La moyenne sur ${H} minutes de ce match : ${pct0(usual)}.` };
  // Quand tombe le prochain but : part des fins, minute par minute.
  const rem = 90 - M, bw = rem > 60 ? 5 : rem > 30 ? 3 : rem > 14 ? 2 : 1, n0 = o.next[2], bins = new Map<number, { s: string; h: number; a: number }>();
  let S = 1;
  for (let m = M; m < 90; m++) {
    const cur = fo(e.lam, m, gh, ga, rh, ra), nx = m + 1 >= 90 ? n0 : n0 / Math.max(n0, fo(e.lam, m + 1, gh, ga, rh, ra).next[2]), mass = Math.max(0, S - nx), sh = cur.next[0] / Math.max(1e-9, cur.next[0] + cur.next[1]);
    S = nx;
    const b = Math.floor(m / bw) * bw, x = bins.get(b) ?? { s: `${b + bw}'`, h: 0, a: 0 };
    x.h += mass * sh; x.a += mass * (1 - sh); bins.set(b, x);
  }
  const waves: Waves = { title: 'Quand tombe le prochain but', bins: [...bins.values()], none: { s: 'Plus de but', v: n0 }, legend: [`But ${de(names[0])}`, `But ${de(names[1])}`], say: `Plus aucun but dans ${Math.round(n0 * 100)} fins sur 100. Sinon, le prochain est pour ${names[o.next[0] >= o.next[1] ? 0 : 1]} ${Math.round((Math.max(o.next[0], o.next[1]) / Math.max(1e-9, o.next[0] + o.next[1])) * 10)} fois sur 10.` };
  // Les fins possibles : des matchs joués jusqu'au bout, la chance du prono le long de chacun.
  const step = rem > 66 ? 4 : rem > 44 ? 3 : rem > 22 ? 2 : 1, xs = [M];
  for (let m = (Math.floor(M / step) + 1) * step; m <= 90; m += step) xs.push(m);
  if (xs[xs.length - 1] !== 90) xs.push(90);
  const { lines, wins } = quota(pick.p, (k) => {
    let h = gh, a = ga; const v = [pick.p];
    for (let i = 1; i < xs.length; i++) {
      const c = fo(e.lam, xs[i - 1], h, a, rh, ra), dt = xs[i] - xs[i - 1], left = Math.max(1, 90 - xs[i - 1]);
      if (hash(seed, k, xs[i] * 2) < 1 - Math.exp((-c.rem[0] * dt) / left)) h++;
      if (hash(seed, k, xs[i] * 2 + 1) < 1 - Math.exp((-c.rem[1] * dt) / left)) a++;
      v.push(footVal(pick.key, fo(e.lam, xs[i], h, a, rh, ra).p));
    }
    return { v, win: v[v.length - 1] > 0.5 };
  });
  const tk = rem > 44 ? 15 : rem > 22 ? 10 : 5, ticks = [{ x: M, s: `${M}'` }];
  for (let m = (Math.floor(M / tk) + 1) * tk; m <= 90; m += tk) if (m - M >= tk * 0.6) ticks.push({ x: m, s: `${m}'` });
  const fan: Fan = { xs, lines, wins, ticks, hold: xs.map((m) => footVal(pick.key, fo(e.lam, m, gh, ga, rh, ra).p)) };
  const cb = o.comeback;
  return {
    key, pick, change, stab: stabOf(change), soon, signal, scen, horizon: `d'ici la ${end}e`, fan, waves,
    why: risk ? (risk.label.startsWith('Aucun') ? `Sans but d'ici la ${end}e, il deviendrait ${risk.to} : ${pct0(risk.chance)} de chances.` : `${risk.label.replace(/^But /, 'Un but ')} le ferait changer (${pct0(risk.chance)} de chances d'ici la ${end}e).`) : `Aucun scénario ne le fait changer d'ici la ${end}e.`,
    comeback: cb ? { side: cb.side, p: cb.draw, label: `${names[cb.side]} revient au score` } : undefined,
  };
}

// ——— Basket ———
type NbaE = Extract<Eng, { sport: 'nba' }>;
const nbaVal = (key: string, o: ReturnType<typeof nbaNow>) => (key === 'W0' ? o.win[0] : key === 'W1' ? o.win[1] : key.startsWith('H0:') ? o.cover(Number(key.slice(3))) : 1 - o.cover(-Number(key.slice(3))));
const nbaFinal = (key: string, d: number) => (key === 'W0' ? d > 0 : key === 'W1' ? d < 0 : key.startsWith('H0:') ? d + Number(key.slice(3)) > 0 : -d + Number(key.slice(3)) > 0);
function nbaPick(o: ReturnType<typeof nbaNow>, names: [string, string]): Pick {
  const side: 0 | 1 = o.win[0] >= o.win[1] ? 0 : 1, w = o.win[side];
  // Comme avant le match : le favori à 66 % ou plus ; sinon le handicap « plus sûr » (la plus petite avance qui passe 75 fois sur 100).
  if (w >= 0.66) return { key: `W${side}`, label: `Victoire ${names[side]}`, side, p: w, tier: tierOf('nba', w), fair: 1 / w };
  for (let L = 1.5; L <= 14.5; L += 1) { const key = `H${side}:${L}`, p = nbaVal(key, o); if (p >= 0.75) return { key, label: `${names[side]} +${String(L).replace('.', ',')}`, side, p, tier: 'safe', fair: 1 / p }; }
  return { key: `W${side}`, label: `Victoire ${names[side]}`, side, p: w, tier: 'flip', fair: 1 / Math.max(0.01, w) };
}
function nbaAhead(e: NbaE, names: [string, string], seed: number): Ahead {
  const st = e.st, o = nbaNow(e.pre, st), r = 48 - st.elapsed, [h, a] = st.score, D = h - a, pick = nbaPick(o, names), key = `n${st.elapsed.toFixed(1)},${h},${a}`;
  if (e.ended || r <= 0.05) return { key, pick: { ...pick, tier: 'done' }, change: 0, stab: 'solide', why: 'Match terminé.', signal: { kind: 'none', title: 'Match terminé', text: '' }, scen: [], horizon: '' };
  const pace = Math.max(3, (o.total.mean - (h + a)) / r), rate = (o.margin.mean - D) / r, sd1 = o.margin.sd / Math.sqrt(r);
  const at = (el: number, d: number): NbaState => { const tot = h + a + pace * (el - st.elapsed), hs = Math.round((tot + d) / 2); return { ...st, elapsed: Math.min(47.99, el), score: [hs, hs - Math.round(d)], diff5: undefined }; };
  const w = Math.min(4, r), R = r < 4 ? 5 : 8, sdw = sd1 * Math.sqrt(w), dr = rate * w;
  const row = (label: string, chance: number, d: number): Scen => {
    const o2 = nbaNow(e.pre, at(st.elapsed + w, d)), np = nbaPick(o2, names), p = nbaVal(pick.key, o2);
    // Un handicap qui bouge d'un point reste le même prono : seul un changement de camp ou de type de pari compte.
    return { label, chance, p, to: np.key.split(':')[0] !== pick.key.split(':')[0] ? `${np.label} (${pct0(np.p)})` : undefined, tone: p > pick.p + 0.02 ? 'up' : p < pick.p - 0.02 ? 'down' : 'flat' };
  };
  const cH = 1 - Phi((R - dr) / sdw), cA = Phi((-R - dr) / sdw), wm = w >= 4 ? '4 minutes' : `${Math.max(1, Math.round(w))} min`;
  const scen = [row('Pas de série', Math.max(0, 1 - cH - cA), D + dr), row(`Série des ${names[0]} (+${R} en ${wm})`, cH, D + R), row(`Série des ${names[1]} (+${R} en ${wm})`, cA, D - R)];
  const bad = scen.filter((s) => s.to && s.tone === 'down'), change = clamp(bad.reduce((x, s) => x + s.chance, 0), 0, 0.99), risk = bad.sort((x, y) => y.chance - x.chance)[0];
  // Annonce : la réussite au tir au-dessus de l'habitude (le moteur la retire), sinon une série en cours.
  const luck = o.factors.luck, run = o.factors.run, ls: 0 | 1 = luck >= 0 ? 0 : 1, rs: 0 | 1 = run >= 0 ? 0 : 1;
  const signal: Signal = Math.abs(luck) >= 2.5
    ? { kind: 'cool', side: ls, value: `${n1(Math.abs(luck))} pts`, title: `La réussite des ${names[ls]} devrait retomber`, text: `Les ${names[ls]} ont marqué ${n1(Math.abs(luck))} points de plus que leur adresse habituelle (de loin et aux lancers). Le moteur ne compte pas dessus pour la suite.` }
    : Math.abs(run) >= 7
      ? { kind: 'run', side: rs, value: `+${Math.round(Math.abs(run))}`, title: `Série des ${names[rs]} en cours`, text: `${Math.round(Math.abs(run))} points repris en 5 minutes. D'après les saisons passées, une série ne dit presque rien de la suite : le moteur n'en garde que 5 %.` }
      : { kind: 'none', title: 'Rien d’anormal en vue', text: `Adresse et rythme dans les habitudes des deux équipes. Écart final attendu : ${names[o.margin.mean >= 0 ? 0 : 1]} +${n1(Math.abs(o.margin.mean))}.` };
  // De combien ça finit : l'écart final, par tranches de 3 points.
  const lo = Math.floor((o.margin.mean - 2.6 * o.margin.sd) / 3) * 3, hi = Math.ceil((o.margin.mean + 2.6 * o.margin.sd) / 3) * 3, bins: Waves['bins'] = [];
  for (let b = lo; b < hi; b += 3) {
    const m = Phi((b + 3 - o.margin.mean) / o.margin.sd) - Phi((b - o.margin.mean) / o.margin.sd), c = b + 1.5, hs = b >= 0 ? 1 : b + 3 <= 0 ? 0 : (b + 3) / 3;
    bins.push({ s: c > 0 ? `+${Math.round(c)}` : `${Math.round(c)}`.replace('-', '−'), h: m * hs, a: m * (1 - hs) });
  }
  const waves: Waves = { title: 'De combien ça finit', bins, legend: [`Victoire ${names[0]}`, `Victoire ${names[1]}`], say: `Le plus probable : les ${names[o.margin.mean >= 0 ? 0 : 1]} de ${Math.max(1, Math.round(Math.abs(o.margin.mean)))} points. Total attendu : ${Math.round(o.total.mean)} points.` };
  const step = r > 24 ? 2 : 1, xs = [st.elapsed];
  for (let m = (Math.floor(st.elapsed / step) + 1) * step; m <= 48; m += step) xs.push(m);
  if (xs[xs.length - 1] !== 48) xs.push(48);
  const { lines, wins } = quota(pick.p, (k) => {
    let d = D; const v = [pick.p];
    for (let i = 1; i < xs.length; i++) {
      const dt = xs[i] - xs[i - 1];
      d += rate * dt + sd1 * Math.sqrt(dt) * gauss(seed, k, Math.round(xs[i] * 10));
      v.push(xs[i] >= 48 ? (nbaFinal(pick.key, Math.round(d) || (d >= 0 ? 1 : -1)) ? 1 : 0) : nbaVal(pick.key, nbaNow(e.pre, at(xs[i], d))));
    }
    return { v, win: v[v.length - 1] > 0.5 };
  });
  const ticks = [{ x: st.elapsed, s: 'Maintenant' }, ...[12, 24, 36, 48].filter((q) => q > st.elapsed + 3).map((q) => ({ x: q, s: q === 48 ? 'Fin' : q === 24 ? 'Mi-temps' : `Q${q / 12 + 1}` }))];
  const trail = D === 0 ? undefined : D < 0 ? 0 : 1;
  return {
    key, pick, change, stab: stabOf(change), signal, scen, horizon: `dans les ${wm}`, fan: { xs, lines, wins, ticks }, waves,
    why: risk ? `Une série ${risk.label.replace(/^Série /, '').replace(/ \(.*/, '')} le ferait changer (${pct0(risk.chance)} de chances dans les ${wm}).` : `Même une série de ${R} points ne le fait pas changer.`,
    comeback: trail != null ? { side: trail as 0 | 1, p: o.win[trail], label: `Les ${names[trail]} renversent le match` } : undefined,
  };
}

// ——— Tennis ———
type TenE = Extract<Eng, { sport: 'tennis' }>;
const baseMemo = new Map<string, [number, number]>(), tenMemo = new Map<string, ReturnType<typeof tennisNow>>();
const baseOf = (e: TenE) => { const k = `${e.p0.toFixed(3)},${e.surface},${e.st.bestOf}`; let b = baseMemo.get(k); if (!b) { b = calibrateTennis(TENNIS, e.p0, e.surface, e.st.bestOf); baseMemo.set(k, b); } return b; };
const stKey = (s: TennisState) => `${s.sets.map((x) => x.join('-')).join(' ')}|${s.games?.join('-') ?? ''}|${s.points?.join('-') ?? ''}|${s.server ?? ''}`;
function ten(e: TenE, st: TennisState) {
  const k = `${e.p0.toFixed(3)},${e.surface},${stKey(st)}`;
  let v = tenMemo.get(k);
  if (!v) { v = tennisNow(e.p0, e.surface, st, baseOf(e)); if (tenMemo.size > 800) tenMemo.clear(); tenMemo.set(k, v); }
  return v;
}
const setsWon = (s: TennisState): [number, number] => [s.sets.filter((x) => x[0] > x[1]).length, s.sets.filter((x) => x[1] > x[0]).length];
const over = (s: TennisState) => { const w = setsWon(s), need = (s.bestOf + 1) / 2; return w[0] >= need ? 0 : w[1] >= need ? 1 : undefined; };
/** Un jeu de plus, gagné par `w` : le set se ferme s'il le faut, le service change. */
function plusGame(s: TennisState, w: 0 | 1): TennisState {
  const g: [number, number] = [...(s.games ?? [0, 0])] as [number, number];
  g[w]++;
  const done = (g[w] >= 6 && g[w] - g[1 - w] >= 2) || g[w] === 7;
  return { ...s, sets: done ? [...s.sets, g] : s.sets, games: done ? [0, 0] : g, points: undefined, server: s.server == null ? undefined : ((1 - s.server) as 0 | 1) };
}
/** Chance de A de gagner le match depuis un début de jeu, avec les services de base (rapide : sert aux fins tirées au sort). */
function chain(b: [number, number], s: TennisState): number {
  const end = over(s);
  if (end != null) return end === 0 ? 1 : 0;
  const [wa, wb] = setsWon(s), need = (s.bestOf + 1) / 2, g = s.games ?? [0, 0], aSrv = (s.server ?? 0) === 0;
  const cur = setFrom(b[0], b[1], g[0], g[1], aSrv, 7), s0 = (setFrom(b[0], b[1], 0, 0, true, 7) + setFrom(b[0], b[1], 0, 0, false, 7)) / 2;
  const m = (x: number, y: number): number => (x >= need ? 1 : y >= need ? 0 : s0 * m(x + 1, y) + (1 - s0) * m(x, y + 1));
  return cur * m(wa + 1, wb) + (1 - cur) * m(wa, wb + 1);
}
function tennisPick(win: [number, number], names: [string, string]): Pick {
  const side: 0 | 1 = win[0] >= win[1] ? 0 : 1, w = win[side];
  return { key: `W${side}`, label: `${names[side]} gagne`, side, p: w, tier: tierOf('tennis', w), fair: 1 / Math.max(0.01, w) };
}
function tennisAhead(e: TenE, names: [string, string], seed: number): Ahead {
  const st = e.st, b = baseOf(e), o = ten(e, st), pick = tennisPick(o.win, names), key = `t${stKey(st)}`;
  if (e.ended || over(st) != null) return { key, pick: { ...pick, tier: 'done' }, change: 0, stab: 'solide', why: 'Match terminé.', signal: { kind: 'none', title: 'Match terminé', text: '' }, scen: [], horizon: '' };
  const g = st.games ?? [0, 0], srv = st.server, tb = g[0] === 6 && g[1] === 6;
  const row = (label: string, chance: number, s2: TennisState): Scen => {
    const end = over(s2), w: [number, number] = end != null ? (end === 0 ? [1, 0] : [0, 1]) : ten(e, s2).win, np = tennisPick(w, names), p = w[pick.side];
    return { label, chance, p, to: np.key !== pick.key ? `${np.label} (${pct0(np.p)})` : np.tier !== pick.tier && np.tier === 'flip' ? 'pile ou face' : undefined, tone: p > pick.p + 0.02 ? 'up' : p < pick.p - 0.02 ? 'down' : 'flat' };
  };
  const scen: Scen[] = [];
  let hold: number | undefined, usualBreak: number | undefined;
  if (srv != null) {
    const ret = (1 - srv) as 0 | 1;
    hold = tb ? (srv === 0 ? tbFrom(b[0], b[1], 7, st.points?.[0] ?? 0, st.points?.[1] ?? 0, true) : 1 - tbFrom(b[0], b[1], 7, st.points?.[0] ?? 0, st.points?.[1] ?? 0, false)) : (o.holdNow ?? holdFrom(b[srv]));
    usualBreak = 1 - holdFrom(b[srv]);
    scen.push(row(tb ? `${names[srv]} gagne le jeu décisif` : `${names[srv]} garde son service`, hold, plusGame(st, srv)), row(tb ? `${names[ret]} gagne le jeu décisif` : `Break ${de(names[ret])}`, 1 - hold, plusGame(st, ret)));
  }
  if (o.setNow != null) {
    const other = (1 - pick.side) as 0 | 1, sc: [number, number] = other === 0 ? [6, 4] : [4, 6];
    scen.push(row(`${names[other]} prend ce set`, other === 0 ? o.setNow : 1 - o.setNow, { ...st, sets: [...st.sets, sc], games: [0, 0], points: undefined }));
  }
  const bad = scen.filter((s) => s.to && s.tone === 'down'), game = bad.filter((s) => scen.indexOf(s) < (srv != null ? 2 : 0));
  const change = clamp(game.length ? game.reduce((x, s) => x + s.chance, 0) : (bad[0]?.chance ?? 0), 0, 0.99), risk = bad.sort((x, y) => y.chance - x.chance)[0];
  // Annonce : le break sur le jeu en cours, comparé à l'habitude sur ce service.
  const pb = hold != null ? 1 - hold : undefined, ret = srv != null ? ((1 - srv) as 0 | 1) : undefined;
  const signal: Signal = pb != null && usualBreak != null && ret != null && !tb && pb >= usualBreak * 1.5 && pb >= 0.25
    ? { kind: 'break', side: ret, p: pb, usual: usualBreak, title: `Break en vue pour ${names[ret]}`, text: `Sur ce jeu, ${names[ret]} prend le service ${de(names[srv!])} ${Math.round(pb * 100)} fois sur 100. D'habitude sur ce service : ${Math.round(usualBreak * 100)} fois sur 100.` }
    : { kind: 'none', p: pb, usual: usualBreak, title: 'Rien d’anormal en vue', text: pb != null && srv != null ? `${names[srv]} sert : break ${Math.round(pb * 100)} fois sur 100 sur ce jeu, dans ses habitudes.` : 'Le service n’est pas donné par la source : pas d’annonce de break sur ce match.' };
  // Quand tombe le prochain break : jeu par jeu, avec les services de base.
  let waves: Waves | undefined;
  if (srv != null && !tb) {
    const bins: Waves['bins'] = []; let S = 1, s: 0 | 1 = srv, gg: [number, number] = [g[0], g[1]];
    for (let i = 0; i < 8 && !(gg[0] === 6 && gg[1] === 6) && !((gg[0] >= 6 || gg[1] >= 6) && Math.abs(gg[0] - gg[1]) >= 2); i++) {
      const hp = i === 0 ? hold! : holdFrom(b[s]), m = S * (1 - hp);
      bins.push({ s: i === 0 ? 'Ce jeu' : `+${i}`, h: s === 1 ? m : 0, a: s === 0 ? m : 0 });
      S *= hp; gg[s]++; s = (1 - s) as 0 | 1;
    }
    waves = { title: 'Quand tombe le prochain break', bins, none: { s: 'Pas de break', v: S }, legend: [`Break ${de(names[0])}`, `Break ${de(names[1])}`], say: `Pas de break d'ici la fin de ces jeux dans ${Math.round(S * 100)} fins sur 100.` };
  }
  // Les fins possibles : jeu par jeu jusqu'à la balle de match.
  const start: TennisState = { ...st, points: undefined, server: srv ?? 0 }, c0 = chain(b, start), shift = logit(o.win[0]) - logit(c0), G = 34;
  const vOf = (s: TennisState) => { const end = over(s); const pa = end != null ? (end === 0 ? 1 : 0) : sig(logit(chain(b, s)) + shift); return pick.side === 0 ? pa : 1 - pa; };
  const { lines, wins } = quota(pick.p, (k) => {
    let s = start; const v = [pick.p], base = st.sets.reduce((x, y) => x + y[0] + y[1], 0) + g[0] + g[1];
    for (let i = 1; i <= G; i++) {
      if (over(s) == null) {
        const sv = (s.server ?? 0) as 0 | 1, gs = s.games ?? [0, 0], isTb = gs[0] === 6 && gs[1] === 6;
        const pA = isTb ? tbFrom(b[0], b[1], 7, 0, 0, sv === 0) : sv === 0 ? (i === 1 && hold != null && srv === 0 ? hold : holdFrom(b[0])) : 1 - (i === 1 && hold != null && srv === 1 ? hold : holdFrom(b[1]));
        s = plusGame(s, hash(seed, k, base + i) < pA ? 0 : 1);
      }
      v.push(vOf(s));
    }
    return { v, win: v[v.length - 1] > 0.5 };
  });
  let last = 4;
  for (const l of lines) for (let i = l.v.length - 1; i > last; i--) if (l.v[i] !== l.v[i - 1]) { last = Math.max(last, i); break; }
  const n = Math.min(G, last + 1), xs = Array.from({ length: n + 1 }, (_, i) => i);
  const fan: Fan = { xs, lines: lines.map((l) => ({ win: l.win, v: l.v.slice(0, n + 1) })), wins, ticks: [{ x: 0, s: 'Maintenant' }, ...[5, 10, 15, 20, 25, 30].filter((x) => x <= n - 1).map((x) => ({ x, s: `+${x} jeux` }))] };
  return {
    key, pick, change, stab: stabOf(change), signal, scen, horizon: srv != null ? 'sur ce jeu' : 'sur ce set', fan, waves,
    why: risk ? `Le risque : ${risk.label.charAt(0).toLowerCase()}${risk.label.slice(1)} (${pct0(risk.chance)} de chances). Le prono ${risk.to === 'pile ou face' ? 'passerait en pile ou face' : 'changerait'}.`.replace('le risque : break', 'Le risque : un break').replace(/^Le risque : ([a-z])/, (_, c: string) => `Le risque : ${c.toUpperCase()}`).replace('Le risque : Un break', 'Le risque : un break') : 'Ni un break ni la perte du set ne le font changer.',
    comeback: o.comeback ? { side: o.comeback.side, p: o.comeback.win, label: `${names[o.comeback.side]} renverse le match` } : undefined,
  };
}

// ——— Entrée unique, gardée en mémoire tant que l'état du match ne change pas ———
const memo = new Map<string, Ahead>();
export function ahead(id: string, e: Eng, names: [string, string]): Ahead {
  const k = `${id}|${e.sport === 'foot' ? `${e.minute},${e.score},${e.reds},${e.ended}` : e.sport === 'nba' ? `${e.st.elapsed.toFixed(1)},${e.st.score},${e.ended}` : `${stKey(e.st)},${e.ended}`}`;
  let v = memo.get(k);
  if (!v) {
    const seed = seedOf(id);
    v = e.sport === 'foot' ? footAhead(e, names, seed) : e.sport === 'nba' ? nbaAhead(e, names, seed) : tennisAhead(e, names, seed);
    if (memo.size > 400) memo.clear();
    memo.set(k, v);
  }
  return v;
}
export const TIER: Record<Tier, { label: string; tone: 'sure' | 'ok' | 'risky' | 'flip' }> = {
  sure: { label: 'Razzia assuré', tone: 'sure' }, safe: { label: 'Plus sûr', tone: 'sure' }, ok: { label: 'Solide', tone: 'ok' }, risky: { label: 'Risqué', tone: 'risky' }, flip: { label: 'Pile ou face', tone: 'flip' }, done: { label: 'Terminé', tone: 'ok' },
};
export const STAB: Record<Ahead['stab'], string> = { solide: 'Solide', surveiller: 'À surveiller', fragile: 'Fragile' };
