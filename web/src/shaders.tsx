// Fond des bandeaux dessiné en WebGL (shader Paper) : marbre vert et bleu sur les programmes, aux couleurs des deux
// camps sur les fiches. Chargés à part pour ne pas alourdir la première page ; le marbre reste figé si le système
// demande moins d'animations. Sans WebGL, le bandeau reste noir.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const Warp = lazy(() => import('@paper-design/shaders-react').then((m) => ({ default: m.Warp })));

const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: -1 } as const;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Marbre lent entre deux couleurs : bandeau des programmes, en-tête d'une fiche (couleurs des équipes). */
// Le module est chargé dès le premier passage, pour ne plus attendre au changement de page.
const preload = () => void import('@paper-design/shaders-react');
if (typeof window !== 'undefined') (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300)))(preload);

/**
 * `ring` : version des ronds de probabilité. Un seul quart de noir, en taches plus petites et plus mobiles, pour que la
 * couleur domine dès l'ouverture (sinon tout un côté du cercle reste noir quelques secondes).
 */
export function WarpBg({ c1, c2, ring }: { c1: string; c2: string; ring?: boolean }) {
  // Le marbre (WebGL, coûteux à démarrer) arrive juste après l'affichage de la page, en fondu : le clic qui change de
  // page ne fige plus l'écran le temps de préparer le shader.
  const [on, setOn] = useState(false);
  const [seen, setSeen] = useState(true);
  // Rond : réglages tirés au hasard à chaque ouverture, pour qu'aucun marbre ne ressemble au précédent.
  const [v] = useState(() => ({
    frame: Math.random() * 60_000, rotation: Math.random() * 360, swirl: 0.5 + Math.random() * 0.35, distortion: 0.2 + Math.random() * 0.2,
    shapeScale: 0.17 + Math.random() * 0.14, proportion: 0.4 + Math.random() * 0.2, light: 0.25 + Math.random() * 0.2,
  }));
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let id = requestAnimationFrame(() => (id = requestAnimationFrame(() => setOn(true))));
    return () => cancelAnimationFrame(id);
  }, []);
  // Hors de l'écran (page descendue), le marbre s'arrête : la carte graphique reste libre pour le défilement et les clics.
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <span ref={box} style={{ display: 'contents' }}>
      {on && (
        <Suspense fallback={null}>
          {/* Marbre très doux : calculé à faible résolution (le flou ne se voit pas), ce qui le rend bien moins coûteux. */}
          {ring ? (
            <Warp className="warp-in" style={fill} minPixelRatio={1} maxPixelCount={120_000} colors={[toHex(c1), '#000000', mix(toHex(c1), '#ffffff', v.light), toHex(c2)]} proportion={v.proportion} softness={1} distortion={v.distortion} swirl={v.swirl} swirlIterations={8} shape="checks" shapeScale={v.shapeScale} rotation={v.rotation} frame={v.frame} speed={still() || !seen ? 0 : 0.7} />
          ) : (
            <Warp className="warp-in" style={fill} minPixelRatio={1} maxPixelCount={320_000} colors={['#000000', toHex(c1), '#000000', toHex(c2)]} proportion={0.45} softness={1} distortion={0.25} swirl={0.6} swirlIterations={8} shape="checks" shapeScale={0.08} speed={still() || !seen ? 0 : 0.4} />
          )}
        </Suspense>
      )}
    </span>
  );
}

/** Mélange de deux couleurs #rrggbb (t : part de la seconde). */
function mix(a: string, b: string, t: number) {
  const p = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, '0')).join('')}`;
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
