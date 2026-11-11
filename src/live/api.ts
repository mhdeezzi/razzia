// API du direct (fonction Vercel, regroupée dans api/live.js par scripts/build-live-api.mjs) : données en direct des
// trois sports + moteur live, au départ des pronostics d'avant-match Razzia (branche resultats).
//   GET /api/live                       -> {foot, nba, tennis} : tous les matchs en cours, avec le pronostic du moment
//   GET /api/live?sport=foot&id=        -> fiche FotMob complète + moteur (1N2, prochain but, but dans 10 min, remontée)
//   GET /api/live?sport=nba&id=         -> fiche ESPN + moteur (vainqueur, écart et total, remontée, chance au tir)
//   GET /api/live?sport=tennis&id=      -> score ESPN + moteur (vainqueur, forme du jour, set en cours, remontée)
// Réponses mises en cache 10 s par le CDN (et servies périmées 30 s de plus pendant le rafraîchissement) : le nombre de
// visiteurs ne change rien au nombre d'appels aux sources.
import { footNow, nbaNow, tennisNow } from './index.ts';
import { espnNbaBoard, espnNbaGame, espnTennisLive, fotmobLive, fotmobMatch } from './feeds.ts';
import type { NbaPre } from './nba.ts';

const REPO = process.env.GH_REPO ?? 'mhdeezzi/razzia';
const TOKEN = (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_PAT ?? '').trim();
const LIVE = { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' };
const noStore = { 'Cache-Control': 'no-store' };

/** Fichier de la branche resultats (pronostics d'avant-match), gardé 10 minutes. Sans clé GitHub : rien. */
const prev = new Map<string, { at: number; v: unknown }>();
async function resultat<T>(path: string): Promise<T | undefined> {
  const c = prev.get(path);
  if (c && Date.now() - c.at < 600_000) return c.v as T | undefined;
  if (!TOKEN) return undefined;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=resultats`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(8000),
    });
    const v = r.ok ? ((await r.json()) as T) : undefined;
    prev.set(path, { at: Date.now(), v });
    return v;
  } catch {
    return c?.v as T | undefined;
  }
}

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r3a = (a: number[]) => a.map(r3);
/** Ligue sans pronostic Razzia : buts attendus moyens (domicile, extérieur). */
const FOOT_DEFAULT: [number, number] = [1.45, 1.15];
const NBA_DEFAULT: NbaPre = { spread: 2, total: 226 };

/** Quantile de la loi normale (Acklam). */
function invPhi(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const q0 = Math.min(1 - 1e-9, Math.max(1e-9, p));
  if (q0 < 0.02425) { const q = Math.sqrt(-2 * Math.log(q0)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (q0 > 1 - 0.02425) return -invPhi(1 - q0);
  const q = q0 - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---------------------------------------------------------------------------------------------------------------------
type FootIndex = Array<{ id: string; final?: { h: number; d: number; a: number } }>;
async function footPre(id: number | string): Promise<{ pre: { h: number; d: number; a: number } | [number, number]; src: 'razzia' | 'defaut' }> {
  const ix = (await resultat<FootIndex>('foot/index.json')) ?? [];
  const f = ix.find((x) => String(x.id) === String(id))?.final;
  if (f && f.h > 0 && f.d > 0 && f.a > 0) return { pre: { h: 1 / f.h, d: 1 / f.d, a: 1 / f.a }, src: 'razzia' };
  const sim = await resultat<{ lambda?: [number, number] }>(`foot/sims/${id}.json`);
  if (sim?.lambda) return { pre: sim.lambda, src: 'razzia' };
  return { pre: FOOT_DEFAULT, src: 'defaut' };
}

async function nbaPre(date: string, away: string, home: string, market?: { spread: number; total: number }): Promise<{ pre: NbaPre; src: 'razzia' | 'marche' | 'defaut' }> {
  const s = await resultat<{ pHome?: number; margin?: { mean: number; sd: number }; total?: { mean: number } }>(`sims/${date}_${away}@${home}/summary.json`);
  // L'écart d'avant-match reprend la probabilité Razzia affichée sur la fiche (simulation mêlée au marché), pas l'écart
  // brut de la simulation : le direct part du même pronostic que la fiche.
  if (s?.margin && s.total) return { pre: { spread: s.pHome != null ? s.margin.sd * invPhi(s.pHome) : s.margin.mean, total: s.total.mean }, src: 'razzia' };
  if (market) return { pre: market, src: 'marche' };
  return { pre: NBA_DEFAULT, src: 'defaut' };
}

type TennisIndex = Array<{ id: string; home: string; away: string; pHome: number }>;
async function tennisPre(id: string, players: [string, string]): Promise<{ p0: number; surface: string; src: 'razzia' | 'defaut' }> {
  const ix = (await resultat<TennisIndex>('tennis/index.json')) ?? [];
  const m = ix.find((x) => String(x.id) === id) ?? ix.find((x) => key(x.home) === key(players[0]) && key(x.away) === key(players[1])) ?? ix.find((x) => key(x.home) === key(players[1]) && key(x.away) === key(players[0]));
  if (!m) return { p0: 0.5, surface: 'Hard', src: 'defaut' };
  const sim = await resultat<{ surface?: string }>(`tennis/sims/${m.id}.json`);
  const aIsHome = key(m.home) === key(players[0]);
  return { p0: aIsHome ? m.pHome : 1 - m.pHome, surface: sim?.surface ?? 'Hard', src: 'razzia' };
}

// ---------------------------------------------------------------------------------------------------------------------
async function footList() {
  const list = await fotmobLive();
  return Promise.all(list.map(async (m) => {
    const { pre, src } = await footPre(m.id);
    // Minute par minute, seuls le score, les rouges et le temps comptent pour le résultat (contrôle 2025-26) : la liste
    // n'a besoin que de ce que donne le tableau du jour.
    const goals: Array<[number, 0 | 1]> = [...Array(m.score[0]).fill([Math.max(1, m.minute), 0]), ...Array(m.score[1]).fill([Math.max(1, m.minute), 1])];
    const reds: Array<[number, 0 | 1]> = [...Array(m.reds[0]).fill([Math.max(1, m.minute), 0]), ...Array(m.reds[1]).fill([Math.max(1, m.minute), 1])];
    const o = footNow(pre, { minute: m.minute, goals, reds, shots: [] });
    return { ...m, pre: src, p1x2: r3a(o.p1x2), nextGoal: r3a(o.nextGoal), comeback: o.comeback && { ...o.comeback, draw: r3(o.comeback.draw), win: r3(o.comeback.win) } };
  }));
}

async function footOne(id: number) {
  const d = await fotmobMatch(id);
  const { pre, src } = await footPre(id);
  const o = footNow(pre, d.timeline);
  return {
    ...d, pre: src,
    engine: {
      minute: o.minute, score: o.score, p1x2: r3a(o.p1x2), nextGoal: r3a(o.nextGoal), goalSoon: r3a(o.goalSoon), remaining: r3a(o.remaining),
      over: r3a(o.over), comeback: o.comeback, hold: o.hold,
      // Indicateurs (affichés, pas utilisés pour la probabilité : ils n'amélioraient pas la prévision du résultat).
      pressure: r3a(o.ev.pressure), luck: r3a([o.ev.goals[0] - o.ev.xg[0], o.ev.goals[1] - o.ev.xg[1]]),
      topScores: o.grid.flatMap((r, i) => r.map((p, j) => ({ s: `${i}-${j}`, p: r3(p) }))).sort((a, b) => b.p - a.p).slice(0, 6),
    },
  };
}

async function nbaOne(id: string) {
  const d = await espnNbaGame(id);
  const { pre, src } = await nbaPre(d.date, d.away, d.home, d.market);
  const o = nbaNow(pre, d.st);
  return {
    ...d, pre: { ...pre, src },
    engine: {
      win: r3a(o.win), margin: o.margin, total: o.total, comeback: o.comeback, factors: o.factors,
      cover: [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5].map((l) => ({ line: l, p: r3(o.cover(l)) })),
      over: [-15, -10, -5, 0, 5, 10, 15].map((dx) => { const line = Math.round(o.total.mean + dx) + 0.5; return { line, p: r3(o.over(line)) }; }),
    },
  };
}

async function nbaList() {
  const board = await espnNbaBoard();
  return Promise.all(board.filter((g) => g.state === 'in').map(async (g) => {
    try {
      const x = await nbaOne(g.id);
      return { id: g.id, home: g.home, away: g.away, score: g.score, period: g.period, clock: g.clock, pre: x.pre.src, win: x.engine.win, comeback: x.engine.comeback, espnHomeWin: g.espnHomeWin };
    } catch {
      return { id: g.id, home: g.home, away: g.away, score: g.score, period: g.period, clock: g.clock, error: true };
    }
  }));
}

async function tennisList() {
  const all = [...(await espnTennisLive('atp').catch(() => [])), ...(await espnTennisLive('wta').catch(() => []))];
  return Promise.all(all.filter((m) => m.state === 'in').map((m) => tennisOne(m)));
}

const tennisBase = new Map<string, [number, number]>();
async function tennisOne(m: Awaited<ReturnType<typeof espnTennisLive>>[number]) {
  const { p0, surface, src } = await tennisPre(m.id, m.players);
  const k = `${m.id}|${p0}|${surface}`;
  const o = tennisNow(p0, surface, m.st, tennisBase.get(k));
  tennisBase.set(k, o.base);
  if (tennisBase.size > 300) tennisBase.clear();
  return { ...m, pre: { p0: r3(p0), surface, src }, engine: { win: r3a(o.win), form: o.form, comeback: o.comeback, setNow: o.setNow } };
}

// ---------------------------------------------------------------------------------------------------------------------
export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const sport = q.get('sport'), id = q.get('id') ?? '';
  try {
    if (!sport) {
      const [foot, nba, tennis] = await Promise.all([footList().catch((e) => ({ error: String(e.message) })), nbaList().catch((e) => ({ error: String(e.message) })), tennisList().catch((e) => ({ error: String(e.message) }))]);
      return Response.json({ at: new Date().toISOString(), foot, nba, tennis }, { headers: LIVE });
    }
    if (sport === 'foot' && /^\d{4,10}$/.test(id)) return Response.json(await footOne(Number(id)), { headers: LIVE });
    if (sport === 'nba' && /^\d{6,12}$/.test(id)) return Response.json(await nbaOne(id), { headers: LIVE });
    if (sport === 'tennis' && /^\d{4,12}$/.test(id)) {
      const all = [...(await espnTennisLive('atp').catch(() => [])), ...(await espnTennisLive('wta').catch(() => []))];
      const m = all.find((x) => x.id === id);
      if (!m) return Response.json({ error: 'Match introuvable ou pas commencé' }, { status: 404, headers: noStore });
      return Response.json(await tennisOne(m), { headers: LIVE });
    }
    return Response.json({ error: 'Paramètres invalides' }, { status: 400, headers: noStore });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502, headers: noStore });
  }
}
