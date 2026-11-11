// Barre du haut : îlot de verre fumé qui flotte en haut de page, logo razzia (vectoriel), sports et Live dans une
// pilule où le verre clair glisse vers l'onglet choisi, Suivi puis Compte tout à droite.
import { useRef } from 'react';
import { Basketball, Broadcast, ListChecks, SoccerBall, TennisBall, UserCircle } from '@phosphor-icons/react';
import { useSlip } from './suivi.ts';
import { useUnseen } from './suivipage.tsx';
import { LIVE, Link, useNowPath, useSlider } from './ui.tsx';
import { Logo } from './logo.tsx';

export function TopBar() {
  const path = useNowPath();
  // Suivi et Compte ne sont d'aucun sport : aucun sport allumé, c'est leur bouton qui l'est.
  const own = path === '/suivi' || path === '/compte';
  const tennis = path.startsWith('/tennis');
  // Football à l'accueil ; le basket a son adresse (/basket) et ses fiches (/match/...).
  const nba = path.startsWith('/basket') || path.startsWith('/match');
  const live = LIVE && path.startsWith('/live');
  const foot = !tennis && !nba && !own && !live;
  // Simulations, Bilan, Badges et Méthode restent accessibles par leur adresse ; à droite : Suivi puis Compte.
  const links = [
    { href: '/compte', label: 'Compte', icon: <UserCircle size={19} />, on: path === '/compte', cls: 'top-account' },
  ];
  const nav = useRef<HTMLElement>(null);
  const pos = useSlider(nav, '.sport.is-on', `${tennis}${foot}${nba}${live}`);
  const legs = useSlip();
  const unseen = useUnseen();
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label="Razzia, programme du jour">
          <Logo size={30} />
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
          {LIVE && <Link href="/live" className={`sport sport-live${live ? ' is-on' : ''}`} aria-current={path === '/live' ? 'page' : undefined} title="Simulation en direct">
            <span className="live-ico">
              <Broadcast size={18} weight={live ? 'bold' : 'regular'} />
            </span>
            <span className="lbl">Live</span>
          </Link>}
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
