// Moteur tennis : probabilité de victoire à partir des notes (Elo, service-retour) et de l'état des joueurs, puis
// mélange avec le marché. Poids appris sur 2024 et 2025 (4 400 matchs ATP reliés aux cotes Pinnacle) ; chaque
// ingrédient a été gardé seulement s'il améliorait la prévision sur une saison en ayant été appris sur l'autre.
import type { Surface } from './history.ts';
import type { Ratings, Snapshot } from './ratings.ts';

export const WEIGHTS = {
  elo: 0.2007, // logit de l'Elo moitié général, moitié surface
  point: 0.4847, // logit du match selon les points de service et de retour
  age: -0.0345, // par année d'écart : à note égale, le plus jeune progresse plus vite que sa note
  experience: -0.0065, // log du nombre de matchs joués
  layoff: 0.632, // retour après plus de 45 jours sans jouer
  played14: 0.0305, // par match joué sur les 14 derniers jours (rythme)
  form10: 0.0155, // somme (gagné - attendu) sur les 10 derniers matchs
  rank: 0.0758, // log du classement ATP
  // Confrontations des 6 dernières années, (victoires A - victoires B) / (matchs + 4) : même sens sur les deux saisons,
  // effet petit (log-loss du moteur 0,5957 -> 0,5952 ; pronostics inchangés une fois mélangés au marché).
  h2h: 0.4458,
  // Retour de longue absence (2e au 10e match après 6 mois et plus) : appris sur 2016-2023, vérifié sur 2024-2026 ;
  // un joueur de haut niveau prévu à 58 % sur ces matchs n'en gagnait que 52 %. Voir src/dev/tenniscomeback.ts.
  comeback: 0.15,
};
/**
 * Part du marché (Pinnacle sans marge) dans la probabilité Razzia. Deux saisons, pronostics vainqueur / « Un set » :
 * moteur seul 79,7 %, un tiers de marché 80,3 %, moitié 80,8 % (2024 81,3 %, 2025 80,3 %).
 */
export const MARKET_WEIGHT = 0.5;

const Lg = (p: number) => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));
const Sg = (z: number) => 1 / (1 + Math.exp(-z));
const v = (x?: number) => (x == null || Number.isNaN(x) ? 0 : x);
const layoff = (s: Snapshot) => (s.daysOff > 45 && s.daysOff < 999 ? 1 : 0);

export interface Factor { key: string; label: string; z: number } // z : apport en logit pour le joueur A
export interface EnginePrediction { p: number; elo: number; point: number; factors: Factor[] }

/** Probabilité que A batte B selon le moteur seul, avec l'apport de chaque ingrédient (h2h : victoires de chacun). */
export function engineProb(R: Ratings, a: Snapshot, b: Snapshot, surface: Surface, bestOf: 3 | 5, h2h = { a: 0, b: 0 }): EnginePrediction {
  const elo = R.eloProb(a, b), point = R.pointProb(a, b, surface, bestOf);
  const factors: Factor[] = [
    { key: 'elo', label: 'Niveau (Elo général et surface)', z: WEIGHTS.elo * Lg(elo) },
    { key: 'point', label: 'Service et retour', z: WEIGHTS.point * Lg(point) },
    { key: 'age', label: 'Âge (progression des jeunes)', z: WEIGHTS.age * (v(a.age) - v(b.age)) },
    { key: 'experience', label: 'Expérience', z: WEIGHTS.experience * (Math.log(1 + a.n) - Math.log(1 + b.n)) },
    { key: 'layoff', label: 'Retour après une longue absence', z: WEIGHTS.layoff * (layoff(b) - layoff(a)) },
    { key: 'played14', label: 'Rythme (matchs sur 14 jours)', z: WEIGHTS.played14 * (a.played14 - b.played14) },
    { key: 'form10', label: 'Forme sur 10 matchs', z: WEIGHTS.form10 * (a.form10 - b.form10) },
    { key: 'rank', label: 'Classement ATP', z: WEIGHTS.rank * (Math.log(v(b.rank) || 500) - Math.log(v(a.rank) || 500)) },
    { key: 'h2h', label: 'Confrontations directes', z: WEIGHTS.h2h * ((h2h.a - h2h.b) / (h2h.a + h2h.b + 4)) },
    { key: 'comeback', label: 'Retour de blessure en cours', z: WEIGHTS.comeback * (b.comeback - a.comeback) },
  ];
  return { p: Sg(factors.reduce((s, f) => s + f.z, 0)), elo, point, factors };
}

/**
 * Probabilité Razzia : moteur et marché sans marge mélangés en logit (le moteur seul s'il n'y a pas de cote). Jamais plus
 * sûr que le marché sur le même favori ; un favori différent du marché reste permis (défier le marché). 2024-2025,
 * pronostics de la fiche : 80,2 % sans plafond, 80,8 % avec.
 */
export function blend(pEngine: number, pMarket?: number): number {
  if (pMarket == null) return pEngine;
  const p = Sg((1 - MARKET_WEIGHT) * Lg(pEngine) + MARKET_WEIGHT * Lg(pMarket));
  if ((p >= 0.5) !== (pMarket >= 0.5)) return p;
  return p >= 0.5 ? Math.min(p, pMarket) : Math.max(p, pMarket);
}
