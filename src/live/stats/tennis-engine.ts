// Moteur tennis nourri par les stats du direct, à n'importe quel niveau de détail :
//   - seulement le score (sets, jeux)                        -> moteur de base (forme révisée par les sets)
//   - stats de match (points au service, 1re/2e balle…)       -> forme révisée par les points au service
//   - fautes directes, coups gagnants (au total ou par coup)  -> les points perdus sur faute directe pèsent à part
//   - point par point (serveur, issue, coup, échange)        -> tout ce qui précède, plus la forme du moment (derniers points)
//
// Comment les fautes directes entrent dans le calcul : chaque point compte dans la révision de la forme avec un poids selon
// sa fin (ace, coup gagnant, faute directe, faute provoquée…). Un poids de 1 partout donne le calcul habituel (chaque point
// pareil) ; un poids plus faible sur les fautes directes dit « un joueur mené à cause de ses propres fautes revient plus
// souvent qu'un joueur dominé par les coups gagnants adverses ». Les poids s'apprennent sur des matchs relevés point par
// point (src/cli/livetennisstats.ts) ; tant qu'ils ne sont pas appris, ils valent 1 (aucune hypothèse inventée).
import { DEFAULT_TENNIS, tennisLive, type TennisLiveOut, type TennisLiveParams, type TennisState } from '../tennis.ts';
import type { StatBook } from './catalog.ts';
import { aggregate, stateFromPoints, type Outcome, type PlayerAgg, type TennisPoint } from './tennis-points.ts';

export interface PointWeights {
  /** Poids d'un point dans la révision de la forme, selon sa fin. */
  outcome: Record<Outcome, number>;
  /** Poids supplémentaire des 20 derniers points (forme du moment) : 0 = pas de prime au présent. */
  recent: number;
}
export const NEUTRAL_WEIGHTS: PointWeights = {
  outcome: { ace: 1, double_fault: 1, service_winner: 1, winner: 1, unforced_error: 1, forced_error: 1, unknown: 1 },
  recent: 0,
};

export interface TennisInput {
  bestOf: 3 | 5;
  superTb?: boolean;
  /** Score, si on n'a pas le point par point. */
  sets?: Array<[number, number]>;
  games?: [number, number];
  points?: [number, number];
  server?: 0 | 1;
  /** Point par point (le plus précis : le score en est déduit s'il n'est pas donné). */
  pointLog?: TennisPoint[];
  /** Stats de match rangées (n'importe quel fournisseur, voir catalog.ts). */
  stats?: StatBook;
}

/** Ce que les stats disent, en clair : servira aux jauges de la page (fautes, rythme, chance, remontée). */
export interface TennisRead {
  level: 'score' | 'stats' | 'points';
  /** Points gagnés au service (gagnés, joués), tels qu'entrés dans le calcul après pondération. */
  servePts?: [[number, number], [number, number]];
  /** Part des points gagnés au service, brute, et ce qu'on en attendait avant le match. */
  serveRate?: [number | null, number | null];
  serveExpected: [number, number];
  ue?: [number | null, number | null];
  winners?: [number | null, number | null];
  /** Coups gagnants moins fautes directes. */
  netShots?: [number | null, number | null];
  /** Fautes directes par coup (coup droit, revers…), si le fournisseur les détaille. */
  ueBy?: [Record<string, number>, Record<string, number>];
  winnersBy?: [Record<string, number>, Record<string, number>];
  aces?: [number | null, number | null];
  df?: [number | null, number | null];
  /** Points gagnés sur les 20 derniers et série en cours (points de suite, négatif : points perdus de suite). */
  recent?: [number, number];
  streak?: [number, number];
  breakPoints?: { saved: [number, number]; faced: [number, number] };
}

const val = (b: StatBook | undefined, k: string, side: 0 | 1) => b?.get(k, side)?.value ?? null;

/** Points au service pondérés, à partir du point par point. */
function weighted(points: TennisPoint[], W: PointWeights): [[number, number], [number, number]] {
  const out: [[number, number], [number, number]] = [[0, 0], [0, 0]];
  const n = points.length;
  points.forEach((p, i) => {
    let w = W.outcome[p.outcome ?? 'unknown'] ?? 1;
    if (i >= n - 20) w *= 1 + W.recent;
    out[p.server][1] += w;
    if (p.winner === p.server) out[p.server][0] += w;
  });
  return out;
}

/** Points au service à partir des stats de match seules (n'importe quel détail : total, 1re et 2e balle…). */
function fromStats(b: StatBook, W: PointWeights): [[number, number], [number, number]] | undefined {
  const sp: Array<[number, number] | undefined> = [0, 1].map((k) => {
    const side = k as 0 | 1;
    const all = b.get('serve.won', side);
    if (all?.made != null && all.att) return [all.made, all.att];
    const f = b.get('serve.first.won', side), s = b.get('serve.second.won', side);
    if (f?.made != null && f.att != null && s?.made != null && s.att != null) return [f.made + s.made, f.att + s.att];
    // Retour adverse connu : points perdus au service = points gagnés en retour par l'adversaire.
    const r = b.get('return.won', (1 - side) as 0 | 1);
    if (r?.made != null && r.att) return [r.att - r.made, r.att];
    return undefined;
  });
  if (!sp[0] || !sp[1]) return undefined;
  const out = [[...sp[0]], [...sp[1]]] as [[number, number], [number, number]];
  // Fautes directes sans détail point par point : réparties entre jeux de service et de retour au prorata des points joués.
  const wUe = W.outcome.unforced_error;
  if (wUe !== 1) {
    const tot = out[0][1] + out[1][1];
    for (const side of [0, 1] as const) {
      const own = b.family('ue', side), opp = b.family('ue', (1 - side) as 0 | 1);
      const share = out[side][1] / tot;
      const lostOwn = (own ?? 0) * share, wonOpp = (opp ?? 0) * share;
      // Un point perdu sur sa propre faute et un point gagné sur la faute adverse comptent avec le poids des fautes.
      out[side][0] -= (1 - wUe) * wonOpp;
      out[side][1] -= (1 - wUe) * (lostOwn + wonOpp);
    }
  }
  return out;
}

/** Nombre de points joués jusqu'à la fin du dernier set terminé. */
function countToSetEnd(points: TennisPoint[], bestOf: 3 | 5, superTb?: boolean): number {
  let lo = 0;
  const done = stateFromPoints(points, bestOf, superTb).sets.length;
  if (!done) return 0;
  // Recherche du plus petit préfixe qui contient tous les sets terminés.
  let hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (stateFromPoints(points.slice(0, mid), bestOf, superTb).sets.length >= done) hi = mid; else lo = mid + 1; }
  return lo;
}

const family = (ag: PlayerAgg, k: 'ueBy' | 'winnersBy') => Object.fromEntries(Object.entries(ag[k]).map(([s, n]) => [s, n ?? 0]));

/** Pronostic tennis depuis tout ce qu'on sait du match. `base` : points de service de base calés avant le match. */
export function tennisFromStats(base: [number, number], input: TennisInput, P: TennisLiveParams = DEFAULT_TENNIS, W: PointWeights = NEUTRAL_WEIGHTS): TennisLiveOut & { read: TennisRead } {
  const read: TennisRead = { level: 'score', serveExpected: base };
  let st: TennisState;
  if (input.pointLog?.length) {
    st = stateFromPoints(input.pointLog, input.bestOf, input.superTb);
    if (input.server != null) st.server = input.server;
    st.servePts = weighted(input.pointLog, W);
    // Points du set en cours : ceux joués depuis la fin du dernier set terminé.
    const inSet = input.pointLog.length - countToSetEnd(input.pointLog, input.bestOf, input.superTb);
    if (inSet > 0) st.curSetPts = weighted(input.pointLog.slice(-inSet), { ...W, recent: 0 });
    const [a, b] = aggregate(input.pointLog);
    read.level = 'points';
    read.serveRate = [a.servePlayed ? a.serveWon / a.servePlayed : null, b.servePlayed ? b.serveWon / b.servePlayed : null];
    read.ue = [a.ue, b.ue]; read.winners = [a.winners, b.winners]; read.netShots = [a.winners - a.ue, b.winners - b.ue];
    read.ueBy = [family(a, 'ueBy'), family(b, 'ueBy')]; read.winnersBy = [family(a, 'winnersBy'), family(b, 'winnersBy')];
    read.aces = [a.aces, b.aces]; read.df = [a.df, b.df];
    read.recent = [a.recentWon, b.recentWon]; read.streak = [a.streak, b.streak];
    read.breakPoints = { saved: [a.bpSaved, b.bpSaved], faced: [a.bpFaced, b.bpFaced] };
  } else {
    st = { bestOf: input.bestOf, superTb: input.superTb, sets: input.sets ?? [], games: input.games, points: input.points, server: input.server };
    const sp = input.stats ? fromStats(input.stats, W) : undefined;
    if (sp) { st.servePts = sp; read.level = 'stats'; }
  }
  if (input.stats) {
    const b = input.stats;
    const pick = (k: string) => [val(b, k, 0), val(b, k, 1)] as [number | null, number | null];
    read.ue ??= [b.family('ue', 0), b.family('ue', 1)];
    read.winners ??= [b.family('winners', 0), b.family('winners', 1)];
    read.netShots ??= [read.winners[0] != null && read.ue[0] != null ? read.winners[0] - read.ue[0] : null, read.winners[1] != null && read.ue[1] != null ? read.winners[1] - read.ue[1] : null];
    read.aces ??= pick('serve.aces'); read.df ??= pick('serve.df');
    if (!read.ueBy) {
      const by = (side: 0 | 1, pre: string) => Object.fromEntries(b.all.filter((s) => s.side === side && s.period === 'all' && s.key.startsWith(`${pre}.`) && s.v.value != null).map((s) => [s.key.split('.')[1], s.v.value!]));
      read.ueBy = [by(0, 'ue'), by(1, 'ue')]; read.winnersBy = [by(0, 'winners'), by(1, 'winners')];
    }
  }
  if (st.servePts) {
    read.servePts = st.servePts;
    read.serveRate ??= [st.servePts[0][1] ? st.servePts[0][0] / st.servePts[0][1] : null, st.servePts[1][1] ? st.servePts[1][0] / st.servePts[1][1] : null];
  }
  return { ...tennisLive(P, base, st), read };
}
