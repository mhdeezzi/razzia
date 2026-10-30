// Couleurs des joueurs de tennis, d'après leur pays (code IOC) : la couleur la plus marquante du drapeau, éclaircie
// pour se voir sur le noir. Deux couleurs par pays : quand les deux joueurs tombent sur la même, le second prend l'autre.
import { createContext } from 'react';

const FLAG: Record<string, [string, string]> = {
  ESP: ['#e8383b', '#f4c430'], ITA: ['#2f8fe0', '#2fb36b'], FRA: ['#3d7bff', '#e8383b'], USA: ['#3d6fe0', '#e8383b'],
  GBR: ['#3d6fe0', '#e8383b'], GER: ['#f4c430', '#e8383b'], SRB: ['#e8383b', '#3d6fe0'], RUS: ['#3d7bff', '#e8383b'],
  AUS: ['#2fb36b', '#f4c430'], CAN: ['#e8383b', '#c9c9cf'], NOR: ['#e8383b', '#3d6fe0'], DEN: ['#e8383b', '#c9c9cf'],
  CZE: ['#3d6fe0', '#e8383b'], POL: ['#e8383b', '#c9c9cf'], ARG: ['#5fb4f0', '#f4c430'], CHI: ['#e8383b', '#3d6fe0'],
  GRE: ['#3d7bff', '#c9c9cf'], BUL: ['#2fb36b', '#e8383b'], NED: ['#ff8a2a', '#3d6fe0'], BEL: ['#f4c430', '#e8383b'],
  SUI: ['#e8383b', '#c9c9cf'], CRO: ['#e8383b', '#3d6fe0'], JPN: ['#e8383b', '#c9c9cf'], CHN: ['#e8383b', '#f4c430'],
  KAZ: ['#3fc0e0', '#f4c430'], POR: ['#2fb36b', '#e8383b'], AUT: ['#e8383b', '#c9c9cf'], HUN: ['#2fb36b', '#e8383b'],
  FIN: ['#3d7bff', '#c9c9cf'], BRA: ['#2fb36b', '#f4c430'], COL: ['#f4c430', '#3d6fe0'], MON: ['#e8383b', '#c9c9cf'],
  BOL: ['#2fb36b', '#f4c430'], PER: ['#e8383b', '#c9c9cf'], URU: ['#5fb4f0', '#f4c430'], ECU: ['#f4c430', '#3d6fe0'],
  GEO: ['#e8383b', '#c9c9cf'], UKR: ['#3d7bff', '#f4c430'], BLR: ['#e8383b', '#2fb36b'], SWE: ['#3d7bff', '#f4c430'],
  SVK: ['#3d6fe0', '#e8383b'], SLO: ['#3d6fe0', '#e8383b'], ROU: ['#3d6fe0', '#f4c430'], MDA: ['#3d6fe0', '#f4c430'],
  BIH: ['#3d6fe0', '#f4c430'], LTU: ['#f4c430', '#2fb36b'], LAT: ['#b03a4a', '#c9c9cf'], EST: ['#3d7bff', '#c9c9cf'],
  TUR: ['#e8383b', '#c9c9cf'], ISR: ['#3d7bff', '#c9c9cf'], RSA: ['#2fb36b', '#f4c430'], TUN: ['#e8383b', '#c9c9cf'],
  MAR: ['#e8383b', '#2fb36b'], EGY: ['#e8383b', '#c9c9cf'], IND: ['#ff8a2a', '#2fb36b'], KOR: ['#3d6fe0', '#e8383b'],
  TPE: ['#3d6fe0', '#e8383b'], THA: ['#3d6fe0', '#e8383b'], NZL: ['#3d6fe0', '#e8383b'], MEX: ['#2fb36b', '#e8383b'],
  CYP: ['#ff8a2a', '#2fb36b'], LBN: ['#e8383b', '#2fb36b'], QAT: ['#b03a4a', '#c9c9cf'], HKG: ['#e8383b', '#c9c9cf'],
};
// Sans pays connu : le bleu et le violet du bandeau tennis.
const DEFAULT: [string, string] = ['#3d7bff', '#a15ad8'];

/** Couleur de chaque joueur (domicile, extérieur), différentes l'une de l'autre. */
export function playerColors(iocHome?: string, iocAway?: string): { home: string; away: string } {
  const h = (iocHome && FLAG[iocHome]) || DEFAULT;
  const a = (iocAway && FLAG[iocAway]) || [DEFAULT[1], DEFAULT[0]];
  const home = h[0];
  const away = a[0] !== home ? a[0] : a[1] !== home ? a[1] : h[1];
  return { home, away };
}

/** Couleurs des deux camps de la fiche ouverte (équipes NBA, joueurs de tennis), pour les ronds des paris. */
export const SideColors = createContext<{ home: string; away: string } | undefined>(undefined);
