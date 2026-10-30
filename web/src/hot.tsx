// « En feu ce soir » : les joueurs dont les 5 000 simulations annoncent un gros match, et pourquoi.
// Et l'avertissement quand la simulation précède l'annonce des compositions officielles.
import { useState, type CSSProperties } from 'react';
import { ArrowClockwise, Info, Minus, Plus } from '@phosphor-icons/react';
import { matchPath, n1, pct0, teamColor, type Game, type Result } from './data.ts';
import { FollowBtn } from './follow.tsx';
import { pOverPts } from './picks.ts';
import { TeamMark } from './ui.tsx';

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
 * Une seule petite lumière orange en haut à droite de la section ; cartes noires au contour neutre ; la chance en grand chiffre, barre fine, raisons en texte.
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
        {hot.map((p, i) => (
          <FeuCard key={p.id} p={p} g={g} i={i} top={top} />
        ))}
      </ol>
    </section>
  );
}

const fmt = (v: number) => v.toFixed(1).replace('.', ',');

/** Carte d'un joueur en feu, avec son pari : plus ou moins de N,5 points (ligne réglable), cote juste des simulations. */
function FeuCard({ p, g, i, top }: { p: Player; g: Game; i: number; top: number }) {
  const h = p.heat!;
  const team = p.side === 0 ? g.home : g.away;
  // Même ligne de départ pour tous : 19,5 points, à régler ensuite.
  const [line, setLine] = useState(19.5);
  const [over, setOver] = useState(true);
  const d = p.stats?.pts;
  const pOver = d ? pOverPts(d, line) : undefined;
  const pBet = pOver == null ? undefined : over ? pOver : 1 - pOver;
  const odds = pBet ? Math.round((1 / pBet) * 100) / 100 : undefined;
  const title = `${p.name} : ${over ? 'plus' : 'moins'} de ${fmt(line)} pts`;
  return (
    <li className="feu-card" style={{ '--i': i, '--tc': teamColor(team) } as CSSProperties}>
      <div className="feu-who">
        <Face p={p} team={team} />
        <div className="feu-id">
          <p className="feu-name">{p.name}</p>
          <p className="feu-team">
            {team.name} · seuil {h.threshold}+ pts ({n1(h.base)} d'habitude)
          </p>
        </div>
      </div>
      <p className="feu-lab">Chance de gros match</p>
      <p className="feu-p">{pct0(h.pBig)}</p>
      <div className="feu-meter" role="img" aria-label={`Chance de gros match : ${pct0(h.pBig)}`}>
        <span style={{ width: `${Math.max(6, (100 * h.pBig) / top)}%` }} />
      </div>
      {h.reasons.length > 0 && <p className="feu-why">{h.reasons.slice(0, 3).map((t) => (detail(t) ? `${short(t)} : ${detail(t)}` : short(t))).join(' · ')}</p>}
      {pBet != null && odds != null && (
        <div className="feu-bet">
          <div className="feu-line">
            <div className="feu-ou" role="group" aria-label="Plus ou moins">
              <button className={over ? 'is-on' : ''} onClick={() => setOver(true)}>
                Plus
              </button>
              <button className={!over ? 'is-on' : ''} onClick={() => setOver(false)}>
                Moins
              </button>
            </div>
            <div className="feu-step">
              <button onClick={() => setLine(Math.max(0.5, line - 1))} aria-label="Un point de moins">
                <Minus size={13} weight="bold" />
              </button>
              <b className="mono">{fmt(line)}</b>
              <button onClick={() => setLine(line + 1)} aria-label="Un point de plus">
                <Plus size={13} weight="bold" />
              </button>
            </div>
            <span className="feu-odds">
              {pct0(pBet)} · cote juste <b className="mono">{odds.toFixed(2).replace('.', ',')}</b>
            </span>
          </div>
          <FollowBtn
            small
            leg={() => ({
              key: `nba:${g.date}:${g.away.tri}@${g.home.tri}:pts-${p.id}-${over ? 'p' : 'm'}${line}`,
              sport: 'nba', date: g.date, start: g.start, path: matchPath(g),
              match: { home: g.home.tri, away: g.away.tri, homeName: g.home.name, awayName: g.away.name },
              oid: 'pts', title, odds, fair: true, p: pBet, at: '',
              bet: { kind: 'pts', side: p.side === 0 ? 'home' : 'away', line, over, player: p.name, event: g.id },
            })}
          />
        </div>
      )}
    </li>
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
