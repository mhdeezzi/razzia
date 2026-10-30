// Barre du haut : îlot de verre fumé qui flotte en haut de page, logo RAZZIA (étoile verte), sports dans une pilule
// où le verre clair glisse vers le sport choisi, Compte et Méthode à droite (sur téléphone, Compte passe avant les sports).
import { useRef } from 'react';
import { Basketball, Info, ListChecks, SoccerBall, TennisBall, UserCircle } from '@phosphor-icons/react';
import { useSlip } from './suivi.ts';
import { useUnseen } from './suivipage.tsx';
import { Link, useSlider } from './ui.tsx';
import logo from './assets/razzia-logo.webp';

export function TopBar({ path }: { path: string }) {
  const tennis = path.startsWith('/tennis');
  // Simulations, Bilan et Badges restent accessibles par leur adresse ; seule Méthode est dans la barre.
  const links = [
    { href: '/compte', label: 'Compte', icon: <UserCircle size={19} />, on: path === '/compte', cls: 'top-account' },
    { href: '/methode', label: 'Méthode', icon: <Info size={18} />, on: path === '/methode', cls: 'top-methode' },
  ];
  const nav = useRef<HTMLElement>(null);
  const pos = useSlider(nav, '.sport.is-on', tennis);
  const legs = useSlip();
  const unseen = useUnseen();
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label="Razzia, programme du jour">
          <img className="logo" src={logo} alt="Razzia" width={1200} height={645} />
        </Link>
        <nav ref={nav} className="sports" aria-label="Sports">
          {pos && <span className="sport-thumb" style={{ left: pos.l, right: pos.r }} aria-hidden="true" />}
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
          <Link href="/suivi" className={`top-link glass top-suivi${path === '/suivi' ? ' is-on' : ''}`} aria-current={path === '/suivi' ? 'page' : undefined} title="Suivi des paris">
            <ListChecks size={18} />
            <span className="lbl">Suivi</span>
            {legs.length > 0 && <span className="top-count" aria-label={`${legs.length} dans le ticket`}>{legs.length}</span>}
            {unseen > 0 && <span className="top-dot" aria-label={`${unseen} ticket${unseen > 1 ? 's' : ''} réglé${unseen > 1 ? 's' : ''}`} />}
          </Link>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`top-link glass ${l.cls}${l.on ? ' is-on' : ''}`} aria-current={l.on ? 'page' : undefined} title={l.label}>
              {l.icon}
              <span className="lbl">{l.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
