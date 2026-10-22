// Simule un match N fois et produit : résumé des distributions, props, match typique (pour le rendu 2D).
//   node src/cli/sim.ts --game OKC@SAS --date 2026-10-20 [--n 5000] [--out "Nom1,Nom2"] [--in "Nom"] [--seed 7]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGameModel } from '../nba/model/build.ts';
import { calibratePace, calibrateStrength, runSims, summarize, typicalGame, type Summary } from '../nba/engine/montecarlo.ts';
import { getSchedule, getGame } from '../data/cdn.ts';
import { ROOT } from '../data/http.ts';
import type { GameModel } from '../nba/model/types.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

export interface SimRunOpts {
  away: string;
  home: string;
  date: string;
  n: number;
  seed: number;
  out?: string[];
  in?: string[];
  quiet?: boolean;
}

export async function simulateMatchup(o: SimRunOpts): Promise<{ dir: string; model: GameModel; summary: Summary }> {
  const say = o.quiet ? () => {} : log;
  const sched = await getSchedule(6).catch(() => undefined);
  const sg = sched?.games.find((g) => g.date === o.date && g.home.tri === o.home && g.away.tri === o.away);
  // Match déjà joué : statuts réels des absents (équivalent du rapport de blessures d'avant-match).
  const actual = sg && sg.status === 3 ? await getGame(sg.gameId) : undefined;
  const t0 = Date.now();
  const model = await buildGameModel({
    date: o.date, homeTri: o.home, awayTri: o.away, gameId: sg?.gameId, out: o.out, in: o.in, actual,
    injuries: !actual, market: true, passes: true, log: say,
  });
  say(`modèle construit en ${((Date.now() - t0) / 1000).toFixed(1)} s (données jusqu'au ${model.meta.dataThrough}, ${model.meta.gamesUsed} matchs)`);
  const cal = calibratePace(model);
  say(`rythme : cible ${cal.target.toFixed(1)} poss/48, simulé ${cal.got.toFixed(1)} (échelle ${model.params.durScale.toFixed(3)})`);
  const st = calibrateStrength(model);
  say(`force collective : cible ${st.target.map((v) => v.toFixed(3)).join('/')} pts/poss, joueurs seuls ${st.before.map((v) => v.toFixed(3)).join('/')}, ancré ${st.after.map((v) => v.toFixed(3)).join('/')} (continuité ${model.home.tri} ${(model.home.continuity * 100).toFixed(0)} %, ${model.away.tri} ${(model.away.continuity * 100).toFixed(0)} %)`);
  if (model.h2h) say(`confrontations : ${model.h2h.meetings.length} sur deux ans, écart réel - attendu ${model.h2h.residualHome.toFixed(1)} pour ${model.home.tri}${model.h2h.blackCat ? ` ; chat noir : ${model.h2h.blackCat.text}` : ''}`);
  for (const t of [model.home, model.away]) if (t.momentum) say(`momentum ${t.tri} : ${t.momentum.recent.toFixed(1)} pts d'écart sur ${t.momentum.n} matchs contre ${t.momentum.base.toFixed(1)} avant (${t.momentum.delta > 0 ? '+' : ''}${t.momentum.delta.toFixed(1)}), série ${t.momentum.streak}, incertitude ${t.strengthSd.toFixed(3)}`);
  const t1 = Date.now();
  const batch = await runSims(model, o.n, o.seed);
  say(`${o.n} simulations en ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  const summary = summarize(model, batch);
  const typ = typicalGame(model, batch, summary);
  const dir = join(ROOT, 'out', `${o.date}_${o.away}@${o.home}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'model.json'), JSON.stringify(model));
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ ...summary, insights: model.insights, meta: { dataThrough: model.meta.dataThrough, gamesUsed: model.meta.gamesUsed, date: model.meta.date, builtAt: model.meta.builtAt, lineupsConfirmed: model.home.players.some((p) => p.notes.includes('titulaire annoncé ce soir')) } }));
  updateIndex({ dir: `${o.date}_${o.away}@${o.home}`, date: o.date, away: o.away, home: o.home, n: o.n, pHome: summary.pHome, builtAt: model.meta.builtAt });
  writeFileSync(
    join(dir, 'typical.json'),
    JSON.stringify({
      index: typ.index, n: o.n, seed: batch.seeds[typ.index], result: typ.result,
      teams: {
        home: { id: model.home.id, tri: model.home.tri, name: model.home.name, city: model.home.city, color: model.home.color, color2: model.home.color2 },
        away: { id: model.away.id, tri: model.away.tri, name: model.away.name, city: model.away.city, color: model.away.color, color2: model.away.color2 },
      },
      players: [...model.home.players, ...model.away.players].map((p) => ({ id: p.id, name: p.name, short: p.short, jersey: p.jersey, pos: p.pos, group: p.group, side: p.teamId === model.home.id ? 0 : 1, starter: p.starter, status: p.status })),
      actual: actual ? { home: actual.home.score, away: actual.away.score, homeQ: actual.home.periods, awayQ: actual.away.periods } : undefined,
    }),
  );
  writeFileSync(join(dir, 'report.md'), report(model, summary, typ.result, typ.index, actual ? { home: actual.home.score, away: actual.away.score } : undefined));
  return { dir, model, summary };
}

/** Index des simulations disponibles pour le viewer (out/index.json). */
function updateIndex(entry: { dir: string; date: string; away: string; home: string; n: number; pHome: number; builtAt: string }): void {
  const f = join(ROOT, 'out', 'index.json');
  let idx: Array<typeof entry> = [];
  try {
    idx = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    idx = [];
  }
  idx = idx.filter((e) => e.dir !== entry.dir);
  idx.push(entry);
  writeFileSync(f, JSON.stringify(idx, null, 1));
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const f1 = (x: number) => x.toFixed(1);

export function report(m: GameModel, s: Summary, typ: ReturnType<typeof typicalGame>['result'], idx: number, actual?: { home: number; away: number }): string {
  const L: string[] = [];
  L.push(`# ${m.away.city} ${m.away.name} @ ${m.home.city} ${m.home.name} — ${m.meta.date}`);
  L.push('');
  L.push(`Simulé ${s.n} fois, possession par possession. Données jusqu'au ${m.meta.dataThrough} (${m.meta.gamesUsed} matchs de play-by-play).`);
  L.push('');
  L.push('## Sur l\'ensemble des simulations');
  L.push(`- ${m.home.tri} gagne **${pct(s.pHome)}**, ${m.away.tri} **${pct(s.pAway)}** (prolongation ${pct(s.pOT)})`);
  L.push(`- Score moyen : ${m.away.tri} ${f1(s.awayPts.mean)} – ${m.home.tri} ${f1(s.homePts.mean)} (médianes ${s.awayPts.p50}–${s.homePts.p50})`);
  L.push(`- Écart (dom.) : moyenne ${f1(s.margin.mean)}, écart-type ${f1(s.margin.sd)} ; total : ${f1(s.total.mean)} [${f1(s.total.p10)} – ${f1(s.total.p90)}]`);
  L.push(`- Rythme : ${f1(s.poss.mean)} possessions par équipe`);
  if (s.market) {
    const mk = s.market;
    L.push(`- Marché (${m.market?.provider}) : spread dom. ${mk.spreadHome ?? '-'}, total ${mk.total ?? '-'}, proba dom. sans marge ${mk.bookHome != null ? pct(mk.bookHome) : '-'}`);
    if (mk.pHomeCover != null) L.push(`  - ${m.home.tri} couvre ${mk.spreadHome} dans ${pct(mk.pHomeCover)} des sims`);
    if (mk.pOver != null) L.push(`  - Over ${mk.total} dans ${pct(mk.pOver)} des sims (Under ${pct(1 - mk.pOver)})`);
    if (mk.blendedHome != null) L.push(`  - Proba dom. mélangée modèle/marché (début de saison) : ${pct(mk.blendedHome)}`);
  }
  if (actual) L.push(`- **Résultat réel** : ${m.away.tri} ${actual.away} – ${m.home.tri} ${actual.home}`);
  L.push('');
  L.push('## Joueurs (moyenne, portée 80 % = P10–P90)');
  for (const side of [1, 0] as const) {
    const tri = side === 0 ? m.home.tri : m.away.tri;
    L.push(`### ${tri}`);
    L.push('| Joueur | Statut | MIN | PTS | REB | AST | 3PM | PRA | Forme L10 (pts) |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const p of s.players.filter((x) => x.side === side && x.playRate > 0.05).sort((a, b) => b.stats.min.mean - a.stats.min.mean)) {
      const st = p.stats;
      const r = (d: typeof st.pts) => `${f1(d.mean)} (${f1(d.p10)}–${f1(d.p90)})`;
      L.push(`| ${p.name}${p.starter ? ' *' : ''} | ${p.status} | ${f1(st.min.mean)} | ${r(st.pts)} | ${r(st.reb)} | ${r(st.ast)} | ${f1(st.fg3m.mean)} | ${f1(st.pra.mean)} | ${f1(p.form.ptsL10)} |`);
    }
    L.push('');
  }
  const seenP = new Set<string>();
  const edges = s.props.filter((p) => p.edge != null && p.edge > 0.03 && !seenP.has(p.player) && seenP.add(p.player)).slice(0, 12);
  if (edges.length) {
    L.push('## Props : écarts vs DraftKings (sans marge), probabilité mélangée au marché selon la confiance');
    for (const e of edges) L.push(`- ${e.player} ${e.lean === 'over' ? 'Over' : 'Under'} ${e.line} ${e.market.replace('Total ', '')} : ${pct(e.pLean!)} vs implicite ${pct(e.lean === 'over' ? e.impliedOver! : 1 - e.impliedOver!)} (edge ${pct(e.edge!)}, brut ${pct(e.edgeRaw!)}, confiance ${e.confidence}${e.confidenceWhy ? ` : ${e.confidenceWhy}` : ''})`);
    L.push('');
  }
  L.push('## Ce que disent les données');
  for (const i of m.insights) L.push(`- ${i}`);
  L.push('');
  L.push(`## Match typique (sim n° ${idx + 1} sur ${s.n})`);
  L.push(`Score final : ${m.away.tri} ${typ.away.pts} – ${m.home.tri} ${typ.home.pts} ; quarts : ${m.away.tri} ${typ.away.q.join('-')} / ${m.home.tri} ${typ.home.q.join('-')} ; changements de leader : ${typ.leadChanges}`);
  return L.join('\n');
}

if (import.meta.main) {
  const game = arg('game');
  if (!game || !game.includes('@')) {
    console.error('Usage : node src/cli/sim.ts --game AWAY@HOME --date YYYY-MM-DD [--n 5000]');
    process.exit(1);
  }
  const [away, home] = game.toUpperCase().split('@');
  const date = arg('date', new Date().toISOString().slice(0, 10))!;
  const n = Number(arg('n', '5000'));
  const res = await simulateMatchup({
    away, home, date, n, seed: Number(arg('seed', '7')),
    out: arg('out')?.split(',').map((s) => s.trim()).filter(Boolean), in: arg('in')?.split(',').map((s) => s.trim()).filter(Boolean),
  });
  console.log('\n' + (await import('node:fs')).readFileSync(join(res.dir, 'report.md'), 'utf8'));
  console.log(`\nFichiers : ${res.dir}`);
  if (flag('open')) console.log('Lancer le rendu 2D : npm run viewer');
}
