// Suivi des paris : depuis une fiche, on ajoute un pari (vainqueur, handicap, sets...) à son suivi ; les paris suivis
// forment un combiné (cote totale = produit des cotes) dont on voit l'issue une fois les matchs joués.
// Gardé dans le navigateur (localStorage) : pas besoin de compte pour l'instant.
import { useEffect, useState } from 'react';
import type { Outcome } from './picks.ts';

export interface Leg {
  key: string; // match + pari : un même pari n'est suivi qu'une fois
  sport: 'nba' | 'atp';
  date: string; // jour du match (NBA : date à New York ; tennis : jour du programme)
  start: string; // heure du match (ISO)
  match: { id?: string; home: string; away: string; homeName: string; awayName: string };
  title: string;
  odds?: number; // cote du bookmaker au moment de l'ajout, sinon cote juste
  fair: boolean; // true : cote juste (aucune cote publiée)
  p: number; // fréquence dans les simulations
  bet: NonNullable<Outcome['bet']>;
  path: string; // lien vers la fiche
  at: string;
}

export type LegStatus = 'pending' | 'live' | 'won' | 'lost';

const KEY = 'razzia-suivi';
const EVENT = 'razzia-suivi';

function read(): Leg[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Leg[];
  } catch {
    return [];
  }
}
function write(legs: Leg[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(legs));
  } catch {
    /* stockage indisponible : le suivi reste le temps de la page */
  }
  dispatchEvent(new Event(EVENT));
}

export const suivi = {
  list: read,
  add(leg: Leg) {
    write([...read().filter((l) => l.key !== leg.key), leg]);
  },
  remove(key: string) {
    write(read().filter((l) => l.key !== key));
  },
  clear() {
    write([]);
  },
};

/** Liste des paris suivis, à jour quand un autre composant (ou un autre onglet) la modifie. */
export function useSuivi(): Leg[] {
  const [legs, setLegs] = useState<Leg[]>(read);
  useEffect(() => {
    const on = () => setLegs(read());
    addEventListener(EVENT, on);
    addEventListener('storage', on);
    return () => {
      removeEventListener(EVENT, on);
      removeEventListener('storage', on);
    };
  }, []);
  return legs;
}

/** Ouvrir ou fermer le panneau du suivi depuis n'importe où (barre du haut, bouton d'une fiche). */
export const openSuivi = () => dispatchEvent(new Event('razzia-suivi-open'));

/** Cote totale du combiné (produit des cotes connues). */
export const comboOdds = (legs: Leg[]) => legs.reduce((x, l) => x * (l.odds ?? 1), 1);

// ——— Résultats ———

interface NbaFinal { state: 'pre' | 'in' | 'post'; home: number; away: number }
interface AtpFinal { state: 'pre' | 'in' | 'post'; sets: { home: number; away: number }; winner?: 'home' | 'away' }

/** Issue d'un pari d'après le score : gagné, perdu, ou pas encore joué / en cours. */
export function statusOf(leg: Leg, nba?: NbaFinal, atp?: AtpFinal): LegStatus {
  const other = leg.bet.side === 'home' ? 'away' : 'home';
  if (leg.sport === 'nba') {
    if (!nba || nba.state === 'pre') return 'pending';
    if (nba.state === 'in') return 'live';
    const margin = nba[leg.bet.side] - nba[other];
    if (leg.bet.kind === 'spread') return margin + (leg.bet.line ?? 0) > 0 ? 'won' : 'lost';
    return margin > 0 ? 'won' : 'lost';
  }
  if (!atp || atp.state === 'pre') return 'pending';
  if (atp.state === 'in' && !atp.winner) return 'live';
  const mine = atp.sets[leg.bet.side], theirs = atp.sets[other];
  if (leg.bet.kind === 'win') return atp.winner === leg.bet.side ? 'won' : 'lost';
  if (leg.bet.kind === 'sets') return atp.winner === leg.bet.side || mine >= (leg.bet.need ?? 1) ? 'won' : 'lost';
  return atp.winner === leg.bet.side && theirs === 0 ? 'won' : 'lost';
}

/** Scores des matchs suivis : programme NBA du jour du match, programme tennis récent. */
export function useResults(legs: Leg[]): Record<string, LegStatus> {
  const [out, setOut] = useState<Record<string, LegStatus>>({});
  const sig = legs.map((l) => l.key).join('|');
  useEffect(() => {
    let alive = true;
    (async () => {
      const res: Record<string, LegStatus> = {};
      const nbaDays = [...new Set(legs.filter((l) => l.sport === 'nba').map((l) => l.date))];
      const nbaGames = new Map<string, NbaFinal>();
      await Promise.all(
        nbaDays.map(async (d) => {
          try {
            const r = await fetch(`/api/games?days=1&from=${d}`).then((x) => x.json());
            for (const g of r.games ?? []) nbaGames.set(`${g.date}_${g.away.tri}@${g.home.tri}`, { state: g.state, home: g.home.score ?? 0, away: g.away.score ?? 0 });
          } catch {
            /* réseau : on garde « en attente » */
          }
        }),
      );
      const atpGames = new Map<string, AtpFinal>();
      if (legs.some((l) => l.sport === 'atp')) {
        try {
          const r = await fetch('/api/tennis?slate=1').then((x) => x.json());
          for (const m of r.matches ?? []) {
            const l = m.live;
            const won = (side: 'home' | 'away') => (l?.[side] ?? []).filter((x: { w?: boolean }) => x.w).length;
            atpGames.set(String(m.id), { state: l?.state ?? 'pre', sets: { home: won('home'), away: won('away') }, winner: l?.winner });
          }
        } catch {
          /* idem */
        }
      }
      for (const l of legs)
        res[l.key] = statusOf(l, l.sport === 'nba' ? nbaGames.get(`${l.date}_${l.match.away}@${l.match.home}`) : undefined, l.sport === 'atp' ? atpGames.get(l.match.id ?? '') : undefined);
      if (alive) setOut(res);
    })();
    return () => {
      alive = false;
    };
  }, [sig]);
  return out;
}
