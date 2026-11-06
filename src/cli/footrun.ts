// Simulation de matchs de foot à la demande (simulate-foot.yml) : 25 000 matchs tir par tir pour chaque identifiant
// FotMob, publiés en out/foot/<id>.json. Infos du match et cotes : programme du jour (slate.json), sinon FotMob.
//   node src/cli/footrun.ts --ids 4813123,4813124 [--slate data/cache/foot/slate.json] [--out out/foot] [--sims 25000]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGames } from '../foot/data.ts';
import { predictMany, loadModel } from '../foot/engine.ts';
import { FOOT_DIR, LEAGUES, matchRaw, type Fixture } from '../foot/fotmob.ts';
import { marketById } from '../foot/markets.ts';
import { combo, featured, tier } from '../foot/picks.ts';
import type { SlateFoot } from './footslate.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ids = arg('--ids', '').split(',').map((x) => x.trim()).filter((x) => /^\d{5,12}$/.test(x));
const outDir = arg('--out', 'out/foot'), n = Number(arg('--sims', '25000'));
const slateFile = arg('--slate', join(FOOT_DIR, 'slate.json'));
const slate: SlateFoot[] = existsSync(slateFile) ? JSON.parse(readFileSync(slateFile, 'utf8')).matches : [];
mkdirSync(outDir, { recursive: true });
const games = loadGames();
const M = loadModel();

const list: Array<{ f: Fixture; odds?: SlateFoot['odds']; league: string }> = [];
for (const id of ids) {
  const s = slate.find((x) => x.id === id);
  if (s) { list.push({ f: { id, lg: s.lg, season: '', date: s.start, round: s.round, home: s.home, away: s.away, finished: false, cancelled: false }, odds: s.odds, league: s.league }); continue; }
  // Hors programme : infos lues sur FotMob.
  const d = await matchRaw(id);
  const g = d?.general;
  if (!g) { console.log(`match ${id} introuvable`); continue; }
  list.push({ f: { id, lg: Number(g.parentLeagueId ?? g.leagueId), season: '', date: d.header?.status?.utcTime ?? g.matchTimeUTCDate, round: g.matchRound, home: { id: Number(g.homeTeam.id), name: g.homeTeam.name }, away: { id: Number(g.awayTeam.id), name: g.awayTeam.name }, finished: false, cancelled: false }, league: g.leagueName });
}
if (!list.length) { console.log('rien à simuler'); process.exit(1); }
const res = await predictMany(list.map((x) => ({ f: x.f, odds: x.odds })), n);
const r4 = (x: number) => +x.toFixed(4);
const logo = (id: number) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
let failed = 0;
for (const P of res) {
  try {
    const { f } = P;
    const L = list.find((x) => x.f.id === f.id)!;
    const label = (id: string) => marketById.get(id)!.label(f.home.name, f.away.name);
    const pickBest = featured(P.probs, P.T);
    const c = combo(P.probs, P.T);
    const scores: Array<{ h: number; a: number; p: number }> = [];
    P.grid.forEach((row, i) => row.forEach((p, j) => scores.push({ h: i, a: j, p: r4(p) })));
    scores.sort((a, b) => b.p - a.p);
    const names = new Map<number, [string, 'home' | 'away']>();
    P.shooters[0].forEach((s) => names.set(s.id, [s.name, 'home']));
    P.shooters[1].forEach((s) => names.set(s.id, [s.name, 'away']));
    const scorers = [...P.sim.scorers].filter(([id]) => names.has(id)).map(([id, p]) => ({ id, name: names.get(id)![0], side: names.get(id)![1], p: r4(p) })).sort((a, b) => b.p - a.p).slice(0, 10);
    const o = L.odds;
    // Déroulé du match : qui mène à chaque tranche de 5 minutes, calé en fin de match sur les probabilités affichées.
    const raw = P.sim.flow.at(-1)!, fin = [P.final.h, P.final.d, P.final.a];
    const flow = P.sim.flow.map((f, b) => {
      const w = (b + 1) / P.sim.flow.length;
      const z = f.map((x, k) => x * (raw[k] > 0 ? (fin[k] / raw[k]) ** w : 1));
      const t = z[0] + z[1] + z[2];
      return z.map((x) => r4(x / t));
    });
    // Scénario le plus fréquent du score le plus probable : ordre des buts et minute moyenne de chacun.
    const top = scores[0];
    const bySeq = top ? P.sim.seqs.get(`${top.h}-${top.a}`) : undefined;
    const best = bySeq ? [...bySeq].sort((x, y) => y[1].n - x[1].n)[0] : undefined;
    const typical = best && top ? { score: [top.h, top.a], share: r4(best[1].n / [...bySeq!.values()].reduce((t, e) => t + e.n, 0)), goals: [...best[0]].map((side, i) => ({ side: side === 'H' ? 'home' : 'away', min: Math.round(best[1].min[i] / best[1].n) })) } : undefined;
    // Confrontations : les derniers matchs entre les deux équipes, toutes compétitions suivies.
    const h2h = games
      .filter((g) => (g.home.id === f.home.id && g.away.id === f.away.id) || (g.home.id === f.away.id && g.away.id === f.home.id))
      .sort((x, y) => y.date.localeCompare(x.date)).slice(0, 8)
      .map((g) => ({ date: g.date, lg: g.lg, league: LEAGUES.find((l) => l.id === g.lg)?.name, home: g.home.id, away: g.away.id, score: g.score }));
    const out = {
      sport: 'foot', id: f.id, lg: f.lg, league: L.league ?? LEAGUES.find((l) => l.id === f.lg)?.name, round: f.round, start: f.date, day: f.date.slice(0, 10),
      home: { ...f.home, logo: logo(f.home.id), form: P.row.fh.mom, att: P.row.fh.la }, away: { ...f.away, logo: logo(f.away.id), form: P.row.fa.mom, att: P.row.fa.la },
      lineupType: P.lineupType ?? 'unknown',
      lineups: P.side.map((s) => ({ formation: s?.formation, coach: s?.coach?.name, starters: (s?.starters ?? []).map((p) => p[1]), out: (s?.unavailable ?? []).map((p) => ({ name: p[1], why: p[2] })) })),
      lambda: P.lambda.map(r4), engine: { h: r4(P.engine.h), d: r4(P.engine.d), a: r4(P.engine.a) }, final: { h: r4(P.final.h), d: r4(P.final.d), a: r4(P.final.a) },
      market: o ? { odds: o, src: o.src } : undefined,
      probs: Object.fromEntries([...P.probs].map(([k, v]) => [k, r4(v)])),
      labels: Object.fromEntries([...P.probs.keys()].map((k) => [k, label(k)])),
      scores: scores.slice(0, 12), firstGoal: P.sim.firstGoal.map(r4), ht: P.sim.ht.map((row) => row.map(r4)),
      pick: pickBest ? { id: pickBest.id, label: label(pickBest.id), p: r4(pickBest.p) } : null,
      combo: { id: c.id, label: label(c.id), p: r4(c.p), risky: c.risky },
      tier: tier(P.probs, pickBest), T: P.T, scorers, n, flow, typical, h2h,
      meta: { builtAt: new Date().toISOString(), gamesUsed: games.length, model: M.builtAt },
    };
    writeFileSync(join(outDir, `${f.id}.json`), JSON.stringify(out));
    console.log(`${f.home.name} – ${f.away.name} : ${(100 * P.final.h).toFixed(0)} / ${(100 * P.final.d).toFixed(0)} / ${(100 * P.final.a).toFixed(0)} · ${pickBest ? `${label(pickBest.id)} (${(100 * pickBest.p).toFixed(0)} %)` : 'pas de prono'} · ${out.tier}`);
  } catch (e) { failed++; console.log(`échec ${P.f.id}`, e); }
}
if (failed) process.exit(1);
