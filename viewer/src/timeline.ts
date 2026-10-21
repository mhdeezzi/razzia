// Chorégraphie : journal d'évènements -> images clés (positions des 10 joueurs + ballon) et repères temporels.
import type { SimEvent, PlayerInfoV, TypicalFile } from './types.ts';

export type Pt = [number, number];

export interface KF {
  tau: number;
  P: Record<number, Pt>;
  B: [number, number, number]; // x, y (pieds), hauteur (pieds)
  holder?: number;
  ease: 'inout' | 'linear';
}

export interface Cue {
  tau: number;
  ev: number;
}

export type ScreenKind = 'intro' | 'quarter' | 'half' | 'final' | 'box' | 'summary';

export interface Banner {
  tau0: number;
  tau1: number;
  kind: 'chip' | 'mismatch' | 'badge' | 'timeout' | 'subs' | 'screen' | 'rimglow';
  pid?: number;
  side?: 0 | 1;
  text?: string;
  label?: string;
  screen?: ScreenKind;
  period?: number;
  ids?: number[];
  ids2?: number[];
  basket?: 'left' | 'right';
}

export interface Timeline {
  kfs: KF[];
  cues: Cue[];
  banners: Banner[];
  duration: number;
  periodTau: number[];
  clock: Array<{ tau: number; p: number; clock: number; sc: number }>;
}

// Durées (secondes de vidéo à vitesse 1×).
const D = {
  intro: 5, jump: 1.8, setupHC: 1.5, setupTR: 0.9, setup2: 0.6, pass: 0.5, toSpot: 0.45, flight: 0.8, drop: 0.25, reb: 0.55,
  tov: 0.65, foul: 0.55, ftSetup: 0.7, ft: 0.7, sub: 0.35, timeout: 1.8, quarter: 3.2, half: 4.5, final: 5.5, box: 9, summary: 9,
};

// Positions d'attaque (coordonnées locales en pieds : x latéral, y distance au panier).
const SPOTS: Record<string, Pt> = {
  top: [0, 26], lw: [-17, 20], rw: [17, 20], lc: [-22, 3], rc: [22, 3], ld: [-7, 3], rd: [7, 3], hp: [0, 15], le: [-7, 15], re: [7, 15],
};

let seedState = 12345;
const rnd = () => {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
};

export function basketOf(side: 0 | 1, period: number): 'left' | 'right' {
  const firstHalf = period <= 2;
  // L'extérieur (1) attaque à droite en 1re mi-temps, le domicile (0) à gauche ; on change à la pause.
  if (side === 1) return firstHalf ? 'right' : 'left';
  return firstHalf ? 'left' : 'right';
}

export function toCourt(b: 'left' | 'right', lx: number, ly: number): Pt {
  return b === 'right' ? [88.75 - ly, 25 + lx] : [5.25 + ly, 25 - lx];
}
const rim = (b: 'left' | 'right'): Pt => (b === 'right' ? [88.75, 25] : [5.25, 25]);
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clampCourt = (p: Pt): Pt => [Math.max(1, Math.min(93, p[0])), Math.max(1, Math.min(49, p[1]))];

export function buildTimeline(tf: TypicalFile): Timeline {
  seedState = (tf.seed >>> 0) || 12345;
  const ev = tf.result.events;
  const info = new Map(tf.players.map((p) => [p.id, p]));
  const kfs: KF[] = [];
  const cues: Cue[] = [];
  const banners: Banner[] = [];
  const clock: Timeline['clock'] = [];
  const periodTau: number[] = [];
  let tau = 0;
  let pos: Record<number, Pt> = {};
  let ball: [number, number, number] = [47, 25, 0];
  let holder: number | undefined;
  let on: [number[], number[]] = [[], []];
  let period = 1;
  let poss: { side: 0 | 1; b: 'left' | 'right'; finisher?: number; pt?: string; kind?: string; defOf: Map<number, number> } | null = null;

  const push = (dt: number, ease: KF['ease'] = 'inout') => {
    tau += dt;
    kfs.push({ tau, P: { ...pos }, B: [...ball] as [number, number, number], holder, ease });
  };
  const cue = (i: number) => {
    cues.push({ tau, ev: i });
    const e = ev[i];
    clock.push({ tau, p: e.p, clock: e.clock, sc: e.sc ?? 24 });
  };
  const ballAt = (pid: number | undefined, h = 4) => {
    if (pid != null && pos[pid]) {
      const p = pos[pid];
      ball = [p[0], p[1], h];
      holder = pid;
    }
  };
  const groupOrder = (id: number) => ({ G: 0, W: 1, B: 2 })[info.get(id)?.group ?? 'W'];

  function formation(side: 0 | 1, b: 'left' | 'right', finisher?: number, pt?: string, handler?: number): Record<number, Pt> {
    const ids = [...on[side]].sort((a, c) => groupOrder(a) - groupOrder(c));
    const out: Record<number, Pt> = {};
    const free = ['top', 'lw', 'rw', 'lc', 'rc', 'ld', 'rd', 'le', 're', 'hp'];
    const take = (k: string) => {
      const i = free.indexOf(k);
      if (i >= 0) free.splice(i, 1);
      return SPOTS[k];
    };
    const prefer: Record<string, string[]> = { G: ['top', 'lw', 'rw', 'lc', 'rc'], W: ['lw', 'rw', 'lc', 'rc', 'top'], B: ['ld', 'rd', 'hp', 'le', 're'] };
    // Porteur au sommet, finisseur positionné selon son type de jeu.
    if (handler != null && ids.includes(handler)) out[handler] = take('top');
    if (finisher != null && finisher !== handler && ids.includes(finisher)) {
      const k = pt === 'Spotup' ? (rnd() < 0.5 ? 'lc' : 'rc') : pt === 'Cut' ? (rnd() < 0.5 ? 'lw' : 'rw') : pt === 'Postup' ? (rnd() < 0.5 ? 'le' : 're') : pt === 'PRRollman' ? 'hp' : null;
      if (k && free.includes(k)) out[finisher] = take(k);
    }
    for (const id of ids) {
      if (out[id]) continue;
      const g = info.get(id)?.group ?? 'W';
      const k = prefer[g].find((x) => free.includes(x)) ?? free[0];
      out[id] = take(k);
    }
    const res: Record<number, Pt> = {};
    for (const [id, p] of Object.entries(out)) res[Number(id)] = toCourt(b, p[0] + (rnd() - 0.5) * 2, p[1] + (rnd() - 0.5) * 2);
    return res;
  }

  function guard(side: 0 | 1, b: 'left' | 'right', defOf: Map<number, number>, ballP: Pt): void {
    const bk = rim(b);
    for (const o of on[side]) {
      const d = defOf.get(o);
      if (d == null || !pos[o]) continue;
      const m = pos[o];
      const v: Pt = [bk[0] - m[0], bk[1] - m[1]];
      const L = Math.hypot(v[0], v[1]) || 1;
      const nearBall = dist(m, ballP) < 4;
      const gap = nearBall ? 2.6 : Math.min(6, 3 + dist(m, ballP) / 10);
      const toBall: Pt = [(ballP[0] - m[0]) / (dist(m, ballP) || 1), (ballP[1] - m[1]) / (dist(m, ballP) || 1)];
      pos[d] = clampCourt([m[0] + (v[0] / L) * gap + toBall[0] * 1.2, m[1] + (v[1] / L) * gap + toBall[1] * 1.2]);
    }
  }

  function assignDefense(side: 0 | 1, finisher?: number, def?: number): Map<number, number> {
    const off = [...on[side]].sort((a, c) => groupOrder(a) - groupOrder(c));
    const dfs = [...on[side === 0 ? 1 : 0]].sort((a, c) => groupOrder(a) - groupOrder(c));
    const m = new Map<number, number>();
    off.forEach((o, i) => m.set(o, dfs[i]));
    if (finisher != null && def != null && m.get(finisher) !== def) {
      const other = [...m.entries()].find(([, d]) => d === def)?.[0];
      const prev = m.get(finisher)!;
      m.set(finisher, def);
      if (other != null) m.set(other, prev);
    }
    return m;
  }

  function placeHalves(offSide: 0 | 1): void {
    // Début de période : chaque équipe dans sa moitié, ballon au porteur.
    for (const side of [0, 1] as const) {
      const b = basketOf(side, period);
      const ids = on[side];
      ids.forEach((id, i) => {
        const spot = [SPOTS.top, SPOTS.lw, SPOTS.rw, SPOTS.le, SPOTS.re][i] ?? SPOTS.hp;
        pos[id] = toCourt(b, spot[0] * 0.8, side === offSide ? spot[1] + 14 : spot[1] + 4);
      });
    }
    const h = [...on[offSide]].sort((a, c) => groupOrder(a) - groupOrder(c))[0];
    ballAt(h);
  }

  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.on) on = [e.on[0].slice(), e.on[1].slice()];
    switch (e.type) {
      case 'start': {
        // Présentation : les deux cinq alignés dans leur moitié.
        on.forEach((ids, side) => ids.forEach((id, k) => (pos[id] = [side === 0 ? 30 : 64, 13 + k * 6])));
        ball = [47, 25, 0];
        holder = undefined;
        kfs.push({ tau: 0, P: { ...pos }, B: [...ball] as [number, number, number], ease: 'inout' });
        banners.push({ tau0: 0, tau1: D.intro, kind: 'screen', screen: 'intro' });
        cue(i);
        push(D.intro);
        periodTau[1] = tau;
        break;
      }
      case 'jump': {
        const [jh, ja] = [e.pid!, e.pid2!];
        for (const side of [0, 1] as const) {
          const b = basketOf(side, 1);
          on[side].filter((id) => id !== jh && id !== ja).forEach((id, k) => {
            const ang = (k / 4) * Math.PI - Math.PI / 2;
            const back = b === 'left' ? 1 : -1;
            pos[id] = [47 + back * (8 + 3 * Math.abs(Math.sin(ang))), 25 + 14 * Math.sin(ang)];
          });
        }
        pos[jh] = basketOf(0, 1) === 'left' ? [48.2, 25] : [45.8, 25];
        pos[ja] = basketOf(1, 1) === 'left' ? [48.2, 25] : [45.8, 25];
        ball = [47, 25, 5];
        holder = undefined;
        push(0.6);
        ball = [47, 25, 13];
        push(0.5, 'linear');
        const winner = e.side ?? 0;
        const tgt = on[winner].find((id) => id !== jh && id !== ja) ?? on[winner][0];
        ballAt(tgt, 4);
        cue(i);
        push(0.7);
        break;
      }
      case 'period_start': {
        period = e.p;
        periodTau[period] = tau;
        placeHalves((e.side ?? 0) as 0 | 1);
        cue(i);
        push(1.0);
        break;
      }
      case 'poss': {
        const side = e.side as 0 | 1;
        const b = basketOf(side, e.p);
        const defOf = assignDefense(side, e.pid, e.def);
        poss = { side, b, finisher: e.pid, pt: e.pt, kind: e.kind, defOf };
        const handler = e.passes?.[0] ?? e.handler ?? e.pid;
        const spots = formation(side, b, e.pid, e.pt, handler);
        const setup = e.kind === 'transition' ? D.setupTR : e.kind === 'second chance' ? D.setup2 : D.setupHC;
        if (e.kind === 'transition') {
          // Contre-attaque : on part de la position actuelle et on file vers le panier.
          for (const id of on[side]) pos[id] = lerp(pos[id] ?? [47, 25], spots[id], 0.92);
        } else for (const id of on[side]) pos[id] = spots[id];
        ballAt(handler, 4);
        guard(side, b, defOf, [ball[0], ball[1]]);
        cue(i);
        push(setup);
        if (e.mismatch) banners.push({ tau0: tau, tau1: tau + 2.2, kind: 'mismatch', pid: e.mismatch[0], ids: [e.mismatch[1]], side });
        // Pick-and-roll : l'écran vient au porteur.
        if ((e.pt === 'PRBallHandler' || e.pt === 'PRRollman') && e.screener != null && e.handler != null && pos[e.handler]) {
          const h = pos[e.handler];
          const bk = rim(b);
          pos[e.screener] = lerp(h, bk, 0.12);
          guard(side, b, defOf, [ball[0], ball[1]]);
          push(0.55);
        }
        // Circulation du ballon.
        const chain = e.passes ?? [];
        for (let k = 1; k < chain.length; k++) {
          const r = chain[k];
          if (!pos[r]) continue;
          if (r === e.pid && (e.pt === 'Cut' || e.pt === 'PRRollman')) pos[r] = lerp(pos[r], rim(b), 0.55);
          ballAt(r, 4);
          guard(side, b, defOf, [ball[0], ball[1]]);
          push(D.pass, 'linear');
        }
        break;
      }
      case 'shot': {
        const side = e.side as 0 | 1;
        const b = poss?.b ?? basketOf(side, e.p);
        const shooter = e.pid!;
        if (e.label === 'heave') {
          const [hx, hy] = b === 'right' ? [35, 25] : [59, 25];
          pos[shooter] = [hx, hy];
          ballAt(shooter, 5);
          push(0.35);
        } else {
          const lx = (e.x ?? 0) / 10;
          const ly = (e.y ?? 0) / 10;
          const spot = clampCourt(toCourt(b, lx, Math.max(0.6, ly)));
          pos[shooter] = spot;
          ballAt(shooter, 5);
          if (poss) guard(side, b, poss.defOf, spot);
          if (e.def != null && pos[e.def]) pos[e.def] = clampCourt(lerp(spot, rim(b), 2.2 / Math.max(2.5, dist(spot, rim(b)))));
          push(D.toSpot);
        }
        // Vol du ballon : arc.
        const r = rim(b);
        const three = (e.zone ?? 0) >= 3;
        const peak = three ? 17 : (e.y ?? 0) < 60 ? 11 : 14;
        const start: Pt = [ball[0], ball[1]];
        holder = undefined;
        ball = [(start[0] + r[0]) / 2, (start[1] + r[1]) / 2, peak];
        push(D.flight / 2, 'linear');
        ball = [r[0], r[1], 10];
        push(D.flight / 2, 'linear');
        cue(i);
        if (e.made) {
          banners.push({ tau0: tau, tau1: tau + 1.6, kind: 'badge', side, text: `+${e.pts}`, basket: b });
          banners.push({ tau0: tau, tau1: tau + 0.6, kind: 'rimglow', basket: b });
          banners.push({ tau0: tau - 0.2, tau1: tau + 1.6, kind: 'chip', pid: shooter, side, label: shotChip(e) });
          ball = [r[0], r[1], 3];
          push(D.drop);
        } else {
          if (e.pid2) banners.push({ tau0: tau - D.flight / 2, tau1: tau + 1.3, kind: 'chip', pid: e.pid2, side: (1 - side) as 0 | 1, label: 'BLOCK' });
          ball = [r[0] + (b === 'right' ? -3 : 3), r[1] + (rnd() - 0.5) * 6, 9];
          push(0.25);
        }
        break;
      }
      case 'reb': {
        const side = e.side as 0 | 1;
        const b = poss?.b ?? basketOf(side, e.p);
        const r = rim(b);
        if (e.pid && pos[e.pid]) {
          const target = clampCourt([r[0] + (b === 'right' ? -1 : 1) * (3 + rnd() * 4), r[1] + (rnd() - 0.5) * 10]);
          pos[e.pid] = target;
          ballAt(e.pid, 6);
          banners.push({ tau0: tau, tau1: tau + 1.5, kind: 'chip', pid: e.pid, side, label: e.kind === 'offensive' ? 'OFFENSIVE REBOUND' : 'REBOUND' });
        } else {
          ball = [b === 'right' ? 93.5 : 0.5, 25 + (rnd() - 0.5) * 20, 1];
          holder = undefined;
        }
        push(D.reb);
        cue(i);
        break;
      }
      case 'tov': {
        const side = e.side as 0 | 1;
        if (e.kind === 'steal' && e.pid2 && pos[e.pid2]) {
          ballAt(e.pid2, 4);
          banners.push({ tau0: tau, tau1: tau + 1.5, kind: 'chip', pid: e.pid2, side: (1 - side) as 0 | 1, label: 'STEAL' });
        } else if (e.pid) {
          banners.push({ tau0: tau, tau1: tau + 1.5, kind: 'chip', pid: e.pid, side, label: (e.kind ?? 'turnover').toUpperCase() });
          ball = [ball[0], e.kind === 'out of bounds' ? 50.5 : ball[1], 1];
          holder = undefined;
        }
        push(D.tov);
        cue(i);
        break;
      }
      case 'foul': {
        const side = e.side as 0 | 1;
        const label = e.kind === 'shooting' ? 'SHOOTING FOUL' : e.kind === 'and-one' ? 'AND ONE' : e.kind === 'technical' ? 'TECHNICAL' : e.kind === 'foul-out' ? 'FOULS OUT' : e.kind === 'take' ? 'INTENTIONAL FOUL' : 'FOUL';
        if (e.pid) banners.push({ tau0: tau, tau1: tau + 1.4, kind: 'chip', pid: e.kind === 'and-one' ? e.pid2 : e.pid, side: e.kind === 'and-one' ? ((1 - side) as 0 | 1) : side, label });
        push(D.foul);
        cue(i);
        break;
      }
      case 'ft': {
        const side = e.side as 0 | 1;
        const b = basketOf(side, e.p);
        const shooter = e.pid!;
        // Alignement le long de la raquette.
        const lane: Pt[] = [[-8, 7], [8, 7], [-8, 10], [8, 10], [-8, 13], [8, 13]];
        let k = 0;
        for (const s2 of [0, 1] as const) for (const id of on[s2]) {
          if (id === shooter) continue;
          const spot = k < lane.length ? lane[k] : [((k % 2) * 2 - 1) * 18, 22];
          pos[id] = toCourt(b, spot[0], spot[1]);
          k++;
        }
        pos[shooter] = toCourt(b, 0, 14.5);
        ballAt(shooter, 5);
        push(D.ftSetup);
        const n = e.n ?? 1;
        const made = e.pts ?? 0;
        const missLast = ev[i + 1]?.type === 'reb';
        const pattern: boolean[] = [];
        for (let q = 0; q < n; q++) pattern.push(missLast ? q < made : q >= n - made);
        const r = rim(b);
        pattern.forEach((ok, q) => {
          holder = undefined;
          ball = [(pos[shooter][0] + r[0]) / 2, (pos[shooter][1] + r[1]) / 2, 13];
          push(D.ft / 2, 'linear');
          ball = [r[0], r[1], ok ? 4 : 10];
          push(D.ft / 2, 'linear');
          if (ok) banners.push({ tau0: tau, tau1: tau + 0.5, kind: 'rimglow', basket: b });
          if (q < pattern.length - 1) {
            ballAt(shooter, 5);
            push(0.25);
          }
        });
        cue(i);
        break;
      }
      case 'sub': {
        const side = e.side as 0 | 1;
        for (const id of e.inn ?? []) if (!pos[id]) pos[id] = [47 + (rnd() - 0.5) * 6, 51.5];
        for (const id of e.inn ?? []) pos[id] = [47 + (rnd() - 0.5) * 6, 51.5];
        banners.push({ tau0: tau, tau1: tau + 2.4, kind: 'subs', side, ids: e.inn, ids2: e.out });
        cue(i);
        push(D.sub);
        break;
      }
      case 'timeout': {
        banners.push({ tau0: tau, tau1: tau + D.timeout, kind: 'timeout', side: e.side, text: e.text });
        cue(i);
        push(D.timeout);
        break;
      }
      case 'period_end': {
        cue(i);
        const isLast = ev.slice(i + 1).every((x) => x.type !== 'period_start');
        if (!isLast) {
          const half = e.p === 2;
          banners.push({ tau0: tau, tau1: tau + (half ? D.half : D.quarter), kind: 'screen', screen: half ? 'half' : 'quarter', period: e.p });
          push(half ? D.half : D.quarter);
        }
        break;
      }
      case 'end': {
        cue(i);
        banners.push({ tau0: tau, tau1: tau + D.final, kind: 'screen', screen: 'final' });
        push(D.final);
        banners.push({ tau0: tau, tau1: tau + D.box, kind: 'screen', screen: 'box' });
        push(D.box);
        banners.push({ tau0: tau, tau1: tau + D.summary, kind: 'screen', screen: 'summary' });
        push(D.summary);
        break;
      }
    }
  }
  return { kfs, cues, banners, duration: tau, periodTau, clock };
}

function shotChip(e: SimEvent): string {
  const l = (e.label ?? '').toLowerCase();
  if ((e.zone ?? 0) >= 3) return l.includes('step back') ? 'STEP-BACK 3' : '3-POINTER';
  if (l.includes('alley')) return 'ALLEY-OOP';
  if (l.includes('dunk')) return 'DUNK';
  if (l.includes('putback') || l.includes('tip')) return 'PUTBACK';
  if (l.includes('hook')) return 'HOOK SHOT';
  if (l.includes('float')) return 'FLOATER';
  if (l.includes('layup')) return 'LAYUP';
  if (l.includes('fadeaway')) return 'FADEAWAY';
  if (l.includes('pullup') || l.includes('pull-up')) return 'PULL-UP';
  return 'JUMPER';
}

/** Interpolation des positions à l'instant tau. */
export function frameAt(tl: Timeline, tau: number): { P: Record<number, Pt>; B: [number, number, number]; holder?: number; k: number } {
  const k = tl.kfs;
  if (!k.length) return { P: {}, B: [47, 25, 0], k: 0 };
  let lo = 0;
  let hi = k.length - 1;
  if (tau <= k[0].tau) return { P: k[0].P, B: k[0].B, holder: k[0].holder, k: 0 };
  if (tau >= k[hi].tau) return { P: k[hi].P, B: k[hi].B, holder: k[hi].holder, k: hi };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (k[mid].tau <= tau) lo = mid;
    else hi = mid;
  }
  const a = k[lo];
  const b = k[hi];
  let t = (tau - a.tau) / Math.max(1e-6, b.tau - a.tau);
  if (b.ease === 'inout') t = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const P: Record<number, Pt> = {};
  for (const id of Object.keys(b.P)) {
    const n = Number(id);
    const pa = a.P[n] ?? b.P[n];
    P[n] = lerp(pa, b.P[n], t);
  }
  const B: [number, number, number] = [a.B[0] + (b.B[0] - a.B[0]) * t, a.B[1] + (b.B[1] - a.B[1]) * t, a.B[2] + (b.B[2] - a.B[2]) * t];
  return { P, B, holder: t < 0.5 ? a.holder : b.holder, k: lo };
}

/** Dernier évènement appliqué à l'instant tau. */
export function eventAt(tl: Timeline, tau: number): number {
  const c = tl.cues;
  let lo = -1;
  let hi = c.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid].tau <= tau) lo = mid;
    else hi = mid;
  }
  return lo < 0 ? -1 : c[lo].ev;
}

/** Horloge de jeu interpolée entre deux repères. */
export function clockAt(tl: Timeline, tau: number): { p: number; clock: number; sc: number } {
  const c = tl.clock;
  if (!c.length) return { p: 1, clock: 720, sc: 24 };
  let i = 0;
  while (i + 1 < c.length && c[i + 1].tau <= tau) i++;
  const a = c[i];
  const b = c[i + 1];
  if (!b || b.p !== a.p || tau <= a.tau) return { p: a.p, clock: a.clock, sc: a.sc };
  const t = Math.min(1, (tau - a.tau) / Math.max(1e-6, b.tau - a.tau));
  return { p: a.p, clock: a.clock + (b.clock - a.clock) * t, sc: Math.max(0, a.sc + (b.sc - a.sc) * t) };
}

export type { PlayerInfoV };
