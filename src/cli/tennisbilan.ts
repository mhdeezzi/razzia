// Bilan des simulations tennis publiées : pour chaque match terminé (résultats TennisMyLife, ou ESPN en attendant qu'ils
// y soient : un match compte moins d'une heure après sa fin), le pronostic mis en avant
// par la fiche (vainqueur, ou « Un set » / « Deux sets » pour un favori à 80 % ou moins ou face à un outsider en hausse)
// et son résultat, par niveau de confiance (Razzia assuré, entre les deux, pile ou face), face au marché. Abandons et
// forfaits ne comptent pas.
//   node src/cli/tennisbilan.ts <dossier tennis de la branche resultats>   -> écrit <dossier>/bilan.json
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHistory } from '../tennis/data.ts';
import { nameKey, parseScore, type Match } from '../tennis/history.ts';

const dir = process.argv[2];
if (!dir) throw new Error('Usage : node src/cli/tennisbilan.ts <dossier tennis>');

// Mêmes seuils que la fiche (web/src/tennispicks.ts).
const T_HEDGE_FIRST = 0.75; // favori à 75 % ou moins : « Un set » passe devant, c'est lui qui compte
const T_SURE = 0.8; // favori à 80 % ou plus : Razzia assuré
const MIN_ODDS = 1.15; // ligne de sets proposée seulement si sa cote juste dépasse 1,15
const shown = (p: number) => Math.round(p * 1000) / 1000;

type Tier = 'sure' | 'mid' | 'flip';
type Pick = { kind: 'vainqueur' | 'sets'; need?: number; label: string; won: boolean };
interface Row {
  id: string; day: string; start: string; tourney: string; round: string; home: string; away: string;
  pHome: number; pMarket?: number; homeWon: boolean; score: string; tier: Tier; pick: Pick;
}

/** Outsider en hausse (forme sur 10 matchs) : le match passe en pile ou face, « Un set » devant même sous 1,15. */
const dogUp = (s: any) => s[s.pHome >= 0.5 ? 'away' : 'home'].trend === 'up';

/** Pronostic mis en avant par la fiche : la ligne de sets la plus sûre (favori à 80 % ou moins, ou outsider en hausse), sinon le vainqueur. */
function pickOf(s: any, favWon: boolean, favSets: number): Pick {
  const side = s.pHome >= 0.5 ? 'home' : 'away';
  const winP = Math.max(s.pHome, 1 - s.pHome);
  const i = side === 'home' ? 0 : 1;
  const fav = s[side].name as string;
  const lines = s.bestOf === 5 ? [{ need: 1, c: s.sim.atLeast1[i] }, { need: 2, c: s.sim.atLeast2[i] }] : [{ need: 1, c: s.sim.atLeast1[i] }];
  const L = lines.filter((x) => (dogUp(s) || x.c <= 1 / MIN_ODDS) && x.c > winP).sort((a, b) => b.c - a.c)[0];
  // Outsider victime d'un chat noir du favori : on garde la victoire du favori.
  const catFav = s.blackCat && s.blackCat.victim !== side;
  if (L && !catFav && (dogUp(s) || shown(winP) <= T_HEDGE_FIRST))
    return { kind: 'sets', need: L.need, label: `${fav} au moins ${L.need === 1 ? 'un set' : 'deux sets'}`, won: favWon || favSets >= L.need };
  return { kind: 'vainqueur', label: fav, won: favWon };
}

const history = await loadHistory('data/cache/tennis/tml', new Date().getUTCFullYear() - 1);
const byPair = new Map<string, Match[]>();
for (const m of history) {
  const k = [m.w.id, m.l.id].sort().join('|');
  byPair.set(k, [...(byPair.get(k) ?? []), m]);
}

// Résultats ESPN des 4 derniers jours (simple messieurs), par paire de joueurs : TennisMyLife publie avec quelques heures
// de retard. Abandons et forfaits marqués comme tels (ils ne comptent pas).
type Res = { key: string; date: string; score: string; wSets: number; lSets: number; retired: boolean; walkover: boolean; w: { id: string }; l: { id: string } };
const espn = new Map<string, Res[]>();
for (const i of [0, 1, 2, 3]) {
  const ymd = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=${ymd}`, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  if (!r?.ok) continue;
  for (const ev of (await r.json()).events ?? [])
    for (const g of ev.groupings ?? []) {
      if (g.grouping?.slug !== 'mens-singles') continue;
      for (const c of g.competitions ?? []) {
        const t = c.status?.type?.name, ps = c.competitors ?? [];
        if (ps.length !== 2 || !['STATUS_FINAL', 'STATUS_RETIRED', 'STATUS_WALKOVER'].includes(t)) continue;
        const wi = ps.findIndex((p: any) => p.winner);
        if (wi < 0) continue;
        const W = ps[wi], L = ps[1 - wi];
        const score = (W.linescores ?? []).map((x: any, k: number) => `${x.value}-${L.linescores?.[k]?.value ?? 0}`).join(' ');
        const sc = parseScore(score);
        const res: Res = {
          key: `espn-${c.id}`, date: String(c.date ?? '').slice(0, 10), score, wSets: sc.wSets, lSets: sc.lSets,
          retired: t === 'STATUS_RETIRED', walkover: t === 'STATUS_WALKOVER', w: { id: nameKey(W.athlete?.displayName ?? '') }, l: { id: nameKey(L.athlete?.displayName ?? '') },
        };
        const k = [res.w.id, res.l.id].sort().join('|');
        if (!(espn.get(k) ?? []).some((x) => x.key === res.key)) espn.set(k, [...(espn.get(k) ?? []), res]);
      }
    }
}

// Premier jour du tennis (24 octobre) : simulé avec l'ancien moteur, avant ses corrections (forme, plafond au marché,
// jours sans jouer). Hors du bilan, comme les premiers matchs NBA de l'ancien moteur.
const OLD_ENGINE = new Set(['1639081871', '1639017929', '1639065243', '1639121217', '1639121174']);

const rows: Row[] = [];
let voided = 0, late = 0;
const seen = new Map<string, { row: Row; built: string }>();
const simsDir = join(dir, 'sims');
for (const f of existsSync(simsDir) ? readdirSync(simsDir) : []) {
  if (!f.endsWith('.json')) continue;
  const s = JSON.parse(readFileSync(join(simsDir, f), 'utf8'));
  if (OLD_ENGINE.has(String(s.id))) continue;
  const kH = nameKey(s.home.name), kA = nameKey(s.away.name);
  // Le match joué entre ces deux joueurs le plus près du jour prévu (de la veille à 3 jours après : pluie, report).
  const t = Date.parse(s.day);
  const near = <T extends { date: string }>(l: T[]) =>
    l.filter((x) => Date.parse(x.date) >= t - 86_400_000 && Date.parse(x.date) <= t + 3 * 86_400_000).sort((a, b) => Math.abs(Date.parse(a.date) - t) - Math.abs(Date.parse(b.date) - t))[0];
  const pk = [kH, kA].sort().join('|');
  // TennisMyLife d'abord (source de l'historique), ESPN en attendant ; même clé de paire pour ne pas compter deux fois.
  const tml = near(byPair.get(pk) ?? []);
  const e = tml ? undefined : near(espn.get(pk) ?? []);
  const m = tml ?? e;
  // Un match = une paire de joueurs dans un tournoi et un tour (le numéro de match TennisMyLife peut servir deux fois).
  const one = tml ? `${pk}|${tml.tid}|${tml.round}` : `${pk}|${e?.date}`;
  if (!m) continue; // pas encore joué (ou pas encore dans TennisMyLife)
  if (m.walkover || m.retired) { voided++; continue; }
  // Une simulation lancée après le début du match ne compte pas (cotes en direct).
  if (s.start && s.meta?.builtAt && Date.parse(s.meta.builtAt) > Date.parse(s.start)) { late++; continue; }
  // Un même match simulé sous deux identifiants (ESPN, Pinnacle) : compté une seule fois, la dernière simulation.
  const prev = seen.get(one);
  if (prev) {
    if (Date.parse(prev.built) >= Date.parse(s.meta?.builtAt ?? '')) continue;
    rows.splice(rows.indexOf(prev.row), 1);
  }
  const homeWon = m.w.id === kH;
  const favHome = s.pHome >= 0.5;
  const favWon = favHome === homeWon;
  const favSets = favWon ? m.wSets : m.lSets;
  const winP = Math.max(s.pHome, 1 - s.pHome);
  const row: Row = {
    id: s.id, day: s.day, start: s.start, tourney: s.tourney, round: s.round, home: s.home.name, away: s.away.name,
    pHome: s.pHome, pMarket: s.market?.pHome, homeWon, score: homeWon ? m.score : m.score.split(' ').map((x) => x.replace(/^(\d+)-(\d+)/, '$2-$1')).join(' '),
    // Pile ou face : exactement quand la fiche met la ligne de sets devant le vainqueur.
    tier: pickOf(s, favWon, favSets).kind === 'sets' ? 'flip' : shown(winP) >= T_SURE ? 'sure' : 'mid',
    pick: pickOf(s, favWon, favSets),
  };
  rows.push(row);
  seen.set(one, { row, built: s.meta?.builtAt ?? '' });
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
  rows: rows.slice(0, 2500),
};
writeFileSync(join(dir, 'bilan.json'), JSON.stringify(out));
console.log(`bilan tennis : ${rows.length} matchs terminés, pronostic ${out.pick.won}/${out.pick.n}, Razzia assuré ${out.tiers.sure.won}/${out.tiers.sure.n} (${voided} abandons ou forfaits, ${late} simulés après le début)`);
