// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  POINT DE BRANCHEMENT DES STATS DU DIRECT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Pour brancher une nouvelle source (API-Tennis, Goalserve, Sportradar, Stats Perform…) :
//   1. copier src/live/sources/modele.ts sous un nouveau nom, remplir `live()` et `match()` avec les appels du fournisseur ;
//   2. l'ajouter à la liste SOURCES ci-dessous ;
//   3. mettre la clé du fournisseur dans les variables d'environnement Vercel (jamais dans le code) ;
//   4. node scripts/build-live-api.mjs (régénère api/live.js), puis tester : GET /api/live?sport=tennis&id=…
//
// La source n'a rien à « comprendre » : elle rend les stats avec les libellés du fournisseur tels quels, et les points
// avec la description de fin de point telle quelle. Le catalogue (src/live/stats/catalog.ts) range tout sous des clés
// canoniques, le moteur exploite ce qu'il connaît et garde le reste (« other.* ») sans rien perdre.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import { StatBook, statsFromRow, type Sport } from './stats/catalog.ts';
import { outcomeFromText, type Outcome, type Stroke, type TennisPoint } from './stats/tennis-points.ts';
import { flashscore } from './sources/flashscore.ts';
import { sameParticipant } from './sources/matching.ts';

/** Un match tel que le fournisseur le liste. */
export interface SourceRef { id: string; sport: Sport; home: string; away: string; start?: string; tourney?: string }

/** Une stat brute : libellé du fournisseur, valeurs des deux côtés (texte ou nombre), période (« 1st set », « Q2 »…). */
export interface RawStat { label: string; home: unknown; away: unknown; period?: string | null }

/** Un point de tennis brut. Seuls `server` et `winner` sont obligatoires ; tout le reste améliore la lecture. */
export interface RawPoint {
  server: 0 | 1; // 0 : joueur « home » (A), 1 : « away » (B)
  winner: 0 | 1;
  set?: number; game?: number;
  serve?: 1 | 2;
  /** Fin du point telle que décrite par le fournisseur (« Backhand unforced error », « Ace », « Faute directe »…). */
  result?: string;
  /** …ou déjà rangée. */
  outcome?: Outcome;
  stroke?: Stroke | string;
  /** Joueur qui a frappé la dernière balle, si le fournisseur le dit. */
  by?: 0 | 1;
  rally?: number; breakPoint?: boolean; tiebreak?: boolean; t?: number;
}

/** Un événement brut (foot, NBA) : minute ou temps de jeu, camp, type tel que décrit par le fournisseur. */
export interface RawEvent { t: number; side?: 0 | 1; type: string; text?: string; value?: number; player?: string }

export interface SourceMatch {
  id: string; sport: Sport; home: string; away: string;
  state: 'pre' | 'in' | 'post';
  /** Tennis : score si connu (sinon déduit des points). */
  tennis?: { bestOf?: 3 | 5; sets?: Array<[number, number]>; games?: [number, number]; points?: [number, number]; server?: 0 | 1; pointLog?: RawPoint[] };
  stats?: RawStat[];
  events?: RawEvent[];
  score?: [number | null, number | null];
  quality?: { at: string; stale: boolean; complete: boolean; errors: Record<string, string> };
  /** Données et cotes dans leur ordre NATIF explicite ; jamais implicitement réétiquetées après swap. */
  native?: { home: string; away: string; data: unknown };
  odds?: { home: string; away: string; data: unknown };
}

export interface SourceOptions { odds?: boolean }

export interface LiveSource {
  /** Nom court (« api-tennis », « goalserve »…), utilisé dans ?source= et dans les réponses. */
  name: string;
  sports: Sport[];
  /** Vrai si la source est activée et configurée (clé présente si nécessaire) ; sinon elle est ignorée. */
  ready(): boolean;
  live(sport: Sport): Promise<SourceRef[]>;
  match(sport: Sport, id: string, options?: SourceOptions): Promise<SourceMatch>;
}

// ═══ BRANCHER ICI ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// import { modele } from './sources/modele.ts';
export const SOURCES: LiveSource[] = [
  flashscore,
  // modele,
];
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const sourcesFor = (sport: Sport) => SOURCES.filter((s) => s.sports.includes(sport) && s.ready());

const STROKES = new Set(['serve', 'return', 'forehand', 'backhand', 'volley', 'smash', 'drop', 'lob', 'passing', 'halfvolley', 'other']);

/** Points bruts -> points au format du moteur (fin de point et coup reconnus dans n'importe quelle langue). */
export function normalizePoints(raw: RawPoint[]): TennisPoint[] {
  return raw.map((r) => {
    const read = r.result ? outcomeFromText(r.result) : undefined;
    const outcome = r.outcome ?? read?.outcome ?? 'unknown';
    const stroke = (r.stroke && STROKES.has(String(r.stroke)) ? r.stroke : r.stroke ? outcomeFromText(`${r.stroke} winner`).stroke : read?.stroke) as Stroke | undefined;
    return { server: r.server, winner: r.winner, set: r.set, game: r.game, serve: r.serve, outcome, stroke, by: r.by, rally: r.rally, breakPoint: r.breakPoint, tiebreak: r.tiebreak, t: r.t };
  });
}

/** Stats brutes -> carnet de stats rangées (toutes conservées, connues ou non). */
export function bookOf(sport: Sport, stats: RawStat[] = []): StatBook {
  const b = new StatBook();
  for (const s of stats) b.add(statsFromRow(sport, s));
  return b;
}

/** Noms complets/initiales tennis, codes NBA et noms de clubs ; une ressemblance vague ne suffit pas. */
export function sameMatch(a: { home: string; away: string }, b: { home: string; away: string }, sport: Sport = 'tennis'): 'same' | 'swapped' | undefined {
  const same = sameParticipant(a.home, b.home, sport) && sameParticipant(a.away, b.away, sport);
  const swapped = sameParticipant(a.home, b.away, sport) && sameParticipant(a.away, b.home, sport);
  if (same && !swapped) return 'same';
  if (swapped && !same) return 'swapped';
  return undefined;
}

/** Le même match dans une source branchée, s'il y en a une : données remises dans l'ordre (A, B) demandé. */
export async function enrich(sport: Sport, want: { home: string; away: string }, options: SourceOptions = {}, sources = sourcesFor(sport)): Promise<{ source: string; match: SourceMatch } | undefined> {
  for (const src of sources) {
    if (!src.ready() || !src.sports.includes(sport)) continue;
    try {
      const list = await src.live(sport);
      const candidates = list.filter((ref) => ref.sport === sport && ref.id).map((ref) => ({ ref, how: sameMatch(want, ref, sport) })).filter((c) => c.how);
      if (candidates.length !== 1) continue; // ambigu : pas de données appliquées au mauvais match
      const { ref, how } = candidates[0];
      const m = await src.match(sport, ref.id, options);
      if (m.id !== ref.id || m.sport !== sport || m.state === 'pre' || m.quality?.stale || sameMatch(ref, m, sport) !== 'same') continue;
      return { source: src.name, match: how === 'same' ? m : swap(m) };
    } catch { /* source en panne : on continue sans elle */ }
  }
  return undefined;
}

/** Inverse les deux camps d'un match (la source a A et B dans l'autre ordre). */
export function swap(m: SourceMatch): SourceMatch {
  const f = (x: 0 | 1 | undefined) => (x == null ? x : ((1 - x) as 0 | 1));
  const pair = <T>(p?: [T, T]) => (p ? [p[1], p[0]] as [T, T] : p);
  return {
    ...m, home: m.away, away: m.home, score: pair(m.score),
    tennis: m.tennis && {
      ...m.tennis, sets: m.tennis.sets?.map(([a, b]) => [b, a] as [number, number]), games: pair(m.tennis.games), points: pair(m.tennis.points), server: f(m.tennis.server),
      pointLog: m.tennis.pointLog?.map((p) => ({ ...p, server: f(p.server)!, winner: f(p.winner)!, by: f(p.by) })),
    },
    stats: m.stats?.map((s) => ({ ...s, home: s.away, away: s.home })),
    events: m.events?.map((e) => ({ ...e, side: f(e.side) })),
  };
}
