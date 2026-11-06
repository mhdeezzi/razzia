// Bilan Razzia foot : chaque simulation dont le match est terminé, confrontée au score final. Compte un seul pari par
// match, le premier onglet de la fiche (mêmes règles que le site : web/src/footpicks.ts et orderCats). Résultats
// lus sur les calendriers FotMob. Écrit foot/bilan.json (branche resultats).
//   node src/cli/footbilan.ts <dossier foot>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures } from '../foot/fotmob.ts';
import { marketById } from '../foot/markets.ts';
import { SHOWN_LEAGUES } from '../foot/picks.ts';
// Règles de la fiche, chargées telles quelles (le contrôle de types du moteur ne lit pas les fichiers du site).
const WEB = '../../web/src/';
const { footCategories } = await import(`${WEB}footpicks.ts`);
const { orderCats } = await import(`${WEB}picks.ts`);

/** Pronostic compté : exactement le premier onglet de la fiche (mêmes catégories et même ordre que le site). */
function firstPick(s: any, won: (id: string) => boolean, sc: [number, number]): { label: string; p: number; won: boolean } | null {
  try {
    const it = orderCats(footCategories(s))[0]?.items[0];
    if (!it) return null;
    const ex = /^exact-(\d+)-(\d+)$/.exec(it.id);
    return { label: it.title, p: it.p, won: ex ? +ex[1] === sc[0] && +ex[2] === sc[1] : won(it.id) };
  } catch {
    return null;
  }
}

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
    // Un seul pari par match : le premier onglet de la fiche (avant : le pronostic Razzia, sinon le combiné).
    pick: firstPick(s, won, sc) ?? (s.pick ? { label: s.pick.label, p: s.pick.p, won: won(s.pick.id) } : null),
    combo: null as null | { label: string; p: number; won: boolean },
  });
}
rows.sort((a, b) => a.start.localeCompare(b.start));
const picks = rows.filter((r) => r.pick), combos = rows.filter((r) => r.combo);
const rate = (xs: boolean[]) => ({ n: xs.length, won: xs.filter(Boolean).length });
const out = { at: new Date().toISOString(), games: rows.length, picks: rate(picks.map((r) => r.pick!.won)), combos: rate(combos.map((r) => r.combo!.won)), sure: rate(rows.filter((r) => r.tier === 'sure' && r.pick).map((r) => r.pick!.won)), rows };
writeFileSync(join(dir, 'bilan.json'), JSON.stringify(out));
console.log(`bilan foot : ${rows.length} matchs, pronos ${out.picks.won}/${out.picks.n}, combinés sûrs ${out.combos.won}/${out.combos.n}`);
