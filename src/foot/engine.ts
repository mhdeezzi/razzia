// Prévision d'un match de foot à venir : historique jusqu'à aujourd'hui, composition probable ou officielle et absents
// (FotMob), cotes du moment (football-data, matchs de championnat), réglages appris (model.json, écrit par le contrôle de
// justesse). Pas encore branché sur le site : le moteur foot reste interne tant qu'il n'a pas fait ses preuves.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adjusted, ZERO, type Coefs } from './adjust.ts';
import { loadGames, type Game, type Odds } from './data.ts';
import { matchRaw, type Fixture } from './fotmob.ts';
import { probs, marketById } from './markets.ts';
import { DEFAULT_RATING, type RatingParams } from './ratings.ts';
import { gameState, outcome, reweight, simulateMatch } from './sim.ts';
import { walk } from './walk.ts';

/** T : seuil de sûreté du prono mis en avant quand on a les cotes du marché (84,7 % de réussite sur 2024-2026) ; Tcup :
 * sans cotes (coupes d'Europe, cotes pas encore publiées) : moteur seul, 87,9 % de réussite à 85 % en championnat, 85,3 %
 * en Ligue des Champions. */
export interface FootModel { params: RatingParams; coefs: Coefs; w: number; wCup: number; k: number; scale: number; T: number; Tcup: number; builtAt: string }
export function loadModel(): FootModel {
  // Réglages figés après le contrôle de justesse (copie versionnée de data/cache/foot/model.json).
  const f = join(import.meta.dirname, 'model.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { params: DEFAULT_RATING, coefs: ZERO, w: 0.8, wCup: 0, k: 0.4, scale: 1.03, T: 0.8, Tcup: 0.85, builtAt: '' };
}

const noVig = (o: Odds) => { const s = 1 / o.h + 1 / o.d + 1 / o.a; return { h: 1 / o.h / s, d: 1 / o.d / s, a: 1 / o.a / s }; };

/** Fiche « match à venir » au format des fiches jouées (score vide), à partir du détail FotMob d'avant-match. */
async function pending(f: Fixture): Promise<Game> {
  const d = await matchRaw(f.id);
  const lu = d?.content?.lineup ?? {};
  const side = (t: any) => ({
    formation: t?.formation, coach: t?.coach ? { id: Number(t.coach.id), name: t.coach.name } : undefined,
    starters: (t?.starters ?? []).map((p: any) => [Number(p.id), p.name, Number(p.positionId ?? p.usualPlayingPositionId ?? 0), Number(p.marketValue) || 0]),
    subs: [], unavailable: (t?.unavailable ?? []).map((p: any) => [Number(p.id), p.name, String(p.unavailability?.type ?? '')]),
  });
  return {
    id: f.id, key: f.id, lg: f.lg, season: f.season, date: f.date, round: f.round, home: f.home, away: f.away, score: [0, 0],
    stats: {}, shots: [], events: [], sides: [side(lu.homeTeam), side(lu.awayTeam)] as Game['sides'], players: {},
    lineupType: lu.lineupType,
  } as Game & { lineupType?: string };
}

/** Prévisions de plusieurs matchs à venir en un seul passage sur l'historique. */
export async function predictMany(list: Array<{ f: Fixture; odds?: Odds }>, n = 25000) {
  const M = loadModel();
  const first = list.map((x) => x.f.date).sort()[0];
  const hist = loadGames().filter((g) => g.date < first);
  const pend: Game[] = [];
  for (const { f, odds } of list) { const g = await pending(f); if (odds) g.odds = odds; pend.push(g); }
  pend.sort((a, b) => a.date.localeCompare(b.date));
  const rows = walk([...hist, ...pend], first.slice(0, 10), M.params, new Set(list.map((x) => x.f.lg)));
  return list.map(({ f, odds }) => {
    const r = rows.find((x) => x.g.id === f.id)!;
    const [lh0, la0] = adjusted(r, M.coefs);
    const lh = lh0 * (M.scale ?? 1), la = la0 * (M.scale ?? 1);
    const sim = simulateMatch({ lambda: lh, shotQ: r.shotQ[0], redRate: r.red[0] }, { lambda: la, shotQ: r.shotQ[1], redRate: r.red[1] }, { n, gs: gameState(M.k) });
    const e = outcome(sim.grid);
    const cup = [42, 73].includes(f.lg);
    const w = cup ? M.wCup : M.w;
    let grid = sim.grid;
    if (odds && w > 0) {
      const m = noVig(odds);
      const z = { h: Math.exp((1 - w) * Math.log(e.h) + w * Math.log(m.h)), d: Math.exp((1 - w) * Math.log(e.d) + w * Math.log(m.d)), a: Math.exp((1 - w) * Math.log(e.a) + w * Math.log(m.a)) };
      const s = z.h + z.d + z.a;
      grid = reweight(sim.grid, { h: z.h / s, d: z.d / s, a: z.a / s });
    }
    const g = pend.find((x) => x.id === f.id) as Game & { lineupType?: string };
    // Sans cotes (coupe d'Europe, ou cotes pas encore publiées), seuil plus haut : moteur seul, 87,9 % de réussite à 85 %.
    return { f, row: r, lambda: [lh, la], engine: e, final: outcome(grid), grid, probs: probs(grid), sim, T: cup || !odds ? M.Tcup : M.T, lineupType: g.lineupType, label: (id: string) => marketById.get(id)!.label(f.home.name, f.away.name) };
  });
}
