// Bilan des simulations tennis publiées : pour chaque match terminé (résultats TennisMyLife), le pronostic mis en avant
// par la fiche (vainqueur, ou « Un set » / « Deux sets » pour un favori à 75 % ou moins) et son résultat, par niveau de
// confiance (Razzia assuré, entre les deux, pile ou face), face au marché. Abandons et forfaits ne comptent pas.
//   node src/cli/tennisbilan.ts <dossier tennis de la branche resultats>   -> écrit <dossier>/bilan.json
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHistory } from '../tennis/data.ts';
import { nameKey, type Match } from '../tennis/history.ts';

const dir = process.argv[2];
if (!dir) throw new Error('Usage : node src/cli/tennisbilan.ts <dossier tennis>');

// Mêmes seuils que la fiche (web/src/tennispicks.ts).
const T_HEDGE_FIRST = 0.75; // favori à 75 % ou moins : « Un set » passe devant, c'est lui qui compte
const T_FLIP = 0.6; // favori sous 60 % : pile ou face
const T_SURE = 0.8; // favori à 80 % ou plus : Razzia assuré
const MIN_ODDS = 1.15; // ligne de sets proposée seulement si sa cote juste dépasse 1,15
const shown = (p: number) => Math.round(p * 1000) / 1000;

type Tier = 'sure' | 'mid' | 'flip';
type Pick = { kind: 'vainqueur' | 'sets'; need?: number; label: string; won: boolean };
interface Row {
  id: string; day: string; start: string; tourney: string; round: string; home: string; away: string;
  pHome: number; pMarket?: number; homeWon: boolean; score: string; tier: Tier; pick: Pick;
}

/** Pronostic mis en avant par la fiche : la ligne de sets la plus sûre (si favori à 75 % ou moins), sinon le vainqueur. */
function pickOf(s: any, favWon: boolean, favSets: number): Pick {
  const side = s.pHome >= 0.5 ? 'home' : 'away';
  const winP = Math.max(s.pHome, 1 - s.pHome);
  const i = side === 'home' ? 0 : 1;
  const fav = s[side].name as string;
  const lines = s.bestOf === 5 ? [{ need: 1, c: s.sim.atLeast1[i] }, { need: 2, c: s.sim.atLeast2[i] }] : [{ need: 1, c: s.sim.atLeast1[i] }];
  const L = lines.filter((x) => x.c <= 1 / MIN_ODDS && x.c > winP).sort((a, b) => b.c - a.c)[0];
  if (L && shown(winP) <= T_HEDGE_FIRST)
    return { kind: 'sets', need: L.need, label: `${fav} au moins ${L.need === 1 ? 'un set' : 'deux sets'}`, won: favWon || favSets >= L.need };
  return { kind: 'vainqueur', label: fav, won: favWon };
}

const history = await loadHistory('data/cache/tennis/tml', new Date().getUTCFullYear() - 1);
const byPair = new Map<string, Match[]>();
for (const m of history) {
  const k = [m.w.id, m.l.id].sort().join('|');
  byPair.set(k, [...(byPair.get(k) ?? []), m]);
}

const rows: Row[] = [];
let voided = 0, late = 0;
const simsDir = join(dir, 'sims');
for (const f of existsSync(simsDir) ? readdirSync(simsDir) : []) {
  if (!f.endsWith('.json')) continue;
  const s = JSON.parse(readFileSync(join(simsDir, f), 'utf8'));
  const kH = nameKey(s.home.name), kA = nameKey(s.away.name);
  // Le match joué entre ces deux joueurs le plus près du jour prévu (de la veille à 3 jours après : pluie, report).
  const t = Date.parse(s.day);
  const m = (byPair.get([kH, kA].sort().join('|')) ?? [])
    .filter((x) => Date.parse(x.date) >= t - 86_400_000 && Date.parse(x.date) <= t + 3 * 86_400_000)
    .sort((a, b) => Math.abs(Date.parse(a.date) - t) - Math.abs(Date.parse(b.date) - t))[0];
  if (!m) continue; // pas encore joué (ou pas encore dans TennisMyLife)
  if (m.walkover || m.retired) { voided++; continue; }
  // Une simulation lancée après le début du match ne compte pas (cotes en direct).
  if (s.start && s.meta?.builtAt && s.meta.builtAt > s.start) { late++; continue; }
  const homeWon = m.w.id === kH;
  const favHome = s.pHome >= 0.5;
  const favWon = favHome === homeWon;
  const favSets = favWon ? m.wSets : m.lSets;
  const winP = Math.max(s.pHome, 1 - s.pHome);
  rows.push({
    id: s.id, day: s.day, start: s.start, tourney: s.tourney, round: s.round, home: s.home.name, away: s.away.name,
    pHome: s.pHome, pMarket: s.market?.pHome, homeWon, score: homeWon ? m.score : m.score.split(' ').map((x) => x.replace(/^(\d+)-(\d+)/, '$2-$1')).join(' '),
    tier: shown(winP) >= T_SURE ? 'sure' : shown(winP) < T_FLIP ? 'flip' : 'mid',
    pick: pickOf(s, favWon, favSets),
  });
}
rows.sort((a, b) => (b.start ?? b.day).localeCompare(a.start ?? a.day));

const rate = (r: Row[]) => ({ n: r.length, won: r.filter((x) => x.pick.won).length });
const hit = (k: 'pHome' | 'pMarket') => {
  const r = rows.filter((x) => x[k] != null);
  return r.length ? r.filter((x) => (x[k]! >= 0.5) === x.homeWon).length / r.length : undefined;
};
const brier = (k: 'pHome' | 'pMarket') => {
  const r = rows.filter((x) => x[k] != null);
  return r.length ? r.reduce((s, x) => s + (x[k]! - (x.homeWon ? 1 : 0)) ** 2, 0) / r.length : undefined;
};
const out = {
  at: new Date().toISOString(),
  games: rows.length,
  voided,
  late,
  pick: rate(rows),
  // Pronostic par niveau de confiance (pourcentage du favori) ; « hors pile ou face » : ce que Razzia conseille vraiment.
  tiers: { sure: rate(rows.filter((x) => x.tier === 'sure')), mid: rate(rows.filter((x) => x.tier === 'mid')), flip: rate(rows.filter((x) => x.tier === 'flip')), advised: rate(rows.filter((x) => x.tier !== 'flip')) },
  sets: rate(rows.filter((x) => x.pick.kind === 'sets')),
  accuracy: { razzia: hit('pHome'), market: hit('pMarket') },
  brier: { razzia: brier('pHome'), market: brier('pMarket') },
  rows: rows.slice(0, 300),
};
writeFileSync(join(dir, 'bilan.json'), JSON.stringify(out));
console.log(`bilan tennis : ${rows.length} matchs terminés, pronostic ${out.pick.won}/${out.pick.n}, Razzia assuré ${out.tiers.sure.won}/${out.tiers.sure.n} (${voided} abandons ou forfaits, ${late} simulés après le début)`);
