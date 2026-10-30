// Briques partagées : navigation, pastille d'équipe, onglets à curseur glissant, anneau de probabilité, compteur animé.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { CalendarBlank, Check } from '@phosphor-icons/react';
import { teamColor, teamLogo, type Team } from './data.ts';
import { WarpBg } from './shaders.tsx';

export function navigate(to: string): void {
  history.pushState(null, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function useLocation(): { path: string; search: URLSearchParams } {
  const [loc, setLoc] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const on = () => setLoc(location.pathname + location.search);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  const u = new URL(loc, location.origin);
  return { path: u.pathname, search: u.searchParams };
}

export function Link({ href, className, children, replace, style, ...aria }: {
  href: string;
  className?: string;
  children: ReactNode;
  replace?: boolean;
  style?: CSSProperties;
  title?: string;
  'aria-label'?: string;
  'aria-current'?: 'page';
}) {
  const go = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (replace) {
      history.replaceState(null, '', href);
      dispatchEvent(new PopStateEvent('popstate'));
    } else navigate(href);
  };
  return (
    <a href={href} className={className} onClick={go} style={style} {...aria}>
      {children}
    </a>
  );
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Pastille d'équipe : logo du club dans un disque cerclé de sa couleur ; tricode si le logo manque. */
export function TeamMark({ team, size = 'md' }: { team: Pick<Team, 'tri' | 'color' | 'logo'>; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const [failed, setFailed] = useState(false);
  const src = team.logo ?? teamLogo(team.tri);
  const logo = !failed;
  return (
    <span className={`mark mark-${size}${logo ? ' has-logo' : ''}`} style={{ '--tc': teamColor(team) } as CSSProperties} aria-hidden="true">
      {logo ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : team.tri}
    </span>
  );
}

export interface SegOption<T> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/** Curseur qui glisse vers l'élément choisi (onglets, sports de la barre du haut) : position mesurée, glissé en CSS. */
export function useSlider(ref: RefObject<HTMLElement | null>, selector: string, key: unknown) {
  const [pos, setPos] = useState<{ l: number; r: number }>();
  useLayoutEffect(() => {
    const measure = () => {
      const box = ref.current;
      const el = box?.querySelector<HTMLElement>(selector);
      if (box && el) setPos({ l: el.offsetLeft, r: box.clientWidth - el.offsetLeft - el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [key, selector]);
  return pos;
}

/** Couleur d'équipe éclaircie pour une lueur visible sur le noir (un bleu marine reste bleu, un gris reste gris). */
export function glow(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return `hsl(${Math.round(h * 60)} ${Math.round((s > 0.08 ? Math.max(s, 0.55) : s) * 100)}% ${Math.round(Math.max(l, 0.55) * 100)}%)`;
}

/** Onglets segmentés : le curseur de verre glisse et s'étire vers l'onglet choisi. */
export function Segmented<T extends string | number>({ options, value, onChange, tone = 'light', size = 'md', ariaLabel }: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  tone?: 'light' | 'blue' | 'dark';
  size?: 'md' | 'lg';
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useSlider(ref, `[data-v="${String(value)}"]`, `${String(value)}|${options.length}`);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (pos && !ready) requestAnimationFrame(() => setReady(true));
  }, [pos, ready]);
  return (
    <div ref={ref} className={`seg seg-${tone} seg-${size}${ready ? ' is-ready' : ''}`} role="tablist" aria-label={ariaLabel}>
      {pos && <span className="seg-thumb" style={{ left: pos.l, right: pos.r }} aria-hidden="true" />}
      {options.map((o) => (
        <button
          key={String(o.value)}
          data-v={String(o.value)}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'is-on' : ''}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Nombre qui défile jusqu'à sa valeur à l'affichage. */
export function CountUp({ value, format, duration = 1100 }: { value: number; format: (v: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = useRef(format);
  fmt.current = format;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const format = fmt.current;
    if (reduced()) {
      el.textContent = format(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      el.textContent = format(value * (1 - Math.pow(1 - k, 4)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span ref={ref}>{format(0)}</span>;
}

/** Anneau de probabilité (0 à 1) qui se remplit à l'affichage : toujours bleu. */
export function Ring({ value, tone = 'blue', label, format }: { value: number; tone?: 'blue' | 'rose'; label?: string; format: (v: number) => string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(reduced() ? value : 0);
  const grad = `ring-grad-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(t);
  }, [value]);
  return (
    <figure className={`ring ring-${tone}`}>
      <div className="ring-disc">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          {/* Même dégradé que les lignes de résultats. */}
          <defs>
            <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" className="ring-stop-a" />
              <stop offset="1" className="ring-stop-b" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={r} className="ring-track" />
          <circle cx="50" cy="50" r={r} className="ring-val" stroke={`url(#${grad})`} strokeDasharray={c} strokeDashoffset={c * (1 - shown)} />
        </svg>
        <span className="ring-num mono">
          <CountUp value={value} format={format} />
        </span>
      </div>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}

/** Avancement d'une simulation groupée : une seule ligne, remplie au fil des matchs publiés, balayée en bleu foncé tant que ça calcule. */
export function ProgressLine({ done, failed = 0, n, running }: { done: number; failed?: number; n: number; running: boolean }) {
  return (
    <div className={`batch-line${running ? ' is-running' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={n} aria-valuenow={done} aria-label={`${done} matchs publiés sur ${n}`}>
      <span className="done" style={{ width: `${(100 * done) / Math.max(1, n)}%` }} />
      {failed > 0 && <span className="fail" style={{ width: `${(100 * failed) / Math.max(1, n)}%` }} />}
    </div>
  );
}

/** Barres d'intensité (confiance) : n barres pleines sur `of`. */
export function Pips({ n, of = 5, tone = 'blue' }: { n: number; of?: number; tone?: 'blue' | 'rose' | 'mute' }) {
  return (
    <span className={`pips pips-${tone}`} aria-label={`${n} sur ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

/**
 * Encart de la fiche (niveau de confiance, signaux, page Badges) : pastille d'icône teintée, titre et étiquette, texte.
 * La teinte vient de la classe `tone` (badge-sure, badge-flip, signal-up…).
 */
export function Callout({ tone, icon, title, tag, children }: { tone: string; icon: ReactNode; title: ReactNode; tag?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`signal ${tone}`}>
      <span className="signal-icon">{icon}</span>
      <div>
        <p className="signal-title">
          {title}
          {tag && <span className="signal-tag">{tag}</span>}
        </p>
        {children}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

/** Saison en cours : NBA d'octobre à juin (« 2026-27 »), ATP sur l'année civile. */
function season(sport: 'nba' | 'atp'): string {
  const d = new Date();
  const y = d.getFullYear();
  if (sport === 'atp') return String(y);
  const start = d.getMonth() >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * En-tête des programmes façon affiche RAZZIA : marbre lent aux couleurs du sport, petites mentions en haut, titre très gras
 * et serré, accroche en dessous ; date, nombre de matchs et affichage en pied.
 */
/** Couleurs du marbre du bandeau, une paire par sport : ambre et ardoise au basket, bleu nuit et violet au tennis. */
const HERO_COLORS = { nba: ['#c98a3d', '#3b4a5e'], atp: ['#2a4f9a', '#7a3a6e'] } as const;

export function PageHero({ sport, title, day, count, children }: { sport: 'nba' | 'atp'; title: string; day?: string; count?: number; children?: ReactNode }) {
  const [first, ...rest] = title.split(' ');
  return (
    <header className={`hero-banner mesh mesh-${sport} has-shader`}>
      <WarpBg c1={HERO_COLORS[sport][0]} c2={HERO_COLORS[sport][1]} />
      <div className="hb-top" aria-hidden="true">
        <span className="hb-label">RAZZIA · Saison {season(sport)}</span>
        <span className="hb-label hb-right">
          {sport === 'nba' ? 'NBA' : 'ATP'}
          <span className="hb-more"> · 5 000 simulations par match</span>
        </span>
      </div>
      <h1 className="hb-title">
        <span>{first}</span> <span className="hb-title-2">{rest.join(' ')}</span>
      </h1>
      <p className="hb-tag">sports analysis specialist</p>
      <div className="hb-foot">
        {day && (
          <p className="dash-meta">
            <CalendarBlank size={16} weight="bold" /> <span>{day}</span>
            {count != null && (
              <span className="count">
                {count} match{count > 1 ? 's' : ''}
              </span>
            )}
          </p>
        )}
        {children}
      </div>
    </header>
  );
}

/** Petite courbe (valeurs de 0 à 1) avec aire en dégradé et ligne des 50 % : réussite au fil des matchs. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const id = `spark-${useId().replace(/:/g, '')}`;
  if (values.length < 2) return null;
  const lo = Math.min(0.4, ...values), hi = Math.max(0.9, ...values);
  const pts = values.map((v, i) => [(100 * i) / (values.length - 1), 40 - (36 * (v - lo)) / (hi - lo) - 2] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const mid = 40 - (36 * (0.5 - lo)) / (hi - lo) - 2;
  return (
    <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--brand)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="spark-mid" x1="0" x2="100" y1={mid} y2={mid} />
      <path d={`${d} L100,40 L0,40 Z`} fill={`url(#${id})`} />
      <path className="spark-line" d={d} />
    </svg>
  );
}

/** Radar qui balaie (façon amicro) : un faisceau tourne autour d'un point, « ça calcule ». */
export function RadarSweep() {
  return (
    <span className="radar" aria-hidden="true">
      <i />
    </span>
  );
}

/** Suivi animé d'une simulation (basket et tennis) : chronomètre, barre qui défile, étapes estimées. */
export function SimProgress({ queued, start, title, steps, prep, note }: { queued: boolean; start?: number; title: string; steps: string[]; prep: number; note: string }) {
  const [now, setNow] = useState(Date.now());
  const [first] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - (start ?? first)) / 1000));
  // Étape estimée : file d'attente, puis préparation (prep secondes), puis calcul.
  const at = queued ? 0 : s < prep ? 1 : 2;
  return (
    <section className="progress" aria-live="polite">
      <div className="progress-top">
        <div className="pg-title">
          <RadarSweep />
          <h2 className="shimmer-text">{title}</h2>
        </div>
        <span className="clock">
          {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="track" />
      <ol className="steps">
        {steps.map((label, i) => (
          <li key={label} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
            <span className="ic">{i < at ? <Check size={14} weight="bold" /> : i + 1}</span>
            <span className={i === at ? 'shimmer-text' : undefined}>{label}</span>
          </li>
        ))}
      </ol>
      <p className="small muted">{note}</p>
    </section>
  );
}
