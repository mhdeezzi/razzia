// Logo razzia : l'image d'origine, reprise en haute définition (symbole et nom séparés, agrandis x3). Sur téléphone,
// la barre du haut n'affiche que le symbole.
import full from './assets/razzia-logo-hd.webp';
import mark from './assets/razzia-mark.webp';

export function Logo({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`logo ${className}`} style={{ '--lh': `${size}px` } as React.CSSProperties}>
      <img className="logo-full" src={full} alt="Razzia" width={3604} height={762} />
      <img className="logo-mark" src={mark} alt="Razzia" width={1164} height={762} />
    </span>
  );
}
