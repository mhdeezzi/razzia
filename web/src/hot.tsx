// « En feu ce soir » : les joueurs dont les 5 000 simulations annoncent un gros match, et pourquoi.
// Et l'avertissement quand la simulation précède l'annonce des compositions officielles.
import { type CSSProperties } from 'react';
import { ArrowClockwise, Info } from '@phosphor-icons/react';
import { n1, pct0, type Game, type Result } from './data.ts';
import { TeamMark } from './ui.tsx';

/** « En feu ce soir » : les joueurs que les simulations voient le plus souvent faire un gros match, et pourquoi. */
export function HotStrip({ r, g }: { r: Result; g: Game }) {
  const hot = r.players
    .filter((p) => p.heat && p.heat.pBig >= 0.1)
    .sort((a, b) => b.heat!.index - a.heat!.index)
    .slice(0, 4);
  if (!hot.length) return null;
  return (
    <aside className="hot" aria-label="Joueurs en feu">
      <div className="hot-head">
        <span className="hot-dot" aria-hidden="true" />
        <p className="hot-title">En feu ce soir</p>
        <p className="hot-sub">Chance de dépasser largement sa moyenne, sur {r.n.toLocaleString('fr-FR')} simulations</p>
      </div>
      <ol className="hot-grid">
        {hot.map((p, i) => {
          const h = p.heat!;
          const team = p.side === 0 ? g.home : g.away;
          return (
            <li key={p.id} className="hot-card" style={{ '--i': i } as CSSProperties}>
              <div className="hot-top">
                <TeamMark team={team} size="sm" />
                <p className="hot-name">{p.name}</p>
                <span className="hot-p mono">{pct0(h.pBig)}</span>
              </div>
              <div className="hot-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, h.pBig * 200)}%` }} />
              </div>
              <p className="hot-base">
                <b className="mono">{n1(h.base)}</b> pts d'habitude, gros match à <b className="mono">{h.threshold}</b> ou plus
              </p>
              {h.reasons.length > 0 && (
                <ul className="hot-why">
                  {h.reasons.slice(0, 2).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/** Les cinq de départ sont annoncés environ 30 minutes avant le match. */
export function LineupNotice({ r, g, onRelaunch, busy }: { r: Result; g: Game; onRelaunch: () => void; busy: boolean }) {
  const built = r.meta?.builtAt ? Date.parse(r.meta.builtAt) : undefined;
  const tip = Date.parse(g.start);
  if (r.meta?.lineupsConfirmed || built == null || built >= tip - 30 * 60e3) return null;
  const announced = Date.now() >= tip - 30 * 60e3 && g.state === 'pre';
  return (
    <div className="notice" role="status">
      <Info size={20} weight="fill" />
      <div>
        <p className="notice-title">Compositions pas encore officielles</p>
        <p>
          Simulé le {new Date(built).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} avec les compositions
          probables. Les cinq de départ sont annoncés environ 30 minutes avant le match : prudence sur les écarts serrés.
        </p>
      </div>
      {announced && (
        <button className="btn btn-ghost" onClick={onRelaunch} disabled={busy}>
          <ArrowClockwise size={16} /> Relancer avec les compos
        </button>
      )}
    </div>
  );
}
