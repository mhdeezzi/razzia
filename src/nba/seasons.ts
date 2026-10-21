// Conventions de saisons NBA ("2026-27" etc.).

export function seasonsInScope(currentSeason: string): { prev2: string; prev: string; cur: string } {
  const y = Number(currentSeason.slice(0, 4));
  return {
    prev2: `${y - 2}-${String((y - 1) % 100).padStart(2, '0')}`,
    prev: `${y - 1}-${String(y % 100).padStart(2, '0')}`,
    cur: currentSeason,
  };
}

/** Nombre de saisons d'écart (0 = même saison). */
export function seasonsBetween(a: string, b: string): number {
  return Number(b.slice(0, 4)) - Number(a.slice(0, 4));
}

/** Saison NBA correspondant à une date (la saison démarre en octobre). */
export function seasonOfDate(dateYmd: string): string {
  const [y, m] = dateYmd.split('-').map(Number);
  const start = m >= 9 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Préfixe d'identifiant de match pour une saison : "0022600001" -> saison 2026-27. */
export function seasonOfGameId(gameId: string): string {
  const yy = Number(gameId.slice(3, 5));
  const start = 2000 + yy;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
