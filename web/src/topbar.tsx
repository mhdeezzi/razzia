// Barre du haut : matière translucide façon Apple (capsules de verre posées sur le contenu, fondu au défilement),
// lentille qui glisse vers la page active, et pastille « soirée en cours » quand une simulation groupée tourne.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Basketball, CalendarBlank, ChartLineUp, Check, ClockCounterClockwise, Info, SoccerBall, Target, TennisBall } from '@phosphor-icons/react';
import { isRunning, useBatch, type Batch } from './batch.ts';
import { Link } from './ui.tsx';

function useScrolled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const check = () => setOn(window.scrollY > 4);
    check();
    addEventListener('scroll', check, { passive: true });
    return () => removeEventListener('scroll', check);
  }, []);
  return on;
}

export function TopBar({ path }: { path: string }) {
  const scrolled = useScrolled();
  const batch = useBatch();
  const items = [
    { href: '/', label: 'Programme', icon: <CalendarBlank size={18} />, on: path === '/' || path.startsWith('/match/') },
    { href: '/simulations', label: 'Simulations', icon: <ClockCounterClockwise size={18} />, on: path === '/simulations' },
    { href: '/bilan', label: 'Bilan', icon: <Target size={18} />, on: path === '/bilan' },
    { href: '/methode', label: 'Méthode', icon: <Info size={18} />, on: path === '/methode' },
  ];
  return (
    <header className={`topbar${scrolled ? ' is-scrolled' : ''}`}>
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label="Razzia, programme du jour">
          <span className="brand-tile">
            <ChartLineUp size={18} weight="bold" />
          </span>
          <span className="word">Razzia</span>
        </Link>
        <nav className="glass sports" aria-label="Sports">
          <Link href="/" className="sport is-on" aria-current="page">
            <Basketball size={18} weight="fill" />
            <span className="lbl">Basketball</span>
          </Link>
          <button className="sport soon" disabled title="Football : bientôt" aria-label="Football, bientôt">
            <SoccerBall size={18} />
          </button>
          <button className="sport soon" disabled title="Tennis : bientôt" aria-label="Tennis, bientôt">
            <TennisBall size={18} />
          </button>
        </nav>
        <div className="top-right">
          {batch && <LiveChip b={batch} />}
          <LensNav items={items} />
        </div>
      </div>
    </header>
  );
}

/** Navigation principale : la lentille glisse (ressort) vers la page ouverte. */
function LensNav({ items }: { items: Array<{ href: string; label: string; icon: ReactNode; on: boolean }> }) {
  const ref = useRef<HTMLElement>(null);
  const [lens, setLens] = useState<{ x: number; w: number }>();
  const [ready, setReady] = useState(false);
  const active = items.findIndex((i) => i.on);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector<HTMLElement>('.nav-item.is-on');
      setLens(el ? { x: el.offsetLeft, w: el.offsetWidth } : undefined);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [active]);
  useEffect(() => {
    if (lens && !ready) requestAnimationFrame(() => setReady(true));
  }, [lens, ready]);
  return (
    <nav ref={ref} className={`glass nav-cap${ready ? ' is-ready' : ''}`} aria-label="Navigation">
      <span className="lens" style={lens ? { transform: `translateX(${lens.x}px)`, width: lens.w } : { opacity: 0 }} aria-hidden="true" />
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={`nav-item${i.on ? ' is-on' : ''}`} aria-current={i.on ? 'page' : undefined} title={i.label}>
          {i.icon}
          <span className="lbl">{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Pastille de la soirée en cours : anneau d'avancement, ramène à la feuille de match. */
function LiveChip({ b }: { b: Batch }) {
  const n = b.items.length;
  const done = b.items.filter((i) => i.state === 'done').length;
  const over = b.items.filter((i) => i.state === 'done' || i.state === 'failed').length;
  const running = isRunning(b);
  const r = 8;
  const c = 2 * Math.PI * r;
  const day = new Date(`${b.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }).replace('.', '');
  return (
    <Link
      href={`/?jour=${b.date}`}
      className={`glass live-chip${running ? '' : ' is-over'}`}
      title={running ? `Soirée du ${day} : ${done} sur ${n} publiés` : `Soirée du ${day} terminée`}
      aria-label={running ? `Soirée du ${day} en cours, ${done} matchs sur ${n} publiés` : `Soirée du ${day} terminée`}
    >
      <span className="mini-ring" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <circle cx="10" cy="10" r={r} className="t" />
          <circle cx="10" cy="10" r={r} className="v" strokeDasharray={c} strokeDashoffset={c * (1 - over / n)} />
        </svg>
        {!running && <Check size={10} weight="bold" />}
      </span>
      <span className="lbl">Soirée</span>
      <span className="mono">
        {done}/{n}
      </span>
    </Link>
  );
}
