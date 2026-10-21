// Backtest / calibration : rejoue des matchs passés avec les données disponibles avant chaque match.
//   node src/cli/backtest.ts --from 2026-01-10 --to 2026-04-12 --games 40 --n 400 [--params '{"sdPlayerNight":0.12}']
// Mesures : moyennes d'équipe simulées vs réelles, erreurs de marge/total, Brier sur le vainqueur,
// couverture des portées 80 % (P10–P90) des joueurs — la métrique de calibration publiée par RotoBot.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, readCache, ROOT } from '../data/http.ts';
import type { GameRecord } from '../data/cdn.ts';
import { buildGameModel } from '../nba/model/build.ts';
import { calibratePace, calibrateStrength, runSims, summarize } from '../nba/engine/montecarlo.ts';
import type { SimParams } from '../nba/model/types.ts';
import { getMarket, noVig } from '../data/espn.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

export interface BacktestResult {
  market?: { n: number; brierModel: number; brierMarket: number; brierBlend: number; spreadN: number; spreadErrModel: number; spreadErrMarket: number; totN: number; totErrModel: number; totErrMarket: number; ats: number; atsWin: number };
  games: number;
  team: Record<string, { sim: number; real: number }>;
  marginMAE: number;
  totalMAE: number;
  marginBias: number;
  totalBias: number;
  simMarginSd: number;
  simTotalSd: number;
  brier: number;
  logloss: number;
  coverage: Record<string, { inside: number; above: number; below: number; n: number }>;
  rows: Array<Record<string, unknown>>;
}

export async function backtest(opts: { from: string; to: string; games: number; n: number; params?: Partial<SimParams>; quiet?: boolean; market?: boolean; noStrength?: boolean }): Promise<BacktestResult> {
  const ids = readdirSync(join(CACHE_DIR, 'games')).map((f) => f.replace('.json.gz', '')).filter((id) => id.startsWith('002')).sort();
  const pool: GameRecord[] = [];
  for (const id of ids) {
    const g = readCache<GameRecord>('games', id)!;
    if (g.date >= opts.from && g.date <= opts.to) pool.push(g);
  }
  const step = Math.max(1, Math.floor(pool.length / opts.games));
  const sample = pool.filter((_, i) => i % step === 0).slice(0, opts.games);
  const keys = ['pts', 'fga', 'fgm', 'fg3a', 'fg3m', 'fta', 'tov', 'oreb', 'reb', 'ast', 'stl', 'blk', 'pf'];
  const realKey: Record<string, string> = {
    pts: 'points', fga: 'fieldGoalsAttempted', fgm: 'fieldGoalsMade', fg3a: 'threePointersAttempted', fg3m: 'threePointersMade', fta: 'freeThrowsAttempted',
    tov: 'turnovers', oreb: 'reboundsOffensive', reb: 'reboundsTotal', ast: 'assists', stl: 'steals', blk: 'blocks', pf: 'foulsPersonal',
  };
  const team: BacktestResult['team'] = Object.fromEntries(keys.map((k) => [k, { sim: 0, real: 0 }]));
  const cov: BacktestResult['coverage'] = {};
  const rows: BacktestResult['rows'] = [];
  let mae = 0, tmae = 0, mb = 0, tb = 0, brier = 0, ll = 0, msd = 0, tsd = 0;
  const mkt = { n: 0, brierModel: 0, brierMarket: 0, brierBlend: 0, spreadN: 0, spreadErrModel: 0, spreadErrMarket: 0, totN: 0, totErrModel: 0, totErrMarket: 0, ats: 0, atsWin: 0 };
  for (const [gi, g] of sample.entries()) {
    const t0 = Date.now();
    const m = await buildGameModel({ date: g.date, homeTri: g.home.tri, awayTri: g.away.tri, gameId: g.gameId, actual: g, injuries: false, market: false, passes: false });
    Object.assign(m.params, opts.params ?? {});
    calibratePace(m, 150);
    if (!opts.noStrength) calibrateStrength(m, 200);
    const b = await runSims(m, opts.n, 11 + gi);
    const s = summarize(m, b);
    for (const k of keys) {
      team[k].sim += (s.teamStats.home[k] + s.teamStats.away[k]) / 2 / sample.length;
      const real = (t: GameRecord['home']) => t.players.reduce((a, p) => a + (p.stats[realKey[k]] ?? 0), 0);
      team[k].real += (real(g.home) + real(g.away)) / 2 / sample.length;
    }
    const realMargin = g.home.score - g.away.score;
    const realTotal = g.home.score + g.away.score;
    mae += Math.abs(realMargin - s.margin.mean) / sample.length;
    tmae += Math.abs(realTotal - s.total.mean) / sample.length;
    mb += (realMargin - s.margin.mean) / sample.length;
    tb += (realTotal - s.total.mean) / sample.length;
    msd += s.margin.sd / sample.length;
    tsd += s.total.sd / sample.length;
    // Marché (clôture DraftKings) : comparaison modèle / marché / mélange.
    if (opts.market) {
      const mk = await getMarket(g.date, g.home.tri, g.away.tri).catch(() => undefined);
      if (mk?.mlHome != null && mk.mlAway != null) {
        const pm = noVig(mk.mlHome, mk.mlAway)[0];
        const yy = realMargin > 0 ? 1 : 0;
        mkt.n++;
        mkt.brierModel += (s.pHome - yy) ** 2;
        mkt.brierMarket += (pm - yy) ** 2;
        mkt.brierBlend += (0.5 * s.pHome + 0.5 * pm - yy) ** 2;
        if (mk.spreadHome != null) {
          mkt.spreadN++;
          mkt.spreadErrModel += Math.abs(realMargin - s.margin.mean);
          mkt.spreadErrMarket += Math.abs(realMargin + mk.spreadHome);
          // Pari simulé sur le spread quand le modèle s'écarte de la ligne de plus de 3 pts.
          const edge = s.margin.mean + mk.spreadHome;
          if (Math.abs(edge) >= 3 && realMargin + mk.spreadHome !== 0) {
            mkt.ats++;
            if (Math.sign(edge) === Math.sign(realMargin + mk.spreadHome)) mkt.atsWin++;
          }
        }
        if (mk.total != null) {
          mkt.totN++;
          mkt.totErrModel += Math.abs(realTotal - s.total.mean);
          mkt.totErrMarket += Math.abs(realTotal - mk.total);
        }
      }
    }
    const y = realMargin > 0 ? 1 : 0;
    const p = Math.min(0.99, Math.max(0.01, s.pHome));
    brier += (p - y) ** 2 / sample.length;
    ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)) / sample.length;
    // Couverture des portées 80 %.
    for (const t of [g.home, g.away]) {
      for (const bp of t.players) {
        if (bp.sec <= 0) continue; // règle des props : le joueur a joué
        const ps = s.players.find((x) => x.id === bp.id);
        if (!ps || ps.playRate < 0.5) continue;
        const real: Record<string, number> = {
          pts: bp.stats.points, reb: bp.stats.reboundsTotal, ast: bp.stats.assists, fg3m: bp.stats.threePointersMade,
          pra: bp.stats.points + bp.stats.reboundsTotal + bp.stats.assists, min: bp.sec / 60,
        };
        const sp = ps.stats.pts.mean;
        const pb = sp >= 20 ? 'pts20+' : sp >= 12 ? 'pts12-20' : 'pts<12';
        const pbk = (cov[`ptsbias_${pb}`] ??= { inside: 0, above: 0, below: 0, n: 0 });
        pbk.n++;
        pbk.inside += sp - bp.stats.points;
        const sm = ps.stats.min.mean;
        const bucket = sm >= 30 ? 'attendu30+' : sm >= 20 ? 'attendu20-30' : 'attendu<20';
        const mb = (cov[`bias_${bucket}`] ??= { inside: 0, above: 0, below: 0, n: 0 });
        mb.n++;
        mb.inside += ps.stats.min.mean - bp.sec / 60; // somme des écarts (sim - réel)
        for (const [k, v] of Object.entries(real)) {
          const d = ps.stats[k];
          const c = (cov[k] ??= { inside: 0, above: 0, below: 0, n: 0 });
          c.n++;
          if (v > d.p90) c.above++;
          else if (v < d.p10) c.below++;
          else c.inside++;
        }
      }
    }
    rows.push({ game: `${g.away.tri}@${g.home.tri}`, date: g.date, real: `${g.away.score}-${g.home.score}`, sim: `${s.awayPts.mean.toFixed(1)}-${s.homePts.mean.toFixed(1)}`, pHome: +s.pHome.toFixed(3) });
    if (!opts.quiet) console.log(`[${gi + 1}/${sample.length}] ${g.date} ${g.away.tri}@${g.home.tri} réel ${g.away.score}-${g.home.score} | sim ${s.awayPts.mean.toFixed(1)}-${s.homePts.mean.toFixed(1)} pDom ${(s.pHome * 100).toFixed(0)}% (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  return { market: mkt, games: sample.length, team, marginMAE: mae, totalMAE: tmae, marginBias: mb, totalBias: tb, simMarginSd: msd, simTotalSd: tsd, brier, logloss: ll, coverage: cov, rows };
}

export function printBacktest(r: BacktestResult): string {
  const L: string[] = [];
  L.push(`Matchs : ${r.games}`);
  L.push('Stat d\'équipe (par match) : simulé vs réel');
  for (const [k, v] of Object.entries(r.team)) L.push(`  ${k.padEnd(5)} ${v.sim.toFixed(1).padStart(6)} vs ${v.real.toFixed(1).padStart(6)}`);
  L.push(`FG% sim ${(r.team.fgm.sim / r.team.fga.sim * 100).toFixed(1)} vs ${(r.team.fgm.real / r.team.fga.real * 100).toFixed(1)} ; 3P% sim ${(r.team.fg3m.sim / r.team.fg3a.sim * 100).toFixed(1)} vs ${(r.team.fg3m.real / r.team.fg3a.real * 100).toFixed(1)}`);
  L.push(`Marge : MAE ${r.marginMAE.toFixed(2)}, biais ${r.marginBias.toFixed(2)}, σ simulé moyen ${r.simMarginSd.toFixed(2)}`);
  L.push(`Total : MAE ${r.totalMAE.toFixed(2)}, biais ${r.totalBias.toFixed(2)}, σ simulé moyen ${r.simTotalSd.toFixed(2)}`);
  L.push(`Vainqueur : Brier ${r.brier.toFixed(4)}, log-loss ${r.logloss.toFixed(4)}`);
  if (r.market && r.market.n) {
    const k = r.market;
    L.push(`Marché (clôture DraftKings, ${k.n} matchs) : Brier modèle ${(k.brierModel / k.n).toFixed(4)} | marché ${(k.brierMarket / k.n).toFixed(4)} | mélange 50/50 ${(k.brierBlend / k.n).toFixed(4)}`);
    if (k.spreadN) L.push(`  Erreur absolue sur la marge : modèle ${(k.spreadErrModel / k.spreadN).toFixed(2)} vs ligne ${(k.spreadErrMarket / k.spreadN).toFixed(2)} ; total : modèle ${(k.totErrModel / Math.max(1, k.totN)).toFixed(2)} vs ligne ${(k.totErrMarket / Math.max(1, k.totN)).toFixed(2)}`);
    if (k.ats) L.push(`  Écart modèle/ligne ≥ 3 pts : ${k.atsWin}/${k.ats} gagnants contre le spread (${(k.atsWin / k.ats * 100).toFixed(1)} %)`);
  }
  L.push('Couverture des portées 80 % (cible : 80 % dedans, 10 % au-dessus, 10 % en dessous)');
  for (const [k, c] of Object.entries(r.coverage).filter(([k]) => k.startsWith('bias_'))) L.push(`  écart moyen de minutes (sim − réel) ${k.slice(5)} : ${(c.inside / c.n).toFixed(1)} (n=${c.n})`);
  for (const [k, c] of Object.entries(r.coverage).filter(([k]) => k.startsWith('ptsbias_'))) L.push(`  écart moyen de points (sim − réel) ${k.slice(8)} : ${(c.inside / c.n).toFixed(2)} (n=${c.n})`);
  for (const [k, c] of Object.entries(r.coverage).filter(([k]) => !k.startsWith('bias_') && !k.startsWith('ptsbias_'))) L.push(`  ${k.padEnd(5)} dedans ${(c.inside / c.n * 100).toFixed(1)}%  au-dessus ${(c.above / c.n * 100).toFixed(1)}%  en dessous ${(c.below / c.n * 100).toFixed(1)}%  (n=${c.n})`);
  return L.join('\n');
}

if (import.meta.main) {
  const r = await backtest({
    from: arg('from', '2026-01-10')!, to: arg('to', '2026-04-12')!, games: Number(arg('games', '30')), n: Number(arg('n', '400')),
    params: arg('params') ? JSON.parse(arg('params')!) : undefined,
    market: !process.argv.includes('--no-market'),
    noStrength: process.argv.includes('--no-strength'),
  });
  const txt = printBacktest(r);
  console.log('\n' + txt);
  mkdirSync(join(ROOT, 'out', 'backtests'), { recursive: true });
  const f = join(ROOT, 'out', 'backtests', `bt_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(f, JSON.stringify({ args: process.argv.slice(2), ...r }, null, 1));
  console.log(`\nDétails : ${f}`);
}
