// Aperçu interne du moteur foot sur les prochains matchs (rien n'est publié sur le site).
//   node src/cli/footsim.ts [--lg 53] [--days 3] [--sims 20000]
import { FD_CODE, fdDate, fdTeamId, loadGames, parseCsv, type Odds } from '../foot/data.ts';
import { predictMany, loadModel } from '../foot/engine.ts';
import { fixtures, LEAGUES } from '../foot/fotmob.ts';
import { featured, shown } from '../foot/picks.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const days = Number(arg('--days', '3')), n = Number(arg('--sims', '20000'));
const leagues = arg('--lg', '47,87,55,54,53,42').split(',').map(Number);
loadGames();
const M = loadModel();
// Cotes du moment (moyenne du marché, Pinnacle si présent) pour les matchs de championnat à venir.
const odds = new Map<string, Odds>();
try {
  const r = await fetch('https://football-data.co.uk/fixtures.csv', { signal: AbortSignal.timeout(20_000) });
  for (const x of parseCsv(await r.text())) {
    const lg = Number(Object.entries(FD_CODE).find(([, c]) => c === x.Div)?.[0]);
    const h = lg && fdTeamId(lg, x.HomeTeam), a = lg && fdTeamId(lg, x.AwayTeam);
    const o = (k: string) => { const v = Number(x[k]); return v > 1 ? v : undefined; };
    if (h && a && (o('PSH') ?? o('AvgH'))) odds.set(`${h}|${a}|${fdDate(x.Date)}`, { h: o('PSH') ?? o('AvgH')!, d: o('PSD') ?? o('AvgD')!, a: o('PSA') ?? o('AvgA')!, over25: o('P>2.5') ?? o('Avg>2.5'), under25: o('P<2.5') ?? o('Avg<2.5'), src: x.PSH ? 'pinnacle' : 'moyenne' });
  }
} catch { /* sans cotes : moteur seul */ }
const now = Date.now(), until = now + days * 864e5;
const list: Array<{ f: Awaited<ReturnType<typeof fixtures>>['matches'][number]; odds?: Odds }> = [];
for (const lg of leagues) {
  const y = new Date().getUTCFullYear(), m = new Date().getUTCMonth();
  const fx = await fixtures(lg, m >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`, true);
  for (const f of fx.matches.filter((x) => !x.finished && !x.cancelled && Date.parse(x.date) > now && Date.parse(x.date) < until))
    list.push({ f, odds: odds.get(`${f.home.id}|${f.away.id}|${f.date.slice(0, 10)}`) });
}
const pc = (x: number) => `${(100 * x).toFixed(0)} %`;
for (const P of (await predictMany(list, n)).sort((a, b) => a.f.date.localeCompare(b.f.date))) {
  const { f } = P;
  if (!process.argv.includes('--all') && !shown(f)) continue;
  const best = featured(P.probs, P.T);
  const o = list.find((x) => x.f.id === f.id)?.odds;
  console.log(`\n${LEAGUES.find((l) => l.id === f.lg)!.name} · ${f.date.slice(0, 16).replace('T', ' ')} · ${f.home.name} – ${f.away.name} (compo ${P.lineupType ?? '?'}, cotes ${o?.src ?? 'aucune'})`);
  console.log(`  buts attendus ${P.lambda.map((x) => x.toFixed(2)).join(' – ')} · 1N2 ${pc(P.final.h)} / ${pc(P.final.d)} / ${pc(P.final.a)} · +2,5 buts ${pc(P.probs.get('o2.5')!)} · les deux marquent ${pc(P.probs.get('btts')!)}`);
  console.log(`  mis en avant : ${best ? `${P.label(best.id)} (${pc(best.p)})` : 'aucun (match trop ouvert)'}`);
}
