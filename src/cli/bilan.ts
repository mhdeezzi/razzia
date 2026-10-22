// Bilan des simulations publiées, façon parieur pro : pour chaque match terminé, la cote au moment de la simulation
// contre la cote de clôture (la ligne a-t-elle bougé dans le sens de Razzia ?) et le résultat.
//   node src/cli/bilan.ts <dossier sims de la branche resultats>   -> écrit <dossier>/bilan.json
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMarket, getScoreboard, noVig } from '../data/espn.ts';

const dir = process.argv[2];
if (!dir) throw new Error('Usage : node src/cli/bilan.ts <dossier sims>');

const decimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const VALUE = 0.04; // écart moteur / marché à partir duquel Razzia signale une valeur

interface Row {
  dir: string;
  date: string;
  away: string;
  home: string;
  pModel: number; // probabilité domicile du moteur
  pBlend?: number; // moteur + marché
  pBook?: number; // marché sans marge au moment de la simulation
  pClose?: number; // marché sans marge à la clôture
  homeWon: boolean;
  score: string;
  value?: { side: 'home' | 'away'; edge: number; clv?: number; odds?: number; won: boolean; profit?: number };
}

const rows: Row[] = [];
const finals = new Map<string, any[]>();
for (const d of readdirSync(dir, { withFileTypes: true })) {
  const f = join(dir, d.name, 'summary.json');
  if (!d.isDirectory() || !existsSync(f)) continue;
  const m = /^(\d{4}-\d{2}-\d{2})_([A-Z]{3})@([A-Z]{3})$/.exec(d.name);
  if (!m) continue;
  const [, date, away, home] = m;
  if (Date.parse(`${date}T12:00:00Z`) > Date.now() - 86_400_000 / 2) continue; // trop récent pour être terminé
  const s = JSON.parse(readFileSync(f, 'utf8'));
  if (!finals.has(date)) finals.set(date, await getScoreboard(date, 6).catch(() => []));
  const norm = (t: string) => ({ GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' } as Record<string, string>)[t] ?? t;
  const ev = finals.get(date)!.find((e) => {
    const c = e.competitions?.[0]?.competitors ?? [];
    return norm(c.find((x: any) => x.homeAway === 'home')?.team?.abbreviation ?? '') === home && norm(c.find((x: any) => x.homeAway === 'away')?.team?.abbreviation ?? '') === away;
  });
  const comp = ev?.competitions?.[0];
  if (!comp?.status?.type?.completed) continue;
  const hs = Number(comp.competitors.find((x: any) => x.homeAway === 'home').score);
  const as = Number(comp.competitors.find((x: any) => x.homeAway === 'away').score);
  const close = await getMarket(date, home, away).catch(() => undefined);
  const pClose = close?.mlHome != null && close.mlAway != null ? noVig(close.mlHome, close.mlAway)[0] : undefined;
  const pBook = s.market?.bookHome as number | undefined;
  const row: Row = { dir: d.name, date, away, home, pModel: s.pHome, pBlend: s.market?.blendedHome, pBook, pClose, homeWon: hs > as, score: `${as}-${hs}` };
  if (pBook != null && Math.abs(s.pHome - pBook) >= VALUE) {
    const side = s.pHome > pBook ? 'home' : 'away';
    const won = side === 'home' ? hs > as : as > hs;
    const ml = side === 'home' ? s.market?.mlHome : s.market?.mlAway;
    row.value = {
      side, edge: Math.abs(s.pHome - pBook), won,
      clv: pClose != null ? (side === 'home' ? pClose - pBook : pBook - pClose) : undefined,
      odds: ml != null ? decimal(ml) : undefined,
      profit: ml != null ? (won ? decimal(ml) - 1 : -1) : undefined,
    };
  }
  rows.push(row);
}
rows.sort((a, b) => b.date.localeCompare(a.date));

const brier = (k: 'pModel' | 'pBlend' | 'pBook' | 'pClose') => {
  const r = rows.filter((x) => x[k] != null);
  return r.length ? r.reduce((s, x) => s + ((x[k] as number) - (x.homeWon ? 1 : 0)) ** 2, 0) / r.length : undefined;
};
const hit = (k: 'pModel' | 'pBlend' | 'pBook') => {
  const r = rows.filter((x) => x[k] != null);
  return r.length ? r.filter((x) => ((x[k] as number) >= 0.5) === x.homeWon).length / r.length : undefined;
};
const vals = rows.filter((x) => x.value);
const withClv = vals.filter((x) => x.value!.clv != null);
const withOdds = vals.filter((x) => x.value!.profit != null);
const out = {
  at: new Date().toISOString(),
  games: rows.length,
  brier: { model: brier('pModel'), blend: brier('pBlend'), book: brier('pBook'), close: brier('pClose') },
  accuracy: { model: hit('pModel'), blend: hit('pBlend'), book: hit('pBook') },
  value: {
    n: vals.length,
    won: vals.filter((x) => x.value!.won).length,
    clvMean: withClv.length ? withClv.reduce((s, x) => s + x.value!.clv!, 0) / withClv.length : undefined,
    clvPositive: withClv.length ? withClv.filter((x) => x.value!.clv! > 0).length / withClv.length : undefined,
    roi: withOdds.length ? withOdds.reduce((s, x) => s + x.value!.profit!, 0) / withOdds.length : undefined,
    nOdds: withOdds.length,
  },
  rows: rows.slice(0, 300),
};
writeFileSync(join(dir, 'bilan.json'), JSON.stringify(out));
console.log(`bilan : ${rows.length} matchs, ${vals.length} valeurs signalées`);
