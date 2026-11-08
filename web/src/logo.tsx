// Logo razzia redessiné en vectoriel (net à toutes les tailles) : deux disques aux trois quarts qui s'emboîtent, dégradés
// cyan-violet et vert-bleu, et le nom en texte, gris argent. Sur téléphone, le symbole seul (classe .logo-word masquée).
import { useId } from 'react';

export function LogoMark({ size = 30 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="logo-mark" viewBox="0 0 124 82" height={size} width={(size * 124) / 82} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}a`} cx="46%" cy="52%" r="58%">
          <stop offset="0" stopColor="#3df0ff" />
          <stop offset="0.45" stopColor="#36e6f2" />
          <stop offset="0.75" stopColor="#4fd4c8" />
          <stop offset="1" stopColor="#7a6cf2" />
        </radialGradient>
        <radialGradient id={`${id}b`} cx="0%" cy="50%" r="100%">
          <stop offset="0" stopColor="#4a7bff" />
          <stop offset="0.28" stopColor="#36d6f0" />
          <stop offset="0.55" stopColor="#45ef8a" />
          <stop offset="1" stopColor="#52f56a" />
        </radialGradient>
      </defs>
      <path d="M41 41 L41 1 A40 40 0 1 0 81 41 Z" fill={`url(#${id}a)`} />
      <path d="M83 41 L83 81 A40 40 0 1 0 43 41 Z" fill={`url(#${id}b)`} />
    </svg>
  );
}

export function Logo({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`logo ${className}`} style={{ '--lh': `${size}px` } as React.CSSProperties} aria-label="Razzia" role="img">
      <LogoMark size={size} />
      <span className="logo-word" aria-hidden="true">razzia</span>
    </span>
  );
}
