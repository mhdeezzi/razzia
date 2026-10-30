// Fonds des bandeaux dessinés en WebGL (shaders Paper) : grille de points sur les programmes, marbre aux couleurs des
// deux camps sur les fiches. Chargés à part pour ne pas alourdir la première page ; le marbre reste figé si le système
// demande moins d'animations. Sans WebGL, le bandeau reste noir.
import { lazy, Suspense } from 'react';

const DotGrid = lazy(() => import('@paper-design/shaders-react').then((m) => ({ default: m.DotGrid })));
const Warp = lazy(() => import('@paper-design/shaders-react').then((m) => ({ default: m.Warp })));

const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: -1 } as const;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Grille de points verts, fixe : fond du bandeau des programmes. */
export function DotsBg() {
  return (
    <Suspense fallback={null}>
      <DotGrid style={fill} colorBack="#000000" colorFill="#2fb57c" colorStroke="#2fb57c" size={2} gapX={22} gapY={22} strokeWidth={0} sizeRange={0.6} opacityRange={0.8} shape="circle" />
    </Suspense>
  );
}

/** Marbre lent entre les deux couleurs (équipes, joueurs) : fond de l'en-tête d'une fiche. */
export function WarpBg({ c1, c2 }: { c1: string; c2: string }) {
  return (
    <Suspense fallback={null}>
      <Warp style={fill} colors={['#000000', toHex(c1), '#000000', toHex(c2)]} proportion={0.45} softness={1} distortion={0.25} swirl={0.6} swirlIterations={8} shape="checks" shapeScale={0.08} speed={still() ? 0 : 0.4} />
    </Suspense>
  );
}

/** Les shaders veulent du #rrggbb : conversion depuis hsl(h s% l%) (couleurs d'équipe éclaircies par glow()). */
function toHex(c: string) {
  const m = c.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
  if (!m) return c;
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
