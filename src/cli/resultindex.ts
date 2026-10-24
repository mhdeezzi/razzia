// Reconstruit sims/index.json sur la branche resultats à partir des résumés présents (appelé par simulate.yml).
// Recalculé entièrement à chaque publication : deux simulations publiées en même temps ne peuvent pas entrer en conflit.
//   node src/cli/resultindex.ts <dossier sims> <match publié maintenant>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, fresh] = process.argv.slice(2);
const file = join(dir, 'index.json');
const before = new Map<string, { at: string }>();
if (existsSync(file)) for (const e of JSON.parse(readFileSync(file, 'utf8'))) before.set(e.dir, e);

const out = [];
for (const d of readdirSync(dir, { withFileTypes: true })) {
  const f = join(dir, d.name, 'summary.json');
  if (!d.isDirectory() || !existsSync(f)) continue;
  const s = JSON.parse(readFileSync(f, 'utf8'));
  const at = d.name === fresh || !before.has(d.name) ? new Date().toISOString() : before.get(d.name)!.at;
  // cat : équipe victime d'un chat noir dans ce match (icône sur le programme).
  const cat = s.h2h?.blackCat ? (s.h2h.blackCat.victim === 'home' ? s.home.tri : s.away.tri) : undefined;
  // Probabilité affichée sur la fiche (moteur, cote d'ouverture et mouvement de cote), pour que le programme dise pareil.
  const pHome: number = s.market?.blendedHome ?? s.pHome;
  // gp : matchs joués par l'équipe qui en a le moins (pile ou face d'office sous 70 % en tout début de saison).
  const gp = Math.min(s.gamesPlayed?.home ?? s.momentum?.home?.nCur ?? 99, s.gamesPlayed?.away ?? s.momentum?.away?.nCur ?? 99);
  // Forme pour le programme : équipe en pleine montée ou en baisse (4 points d'écart par match, comme le badge de la
  // fiche), sinon le joueur le plus chaud (« En feu ce soir »).
  const tr = (k: 'home' | 'away') => { const dl = s.momentum?.[k]?.delta; return dl >= 4 ? 'up' : dl <= -4 ? 'down' : undefined; };
  const trend = tr('home') || tr('away') ? { home: tr('home'), away: tr('away') } : undefined;
  const top = (s.players ?? []).filter((p: any) => p.heat && p.heat.pBig >= 0.1).sort((a: any, b: any) => b.heat.pBig - a.heat.pBig)[0];
  const hot = top ? { id: top.id, side: top.side, name: top.name } : undefined;
  out.push({ dir: d.name, pHome, pAway: 1 - pHome, at, gp, ...(cat ? { cat } : {}), ...(trend ? { trend } : {}), ...(hot ? { hot } : {}) });
}
out.sort((a, b) => b.at.localeCompare(a.at));
writeFileSync(file, JSON.stringify(out));
console.log(`index : ${out.length} simulations`);
