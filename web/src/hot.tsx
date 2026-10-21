// « En feu ce soir » : les joueurs dont les 5 000 simulations annoncent un gros match, et pourquoi.
// Et l'avertissement quand la simulation précède l'annonce des compositions officielles.
import { useState, type CSSProperties } from 'react';
import { ArrowClockwise, Flame, Info } from '@phosphor-icons/react';
import { n1, pct0, type Game, type Result } from './data.ts';
import { TeamMark } from './ui.tsx';

const headshot = (id: number) => `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`;

function Face({ id, name }: { id: number; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');
  return (
    <span className="face">{failed ? <span className="face-init">{initials}</span> : <img src={headshot(id)} alt="" loading="lazy" onError={() => setFailed(true)} />}</span>
  );
}

export function HotPlayers({ r, g }: { r: Result; g: Game }) {
  const hot = r.players
    .filter((p) => p.heat && p.heat.pBig >= 0.1)
    .sort((a, b) => b.heat!.index - a.heat!.index)
    .slice(0, 4);
  return (
    <aside className="hot" aria-label="Joueurs en feu">
      <div className="hot-head">
        <span className="hot-flame">
          <Flame size={22} weight="fill" />
        </span>
        <div>
          <p className="hot-title">En feu ce soir</p>
          <p className="hot-sub">Les joueurs qui peuvent exploser, d'après les {r.n.toLocaleString('fr-FR')} simulations.</p>
        </div>
      </div>
      {hot.length === 0 ? (
        <p className="hot-empty">Aucun joueur ne sort nettement du lot sur ce match.</p>
      ) : (
        <ol className="hot-list">
          {hot.map((p, i) => {
            const h = p.heat!;
            const team = p.side === 0 ? g.home : g.away;
            const flames = h.pBig >= 0.35 ? 3 : h.pBig >= 0.2 ? 2 : 1;
            return (
              <li key={p.id} className="hot-card" style={{ '--i': i } as CSSProperties}>
                <div className="hot-top">
                  <div className="hot-face">
                    <Face id={p.id} name={p.name} />
                    <span className="hot-team">
                      <TeamMark team={team} size="sm" />
                    </span>
                  </div>
                  <div className="hot-id">
                    <p className="hot-name">{p.name}</p>
                    <p className="hot-flames" aria-label={`Intensité ${flames} sur 3`}>
                      {Array.from({ length: 3 }, (_, k) => (
                        <Flame key={k} size={15} weight="fill" className={k < flames ? 'on' : ''} />
                      ))}
                    </p>
                  </div>
                  <div className="hot-p">
                    <span className="mono">{pct0(h.pBig)}</span>
                    <small>gros match</small>
                  </div>
                </div>
                <p className="hot-line">
                  <b className="mono">{n1(h.mean)}</b> pts simulés en moyenne, <b className="mono">{Math.round(h.p90)}</b> ou plus dans 1 simulation sur 10.
                  Gros match : {h.threshold} pts ou plus ({n1(h.base)} habituellement).
                </p>
                {h.reasons.length > 0 && (
                  <ul className="hot-why">
                    {h.reasons.slice(0, 3).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
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
