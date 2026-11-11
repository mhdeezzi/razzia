// Moteur live : point d'entrée unique pour les trois sports, avec les coefficients appris (src/cli/livefoot.ts,
// livenba.ts, livetennis.ts). Une page ou une API n'importe que ce fichier.
//   Foot   : footNow(cotes d'avant-match ou buts attendus, déroulé du match) -> 1N2, prochain but, but dans 10 min, remontée
//   NBA    : nbaNow(écart et total attendus avant le match, état) -> vainqueur, écart et total finaux, remontée
//   Tennis : tennisNow(proba d'avant-match, surface, état) -> vainqueur, forme du jour, set en cours, jeu en cours, remontée
import footParams from './foot-params.json' with { type: 'json' };
import nbaParams from './nba-params.json' with { type: 'json' };
import tennisParams from './tennis-params.json' with { type: 'json' };
import { footLive, marketLambdas, type FootLiveParams, type FootTimeline } from './foot.ts';
import { nbaLive, type NbaLiveParams, type NbaPre, type NbaState } from './nba.ts';
import { calibrateTennis, tennisLive, type TennisLiveParams, type TennisState } from './tennis.ts';

export const FOOT = footParams as FootLiveParams;
export const NBA = nbaParams as NbaLiveParams;
export const TENNIS = tennisParams as TennisLiveParams;

/** Foot : `pre` = cotes 1N2 (et plus/moins de 2,5 buts) d'avant-match, ou directement les buts attendus [domicile, extérieur]. */
export function footNow(pre: { h: number; d: number; a: number; over25?: number; under25?: number } | [number, number], tl: FootTimeline) {
  const lam = Array.isArray(pre) ? pre : marketLambdas(pre);
  return footLive(FOOT, lam, tl);
}

export function nbaNow(pre: NbaPre, st: NbaState) {
  return nbaLive(NBA, pre, st);
}

/** Tennis : `p0` = chance d'avant-match du joueur A (Razzia ou marché). La base est calée une fois par match : la passer
 * en cache (`base`) évite de la recalculer à chaque point. */
export function tennisNow(p0: number, surface: string, st: TennisState, base?: [number, number]) {
  const b = base ?? calibrateTennis(TENNIS, p0, surface, st.bestOf);
  return { ...tennisLive(TENNIS, b, st), base: b };
}

export type { FootTimeline, NbaPre, NbaState, TennisState };
