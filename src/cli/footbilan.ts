// Bilan Razzia foot : chaque simulation dont le match est terminé, confrontée au score final. Comptent seulement les
// pronos non risqués (src/foot/picks.ts) : le prono mis en avant et le combiné rattaché quand il est jugé sûr. Résultats
// lus sur les calendriers FotMob. Écrit foot/bilan.json (branche resultats).
//   node src/cli/footbilan.ts <dossier foot>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures } from '../foot/fotmob.ts';
import { marketById } from '../foot/markets.ts';
import { SHOWN_LEAGUES } from '../foot/picks.ts';

const dir = process.argv[2] ?? 'foot';
const y = new Date().getUTCFullYear(), m = new Date().getUTCMonth();
const season = m >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
const score = new Map<string, [number, number]>();
for (const lg of SHOWN_LEAGUES) {
  const fx = await fixtures(lg, season, true).catch(() => undefined);
  for (const f of fx?.matches ?? []) if (f.finished && !f.cancelled && f.score) score.set(f.id, f.score);
}
const rows = [];
for (const f of existsSync(join(dir, 'sims')) ? readdirSync(join(dir, 'sims')) : []) {
  const s = JSON.parse(readFileSync(join(dir, 'sims', f), 'utf8'));
  const sc = score.get(s.id);
  if (!sc) continue;
  // Seule la simulation faite avant le coup d'envoi compte.
  if (Date.parse(s.meta.builtAt) > Date.parse(s.start)) continue;
  const won = (id: string) => marketById.get(id)!.win(Math.min(sc[0], 10), Math.min(sc[1], 10));
  rows.push({
    id: s.id, lg: s.lg, start: s.start, home: s.home.name, away: s.away.name, score: sc, tier: s.tier,
    pick: s.pick ? { label: s.pick.label, p: s.pick.p, won: won(s.pick.id) } : null,
    combo: s.combo && !s.combo.risky ? { label: s.combo.label, p: s.combo.p, won: won(s.combo.id) } : null,
  });
}
rows.sort((a, b) => a.start.localeCompare(b.start));
const picks = rows.filter((r) => r.pick), combos = rows.filter((r) => r.combo);
const rate = (xs: boolean[]) => ({ n: xs.length, won: xs.filter(Boolean).length });
const out = { at: new Date().toISOString(), games: rows.length, picks: rate(picks.map((r) => r.pick!.won)), combos: rate(combos.map((r) => r.combo!.won)), sure: rate(rows.filter((r) => r.tier === 'sure' && r.pick).map((r) => r.pick!.won)), rows };
writeFileSync(join(dir, 'bilan.json'), JSON.stringify(out));
console.log(`bilan foot : ${rows.length} matchs, pronos ${out.picks.won}/${out.picks.n}, combinés sûrs ${out.combos.won}/${out.combos.n}`);
