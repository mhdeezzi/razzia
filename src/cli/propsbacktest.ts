// Backtest des props joueurs : lignes DraftKings archivées par ESPN vs simulations (données antérieures au match)
// vs résultats réels. Mesure calibration, Brier modèle/marché/mélange, biais, et rendement des paris à edge.
//   node src/cli/propsbacktest.ts --from 2026-01-01 --to 2026-06-30 [--n 1000] [--max 120]
//   node src/cli/propsbacktest.ts --analyze out/backtests/props_rows.json
import { readdirSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, readCache, ROOT, fetchJson, pool } from '../data/http.ts';
import type { GameRecord } from '../data/cdn.ts';
import { getProps, noVig, americanToProb } from '../data/espn.ts';
import { buildGameModel, normName } from '../nba/model/build.ts';
import { calibratePace, calibrateStrength, runSims, PROP_MAP } from '../nba/engine/montecarlo.ts';
import { stat } from '../nba/engine/batch.ts';
import { fitLogit, lg, marketGroup, savePropCal, type PropCal } from '../nba/model/propcal.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

export interface PropRow {
  date: string;
  game: string;
  playoffs: boolean;
  player: string;
  market: string;
  line: number;
  oddsA: number; // cote du 1er côté listé par ESPN
  oddsB: number; // cote du 2e côté
  pMktA: number; // probabilité sans marge du 1er côté
  pOver: number; // modèle : P(> ligne | joue), poussées exclues
  simMean: number;
  simSd: number;
  actual: number;
  notes: string;
  gpCur: number;
  openLine?: number;
  openA?: number;
  openB?: number;
  pOverOpen?: number; // modèle à la ligne d'ouverture
}

const ESPN_TRI: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' };
const ACTUAL_KEY: Record<string, string> = {
  pts: 'points', reb: 'reboundsTotal', ast: 'assists', fg3m: 'threePointersMade', stl: 'steals', blk: 'blocks', tov: 'turnovers',
};

/** Matchs ESPN (avec props DraftKings archivées) entre deux dates. */
async function propEvents(from: string, to: string): Promise<Array<{ date: string; id: string; home: string; away: string }>> {
  const out: Array<{ date: string; id: string; home: string; away: string }> = [];
  const dates: string[] = [];
  for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  await pool(dates, 6, async (d) => {
    const sb = await fetchJson<any>(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replaceAll('-', '')}`, {
      ttlHours: 24 * 365, namespace: 'espn', cacheKey: `scoreboard_hist_${d}`,
    }).catch(() => undefined);
    for (const e of sb?.events ?? []) {
      const c = e.competitions?.[0];
      const h = c?.competitors?.find((x: any) => x.homeAway === 'home')?.team?.abbreviation;
      const a = c?.competitors?.find((x: any) => x.homeAway === 'away')?.team?.abbreviation;
      if (h && a) out.push({ date: d, id: e.id, home: ESPN_TRI[h] ?? h, away: ESPN_TRI[a] ?? a });
    }
  });
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

async function collect(from: string, to: string, n: number, max: number): Promise<PropRow[]> {
  const games = new Map<string, GameRecord>();
  for (const f of readdirSync(join(CACHE_DIR, 'games'))) {
    const g = readCache<GameRecord>('games', f.replace('.json.gz', ''))!;
    games.set(`${g.date}|${g.away.tri}@${g.home.tri}`, g);
  }
  const events = await propEvents(from, to);
  const rows: PropRow[] = [];
  let done = 0;
  for (const ev of events) {
    if (done >= max) break;
    const g = games.get(`${ev.date}|${ev.away}@${ev.home}`);
    if (!g) continue;
    const props = await getProps(ev.id, 24 * 365);
    if (!props.length) continue;
    done++;
    const t0 = Date.now();
    const m = await buildGameModel({ date: g.date, homeTri: g.home.tri, awayTri: g.away.tri, gameId: g.gameId, actual: g, injuries: false, market: false, passes: false });
    calibratePace(m, 150);
    calibrateStrength(m, 200);
    const b = await runSims(m, n, 101 + done);
    const idx = new Map(b.players.map((id, k) => [id, k]));
    const models = new Map([...m.home.players, ...m.away.players].map((p) => [normName(p.name), p]));
    const box = new Map([...g.home.players, ...g.away.players].map((p) => [normName(p.name), p]));
    let kept = 0;
    for (const pr of props) {
      const keys = PROP_MAP[pr.market];
      if (!keys || pr.line == null || pr.over == null || pr.under == null) continue;
      const pm = models.get(normName(pr.player));
      const bp = box.get(normName(pr.player));
      if (!pm || !bp || bp.sec <= 0) continue; // non partant : pari annulé
      const k = idx.get(pm.id)!;
      let over = 0, under = 0, s1 = 0, s2 = 0, cnt = 0, oo = 0, ou = 0;
      const ol = pr.openLine ?? pr.line;
      for (let i = 0; i < b.n; i++) {
        if (stat(b, i, k, 'played') <= 0) continue;
        const v = keys.reduce((a, kk) => a + stat(b, i, k, kk), 0);
        s1 += v;
        s2 += v * v;
        cnt++;
        if (v > pr.line) over++;
        else if (v < pr.line) under++;
        if (v > ol) oo++;
        else if (v < ol) ou++;
      }
      if (!cnt) continue;
      const actual = keys.reduce((a, kk) => a + ((kk === 'reb' ? bp.stats.reboundsTotal : bp.stats[ACTUAL_KEY[kk]]) ?? 0), 0);
      const mean = s1 / cnt;
      rows.push({
        date: g.date, game: `${g.away.tri}@${g.home.tri}`, playoffs: g.gameId.startsWith('004'), player: pr.player, market: pr.market,
        line: pr.line, oddsA: pr.over, oddsB: pr.under, pMktA: noVig(pr.over, pr.under)[0], pOver: over / Math.max(1, over + under),
        simMean: mean, simSd: Math.sqrt(Math.max(0, s2 / cnt - mean * mean)), actual, notes: pm.notes.join('; '), gpCur: pm.form.gpCur ?? 0,
        openLine: pr.openLine, openA: pr.openOver, openB: pr.openUnder, pOverOpen: oo / Math.max(1, oo + ou),
      });
      kept++;
    }
    console.log(`[${done}] ${g.date} ${g.away.tri}@${g.home.tri} : ${kept} lignes (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  return rows;
}

// ------------------------------------------------------------------ analyse
const profit = (odds: number, win: boolean) => (win ? (odds > 0 ? odds / 100 : 100 / -odds) : -1);

export function analyze(rows: PropRow[], orderOverFirst: boolean): string {
  const L: string[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const valid = rows.filter((r) => r.actual !== r.line);
  // Sens réel de la paire (ESPN ne l'indique pas) : vérifié sur les résultats.
  const R = valid.map((r) => {
    const pOverMkt = orderOverFirst ? r.pMktA : 1 - r.pMktA;
    const oddsOver = orderOverFirst ? r.oddsA : r.oddsB;
    const oddsUnder = orderOverFirst ? r.oddsB : r.oddsA;
    return { ...r, pOverMkt, oddsOver, oddsUnder, y: r.actual > r.line ? 1 : 0 };
  });
  const brier = (f: (r: (typeof R)[number]) => number, set = R) => set.reduce((a, r) => a + (f(r) - r.y) ** 2, 0) / Math.max(1, set.length);
  const ll = (f: (r: (typeof R)[number]) => number, set = R) => set.reduce((a, r) => { const p = Math.min(0.99, Math.max(0.01, f(r))); return a - (r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)); }, 0) / Math.max(1, set.length);
  L.push(`Lignes évaluées : ${R.length} (poussées exclues), matchs : ${new Set(R.map((r) => r.date + r.game)).size}, dont playoffs : ${R.filter((r) => r.playoffs).length}`);
  L.push(`Taux d'Over réel : ${pct(R.reduce((a, r) => a + r.y, 0) / R.length)} ; Over implicite marché moyen : ${pct(R.reduce((a, r) => a + r.pOverMkt, 0) / R.length)} ; Over modèle moyen : ${pct(R.reduce((a, r) => a + r.pOver, 0) / R.length)}`);
  L.push('');
  L.push('Brier (plus bas = mieux) — modèle / marché / mélanges w·modèle + (1-w)·marché');
  const groups: Record<string, (r: (typeof R)[number]) => boolean> = {
    Tous: () => true, Points: (r) => r.market === 'Total Points', Rebonds: (r) => r.market === 'Total Rebounds', Passes: (r) => r.market === 'Total Assists',
    '3PM': (r) => r.market === 'Total 3-Point Field Goals', Combos: (r) => /and/.test(r.market), 'Stl/Blk': (r) => /Steals|Blocks/.test(r.market),
  };
  const ws = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1];
  for (const [name, f] of Object.entries(groups)) {
    const set = R.filter(f);
    if (set.length < 30) continue;
    const scores = ws.map((w) => brier((r) => w * r.pOver + (1 - w) * r.pOverMkt, set));
    const best = ws[scores.indexOf(Math.min(...scores))];
    L.push(`  ${name.padEnd(8)} n=${String(set.length).padStart(5)} ${ws.map((w, i) => `w${w}:${scores[i].toFixed(4)}`).join(' ')} → meilleur w=${best}`);
  }
  L.push('');
  L.push(`Log-loss : modèle ${ll((r) => r.pOver).toFixed(4)} | marché ${ll((r) => r.pOverMkt).toFixed(4)} | mélange 0,3 ${ll((r) => 0.3 * r.pOver + 0.7 * r.pOverMkt).toFixed(4)}`);
  L.push('');
  L.push('Calibration du modèle (P(Over) prédite → fréquence réelle)');
  for (let b = 0; b < 10; b++) {
    const set = R.filter((r) => r.pOver >= b / 10 && r.pOver < (b + 1) / 10);
    if (set.length < 15) continue;
    L.push(`  ${(b * 10).toString().padStart(2)}–${(b + 1) * 10}% : n=${String(set.length).padStart(5)} prédit ${pct(set.reduce((a, r) => a + r.pOver, 0) / set.length)} réel ${pct(set.reduce((a, r) => a + r.y, 0) / set.length)}`);
  }
  L.push('');
  L.push('Biais par marché : moyenne (sim − ligne) vs (réel − ligne)');
  for (const [name, f] of Object.entries(groups)) {
    const set = R.filter(f);
    if (set.length < 30 || name === 'Tous') continue;
    const sm = set.reduce((a, r) => a + r.simMean - r.line, 0) / set.length;
    const rl = set.reduce((a, r) => a + r.actual - r.line, 0) / set.length;
    L.push(`  ${name.padEnd(8)} sim−ligne ${sm.toFixed(2).padStart(6)} | réel−ligne ${rl.toFixed(2).padStart(6)}`);
  }
  L.push('');
  L.push('Rendement des paris (1 unité, cote réelle) quand l\'edge dépasse le seuil');
  for (const [label, w] of [['modèle brut', 1], ['mélange 0,3', 0.3], ['mélange 0,5', 0.5]] as const) {
    for (const t of [0.03, 0.06, 0.1]) {
      let n = 0, won = 0, pnl = 0;
      for (const r of R) {
        const p = w * r.pOver + (1 - w) * r.pOverMkt;
        const eOver = p - r.pOverMkt;
        if (Math.abs(eOver) < t) continue;
        const betOver = eOver > 0;
        const win = betOver ? r.y === 1 : r.y === 0;
        n++;
        if (win) won++;
        pnl += profit(betOver ? r.oddsOver : r.oddsUnder, win);
      }
      if (n) L.push(`  ${label.padEnd(12)} seuil ${pct(t)} : ${String(n).padStart(5)} paris, gagnés ${pct(won / n)}, ROI ${pct(pnl / n)}`);
    }
  }
  void americanToProb;
  return L.join('\n');
}

/**
 * Ligne d'ouverture : (1) rendement en pariant à l'ouverture quand le modèle s'écarte du marché d'ouverture ;
 * (2) valeur de clôture (CLV) : la ligne bouge-t-elle ensuite dans le sens du modèle ?
 */
export function analyzeOpen(rows: PropRow[]): string {
  const L: string[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const R = rows.filter((r) => r.openLine != null && r.openA != null && r.openB != null && r.pOverOpen != null && r.actual !== r.openLine);
  if (!R.length) return 'Pas de lignes d\'ouverture disponibles.';
  const moved = R.filter((r) => r.openLine !== r.line || r.openA !== r.oddsA);
  L.push(`Lignes avec ouverture : ${R.length}, dont ${moved.length} ont bougé avant la clôture`);
  for (const w of [1, 0.5, 0.3]) {
    for (const t of [0.04, 0.08, 0.12]) {
      let n = 0, won = 0, pnl = 0, clvN = 0, clvGood = 0;
      for (const r of R) {
        const pMktO = noVig(r.openA!, r.openB!)[0];
        const p = w * r.pOverOpen! + (1 - w) * pMktO;
        const e = p - pMktO;
        if (Math.abs(e) < t) continue;
        const over = e > 0;
        const y = r.actual > r.openLine! ? 1 : 0;
        const win = over ? y === 1 : y === 0;
        n++;
        if (win) won++;
        pnl += profit(over ? r.openA! : r.openB!, win);
        // CLV : probabilité d'Over du marché à la clôture, ramenée à la ligne d'ouverture (approximation : la ligne prime).
        const pClose = noVig(r.oddsA, r.oddsB)[0];
        const towardOver = r.line > r.openLine! || (r.line === r.openLine && pClose > pMktO + 0.01);
        const towardUnder = r.line < r.openLine! || (r.line === r.openLine && pClose < pMktO - 0.01);
        if (towardOver || towardUnder) {
          clvN++;
          if ((over && towardOver) || (!over && towardUnder)) clvGood++;
        }
      }
      if (n) L.push(`  ${w === 1 ? 'sims brutes' : `mélange ${w}`} edge ≥ ${pct(t)} : ${String(n).padStart(5)} paris à l'ouverture, gagnés ${pct(won / n)}, ROI ${pct(pnl / n)} | la ligne bouge dans notre sens ${clvN ? pct(clvGood / clvN) : '–'} (${clvN} mouvements)`);
    }
  }
  return L.join('\n');
}

/** Validation croisée par match (5 plis) de l'empilement logistique, puis ajustement final enregistré. */
export function fitAndValidate(rows: PropRow[], overFirst: boolean, save: boolean): string {
  const L: string[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const R = rows.filter((r) => r.actual !== r.line).map((r) => ({
    ...r,
    pOverMkt: overFirst ? r.pMktA : 1 - r.pMktA,
    oddsOver: overFirst ? r.oddsA : r.oddsB,
    oddsUnder: overFirst ? r.oddsB : r.oddsA,
    y: r.actual > r.line ? 1 : 0,
    grp: marketGroup(r.market),
    key: `${r.date}|${r.game}`,
  }));
  const hash = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const fold = (k: string) => hash(k) % 5;
  const feats = (r: (typeof R)[number]) => [1, lg(r.pOver), lg(r.pOverMkt)];
  const fitGroups = (train: typeof R) => {
    const out: Record<string, number[]> = { all: fitLogit(train.map(feats), train.map((r) => r.y)) };
    for (const g of new Set(train.map((r) => r.grp))) {
      const set = train.filter((r) => r.grp === g);
      if (set.length >= 250) out[g] = fitLogit(set.map(feats), set.map((r) => r.y));
    }
    return out;
  };
  const pred = (w: Record<string, number[]>, r: (typeof R)[number]) => {
    const c = w[r.grp] ?? w.all;
    const z = feats(r).reduce((a, v, j) => a + v * c[j], 0);
    return 1 / (1 + Math.exp(-z));
  };
  const cv = new Map<(typeof R)[number], number>();
  for (let f = 0; f < 5; f++) {
    const train = R.filter((r) => fold(r.key) !== f);
    const test = R.filter((r) => fold(r.key) === f);
    const w = fitGroups(train);
    for (const r of test) cv.set(r, pred(w, r));
  }
  const brier = (f: (r: (typeof R)[number]) => number) => R.reduce((a, r) => a + (f(r) - r.y) ** 2, 0) / R.length;
  const ll = (f: (r: (typeof R)[number]) => number) => R.reduce((a, r) => { const p = Math.min(0.99, Math.max(0.01, f(r))); return a - (r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)); }, 0) / R.length;
  L.push(`Validation croisée par match (5 plis, ${R.length} lignes, ${new Set(R.map((r) => r.key)).size} matchs)`);
  L.push(`  Brier : marché ${brier((r) => r.pOverMkt).toFixed(4)} | sims ${brier((r) => r.pOver).toFixed(4)} | empilement ${brier((r) => cv.get(r)!).toFixed(4)}`);
  L.push(`  Log-loss : marché ${ll((r) => r.pOverMkt).toFixed(4)} | sims ${ll((r) => r.pOver).toFixed(4)} | empilement ${ll((r) => cv.get(r)!).toFixed(4)}`);
  for (const g of [...new Set(R.map((r) => r.grp))]) {
    const set = R.filter((r) => r.grp === g);
    const b = (f: (r: (typeof R)[number]) => number) => set.reduce((a, r) => a + (f(r) - r.y) ** 2, 0) / set.length;
    L.push(`  ${g.padEnd(9)} n=${String(set.length).padStart(5)} Brier marché ${b((r) => r.pOverMkt).toFixed(4)} | empilement ${b((r) => cv.get(r)!).toFixed(4)}`);
  }
  L.push('  Paris hors échantillon (cote réelle, 1 unité) sur la probabilité empilée :');
  for (const t of [0.02, 0.04, 0.06, 0.08]) {
    let n = 0, won = 0, pnl = 0;
    for (const r of R) {
      const p = cv.get(r)!;
      const e = p - r.pOverMkt;
      if (Math.abs(e) < t) continue;
      const over = e > 0;
      const win = over ? r.y === 1 : r.y === 0;
      n++;
      if (win) won++;
      pnl += profit(over ? r.oddsOver : r.oddsUnder, win);
    }
    if (n) L.push(`    edge ≥ ${pct(t)} : ${String(n).padStart(5)} paris, gagnés ${pct(won / n)}, ROI ${pct(pnl / n)}`);
  }
  const final = fitGroups(R);
  L.push('  Coefficients finaux (a + b·logit sims + c·logit marché) :');
  for (const [g, c] of Object.entries(final)) L.push(`    ${g.padEnd(9)} a=${c[0].toFixed(3)} b=${c[1].toFixed(3)} c=${c[2].toFixed(3)}`);
  if (save) {
    const cal: PropCal = {
      fittedAt: new Date().toISOString(), rows: R.length, games: new Set(R.map((r) => r.key)).size,
      groups: Object.fromEntries(Object.entries(final).map(([g, c]) => [g, { a: c[0], b: c[1], c: c[2], n: g === 'all' ? R.length : R.filter((r) => r.grp === g).length }])),
    };
    savePropCal(cal);
    L.push('  → calibration enregistrée dans data/calibration/props.json (utilisée par les sims)');
  }
  return L.join('\n');
}

if (import.meta.main) {
  let rows: PropRow[];
  const file = arg('analyze');
  if (file) rows = JSON.parse(readFileSync(file, 'utf8'));
  else {
    rows = await collect(arg('from', '2026-01-01')!, arg('to', '2026-06-30')!, Number(arg('n', '1000')), Number(arg('max', '150')));
    mkdirSync(join(ROOT, 'out', 'backtests'), { recursive: true });
    const f = join(ROOT, 'out', 'backtests', 'props_rows.json');
    writeFileSync(f, JSON.stringify(rows));
    console.log(`Lignes enregistrées : ${f}`);
  }
  // Détermination du sens des paires ESPN à partir des résultats.
  const valid = rows.filter((r) => r.actual !== r.line);
  const hi = valid.filter((r) => r.pMktA > 0.6);
  const lo = valid.filter((r) => r.pMktA < 0.4);
  const overRate = (s: PropRow[]) => s.reduce((a, r) => a + (r.actual > r.line ? 1 : 0), 0) / Math.max(1, s.length);
  const overFirst = overRate(hi) > overRate(lo);
  console.log(`\nSens des paires ESPN : quand le 1er côté est favori (n=${hi.length}), Over réel ${(overRate(hi) * 100).toFixed(1)}% ; quand il est outsider (n=${lo.length}), ${(overRate(lo) * 100).toFixed(1)}% → 1er côté = ${overFirst ? 'OVER' : 'UNDER'}\n`);
  console.log(analyze(rows, overFirst));
  console.log('\n' + fitAndValidate(rows, overFirst, process.argv.includes('--save')));
  console.log('\nLigne d\'ouverture et valeur de clôture\n' + analyzeOpen(rows));
}
