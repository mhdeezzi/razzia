// « En feu ce soir » : les joueurs dont les 5 000 simulations annoncent un gros match, et pourquoi.
// Et l'avertissement quand la simulation précède l'annonce des compositions officielles.
import { useState, type CSSProperties } from 'react';
import { ArrowClockwise, Info } from '@phosphor-icons/react';
import { n1, pct0, teamColor, type Game, type Result } from './data.ts';
import { glow, TeamMark } from './ui.tsx';

type Player = Result['players'][number];

/** Photo officielle du joueur (cdn.nba.com, identifiant NBA) ; à défaut, le logo de son équipe. */
const headshot = (id: number) => `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`;

/** Libellé court d'une raison : « En forme », « Défense favorable », « Plus de minutes »… */
const short = (t: string) => {
  const head = t.split(' : ')[0];
  if (head.startsWith('Plus de temps de jeu')) return 'Plus de minutes';
  if (head === 'Joue à domicile') return 'À domicile';
  return head;
};
/** Le chiffre qui justifie la raison, raccourci : « 31,2 pts sur 10 matchs », « 37 min ». */
const detail = (t: string) =>
  t.includes(' : ')
    ? t.split(' : ')[1].replace(/ \(.*\)$/, '').replace(' sur ses 10 derniers matchs', ' sur 10 matchs').replace(' de moyenne', '').replace(/ contre .* habituels$/, '').replace(' attendues', '')
    : '';

function Face({ p, team }: { p: Player; team: Game['home'] }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="feu-face">
      <span className="feu-photo">
        {failed ? <TeamMark team={team} size="md" /> : <img src={headshot(p.id)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}
      </span>
      {!failed && <TeamMark team={team} size="sm" />}
    </span>
  );
}

/**
 * « En feu ce soir » : les joueurs que les simulations voient le plus souvent faire un gros match, et pourquoi.
 * Carte noire au contour neutre, petite lumière de la couleur de l'équipe en haut à droite ; chance de gros match, seuil en grand, jauge, raisons.
 */
export function HotStrip({ r, g }: { r: Result; g: Game }) {
  // Les quatre plus chauds, rangés par chance de gros match : 1 en haut à gauche, 2 en haut à droite, 3 et 4 dessous.
  const hot = r.players
    .filter((p) => p.heat && p.heat.pBig >= 0.1)
    .sort((a, b) => b.heat!.index - a.heat!.index)
    .slice(0, 4)
    .sort((a, b) => b.heat!.pBig - a.heat!.pBig);
  if (!hot.length) return null;
  // Jauge : pleine à la plus forte chance du match, pour comparer les joueurs entre eux.
  const top = hot[0].heat!.pBig;
  return (
    <section className="section" aria-label="Joueurs en feu">
      <div className="section-head">
        <h3>En feu ce soir</h3>
        <span className="slash">chance de gros match</span>
      </div>
      <ol className="feu">
        {hot.map((p, i) => {
          const h = p.heat!;
          const team = p.side === 0 ? g.home : g.away;
          return (
            <li key={p.id} className="feu-card" style={{ '--i': i, '--tc': teamColor(team), '--glow': glow(teamColor(team)) } as CSSProperties}>
              <div className="feu-who">
                <Face p={p} team={team} />
                <div className="feu-id">
                  <p className="feu-name">{p.name}</p>
                  <p className="feu-team">{team.name}</p>
                </div>
                <span className="feu-p">{pct0(h.pBig)}</span>
              </div>
              <div className="feu-bet">
                <p className="feu-line">
                  {h.threshold}+<small>pts</small>
                </p>
                <p className="feu-base">{n1(h.base)} pts d'habitude</p>
              </div>
              <div className="feu-meter" role="img" aria-label={`Chance de gros match : ${pct0(h.pBig)}`}>
                <span style={{ width: `${Math.max(6, (100 * h.pBig) / top)}%` }} />
              </div>
              {h.reasons.length > 0 && (
                <ul className="feu-why">
                  {h.reasons.slice(0, 3).map((t) => (
                    <li key={t} title={t}>
                      {short(t)}
                      {detail(t) && <span>{detail(t)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
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
