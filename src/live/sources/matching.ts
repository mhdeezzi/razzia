// Rapprochement conservateur des noms : aucun rapprochement sur le seul dernier mot d'un club.
import type { Sport } from '../stats/catalog.ts';

const words = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
const norm = (s: string) => words(s).join(' ');

const NBA: Record<string, string[]> = {
  ATL: ['Atlanta Hawks'], BOS: ['Boston Celtics'], BKN: ['Brooklyn Nets', 'BRK'], CHA: ['Charlotte Hornets'],
  CHI: ['Chicago Bulls'], CLE: ['Cleveland Cavaliers'], DAL: ['Dallas Mavericks'], DEN: ['Denver Nuggets'],
  DET: ['Detroit Pistons'], GSW: ['Golden State Warriors', 'GS'], HOU: ['Houston Rockets'], IND: ['Indiana Pacers'],
  LAC: ['Los Angeles Clippers', 'LA Clippers'], LAL: ['Los Angeles Lakers', 'LA Lakers'], MEM: ['Memphis Grizzlies'],
  MIA: ['Miami Heat'], MIL: ['Milwaukee Bucks'], MIN: ['Minnesota Timberwolves'], NOP: ['New Orleans Pelicans', 'NO'],
  NYK: ['New York Knicks', 'NY'], OKC: ['Oklahoma City Thunder'], ORL: ['Orlando Magic'], PHI: ['Philadelphia 76ers'],
  PHX: ['Phoenix Suns', 'PHO'], POR: ['Portland Trail Blazers'], SAC: ['Sacramento Kings'], SAS: ['San Antonio Spurs', 'SA'],
  TOR: ['Toronto Raptors'], UTA: ['Utah Jazz', 'UTAH'], WAS: ['Washington Wizards', 'WSH'],
};
const nbaNames = new Map(Object.entries(NBA).flatMap(([tri, names]) => [tri, ...names].map((name) => [norm(name), tri] as const)));
const footballAliases: Record<string, string> = {
  psg: 'paris saint germain', 'paris sg': 'paris saint germain',
  'man utd': 'manchester united', 'manchester utd': 'manchester united', 'man city': 'manchester city',
  inter: 'inter milan', internazionale: 'inter milan', 'internazionale milano': 'inter milan',
};
const club = (s: string) => {
  const name = words(s).filter((w) => !['fc', 'cf', 'afc', 'sc'].includes(w)).map((w) => ['w', 'women', 'feminin', 'feminines'].includes(w) ? 'women' : w).join(' ');
  return footballAliases[name] ?? name;
};

function player(s: string): { surnames: string[]; initial?: string; firstName?: string } {
  const tokens = words(s);
  if (!tokens.length) return { surnames: [] };
  const tail = tokens.findIndex((w) => w.length === 1);
  if (tail > 0 && tokens.slice(tail).every((w) => w.length === 1)) return { surnames: [tokens.slice(0, tail).join(' ')], initial: tokens[tail] };
  let first = 0;
  while (tokens[first]?.length === 1) first++;
  if (first) return { surnames: [tokens.slice(first).join(' ')].filter(Boolean), initial: tokens[0] };
  if (tokens.length === 1) return { surnames: tokens };
  // Un nom composé peut comporter plusieurs mots : Bautista Agut R. / Roberto Bautista Agut.
  return { surnames: tokens.slice(1).map((_, i) => tokens.slice(i + 1).join(' ')), initial: tokens[0][0], firstName: tokens[0] };
}

export function sameParticipant(a: string, b: string, sport: Sport): boolean {
  if (!norm(a) || !norm(b)) return false;
  if (norm(a) === norm(b)) return true;
  if (sport === 'nba') {
    const x = nbaNames.get(norm(a)), y = nbaNames.get(norm(b));
    return x != null && x === y;
  }
  if (sport === 'foot') return !!club(a) && club(a) === club(b);
  if (a.includes('/') || b.includes('/')) return false; // doubles : pas d'inférence depuis un seul nom
  const x = player(a), y = player(b);
  if (x.firstName && y.firstName && x.firstName !== y.firstName) return false;
  return !!x.initial && x.initial === y.initial && x.surnames.some((name) => y.surnames.includes(name));
}
