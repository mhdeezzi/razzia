// Panneau du suivi : les paris ajoutés depuis les fiches, comme un combiné (cote totale, issue de chaque pari).
import { useEffect, useState } from 'react';
import { Trash, X } from '@phosphor-icons/react';
import { comboOdds, suivi, useResults, useSuivi, type Leg, type LegStatus } from './suivi.ts';
import { Link } from './ui.tsx';

const dec = (v: number) => v.toFixed(2).replace('.', ',');
const STATUS: Record<LegStatus, string> = { pending: 'À venir', live: 'En cours', won: 'Gagné', lost: 'Perdu' };
const when = (l: Leg) => new Date(l.start).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function SuiviPanel() {
  const [open, setOpen] = useState(false);
  const legs = useSuivi();
  const st = useResults(open ? legs : []);
  useEffect(() => {
    const on = () => setOpen(true);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('razzia-suivi-open', on);
    addEventListener('keydown', esc);
    return () => {
      removeEventListener('razzia-suivi-open', on);
      removeEventListener('keydown', esc);
    };
  }, []);
  if (!open) return null;
  const sorted = [...legs].sort((a, b) => a.start.localeCompare(b.start));
  const statuses = sorted.map((l) => st[l.key] ?? 'pending');
  const combo = statuses.includes('lost') ? 'lost' : statuses.length && statuses.every((s) => s === 'won') ? 'won' : statuses.includes('live') ? 'live' : 'pending';
  const total = comboOdds(sorted);
  // Paris d'un même match liés (la victoire passe aussi le handicap avec points d'avance) : on garde le moins probable.
  const byMatch = new Map<string, number>();
  for (const l of sorted) {
    const k = `${l.sport}:${l.date}:${l.match.id ?? `${l.match.away}@${l.match.home}`}`;
    byMatch.set(k, Math.min(byMatch.get(k) ?? 1, l.p));
  }
  const pAll = [...byMatch.values()].reduce((x, p) => x * p, 1);
  return (
    <div className="suivi-veil" onClick={() => setOpen(false)}>
      <aside className="suivi" role="dialog" aria-label="Suivi des paris" onClick={(e) => e.stopPropagation()}>
        <header className="suivi-head">
          <div>
            <h2>Suivi</h2>
            <p className="muted small">{legs.length ? `${legs.length} pari${legs.length > 1 ? 's' : ''} : un combiné` : 'Aucun pari suivi'}</p>
          </div>
          <button className="suivi-x" onClick={() => setOpen(false)} aria-label="Fermer">
            <X size={18} />
          </button>
        </header>
        {!legs.length ? (
          <p className="suivi-empty">Dans une fiche de match, touche « Suivre » sur un pari pour l'ajouter ici. Les paris suivis forment un combiné : tu vois la cote totale et l'issue une fois les matchs joués.</p>
        ) : (
          <>
            <ul className="suivi-list">
              {sorted.map((l, i) => (
                <li key={l.key} className={`suivi-leg ${statuses[i]}`}>
                  <Link href={l.path} className="suivi-leg-main">
                    <span className="suivi-leg-t">{l.title}</span>
                    <span className="suivi-leg-m">
                      {l.match.awayName} @ {l.match.homeName} · {when(l)}
                    </span>
                  </Link>
                  <span className="suivi-leg-o mono">{l.odds ? dec(l.odds) : '-'}</span>
                  <span className={`suivi-st ${statuses[i]}`}>{STATUS[statuses[i]]}</span>
                  <button className="suivi-rm" onClick={() => suivi.remove(l.key)} aria-label={`Retirer ${l.title}`}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <footer className="suivi-foot">
              <div>
                <p className="muted small">Cote totale</p>
                <p className="suivi-total mono">{dec(total)}</p>
              </div>
              <div>
                <p className="muted small">Passe dans les simulations</p>
                <p className="suivi-total mono">{(pAll * 100).toFixed(1).replace('.', ',')} %</p>
              </div>
              <span className={`suivi-st big ${combo}`}>{combo === 'won' ? 'Combiné gagné' : combo === 'lost' ? 'Combiné perdu' : combo === 'live' ? 'En cours' : 'À venir'}</span>
            </footer>
            <p className="suivi-note">Cote du bookmaker au moment de l'ajout (cote juste quand aucune n'était publiée). La probabilité du combiné suppose des matchs indépendants ; deux paris d'un même match comptent comme le moins probable des deux.</p>
            <button className="btn btn-quiet suivi-clear" onClick={() => suivi.clear()}>
              <Trash size={15} /> Tout retirer
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
