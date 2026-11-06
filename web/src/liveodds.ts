// Cotes du moment pour les paris du ticket : relues comme sur la fiche (programme du jour pour les cotes, dernière
// simulation pour les lignes), juste avant de valider. Une cote ne se saisit pas à la main.
import { simStatus, type Game, type Result } from './data.ts';
import { buildCategories, pOverPts, type Outcome } from './picks.ts';
import { buildTennisCategories } from './tennispicks.ts';
import { oidOf, type Leg } from './suivi.ts';

export interface Fresh {
  odds: number;
  fair: boolean;
  p: number;
  title: string;
  bet: Leg['bet'];
}
/** Pari introuvable (match commencé, plus simulé...) : null. */
export type FreshMap = Record<string, Fresh | null>;

const r2 = (v: number) => Math.round(v * 100) / 100;
// Une relecture par minute au plus : le cache du CDN sert le reste du temps.
const stamp = () => Math.floor(Date.now() / 60_000);

/** Même pari que celui du ticket : même type et même camp (et même joueur pour les points). Une catégorie (« vainqueur »,
 * « handicap ») ne suffit pas : si le favori change, son pari désigne l'autre équipe, et le ticket ne doit jamais changer
 * d'équipe ou de joueur à l'insu de l'utilisateur. */
const same = (o: Outcome, l: Leg) => !!o.bet && o.bet.kind === l.bet.kind && o.bet.side === l.bet.side && (l.bet.kind !== 'pts' || o.bet.player === l.bet.player);
/** Le pari du ticket parmi les pronostics du moment : par son identifiant s'il porte toujours sur le même camp, sinon
 * le même pari ailleurs (même type, même camp, même nombre de sets) ; introuvable : null (pari plus proposé). */
function pickSame(items: Outcome[], l: Leg): Outcome | null {
  const byId = items.find((x) => x.id === oidOf(l));
  if (byId && same(byId, l)) return byId;
  return items.find((x) => same(x, l) && (x.bet!.need ?? null) === (l.bet.need ?? null)) ?? null;
}

const fromOutcome = (o: Outcome): Fresh => ({ odds: r2(o.odds ?? o.fair ?? 1), fair: o.odds == null, p: o.p, title: o.title, bet: o.bet! });

/** Points d'un joueur, d'après la dernière simulation : cote juste de la ligne choisie. */
export function ptsFresh(r: Result, leg: Leg): Fresh | null {
  const pl = r.players.find((x) => x.name === leg.bet.player);
  const d = pl?.stats?.pts;
  if (!d || leg.bet.line == null) return null;
  const pOver = pOverPts(d, leg.bet.line);
  const p = leg.bet.over === false ? 1 - pOver : pOver;
  return { odds: r2(1 / p), fair: true, p, title: leg.title, bet: leg.bet };
}

export async function freshOdds(legs: Leg[]): Promise<FreshMap> {
  const out: FreshMap = {};
  const nba = legs.filter((l) => l.sport === 'nba');
  const atp = legs.filter((l) => l.sport === 'atp');
  // NBA : programme du jour du match (cotes DraftKings), puis la simulation du match.
  const days = new Map<string, Game[]>();
  await Promise.all(
    [...new Set(nba.map((l) => l.date))].map(async (d) => {
      try {
        const j = await fetch(`/api/games?days=1&from=${d}&t=${stamp()}`).then((x) => x.json());
        days.set(d, j.games ?? []);
      } catch {
        days.set(d, []);
      }
    }),
  );
  const results = new Map<string, Promise<Result | null>>();
  const resultOf = (g: Game) => {
    const k = `${g.date}_${g.away.tri}@${g.home.tri}`;
    if (!results.has(k)) results.set(k, simStatus(g).then((s) => (s.status === 'done' ? s.result : null), () => null));
    return results.get(k)!;
  };
  await Promise.all(
    nba.map(async (l) => {
      const g = days.get(l.date)?.find((x) => x.away.tri === l.match.away && x.home.tri === l.match.home);
      if (!g || g.state !== 'pre' || Date.parse(g.start) <= Date.now()) return void (out[l.key] = null);
      const r = await resultOf(g);
      if (!r) return void (out[l.key] = null);
      if (l.bet.kind === 'pts') return void (out[l.key] = ptsFresh(r, l));
      const o = pickSame(buildCategories(r, g).flatMap((c) => c.items), l);
      out[l.key] = o?.bet ? fromOutcome(o) : null;
    }),
  );
  // Tennis : la simulation du match, avec la cote du vainqueur du programme (plus récente que celle de la simulation).
  if (atp.length) {
    let slate: Array<{ id: string; start: string; home?: string; away?: string; live?: { state?: string }; odds?: { ml?: [number, number] } }> = [];
    try {
      slate = (await fetch(`/api/tennis?slate=1&t=${stamp()}`).then((x) => x.json())).matches ?? [];
    } catch {
      /* hors ligne */
    }
    await Promise.all(
      atp.map(async (l) => {
        const m = slate.find((x) => String(x.id) === l.match.id);
        if (!m || (m.live?.state && m.live.state !== 'pre') || Date.parse(m.start) <= Date.now()) return void (out[l.key] = null);
        try {
          const s = await fetch(`/api/tennis?id=${l.match.id}&day=${l.date}`).then((x) => x.json());
          if (s.status !== 'done') return void (out[l.key] = null);
          const r = s.result;
          // Cote du programme remise dans l'ordre des joueurs de la simulation : le programme peut les avoir inversés pour
          // suivre Pinnacle (sinon la victoire de l'un recevait la cote de l'autre).
          if (m.odds?.ml) {
            const norm = (n?: string) => (n ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            const flipped = !!m.home && norm(m.home) !== norm(r.home?.name) && norm(m.home) === norm(r.away?.name);
            const ml: [number, number] = flipped ? [m.odds.ml[1], m.odds.ml[0]] : m.odds.ml;
            r.market = { ...r.market, odds: { ...(r.market?.odds ?? {}), ml } };
          }
          const o = pickSame(buildTennisCategories(r).flatMap((c) => c.items), l);
          out[l.key] = o?.bet ? fromOutcome(o) : null;
        } catch {
          out[l.key] = null;
        }
      }),
    );
  }
  return out;
}

/** Ce qui a bougé entre le ticket et les cotes du moment : nouvelle cote ou nouvelle ligne. */
export const moved = (l: Leg, f: Fresh) => Math.abs((l.odds ?? 0) - f.odds) >= 0.005 || f.title !== l.title;
