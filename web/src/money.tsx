// « Où va l'argent » : la cote du favori Razzia depuis l'ouverture. Si elle baisse, les parieurs misent sur lui (le
// marché rejoint Razzia) ; si elle monte, l'argent part sur l'adversaire.
import { useId } from 'react';

export interface MoneyPoint {
  label: string; // « Ouverture », « Simulation », « Maintenant », ou une heure
  odds: number; // cote décimale du favori
}

const dec = (v: number) => v.toFixed(2).replace('.', ',');

export function MoneyFlow({ fav, other, points }: { fav: string; other: string; points: MoneyPoint[] }) {
  const id = `money-${useId().replace(/:/g, '')}`;
  if (points.length < 2) return null;
  const first = points[0].odds, last = points[points.length - 1].odds;
  const lo = Math.min(...points.map((p) => p.odds)), hi = Math.max(...points.map((p) => p.odds));
  const pad = Math.max(0.02, (hi - lo) * 0.25);
  const W = 400, H = 90;
  // Cote qui baisse = courbe qui monte : l'axe est inversé pour lire « l'argent arrive » vers le haut.
  const y = (o: number) => 8 + ((o - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 16);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.odds).toFixed(1)}`).join(' ');
  const toFav = last < first - 0.005, away = last > first + 0.005;
  const verdict = toFav ? `L'argent va sur ${fav}` : away ? `L'argent part sur ${other}` : 'Cote stable';
  const labels = points.length <= 4 ? points.map((p) => p.label) : [points[0].label, points[Math.floor(points.length / 2)].label, points[points.length - 1].label];
  return (
    <div className="money">
      <div className="money-top">
        <div>
          <p className="money-k">Cote {fav}</p>
          <p className="money-v">
            {dec(last)}
            {(toFav || away) && <span className={toFav ? 'up' : 'down'}>{`${toFav ? '↓' : '↑'} depuis ${dec(first)}`}</span>}
          </p>
        </div>
        <span className={`money-tag${toFav ? ' up' : away ? ' down' : ''}`}>{verdict}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Cote de ${fav} : ${points.map((p) => `${p.label} ${dec(p.odds)}`).join(', ')}`}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2272e0" stopOpacity="0.35" />
            <stop offset="1" stopColor="#2272e0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${pts} ${W},${H} 0,${H}`} fill={`url(#${id})`} />
        <polyline points={pts} className="money-line" />
      </svg>
      <div className="money-axis mono">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}
