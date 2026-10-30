// Bouton « Suivre » d'un pari (fiche de match, En feu ce soir) : l'ajoute au ticket en préparation ou l'en retire. Quand
// on complète un ticket simple, il devient « Compléter le ticket » : le pari rejoint ce ticket, même mise, cote du moment.
import { useState, type MouseEvent } from 'react';
import { Check, Plus } from '@phosphor-icons/react';
import { useAuth } from './auth.ts';
import { freshOdds } from './liveodds.ts';
import { completeTicket, completing, matchKey, slip, useCompleting, useSlip, useTickets, type Leg } from './suivi.ts';
import { toast } from './toast.tsx';
import { Link, navigate } from './ui.tsx';

const dec = (v: number) => v.toFixed(2).replace('.', ',');

export function FollowBtn({ leg, small }: { leg: () => Leg; small?: boolean }) {
  const legs = useSlip();
  const c = useCompleting();
  const { user } = useAuth();
  const { tickets } = useTickets(user?.id);
  const [busy, setBusy] = useState(false);
  const l0 = leg();
  if (c) {
    const t = tickets?.find((x) => x.id === c.id);
    const same = c.matches.includes(matchKey(l0));
    const started = Date.parse(l0.start) <= Date.now();
    const go = async () => {
      if (!user || !t) return;
      setBusy(true);
      try {
        // Cote du moment : relue juste avant d'ajouter le pari.
        const f = (await freshOdds([l0]))[l0.key];
        if (!f) throw new Error('Ce pari n’est plus proposé (match commencé ?).');
        const next = { ...l0, odds: f.odds, fair: f.fair, p: f.p, title: f.title, bet: f.bet };
        await completeTicket(user.id, t, next);
        completing.set(null);
        toast({ tone: 'ok', title: 'Ticket complété', text: `${next.title} ajouté · cote ${dec(t.odds * f.odds)}, mise inchangée`, href: '/suivi' });
        navigate('/suivi');
      } catch (e) {
        toast({ tone: 'bad', title: 'Impossible de compléter', text: (e as Error).message });
      }
      setBusy(false);
    };
    return (
      <span className="follow">
        <button className={`btn btn-primary follow-btn${small ? ' sm' : ''}`} disabled={busy || same || started || !t} onClick={() => void go()}>
          {busy ? <span className="spin spin-xs" /> : <Plus size={15} weight="bold" />} Compléter le ticket
        </button>
        {(same || started) && <span className="follow-note">{same ? 'Ce match est déjà dans le ticket' : 'Match commencé'}</span>}
      </span>
    );
  }
  const on = legs.some((l) => l.key === l0.key);
  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    if (on) return slip.remove(l0.key);
    slip.add({ ...l0, at: new Date().toISOString() });
    flyToSuivi(e.currentTarget);
  };
  return (
    <span className="follow">
      <button className={`btn glass follow-btn${on ? ' is-on' : ''}${small ? ' sm' : ''}`} onClick={toggle}>
        {on ? <Check size={15} weight="bold" /> : <Plus size={15} weight="bold" />} {on ? 'Dans le ticket' : 'Suivre'}
      </button>
      {on && !small && (
        <Link href="/suivi" className="follow-link">
          Voir le ticket ({legs.length})
        </Link>
      )}
    </span>
  );
}

/** Ajout au ticket : un point vert part du bouton et file jusqu'au bouton Suivi de la barre du haut, qui rebondit. */
function flyToSuivi(from: HTMLElement) {
  const to = document.querySelector<HTMLElement>('.top-suivi');
  if (!to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const dot = document.createElement('span');
  dot.className = 'fly-dot';
  dot.style.left = `${a.left + a.width / 2 - 7}px`;
  dot.style.top = `${a.top + a.height / 2 - 7}px`;
  document.body.appendChild(dot);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  // Trajet en arc : un peu de hauteur à mi-chemin, puis le point rétrécit en arrivant.
  const anim = dot.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(0.9)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0.6 },
    ],
    { duration: 560, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  );
  anim.onfinish = () => {
    dot.remove();
    to.classList.remove('bump');
    void to.offsetWidth;
    to.classList.add('bump');
  };
}
