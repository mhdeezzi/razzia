// Déroulé chronologique : pour chaque match, ce que le moteur savait juste avant (forces recalculées chaque semaine sur
// les seuls matchs passés, composition alignée, forme récente, repos, coach, face-à-face), et ce qui s'est passé.
// Sert à l'apprentissage des réglages et au contrôle de justesse, sans jamais regarder le futur.
import type { Game } from './data.ts';
import { DEFAULT_RATING, expectedGoals, fitRatings, type RatingParams, type Ratings } from './ratings.ts';

export interface Feat {
  lr: number; // log(valeur du onze aligné / valeur habituelle du onze)
  mom: number; // forme : écart xG moyen des 6 derniers matchs par rapport à l'attendu
  momN: number;
  coach: number; // 1 si le coach est là depuis moins de 8 matchs
  rest: number; // jours de repos (plafonnés 2..10)
  euro: number; // 1 si l'équipe a joué une coupe d'Europe dans les 4 jours avant
  la: number; // log(apport offensif du onze aligné (xG+xA par 90 des titulaires) / apport habituel)
  gk: number; // buts évités par 90 du gardien titulaire (a priori 0) moins ceux du gardien habituel
}
export interface Style { spFor: number; spAg: number; press: number; buildUp: number; n: number }
export interface WalkRow {
  st: [Style, Style]; spAvg: number; pressAvg: number; buAvg: number;
  g: Game; base: [number, number]; fh: Feat; fa: Feat; h2h: number; h2hN: number; conf: [number, number];
  shotQ: [number[], number[]]; red: [number, number];
}

const CUPS = new Set([42, 73]);
const mvXI = (side: Game['sides'][number] | undefined) => (side?.starters ?? []).reduce((s, p) => s + (p[3] || 0), 0);

export function walk(games: Game[], from: string, p: RatingParams = DEFAULT_RATING, onlyLeagues?: Set<number>): WalkRow[] {
  const out: WalkRow[] = [];
  const last = new Map<number, string>(), lastCup = new Map<number, string>();
  const xiAvg = new Map<number, number>();
  const res = new Map<number, number[]>();
  const coach = new Map<number, { id: number; n: number }>();
  const shots = new Map<number, number[]>();
  const reds = new Map<number, [number, number]>();
  const h2h = new Map<string, number[]>();
  // Styles de jeu (moyennes avec oubli, remis à zéro en partie à l'arrivée d'un nouveau coach) : xG sur coups de pied
  // arrêtés pour et contre, pressing (actions défensives pour 100 passes adverses), relance courte (part de passes dans
  // son propre camp).
  const style = new Map<number, Style>();
  let spSum = 0, spN = 0, prSum = 0, buSum = 0;
  // Joueurs : minutes et xG+xA cumulés avec oubli progressif ; gardiens : buts évités.
  // Oubli dans le temps (demi-vie d'un an), appliqué à chaque lecture/mise à jour d'un joueur.
  const pl = new Map<number, { min: number; xgxa: number; gp: number; gmin: number; t: number }>();
  let now = 0;
  const age = (p: { min: number; xgxa: number; gp: number; gmin: number; t: number }) => {
    const f = Math.pow(0.5, (now - p.t) / (365 * 864e5));
    if (f < 1) { p.min *= f; p.xgxa *= f; p.gp *= f; p.gmin *= f; p.t = now; }
    return p;
  };
  const laAvg = new Map<number, number>(), gkAvg = new Map<number, number>();
  const per90 = (id: number) => { const p0 = pl.get(id); const p = p0 && age(p0); return p ? (p.xgxa + 0.15 * 270 / 90) / ((p.min + 270) / 90) : 0.15; }; // a priori 0,15 sur 3 matchs
  const gkv = (id: number) => { const p0 = pl.get(id); const p = p0 && age(p0); return p && p.gmin ? p.gp / ((p.gmin + 900) / 90) : 0; }; // a priori 0 sur 10 matchs
  const xiAtt = (side: Game['sides'][number] | undefined) => (side?.starters ?? []).filter((x) => x[2] !== 11).reduce((s2, x) => s2 + per90(x[0]), 0);
  const xiGk = (side: Game['sides'][number] | undefined) => { const k = (side?.starters ?? []).find((x) => x[2] === 11); return k ? gkv(k[0]) : 0; };
  let R: Ratings | undefined;
  let fitDay = '';
  const week = (d: string) => { const t = Date.parse(d.slice(0, 10)); const day = new Date(t).getUTCDay(); return new Date(t - ((day + 6) % 7) * 864e5).toISOString().slice(0, 10); };
  for (let k = 0; k < games.length; k++) {
    const g = games[k];
    const day = g.date.slice(0, 10);
    now = Date.parse(g.date);
    if (day >= from) {
      // Forces recalculées une fois par semaine (le lundi), sur les matchs d'avant.
      const wk = week(day);
      if (wk !== fitDay) { R = fitRatings(games, `${wk}T00:00:00Z`, p, R); fitDay = wk; }
    }
    const feat = (id: number, side: 0 | 1): Feat => {
      const avg = xiAvg.get(id), now = mvXI(g.sides[side]);
      const lr = avg && now > 0 && (g.sides[side]?.starters.length ?? 0) >= 11 ? Math.max(-1, Math.min(1, Math.log(now / avg))) : 0;
      const r = res.get(id) ?? [];
      const c = coach.get(id);
      const prev = last.get(id), prevCup = lastCup.get(id);
      const rest = prev ? Math.max(2, Math.min(10, (Date.parse(g.date) - Date.parse(prev)) / 864e5)) : 7;
      const euro = prevCup && (Date.parse(g.date) - Date.parse(prevCup)) / 864e5 <= 4 ? 1 : 0;
      const full = (g.sides[side]?.starters.length ?? 0) >= 11;
      const la = full && laAvg.get(id) ? Math.max(-1, Math.min(1, Math.log(Math.max(0.05, xiAtt(g.sides[side])) / laAvg.get(id)!))) : 0;
      const gk = full && gkAvg.has(id) ? xiGk(g.sides[side]) - gkAvg.get(id)! : 0;
      return { lr, mom: r.length ? r.reduce((s, x) => s + x, 0) / r.length : 0, momN: r.length, coach: c && c.n < 8 ? 1 : 0, rest, euro, la, gk };
    };
    if (R && day >= from && (!onlyLeagues || onlyLeagues.has(g.lg))) {
      const neutral = CUPS.has(g.lg) && /final/i.test(String(g.round ?? '')) && !/semi|quarter|1\/|8/i.test(String(g.round ?? ''));
      const base = expectedGoals(R, g.lg, g.home.id, g.away.id, p.newcomer, neutral);
      const key = [g.home.id, g.away.id].sort((a, b) => a - b).join('|');
      const hh = (h2h.get(key) ?? []).slice(-4);
      const sign = g.home.id < g.away.id ? 1 : -1;
      const sty = (id: number): Style => style.get(id) ?? { spFor: spN ? spSum / spN : 0.3, spAg: spN ? spSum / spN : 0.3, press: 0, buildUp: 0, n: 0 };
      out.push({
        st: [sty(g.home.id), sty(g.away.id)], spAvg: spN ? spSum / spN : 0.3, pressAvg: spN ? prSum / spN : 8.7, buAvg: spN ? buSum / spN : 0.42,
        g, base, fh: feat(g.home.id, 0), fa: feat(g.away.id, 1),
        h2h: hh.length ? (sign * hh.reduce((s, x) => s + x, 0)) / hh.length : 0, h2hN: hh.length,
        conf: [R.weight.get(g.home.id) ?? 0, R.weight.get(g.away.id) ?? 0],
        shotQ: [(shots.get(g.home.id) ?? []).slice(-300), (shots.get(g.away.id) ?? []).slice(-300)],
        red: [(reds.get(g.home.id)?.[0] ?? 0.1) / (reds.get(g.home.id)?.[1] ?? 1), (reds.get(g.away.id)?.[0] ?? 0.1) / (reds.get(g.away.id)?.[1] ?? 1)],
      });
    }
    // Mise à jour de l'historique après le match.
    const exp = R ? expectedGoals(R, g.lg, g.home.id, g.away.id, p.newcomer) : undefined;
    for (const side of [0, 1] as const) {
      const id = side ? g.away.id : g.home.id;
      last.set(id, g.date);
      if (CUPS.has(g.lg)) lastCup.set(id, g.date);
      const v = mvXI(g.sides[side]);
      if (v > 0 && (g.sides[side]?.starters.length ?? 0) >= 11) xiAvg.set(id, xiAvg.has(id) ? 0.85 * xiAvg.get(id)! + 0.15 * v : v);
      if (exp && g.xg) {
        const r = res.get(id) ?? [];
        const dAct = side ? g.xg[1] - g.xg[0] : g.xg[0] - g.xg[1], dExp = side ? exp[1] - exp[0] : exp[0] - exp[1];
        r.push(dAct - dExp);
        res.set(id, r.slice(-6));
      }
      const cid = g.sides[side]?.coach?.id;
      if (cid) { const c = coach.get(id); coach.set(id, c && c.id === cid ? { id: cid, n: c.n + 1 } : { id: cid, n: c ? 0 : 99 }); }
      if ((g.sides[side]?.starters.length ?? 0) >= 11) {
        const a = xiAtt(g.sides[side]), k2 = xiGk(g.sides[side]);
        laAvg.set(id, laAvg.has(id) ? 0.85 * laAvg.get(id)! + 0.15 * a : a);
        gkAvg.set(id, gkAvg.has(id) ? 0.85 * gkAvg.get(id)! + 0.15 * k2 : k2);
      }
      const S = g.stats;
      if (S.xgsp && S.passes && S.tackles && S.inter && S.ownh) {
        const o = 1 - side;
        const x = { spFor: S.xgsp[side], spAg: S.xgsp[o], press: (100 * (S.tackles[side] + S.inter[side] + (S.fouls?.[side] ?? 0))) / Math.max(50, S.passes[o]), buildUp: S.ownh[side] / Math.max(50, S.passes[side]) };
        const cur = style.get(id);
        const newCoach = coach.get(id)?.n === 0;
        const a = cur ? (newCoach ? 0.3 : 0.1) : 1;
        style.set(id, cur ? { spFor: cur.spFor + a * (x.spFor - cur.spFor), spAg: cur.spAg + a * (x.spAg - cur.spAg), press: cur.press + a * (x.press - cur.press), buildUp: cur.buildUp + a * (x.buildUp - cur.buildUp), n: cur.n + 1 } : { ...x, n: 1 });
        spSum += x.spFor; prSum += x.press; buSum += x.buildUp; spN++;
      }
      const sq = shots.get(id) ?? [];
      for (const s of g.shots) if (s[0] === side && s[6] !== 8) sq.push(s[5]);
      shots.set(id, sq.slice(-400));
      const rd = reds.get(id) ?? [0.1, 1];
      const nRed = g.events.filter((e) => e[0] === 'R' && e[2] === side).length;
      reds.set(id, [rd[0] * 0.98 + nRed, rd[1] * 0.98 + 1]);
    }
    for (const [pid, v] of Object.entries(g.players)) {
      const p = age(pl.get(Number(pid)) ?? { min: 0, xgxa: 0, gp: 0, gmin: 0, t: now });
      p.min += v[1]; p.xgxa += v[2] + v[3];
      if (v[11] > 0 || v[12] !== 0) { p.gp += v[12]; p.gmin += v[1]; }
      pl.set(Number(pid), p);
    }
    if (exp) {
      const key = [g.home.id, g.away.id].sort((a, b) => a - b).join('|');
      const sign = g.home.id < g.away.id ? 1 : -1;
      const arr = h2h.get(key) ?? [];
      arr.push(sign * ((g.score[0] - g.score[1]) - (exp[0] - exp[1])));
      h2h.set(key, arr.slice(-6));
    }
  }
  return out;
}
