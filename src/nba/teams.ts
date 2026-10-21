// Référentiel des 30 franchises : identifiants NBA, couleurs pour le rendu.
export interface TeamInfo {
  id: number;
  tri: string;
  city: string;
  name: string;
  color: string;
  color2: string;
}

export const TEAMS: TeamInfo[] = [
  { id: 1610612737, tri: 'ATL', city: 'Atlanta', name: 'Hawks', color: '#E03A3E', color2: '#C1D32F' },
  { id: 1610612738, tri: 'BOS', city: 'Boston', name: 'Celtics', color: '#007A33', color2: '#BA9653' },
  { id: 1610612751, tri: 'BKN', city: 'Brooklyn', name: 'Nets', color: '#3A3A3A', color2: '#FFFFFF' },
  { id: 1610612766, tri: 'CHA', city: 'Charlotte', name: 'Hornets', color: '#1D1160', color2: '#00788C' },
  { id: 1610612741, tri: 'CHI', city: 'Chicago', name: 'Bulls', color: '#CE1141', color2: '#000000' },
  { id: 1610612739, tri: 'CLE', city: 'Cleveland', name: 'Cavaliers', color: '#860038', color2: '#FDBB30' },
  { id: 1610612742, tri: 'DAL', city: 'Dallas', name: 'Mavericks', color: '#00538C', color2: '#B8C4CA' },
  { id: 1610612743, tri: 'DEN', city: 'Denver', name: 'Nuggets', color: '#0E2240', color2: '#FEC524' },
  { id: 1610612765, tri: 'DET', city: 'Detroit', name: 'Pistons', color: '#C8102E', color2: '#1D42BA' },
  { id: 1610612744, tri: 'GSW', city: 'Golden State', name: 'Warriors', color: '#1D428A', color2: '#FFC72C' },
  { id: 1610612745, tri: 'HOU', city: 'Houston', name: 'Rockets', color: '#CE1141', color2: '#C4CED4' },
  { id: 1610612754, tri: 'IND', city: 'Indiana', name: 'Pacers', color: '#002D62', color2: '#FDBB30' },
  { id: 1610612746, tri: 'LAC', city: 'LA', name: 'Clippers', color: '#C8102E', color2: '#1D428A' },
  { id: 1610612747, tri: 'LAL', city: 'Los Angeles', name: 'Lakers', color: '#552583', color2: '#FDB927' },
  { id: 1610612763, tri: 'MEM', city: 'Memphis', name: 'Grizzlies', color: '#5D76A9', color2: '#12173F' },
  { id: 1610612748, tri: 'MIA', city: 'Miami', name: 'Heat', color: '#98002E', color2: '#F9A01B' },
  { id: 1610612749, tri: 'MIL', city: 'Milwaukee', name: 'Bucks', color: '#00471B', color2: '#EEE1C6' },
  { id: 1610612750, tri: 'MIN', city: 'Minnesota', name: 'Timberwolves', color: '#0C2340', color2: '#78BE20' },
  { id: 1610612740, tri: 'NOP', city: 'New Orleans', name: 'Pelicans', color: '#0C2340', color2: '#C8102E' },
  { id: 1610612752, tri: 'NYK', city: 'New York', name: 'Knicks', color: '#006BB6', color2: '#F58426' },
  { id: 1610612760, tri: 'OKC', city: 'Oklahoma City', name: 'Thunder', color: '#007AC1', color2: '#EF3B24' },
  { id: 1610612753, tri: 'ORL', city: 'Orlando', name: 'Magic', color: '#0077C0', color2: '#C4CED4' },
  { id: 1610612755, tri: 'PHI', city: 'Philadelphia', name: '76ers', color: '#006BB6', color2: '#ED174C' },
  { id: 1610612756, tri: 'PHX', city: 'Phoenix', name: 'Suns', color: '#1D1160', color2: '#E56020' },
  { id: 1610612757, tri: 'POR', city: 'Portland', name: 'Trail Blazers', color: '#E03A3E', color2: '#000000' },
  { id: 1610612758, tri: 'SAC', city: 'Sacramento', name: 'Kings', color: '#5A2D81', color2: '#63727A' },
  { id: 1610612759, tri: 'SAS', city: 'San Antonio', name: 'Spurs', color: '#8A8D8F', color2: '#000000' },
  { id: 1610612761, tri: 'TOR', city: 'Toronto', name: 'Raptors', color: '#CE1141', color2: '#000000' },
  { id: 1610612762, tri: 'UTA', city: 'Utah', name: 'Jazz', color: '#002B5C', color2: '#F9A01B' },
  { id: 1610612764, tri: 'WAS', city: 'Washington', name: 'Wizards', color: '#002B5C', color2: '#E31837' },
];

export const teamByTri = (tri: string): TeamInfo => {
  const t = TEAMS.find((x) => x.tri === tri.toUpperCase());
  if (!t) throw new Error(`Équipe inconnue : ${tri}`);
  return t;
};
export const teamById = (id: number): TeamInfo | undefined => TEAMS.find((x) => x.id === id);
