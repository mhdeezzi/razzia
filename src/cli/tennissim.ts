// Simulation de matchs ATP à venir, à partir de leur fiche de cotes Pinnacle (branche cotes-tennis) :
//   node src/cli/tennissim.ts --id 1639121174 --day 2026-10-24 --cotes ../cotes --out out/tennis [--n 5000]
//   node src/cli/tennissim.ts --id 1639121174,1639065243 --day 2026-10-24,2026-10-25 ...   (toute une journée)
// Une liste de jours de même longueur que les ids, ou un seul jour pour tous. Historique TennisMyLife en cache
// (data/cache/tennis/tml), lu une fois ; photo officielle ATP, Wikipédia en secours. Écrit <out>/<id>.json par match ;
// un match en erreur n'arrête pas les autres (code de sortie 1 à la fin).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHistory } from '../tennis/data.ts';
import { nameKey, ROUND_ORDER, type Match, type Surface } from '../tennis/history.ts';
import { Ratings, type Snapshot } from '../tennis/ratings.ts';
import { blend, engineProb, MARKET_WEIGHT } from '../tennis/engine.ts';
import { simulate } from '../tennis/sim.ts';
import { atpHeadshot, photoOf } from '../tennis/photos.ts';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const ids = arg('id')!.split(','), days = arg('day')!.split(','), cotes = arg('cotes', 'cotes-tennis')!, out = arg('out', 'out/tennis')!, n = Number(arg('n', '5000'));
if (days.length !== 1 && days.length !== ids.length) throw new Error('--day : un seul jour, ou un par match');
const cache = 'data/cache/tennis';
const history = await loadHistory(join(cache, 'tml'));
const ROUND: Record<string, string> = { R1: 'R64', R2: 'R32', R3: 'R16', R4: 'R16', '1/8': 'R16', QF: 'QF', SF: 'SF', F: 'F', Final: 'F' };
const SLAM: Record<string, string> = { 'French Open': 'Roland Garros', 'Roland Garros': 'Roland Garros', 'Australian Open': 'Australian Open', Wimbledon: 'Wimbledon', 'US Open': 'US Open' };
const v = (x?: number) => (x == null || Number.isNaN(x) ? 0 : x);
const noVig = (o?: [number, number]) => (o ? (1 / o[0]) / (1 / o[0] + 1 / o[1]) : undefined);
mkdirSync(out, { recursive: true });
let failed = 0;
for (const [k, id] of ids.entries()) {
  try {
    await simMatch(id, days.length === 1 ? days[0] : days[k]);
  } catch (e) {
    failed++;
    console.error(`Match ${id} : ${(e as Error).message}`);
  }
}
if (failed) process.exit(1);

async function simMatch(id: string, day: string) {
  const fiche = JSON.parse(readFileSync(join(cotes, 'atp', `${day}.json`), 'utf8'))[id];
  if (!fiche) throw new Error(`absent de ${day}.json`);

  // Tournoi : « ATP Brussels - SF » -> Brussels, demi-finale ; surface et format d'après TennisMyLife.
  const [lname, roundRaw = ''] = String(fiche.league).replace(/^ATP\s+/, '').split(' - ');
  const tname = SLAM[lname] ?? lname;
  const same = (m: Match) => nameKey(m.tourney).includes(nameKey(tname)) || nameKey(tname).includes(nameKey(m.tourney));
  // Les cotes ne couvrent que le circuit principal : son tournoi d'abord, un Challenger du même nom seulement à défaut.
  const edition = [...history].reverse().find((m) => same(m) && !m.qual && m.level !== 'C') ?? [...history].reverse().find((m) => same(m) && !m.qual);
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
  // Matchs joués par un joueur jusqu'au jour du match, sans ce tournoi à partir du tour joué.
  const played = (k: string) =>
    history.filter((m) => (m.w.id === k || m.l.id === k) && m.date <= day && !(m.tid === current && (ROUND_ORDER[m.round] ?? 0) >= (ROUND_ORDER[round] ?? 99)));
  // Confrontations des 6 dernières années (forfaits exclus).
  const key = { home: nameKey(fiche.home), away: nameKey(fiche.away) };
  const since = `${+day.slice(0, 4) - 6}${day.slice(4)}`;
  const meets = played(key.home).filter((m) => (m.w.id === key.away || m.l.id === key.away) && m.date >= since && !m.walkover);
  const hw = meets.filter((m) => m.w.id === key.home).length, aw = meets.length - hw;
  const eng = engineProb(R, A, B, surface, bestOf, { a: hw, b: aw });
  const pMarket = noVig(fiche.last?.ml), pOpen = noVig(fiche.first?.ml);
  const p = blend(eng.p, pMarket);
  const sim = simulate({ pA: R.servePoint(A, B, surface), pB: R.servePoint(B, A, surface), bestOf, target: p, n, seed: Number(id) % 100_000 });

  // Chat noir : au moins 4 confrontations en 6 ans, dont 75 % ou plus gagnées par le même, avec 3 victoires d'avance.
  // Sur 2024-2025, le dominant a gagné 74 % de ces matchs quand le marché en attendait 69 % (127 matchs).
  const blackCat = meets.length >= 4 && Math.max(hw, aw) >= 0.75 * meets.length && Math.abs(hw - aw) >= 3
    ? { victim: hw > aw ? 'away' : 'home', lost: Math.max(hw, aw), n: meets.length, since: meets[0].date.slice(0, 4),
        text: `${hw > aw ? fiche.away : fiche.home} a perdu ${Math.max(hw, aw)} de ses ${meets.length} matchs contre ${hw > aw ? fiche.home : fiche.away} depuis ${meets[0].date.slice(0, 4)}.` }
    : undefined;

  // Ce qu'on affiche sur chaque joueur : forme, confrontations, saison sur la surface, fatigue.
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
      // Forme (momentum) : victoires des 10 derniers matchs moins celles qu'annonçait le niveau des deux joueurs.
      // En hausse à +2 ou plus, en baisse à -2 ou moins (un joueur sur dix de chaque côté).
      form10: +s.form10.toFixed(2),
      trend: games.length >= 6 && s.form10 >= 2 ? 'up' : games.length >= 6 && s.form10 <= -2 ? 'down' : undefined,
      // Objectif Masters : top 20 en ATP 250 / 500 après le 10 octobre (course au Masters de fin d'année). Sur 2024-2025,
      // ces favoris ont gagné 82 % de leurs matchs quand le marché leur en donnait 72 % (72 matchs, les deux saisons).
      goal: v(s.rank) > 0 && s.rank! <= 20 && edition?.level === 'A' && day.slice(5) >= '10-10' ? true : undefined,
      // Surface : Elo de la surface du jour moins Elo général (positif : il joue mieux sur cette surface que d'habitude).
      surfaceEdge: Math.round(s.eloSurf - s.elo),
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
    h2hCount: { home: hw, away: aw, since },
    blackCat,
    meta: { builtAt: new Date().toISOString(), matchesUsed: history.length, n },
  };
  writeFileSync(join(out, `${id}.json`), JSON.stringify(result));
  console.log(`${fiche.home} - ${fiche.away} (${tname} ${round}, ${surface}, ${bestOf} sets) : moteur ${(100 * eng.p).toFixed(1)} %, marché ${pMarket ? (100 * pMarket).toFixed(1) : '-'} %, Razzia ${(100 * p).toFixed(1)} % | simulé ${(100 * sim.win).toFixed(1)} %, au moins un set ${(100 * sim.atLeast1[0]).toFixed(1)} / ${(100 * sim.atLeast1[1]).toFixed(1)} %`);
}
