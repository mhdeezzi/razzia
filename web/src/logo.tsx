// Logo razzia en haute définition. Deux couleurs : le symbole vert d'origine (barre du haut, symbole seul) et la version
// argent pour le logo complet (pied de page, accueil). Sur téléphone, la barre du haut n'affiche que le symbole.
import full from './assets/razzia-logo-hd.webp';
import fullSilver from './assets/razzia-logo-argent.webp';
import mark from './assets/razzia-mark.webp';

export function Logo({ size = 30, className = '', tone = 'silver' }: { size?: number; className?: string; tone?: 'green' | 'silver' }) {
  return (
    <span className={`logo ${className}`} style={{ '--lh': `${size}px` } as React.CSSProperties}>
      <img className="logo-full" src={tone === 'green' ? full : fullSilver} alt="Razzia" width={3604} height={762} />
      <img className="logo-mark" src={mark} alt="Razzia" width={1164} height={762} />
    </span>
  );
}
