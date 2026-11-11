// Briques de prédiction du direct (voir liveahead.ts) : le prono du moment dans le bloc « verdict » de la fiche
// d'avant-match (rond en marbre), l'annonce du moteur, et deux graphiques dessinés en points et en lignes fines :
// les fins possibles (une ligne par fin tirée au sort, en couleur quand le prono passe) et le prochain but / break
// (un point par paquet de fins, rangé sous sa courbe). Servent à la fiche, aux cartes du programme et aux widgets.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Binoculars, Coins, ShieldCheck, Snowflake, SoccerBall, TennisBall, TrendUp } from '@phosphor-icons/react';
import { pct0 } from './data.ts';
import { STAB, TIER, type Ahead, type Fan, type Signal, type Waves } from './liveahead.ts';
import { Callout, Ring } from './ui.tsx';
import mark from './assets/razzia-mark.webp';

const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const hash = (i: number) => { let x = Math.imul(i + 1, 2654435761) | 0; x ^= x >>> 15; x = Math.imul(x, 2246822519); x ^= x >>> 13; return (x >>> 0) / 4294967296; };
const fr = (n: number) => n.toFixed(2).replace('.', ',');
const GREY = 'rgba(255,255,255,0.26)';

/** Nom « razzialive » : le logo, puis « live » dans le dégradé du symbole (vert, cyan, violet). */
export function RazziaLive({ size = 22 }: { size?: number }) {
  return (
    <span className="rl-wm" style={{ '--s': `${size}px` } as CSSProperties} role="img" aria-label="Razzia Live">
      <img src={mark} alt="" />
      <span aria-hidden="true">
        razzia<b>live</b>
      </span>
    </span>
  );
}

/** Dessin sur canevas, net sur tous les écrans ; il se trace une fois quand `epoch` change (but, break, nouveau prono). */
function useCanvas(draw: (c: CanvasRenderingContext2D, w: number, h: number, k: number) => void, key: string, epoch: string, ms = 1100) {
  const ref = useRef<HTMLCanvasElement>(null);
  const seen = useRef('');
  const fn = useRef(draw);
  fn.current = draw;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let raf = 0;
    const paint = (k: number) => {
      const r = cv.getBoundingClientRect(), d = Math.min(2.5, window.devicePixelRatio || 1);
      // Taille de mise en page (pas celle à l'écran) : un widget réduit par une transformation garde son dessin.
      const w = cv.offsetWidth || r.width, h = cv.offsetHeight || r.height;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
      const c = cv.getContext('2d');
      if (!c) return;
      c.setTransform(d, 0, 0, d, 0, 0);
      c.clearRect(0, 0, w, h);
      fn.current(c, w, h, k);
    };
    const anim = seen.current !== epoch && !still();
    seen.current = epoch;
    if (anim) {
      const t0 = performance.now();
      const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms); paint(k); if (k < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    } else paint(1);
    const ro = new ResizeObserver(() => paint(1));
    ro.observe(cv);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [key, epoch, ms]);
  return ref;
}

// ——— Les fins possibles ———
function drawFan(c: CanvasRenderingContext2D, w: number, h: number, k: number, fan: Fan, col: string, o: { mini?: boolean; p: number }) {
  const mini = !!o.mini, pad = mini ? { l: 5, r: 5, t: 3, b: 3 } : { l: 10, r: 92, t: 10, b: 28 };
  const xs = fan.xs, x0 = xs[0], x1 = xs[xs.length - 1], band = mini ? Math.min(14, h * 0.1) : Math.min(30, h * 0.11);
  const X = (x: number) => pad.l + ((x - x0) / Math.max(1e-6, x1 - x0)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + band + (1 - v) * (h - pad.t - pad.b - 2 * band);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (!mini) {
    // Repères discrets : passe (haut), une chance sur deux, tombe (bas).
    c.font = '500 12px "Geist Variable", system-ui, sans-serif';
    for (const [v, s] of [[1, 'Passe'], [0.5, ''], [0, 'Tombe']] as Array<[number, string]>) {
      c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1; c.setLineDash(v === 0.5 ? [2, 5] : []);
      c.beginPath(); c.moveTo(pad.l, Y(v) + 0.5); c.lineTo(w - pad.r, Y(v) + 0.5); c.stroke(); c.setLineDash([]);
      if (s) { c.fillStyle = v === 1 ? col : '#8e8e93'; c.textAlign = 'left'; c.fillText(s, w - pad.r + 14, Y(v) - 2); c.fillStyle = '#74747a'; c.fillText(`${v === 1 ? fan.wins : fan.lines.length - fan.wins} sur ${fan.lines.length}`, w - pad.r + 14, Y(v) + 14); }
    }
    c.fillStyle = '#74747a'; c.textAlign = 'center';
    fan.ticks.forEach((t, i) => { c.textAlign = i === 0 ? 'left' : t.x >= x1 ? 'right' : 'center'; c.fillText(t.s, X(t.x), h - 8); });
  }
  const n = fan.lines.length, last = xs.length - 1, win = Math.max(1, Math.round(last / 9));
  // Lignes adoucies (moyenne glissante, extrémités gardées) : une bascule se lit comme une courbe, pas comme une marche.
  const soft = (v: number[]) => v.map((_, i) => { if (i === 0 || i === last) return v[i]; let s = 0, q = 0; for (let d = -win; d <= win; d++) { const x = v[Math.min(last, Math.max(0, i + d))], g = win + 1 - Math.abs(d); s += x * g; q += g; } return s / q; });
  fan.lines.forEach((ln0, j) => {
    const ln = { win: ln0.win, v: soft(ln0.v) };
    // Chaque ligne garde sa place dans le faisceau (décalage fixe), et part du même point : maintenant.
    const off = (hash(j * 7 + (ln.win ? 3 : 11)) - 0.5) * 2 * band, reach = ease(k * 1.5 - (j / n) * 0.5) * last;
    if (reach <= 0) return;
    const P = (i: number): [number, number] => [X(xs[i]), Y(ln.v[i]) + off * Math.min(1, i / Math.min(4, last))];
    c.strokeStyle = ln.win ? col : GREY; c.globalAlpha = ln.win ? (mini ? 0.9 : 0.8) : 1; c.lineWidth = mini ? 1 : ln.win ? 1.3 : 1.05;
    c.beginPath();
    let [px, py] = P(0);
    c.moveTo(px, py);
    for (let i = 1; i <= Math.floor(reach); i++) { const [x, y] = P(i), mx = (px + x) / 2; c.bezierCurveTo(mx, py, mx, y, x, y); px = x; py = y; }
    c.stroke();
  });
  c.globalAlpha = 1;
  c.fillStyle = '#fff'; c.beginPath(); c.arc(X(x0), Y(o.p), mini ? 2.5 : 4.5, 0, 6.2832); c.fill();
}

export function FanChart({ a, col, epoch, mini }: { a: Ahead; col: string; epoch: string; mini?: boolean }) {
  const ref = useCanvas((c, w, h, k) => a.fan && drawFan(c, w, h, k, a.fan, col, { mini, p: a.pick.p }), `${a.key}|${col}`, epoch, mini ? 800 : 1200);
  return <canvas ref={ref} className={mini ? 'lv-fan-mini' : 'lv-fan-cv'} role="img" aria-label={a.fan ? `${a.fan.wins} fins sur ${a.fan.lines.length} où le prono passe` : undefined} />;
}

// ——— Le prochain but, le prochain break, l'écart final : des points rangés sous leur courbe ———
function drawWaves(c: CanvasRenderingContext2D, w: number, h: number, k: number, wv: Waves, hc: string, ac: string) {
  const small = w < 520, g = small ? 4.5 : 5.5, r = small ? 1.35 : 1.6, pad = { l: 6, r: 6, t: 22, b: 30 };
  const nw = wv.none ? (small ? 62 : 96) : 0, gap = wv.none ? (small ? 12 : 24) : 0, n = wv.bins.length, bw = (w - pad.l - pad.r - nw - gap) / n, base = h - pad.b;
  const cd = Math.max(1, Math.floor((bw / 2 - 3) / g)), rows = Math.floor((base - pad.t) / g) - 1, cn = Math.max(2, Math.floor(nw / g));
  const top = Math.max(1e-6, ...wv.bins.flatMap((b) => [b.h, b.a])), K = Math.min(small ? 500 : 1000, (rows * cd) / top, wv.none ? (rows * cn) / Math.max(1e-6, wv.none.v) : 1e9);
  c.font = '500 12px "Geist Variable", system-ui, sans-serif';
  c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = 1; c.beginPath(); c.moveTo(pad.l, base + 4.5); c.lineTo(w - pad.r, base + 4.5); c.stroke();
  const every = Math.max(1, Math.ceil(38 / bw)), tops: Array<[number, number, number]> = [];
  const dots = (cx: number, count: number, cols: number, dir: -1 | 0 | 1, col: string, reveal: number) => {
    c.fillStyle = col; c.beginPath();
    for (let i = 0; i < count; i++) {
      const x = dir === 0 ? cx - ((cols - 1) * g) / 2 + (i % cols) * g : cx + dir * (3 + (i % cols) * g), y = base - Math.floor(i / cols) * g - r;
      if (reveal < 1 && i / Math.max(1, count) > reveal) break;
      c.moveTo(x + r, y); c.arc(x, y, r, 0, 6.2832);
    }
    c.fill();
  };
  wv.bins.forEach((b, i) => {
    const cx = pad.l + bw * (i + 0.5), nh = Math.round(b.h * K), na = Math.round(b.a * K), rv = ease(k * 1.7 - (i / n) * 0.7);
    dots(cx, nh, cd, -1, hc, rv); dots(cx, na, cd, 1, ac, rv);
    tops.push([cx, base - Math.ceil(nh / cd) * g - 7, base - Math.ceil(na / cd) * g - 7]);
    if (i % every === 0 || i === n - 1) { c.fillStyle = '#74747a'; c.textAlign = 'center'; c.fillText(b.s, cx, h - 8); }
  });
  // La courbe de chaque camp passe au-dessus de ses points.
  if (k >= 0.55) for (const [idx, col] of [[1, hc], [2, ac]] as Array<[1 | 2, string]>) {
    if (!wv.bins.some((b) => (idx === 1 ? b.h : b.a) > 0)) continue;
    c.strokeStyle = col; c.lineWidth = 1.5; c.globalAlpha = ease((k - 0.55) / 0.45); c.beginPath();
    // La courbe ne relie que les colonnes où ce camp a des points (au tennis, un joueur ne peut breaker qu'un jeu sur deux).
    const pts = tops.filter((_, i) => (idx === 1 ? wv.bins[i].h : wv.bins[i].a) > 0).map((t): [number, number] => [t[0] + (idx === 1 ? -bw / 4 : bw / 4), t[idx]]);
    pts.forEach(([x, y], i) => { if (!i) return c.moveTo(x, y); const [px, py] = pts[i - 1], mx = (px + x) / 2; c.bezierCurveTo(mx, py, mx, y, x, y); });
    c.stroke(); c.globalAlpha = 1;
  }
  if (wv.none) {
    const cx = w - pad.r - nw / 2, nn = Math.round(wv.none.v * K);
    dots(cx, nn, cn, 0, 'rgba(255,255,255,0.3)', ease(k * 1.7 - 0.7));
    c.fillStyle = '#a3a3a8'; c.textAlign = 'center'; c.fillText(wv.none.s, cx, h - 8);
    c.fillStyle = '#f4f4f2'; c.font = '600 13px "Geist Mono Variable", ui-monospace, monospace'; c.fillText(`${Math.round(wv.none.v * 100)} %`, cx, base - Math.ceil(nn / cn) * g - 10);
  }
  c.fillStyle = '#74747a'; c.textAlign = 'right'; c.font = '500 11.5px "Geist Variable", system-ui, sans-serif';
  c.fillText(`1 point = 1 fin sur ${K >= 100 ? Math.round(K / 10) * 10 : Math.round(K)}`, w - pad.r, 12);
}

export function WavesChart({ a, hc, ac, epoch }: { a: Ahead; hc: string; ac: string; epoch: string }) {
  const ref = useCanvas((c, w, h, k) => a.waves && drawWaves(c, w, h, k, a.waves, hc, ac), `${a.key}|${hc}|${ac}`, epoch, 1300);
  return <canvas ref={ref} className="lv-waves-cv" role="img" aria-label={a.waves?.say} />;
}

// ——— Le prono du moment ———
const SIG_ICON: Record<Signal['kind'], ReactNode> = {
  goal: <SoccerBall size={19} weight="light" />, break: <TennisBall size={19} weight="light" />, cool: <Snowflake size={19} weight="light" />, run: <TrendUp size={19} weight="light" />, none: <Binoculars size={19} weight="light" />,
};
/** Annonce du moteur : ce qu'il voit venir, avec le repère habituel à côté. */
export function Announce({ s }: { s: Signal }) {
  const hot = s.kind !== 'none';
  return (
    <Callout tone={hot ? 'lv-ahead' : 'lv-calm'} icon={SIG_ICON[s.kind]} title={s.title} tag={hot ? (s.p != null ? pct0(s.p) : s.value) : undefined}>
      <p>{s.text}</p>
    </Callout>
  );
}

export function Prono({ a, mark: who, marble, pre }: { a: Ahead; mark: ReactNode; marble: string; pre?: string }) {
  const t = a.pick.tier, done = t === 'done';
  return (
    <section className={`verdict lv-prono verdict-${TIER[t].tone === 'flip' ? 'flip' : TIER[t].tone === 'sure' ? 'sure' : 'normal'}`}>
      {t === 'risky' && <span className="odds-warn verdict-warn risky">Risqué</span>}
      {t === 'flip' && <span className="odds-warn verdict-warn">Déconseillé</span>}
      <div className="verdict-ring">
        <Ring value={a.pick.p} format={pct0} label={done ? 'Résultat' : 'Prono'} marble={marble} />
      </div>
      <div>
        <span className="caps">{done ? 'Le prono, à la fin' : 'Le prono du direct'}</span>
        <p className="verdict-team">
          {who} {a.pick.label}
        </p>
        {!done && (
          <p className="verdict-sub">
            Passe dans <b className="num">{pct0(a.pick.p)}</b> des fins possibles, rejouées depuis le score actuel. {a.why}
          </p>
        )}
        {!done && <Announce s={a.signal} />}
        {t === 'sure' && (
          <Callout tone="badge-sure" icon={<ShieldCheck size={19} weight="light" />} title="Razzia assuré">
            <p>Au niveau des pronos « assurés » d'avant-match.</p>
          </Callout>
        )}
        {t === 'flip' && (
          <Callout tone="badge-flip" icon={<Coins size={20} weight="fill" />} title="Pile ou face">
            <p>Trop serré pour un prono : moins de 60 fins sur 100, même au plus prudent.</p>
          </Callout>
        )}
      </div>
      {!done && (
        <dl className="verdict-side">
          <div>
            <dt>Cote Razzia</dt>
            <dd>{fr(a.pick.fair)}</dd>
          </div>
          <div>
            <dt>Tenue du prono</dt>
            <dd className={`lv-stab is-${a.stab}`}>{STAB[a.stab]}</dd>
            {a.soon && <p className="lv-side-n">{a.soon}</p>}
          </div>
          {a.comeback ? (
            <div>
              <dt>{a.comeback.label}</dt>
              <dd>{pct0(a.comeback.p)}</dd>
            </div>
          ) : pre ? (
            <div>
              <dt>Avant le match</dt>
              <dd>{pre}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </section>
  );
}

// ——— Ce qui peut tout changer ———
export function Scenarios({ a }: { a: Ahead }) {
  return (
    <ol className="lv-scen">
      {a.scen.map((s) => (
        <li key={s.label} className={s.to ? 'is-turn' : undefined}>
          <span className="lv-scen-c mono">{pct0(s.chance)}</span>
          <div className="lv-scen-b">
            <p>{s.label}</p>
            <span className="lv-scen-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${clamp(s.chance, 0.01, 1)})` }} />
            </span>
          </div>
          <p className={`lv-scen-r is-${s.tone}`}>
            {s.tone === 'up' ? <ArrowUpRight size={15} weight="bold" /> : s.tone === 'down' ? <ArrowDownRight size={15} weight="bold" /> : <ArrowRight size={15} weight="bold" />}
            <span>
              {a.pick.label} <b className="mono">{pct0(s.p)}</b>
            </span>
            {s.to && <em className={s.tone === 'down' ? 'is-warn' : undefined}>{s.to === 'pile ou face' ? 'Passe en pile ou face' : `Le prono devient ${s.to}`}</em>}
          </p>
        </li>
      ))}
    </ol>
  );
}
