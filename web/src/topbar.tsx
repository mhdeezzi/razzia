// Barre du haut : îlot de verre fumé qui flotte en haut de page, logo RAZZIA (étoile verte), sports dans une pilule
// où le verre clair glisse vers le sport choisi, Suivi puis Compte tout à droite.
import { useRef } from 'react';
import { Basketball, ListChecks, SoccerBall, TennisBall, UserCircle } from '@phosphor-icons/react';
import { useSlip } from './suivi.ts';
import { useUnseen } from './suivipage.tsx';
import { Link, useNowPath, useSlider } from './ui.tsx';
import logo from './assets/razzia-logo-2.webp';
import mark from './assets/razzia-mark.webp';

export function TopBar() {
  const path = useNowPath();
  // Suivi et Compte ne sont d'aucun sport : aucun sport allumé, c'est leur bouton qui l'est.
  const own = path === '/suivi' || path === '/compte';
  const tennis = path.startsWith('/tennis');
  // Football à l'accueil ; le basket a son adresse (/basket) et ses fiches (/match/...).
  const nba = path.startsWith('/basket') || path.startsWith('/match');
  const foot = !tennis && !nba && !own;
  // Simulations, Bilan, Badges et Méthode restent accessibles par leur adresse ; à droite : Suivi puis Compte.
  const links = [
    { href: '/compte', label: 'Compte', icon: <UserCircle size={19} />, on: path === '/compte', cls: 'top-account' },
  ];
  const nav = useRef<HTMLElement>(null);
  const pos = useSlider(nav, '.sport.is-on', `${tennis}${foot}${nba}`);
  const legs = useSlip();
  const unseen = useUnseen();
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label="Razzia, programme du jour">
          <img className="logo" src={logo} alt="Razzia" width={885} height={196} />
          <img className="logo-mark" src={mark} alt="" aria-hidden="true" width={292} height={196} />
        </Link>
        <nav ref={nav} className="sports" aria-label="Sports">
          {pos && <span className="sport-thumb" style={{ left: pos.l, right: pos.r }} aria-hidden="true" />}
          <Link href="/" className={`sport${foot ? ' is-on' : ''}`} aria-current={path === '/' || path === '/foot' ? 'page' : undefined} title="Programme Football">
            <SoccerBall size={18} weight={foot ? 'bold' : 'regular'} />
            <span className="lbl">Football</span>
          </Link>
          <Link href="/tennis" className={`sport${tennis ? ' is-on' : ''}`} aria-current={path === '/tennis' ? 'page' : undefined} title="Programme ATP">
            <TennisBall size={18} weight={tennis ? 'bold' : 'regular'} />
            <span className="lbl">Tennis</span>
          </Link>
          <Link href="/basket" className={`sport${nba ? ' is-on' : ''}`} aria-current={path === '/basket' ? 'page' : undefined} title="Programme NBA">
            <Basketball size={18} weight={nba ? 'bold' : 'regular'} />
            <span className="lbl">Basketball</span>
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
