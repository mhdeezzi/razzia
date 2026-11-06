// Marchés foot calculés sur la grille des scores : 1N2, double chance, buts (plus/moins), les deux équipes marquent, et
// les combinés courants (double chance + plus de 0,5 but, double chance + moins de 4,5 buts…), plus sûrs qu'un simple.

export interface Market { id: string; cat: 'vainqueur' | 'double' | 'combine' | 'buts' | 'equipe'; label: (h: string, a: string) => string; win: (i: number, j: number) => boolean }

const dc = (k: '1X' | 'X2' | '12') => (i: number, j: number) => (k === '1X' ? i >= j : k === 'X2' ? i <= j : i !== j);
const dcLabel = (k: '1X' | 'X2' | '12', h: string, a: string) => (k === '1X' ? `${h} ou nul` : k === 'X2' ? `${a} ou nul` : `${h} ou ${a}`);

export const MARKETS: Market[] = [
  { id: '1', cat: 'vainqueur', label: (h) => `Victoire ${h}`, win: (i, j) => i > j },
  { id: 'X', cat: 'vainqueur', label: () => 'Match nul', win: (i, j) => i === j },
  { id: '2', cat: 'vainqueur', label: (_, a) => `Victoire ${a}`, win: (i, j) => i < j },
  ...(['1X', 'X2', '12'] as const).map((k) => ({ id: k, cat: 'double' as const, label: (h: string, a: string) => dcLabel(k, h, a), win: dc(k) })),
  ...[0.5, 1.5, 2.5, 3.5, 4.5, 5.5].flatMap((l) => [
    { id: `o${l}`, cat: 'buts' as const, label: () => `Plus de ${String(l).replace('.', ',')} buts`, win: (i: number, j: number) => i + j > l },
    { id: `u${l}`, cat: 'buts' as const, label: () => `Moins de ${String(l).replace('.', ',')} buts`, win: (i: number, j: number) => i + j < l },
  ]),
  { id: 'btts', cat: 'buts', label: () => 'Les deux équipes marquent', win: (i, j) => i > 0 && j > 0 },
  { id: 'nobtts', cat: 'buts', label: () => 'Une équipe au moins ne marque pas', win: (i, j) => i === 0 || j === 0 },
  { id: 'h05', cat: 'equipe', label: (h) => `${h} marque`, win: (i) => i > 0 },
  { id: 'a05', cat: 'equipe', label: (_, a) => `${a} marque`, win: (_, j) => j > 0 },
  { id: 'h15', cat: 'equipe', label: (h) => `${h} marque 2 buts ou plus`, win: (i) => i > 1 },
  { id: 'a15', cat: 'equipe', label: (_, a) => `${a} marque 2 buts ou plus`, win: (_, j) => j > 1 },
  // Combinés : double chance + total de buts.
  ...(['1X', 'X2', '12'] as const).flatMap((k) => [
    { id: `${k}+o0.5`, cat: 'combine' as const, label: (h: string, a: string) => `${dcLabel(k, h, a)} + plus de 0,5 but`, win: (i: number, j: number) => dc(k)(i, j) && i + j > 0.5 },
    { id: `${k}+o1.5`, cat: 'combine' as const, label: (h: string, a: string) => `${dcLabel(k, h, a)} + plus de 1,5 but`, win: (i: number, j: number) => dc(k)(i, j) && i + j > 1.5 },
    { id: `${k}+u3.5`, cat: 'combine' as const, label: (h: string, a: string) => `${dcLabel(k, h, a)} + moins de 3,5 buts`, win: (i: number, j: number) => dc(k)(i, j) && i + j < 3.5 },
    { id: `${k}+u4.5`, cat: 'combine' as const, label: (h: string, a: string) => `${dcLabel(k, h, a)} + moins de 4,5 buts`, win: (i: number, j: number) => dc(k)(i, j) && i + j < 4.5 },
    { id: `${k}+u5.5`, cat: 'combine' as const, label: (h: string, a: string) => `${dcLabel(k, h, a)} + moins de 5,5 buts`, win: (i: number, j: number) => dc(k)(i, j) && i + j < 5.5 },
    { id: `${k}+o0.5+u5.5`, cat: 'combine' as const, label: (h: string, a: string) => `${dcLabel(k, h, a)} + entre 1 et 5 buts`, win: (i: number, j: number) => dc(k)(i, j) && i + j > 0.5 && i + j < 5.5 },
    { id: `${k}+o0.5+u4.5`, cat: 'combine' as const, label: (h: string, a: string) => `${dcLabel(k, h, a)} + entre 1 et 4 buts`, win: (i: number, j: number) => dc(k)(i, j) && i + j > 0.5 && i + j < 4.5 },
  ]),
  { id: '1+o1.5', cat: 'combine', label: (h) => `Victoire ${h} + plus de 1,5 but`, win: (i, j) => i > j && i + j > 1.5 },
  { id: '2+o1.5', cat: 'combine', label: (_, a) => `Victoire ${a} + plus de 1,5 but`, win: (i, j) => i < j && i + j > 1.5 },
];

export function probs(grid: number[][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of MARKETS) {
    let p = 0;
    for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[i].length; j++) if (m.win(i, j)) p += grid[i][j];
    out.set(m.id, p);
  }
  return out;
}
export const marketById = new Map(MARKETS.map((m) => [m.id, m]));
