// Tennis point par point : contrôle du moteur au milieu des sets et apprentissage du poids des fautes directes, des coups
// gagnants et de la forme du moment, sur les matchs relevés coup par coup du Match Charting Project (Jeff Sackmann).
//
//   git clone --depth 1 https://github.com/JeffSackmann/tennis_MatchChartingProject <dossier>
//   node src/cli/livetennisstats.ts <dossier>          écrit src/live/tennis-weights.json et affiche le contrôle
//
// LICENCE DES DONNÉES : CC BY-NC-SA 4.0, usage non commercial seulement (attribution : The Tennis Abstract Match Charting
// Project). Les poids appris ici servent aux essais personnels ; avant toute mise en ligne payante, les réapprendre avec
// les données du fournisseur sous licence (même programme, autre lecteur de points).
//
// Probabilité d'avant-match : cotes Pinnacle de tennis-data.co.uk (data/cache/tennis/td/td.json, voir livetennis.ts),
// reliées par les noms et la date. Apprentissage : matchs de 2024 ; contrôle : 2025-2026 (jamais vus).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { calibrateTennis } from '../live/tennis.ts';
import tennisParams from '../live/tennis-params.json' with { type: 'json' };
import type { TennisLiveParams } from '../live/tennis.ts';
import { NEUTRAL_WEIGHTS, tennisFromStats, type PointWeights } from '../live/stats/tennis-engine.ts';
import { pointFromMcp, stateFromPoints, type TennisPoint } from '../live/stats/tennis-points.ts';

const P0 = tennisParams as TennisLiveParams;
const DIR = process.argv[2] ?? '/home/user/jeffsackmann/tennis_matchchartingproject';
const ROOT = join(import.meta.dirname, '..', '..');

function csv(file: string): Array<Record<string, string>> {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows[0];
  return rows.slice(1).filter((r) => r.length >= head.length - 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// --- Matchs et cotes -------------------------------------------------------------------------------------------------
const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const mcpKey = (full: string) => { const t = ascii(full).split(' '); return `${t.slice(1).join(' ')}|${t[0]?.[0] ?? ''}`; };
const tdKey = (n: string) => { const m = n.match(/^(.*?)\s+([A-Z])[A-Za-z.\-]*\.?$/); return m ? `${ascii(m[1])}|${m[2].toLowerCase()}` : `${ascii(n)}|`; };

type TD = { Date: string; Winner: string; Loser: string; PSW?: number; PSL?: number; Surface?: string };
const td = (JSON.parse(readFileSync(join(ROOT, 'data', 'cache', 'tennis', 'td', 'td.json'), 'utf8')) as TD[]).filter((r) => r.PSW && r.PSL);
const tdBy = new Map<string, TD[]>();
for (const r of td) for (const k of [`${tdKey(r.Winner)}#${tdKey(r.Loser)}`, `${tdKey(r.Loser)}#${tdKey(r.Winner)}`]) (tdBy.get(k) ?? tdBy.set(k, []).get(k)!).push(r);

interface M { id: string; date: string; bo: 3 | 5; surface: string; p1: string; p2: string; p0: number; pts: TennisPoint[]; aWins: boolean }
const matches = csv(join(DIR, 'charting-m-matches.csv'));
const meta = new Map<string, { date: string; bo: 3 | 5; surface: string; p1: string; p2: string; p0: number }>();
for (const m of matches) {
  const d = m.Date;
  if (!/^202[4-6]/.test(d)) continue;
  const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const cands = tdBy.get(`${mcpKey(m['Player 1'])}#${mcpKey(m['Player 2'])}`) ?? [];
  const r = cands.find((x) => Math.abs(Date.parse(x.Date) - Date.parse(date)) < 16 * 86_400_000);
  if (!r) continue;
  const pw = (1 / r.PSW!) / (1 / r.PSW! + 1 / r.PSL!);
  const p1IsWinner = tdKey(r.Winner) === mcpKey(m['Player 1']);
  meta.set(m.match_id, { date, bo: m['Best of'] === '5' ? 5 : 3, surface: m.Surface || r.Surface || 'Hard', p1: m['Player 1'], p2: m['Player 2'], p0: p1IsWinner ? pw : 1 - pw });
}
console.log(`matchs relevés 2024-26 reliés aux cotes : ${meta.size}`);

const byMatch = new Map<string, TennisPoint[]>();
for (const r of csv(join(DIR, 'charting-m-points-2020s.csv'))) {
  if (!meta.has(r.match_id)) continue;
  const server = (r.Svr === '2' ? 1 : 0) as 0 | 1, winner = (r.PtWinner === '2' ? 1 : 0) as 0 | 1;
  const p = pointFromMcp(r['1st'], r['2nd'], server, winner);
  p.set = Number(r.Set1) + Number(r.Set2) + 1;
  // Balle de break : le relanceur est à un point du jeu (score du serveur d'abord, hors jeu décisif).
  const [a, b] = (r.Pts ?? '').split('-');
  p.breakPoint = (b === '40' && a !== '40' && a !== 'AD') || (a === '40' && b === 'AD') ? true : undefined;
  (p as TennisPoint & { n?: number }).n = Number(r.Pt);
  (byMatch.get(r.match_id) ?? byMatch.set(r.match_id, []).get(r.match_id)!).push(p);
}
// Les points d'un match ne sont pas rangés dans l'ordre dans le fichier : tri par numéro de point.
for (const pts of byMatch.values()) pts.sort((a, b) => ((a as { n?: number }).n ?? 0) - ((b as { n?: number }).n ?? 0));
const all: M[] = [];
let dropped = 0;
for (const [id, pts] of byMatch) {
  const m = meta.get(id)!;
  const won = [0, 0];
  for (const p of pts) won[p.winner]++;
  if (pts.length < 60) continue;
  // Match relevé jusqu'au bout : le score refait à partir des points doit désigner un vainqueur, celui du dernier point.
  const fin = stateFromPoints(pts, m.bo);
  const need = m.bo === 5 ? 3 : 2;
  const sa = fin.sets.filter(([a, b]) => a > b).length, sb = fin.sets.length - sa;
  if (Math.max(sa, sb) !== need || (sa === need) !== (pts[pts.length - 1].winner === 0)) { dropped++; continue; }
  all.push({ id, ...m, pts, aWins: sa === need });
}
const train = all.filter((m) => m.date < '2025-01-01'), test = all.filter((m) => m.date >= '2025-01-01');
console.log(`écartés (score incohérent ou match inachevé) : ${dropped}`);
console.log(`matchs complets : ${all.length} (apprentissage 2024 : ${train.length}, contrôle 2025-26 : ${test.length})`);

// --- Situations : tous les 16 points -----------------------------------------------------------------------------------
const STEP = 16;
const bases = new Map<string, [number, number]>();
const baseOf = (m: M) => bases.get(m.id) ?? bases.set(m.id, calibrateTennis(P0, m.p0, m.surface, m.bo)).get(m.id)!;
type Mode = 'score' | 'points';
function evaluate(list: M[], mode: Mode, W: PointWeights, P: TennisLiveParams = P0, bucket?: (p: number, ok: boolean, trailing: boolean) => void): { ll: number; n: number } {
  let ll = 0, n = 0;
  for (const m of list) {
    const base = baseOf(m);
    for (let k = STEP; k < m.pts.length - 2; k += STEP) {
      const log = m.pts.slice(0, k);
      // Score seul : le moteur ne voit que les sets, les jeux, les points du jeu en cours et le serveur.
      const st = mode === 'score' ? stateFromPoints(log, m.bo) : undefined;
      const o = tennisFromStats(base, st ? { bestOf: m.bo, sets: st.sets, games: st.games, points: st.points, server: st.server } : { bestOf: m.bo, pointLog: log }, P, W);
      const p = m.aWins ? o.win[0] : o.win[1];
      if (!Number.isFinite(p)) { if (process.env.DEBUG) console.log('NaN', m.id, k, mode, JSON.stringify(st ?? o.read.servePts)); continue; }
      ll -= Math.log(Math.max(1e-9, p)); n++;
      if (bucket && o.comeback) bucket(o.comeback.win, (o.comeback.side === 0) === m.aWins, true);
    }
  }
  return { ll: ll / n, n };
}

{
  let ll = 0;
  for (const m of test) ll -= Math.log(m.aWins ? m.p0 : 1 - m.p0);
  console.log(`contrôle, avant le match (cotes seules) : log-loss ${(ll / test.length).toFixed(4)}`);
}
const t0 = Date.now();
const sc = evaluate(train, 'score', NEUTRAL_WEIGHTS);
const pn = evaluate(train, 'points', NEUTRAL_WEIGHTS);
console.log(`apprentissage — score seul : ${sc.ll.toFixed(4)} | points au service (poids 1) : ${pn.ll.toFixed(4)} (${sc.n} situations, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);

const sub = train.filter((_, i) => i % 2 === 0);
// 1) Forme durable et variation propre au set, réglées sur le point par point (au lieu des seules fins de set).
let bestP = { ll: evaluate(sub, 'points', NEUTRAL_WEIGHTS).ll, formSd: P0.formSd, setSd: P0.setSd };
for (const formSd of [0.165, 0.24]) for (const setSd of [0.24, 0.4, 0.55]) {
  if (formSd === P0.formSd && setSd === P0.setSd) continue;
  const r = evaluate(sub, 'points', NEUTRAL_WEIGHTS, { ...P0, formSd, setSd });
  if (r.ll < bestP.ll) bestP = { ll: r.ll, formSd, setSd };
}
const P1: TennisLiveParams = { ...P0, formSd: bestP.formSd, setSd: bestP.setSd };
bases.clear();
console.log(`forme du jour ${bestP.formSd}, variation par set ${bestP.setSd}`);
// 2) Poids des fins de point et de la forme du moment.
let best = { ll: evaluate(sub, 'points', NEUTRAL_WEIGHTS, P1).ll, W: NEUTRAL_WEIGHTS, pointW: undefined as number | undefined };
for (const [ue, recent] of [[0.8, 0], [1.2, 0], [1, 0.75]] as const) {
  const W: PointWeights = { outcome: { ...NEUTRAL_WEIGHTS.outcome, unforced_error: ue, double_fault: ue }, recent };
  const r = evaluate(sub, 'points', W, P1);
  if (r.ll < best.ll) best = { ll: r.ll, W, pointW: undefined };
}
console.log(`retenu : poids fautes directes ${best.W.outcome.unforced_error}, coups gagnants ${best.W.outcome.winner}, forme du moment +${best.W.recent}`);
writeFileSync(join(ROOT, 'src', 'live', 'tennis-weights.json'), JSON.stringify({
  ...best.W, pointW: best.pointW ?? null, formSd: P1.formSd, setSd: P1.setSd, builtAt: new Date().toISOString().slice(0, 10),
  source: 'Match Charting Project (CC BY-NC-SA 4.0) — essais personnels uniquement, à réapprendre avec les données sous licence avant mise en ligne',
}, null, 1));

// --- Contrôle -----------------------------------------------------------------------------------------------------------
const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
const bins = () => Array.from({ length: 10 }, () => ({ n: 0, p: 0, ok: 0 }));
const run = (name: string, mode: Mode, W: PointWeights, P: TennisLiveParams) => {
  const B = bins();
  const r = evaluate(test, mode, W, P, (p, ok) => { const b = B[Math.max(0, Math.min(9, Math.floor(p * 10)))]; b.n++; b.p += p; b.ok += ok ? 1 : 0; });
  console.log(`\n${name} : log-loss ${r.ll.toFixed(4)} (${r.n} situations)`);
  console.log('  remontée du joueur mené (annoncé -> réel) : ' + B.filter((b) => b.n >= 20).map((b) => `${pc(b.p / b.n)}->${pc(b.ok / b.n)} (${b.n})`).join(' | '));
};
console.log('\n=== Contrôle 2025-26 (matchs jamais vus), tous les 16 points ===');
bases.clear();
run('Score seul (sets, jeux, points)', 'score', NEUTRAL_WEIGHTS, P0);
run('+ points au service', 'points', NEUTRAL_WEIGHTS, P0);
bases.clear();
run('+ forme réglée sur le point par point', 'points', NEUTRAL_WEIGHTS, P1);
run('+ fautes directes, forme du moment (poids appris)', 'points', best.W, P1);
