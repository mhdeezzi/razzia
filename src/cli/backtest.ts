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
import { parseGame } from '../nba/model/pbp.ts';
import { ZONES } from '../nba/model/zones.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

export interface BacktestResult {
  fullTables?: boolean;
  market?: { n: number; brierModel: number; brierMarket: number; brierBlend: number; spreadN: number; spreadErrModel: number; spreadErrMarket: number; totN: number; totErrModel: number; totErrMarket: number; ats: number; atsWin: number };
  // Mélange modèle / marché (clôture) en logit, par part du modèle ; valeur de clôture contre les cotes d'ouverture.
  blend?: Array<{ w: number; brier: number }>;
  clv?: { n: number; bets: number; clvSum: number; clvPos: number; profit: number; won: number; corrNum: number; corrDen1: number; corrDen2: number; sx: number; sy: number };
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
  /** Calibration par tranche de confiance du favori : prédit vs gagné (modèle et marché). */
  calib: Record<string, { n: number; pred: number; won: number; nMkt: number; predMkt: number; wonMkt: number }>;
  accuracy: number;
  accuracyMkt?: number;
  autopsy: Autopsy;
  rows: Array<Record<string, unknown>>;
}

/** Autopsie : ce qui, dans le vrai match, a écarté le résultat de la simulation. */
export interface Autopsy {
  n: number;
  sq: { err: number; a3: number; a2: number; aft: number; vol: number }; // somme des carrés (erreur de marge et ses composantes)
  zones: Record<string, { adr: number; vol: number }>; // somme des carrés par catégorie de zone : adresse et volume
  style: { trans: number; transN: number; ast: number; astN: number }; // écarts absolus moyens contre-attaque / passes
  misses: Array<{ game: string; date: string; real: string; sim: string; pFav: number; driver: string; detail: string; players: string[] }>;
  drivers: Record<string, number>; // cause principale parmi les matchs où le favori a perdu
  minutes: Record<string, { n: number; abs: number; bias: number; over8: number }>;
  explosions: number;
  playersSeen: number;
  lateOut: number; // actifs à 0 minute pour blessure/repos : forfait de dernière minute, hors tableau des minutes
}

type Box = { pts: number; fga: number; fgm: number; fg3a: number; fg3m: number; fta: number; ftm: number; tov: number; oreb: number };
/** Écart de points réel - simulé, découpé en adresse (à volume réel) et en volume (tentatives), pour 3 pts, 2 pts et lancers. */
function decompose(r: Box, s: Box) {
  const p = (m: number, a: number) => (a > 0 ? m / a : 0);
  const r2a = r.fga - r.fg3a, s2a = s.fga - s.fg3a;
  const p3r = p(r.fg3m, r.fg3a), p3s = p(s.fg3m, s.fg3a);
  const p2r = p(r.fgm - r.fg3m, r2a), p2s = p(s.fgm - s.fg3m, s2a);
  const pfr = p(r.ftm, r.fta), pfs = p(s.ftm, s.fta);
  return {
    a3: 3 * r.fg3a * (p3r - p3s), a2: 2 * r2a * (p2r - p2s), aft: r.fta * (pfr - pfs),
    vol: 3 * (r.fg3a - s.fg3a) * p3s + 2 * (r2a - s2a) * p2s + (r.fta - s.fta) * pfs,
    p3r, p3s,
  };
}

export async function backtest(opts: { from: string; to: string; games: number; n: number; params?: Partial<SimParams>; quiet?: boolean; market?: boolean; noStrength?: boolean; fullTables?: boolean }): Promise<BacktestResult> {
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
  const calib: BacktestResult['calib'] = {};
  const bucket = (p: number) => { const c = Math.max(p, 1 - p); return c >= 0.9 ? '90-100' : c >= 0.8 ? '80-90' : c >= 0.7 ? '70-80' : c >= 0.6 ? '60-70' : '50-60'; };
  const cb = (k: string) => (calib[k] ??= { n: 0, pred: 0, won: 0, nMkt: 0, predMkt: 0, wonMkt: 0 });
  let hits = 0, hitsMkt = 0, nMkt = 0;
  const auto: Autopsy = { n: 0, sq: { err: 0, a3: 0, a2: 0, aft: 0, vol: 0 }, zones: {}, style: { trans: 0, transN: 0, ast: 0, astN: 0 }, misses: [], drivers: {}, minutes: {}, explosions: 0, playersSeen: 0, lateOut: 0 };
  const mkt = { n: 0, brierModel: 0, brierMarket: 0, brierBlend: 0, spreadN: 0, spreadErrModel: 0, spreadErrMarket: 0, totN: 0, totErrModel: 0, totErrMarket: 0, ats: 0, atsWin: 0 };
  const W = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1];
  const blend = W.map((w) => ({ w, brier: 0 }));
  const clv = { n: 0, bets: 0, clvSum: 0, clvPos: 0, profit: 0, won: 0, corrNum: 0, corrDen1: 0, corrDen2: 0, sx: 0, sy: 0 };
  const lg = (p: number) => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));
  const decimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
  for (const [gi, g] of sample.entries()) {
    const t0 = Date.now();
    const m = await buildGameModel({ date: g.date, homeTri: g.home.tri, awayTri: g.away.tri, gameId: g.gameId, actual: g, injuries: false, market: false, passes: false, pastTablesOnly: !opts.fullTables });
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
        const bm = cb(bucket(pm));
        bm.nMkt++;
        bm.predMkt += Math.max(pm, 1 - pm);
        bm.wonMkt += (pm >= 0.5) === (yy === 1) ? 1 : 0;
        nMkt++;
        hitsMkt += (pm >= 0.5) === (yy === 1) ? 1 : 0;
        mkt.n++;
        mkt.brierModel += (s.pHome - yy) ** 2;
        mkt.brierMarket += (pm - yy) ** 2;
        mkt.brierBlend += (0.5 * s.pHome + 0.5 * pm - yy) ** 2;
        for (const b of blend) b.brier += (1 / (1 + Math.exp(-(b.w * lg(s.pHome) + (1 - b.w) * lg(pm)))) - yy) ** 2;
        // Valeur de clôture : le modèle contre la cote d'ouverture ; la ligne a-t-elle bougé dans son sens ?
        if (mk.mlHomeOpen != null && mk.mlAwayOpen != null) {
          const po = noVig(mk.mlHomeOpen, mk.mlAwayOpen)[0];
          const x = s.pHome - po;
          const d = pm - po;
          clv.n++;
          clv.sx += x;
          clv.sy += d;
          clv.corrNum += x * d;
          clv.corrDen1 += x * x;
          clv.corrDen2 += d * d;
          if (Math.abs(x) >= 0.04) {
            const home = x > 0;
            clv.bets++;
            const move = home ? d : -d;
            clv.clvSum += move;
            if (move > 0) clv.clvPos++;
            const win = home ? yy === 1 : yy === 0;
            const odds = decimal(home ? mk.mlHomeOpen : mk.mlAwayOpen);
            clv.profit += win ? odds - 1 : -1;
            if (win) clv.won++;
          }
        }
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
    const bk = cb(bucket(s.pHome));
    bk.n++;
    bk.pred += Math.max(s.pHome, 1 - s.pHome);
    bk.won += (s.pHome >= 0.5) === (y === 1) ? 1 : 0;
    hits += (s.pHome >= 0.5) === (y === 1) ? 1 : 0;
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
    // Autopsie du match.
    {
      const tot = (t: GameRecord['home'], k: string) => t.players.reduce((a, p) => a + (p.stats[k] ?? 0), 0);
      const real = (t: GameRecord['home']): Box => ({
        pts: t.score, fga: tot(t, 'fieldGoalsAttempted'), fgm: tot(t, 'fieldGoalsMade'), fg3a: tot(t, 'threePointersAttempted'), fg3m: tot(t, 'threePointersMade'),
        fta: tot(t, 'freeThrowsAttempted'), ftm: tot(t, 'freeThrowsMade'), tov: tot(t, 'turnovers'), oreb: tot(t, 'reboundsOffensive'),
      });
      const sim = (x: Record<string, number>): Box => ({ pts: x.pts, fga: x.fga, fgm: x.fgm, fg3a: x.fg3a, fg3m: x.fg3m, fta: x.fta, ftm: x.pts - 2 * x.fgm - x.fg3m, tov: x.tov, oreb: x.oreb });
      const dh = decompose(real(g.home), sim(s.teamStats.home));
      const da = decompose(real(g.away), sim(s.teamStats.away));
      const err = realMargin - s.margin.mean;
      const c = { a3: dh.a3 - da.a3, a2: dh.a2 - da.a2, aft: dh.aft - da.aft, vol: dh.vol - da.vol };
      auto.n++;
      auto.sq.err += err ** 2;
      for (const k of ['a3', 'a2', 'aft', 'vol'] as const) auto.sq[k] += c[k] ** 2;
      // Profil de tir réel (play-by-play) contre simulé, zone par zone.
      const CAT: Record<string, string> = { RA: 'au cercle', PAINT: 'raquette', MID: 'mi-distance', LC3: '3 pts de coin', RC3: '3 pts de coin', ATB3: '3 pts de face' };
      const pg = parseGame(g);
      const realProf = (tm: number) => {
        const p = { fga: [0, 0, 0, 0, 0, 0], fgm: [0, 0, 0, 0, 0, 0], trans: 0, astM: 0 };
        for (const sh of pg.shots) {
          if (sh.tm !== tm) continue;
          const z = ZONES.indexOf(sh.zone);
          p.fga[z]++;
          p.fgm[z] += sh.made;
          if (sh.fb) p.trans++;
          if (sh.made && sh.ast) p.astM++;
        }
        return p;
      };
      const zoneParts: Array<{ txt: string; v: number }> = [];
      const zc: Record<string, { adr: number; vol: number }> = {};
      for (const [side, t, sp] of [[1, g.home, s.shotProfile?.home], [-1, g.away, s.shotProfile?.away]] as const) {
        if (!sp) continue;
        const rp = realProf(t.id);
        const byCat: Record<string, { ra: number; rm: number; sa: number; sm: number; v: number }> = {};
        ZONES.forEach((zn, z) => {
          const cat = CAT[zn];
          const b = (byCat[cat] ??= { ra: 0, rm: 0, sa: 0, sm: 0, v: zn.endsWith('3') ? 3 : 2 });
          b.ra += rp.fga[z]; b.rm += rp.fgm[z]; b.sa += sp.fga[z]; b.sm += sp.fgm[z];
        });
        for (const [cat, b] of Object.entries(byCat)) {
          const ps = b.sa > 0 ? b.sm / b.sa : 0;
          const pr = b.ra > 0 ? b.rm / b.ra : 0;
          const adr = side * b.v * b.ra * (pr - ps);
          const vol = side * b.v * (b.ra - b.sa) * ps;
          const e = (zc[cat] ??= { adr: 0, vol: 0 });
          e.adr += adr;
          e.vol += vol;
          zoneParts.push({ txt: `${t.tri} ${cat} ${b.rm}/${b.ra} (${b.ra ? Math.round(pr * 100) : 0} %) contre ${b.sa.toFixed(1)} tirs à ${Math.round(ps * 100)} % simulés`, v: Math.abs(adr) + Math.abs(vol) });
        }
        auto.style.trans += Math.abs(rp.trans - sp.transFga);
        auto.style.transN++;
        const realMade = rp.fgm.reduce((a, v) => a + v, 0);
        const simMade = sp.fgm.reduce((a, v) => a + v, 0);
        if (realMade && simMade) {
          auto.style.ast += Math.abs(rp.astM / realMade - sp.astM / simMade);
          auto.style.astN++;
        }
        if (Math.abs(rp.trans - sp.transFga) >= 6) zoneParts.push({ txt: `${t.tri} contre-attaque ${rp.trans} tirs (simulé ${sp.transFga.toFixed(1)})`, v: 2 * Math.abs(rp.trans - sp.transFga) });
      }
      for (const [cat, e] of Object.entries(zc)) {
        const a = (auto.zones[cat] ??= { adr: 0, vol: 0 });
        a.adr += e.adr ** 2;
        a.vol += e.vol ** 2;
      }
      const tactical = zoneParts.sort((x, y) => y.v - x.v).slice(0, 3).map((z) => z.txt);
      // Joueurs : explosions (au-dessus de P90 de 5 pts ou plus) et minutes imprévues (10 min d'écart ou plus).
      const notes: string[] = [];
      for (const t of [g.home, g.away]) {
        for (const bp of t.players) {
          const ps = s.players.find((x) => x.id === bp.id);
          if (!ps || ps.playRate < 0.3) continue;
          if (bp.sec <= 0 && bp.reason && !bp.reason.includes('COACH')) {
            auto.lateOut++;
            notes.push(`${bp.name} forfait de dernière minute (${bp.reason.toLowerCase()}, simulé ${ps.stats.min.mean.toFixed(0)} min)`);
            continue;
          }
          const min = bp.sec / 60;
          auto.playersSeen++;
          const exp = ps.stats.min.mean;
          const b = `${bp.starter ? 'titulaire' : 'remplaçant'} ${exp >= 30 ? '30+' : exp >= 20 ? '20-30' : '<20'}`;
          const mb = (auto.minutes[b] ??= { n: 0, abs: 0, bias: 0, over8: 0 });
          mb.n++;
          mb.abs += Math.abs(min - exp);
          mb.bias += exp - min;
          if (Math.abs(min - exp) >= 8) mb.over8++;
          if (bp.sec > 0 && bp.stats.points - ps.stats.pts.p90 >= 5) {
            auto.explosions++;
            notes.push(`${bp.name} ${bp.stats.points} pts (simulé ${ps.stats.pts.mean.toFixed(1)}, P90 ${ps.stats.pts.p90.toFixed(0)})`);
          }
          if (Math.abs(min - exp) >= 10) notes.push(`${bp.name} ${min.toFixed(0)} min (simulé ${exp.toFixed(0)})`);
        }
      }
      const favHome = s.pHome >= 0.5;
      if (favHome !== realMargin > 0) {
        const lab: Record<string, string> = { a3: 'adresse à 3 pts', a2: 'adresse à 2 pts', aft: 'lancers francs', vol: 'volume (tirs, pertes, rebonds)' };
        const k = (Object.keys(c) as Array<keyof typeof c>).sort((x, y) => Math.sign(err) * c[y] - Math.sign(err) * c[x])[0];
        auto.drivers[lab[k]] = (auto.drivers[lab[k]] ?? 0) + 1;
        const pc = (v: number) => `${(v * 100).toFixed(0)} %`;
        auto.misses.push({
          game: `${g.away.tri}@${g.home.tri}`, date: g.date, real: `${g.away.score}-${g.home.score}`, sim: `${s.awayPts.mean.toFixed(0)}-${s.homePts.mean.toFixed(0)}`,
          pFav: Math.max(s.pHome, 1 - s.pHome), driver: lab[k],
          detail: `écart ${err > 0 ? '+' : ''}${err.toFixed(1)} : 3 pts ${c.a3 >= 0 ? '+' : ''}${c.a3.toFixed(1)} (${g.home.tri} ${pc(dh.p3r)} vs ${pc(dh.p3s)}, ${g.away.tri} ${pc(da.p3r)} vs ${pc(da.p3s)}), 2 pts ${c.a2 >= 0 ? '+' : ''}${c.a2.toFixed(1)}, LF ${c.aft >= 0 ? '+' : ''}${c.aft.toFixed(1)}, volume ${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(1)}`,
          players: [...tactical, ...notes.slice(0, 4)],
        });
      }
    }
    rows.push({ game: `${g.away.tri}@${g.home.tri}`, date: g.date, real: `${g.away.score}-${g.home.score}`, sim: `${s.awayPts.mean.toFixed(1)}-${s.homePts.mean.toFixed(1)}`, pHome: +s.pHome.toFixed(3) });
    if (!opts.quiet) console.log(`[${gi + 1}/${sample.length}] ${g.date} ${g.away.tri}@${g.home.tri} réel ${g.away.score}-${g.home.score} | sim ${s.awayPts.mean.toFixed(1)}-${s.homePts.mean.toFixed(1)} pDom ${(s.pHome * 100).toFixed(0)}% (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  for (const b of blend) b.brier /= Math.max(1, mkt.n);
  return { fullTables: !!opts.fullTables, market: mkt, blend: mkt.n ? blend : undefined, clv: clv.n ? clv : undefined, games: sample.length, team, marginMAE: mae, totalMAE: tmae, marginBias: mb, totalBias: tb, simMarginSd: msd, simTotalSd: tsd, brier, logloss: ll, coverage: cov, calib, accuracy: hits / sample.length, accuracyMkt: nMkt ? hitsMkt / nMkt : undefined, autopsy: auto, rows };
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
  if (r.blend) {
    const best = [...r.blend].sort((a, b) => a.brier - b.brier)[0];
    L.push(`Mélange (logit) part du modèle -> Brier : ${r.blend.map((b) => `${Math.round(b.w * 100)} % ${b.brier.toFixed(4)}`).join(' | ')} ; meilleur : ${Math.round(best.w * 100)} %`);
  }
  if (r.clv) {
    const c = r.clv;
    const n = c.n;
    const corr = (c.corrNum - (c.sx * c.sy) / n) / Math.sqrt((c.corrDen1 - (c.sx * c.sx) / n) * (c.corrDen2 - (c.sy * c.sy) / n));
    L.push(`Valeur de clôture (cotes d'ouverture, ${n} matchs) : corrélation (modèle - ouverture) / (clôture - ouverture) ${corr.toFixed(3)}`);
    if (c.bets) L.push(`  Écart modèle/ouverture ≥ 4 pts de % : ${c.bets} paris, la ligne bouge dans notre sens ${((c.clvPos / c.bets) * 100).toFixed(1)} % du temps (${((c.clvSum / c.bets) * 100).toFixed(2)} pts de % en moyenne), gagnés ${((c.won / c.bets) * 100).toFixed(1)} %, rendement à la cote d'ouverture ${((c.profit / c.bets) * 100).toFixed(1)} %`);
  }
  L.push(`Bon vainqueur annoncé : modèle ${(r.accuracy * 100).toFixed(1)} %${r.accuracyMkt != null ? ` | marché ${(r.accuracyMkt * 100).toFixed(1)} %` : ''}`);
  L.push('Calibration (confiance annoncée du favori -> part réellement gagnée)');
  for (const k of ['50-60', '60-70', '70-80', '80-90', '90-100']) {
    const c = r.calib[k];
    if (!c) continue;
    const mod = c.n ? `modèle ${(c.pred / c.n * 100).toFixed(1)} % annoncé -> ${(c.won / c.n * 100).toFixed(1)} % gagné (n=${c.n})` : 'modèle -';
    const mk = c.nMkt ? `marché ${(c.predMkt / c.nMkt * 100).toFixed(1)} % -> ${(c.wonMkt / c.nMkt * 100).toFixed(1)} % (n=${c.nMkt})` : 'marché -';
    L.push(`  ${k.padEnd(7)} ${mod} | ${mk}`);
  }
  L.push('Couverture des portées 80 % (cible : 80 % dedans, 10 % au-dessus, 10 % en dessous)');
  for (const [k, c] of Object.entries(r.coverage).filter(([k]) => k.startsWith('bias_'))) L.push(`  écart moyen de minutes (sim − réel) ${k.slice(5)} : ${(c.inside / c.n).toFixed(1)} (n=${c.n})`);
  for (const [k, c] of Object.entries(r.coverage).filter(([k]) => k.startsWith('ptsbias_'))) L.push(`  écart moyen de points (sim − réel) ${k.slice(8)} : ${(c.inside / c.n).toFixed(2)} (n=${c.n})`);
  for (const [k, c] of Object.entries(r.coverage).filter(([k]) => !k.startsWith('bias_') && !k.startsWith('ptsbias_'))) L.push(`  ${k.padEnd(5)} dedans ${(c.inside / c.n * 100).toFixed(1)}%  au-dessus ${(c.above / c.n * 100).toFixed(1)}%  en dessous ${(c.below / c.n * 100).toFixed(1)}%  (n=${c.n})`);
  const A = r.autopsy;
  if (A && A.n) {
    const sh = (v: number) => `${((v / A.sq.err) * 100).toFixed(0)} %`;
    L.push('');
    L.push(`Autopsie (${A.n} matchs) : part de l'erreur de marge (variance) liée à chaque écart réel - simulé`);
    L.push(`  adresse à 3 pts ${sh(A.sq.a3)} | adresse à 2 pts ${sh(A.sq.a2)} | lancers francs ${sh(A.sq.aft)} | volume (tirs, pertes, rebonds) ${sh(A.sq.vol)}`);
    L.push('  Par zone (part de la variance de l\'erreur) : adresse | volume (ce que la défense a laissé prendre)');
    for (const [cat, z] of Object.entries(A.zones)) L.push(`    ${cat.padEnd(14)} adresse ${sh(z.adr)} | volume ${sh(z.vol)}`);
    if (A.style.transN) L.push(`  Contre-attaque : écart moyen ${(A.style.trans / A.style.transN).toFixed(1)} tirs par équipe ; part des paniers après une passe : écart moyen ${((A.style.ast / Math.max(1, A.style.astN)) * 100).toFixed(1)} pts`);
    L.push(`  forfaits de dernière minute (actif sur la feuille, 0 min pour blessure ou repos) : ${A.lateOut}, retirés du tableau des minutes`);
    L.push(`  joueurs au-dessus de leur P90 de 5 pts ou plus : ${A.explosions} sur ${A.playersSeen} lignes (${((A.explosions / A.playersSeen) * 100).toFixed(1)} %)`);
    L.push('  Minutes (simulé - réel), par rôle réel et minutes attendues : erreur absolue moyenne, biais, part à 8 min ou plus');
    for (const [k, m] of Object.entries(A.minutes).sort()) L.push(`    ${k.padEnd(18)} ${(m.abs / m.n).toFixed(1)} min, biais ${(m.bias / m.n >= 0 ? '+' : '')}${(m.bias / m.n).toFixed(1)}, ${((m.over8 / m.n) * 100).toFixed(0)} % (n=${m.n})`);
    L.push(`  Favori battu (${A.misses.length} matchs), cause principale : ${Object.entries(A.drivers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    for (const m of A.misses) {
      L.push(`  - ${m.date} ${m.game} réel ${m.real}, simulé ${m.sim} (favori à ${(m.pFav * 100).toFixed(0)} %) : ${m.driver} | ${m.detail}`);
      for (const p of m.players) L.push(`      ${p}`);
    }
  }
  return L.join('\n');
}

if (import.meta.main) {
  // « _fullTables » dans les paramètres d'une variante : avec les tables de fin de saison (pour mesurer la fuite).
  const { _fullTables, ...params } = arg('params') ? JSON.parse(arg('params')!) : {};
  const r = await backtest({
    from: arg('from', '2026-01-10')!, to: arg('to', '2026-04-12')!, games: Number(arg('games', '30')), n: Number(arg('n', '400')),
    params,
    market: !process.argv.includes('--no-market'),
    noStrength: process.argv.includes('--no-strength'),
    fullTables: process.argv.includes('--full-tables') || !!_fullTables,
  });
  console.log(r.fullTables ? 'Tables stats.nba.com : saison du match incluse (totaux de fin de saison, fuite possible)' : 'Tables stats.nba.com : saisons précédentes uniquement (aucune donnée postérieure au match)');
  const txt = printBacktest(r);
  console.log('\n' + txt);
  mkdirSync(join(ROOT, 'out', 'backtests'), { recursive: true });
  const f = join(ROOT, 'out', 'backtests', `bt_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(f, JSON.stringify({ args: process.argv.slice(2), ...r }, null, 1));
  console.log(`\nDétails : ${f}`);
}
