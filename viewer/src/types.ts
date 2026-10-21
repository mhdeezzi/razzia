// Formats des fichiers produits par `npm run sim` (out/<match>/typical.json et summary.json).
import type { SimEvent, TeamResult } from '../../src/nba/engine/game.ts';
import type { Summary } from '../../src/nba/engine/montecarlo.ts';

export type { SimEvent, Summary };

export interface TeamInfoV {
  id: number;
  tri: string;
  name: string;
  city: string;
  color: string;
  color2: string;
}

export interface PlayerInfoV {
  id: number;
  name: string;
  short: string;
  jersey: string;
  pos: string;
  group: 'G' | 'W' | 'B';
  side: 0 | 1;
  starter: boolean;
  status: string;
}

export interface TypicalFile {
  index: number;
  n: number;
  seed: number;
  result: {
    home: TeamResult;
    away: TeamResult;
    periods: number;
    events: SimEvent[];
    leadChanges: number;
    largestLead: [number, number];
  };
  teams: { home: TeamInfoV; away: TeamInfoV };
  players: PlayerInfoV[];
  actual?: { home: number; away: number; homeQ: number[]; awayQ: number[] };
}

export interface IndexEntry {
  dir: string;
  date: string;
  away: string;
  home: string;
  n: number;
  pHome: number;
  builtAt: string;
}
