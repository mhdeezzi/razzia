// Star absente : joueur annoncé absent (« Out ») qui fait partie des titulaires (26 min et plus par match) et des
// meilleurs marqueurs (17 points et plus), absent depuis peu (15 matchs de l'équipe au plus, environ un mois) : au-delà,
// l'équipe a appris à jouer sans lui. Simple avertissement : ne change ni la probabilité ni le pronostic.
// Même règle dans src/cli/resultindex.ts (pastille du programme).
import type { Result } from './data.ts';

export interface StarOut { side: 'home' | 'away'; name: string; pts: number }

type P = { name: string; side: 0 | 1; status?: string; form?: { ptsSeason?: number; minSeason?: number; missed?: number } };
export const RECENT_MISSED = 15;

export function starsOut(r: Result): StarOut[] {
  return (r.players as P[])
    .filter((p) => p.status === 'Out' && (p.form?.minSeason ?? 0) >= 26 && (p.form?.ptsSeason ?? 0) >= 17 && p.form?.missed != null && p.form.missed <= RECENT_MISSED)
    .sort((a, b) => (b.form?.ptsSeason ?? 0) - (a.form?.ptsSeason ?? 0))
    .map((p) => ({ side: p.side === 0 ? 'home' : 'away', name: p.name, pts: p.form?.ptsSeason ?? 0 }));
}
