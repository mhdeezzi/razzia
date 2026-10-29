// Barre du haut : verre fumé collant, logo RAZZIA (étoile verte), sports en pilule de verre, lien Méthode à droite.
import { Basketball, Info, SoccerBall, TennisBall } from '@phosphor-icons/react';
import { Link } from './ui.tsx';
import logo from './assets/razzia-logo.webp';

export function TopBar({ path }: { path: string }) {
  const tennis = path.startsWith('/tennis');
  // Simulations, Bilan et Badges restent accessibles par leur adresse ; seule Méthode est dans la barre.
  const links = [{ href: '/methode', label: 'Méthode', icon: <Info size={18} />, on: path === '/methode' }];
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label="Razzia, programme du jour">
          <img className="logo" src={logo} alt="Razzia" width={1200} height={645} />
        </Link>
        <nav className="sports" aria-label="Sports">
          <Link href="/" className={`sport${tennis ? '' : ' is-on'}`} aria-current={path === '/' ? 'page' : undefined} title="Programme NBA">
            <Basketball size={18} weight={tennis ? 'regular' : 'bold'} />
            <span className="lbl">Basketball</span>
          </Link>
          <button className="sport" disabled title="Football : bientôt" aria-label="Football, bientôt">
            <SoccerBall size={18} />
            <span className="lbl">Football</span>
          </button>
          <Link href="/tennis" className={`sport${tennis ? ' is-on' : ''}`} aria-current={path === '/tennis' ? 'page' : undefined} title="Programme ATP">
            <TennisBall size={18} weight={tennis ? 'bold' : 'regular'} />
            <span className="lbl">Tennis</span>
          </Link>
        </nav>
        <div className="top-right">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`top-link glass${l.on ? ' is-on' : ''}`} aria-current={l.on ? 'page' : undefined} title={l.label}>
              {l.icon}
              <span className="lbl">{l.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
