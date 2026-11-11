// Direct réel : lit /api/live (moteur live + FotMob et ESPN, au départ des pronostics d'avant-match Razzia) et met
// chaque match en cours dans la forme que les pages du direct savent afficher (la même que livedemo.ts). Sans match en
// cours, ou si l'API ne répond pas, les pages retombent sur l'aperçu fictif et le disent.
//   Liste : relue toutes les 10 s tant qu'une page du direct est ouverte. Fiche : relue toutes les 5 s.
// Les probabilités viennent toutes du moteur (côté serveur) ; ce fichier ne calcule rien, il range et garde
// l'historique vu depuis l'ouverture (courbe du tennis, sets gagnés) le temps de la session.
import { useEffect, useState } from 'react';
import { n1, pct0, teamColor, teamLogo } from './data.ts';
import { TEAMS } from '../../src/nba/teams.ts';
import type { Demo, Ev, Frame, Gauge, P3, PickState, Pt, Row, Side, Sport } from './livedemo.ts';

// ——— Réponses de /api/live (champs lus ici seulement) ———
type Pair = [number, number];
interface FootItem { id: number; league: string; home: string; away: string; homeId: number; awayId: number; score: Pair; minute: number; clock: string; reds: Pair; state: 'live' | 'ht' | 'post' | 'pre'; pre: string; p0?: P3; p1x2: P3 }
interface FootOne {
  id: number; league: string; home: { id: number; name: string }; away: { id: number; name: string }; state: FootItem['state']; clock: string;
  timeline: { minute: number; goals: Array<[number, 0 | 1]>; reds: Array<[number, 0 | 1]> };
  stats: Record<string, Pair>; momentum: Array<[number, number]>; xg: Pair; pre: string;
  path?: Array<[number, number, number, number]>; start?: { p1x2: P3; top?: string; goals: number };
  engine: { minute: number; score: Pair; p1x2: P3; remaining: Pair; pressure: Pair; luck: Pair; topScores: Array<{ s: string; p: number }> };
}
interface NbaItem { id: string; home: string; away: string; score: Pair; period: number; clock: string; pre: string; p0?: Pair; win?: Pair; error?: boolean }
interface NbaOne {
  id: string; home: string; away: string; state: 'pre' | 'in' | 'post'; period: number; clock: string;
  st: { elapsed: number; score: Pair; fg3: [Pair, Pair]; fouls?: Pair };
  pre: { spread: number; total: number; src: string }; p0?: Pair; path?: Array<[number, number]>;
  plays: Array<{ t: number; text: string; score: Pair; scoring: boolean }>;
  engine: { win: Pair; margin: { mean: number }; total: { mean: number }; comeback?: { side: 0 | 1; win: number }; factors: { luck: number } };
}
interface TennisItem {
  id: string; tourney: string; round: string; state: 'pre' | 'in' | 'post'; players: [string, string];
  st: { bestOf: 3 | 5; sets: Pair[]; games?: Pair; points?: Pair; server?: 0 | 1 };
  pre: { p0: number; surface: string; src: string };
  engine: { win: Pair; comeback?: { side: 0 | 1; win: number }; setNow?: number };
}
interface LiveList { at: string; foot: FootItem[] | { error: string }; nba: NbaItem[] | { error: string }; tennis: TennisItem[] | { error: string } }

// ——— Petits outils ———
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const arr = <T,>(x: T[] | { error: string } | undefined): T[] => (Array.isArray(x) ? x : []);
// Couleur d'un camp sans couleur connue : une teinte de la palette, toujours la même pour un nom (format hexadécimal, lu par glow).
const PAL = ['#e0453a', '#2f7fe0', '#f5c23d', '#27b36b', '#9b5de5', '#f07b2a', '#18a7b5', '#d6337a', '#7a8c2e', '#5b6bf0'];
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAL[h % PAL.length]; };
// Noms courts et couleurs des clubs les plus suivis ; les autres : préfixes retirés (FC, AS…).
const CLUBS: Record<string, [string, string?]> = {
  'Olympique Lyonnais': ['Lyon', '#1d3f8f'], 'Olympique de Marseille': ['Marseille', '#2aa7df'], 'Paris Saint-Germain': ['PSG', '#1b2f63'], 'AS Monaco': ['Monaco', '#e2231a'],
  'RC Lens': ['Lens', '#f7d417'], 'LOSC Lille': ['Lille', '#d3122a'], Lille: ['Lille', '#d3122a'], 'OGC Nice': ['Nice', '#c8102e'], 'Stade Rennais': ['Rennes', '#e0202a'],
  'Stade Brestois 29': ['Brest', '#e1001a'], 'RC Strasbourg Alsace': ['Strasbourg', '#0072ce'], 'FC Nantes': ['Nantes', '#fcd405'], 'Toulouse FC': ['Toulouse', '#5b2b82'],
  'Manchester City': ['Man City', '#6cabdd'], 'Manchester United': ['Man United', '#da291c'], 'Real Madrid': ['Real Madrid', '#febe10'], 'FC Barcelona': ['Barcelone', '#a50044'],
  'Atletico Madrid': ['Atlético', '#cb3524'], 'Bayern München': ['Bayern', '#dc052d'], 'Borussia Dortmund': ['Dortmund', '#fde100'], 'Internazionale': ['Inter', '#0068a8'], 'Inter': ['Inter', '#0068a8'],
  'AC Milan': ['Milan', '#fb090b'], Juventus: ['Juventus', '#d8d8d8'], Liverpool: ['Liverpool', '#c8102e'], Arsenal: ['Arsenal', '#ef0107'], Chelsea: ['Chelsea', '#034694'], 'Tottenham Hotspur': ['Tottenham', '#e8e8e8'],
};
const short = (n: string) => CLUBS[n]?.[0] ?? (n.replace(/^(FC|AS|SC|RC|AC|OGC|SS|SSC|US|CF|CD|UD|SD|RCD|Club)\s+/i, '').replace(/\s+(FC|CF|AFC|SC)$/i, '').replace(/^Olympique (de |d')?/i, '').trim() || n);
const clubColor = (n: string) => CLUBS[n]?.[1] ?? hue(n);
const tri = (n: string) => short(n).replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase();
const lastName = (n: string) => n.split(' ').slice(-1)[0] ?? n;
const adv = (p: P3) => p[0] + p[1] / 2;
const pickState = (pp: number, pre: number, ended: boolean): PickState => (ended ? (pp >= 0.5 ? 'won' : 'lost') : pp >= 0.999 ? 'won' : pp <= 0.001 ? 'lost' : pp >= 0.85 ? 'safe' : pp >= Math.min(0.5, pre - 0.12) ? 'ok' : pp >= 0.3 ? 'warn' : 'bad');
const row = (k: string, pre: number | string, now: number | string, f: (v: number) => string = pct0): Row => ({ k, pre: typeof pre === 'number' ? f(pre) : pre, now: typeof now === 'number' ? f(now) : now, d: typeof pre === 'number' && typeof now === 'number' ? now - pre : 0 });
/** Pari Razzia du direct : la victoire du favori d'avant-match, ou « favori ou nul » sous 60 % au foot (vainqueur déconseillé). */
function pickOf(sport: Sport, p0: P3, home: Side, away: Side) {
  const fav = p0[0] >= p0[2] ? 0 : 2, who = fav === 0 ? home : away;
  const dc = sport === 'foot' && p0[fav] < 0.6;
  const of = (p: P3) => (dc ? p[fav] + p[1] : p[fav]);
  return { label: dc ? `${who.short} ou nul` : `Victoire ${who.short}`, of, pre: of(p0) };
}
/** Pression en 96 tranches (de -1 à 1, positif : domicile), à partir de points [instant, valeur]. */
function bins(pts: Array<[number, number]>, len: number): number[] {
  const out = Array.from({ length: 96 }, () => 0), n = Array.from({ length: 96 }, () => 0);
  for (const [t, v] of pts) { const i = clamp(Math.floor((t / len) * 96), 0, 95); out[i] += v; n[i]++; }
  const avg = out.map((v, i) => (n[i] ? v / n[i] : 0)), max = Math.max(1e-6, ...avg.map(Math.abs));
  return avg.map((v) => clamp(v / max, -1, 1));
}

// ——— Mémoire de la session : ce que l'on a vu depuis l'ouverture (courbe, sets gagnés) ———
interface Seen { pts: Pt[]; sets: number; evs: Ev[] }
const seen = new Map<string, Seen>();
const STORE = 'live:seen';
try { for (const [k, v] of Object.entries(JSON.parse(sessionStorage.getItem(STORE) ?? '{}') as Record<string, Seen>)) seen.set(k, v); } catch { /* stockage indisponible */ }
const keep = () => { try { sessionStorage.setItem(STORE, JSON.stringify(Object.fromEntries([...seen].slice(-40)))); } catch { /* idem */ } };
function remember(id: string, t: number, a: number): Seen {
  const s = seen.get(id) ?? { pts: [], sets: 0, evs: [] };
  const last = s.pts[s.pts.length - 1];
  if (!last || t > last.t + 1e-3) s.pts.push({ t, adv: a }); else last.adv = a;
  seen.set(id, s);
  return s;
}

// ——— Un match réel dans la forme d'un match de l'aperçu ———
interface Snap {
  id: string; sport: Sport; league: string; where: string; home: Side; away: Side; len: number; pace: number;
  t: number; ended: boolean; clock: string; phase: string; score: Pair; p: P3; p0: P3;
  events: Ev[]; series: Pt[]; marks: Demo['marks']; axis: string[]; mom: number[]; ghostScore: string;
  rows: Row[]; gauges: Frame['gauges']; gaugeKeys: Gauge[]; tennis?: Frame['tennis']; src: string; detail: boolean;
}
function toDemo(s: Snap): Demo {
  const pick = pickOf(s.sport, s.p0, s.home, s.away);
  const a0 = adv(s.p0);
  const series = s.series.length ? s.series : [{ t: 0, adv: a0 }, { t: s.t, adv: adv(s.p) }];
  const events = [...s.events].sort((x, y) => x.t - y.t).map((e) => ({ ...e, impact: e.big ? impactAt(series, e.t) : 0 }));
  const frame = (t: number): Frame => {
    const nEv = events.filter((e) => e.t <= t).length;
    const pp = pick.of(s.p);
    return {
      t: s.t, progress: clamp(s.t / s.len), ended: s.ended, clock: s.ended ? 'Terminé' : s.clock, phase: s.phase, score: s.score, p: s.p, adv: adv(s.p),
      nEv, last: events[nEv - 1], tennis: s.tennis, pick: { p: pp, state: pickState(pp, pick.pre, s.ended) }, rows: s.rows, gauges: s.gauges,
    };
  };
  return {
    id: s.id, sport: s.sport, league: s.league, where: s.where, home: s.home, away: s.away, len: s.len, pace: s.pace, phase0: 0,
    events, marks: s.marks, axis: s.axis, series, ghost: [{ t: 0, adv: a0 }, { t: s.len, adv: a0 }], ghostScore: s.ghostScore, mom: s.mom,
    pre: { p: s.p0, pick: pick.pre }, pick: { label: pick.label, odds: 1 / Math.max(0.01, pick.pre), fair: true },
    live: { t: s.t, ended: s.ended, src: s.src, detail: s.detail, at: Date.now() }, gaugeKeys: s.gaugeKeys,
    at: frame,
  };
}
function impactAt(series: Pt[], t: number) {
  let before = series[0]?.adv ?? 0.5, after = before;
  for (const p of series) { if (p.t < t) before = p.adv; if (p.t >= t) { after = p.adv; break; } }
  return after - before;
}

// Football
function footSnap(L: FootItem | undefined, D: FootOne | undefined): Snap {
  const id = String(D?.id ?? L!.id), name = [D?.home.name ?? L!.home, D?.away.name ?? L!.away];
  const ids = [D?.home.id ?? L!.homeId, D?.away.id ?? L!.awayId];
  const side = (i: 0 | 1): Side => ({ name: name[i], short: short(name[i]), tri: tri(name[i]), color: clubColor(name[i]), logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${ids[i]}.png`, mark: `f${ids[i]}` });
  const home = side(0), away = side(1);
  const state = D?.state ?? L!.state, minute = D?.timeline.minute ?? L!.minute;
  const t = state === 'ht' ? 45.5 : minute, ended = state === 'post';
  const p = D?.engine.p1x2 ?? L!.p1x2, p0 = D?.start?.p1x2 ?? L?.p0 ?? p;
  const score = D?.engine.score ?? L!.score;
  // Buts et rouges dans l'ordre, avec le score au moment de l'action.
  const evs: Ev[] = [{ t: 0, kind: 'kick', title: "Coup d'envoi" }];
  if (D) {
    const acts = [...D.timeline.goals.map(([m, s]) => ({ m, s, k: 'goal' as const })), ...D.timeline.reds.map(([m, s]) => ({ m, s, k: 'red' as const }))].sort((x, y) => x.m - y.m);
    const sc: Pair = [0, 0];
    for (const a of acts) {
      if (a.k === 'goal') sc[a.s]++;
      const who = a.s === 0 ? home : away;
      evs.push(a.k === 'goal'
        ? { t: a.m, kind: 'goal', side: a.s, title: `But ${de(who.short)}`, big: true, word: 'But', at: `${a.m}'`, score: sc.join('-') }
        : { t: a.m, kind: 'red', side: a.s, title: `Carton rouge pour ${who.short}`, big: true, word: 'Rouge', at: `${a.m}'`, score: sc.join('-') });
    }
    if (minute > 45 || state === 'ht') evs.push({ t: 45.5, kind: 'pause', title: 'Mi-temps', at: 'Mi-temps', score: '' });
  }
  if (ended) evs.push({ t: 95, kind: 'end', title: 'Fin du match', at: 'Terminé', score: score.join('-') });
  const series = D?.path?.length ? D.path.map(([m, h, d, a]) => ({ t: m, adv: h + d / 2 })) : remember(`foot-${id}`, t, adv(p)).pts;
  if (!D?.path?.length && series[0]?.t !== 0) series.unshift({ t: 0, adv: adv(p0) });
  const total = score[0] + score[1] + (D ? D.engine.remaining[0] + D.engine.remaining[1] : 0);
  const trail = score[0] === score[1] ? undefined : score[0] < score[1] ? 0 : 1;
  const pr = D?.engine.pressure ?? [0, 0], ps = pr[0] + pr[1];
  return {
    id: `foot-${id}`, sport: 'foot', league: D?.league ?? L!.league, where: 'Score et actions FotMob', home, away, len: 95, pace: 1 / 60,
    t, ended, clock: state === 'ht' ? 'Mi-temps' : (D?.clock || L?.clock || `${minute}'`), phase: state === 'ht' ? 'Pause' : minute <= 45 ? '1re mi-temps' : '2e mi-temps',
    score, p, p0, events: evs, series, marks: [{ t: 45.5, label: 'Mi-temps' }], axis: ['1re mi-temps', '2e mi-temps'],
    mom: D?.momentum?.length ? bins(D.momentum, 95) : Array.from({ length: 96 }, () => 0),
    ghostScore: D?.start?.top ? `${D.start.top} le plus probable` : 'pronostic du coup d’envoi',
    rows: [
      row(`Victoire ${home.short}`, p0[0], p[0]), row('Match nul', p0[1], p[1]), row(`Victoire ${away.short}`, p0[2], p[2]),
      ...(D ? [row('Score final le plus probable', D.start?.top ?? '—', D.engine.topScores[0]?.s ?? '—'), row('Buts attendus au total', D.start?.goals ?? total, total, n1)] : []),
    ],
    gauges: {
      energy: [1, 1], fouls: D?.stats.fouls ?? [0, 0], rhythm: ps > 0 ? [pr[0] / ps, pr[1] / ps] : [0.5, 0.5],
      luck: D ? [clamp(D.engine.luck[0] / 1.5, -1, 1), clamp(D.engine.luck[1] / 1.5, -1, 1)] : [0, 0],
      comeback: trail != null && !ended ? { side: trail, p: trail === 0 ? p[0] + p[1] : p[2] + p[1] } : undefined,
    },
    gaugeKeys: D ? ['fouls', 'rhythm', 'luck', 'comeback'] : ['comeback'], src: 'FotMob', detail: !!D,
  };
}
const de = (n: string) => (/^[AEIOUYÉÈ]/i.test(n) ? `d'${n}` : `de ${n}`);

// NBA
const nbaSide = (t: string): Side => { const x = TEAMS.find((y) => y.tri === t); return { name: x ? `${x.city} ${x.name}` : t, short: x?.name ?? t, tri: t, color: teamColor({ tri: t }), logo: teamLogo(t), mark: t }; };
const QUARTS = ['1er quart-temps', '2e quart-temps', '3e quart-temps', '4e quart-temps'];
function nbaElapsed(period: number, clock: string) { const m = String(clock).match(/^(\d+):(\d+)/); const left = m ? Number(m[1]) + Number(m[2]) / 60 : Number(clock) / 60 || 0; return period <= 4 ? (period - 1) * 12 + (12 - left) : 48 + (period - 5) * 5 + (5 - left); }
function nbaSnap(L: NbaItem | undefined, D: NbaOne | undefined): Snap {
  const homeTri = D?.home ?? L!.home, awayTri = D?.away ?? L!.away, home = nbaSide(homeTri), away = nbaSide(awayTri);
  const period = D?.period ?? L!.period, clock = D?.clock ?? L!.clock;
  const t = D?.st.elapsed ?? nbaElapsed(period, clock), ended = D?.state === 'post';
  const w = D?.engine.win ?? L?.win ?? [0.5, 0.5], w0 = D?.p0 ?? L?.p0 ?? w;
  const p: P3 = [w[0], 0, w[1]], p0: P3 = [w0[0], 0, w0[1]];
  const score = D?.st.score ?? L!.score, len = Math.max(48, Math.ceil(t));
  const evs: Ev[] = [{ t: 0, kind: 'kick', title: 'Entre-deux' }];
  let lead = 0;
  if (D) {
    let prev: Pair = [0, 0];
    for (const pl of [...D.plays].reverse()) {
      if (pl.scoring) {
        const s: 0 | 1 = pl.score[0] > prev[0] ? 0 : 1, pts = pl.score[s] - prev[s], who = s === 0 ? home : away;
        const nl = Math.sign(pl.score[0] - pl.score[1]);
        if (nl !== 0 && nl !== lead && lead !== 0) evs.push({ t: pl.t, kind: 'run', side: s, title: `${who.short} repasse devant`, big: true, word: 'Devant', at: clockOf(pl.t), score: pl.score.join('-') });
        else if (pts === 3) evs.push({ t: pl.t, kind: 'three', side: s, title: `Panier à 3 points de ${who.short}`, at: clockOf(pl.t), score: pl.score.join('-') });
        if (nl !== 0) lead = nl;
        prev = pl.score;
      } else if (/end of|end period|fin/i.test(pl.text)) evs.push({ t: pl.t, kind: 'pause', title: 'Fin du quart-temps', at: clockOf(pl.t), score: pl.score.join('-') });
      else if (/timeout/i.test(pl.text)) evs.push({ t: pl.t, kind: 'timeout', title: 'Temps mort', at: clockOf(pl.t), score: pl.score.join('-') });
    }
  }
  if (ended) evs.push({ t: len, kind: 'end', title: 'Fin du match', at: 'Terminé', score: score.join('-') });
  const series = D?.path?.length ? D.path.map(([x, a]) => ({ t: x, adv: a })) : remember(`nba-${D?.id ?? L!.id}`, t, w[0]).pts;
  if (series[0]?.t !== 0) series.unshift({ t: 0, adv: w0[0] });
  const trail = score[0] === score[1] ? undefined : score[0] < score[1] ? 0 : 1;
  const f3 = D?.st.fg3 ?? [[0, 0], [0, 0]];
  const acc = (x: Pair) => (x[1] ? clamp((x[0] / x[1] - 0.3) / 0.3) : 0.5);
  const luck = D?.engine.factors.luck ?? 0;
  return {
    id: `nba-${D?.id ?? L!.id}`, sport: 'nba', league: 'NBA', where: 'Score et actions ESPN', home, away, len, pace: 1 / 150, t, ended,
    clock: period > 4 ? `Prol. ${clock}` : `Q${period} ${clock}`, phase: QUARTS[period - 1] ?? 'Prolongation', score, p, p0, events: evs, series,
    marks: [12, 24, 36].map((x, i) => ({ t: x, label: `Q${i + 2}` })), axis: QUARTS,
    mom: D ? bins(D.plays.filter((x) => x.scoring).map((x) => [x.t, x.score[0] - x.score[1]] as [number, number]), len) : Array.from({ length: 96 }, () => 0),
    ghostScore: `${home.tri} ${pct0(w0[0])}`,
    rows: [row(`Victoire ${home.short}`, p0[0], p[0]), row(`Victoire ${away.short}`, p0[2], p[2]), ...(D ? [row('Écart final attendu', D.pre.spread, D.engine.margin.mean, n1), row('Total de points attendu', D.pre.total, D.engine.total.mean, n1)] : [])],
    gauges: { energy: [1, 1], fouls: D?.st.fouls ?? [0, 0], rhythm: [acc(f3[0]), acc(f3[1])], luck: [clamp(luck / 8, -1, 1), clamp(-luck / 8, -1, 1)], comeback: trail != null && !ended ? { side: trail, p: trail === 0 ? p[0] : p[2] } : undefined },
    gaugeKeys: D ? ['fouls', 'rhythm', 'luck', 'comeback'] : ['comeback'], src: 'ESPN', detail: !!D,
  };
}
const clockOf = (t: number) => { const q = Math.min(4, Math.floor(t / 12) + 1), left = q * 12 - t; return `Q${q} ${Math.floor(left)}:${String(Math.round((left % 1) * 60)).padStart(2, '0')}`; };

// Tennis
const PTS = ['0', '15', '30', '40', 'AV'];
function tennisSnap(T: TennisItem): Snap {
  const side = (i: 0 | 1): Side => ({ name: T.players[i], short: lastName(T.players[i]), tri: tri(lastName(T.players[i])), color: hue(T.players[i]), player: true });
  const home = side(0), away = side(1), st = T.st, ended = T.state === 'post';
  const played = st.sets.reduce((a, s) => a + s[0] + s[1], 0) + (st.games ? st.games[0] + st.games[1] : 0);
  const len = Math.max(st.bestOf === 5 ? 48 : 28, played + 6);
  const w = T.engine.win, p: P3 = [w[0], 0, w[1]], p0: P3 = [T.pre.p0, 0, 1 - T.pre.p0];
  const won: Pair = [st.sets.filter((s) => s[0] > s[1]).length, st.sets.filter((s) => s[1] > s[0]).length];
  const id = `tennis-${T.id}`, mem = remember(id, played, w[0]);
  if (mem.pts[0]?.t !== 0) mem.pts.unshift({ t: 0, adv: p0[0] });
  // Sets gagnés vus pendant la session (l'API ne donne pas l'historique point par point dans la liste).
  let g = 0;
  st.sets.forEach((s, i) => {
    g += s[0] + s[1];
    if (i >= mem.sets) { const wnr: 0 | 1 = s[0] > s[1] ? 0 : 1; mem.evs.push({ t: g, kind: 'set', side: wnr, title: `Set pour ${wnr === 0 ? home.short : away.short}`, big: true, word: 'Set', at: `Set ${i + 1}`, score: s.join('-') }); }
  });
  mem.sets = Math.max(mem.sets, st.sets.length);
  const marks: Demo['marks'] = []; let c = 0;
  st.sets.forEach((s, i) => { c += s[0] + s[1]; marks.push({ t: c, label: `Set ${i + 2}` }); });
  const trail = won[0] === won[1] ? undefined : won[0] < won[1] ? 0 : 1;
  const cb = T.engine.comeback;
  return {
    id, sport: 'tennis', league: T.tourney, where: [T.tourney, T.round].filter(Boolean).join(' · '), home, away, len, pace: 1 / 240, t: played, ended,
    clock: `Set ${st.sets.length + 1}`, phase: st.games ? `${st.games[0]}-${st.games[1]} dans le set` : '', score: won, p, p0,
    events: [{ t: 0, kind: 'kick', title: 'Début du match' }, ...mem.evs], series: mem.pts, marks, axis: [...st.sets.map((_, i) => `Set ${i + 1}`), `Set ${st.sets.length + 1}`],
    mom: Array.from({ length: 96 }, () => 0), ghostScore: `${home.short} ${pct0(p0[0])}`,
    rows: [row(`Victoire ${home.short}`, p0[0], p[0]), row(`Victoire ${away.short}`, p0[2], p[2]), ...(T.engine.setNow != null ? [row(`${home.short} prend ce set`, '—', T.engine.setNow)] : [])],
    gauges: { energy: [1, 1], fouls: [0, 0], rhythm: [0.5, 0.5], luck: [0, 0], comeback: cb && !ended ? { side: cb.side, p: cb.win } : trail != null && !ended ? { side: trail, p: trail === 0 ? p[0] : p[2] } : undefined },
    gaugeKeys: ['comeback'], src: 'ESPN',
    tennis: { sets: [...st.sets, ...(st.games && !ended ? [st.games] : [])], pts: st.points ? [PTS[Math.min(4, st.points[0])] ?? String(st.points[0]), PTS[Math.min(4, st.points[1])] ?? String(st.points[1])] : ['', ''], server: st.server ?? 0 },
    detail: true,
  };
}

// ——— Lecture de l'API ———
export interface LiveState { list: Demo[]; at?: number; loading: boolean; error?: string }
let state: LiveState = { list: [], loading: true };
let raw: LiveList | undefined;
const subs = new Set<() => void>();
let timer: number | undefined;
const set = (s: Partial<LiveState>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };

function build(j: LiveList): Demo[] {
  const out: Demo[] = [];
  for (const L of arr(j.foot)) if (L.state !== 'pre') out.push(toDemo(footSnap(L, details.get(`foot-${L.id}`) as FootOne | undefined)));
  for (const L of arr(j.nba)) if (!L.error) out.push(toDemo(nbaSnap(L, details.get(`nba-${L.id}`) as NbaOne | undefined)));
  for (const T of arr(j.tennis)) out.push(toDemo(tennisSnap(T)));
  keep();
  return out;
}
async function poll() {
  try {
    const r = await fetch('/api/live', { cache: 'no-store' });
    if (!r.ok) throw new Error(`Le direct ne répond pas (${r.status}).`);
    raw = (await r.json()) as LiveList;
    set({ list: build(raw), at: Date.now(), loading: false, error: undefined });
  } catch (e) {
    set({ loading: false, error: (e as Error).message });
  }
}
function start() { if (timer != null) return; void poll(); timer = window.setInterval(() => { if (!document.hidden) void poll(); }, 10_000); }
function stop() { if (subs.size || timer == null) return; window.clearInterval(timer); timer = undefined; }

/** Matchs réellement en cours (vide s'il n'y en a pas : la page montre alors l'aperçu). */
export function useLiveList(): LiveState {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f); start();
    return () => { subs.delete(f); stop(); };
  }, []);
  return state;
}

// Fiche d'un match : la réponse complète du moteur, relue toutes les 5 s.
const details = new Map<string, unknown>();
export const isLiveId = (id: string) => /^(foot|nba|tennis)-[\w]+$/.test(id);
export function useLiveMatch(id: string): { m?: Demo; loading: boolean; error?: string } {
  const [res, setRes] = useState<{ m?: Demo; loading: boolean; error?: string }>(() => ({ m: state.list.find((x) => x.id === id), loading: true }));
  useEffect(() => {
    let alive = true, t: number | undefined;
    const [sport, ...rest] = id.split('-'), key = rest.join('-');
    const run = async () => {
      try {
        const r = await fetch(`/api/live?sport=${sport}&id=${encodeURIComponent(key)}`, { cache: 'no-store' });
        const j = (await r.json()) as FootOne & NbaOne & TennisItem & { error?: string };
        if (!r.ok || j.error) throw new Error(j.error ?? `Le direct ne répond pas (${r.status}).`);
        details.set(id, j);
        const L = (list: unknown[] | undefined) => (list as Array<{ id: string | number }> | undefined)?.find((x) => String(x.id) === key);
        const m = sport === 'foot' ? toDemo(footSnap(L(arr(raw?.foot)) as FootItem | undefined, j as FootOne)) : sport === 'nba' ? toDemo(nbaSnap(L(arr(raw?.nba)) as NbaItem | undefined, j as NbaOne)) : toDemo(tennisSnap(j as TennisItem));
        keep();
        if (alive) setRes({ m, loading: false });
      } catch (e) {
        if (alive) setRes((x) => ({ m: x.m, loading: false, error: (e as Error).message }));
      }
      if (alive) t = window.setTimeout(run, document.hidden ? 15_000 : 5_000);
    };
    void run();
    return () => { alive = false; if (t) window.clearTimeout(t); };
  }, [id]);
  return res;
}
