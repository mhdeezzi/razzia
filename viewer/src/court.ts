// Terrain en perspective : homographie du rectangle 94×50 pieds vers un trapèze à l'écran.

export type Pt = [number, number];
export type H = number[]; // matrice 3x3 aplatie

/** Résout l'homographie qui envoie 4 points sources sur 4 points destination. */
export function homography(src: Pt[], dst: Pt[]): H {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Élimination de Gauss.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [...h, 1];
}

export function project(Hm: H, x: number, y: number): Pt {
  const w = Hm[6] * x + Hm[7] * y + Hm[8];
  return [(Hm[0] * x + Hm[1] * y + Hm[2]) / w, (Hm[3] * x + Hm[4] * y + Hm[5]) / w];
}

/** Échelle locale (pixels par pied) au point du terrain, pour dimensionner jetons et ballon. */
export function localScale(Hm: H, x: number, y: number): number {
  const a = project(Hm, x, y);
  const b = project(Hm, x + 1, y);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export interface CourtView {
  H: H;
  rect: { x: number; y: number; w: number; h: number };
}

export function makeView(cx: number, top: number, bottom: number, topHalfW: number, botHalfW: number): CourtView {
  const Hm = homography(
    [[0, 0], [94, 0], [94, 50], [0, 50]],
    [[cx - topHalfW, top], [cx + topHalfW, top], [cx + botHalfW, bottom], [cx - botHalfW, bottom]],
  );
  return { H: Hm, rect: { x: cx - botHalfW, y: top, w: botHalfW * 2, h: bottom - top } };
}

function path(ctx: CanvasRenderingContext2D, Hm: H, pts: Pt[], close = false): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const [u, v] = project(Hm, x, y);
    if (i === 0) ctx.moveTo(u, v);
    else ctx.lineTo(u, v);
  });
  if (close) ctx.closePath();
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Dessine parquet, lignes, raquettes, arcs à 3 pts, paniers. */
export function drawCourt(ctx: CanvasRenderingContext2D, v: CourtView, colors: { home: string; away: string }): void {
  const Hm = v.H;
  // Plateau (débord autour du terrain).
  ctx.save();
  path(ctx, Hm, [[-6, -5], [100, -5], [100, 55], [-6, 55]], true);
  const edge = ctx.createLinearGradient(0, v.rect.y, 0, v.rect.y + v.rect.h);
  edge.addColorStop(0, '#2a1a10');
  edge.addColorStop(1, '#3a2414');
  ctx.fillStyle = edge;
  ctx.fill();

  // Parquet.
  path(ctx, Hm, [[0, 0], [94, 0], [94, 50], [0, 50]], true);
  const wood = ctx.createLinearGradient(0, v.rect.y, 0, v.rect.y + v.rect.h);
  wood.addColorStop(0, '#4a3020');
  wood.addColorStop(1, '#5e3c26');
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.clip();
  // Lames de parquet.
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= 50; y += 1.25) {
    path(ctx, Hm, [[0, y], [94, y]]);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,220,180,0.035)';
  for (let x = 0; x <= 94; x += 6) {
    path(ctx, Hm, [[x, 0], [x, 50]]);
    ctx.stroke();
  }
  // Raquettes teintées.
  for (const [bx, dir, col] of [[0, 1, colors.home], [94, -1, colors.away]] as const) {
    path(ctx, Hm, [[bx, 17], [bx + dir * 19, 17], [bx + dir * 19, 33], [bx, 33]], true);
    ctx.fillStyle = 'rgba(10,10,14,0.55)';
    ctx.fill();
    ctx.fillStyle = col + '22';
    ctx.fill();
  }
  // Rond central teinté.
  path(ctx, Hm, arc(47, 25, 6, 0, Math.PI * 2), true);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fill();
  ctx.restore();

  // Lignes.
  ctx.save();
  ctx.strokeStyle = 'rgba(245,240,230,0.92)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  path(ctx, Hm, [[0, 0], [94, 0], [94, 50], [0, 50]], true);
  ctx.stroke();
  path(ctx, Hm, [[47, 0], [47, 50]]);
  ctx.stroke();
  path(ctx, Hm, arc(47, 25, 6, 0, Math.PI * 2), true);
  ctx.stroke();
  path(ctx, Hm, arc(47, 25, 2, 0, Math.PI * 2), true);
  ctx.stroke();
  for (const [bx, dir] of [[0, 1], [94, -1]] as const) {
    const hx = bx + dir * 5.25; // centre du panier
    // Raquette.
    path(ctx, Hm, [[bx, 17], [bx + dir * 19, 17], [bx + dir * 19, 33], [bx, 33]]);
    ctx.stroke();
    // Cercle des lancers (moitié pleine, moitié pointillée).
    const ftx = bx + dir * 19;
    path(ctx, Hm, arc(ftx, 25, 6, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : (3 * Math.PI) / 2));
    ctx.stroke();
    ctx.setLineDash([6, 6]);
    path(ctx, Hm, arc(ftx, 25, 6, dir > 0 ? Math.PI / 2 : -Math.PI / 2, dir > 0 ? (3 * Math.PI) / 2 : Math.PI / 2));
    ctx.stroke();
    ctx.setLineDash([]);
    // Zone restrictive.
    path(ctx, Hm, arc(hx, 25, 4, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : (3 * Math.PI) / 2));
    ctx.stroke();
    // Ligne à 3 pts : corners à 22 pieds, arc de 23,75 pieds.
    const yc = 25 - 22;
    const ang = Math.asin(22 / 23.75);
    const xk = Math.sqrt(23.75 ** 2 - 22 ** 2);
    path(ctx, Hm, [[bx, yc], [hx + dir * xk, yc]]);
    ctx.stroke();
    path(ctx, Hm, [[bx, 50 - yc], [hx + dir * xk, 50 - yc]]);
    ctx.stroke();
    const a0 = dir > 0 ? -ang : Math.PI - ang;
    const a1 = dir > 0 ? ang : Math.PI + ang;
    path(ctx, Hm, arc(hx, 25, 23.75, a0, a1, 64));
    ctx.stroke();
    // Panneau et cercle.
    ctx.lineWidth = 3;
    path(ctx, Hm, [[bx + dir * 4, 22], [bx + dir * 4, 28]]);
    ctx.stroke();
    ctx.lineWidth = 2;
  }
  ctx.restore();
}

/** Panier en relief (support, panneau, arceau) — dessiné au-dessus des joueurs du fond. */
export function drawHoop(ctx: CanvasRenderingContext2D, v: CourtView, side: 'left' | 'right', glow = 0): void {
  const dir = side === 'left' ? 1 : -1;
  const bx = side === 'left' ? 0 : 94;
  const hx = bx + dir * 5.25;
  const [rx, ry] = project(v.H, hx, 25);
  const s = localScale(v.H, hx, 25);
  const lift = 10 * s; // hauteur visuelle de l'arceau
  const [bbx, bby] = project(v.H, bx + dir * 4, 25);
  ctx.save();
  // Support.
  ctx.strokeStyle = '#9aa7bd';
  ctx.lineWidth = Math.max(2, s * 0.35);
  const [px, py] = project(v.H, bx - dir * 3, 25);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - lift * 1.05);
  ctx.lineTo(bbx, bby - lift * 1.05);
  ctx.stroke();
  // Panneau.
  ctx.fillStyle = 'rgba(220,235,255,0.25)';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  const bw = 3 * s;
  ctx.beginPath();
  ctx.rect(bbx - 0.4 * s, bby - lift - bw * 0.9, 0.8 * s, bw * 1.3);
  ctx.fill();
  ctx.stroke();
  // Arceau.
  ctx.strokeStyle = glow > 0 ? `rgba(255,170,60,${0.6 + 0.4 * glow})` : '#ff7a1a';
  ctx.lineWidth = Math.max(2, s * 0.3);
  ctx.beginPath();
  ctx.ellipse(rx, ry - lift, 0.9 * s, 0.45 * s, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Filet.
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {
    ctx.moveTo(rx + i * 0.4 * s, ry - lift + 0.3 * s);
    ctx.lineTo(rx + i * 0.25 * s, ry - lift + 1.5 * s);
  }
  ctx.stroke();
  ctx.restore();
}

export function rimScreen(v: CourtView, side: 'left' | 'right'): Pt {
  const hx = side === 'left' ? 5.25 : 88.75;
  const [rx, ry] = project(v.H, hx, 25);
  return [rx, ry - 10 * localScale(v.H, hx, 25)];
}
