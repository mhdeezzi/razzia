// Barre du haut façon Betix : bandeau noir plat, logo, pastilles de sport, liens de pages à droite,
// et pastille « Soirée » quand une simulation groupée tourne.
import { Basketball, ChartLineUp, ClockCounterClockwise, Info, SoccerBall, Target, TennisBall } from '@phosphor-icons/react';
import { isRunning, useBatch, type Batch } from './batch.ts';
import { Link } from './ui.tsx';

export function TopBar({ path }: { path: string }) {
  const batch = useBatch();
  const links = [
    { href: '/simulations', label: 'Simulations', icon: <ClockCounterClockwise size={18} />, on: path === '/simulations' },
    { href: '/bilan', label: 'Bilan', icon: <Target size={18} />, on: path === '/bilan' },
    { href: '/methode', label: 'Méthode', icon: <Info size={18} />, on: path === '/methode' },
  ];
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label="Razzia, programme du jour">
          <ChartLineUp size={24} weight="bold" />
          <span className="word">Razzia</span>
        </Link>
        <nav className="sports" aria-label="Sports">
          <Link href="/" className="sport is-on" aria-current={path === '/' ? 'page' : undefined} title="Programme NBA">
            <Basketball size={19} />
            <span className="lbl">Basketball</span>
          </Link>
          <button className="sport" disabled title="Football : bientôt" aria-label="Football, bientôt">
            <SoccerBall size={19} />
            <span className="lbl">Football</span>
          </button>
          <button className="sport" disabled title="Tennis : bientôt" aria-label="Tennis, bientôt">
            <TennisBall size={19} />
            <span className="lbl">Tennis</span>
          </button>
        </nav>
        <div className="top-right">
          {batch && <LiveChip b={batch} />}
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`top-link${l.on ? ' is-on' : ''}`} aria-current={l.on ? 'page' : undefined} title={l.label}>
              {l.icon}
              <span className="lbl">{l.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}

/** Soirée en cours : un point et un compteur, au même rang que les liens ; ramène à la feuille de match. */
function LiveChip({ b }: { b: Batch }) {
  const n = b.items.length;
  const done = b.items.filter((i) => i.state === 'done').length;
  const failed = b.items.some((i) => i.state === 'failed');
  const running = isRunning(b);
  const day = new Date(`${b.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }).replace('.', '');
  return (
    <Link
      href={`/?jour=${b.date}`}
      className="top-link live-link"
      title={running ? `Soirée du ${day} : ${done} sur ${n} publiés` : `Soirée du ${day} terminée`}
      aria-label={running ? `Soirée du ${day} en cours, ${done} matchs sur ${n} publiés` : `Soirée du ${day} terminée`}
    >
      <span className={`dot-s${running ? ' is-live' : failed ? ' is-fail' : ' is-done'}`} aria-hidden="true" />
      <span className="lbl">Soirée</span>
      <span className="mono">
        {done}/{n}
      </span>
    </Link>
  );
}
