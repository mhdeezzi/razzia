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
    const best = featured(P.probs, P.T);
    const c = combo(P.probs, P.T);
    const scores: Array<{ h: number; a: number; p: number }> = [];
    P.grid.forEach((row, i) => row.forEach((p, j) => scores.push({ h: i, a: j, p: r4(p) })));
    scores.sort((a, b) => b.p - a.p);
    const names = new Map<number, [string, 'home' | 'away']>();
    P.shooters[0].forEach((s) => names.set(s.id, [s.name, 'home']));
    P.shooters[1].forEach((s) => names.set(s.id, [s.name, 'away']));
    const scorers = [...P.sim.scorers].filter(([id]) => names.has(id)).map(([id, p]) => ({ id, name: names.get(id)![0], side: names.get(id)![1], p: r4(p) })).sort((a, b) => b.p - a.p).slice(0, 10);
    const o = L.odds;
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
      pick: best ? { id: best.id, label: label(best.id), p: r4(best.p) } : null,
      combo: { id: c.id, label: label(c.id), p: r4(c.p), risky: c.risky },
      tier: tier(P.probs, best), T: P.T, scorers, n,
      meta: { builtAt: new Date().toISOString(), gamesUsed: games.length, model: M.builtAt },
    };
    writeFileSync(join(outDir, `${f.id}.json`), JSON.stringify(out));
    console.log(`${f.home.name} – ${f.away.name} : ${(100 * P.final.h).toFixed(0)} / ${(100 * P.final.d).toFixed(0)} / ${(100 * P.final.a).toFixed(0)} · ${best ? `${label(best.id)} (${(100 * best.p).toFixed(0)} %)` : 'pas de prono'} · ${out.tier}`);
  } catch (e) { failed++; console.log(`échec ${P.f.id}`, e); }
}
if (failed) process.exit(1);
