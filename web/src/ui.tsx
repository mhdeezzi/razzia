// Briques partagées : navigation, pastille d'équipe, onglets à curseur glissant, anneau de probabilité, compteur animé.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { teamColor, teamLogo, type Team } from './data.ts';

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

export function Link({ href, className, children, replace, style }: { href: string; className?: string; children: ReactNode; replace?: boolean; style?: CSSProperties }) {
  const go = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (replace) {
      history.replaceState(null, '', href);
      dispatchEvent(new PopStateEvent('popstate'));
    } else navigate(href);
  };
  return (
    <a href={href} className={className} onClick={go} style={style}>
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

/** Onglets segmentés : le curseur glisse vers l'onglet choisi. */
export function Segmented<T extends string | number>({ options, value, onChange, tone = 'light', size = 'md', ariaLabel }: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  tone?: 'light' | 'blue' | 'dark';
  size?: 'md' | 'lg';
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number }>();
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector<HTMLElement>(`[data-v="${String(value)}"]`);
      if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [value, options.length]);
  useEffect(() => {
    if (thumb && !ready) requestAnimationFrame(() => setReady(true));
  }, [thumb, ready]);
  return (
    <div ref={ref} className={`seg seg-${tone} seg-${size}${ready ? ' is-ready' : ''}`} role="tablist" aria-label={ariaLabel}>
      {thumb && <span className="seg-thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} aria-hidden="true" />}
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

/** Anneau de probabilité (0 à 1) qui se remplit à l'affichage. */
export function Ring({ value, tone = 'blue', label, format }: { value: number; tone?: 'blue' | 'rose'; label?: string; format: (v: number) => string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const grad = `ring-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [shown, setShown] = useState(reduced() ? value : 0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(t);
  }, [value]);
  return (
    <figure className={`ring ring-${tone}`}>
      <div className="ring-disc">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--c2)" />
              <stop offset="100%" stopColor="var(--c)" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={r} className="ring-track" />
          <circle cx="50" cy="50" r={r} className="ring-val" stroke={`url(#${grad})`} strokeDasharray={c} strokeDashoffset={c * (1 - shown)} />
          {/* Pointe lumineuse au bout de l'arc : tourne avec lui pendant l'animation. */}
          <g className="ring-tip" style={{ transform: `rotate(${shown * 360}deg)` }}>
            <circle className="tip-halo" cx={50 + r} cy="50" r="6" />
            <circle className="tip" cx={50 + r} cy="50" r="3" />
          </g>
        </svg>
        <span className="ring-num mono">
          <CountUp value={value} format={format} />
        </span>
      </div>
      {label && <figcaption>{label}</figcaption>}
    </figure>
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

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}
