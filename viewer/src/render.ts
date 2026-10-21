// Dessin d'une image du match typique (1920×1080) : terrain, joueurs, ballon et habillage TV.
import { drawCourt, drawHoop, makeView, project, localScale, rimScreen, type CourtView } from './court.ts';
import { frameAt, eventAt, clockAt, type Timeline, type Banner } from './timeline.ts';
import { get, type Snapshots } from './stats.ts';
import type { TypicalFile, Summary, PlayerInfoV } from './types.ts';

export const W = 1920;
export const H = 1080;
const COND = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const SANS = "Inter, system-ui, sans-serif";

export interface Ctx {
  tf: TypicalFile;
  tl: Timeline;
  snaps: Snapshots;
  summary?: Summary;
  view: CourtView;
  info: Map<number, PlayerInfoV>;
  colors: [string, string]; // couleur d'affichage domicile, extérieur
  stars: Array<[number, number, number]>;
}

function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
}
const lum = (h: string) => {
  const [r, g, b] = hexToRgb(h).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function lighten(h: string, k: number): string {
  const [r, g, b] = hexToRgb(h);
  const f = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function displayColor(primary: string, secondary: string): string {
  if (lum(primary) < 0.08) return lum(secondary) > 0.15 ? secondary : lighten(primary, 0.45);
  if (lum(primary) < 0.16) return lighten(primary, 0.25);
  return primary;
}

export function makeCtx(tf: TypicalFile, tl: Timeline, snaps: Snapshots, summary?: Summary): Ctx {
  const view = makeView(960, 300, 890, 455, 610);
  let home = displayColor(tf.teams.home.color, tf.teams.home.color2);
  let away = displayColor(tf.teams.away.color, tf.teams.away.color2);
  const d = hexToRgb(home.startsWith('#') ? home : '#808080').map((v, i) => Math.abs(v - hexToRgb(away.startsWith('#') ? away : '#808080')[i])).reduce((a, b) => a + b, 0);
  if (d < 90) away = '#c9ced8';
  if (lum(home.startsWith('#') ? home : '#808080') > 0.7) home = '#9aa3b2';
  const stars: Array<[number, number, number]> = [];
  let s = 7;
  for (let i = 0; i < 140; i++) {
    s = (s * 16807) % 2147483647;
    const x = (s / 2147483647) * W;
    s = (s * 16807) % 2147483647;
    const y = (s / 2147483647) * 320;
    s = (s * 16807) % 2147483647;
    stars.push([x, y, 0.3 + (s / 2147483647) * 1.4]);
  }
  return { tf, tl, snaps, summary, view, info: new Map(tf.players.map((p) => [p.id, p])), colors: [home, away], stars };
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function fmtClock(sec: number): string {
  if (sec < 60) return sec.toFixed(1);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const teamOf = (x: Ctx, side: 0 | 1) => (side === 0 ? x.tf.teams.home : x.tf.teams.away);

// ------------------------------------------------------------------ image complète
export function drawFrame(c: CanvasRenderingContext2D, x: Ctx, tau: number): void {
  const { tl } = x;
  c.save();
  c.clearRect(0, 0, W, H);
  // Fond.
  const bg = c.createRadialGradient(W / 2, 380, 120, W / 2, 520, 1200);
  bg.addColorStop(0, '#16233d');
  bg.addColorStop(0.55, '#0b1424');
  bg.addColorStop(1, '#060a13');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  for (const [sx, sy, r] of x.stars) {
    c.fillStyle = `rgba(160,190,255,${0.12 + r * 0.08})`;
    c.fillRect(sx, sy, r, r);
  }

  const evIdx = eventAt(tl, tau);
  const f = frameAt(tl, tau);
  // Terrain.
  drawCourt(c, x.view, { home: x.colors[0], away: x.colors[1] });
  watermark(c, x);
  const glowL = activeBanner(tl, tau, (b) => b.kind === 'rimglow' && b.basket === 'left');
  const glowR = activeBanner(tl, tau, (b) => b.kind === 'rimglow' && b.basket === 'right');
  drawHoop(c, x.view, 'left', glowL ? 1 : 0);
  drawHoop(c, x.view, 'right', glowR ? 1 : 0);

  // Joueurs (tri en profondeur) et ballon.
  const on = evIdx >= 0 ? x.snaps.on[evIdx] : ([[], []] as [number[], number[]]);
  const ids = [...on[0], ...on[1]].filter((id) => f.P[id]);
  ids.sort((a, b) => f.P[a][1] - f.P[b][1]);
  for (const id of ids) {
    const [px, py] = f.P[id];
    const [sx, sy] = project(x.view.H, px, py);
    const s = localScale(x.view.H, px, py);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.ellipse(sx, sy + 2, s * 1.05, s * 0.45, 0, 0, Math.PI * 2);
    c.fill();
  }
  for (const id of ids) drawToken(c, x, id, f.P[id], f.holder === id);
  drawBall(c, x, f.B);

  // Habillage.
  drawBanners(c, x, tau);
  drawScoreboard(c, x, tau, evIdx);
  drawBox(c, x, 1, evIdx, 14);
  drawBox(c, x, 0, evIdx, W - 14 - 440);
  drawTicker(c, x, tau, evIdx);
  drawFooter(c, x);
  drawScreens(c, x, tau, evIdx);
  c.restore();
}

function watermark(c: CanvasRenderingContext2D, x: Ctx): void {
  const [cx, cy] = project(x.view.H, 47, 25);
  c.save();
  c.globalAlpha = 0.06;
  c.strokeStyle = '#fff';
  c.lineWidth = 10;
  c.beginPath();
  c.ellipse(cx, cy, 230, 120, 0, 0, Math.PI * 2);
  c.stroke();
  c.font = `800 120px ${COND}`;
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('SIM', cx, cy + 4);
  c.restore();
}

function drawToken(c: CanvasRenderingContext2D, x: Ctx, id: number, p: [number, number], hasBall: boolean): void {
  const pi = x.info.get(id);
  if (!pi) return;
  const [sx, sy] = project(x.view.H, p[0], p[1]);
  const s = localScale(x.view.H, p[0], p[1]);
  const r = Math.max(11, s * 0.95);
  const col = x.colors[pi.side];
  const y = sy - r * 0.9;
  if (hasBall) {
    c.strokeStyle = 'rgba(255,150,40,0.95)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(sx, y, r + 4, 0, Math.PI * 2);
    c.stroke();
  }
  const g = c.createLinearGradient(sx, y - r, sx, y + r);
  g.addColorStop(0, lighten(col.startsWith('#') ? col : '#808080', 0.25));
  g.addColorStop(1, col);
  c.fillStyle = g;
  c.beginPath();
  c.arc(sx, y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = lum(col.startsWith('#') ? col : '#808080') > 0.6 ? '#111' : '#fff';
  c.font = `700 ${Math.round(r * 1.05)}px ${COND}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(pi.jersey || '·', sx, y + 1);
}

function drawBall(c: CanvasRenderingContext2D, x: Ctx, B: [number, number, number]): void {
  const [sx, sy] = project(x.view.H, B[0], B[1]);
  const s = localScale(x.view.H, B[0], B[1]);
  const lift = B[2] * s * 0.9;
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath();
  c.ellipse(sx, sy, s * 0.45, s * 0.2, 0, 0, Math.PI * 2);
  c.fill();
  const r = Math.max(5, s * 0.42);
  const g = c.createRadialGradient(sx - r * 0.3, sy - lift - r * 0.3, 1, sx, sy - lift, r);
  g.addColorStop(0, '#ffb35c');
  g.addColorStop(1, '#e0601a');
  c.fillStyle = g;
  c.beginPath();
  c.arc(sx, sy - lift, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(60,20,0,0.6)';
  c.lineWidth = 1;
  c.stroke();
}

function activeBanner(tl: Timeline, tau: number, pred: (b: Banner) => boolean): Banner | undefined {
  for (let i = tl.banners.length - 1; i >= 0; i--) {
    const b = tl.banners[i];
    if (b.tau0 <= tau && tau < b.tau1 && pred(b)) return b;
  }
  return undefined;
}

// ------------------------------------------------------------------ bandeaux et étiquettes
function chip(c: CanvasRenderingContext2D, cx: number, y: number, num: string, name: string, label: string | undefined, col: string, alpha: number): void {
  c.save();
  c.globalAlpha = alpha;
  c.font = `italic 800 22px ${COND}`;
  const wNum = Math.max(30, c.measureText(num).width + 14);
  const wName = c.measureText(name.toUpperCase()).width + 22;
  const wLab = label ? c.measureText(label).width + 22 : 0;
  const total = wNum + wName + wLab;
  let x0 = cx - total / 2;
  const h = 32;
  c.fillStyle = col;
  rr(c, x0, y, wNum, h, 4);
  c.fill();
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(num, x0 + wNum / 2, y + h / 2 + 1);
  x0 += wNum;
  c.fillStyle = '#0f1729';
  c.fillRect(x0, y, wName, h);
  c.fillStyle = '#fff';
  c.fillText(name.toUpperCase(), x0 + wName / 2, y + h / 2 + 1);
  x0 += wName;
  if (label) {
    c.fillStyle = '#f2c94c';
    rr(c, x0, y, wLab, h, 4);
    c.fill();
    c.fillStyle = '#121212';
    c.fillText(label, x0 + wLab / 2, y + h / 2 + 1);
  }
  c.restore();
}

function drawBanners(c: CanvasRenderingContext2D, x: Ctx, tau: number): void {
  const f = frameAt(x.tl, tau);
  const shown = new Set<string>();
  for (let i = x.tl.banners.length - 1; i >= 0; i--) {
    const b = x.tl.banners[i];
    if (!(b.tau0 <= tau && tau < b.tau1)) continue;
    const fade = Math.min(1, (tau - b.tau0) / 0.15, (b.tau1 - tau) / 0.25);
    if (b.kind === 'chip' && b.pid != null && f.P[b.pid] && !shown.has('chip')) {
      shown.add('chip');
      const p = x.info.get(b.pid)!;
      const [sx, sy] = project(x.view.H, f.P[b.pid][0], f.P[b.pid][1]);
      chip(c, Math.max(330, Math.min(W - 330, sx)), sy - 78, p.jersey, p.short, b.label, x.colors[p.side], fade);
    } else if (b.kind === 'mismatch' && !shown.has('mm')) {
      shown.add('mm');
      const d = x.info.get(b.pid!);
      const o = x.info.get(b.ids?.[0] ?? 0);
      if (d && o) {
        c.save();
        c.globalAlpha = fade;
        c.font = `italic 800 26px ${COND}`;
        const t1 = 'MISMATCH';
        const t2 = `${d.short.toUpperCase()} ON ${o.short.toUpperCase()}`;
        const w1 = c.measureText(t1).width + 30;
        const w2 = c.measureText(t2).width + 30;
        const x0 = W / 2 - (w1 + w2) / 2;
        c.fillStyle = '#f2c94c';
        rr(c, x0, 268, w1, 38, 4);
        c.fill();
        c.fillStyle = '#121212';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(t1, x0 + w1 / 2, 288);
        c.fillStyle = '#0f1729';
        c.fillRect(x0 + w1, 268, w2, 38);
        c.fillStyle = '#fff';
        c.fillText(t2, x0 + w1 + w2 / 2, 288);
        c.restore();
      }
    } else if (b.kind === 'timeout' && !shown.has('to')) {
      shown.add('to');
      const t = teamOf(x, (b.side ?? 0) as 0 | 1);
      c.save();
      c.globalAlpha = fade;
      c.fillStyle = 'rgba(8,12,22,0.82)';
      rr(c, W / 2 - 240, 560, 480, 90, 10);
      c.fill();
      c.fillStyle = x.colors[(b.side ?? 0) as 0 | 1];
      c.fillRect(W / 2 - 240, 560, 8, 90);
      c.font = `italic 800 46px ${COND}`;
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(`TIMEOUT ${t.name.toUpperCase()}`, W / 2, 606);
      c.restore();
    } else if (b.kind === 'subs' && !shown.has(`subs${b.side}`)) {
      shown.add(`subs${b.side}`);
      const side = (b.side ?? 0) as 0 | 1;
      const inn = (b.ids ?? []).map((id) => x.info.get(id)?.short ?? '').join(', ');
      const out = (b.ids2 ?? []).map((id) => x.info.get(id)?.short ?? '').join(', ');
      c.save();
      c.globalAlpha = fade;
      c.font = `600 20px ${SANS}`;
      const txt = `IN  ${inn}    OUT  ${out}`;
      const w = c.measureText(txt).width + 40;
      const x0 = side === 1 ? 480 : W - 480 - w;
      c.fillStyle = 'rgba(8,12,22,0.85)';
      rr(c, x0, 868, w, 36, 6);
      c.fill();
      c.fillStyle = x.colors[side];
      c.fillRect(x0, 868, 6, 36);
      c.fillStyle = '#e8eef8';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(txt, x0 + 20, 887);
      c.restore();
    }
  }
}

// ------------------------------------------------------------------ tableau de score
function wpSeries(x: Ctx, evIdx: number): number[] {
  const out: number[] = [];
  const ev = x.tf.result.events;
  for (let i = 0; i <= Math.min(evIdx, ev.length - 1); i++) if (ev[i].type === 'poss' || ev[i].type === 'end') out.push(1 - (ev[i].wp ?? 0.5));
  return out;
}

function drawScoreboard(c: CanvasRenderingContext2D, x: Ctx, tau: number, evIdx: number): void {
  const ev = x.tf.result.events;
  const e = evIdx >= 0 ? ev[evIdx] : undefined;
  const hs = e?.hs ?? 0;
  const as = e?.as ?? 0;
  const ck = clockAt(x.tl, tau);
  const X0 = 590;
  const X1 = 1330;
  const Y0 = 22;
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.5)';
  c.shadowBlur = 24;
  c.fillStyle = '#0c1424';
  rr(c, X0, Y0, X1 - X0, 196, 12);
  c.fill();
  c.restore();
  // Possession courante.
  let possSide: 0 | 1 | undefined;
  for (let i = evIdx; i >= 0; i--) if (ev[i].type === 'poss') {
    possSide = ev[i].side as 0 | 1;
    break;
  }
  const block = (side: 0 | 1, x0: number, w: number, align: 'left' | 'right') => {
    const t = teamOf(x, side);
    const col = x.colors[side];
    const g = c.createLinearGradient(x0, 0, x0 + w, 0);
    if (align === 'left') {
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(20,30,50,0.9)');
    } else {
      g.addColorStop(0, 'rgba(20,30,50,0.9)');
      g.addColorStop(1, col);
    }
    c.fillStyle = g;
    rr(c, x0, Y0, w, 118, align === 'left' ? [12, 0, 0, 0] as unknown as number : [0, 12, 0, 0] as unknown as number);
    c.fill();
    c.fillStyle = '#fff';
    c.font = `800 38px ${COND}`;
    c.textBaseline = 'middle';
    const nameX = align === 'left' ? x0 + 22 : x0 + w - 22;
    c.textAlign = align;
    c.fillText(t.name, nameX, Y0 + 40);
    const nw = c.measureText(t.name).width;
    if (possSide === side) {
      c.fillStyle = '#f2c94c';
      c.beginPath();
      c.arc(align === 'left' ? nameX + nw + 14 : nameX - nw - 14, Y0 + 40, 6, 0, Math.PI * 2);
      c.fill();
    }
    // Fautes d'équipe + bonus.
    const fouls = e?.fouls?.[side] ?? 0;
    const bonus = e?.bonus?.[side] ?? false;
    c.font = `600 15px ${SANS}`;
    c.fillStyle = 'rgba(255,255,255,0.75)';
    const fx = align === 'left' ? x0 + 22 : x0 + w - 22;
    c.fillText(`FOULS ${fouls}`, fx, Y0 + 84);
    const fw = c.measureText(`FOULS ${fouls}`).width;
    let dx = align === 'left' ? fx + fw + 12 : fx - fw - 12;
    if (bonus) {
      c.font = `800 14px ${COND}`;
      const bw = 56;
      c.fillStyle = '#f2c94c';
      rr(c, align === 'left' ? dx : dx - bw, Y0 + 74, bw, 20, 3);
      c.fill();
      c.fillStyle = '#111';
      c.textAlign = 'center';
      c.fillText('BONUS', align === 'left' ? dx + bw / 2 : dx - bw / 2, Y0 + 85);
      c.textAlign = align;
      dx = align === 'left' ? dx + bw + 10 : dx - bw - 10;
    }
    for (let k = 0; k < 7; k++) {
      c.fillStyle = k < Math.min(fouls, 7) ? '#f2c94c' : 'rgba(255,255,255,0.25)';
      c.beginPath();
      c.arc(align === 'left' ? dx + k * 11 : dx - k * 11, Y0 + 84, 3.2, 0, Math.PI * 2);
      c.fill();
    }
    // Score.
    c.font = `800 86px ${COND}`;
    c.fillStyle = '#fff';
    c.textAlign = align === 'left' ? 'right' : 'left';
    c.fillText(String(side === 0 ? hs : as), align === 'left' ? x0 + w - 14 : x0 + 14, Y0 + 62);
  };
  block(1, X0, 280, 'left');
  block(0, X1 - 280, 280, 'right');
  // Centre : période, chrono, horloge des 24 s.
  const cx = (X0 + X1) / 2;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#fff';
  c.font = `800 38px ${COND}`;
  const per = ck.p <= 4 ? `Q${ck.p}` : `OT${ck.p - 4}`;
  c.fillText(`${per}  ${fmtClock(Math.max(0, ck.clock))}`, cx, Y0 + 42);
  c.font = `600 15px ${SANS}`;
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.fillText('SHOT', cx - 18, Y0 + 86);
  c.font = `800 22px ${COND}`;
  c.fillStyle = ck.sc <= 5 ? '#f87171' : '#f2c94c';
  c.fillText(ck.clock < ck.sc ? '—' : String(Math.ceil(ck.sc)), cx + 20, Y0 + 86);

  // Probabilité de victoire.
  const wpHome = e?.wp ?? 0.5;
  const yW = Y0 + 128;
  c.font = `600 13px ${SANS}`;
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fillText('WIN PROBABILITY', cx, yW + 4);
  c.font = `italic 800 36px ${COND}`;
  c.textAlign = 'left';
  c.fillStyle = lighten(x.colors[1].startsWith('#') ? x.colors[1] : '#8899aa', 0.3);
  c.fillText(`${Math.round((1 - wpHome) * 100)}%`, X0 + 22, yW + 36);
  c.textAlign = 'right';
  c.fillStyle = lighten(x.colors[0].startsWith('#') ? x.colors[0] : '#8899aa', 0.3);
  c.fillText(`${Math.round(wpHome * 100)}%`, X1 - 22, yW + 36);
  // Courbe.
  const series = wpSeries(x, evIdx);
  const total = x.tf.result.events.filter((q) => q.type === 'poss').length + 1;
  const gx0 = X0 + 130;
  const gx1 = X1 - 130;
  const gy = yW + 38;
  const gh = 26;
  c.strokeStyle = 'rgba(255,255,255,0.15)';
  c.lineWidth = 1;
  c.setLineDash([4, 6]);
  c.beginPath();
  c.moveTo(gx0, gy);
  c.lineTo(gx1, gy);
  c.stroke();
  c.setLineDash([]);
  for (let q = 1; q < 4; q++) {
    c.beginPath();
    c.moveTo(gx0 + ((gx1 - gx0) * q) / 4, gy - gh);
    c.lineTo(gx0 + ((gx1 - gx0) * q) / 4, gy + gh);
    c.stroke();
  }
  if (series.length > 1) {
    c.strokeStyle = lighten(x.colors[1].startsWith('#') ? x.colors[1] : '#8899aa', 0.35);
    c.lineWidth = 2;
    c.beginPath();
    series.forEach((v, i) => {
      const px = gx0 + ((gx1 - gx0) * i) / total;
      const py = gy - (v - 0.5) * 2 * gh;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    });
    c.stroke();
    const lx = gx0 + ((gx1 - gx0) * (series.length - 1)) / total;
    const ly = gy - (series[series.length - 1] - 0.5) * 2 * gh;
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(lx, ly, 4, 0, Math.PI * 2);
    c.fill();
  }
}

// ------------------------------------------------------------------ box scores latéraux
function rosterOrder(x: Ctx, side: 0 | 1): PlayerInfoV[] {
  const ps = x.tf.players.filter((p) => p.side === side && !p.status.toLowerCase().startsWith('out'));
  const lines = (side === 0 ? x.tf.result.home : x.tf.result.away).lines;
  const playedIds = new Set(lines.filter((l) => l.played).map((l) => l.id));
  const st = ps.filter((p) => lines.find((l) => l.id === p.id)?.started);
  const bench = ps.filter((p) => !st.includes(p) && playedIds.has(p.id));
  bench.sort((a, b) => (lines.find((l) => l.id === b.id)?.sec ?? 0) - (lines.find((l) => l.id === a.id)?.sec ?? 0));
  return [...st, ...bench];
}

function drawBox(c: CanvasRenderingContext2D, x: Ctx, side: 0 | 1, evIdx: number, x0: number): void {
  const t = teamOf(x, side);
  const col = x.colors[side];
  const rows = rosterOrder(x, side);
  const y0 = 240;
  const rowH = 27;
  const h = 76 + rows.length * rowH + 30;
  const w = 440;
  c.save();
  c.fillStyle = 'rgba(10,16,30,0.86)';
  rr(c, x0, y0, w, h, 10);
  c.fill();
  c.fillStyle = col;
  c.fillRect(x0, y0, w, 4);
  c.font = `800 28px ${COND}`;
  c.fillStyle = '#fff';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText(t.city, x0 + 16, y0 + 28);
  const cols = ['MIN', 'PTS', 'FG', 'REB', 'AST', 'PF'];
  const cx = [228, 268, 322, 366, 400, 430];
  c.font = `700 13px ${SANS}`;
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.textAlign = 'right';
  cols.forEach((k, i) => c.fillText(k, x0 + cx[i], y0 + 60));
  const on = evIdx >= 0 ? x.snaps.on[evIdx][side] : [];
  const subs = evIdx >= 0 ? x.snaps.lastSub[evIdx] : new Map();
  const startersN = rows.filter((p) => (side === 0 ? x.tf.result.home : x.tf.result.away).lines.find((l) => l.id === p.id)?.started).length;
  rows.forEach((p, i) => {
    const y = y0 + 84 + i * rowH + (i >= startersN ? 18 : 0);
    if (i === startersN) {
      c.font = `700 12px ${SANS}`;
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.textAlign = 'left';
      c.fillText('BENCH', x0 + 16, y - 16);
    }
    if (i === 0) {
      c.font = `700 12px ${SANS}`;
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.textAlign = 'left';
      c.fillText('STARTERS', x0 + 16, y - 16 + 0);
    }
    const isOn = on.includes(p.id);
    if (isOn) {
      c.fillStyle = 'rgba(255,255,255,0.07)';
      c.fillRect(x0 + 6, y - rowH / 2 + 1, w - 12, rowH - 2);
      c.fillStyle = col;
      c.fillRect(x0 + 6, y - rowH / 2 + 1, 4, rowH - 2);
    }
    c.textAlign = 'left';
    c.font = `600 13px ${SANS}`;
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.fillText(p.jersey, x0 + 18, y);
    c.font = `${isOn ? 700 : 500} 16px ${SANS}`;
    c.fillStyle = isOn ? '#fff' : 'rgba(232,238,248,0.62)';
    c.fillText(p.short, x0 + 50, y);
    const tag = subs.get(p.id);
    if (tag) {
      const tw = 36;
      const tx = x0 + 50 + c.measureText(p.short).width + 8;
      c.fillStyle = tag === 'in' ? '#f2c94c' : 'rgba(255,255,255,0.25)';
      rr(c, tx, y - 9, tw, 18, 3);
      c.fill();
      c.fillStyle = '#111';
      c.font = `800 12px ${COND}`;
      c.textAlign = 'center';
      c.fillText(tag.toUpperCase(), tx + tw / 2, y + 1);
    }
    const g = (k: Parameters<typeof get>[3]) => get(x.snaps, evIdx, p.id, k);
    const vals = [String(Math.floor(g('min'))), String(g('pts')), `${g('fgm')}-${g('fga')}`, String(g('oreb') + g('dreb')), String(g('ast')), String(g('pf'))];
    c.textAlign = 'right';
    vals.forEach((v, k) => {
      c.font = `${k === 1 ? 700 : 500} 15px ${SANS}`;
      c.fillStyle = isOn ? (k === 1 ? '#fff' : 'rgba(255,255,255,0.85)') : 'rgba(232,238,248,0.55)';
      if (k === 5 && Number(v) >= 5) c.fillStyle = '#f87171';
      c.fillText(v, x0 + cx[k], y);
    });
  });
  c.restore();
}

// ------------------------------------------------------------------ bandeau de commentaire
function drawTicker(c: CanvasRenderingContext2D, x: Ctx, tau: number, evIdx: number): void {
  const ev = x.tf.result.events;
  let poss: (typeof ev)[number] | undefined;
  for (let i = evIdx; i >= 0; i--) if (ev[i].type === 'poss') {
    poss = ev[i];
    break;
  }
  // Dernier évènement "parlant" (tir, LF, rebond, perte, faute) de la possession en cours.
  let last: (typeof ev)[number] | undefined;
  for (let i = evIdx; i >= 0; i--) {
    const e = ev[i];
    if (e.type === 'poss') break;
    if (['shot', 'ft', 'reb', 'tov', 'foul', 'timeout', 'sub'].includes(e.type)) {
      last = last ?? e;
      if (e.type === 'shot' || e.type === 'tov' || e.type === 'ft') {
        // Combine tir raté + rebond : « X misses a three, Y rebound ».
        const nxt = last !== e ? last : undefined;
        if (e.type === 'shot' && !e.made && nxt?.type === 'reb') last = { ...e, text: `${e.text}, ${nxt.text.replace(/ (offensive|defensive) rebound/, (m) => (m.includes('offensive') ? ' offensive rebound' : ' rebound'))}` };
        else last = e;
        break;
      }
    }
  }
  const y = 960;
  if (!poss) return;
  const side = poss.side as 0 | 1;
  const t = teamOf(x, side);
  const col = x.colors[side];
  c.save();
  const leftW = 330;
  const text = last?.text ?? '';
  c.font = `600 34px ${SANS}`;
  const tw = Math.min(980, c.measureText(text).width);
  const badge = last?.type === 'shot' && last.made ? `+${last.pts}` : last?.type === 'ft' && (last.pts ?? 0) > 0 ? `+${last.pts}` : '';
  const total = leftW + 30 + tw + (badge ? 70 : 0);
  const x0 = W / 2 - total / 2;
  c.fillStyle = 'rgba(8,12,22,0.88)';
  rr(c, x0, y - 34, leftW, 68, 8);
  c.fill();
  c.fillStyle = col;
  c.fillRect(x0, y - 34, 6, 68);
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.font = `italic 800 40px ${COND}`;
  c.fillStyle = lighten(col.startsWith('#') ? col : '#8899aa', 0.35);
  const label = `${t.name.toUpperCase()} BALL`;
  c.fillText(label, x0 + 22, y + 1);
  const lw = c.measureText(label).width;
  c.font = `600 18px ${SANS}`;
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.fillText(poss.kind ?? '', x0 + 30 + lw, y + 3);
  // Texte.
  const xt = x0 + leftW + 30;
  c.fillStyle = col;
  c.fillRect(xt - 14, y - 26, 4, 52);
  c.font = `600 34px ${SANS}`;
  c.fillStyle = '#fff';
  c.fillText(text, xt, y + 1, 980);
  if (badge) {
    const bx = xt + tw + 18;
    c.fillStyle = '#fff';
    c.save();
    c.translate(bx + 26, y);
    c.transform(1, 0, -0.18, 1, 0, 0);
    rr(c, -26, -22, 52, 44, 4);
    c.fill();
    c.restore();
    c.fillStyle = '#111';
    c.font = `800 30px ${COND}`;
    c.textAlign = 'center';
    c.fillText(badge, bx + 26, y + 2);
  }
  c.restore();
  void tau;
}

function drawFooter(c: CanvasRenderingContext2D, x: Ctx): void {
  c.save();
  c.font = `800 26px ${COND}`;
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText('◉ SimLab', 40, 1040);
  c.font = `500 15px ${SANS}`;
  c.fillStyle = 'rgba(255,255,255,0.45)';
  c.textAlign = 'right';
  c.fillText(`Simulated game, not a prediction · sim ${(x.tf.index + 1).toLocaleString('en-US')} of ${x.tf.n.toLocaleString('en-US')}`, W - 40, 1040);
  c.restore();
}

// ------------------------------------------------------------------ écrans plein cadre
function overlay(c: CanvasRenderingContext2D, a: number): void {
  c.fillStyle = `rgba(6,10,19,${a})`;
  c.fillRect(0, 0, W, H);
}

function drawScreens(c: CanvasRenderingContext2D, x: Ctx, tau: number, evIdx: number): void {
  const b = activeBanner(x.tl, tau, (q) => q.kind === 'screen');
  if (!b) return;
  const fade = b.screen === 'intro' ? Math.min(1, (b.tau1 - tau) / 0.5) : Math.min(1, (tau - b.tau0) / 0.35, (b.tau1 - tau) / 0.35);
  c.save();
  c.globalAlpha = Math.max(0, fade);
  const ev = x.tf.result.events;
  const e = evIdx >= 0 ? ev[evIdx] : undefined;
  if (b.screen === 'intro') {
    overlay(c, 0.9);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `600 30px ${SANS}`;
    c.fillStyle = 'rgba(255,255,255,0.65)';
    c.fillText(`We simulated this game ${x.tf.n.toLocaleString('en-US')} times`, W / 2, 230);
    c.font = `italic 800 110px ${COND}`;
    c.fillStyle = lighten(x.colors[1].startsWith('#') ? x.colors[1] : '#8899aa', 0.2);
    c.textAlign = 'right';
    c.fillText(x.tf.teams.away.name.toUpperCase(), W / 2 - 60, 360);
    c.fillStyle = lighten(x.colors[0].startsWith('#') ? x.colors[0] : '#8899aa', 0.2);
    c.textAlign = 'left';
    c.fillText(x.tf.teams.home.name.toUpperCase(), W / 2 + 60, 360);
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = `800 60px ${COND}`;
    c.fillText('@', W / 2, 362);
    c.font = `600 28px ${SANS}`;
    c.fillStyle = '#f2c94c';
    c.fillText("Here's the most typical game", W / 2, 460);
    // Cinq de départ.
    for (const side of [1, 0] as const) {
      const lines = (side === 0 ? x.tf.result.home : x.tf.result.away).lines.filter((l) => l.started);
      const xs = side === 1 ? W / 2 - 330 : W / 2 + 330;
      c.font = `700 16px ${SANS}`;
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.fillText('STARTERS', xs, 540);
      lines.forEach((l, i) => {
        const p = x.info.get(l.id);
        if (!p) return;
        c.font = `600 28px ${SANS}`;
        c.fillStyle = '#fff';
        c.fillText(`${p.jersey}  ${p.name}`, xs, 585 + i * 44);
      });
    }
    const outs = x.tf.players.filter((p) => p.status.toLowerCase().startsWith('out'));
    if (outs.length) {
      c.font = `500 20px ${SANS}`;
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.fillText(`Out: ${outs.map((p) => p.short).join(', ')}`, W / 2, 860);
    }
  } else if (b.screen === 'quarter' || b.screen === 'half') {
    overlay(c, 0.72);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `italic 800 64px ${COND}`;
    c.fillStyle = '#f2c94c';
    c.fillText(b.screen === 'half' ? 'HALFTIME' : `END OF Q${b.period}`, W / 2, 330);
    c.font = `800 120px ${COND}`;
    c.fillStyle = '#fff';
    c.fillText(`${e?.as ?? 0}  –  ${e?.hs ?? 0}`, W / 2, 460);
    c.font = `700 30px ${COND}`;
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillText(`${x.tf.teams.away.name.toUpperCase()}                    ${x.tf.teams.home.name.toUpperCase()}`, W / 2, 545);
    quarterTable(c, x, W / 2, 620, b.period ?? 4);
    if (b.screen === 'half') leaders(c, x, evIdx, 760);
  } else if (b.screen === 'final') {
    overlay(c, 0.94);
    finalScreen(c, x);
  } else if (b.screen === 'box') {
    overlay(c, 0.96);
    finalBox(c, x);
  } else if (b.screen === 'summary') {
    overlay(c, 0.97);
    summaryScreen(c, x);
  }
  c.restore();
}

function quarterTable(c: CanvasRenderingContext2D, x: Ctx, cx: number, y: number, upto: number): void {
  const qa = x.tf.result.away.q;
  const qh = x.tf.result.home.q;
  const n = Math.min(upto, qa.length);
  c.textAlign = 'center';
  for (let q = 0; q < n; q++) {
    const xx = cx + (q - (n - 1) / 2) * 70;
    c.font = `700 18px ${SANS}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText(q < 4 ? `Q${q + 1}` : `OT${q - 3}`, xx, y);
    c.font = `800 30px ${COND}`;
    c.fillStyle = lighten(x.colors[1].startsWith('#') ? x.colors[1] : '#8899aa', 0.3);
    c.fillText(String(qa[q]), xx, y + 36);
    c.fillStyle = '#fff';
    c.fillText(String(qh[q]), xx, y + 70);
  }
}

function leaders(c: CanvasRenderingContext2D, x: Ctx, evIdx: number, y: number): void {
  for (const side of [1, 0] as const) {
    const ids = x.tf.players.filter((p) => p.side === side).map((p) => p.id);
    const best = (k: 'pts' | 'oreb' | 'ast') =>
      ids.map((id) => [id, k === 'oreb' ? get(x.snaps, evIdx, id, 'oreb') + get(x.snaps, evIdx, id, 'dreb') : get(x.snaps, evIdx, id, k)] as const).sort((a, b) => b[1] - a[1])[0];
    const xs = side === 1 ? W / 2 - 360 : W / 2 + 360;
    const lines = [['PTS', best('pts')], ['REB', best('oreb')], ['AST', best('ast')]] as const;
    lines.forEach(([lab, [id, v]], i) => {
      c.font = `600 24px ${SANS}`;
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.fillText(`${lab}  ${x.info.get(id)?.short ?? ''}  ${v}`, xs, y + i * 40);
    });
  }
}

function finalScreen(c: CanvasRenderingContext2D, x: Ctx): void {
  const r = x.tf.result;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `italic 800 48px ${COND}`;
  c.fillStyle = '#f2c94c';
  c.fillText('FINAL', W / 2, 200);
  c.font = `italic 800 92px ${COND}`;
  c.textAlign = 'right';
  c.fillStyle = lighten(x.colors[1].startsWith('#') ? x.colors[1] : '#8899aa', 0.25);
  c.fillText(x.tf.teams.away.name.toUpperCase(), W / 2 - 240, 320);
  c.textAlign = 'left';
  c.fillStyle = lighten(x.colors[0].startsWith('#') ? x.colors[0] : '#8899aa', 0.25);
  c.fillText(x.tf.teams.home.name.toUpperCase(), W / 2 + 240, 320);
  c.textAlign = 'center';
  c.font = `800 150px ${COND}`;
  c.fillStyle = r.away.pts > r.home.pts ? '#fff' : 'rgba(255,255,255,0.55)';
  c.fillText(String(r.away.pts), W / 2 - 120, 318);
  c.fillStyle = r.home.pts > r.away.pts ? '#fff' : 'rgba(255,255,255,0.55)';
  c.fillText(String(r.home.pts), W / 2 + 120, 318);
  quarterTable(c, x, W / 2, 440, r.away.q.length);
  // Courbe de probabilité de victoire, chaque possession.
  const ev = r.events;
  const series = ev.filter((e) => e.type === 'poss' || e.type === 'end').map((e) => e.wp ?? 0.5);
  const gx0 = 560;
  const gx1 = 1360;
  const gy = 690;
  const gh = 90;
  c.font = `600 20px ${SANS}`;
  c.textAlign = 'left';
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.fillText('Win probability, every possession', gx0, gy - gh - 30);
  const hiH = Math.max(...series);
  const loH = Math.min(...series);
  c.textAlign = 'right';
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.fillText(`${x.tf.teams.home.name}: ${Math.round((series[0] ?? 0.5) * 100)}% at the tip · low ${Math.round(loH * 100)}% · high ${Math.round(hiH * 100)}%`, gx1, gy - gh - 30);
  c.strokeStyle = 'rgba(255,255,255,0.2)';
  c.setLineDash([4, 6]);
  c.beginPath();
  c.moveTo(gx0, gy);
  c.lineTo(gx1, gy);
  c.stroke();
  c.setLineDash([]);
  c.beginPath();
  series.forEach((v, i) => {
    const px = gx0 + ((gx1 - gx0) * i) / Math.max(1, series.length - 1);
    const py = gy - (v - 0.5) * 2 * gh;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  });
  c.strokeStyle = '#fff';
  c.lineWidth = 2;
  c.stroke();
  c.lineTo(gx1, gy);
  c.lineTo(gx0, gy);
  c.closePath();
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.fill();
  if (x.tf.actual) {
    c.font = `500 20px ${SANS}`;
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText(`Real result: ${x.tf.teams.away.tri} ${x.tf.actual.away} – ${x.tf.teams.home.tri} ${x.tf.actual.home}`, W / 2, 860);
  }
}

function finalBox(c: CanvasRenderingContext2D, x: Ctx): void {
  const cols = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'STL', 'BLK', 'PF'];
  const r = x.tf.result;
  const halves: Array<[0 | 1, number]> = [[1, 40], [0, 990]];
  for (const [side, x0] of halves) {
    const t = teamOf(x, side);
    const res = side === 0 ? r.home : r.away;
    const w = 890;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.font = `800 34px ${COND}`;
    c.fillStyle = '#fff';
    c.fillText(`${t.city} ${t.name}`, x0, 150);
    c.textAlign = 'right';
    c.font = `800 56px ${COND}`;
    c.fillText(String(res.pts), x0 + w, 148);
    c.fillStyle = x.colors[side];
    c.fillRect(x0, 180, w, 3);
    const cx = cols.map((_, i) => x0 + 330 + i * 56);
    c.font = `700 14px ${SANS}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    cols.forEach((k, i) => c.fillText(k, cx[i], 205));
    const lines = res.lines.filter((l) => l.played).sort((a, b) => Number(b.started) - Number(a.started) || b.sec - a.sec);
    lines.forEach((l, i) => {
      const y = 240 + i * 38 + (l.started ? 0 : 20);
      const p = x.info.get(l.id);
      c.textAlign = 'left';
      c.font = `500 15px ${SANS}`;
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillText(p?.jersey ?? '', x0, y);
      c.font = `600 19px ${SANS}`;
      c.fillStyle = '#fff';
      c.fillText(p?.short ?? String(l.id), x0 + 40, y);
      const v = [Math.round(l.sec / 60), l.pts, `${l.fgm}-${l.fga}`, `${l.fg3m}-${l.fg3a}`, `${l.ftm}-${l.fta}`, l.oreb + l.dreb, l.ast, l.stl, l.blk, l.pf];
      c.textAlign = 'right';
      v.forEach((val, k) => {
        c.font = `${k === 1 ? 700 : 500} 18px ${SANS}`;
        c.fillStyle = k === 1 ? '#fff' : 'rgba(255,255,255,0.8)';
        c.fillText(String(val), cx[k], y);
      });
    });
    const y = 240 + lines.length * 38 + 40;
    const sum = (k: 'fgm' | 'fga' | 'fg3m' | 'fg3a' | 'ftm' | 'fta' | 'oreb' | 'dreb' | 'ast' | 'stl' | 'blk' | 'pf') => res.lines.reduce((a, l) => a + l[k], 0);
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.fillRect(x0, y - 22, w, 1);
    c.textAlign = 'left';
    c.font = `700 17px ${SANS}`;
    c.fillStyle = '#fff';
    c.fillText('TOTALS', x0 + 40, y);
    const tv = ['', res.pts, `${sum('fgm')}-${sum('fga')}`, `${sum('fg3m')}-${sum('fg3a')}`, `${sum('ftm')}-${sum('fta')}`, sum('oreb') + sum('dreb'), sum('ast'), sum('stl'), sum('blk'), sum('pf')];
    c.textAlign = 'right';
    tv.forEach((val, k) => c.fillText(String(val), cx[k], y));
  }
  c.font = `500 15px ${SANS}`;
  c.textAlign = 'center';
  c.fillStyle = 'rgba(255,255,255,0.4)';
  c.fillText('Simulated game, not a real result · built from NBA play-by-play, tracking and Synergy data', W / 2, 1020);
}

function summaryScreen(c: CanvasRenderingContext2D, x: Ctx): void {
  const s = x.summary;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `600 30px ${SANS}`;
  c.fillStyle = 'rgba(255,255,255,0.65)';
  c.fillText(`Across all ${x.tf.n.toLocaleString('en-US')} sims`, W / 2, 250);
  if (!s) return;
  const big = (v: string, label: string, cx: number, col: string) => {
    c.font = `800 150px ${COND}`;
    c.fillStyle = col;
    c.fillText(v, cx, 380);
    c.font = `600 26px ${SANS}`;
    c.fillStyle = '#fff';
    c.fillText(label, cx, 480);
  };
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  big(pct(s.pAway), `${x.tf.teams.away.city} wins`, W / 2 - 480, s.pAway > s.pHome ? lighten(x.colors[1].startsWith('#') ? x.colors[1] : '#8899aa', 0.3) : '#fff');
  big(pct(s.pHome), `${x.tf.teams.home.city} wins`, W / 2, s.pHome > s.pAway ? lighten(x.colors[0].startsWith('#') ? x.colors[0] : '#8899aa', 0.3) : '#fff');
  const line = s.market?.total ?? Math.round(s.total.p50) + 0.5;
  const pOver = s.market?.pOver ?? s.totalLadder.find((l) => l.line === line)?.pOver ?? 0.5;
  big(pct(pOver), `Over ${line}`, W / 2 + 480, '#fff');
  c.font = `500 26px ${SANS}`;
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.fillText(`Average score: ${x.tf.teams.away.city} ${s.awayPts.mean.toFixed(1)}, ${x.tf.teams.home.city} ${s.homePts.mean.toFixed(1)}`, W / 2, 580);
  if (s.market?.bookHome != null) {
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText(`The books at the tip: ${x.tf.teams.home.city} ${pct(s.market.bookHome)}`, W / 2, 625);
  }
  const leans = s.props.filter((p) => (p.edge ?? 0) > 0.03 && p.confidence !== 'faible' && p.pLean != null).slice(0, 3);
  if (leans.length) {
    c.font = `600 22px ${SANS}`;
    c.fillStyle = '#f2c94c';
    c.fillText('Leans', W / 2, 700);
    c.font = `500 22px ${SANS}`;
    c.fillStyle = '#fff';
    leans.forEach((l, i) => c.fillText(`${l.player} ${l.lean} ${l.line} ${l.market.replace('Total ', '').toLowerCase()} (${pct(l.pLean!)})`, W / 2, 740 + i * 36));
  }
  c.font = `800 46px ${COND}`;
  c.fillStyle = '#fff';
  c.fillText('◉ SimLab', W / 2, 900);
}

export { rimScreen };
