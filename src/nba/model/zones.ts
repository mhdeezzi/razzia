// Zones de tir officielles NBA calculées à partir des coordonnées "legacy" (dixièmes de pied, panier en (0,0)).

export const ZONES = ['RA', 'PAINT', 'MID', 'LC3', 'RC3', 'ATB3'] as const;
export type Zone = (typeof ZONES)[number];
export const ZONE_LABEL: Record<Zone, string> = {
  RA: 'Restricted Area', PAINT: 'Paint (non-RA)', MID: 'Mid-Range', LC3: 'Left Corner 3', RC3: 'Right Corner 3', ATB3: 'Above the Break 3',
};
export const isThree = (z: Zone): boolean => z === 'LC3' || z === 'RC3' || z === 'ATB3';

const AREA_TO_ZONE: Record<string, Zone> = {
  'Restricted Area': 'RA',
  'In The Paint (Non-RA)': 'PAINT',
  'Mid-Range': 'MID',
  'Left Corner 3': 'LC3',
  'Right Corner 3': 'RC3',
  'Above the Break 3': 'ATB3',
};

/** Convention du signe de x pour le coin gauche (vérifiée sur les données 2025-26 qui portent la zone officielle). */
export let LEFT_CORNER_SIGN = -1;
export function setLeftCornerSign(s: number): void {
  LEFT_CORNER_SIGN = s;
}

export function zoneOf(isThreePt: boolean, x: number | undefined, y: number | undefined, area?: string): Zone {
  if (area && AREA_TO_ZONE[area]) return AREA_TO_ZONE[area];
  if (x == null || y == null) return isThreePt ? 'ATB3' : 'MID';
  if (isThreePt) {
    if (Math.abs(x) >= 220 && y <= 92.5) return Math.sign(x) === LEFT_CORNER_SIGN ? 'LC3' : 'RC3';
    return 'ATB3';
  }
  const dist = Math.hypot(x, y) / 10;
  if (dist <= 4.25) return 'RA';
  if (Math.abs(x) <= 80 && y <= 137.5) return 'PAINT';
  return 'MID';
}

/** Distance en pieds à partir des coordonnées legacy. */
export const distFt = (x: number, y: number): number => Math.hypot(x, y) / 10;
