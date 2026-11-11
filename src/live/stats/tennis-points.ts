// Tennis point par point : un format unique pour tous les fournisseurs, et tout ce que le moteur en tire.
//
// Un point = qui sert, qui gagne, sur quelle balle de service, comment il se termine (ace, double faute, service gagnant,
// coup gagnant, faute directe, faute provoquée), avec quel coup (coup droit, revers, volée, smash, amortie, lob, passing,
// retour…), la longueur de l'échange et les points importants (balle de break, jeu décisif). Chaque champ est facultatif :
// le moteur prend ce qu'il reçoit, du simple « qui a gagné le point » jusqu'au détail de chaque frappe.
//
// Lecteurs fournis : texte libre de fournisseur (« Backhand unforced error », « Ace », « Faute directe en coup droit »…)
// et notation du Match Charting Project (« 4f2b3*», « 6n », « 5b1f2@ »…), utile pour apprendre les coefficients.
import { classify } from './catalog.ts';
import type { TennisState } from '../tennis.ts';

export type Outcome = 'ace' | 'double_fault' | 'service_winner' | 'winner' | 'unforced_error' | 'forced_error' | 'unknown';
export type Stroke = 'serve' | 'return' | 'forehand' | 'backhand' | 'volley' | 'smash' | 'drop' | 'lob' | 'passing' | 'halfvolley' | 'other';

export interface TennisPoint {
  /** Set (1, 2…) et jeu dans le set (1, 2…), si connus. */
  set?: number;
  game?: number;
  server: 0 | 1;
  winner: 0 | 1;
  /** Balle de service sur laquelle le point s'est joué (2 : après une faute de 1re balle). */
  serve?: 1 | 2;
  outcome?: Outcome;
  /** Joueur qui a frappé la dernière balle (gagnant pour un coup gagnant, perdant pour une faute). */
  by?: 0 | 1;
  stroke?: Stroke;
  /** Nombre de frappes dans l'échange (service compris). */
  rally?: number;
  tiebreak?: boolean;
  breakPoint?: boolean;
  /** Secondes depuis le début du match (fatigue, rythme). */
  t?: number;
  /** Score avant le point, si le fournisseur le donne : jeux du set en cours et points du jeu (vus de A puis de B). */
  games?: [number, number];
  points?: [number, number];
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecture d'une description de fin de point, n'importe quel fournisseur, n'importe quelle langue.
export function outcomeFromText(text: string): { outcome: Outcome; stroke?: Stroke } {
  const c = classify('tennis', text);
  const k = c.key;
  const stroke = (k.split('.')[1] as Stroke | undefined);
  if (k === 'serve.aces') return { outcome: 'ace', stroke: 'serve' };
  if (k === 'serve.df') return { outcome: 'double_fault', stroke: 'serve' };
  if (/service winner|service gagnant|unreturned|non retourne/i.test(text)) return { outcome: 'service_winner', stroke: 'serve' };
  if (k.startsWith('ue')) return { outcome: 'unforced_error', stroke: stroke ?? 'other' };
  if (k.startsWith('fe')) return { outcome: 'forced_error', stroke: stroke ?? 'other' };
  if (k.startsWith('winners')) return { outcome: 'winner', stroke: stroke ?? 'other' };
  return { outcome: 'unknown' };
}

// Notation du Match Charting Project (Jeff Sackmann) : service 4/5/6 (fautes n, w, d, x, g, e, !, V), puis une lettre par
// frappe (f coup droit, b revers, r/s slices, v/z volées, o/p smashs, u/y amorties, l/m lobs, h/i demi-volées, j/k volées
// frappées, t coup spécial, q inconnu) ; la fin : * coup gagnant, # faute provoquée, @ faute directe.
const MCP_STROKE: Record<string, Stroke> = { f: 'forehand', r: 'forehand', b: 'backhand', s: 'backhand', v: 'volley', z: 'volley', j: 'volley', k: 'volley', o: 'smash', p: 'smash', u: 'drop', y: 'drop', l: 'lob', m: 'lob', h: 'halfvolley', i: 'halfvolley', t: 'other', q: 'other' };
/** Une balle de service MCP (1re ou 2e) -> faute ? frappes après le service et fin d'échange. */
function mcpServe(code: string): { fault: boolean; strokes: string[]; end?: '*' | '#' | '@' } {
  const c = (code ?? '').replace(/^c+/, ''); // « c » : let
  if (!c || /^[0456]?[nwdxge!V]/.test(c)) return { fault: true, strokes: [] };
  const end = (/[*#@]/.exec(c)?.[0] as '*' | '#' | '@' | undefined);
  // Lettres de frappe seulement (n, w, d, x… après la dernière frappe : type de faute, pas une frappe).
  const strokes = c.slice(1).split('').filter((ch) => ch in MCP_STROKE);
  return { fault: false, strokes, end };
}

/** Point MCP (colonnes 1st et 2nd) -> point au format commun. `server` et `winner` viennent des colonnes Svr et PtWinner. */
export function pointFromMcp(first: string, second: string, server: 0 | 1, winner: 0 | 1): TennisPoint {
  const f = mcpServe(first);
  const useSecond = f.fault;
  const p = useSecond ? mcpServe(second) : f;
  const serve: 1 | 2 = useSecond ? 2 : 1;
  if (useSecond && p.fault) return { server, winner, serve, outcome: 'double_fault', by: server, stroke: 'serve', rally: 1 };
  const n = p.strokes.length; // frappes après le service
  const lastBy: 0 | 1 = (n % 2 === 0 ? server : (1 - server)) as 0 | 1;
  const lastStroke: Stroke = n === 0 ? 'serve' : n === 1 ? 'return' : (MCP_STROKE[p.strokes[n - 1]] ?? 'other');
  let outcome: Outcome = 'unknown';
  if (n === 0) outcome = p.end === '*' ? 'ace' : 'service_winner';
  else if (p.end === '*') outcome = 'winner';
  else if (p.end === '@') outcome = 'unforced_error';
  else if (p.end === '#') outcome = n === 1 ? 'service_winner' : 'forced_error';
  return { server, winner, serve, outcome, by: lastBy, stroke: lastStroke, rally: n + 1 };
}

// ---------------------------------------------------------------------------------------------------------------------
export interface PlayerAgg {
  servePlayed: number; serveWon: number;
  firstPlayed: number; firstWon: number; secondPlayed: number; secondWon: number;
  returnPlayed: number; returnWon: number;
  aces: number; df: number; serviceWinners: number;
  winners: number; ue: number; fe: number;
  winnersBy: Partial<Record<Stroke, number>>; ueBy: Partial<Record<Stroke, number>>; feBy: Partial<Record<Stroke, number>>;
  bpFaced: number; bpSaved: number; bpChances: number; bpWon: number;
  /** Points gagnés sur les 20 derniers points joués (forme du moment), et série en cours (positif : points d'affilée gagnés). */
  recentWon: number; recentPlayed: number; streak: number; bestStreak: number;
  rallyLong: number; rallyLongWon: number; // échanges de 9 frappes et plus
}
const emptyAgg = (): PlayerAgg => ({
  servePlayed: 0, serveWon: 0, firstPlayed: 0, firstWon: 0, secondPlayed: 0, secondWon: 0, returnPlayed: 0, returnWon: 0,
  aces: 0, df: 0, serviceWinners: 0, winners: 0, ue: 0, fe: 0, winnersBy: {}, ueBy: {}, feBy: {},
  bpFaced: 0, bpSaved: 0, bpChances: 0, bpWon: 0, recentWon: 0, recentPlayed: 0, streak: 0, bestStreak: 0, rallyLong: 0, rallyLongWon: 0,
});

/** Tout ce qui se compte à partir des points : service, retour, coups gagnants et fautes par coup, balles de break, séries. */
export function aggregate(points: TennisPoint[], recent = 20): [PlayerAgg, PlayerAgg] {
  const A: [PlayerAgg, PlayerAgg] = [emptyAgg(), emptyAgg()];
  points.forEach((p, i) => {
    const s = A[p.server], r = A[1 - p.server];
    const srvWon = p.winner === p.server;
    s.servePlayed++; r.returnPlayed++;
    if (srvWon) s.serveWon++; else r.returnWon++;
    if (p.serve === 2) { s.secondPlayed++; if (srvWon) s.secondWon++; } else if (p.serve === 1) { s.firstPlayed++; if (srvWon) s.firstWon++; }
    if (p.breakPoint) { s.bpFaced++; r.bpChances++; if (srvWon) s.bpSaved++; else r.bpWon++; }
    const by = p.by ?? (p.outcome === 'unforced_error' || p.outcome === 'forced_error' || p.outcome === 'double_fault' ? (1 - p.winner) as 0 | 1 : p.winner);
    const st = p.stroke ?? 'other';
    switch (p.outcome) {
      case 'ace': A[p.server].aces++; break;
      case 'double_fault': A[p.server].df++; break;
      case 'service_winner': A[p.server].serviceWinners++; break;
      case 'winner': A[by].winners++; A[by].winnersBy[st] = (A[by].winnersBy[st] ?? 0) + 1; break;
      case 'unforced_error': A[by].ue++; A[by].ueBy[st] = (A[by].ueBy[st] ?? 0) + 1; break;
      case 'forced_error': A[by].fe++; A[by].feBy[st] = (A[by].feBy[st] ?? 0) + 1; break;
    }
    if ((p.rally ?? 0) >= 9) { A[0].rallyLong++; A[1].rallyLong++; A[p.winner].rallyLongWon++; }
    for (const k of [0, 1] as const) {
      const w = p.winner === k;
      const a = A[k];
      a.streak = w ? Math.max(1, a.streak + 1) : Math.min(-1, a.streak - 1);
      a.bestStreak = Math.max(a.bestStreak, a.streak);
      if (i >= points.length - recent) { a.recentPlayed++; if (w) a.recentWon++; }
    }
  });
  return A;
}

/** Le score se déduit des points : sets terminés, jeux et points du set en cours, serveur suivant. */
export function stateFromPoints(points: TennisPoint[], bestOf: 3 | 5, superTb = bestOf === 5): TennisState {
  const need = bestOf === 5 ? 3 : 2;
  const sets: Array<[number, number]> = [];
  let g: [number, number] = [0, 0], pt: [number, number] = [0, 0];
  let server: 0 | 1 = points[0]?.server ?? 0;
  let setServer = server;
  const won = () => sets.reduce((acc, [a, b]) => (a > b ? [acc[0] + 1, acc[1]] : [acc[0], acc[1] + 1]), [0, 0]);
  for (const p of points) {
    const [sa, sb] = won();
    if (sa >= need || sb >= need) break;
    const decisive = sa === need - 1 && sb === need - 1;
    const tb = g[0] === 6 && g[1] === 6;
    const to = tb && decisive && superTb ? 10 : 7;
    pt[p.winner]++;
    const [x, y] = pt;
    const gameOver = tb ? (Math.max(x, y) >= to && Math.abs(x - y) >= 2) : (Math.max(x, y) >= 4 && Math.abs(x - y) >= 2);
    if (tb) {
      // Jeu décisif : changement de serveur après le 1er point puis tous les deux points.
      const n = x + y;
      if (!gameOver && (n % 2 === 1)) server = (1 - server) as 0 | 1;
    }
    if (gameOver) {
      g[x > y ? 0 : 1]++;
      pt = [0, 0];
      const setOver = (Math.max(...g) >= 6 && Math.abs(g[0] - g[1]) >= 2) || Math.max(...g) === 7;
      if (setOver) {
        sets.push([g[0], g[1]]);
        // Le joueur qui n'a pas servi le premier jeu du set qui finit sert le premier jeu du suivant… sauf au jeu décisif :
        // celui qui a relancé le premier point du jeu décisif sert. Dans les deux cas : l'autre que le serveur du 1er jeu,
        // si le nombre de jeux est impair ; le même s'il est pair.
        setServer = ((g[0] + g[1]) % 2 === 1 ? 1 - setServer : setServer) as 0 | 1;
        server = setServer;
        g = [0, 0];
      } else if (!tb) server = (1 - server) as 0 | 1;
    }
  }
  // Serveur annoncé par le fournisseur au dernier point : il prime sur la déduction.
  const st: TennisState = { bestOf, sets, games: g, points: pt, server, superTb };
  if (g[0] === 0 && g[1] === 0 && pt[0] === 0 && pt[1] === 0) { delete st.points; }
  return st;
}
