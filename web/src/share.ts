// Partage d'un ticket en image, aux couleurs de Razzia : story Instagram (1080 × 1920) ou post X (1600 × 900).
// Dessiné sur un canvas (fond marbre, logo, sélections, mise, cote, gain). Sur téléphone, la feuille de partage du
// système propose Instagram et X ; sinon l'image est téléchargée et X s'ouvre avec le texte prêt.
import logoUrl from './assets/razzia-logo.webp';
import { ticketState, type LegStatus, type Ticket } from './suivi.ts';

export type ShareFormat = 'story' | 'post';
const SITE = 'https://simbet-mu.vercel.app';
const C = { green: '#3dd68c', red: '#e2232b', orange: '#f5a524', white: '#f4f4f2', grey: '#a3a3a8', dim: '#74747a' };
const dec = (v: number) => v.toFixed(2).replace('.', ',');
const eur = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const img = (src: string) =>
  new Promise<HTMLImageElement>((ok, ko) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => ok(i);
    i.onerror = ko;
    i.src = src;
  });

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** L'image du ticket. */
export async function ticketImage(t: Ticket, live: Record<string, LegStatus>, format: ShareFormat): Promise<Blob> {
  const story = format === 'story';
  const W = story ? 1080 : 1600, H = story ? 1920 : 900;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  await Promise.all(['900 120px "Archivo Variable"', '600 40px "Geist Variable"', '500 40px "Geist Mono Variable"'].map((f) => document.fonts.load(f).catch(() => undefined)));
  const [bg, logo] = await Promise.all([img('/share/marbre-nuit.jpg').catch(() => undefined), img(logoUrl)]);
  // Fond : marbre en plein cadre, assombri vers le bas pour la lisibilité.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (bg) {
    const s = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0.25)');
  shade.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  const ls = t.legs.map((l) => (l.status === 'won' || l.status === 'lost' || l.status === 'void' ? l.status : live[l.key] ?? l.status ?? 'pending'));
  const state: LegStatus = t.status === 'won' || t.status === 'lost' ? t.status : ticketState(ls);
  const pad = story ? 80 : 90;
  // En-tête : logo en haut à gauche.
  const lw = story ? 260 : 170;
  ctx.drawImage(logo, pad, story ? pad - 10 : 56, lw, (lw * logo.height) / logo.width);
  // Hauteur de la carte : le post X réduit les lignes pour que la carte tienne au-dessus du bas de l'image.
  const rowH = story ? 120 : Math.max(64, Math.min(92, (H - 70 - 300 - 280) / t.legs.length));
  const cardH = 110 + t.legs.length * rowH + (story ? 210 : 170);
  // Story : titre et carte centrés dans la hauteur libre entre le logo et la signature.
  const top = story ? Math.max(0, Math.round((1700 - 520 - cardH) / 2) - 60) : 0;
  const big = (txt: string, x: number, y: number, size: number, color = C.white) => {
    ctx.font = `900 ${size}px "Archivo Variable", sans-serif`;
    (ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = 'condensed';
    ctx.fillStyle = color;
    ctx.fillText(txt.toUpperCase(), x, y);
  };
  const text = (txt: string, x: number, y: number, size: number, color: string, weight = 500, font = 'Geist Variable') => {
    ctx.font = `${weight} ${size}px "${font}", sans-serif`;
    (ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = 'normal';
    ctx.fillStyle = color;
    ctx.fillText(txt, x, y);
  };
  const headline = state === 'won' ? 'Ticket gagné.' : state === 'lost' ? 'Pas cette fois.' : 'Mon ticket du soir.';
  big(headline, pad, story ? 420 + top : 250, story ? 132 : 96, state === 'won' ? C.green : C.white);

  // Carte du ticket.
  const cardX = pad, cardW = story ? W - 2 * pad : 900, cardY = story ? 520 + top : 300;
  rounded(ctx, cardX, cardY, cardW, cardH, 36);
  ctx.fillStyle = 'rgba(6,6,8,0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const ip = 44;
  text(t.kind === 'combine' ? `Combiné · ${t.legs.length} sélections` : 'Simple', cardX + ip, cardY + 76, story ? 38 : 32, C.white, 650);
  const stTxt = state === 'won' ? 'Gagné' : state === 'lost' ? 'Perdu' : 'En cours';
  const stCol = state === 'won' ? C.green : state === 'lost' ? C.red : C.orange;
  ctx.font = `600 ${story ? 32 : 28}px "Geist Variable", sans-serif`;
  const sw = ctx.measureText(stTxt).width + 40;
  rounded(ctx, cardX + cardW - ip - sw, cardY + 36, sw, story ? 58 : 52, 14);
  ctx.strokeStyle = stCol;
  ctx.stroke();
  text(stTxt, cardX + cardW - ip - sw + 20, cardY + (story ? 76 : 71), story ? 32 : 28, stCol, 600);
  // Sélections : rond d'état, pari, match, cote.
  t.legs.forEach((l, i) => {
    const y = cardY + 110 + i * rowH;
    const s = ls[i];
    const cx = cardX + ip + 22, cy = y + rowH / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    if (s === 'won' || s === 'lost') {
      ctx.fillStyle = s === 'won' ? C.green : C.red;
      ctx.fill();
      ctx.strokeStyle = s === 'won' ? '#04140c' : '#fff';
      ctx.lineWidth = 5;
      ctx.beginPath();
      if (s === 'won') {
        ctx.moveTo(cx - 10, cy);
        ctx.lineTo(cx - 3, cy + 8);
        ctx.lineTo(cx + 11, cy - 8);
      } else {
        ctx.moveTo(cx - 8, cy - 8);
        ctx.lineTo(cx + 8, cy + 8);
        ctx.moveTo(cx + 8, cy - 8);
        ctx.lineTo(cx - 8, cy + 8);
      }
      ctx.stroke();
    } else if (s === 'live') {
      ctx.fillStyle = C.orange;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    text(l.title, cx + 46, cy - 6, story ? 38 : 32, C.white, 650);
    text(`${l.match.awayName} – ${l.match.homeName}`, cx + 46, cy + (story ? 34 : 30), story ? 28 : 24, C.dim, 500);
    ctx.textAlign = 'right';
    text(l.odds ? dec(l.odds) : '-', cardX + cardW - ip, cy + 10, story ? 38 : 32, C.white, 600, 'Geist Mono Variable');
    ctx.textAlign = 'left';
    if (i > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(cx + 46, y, cardW - ip * 2 - 70, 2);
    }
  });
  // Ligne de suivi puis mise, cote, gain.
  const lineY = cardY + 110 + t.legs.length * rowH + 24;
  const segW = (cardW - ip * 2 - (t.legs.length - 1) * 8) / t.legs.length;
  ls.forEach((s, i) => {
    ctx.fillStyle = s === 'won' ? C.green : s === 'lost' ? C.red : s === 'live' ? C.orange : 'rgba(255,255,255,0.12)';
    rounded(ctx, cardX + ip + i * (segW + 8), lineY, segW, 6, 3);
    ctx.fill();
  });
  const fy = lineY + (story ? 80 : 66);
  const col = (label: string, val: string, x: number, color = C.white, size = story ? 48 : 40) => {
    text(label.toUpperCase(), x, fy, story ? 22 : 19, C.dim, 600);
    text(val, x, fy + (story ? 60 : 50), size, color, 650);
  };
  const gain = t.stake * t.odds;
  col('Mise', eur(t.stake), cardX + ip);
  col('Cote', dec(t.odds), cardX + ip + (story ? 300 : 250));
  col(state === 'won' ? 'Gain' : state === 'lost' ? 'Résultat' : 'Gain potentiel', state === 'lost' ? `−${eur(t.stake)}` : eur(gain), cardX + ip + (story ? 520 : 440), state === 'won' ? C.green : state === 'lost' ? C.red : C.white, story ? 60 : 48);

  // Signature : en bas de la story ; sur le post X, à droite sous l'accroche, pour laisser la hauteur à la carte.
  const sx = story ? pad : 1062, sy = story ? H - 150 : H - 120;
  if (!story) {
    big('25 000 matchs', 1060, 420, 78);
    big('avant le vrai.', 1060, 500, 78, 'rgba(255,255,255,0.55)');
    text('Simulé par Razzia', 1062, 560, 30, C.grey, 500);
  }
  text('razzia · simule avant de parier', sx, sy, story ? 34 : 28, C.white, 600);
  text(story ? 'simbet-mu.vercel.app · 18+ · jouer comporte des risques' : 'simbet-mu.vercel.app · 18+', sx, sy + (story ? 50 : 38), story ? 24 : 20, C.dim, 500);
  return new Promise((ok) => cv.toBlob((b) => ok(b!), 'image/png'));
}

/** Partage : feuille de partage du téléphone (Instagram, X...) ; sinon téléchargement et X ouvert avec le texte. */
export async function shareTicket(t: Ticket, live: Record<string, LegStatus>, format: ShareFormat): Promise<'shared' | 'downloaded'> {
  const blob = await ticketImage(t, live, format);
  const file = new File([blob], `razzia-ticket-${format}.png`, { type: 'image/png' });
  const msg = t.status === 'won' ? `Ticket gagné avec Razzia : cote ${dec(t.odds)}.` : `Mon ticket du soir, simulé avec Razzia : cote ${dec(t.odds)}.`;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `${msg} ${SITE}` });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (format === 'post') window.open(`https://x.com/intent/post?text=${encodeURIComponent(msg)}&url=${encodeURIComponent(SITE)}`, '_blank', 'noopener');
  return 'downloaded';
}
