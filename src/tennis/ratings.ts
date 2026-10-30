// Notes des joueurs, mises à jour match après match dans l'ordre : Elo (général et par surface, façon FiveThirtyEight),
// qualité au service et au retour corrigée de l'adversaire (général et par surface), et l'état du joueur avant chaque
// match (repos, fatigue du tournoi, forme, abandon récent, longue absence, changement de surface).
import type { Match, Side, Surface } from './history.ts';
import { match as matchProb } from './score.ts';

export interface RatingParams {
  serveK: number; // part minimale de l'écart observé reportée sur la note de service ou de retour
  serveKn: number; // la part vaut max(serveK, 1 / (matchs + serveKn)) : un joueur peu connu bouge plus vite
  surfMix: number; // part de la note de surface dans la note utilisée
  kFloor?: number; // K minimal de l'Elo : plus haut, les derniers résultats pèsent plus, même pour un joueur de 500 matchs
}
export const DEFAULT_RATING: RatingParams = { serveK: 0.035, serveKn: 6, surfMix: 0.5 };

interface State {
  elo: number;
  eloS: Record<Surface, number>;
  n: number;
  nS: Record<Surface, number>;
  sd: number; // points gagnés au service, au-dessus de la moyenne du circuit
  rd: number; // points pris en retour, au-dessus de la moyenne
  sdS: Record<Surface, number>;
  rdS: Record<Surface, number>;
  nServe: number;
  nServeS: Record<Surface, number>;
  last?: { date: string; surface: Surface; minutes?: number; tid: string };
  recent: Array<{ date: string; res: number; minutes?: number }>; // res : gagné - attendu (Elo)
  retiredAt?: string; // dernier abandon (en perdant)
  tourney?: { tid: string; minutes: number; sets: number; matches: number };
  info?: { name: string; atp?: string; ioc: string; hand: string; ht?: number; age?: number; ageAt: string; rank?: number };
}

/** Ce qu'on sait d'un joueur juste avant un match. */
export interface Snapshot {
  id: string;
  elo: number;
  eloSurf: number;
  n: number;
  nSurf: number;
  serve: number; // note de service utilisée (mélange général / surface)
  ret: number;
  nServe: number;
  daysOff: number; // jours depuis le dernier match (999 si jamais joué)
  lastMinutes?: number;
  tourneyMinutes: number; // minutes déjà jouées dans ce tournoi
  tourneySets: number;
  played14: number; // matchs joués sur les 14 derniers jours
  form10: number; // somme (gagné - attendu) sur les 10 derniers matchs
  retired30: boolean; // a abandonné un match dans les 30 jours
  surfaceSwitch: boolean; // dernier match sur une autre surface
  age?: number;
  rank?: number;
}

const SURFS: Surface[] = ['Hard', 'Clay', 'Grass'];
const zero = () => ({ Hard: 0, Clay: 0, Grass: 0 });
const fifteen = () => ({ Hard: 1500, Clay: 1500, Grass: 1500 });
const day = (d: string) => Date.parse(d) / 86_400_000;
const eloP = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));
const kElo0 = (n: number) => 250 / (n + 5) ** 0.4;

export class Ratings {
  readonly S = new Map<string, State>();
  // Moyenne du circuit des points gagnés au service, par surface (suivie au fil des matchs).
  readonly avg: Record<Surface, { won: number; pts: number }> = { Hard: { won: 0.64 * 2000, pts: 2000 }, Clay: { won: 0.62 * 2000, pts: 2000 }, Grass: { won: 0.66 * 2000, pts: 2000 } };
  readonly P: RatingParams;
  constructor(params: RatingParams = DEFAULT_RATING) {
    this.P = params;
  }

  state(id: string): State {
    let s = this.S.get(id);
    if (!s) {
      s = { elo: 1500, eloS: fifteen(), n: 0, nS: zero(), sd: 0, rd: 0, sdS: zero(), rdS: zero(), nServe: 0, nServeS: zero(), recent: [] };
      this.S.set(id, s);
    }
    return s;
  }
  avgServe(surface: Surface): number {
    return this.avg[surface].won / this.avg[surface].pts;
  }
  /** Points gagnés au service attendus pour `a` contre `b` (Barnett et Clarke : moyenne + service de a - retour de b). */
  servePoint(a: Snapshot, b: Snapshot, surface: Surface): number {
    return Math.min(0.92, Math.max(0.35, this.avgServe(surface) + a.serve - b.ret));
  }

  snapshot(id: string, m: Pick<Match, 'date' | 'surface' | 'tid'>): Snapshot {
    const s = this.state(id), mix = this.P.surfMix, sf = m.surface;
    const t = s.tourney?.tid === m.tid ? s.tourney : undefined;
    return {
      id, elo: s.elo, eloSurf: s.eloS[sf], n: s.n, nSurf: s.nS[sf],
      serve: (1 - mix) * s.sd + mix * s.sdS[sf], ret: (1 - mix) * s.rd + mix * s.rdS[sf], nServe: s.nServe,
      daysOff: s.last ? day(m.date) - day(s.last.date) : 999, lastMinutes: s.last?.minutes,
      tourneyMinutes: t?.minutes ?? 0, tourneySets: t?.sets ?? 0,
      played14: s.recent.filter((r) => day(m.date) - day(r.date) <= 14).length,
      form10: s.recent.slice(-10).reduce((a, r) => a + r.res, 0),
      retired30: !!s.retiredAt && day(m.date) - day(s.retiredAt) <= 30,
      surfaceSwitch: !!s.last && s.last.surface !== sf,
      age: s.info?.age != null ? s.info.age + (day(m.date) - day(s.info.ageAt)) / 365.25 : undefined,
      rank: s.info?.rank,
    };
  }

  /** Elo moitié général, moitié surface : probabilité que `a` batte `b`. */
  eloProb(a: Snapshot, b: Snapshot): number {
    return eloP((a.elo + a.eloSurf) / 2, (b.elo + b.eloSurf) / 2);
  }
  /** Probabilité de victoire selon les notes de service et de retour (points indépendants). */
  pointProb(a: Snapshot, b: Snapshot, surface: Surface, bo: 3 | 5): number {
    return matchProb(this.servePoint(a, b, surface), this.servePoint(b, a, surface), bo);
  }

  update(m: Match): void {
    if (m.walkover) return;
    const W = this.state(m.w.id), L = this.state(m.l.id), sf = m.surface;
    const kElo = (n: number) => Math.max(this.P.kFloor ?? 0, kElo0(n));
    const pAll = eloP(W.elo, L.elo), pS = eloP(W.eloS[sf], L.eloS[sf]), pB = eloP((W.elo + W.eloS[sf]) / 2, (L.elo + L.eloS[sf]) / 2);
    W.elo += kElo(W.n) * (1 - pAll); L.elo -= kElo(L.n) * (1 - pAll);
    W.eloS[sf] += kElo(W.nS[sf]) * (1 - pS); L.eloS[sf] -= kElo(L.nS[sf]) * (1 - pS);
    W.n++; L.n++; W.nS[sf]++; L.nS[sf]++;
    // Service et retour : écart entre les points gagnés au service et l'attendu, réparti entre le serveur et le relanceur.
    if (m.w.serve && m.l.serve && m.w.serve.svpt >= 20 && m.l.serve.svpt >= 20) {
      const k = (st: State) => Math.max(this.P.serveK, 1 / (st.nServe + this.P.serveKn));
      const ks = (st: State) => Math.max(this.P.serveK * 1.5, 1 / (st.nServeS[sf] + this.P.serveKn));
      const a = this.avgServe(sf);
      for (const [S, R, sv] of [[W, L, m.w.serve], [L, W, m.l.serve]] as Array<[State, State, Side['serve'] & object]>) {
        const won = (sv.firstWon + sv.secondWon) / sv.svpt;
        const r = won - (a + S.sd - R.rd), rs = won - (a + S.sdS[sf] - R.rdS[sf]);
        S.sd += k(S) * r; R.rd -= k(R) * r;
        S.sdS[sf] += ks(S) * rs; R.rdS[sf] -= ks(R) * rs;
        this.avg[sf].won += sv.firstWon + sv.secondWon; this.avg[sf].pts += sv.svpt;
      }
      // La moyenne du circuit suit les 30 000 derniers points environ.
      if (this.avg[sf].pts > 30_000) { this.avg[sf].won *= 0.98; this.avg[sf].pts *= 0.98; }
      W.nServe++; L.nServe++; W.nServeS[sf]++; L.nServeS[sf]++;
    }
    for (const [S, won, pe] of [[W, 1, pB], [L, 0, 1 - pB]] as Array<[State, number, number]>) {
      S.recent.push({ date: m.date, res: won - pe, minutes: m.minutes });
      if (S.recent.length > 30) S.recent.shift();
      const t = S.tourney?.tid === m.tid ? S.tourney : (S.tourney = { tid: m.tid, minutes: 0, sets: 0, matches: 0 });
      t.minutes += m.minutes ?? 0; t.sets += m.wSets + m.lSets; t.matches++;
      S.last = { date: m.date, surface: sf, minutes: m.minutes, tid: m.tid };
    }
    if (m.retired) L.retiredAt = m.date;
    for (const [S, x] of [[W, m.w], [L, m.l]] as Array<[State, Side]>)
      S.info = { name: x.name, atp: x.atp ?? S.info?.atp, ioc: x.ioc, hand: x.hand, ht: x.ht ?? S.info?.ht, age: x.age ?? S.info?.age, ageAt: x.age != null ? m.date : (S.info?.ageAt ?? m.date), rank: x.rank ?? S.info?.rank };
  }
}

export { SURFS };
