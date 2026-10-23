// Joueurs à suivre : ceux dont les 5 000 simulations annoncent un gros match, avec la raison.
// Et l'avertissement quand la simulation précède l'annonce des compositions officielles.
import { ArrowClockwise, Info } from '@phosphor-icons/react';
import { n1, pct0, type Game, type Result } from './data.ts';
import { TeamMark } from './ui.tsx';

/** Joueurs à suivre : ceux que les simulations voient le plus souvent faire un gros match, et pourquoi. */
export function HotStrip({ r, g }: { r: Result; g: Game }) {
  const hot = r.players
    .filter((p) => p.heat && p.heat.pBig >= 0.1)
    .sort((a, b) => b.heat!.index - a.heat!.index)
    .slice(0, 4);
  if (!hot.length) return null;
  return (
    <aside className="watch" aria-label="Joueurs à suivre">
      <p className="watch-title">
        Joueurs à suivre <span>chance de dépasser largement sa moyenne</span>
      </p>
      <ol className="watch-list">
        {hot.map((p) => {
          const h = p.heat!;
          const team = p.side === 0 ? g.home : g.away;
          const why = [`${n1(h.base)} pts d'habitude`, ...h.reasons.slice(0, 2)].join(' · ');
          return (
            <li key={p.id}>
              <TeamMark team={team} size="sm" />
              <div className="watch-who">
                <span className="watch-name">{p.name}</span>
                <span className="watch-why" title={why}>
                  {why}
                </span>
              </div>
              <span className="watch-p mono">{pct0(h.pBig)}</span>
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
