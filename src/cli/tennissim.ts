// Simulation d'un match ATP à venir, à partir de sa fiche de cotes Pinnacle (branche cotes-tennis) :
//   node src/cli/tennissim.ts --id 1639121174 --day 2026-10-24 --cotes ../cotes --out out/tennis [--n 5000]
// Historique TennisMyLife en cache (data/cache/tennis/tml), photos Wikidata / Wikipédia. Écrit <out>/<id>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHistory } from '../tennis/data.ts';
import { nameKey, ROUND_ORDER, type Match, type Surface } from '../tennis/history.ts';
import { Ratings, type Snapshot } from '../tennis/ratings.ts';
import { blend, engineProb, MARKET_WEIGHT } from '../tennis/engine.ts';
import { simulate } from '../tennis/sim.ts';
import { atpHeadshot, photoOf } from '../tennis/photos.ts';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const id = arg('id')!, day = arg('day')!, cotes = arg('cotes', 'cotes-tennis')!, out = arg('out', 'out/tennis')!, n = Number(arg('n', '5000'));
const cache = 'data/cache/tennis';

const fiche = JSON.parse(readFileSync(join(cotes, 'atp', `${day}.json`), 'utf8'))[id];
if (!fiche) throw new Error(`Match ${id} absent de ${day}.json`);
const noVig = (o?: [number, number]) => (o ? (1 / o[0]) / (1 / o[0] + 1 / o[1]) : undefined);

// Tournoi : « ATP Brussels - SF » -> Brussels, demi-finale ; surface et format d'après TennisMyLife.
const [lname, roundRaw = ''] = String(fiche.league).replace(/^ATP\s+/, '').split(' - ');
const ROUND: Record<string, string> = { R1: 'R64', R2: 'R32', R3: 'R16', R4: 'R16', '1/8': 'R16', QF: 'QF', SF: 'SF', F: 'F', Final: 'F' };
const SLAM: Record<string, string> = { 'French Open': 'Roland Garros', 'Roland Garros': 'Roland Garros', 'Australian Open': 'Australian Open', Wimbledon: 'Wimbledon', 'US Open': 'US Open' };
const history = await loadHistory(join(cache, 'tml'));
const tname = SLAM[lname] ?? lname;
const same = (m: Match) => nameKey(m.tourney).includes(nameKey(tname)) || nameKey(tname).includes(nameKey(m.tourney));
const edition = [...history].reverse().find((m) => same(m) && !m.qual);
const surface: Surface = edition?.surface ?? 'Hard';
const bestOf: 3 | 5 = SLAM[lname] ? 5 : (edition?.bo ?? 3);
const current = edition && Date.parse(day) - Date.parse(edition.date) < 20 * 86_400_000 ? edition.tid : `${day}-${nameKey(tname)}`;
const round = ROUND[roundRaw.trim()] ?? roundRaw.trim();

// Notes jusqu'au match : tout l'historique, sauf ce tournoi à partir du tour joué.
const R = new Ratings();
for (const m of history) {
  if (m.date > day) break;
  if (m.tid === current && (ROUND_ORDER[m.round] ?? 0) >= (ROUND_ORDER[round] ?? 99)) continue;
  R.update(m);
}
const ctx = { date: day, surface, tid: current };
const A = R.snapshot(nameKey(fiche.home), ctx), B = R.snapshot(nameKey(fiche.away), ctx);
const eng = engineProb(R, A, B, surface, bestOf);
const pMarket = noVig(fiche.last?.ml), pOpen = noVig(fiche.first?.ml);
const p = blend(eng.p, pMarket);
const sim = simulate({ pA: R.servePoint(A, B, surface), pB: R.servePoint(B, A, surface), bestOf, target: p, n, seed: Number(id) % 100_000 });

// Ce qu'on affiche sur chaque joueur : forme, confrontations, saison sur la surface, fatigue.
const key = { home: nameKey(fiche.home), away: nameKey(fiche.away) };
const played = (k: string) => history.filter((m) => (m.w.id === k || m.l.id === k) && m.date <= day && !(m.tid === current && (ROUND_ORDER[m.round] ?? 0) >= (ROUND_ORDER[round] ?? 99)));
const line = (m: Match, k: string) => ({ date: m.date, tourney: m.tourney, round: m.round, surface: m.surface, opponent: m.w.id === k ? m.l.name : m.w.name, won: m.w.id === k, score: m.score });
const player = (name: string, k: string, s: Snapshot) => {
  const games = played(k);
  const st = R.S.get(k);
  const season = games.filter((m) => m.date.slice(0, 4) === day.slice(0, 4) && m.surface === surface && !m.qual);
  return {
    name, atp: st?.info?.atp, ioc: st?.info?.ioc, hand: st?.info?.hand, ht: st?.info?.ht, age: s.age, rank: s.rank, matches: s.n,
    elo: Math.round((s.elo + s.eloSurf) / 2), serve: s.serve, ret: s.ret,
    daysOff: s.daysOff, tourneyMinutes: s.tourneyMinutes, played14: s.played14, layoff: s.daysOff > 45 && s.daysOff < 999,
    surfaceSeason: { won: season.filter((m) => m.w.id === k).length, lost: season.filter((m) => m.l.id === k).length },
    form: games.slice(-10).reverse().map((m) => line(m, k)),
  };
};
// Photo officielle ATP (chargée par le navigateur), Wikipédia en secours.
const photos = async (name: string, k: string) => {
  const atp = R.S.get(k)?.info?.atp;
  return { photo: atp ? atpHeadshot(atp) : undefined, photoAlt: await photoOf(name, cache) };
};
const h2h = history.filter((m) => (m.w.id === key.home && m.l.id === key.away) || (m.w.id === key.away && m.l.id === key.home)).slice(-6).reverse().map((m) => ({ ...line(m, key.home) }));
const result = {
  sport: 'tennis', id, day, start: fiche.start, league: fiche.league, tourney: tname, round, surface, indoor: edition?.indoor, bestOf,
  home: { ...player(fiche.home, key.home, A), ...(await photos(fiche.home, key.home)) },
  away: { ...player(fiche.away, key.away, B), ...(await photos(fiche.away, key.away)) },
  pHome: p, pAway: 1 - p,
  engine: { pHome: eng.p, elo: eng.elo, point: eng.point, factors: eng.factors.map((f) => ({ ...f, z: +f.z.toFixed(4) })), marketWeight: MARKET_WEIGHT },
  market: { pHome: pMarket, pHomeOpen: pOpen, odds: fiche.last, oddsOpen: fiche.first, moves: fiche.moves },
  sim: { ...sim, gamesLadder: sim.gamesLadder.filter((x) => x.pACover > 0.03 && x.pACover < 0.97) },
  h2h,
  meta: { builtAt: new Date().toISOString(), matchesUsed: history.length, n },
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${id}.json`), JSON.stringify(result));
console.log(`${fiche.home} - ${fiche.away} (${tname} ${round}, ${surface}, ${bestOf} sets) : moteur ${(100 * eng.p).toFixed(1)} %, marché ${pMarket ? (100 * pMarket).toFixed(1) : '-'} %, Razzia ${(100 * p).toFixed(1)} % | simulé ${(100 * sim.win).toFixed(1)} %, au moins un set ${(100 * sim.atLeast1[0]).toFixed(1)} / ${(100 * sim.atLeast1[1]).toFixed(1)} %`);
if (!existsSync(out)) process.exit(1);
