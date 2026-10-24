// Barre du haut façon Betix : bandeau noir plat, logo, pastilles de sport, liens de pages à droite.
import { Basketball, ClockCounterClockwise, Info, SoccerBall, Target, TennisBall } from '@phosphor-icons/react';
import { Link } from './ui.tsx';
import fond from './assets/razzia-fond.webp';
import lettres from './assets/razzia-lettres.png';

export function TopBar({ path }: { path: string }) {
  const tennis = path.startsWith('/tennis');
  const links = [
    { href: '/simulations', label: 'Simulations', icon: <ClockCounterClockwise size={18} />, on: path === '/simulations' },
    { href: tennis ? '/tennis/bilan' : '/bilan', label: 'Bilan', icon: <Target size={18} />, on: path === '/bilan' || path === '/tennis/bilan' },
    { href: '/methode', label: 'Méthode', icon: <Info size={18} />, on: path === '/methode' },
  ];
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label="Razzia, programme du jour">
          <span className="logo" style={{ backgroundImage: `url(${fond})` }}>
            <img src={lettres} alt="Razzia" />
          </span>
        </Link>
        <nav className="sports" aria-label="Sports">
          <Link href="/" className={`sport${tennis ? '' : ' is-on'}`} aria-current={path === '/' ? 'page' : undefined} title="Programme NBA">
            <Basketball size={19} />
            <span className="lbl">Basketball</span>
          </Link>
          <button className="sport" disabled title="Football : bientôt" aria-label="Football, bientôt">
            <SoccerBall size={19} />
            <span className="lbl">Football</span>
          </button>
          <Link href="/tennis" className={`sport${tennis ? ' is-on' : ''}`} aria-current={path === '/tennis' ? 'page' : undefined} title="Programme ATP">
            <TennisBall size={19} />
            <span className="lbl">Tennis</span>
          </Link>
        </nav>
        <div className="top-right">
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
