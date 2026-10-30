// « À la une » : le match du jour qui attire le plus de monde, pas celui au plus gros pourcentage. Score d'engouement
// fait de ce qui remplit les audiences : diffusion nationale, grosses franchises et stars, rivalités, niveau des deux
// camps, playoffs ; au tennis, classement des deux joueurs, tour, catégorie du tournoi, têtes d'affiche.
import type { Game } from './data.ts';

// Poids populaire des franchises (audiences TV, ventes de maillots, réseaux) : 10 pour les plus suivies.
const NBA_POP: Record<string, number> = {
  LAL: 10, GSW: 10, BOS: 9, NYK: 9, PHI: 7, MIA: 7, CHI: 7, DAL: 7, MIL: 7, PHX: 6, DEN: 6, OKC: 6, BKN: 6, LAC: 6,
  CLE: 6, MIN: 6, SAS: 6, HOU: 5, ATL: 5, MEM: 5, SAC: 5, IND: 5, NOP: 5, ORL: 5, TOR: 5, DET: 4, POR: 4, UTA: 4, CHA: 4, WAS: 3,
};
// Rivalités historiques ou du moment.
const RIVALS = new Set(['BOS-LAL', 'GSW-LAL', 'BOS-NYK', 'BKN-NYK', 'LAC-LAL', 'BOS-PHI', 'CHI-DET', 'MIA-NYK', 'DEN-LAL', 'GSW-CLE', 'BOS-MIA', 'MIA-BOS', 'DAL-PHX', 'BOS-MIL', 'MIN-OKC', 'DEN-OKC', 'IND-NYK', 'BOS-CLE']);
// Diffusion nationale : ce qui en fait l'affiche de la soirée aux États-Unis.
const TV: Array<[RegExp, number]> = [[/ABC/i, 9], [/ESPN/i, 7], [/TNT|NBC|Peacock|Prime/i, 7], [/NBA ?TV/i, 3]];

const winPct = (rec?: string) => {
  const [w, l] = (rec ?? '').split('-').map(Number);
  return w + l > 0 ? w / (w + l) : 0.5;
};

export function nbaHype(g: Game): number {
  const pop = (NBA_POP[g.home.tri] ?? 4) + (NBA_POP[g.away.tri] ?? 4);
  const tv = Math.max(0, ...g.tv.map((t) => TV.find(([re]) => re.test(t))?.[1] ?? 0));
  const rival = RIVALS.has([g.home.tri, g.away.tri].sort().join('-')) ? 6 : 0;
  const level = 6 * (winPct(g.home.record) + winPct(g.away.record)); // deux bonnes équipes : plus d'enjeu
  const playoffs = g.seasonType === 3 ? 12 : 0;
  return pop + tv + rival + level + playoffs;
}

const SLAMS = /australian open|roland|french open|wimbledon|us open/i;
const MASTERS = /indian wells|miami|monte|madrid|rome|internazionali|canada|montreal|toronto|cincinnati|shanghai|paris/i;
const FINALS = /finals|turin|nitto/i;
const ROUND_W: Record<string, number> = { F: 12, SF: 9, QF: 6, R16: 4, R4: 4, R32: 2, R3: 2 };
// Têtes d'affiche (audience au-delà du classement) : les plus grandes stars, puis les joueurs très suivis (dont les
// Français, pour un public français).
const MEGA = /sinner|alcaraz|djokovic|nadal/i;
const STARS = /medvedev|zverev|fritz|rune|shelton|tsitsipas|de minaur|monfils|kyrgios|fils|mpetshi|humbert|draper|mensik|fonseca/i;

export function atpHype(m: { league: string; home: string; away: string }, rank: (name: string) => number | undefined): number {
  const r = (n: string) => Math.max(0, 12 - Math.log2(rank(n) ?? 300) * 1.6); // n° 1 : 12, n° 10 : ~6,7, n° 100 : ~1,4
  const round = ROUND_W[m.league.split(' - ')[1] ?? ''] ?? 0;
  const tier = SLAMS.test(m.league) ? 10 : FINALS.test(m.league) ? 9 : MASTERS.test(m.league) ? 6 : 2;
  const stars = [m.home, m.away].reduce((x, n) => x + (MEGA.test(n) ? 8 : STARS.test(n) ? 3 : 0), 0);
  return r(m.home) + r(m.away) + round + tier + stars;
}
