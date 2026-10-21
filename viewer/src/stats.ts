// Box score en direct : instantané des statistiques après chaque évènement du match typique.
import type { SimEvent, PlayerInfoV } from './types.ts';

export const COLS = ['min', 'pts', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf'] as const;
export type Col = (typeof COLS)[number];
const NC = COLS.length;
const ci = (c: Col) => COLS.indexOf(c);

export interface Snapshots {
  ids: number[];
  data: Float32Array[]; // par évènement : ids.length × NC
  on: Array<[number[], number[]]>; // cinq sur le terrain après l'évènement
  lastSub: Array<Map<number, 'in' | 'out'>>; // derniers changements (pour les badges IN/OUT)
}

export function buildSnapshots(events: SimEvent[], players: PlayerInfoV[]): Snapshots {
  const ids = players.map((p) => p.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const cur = new Float32Array(ids.length * NC);
  let on: [number[], number[]] = [[], []];
  let lastT = 0;
  let subs = new Map<number, 'in' | 'out'>();
  const out: Snapshots = { ids, data: [], on: [], lastSub: [] };
  const add = (pid: number | undefined, c: Col, v = 1) => {
    if (pid == null) return;
    const i = idx.get(pid);
    if (i == null) return;
    cur[i * NC + ci(c)] += v;
  };
  for (const e of events) {
    // Minutes : temps écoulé depuis l'évènement précédent pour les joueurs sur le terrain.
    const dt = Math.max(0, e.t - lastT);
    lastT = e.t;
    for (const side of [0, 1] as const) for (const pid of on[side]) add(pid, 'min', dt / 60);
    if (e.on) on = [e.on[0].slice(), e.on[1].slice()];
    if (e.type === 'sub') {
      subs = new Map(subs);
      for (const id of e.inn ?? []) subs.set(id, 'in');
      for (const id of e.out ?? []) subs.set(id, 'out');
    } else if (e.type === 'poss') subs = new Map();
    switch (e.type) {
      case 'shot': {
        const three = (e.zone ?? 0) >= 3;
        if (e.label !== 'heave') {
          add(e.pid, 'fga');
          if (three) add(e.pid, 'fg3a');
        }
        if (e.made) {
          if (e.label !== 'heave') add(e.pid, 'fgm');
          if (three && e.label !== 'heave') add(e.pid, 'fg3m');
          add(e.pid, 'pts', e.pts ?? 0);
          add(e.pid2, 'ast');
        } else if (e.pid2) add(e.pid2, 'blk');
        break;
      }
      case 'ft':
        add(e.pid, 'fta', e.n ?? 1);
        add(e.pid, 'ftm', e.pts ?? 0);
        add(e.pid, 'pts', e.pts ?? 0);
        break;
      case 'reb':
        if (e.pid) add(e.pid, e.kind === 'offensive' ? 'oreb' : 'dreb');
        break;
      case 'tov':
        add(e.pid, 'tov');
        if (e.kind === 'steal') add(e.pid2, 'stl');
        if (e.kind === 'offensive foul') add(e.pid, 'pf');
        break;
      case 'foul':
        if (e.kind !== 'technical' && e.kind !== 'foul-out') add(e.pid, 'pf');
        break;
    }
    out.data.push(cur.slice());
    out.on.push([on[0].slice(), on[1].slice()]);
    out.lastSub.push(subs);
  }
  return out;
}

export function get(s: Snapshots, evIdx: number, pid: number, c: Col): number {
  if (evIdx < 0) return 0;
  const i = s.ids.indexOf(pid);
  return i < 0 ? 0 : s.data[Math.min(evIdx, s.data.length - 1)][i * NC + ci(c)];
}
