// Analyse de tir : carte des tirs du match typique (positions réelles du moteur) et profil de tir simulé par équipe.
// Mêmes couleurs que le duel statistique : bleu = équipe extérieure, rose = équipe à domicile.
import { useState, type CSSProperties } from 'react';
import { n1, pct0, type Game, type Result, type Typical } from './data.ts';
import { Segmented, TeamMark } from './ui.tsx';

const ZONE_LABEL = ['Au cercle', 'Raquette', 'Mi-distance', '3 pts coin gauche', '3 pts coin droit', '3 pts de face'];
const CONTEST = ['défenseur collé (moins de 60 cm)', 'défenseur proche (60 cm à 1,2 m)', 'ouvert (1,2 à 1,8 m)', 'grand ouvert (plus de 1,8 m)'];

/** Demi-terrain en coordonnées NBA (dixièmes de pied, panier en 0,0, ligne de fond en haut). */
function Court() {
  return (
    <g className="court-lines">
      <rect x="-250" y="-47.5" width="500" height="365" />
      <path d="M -60 317.5 A 60 60 0 0 1 60 317.5" />
      <rect x="-80" y="-47.5" width="160" height="190" />
      <path d="M -60 142.5 A 60 60 0 0 0 60 142.5" />
      <path d="M -40 0 A 40 40 0 0 0 40 0" />
      <line x1="-220" y1="-47.5" x2="-220" y2="92.5" />
      <line x1="220" y1="-47.5" x2="220" y2="92.5" />
      <path d="M -220 92.5 A 237.5 237.5 0 0 0 220 92.5" />
      <line x1="-30" y1="-7.5" x2="30" y2="-7.5" />
      <circle cx="0" cy="0" r="7.5" />
    </g>
  );
}

export function ShotChart({ t, g }: { t: Typical; g: Game }) {
  const [side, setSide] = useState<'all' | 0 | 1>('all');
  if (!t.shots?.length) return null;
  const shots = t.shots.filter((s) => side === 'all' || s.s === side);
  const names = new Map(t.players.map((p) => [p.id, p.name]));
  const made = shots.filter((s) => s.m).length;
  return (
    <div className="shotchart">
      <div className="shotchart-head">
        <p className="caps">Carte de tirs</p>
        <Segmented<'all' | 0 | 1>
          ariaLabel="Équipe"
          value={side}
          onChange={setSide}
          options={[
            { value: 'all', label: 'Les deux' },
            { value: 1, label: g.away.tri },
            { value: 0, label: g.home.tri },
          ]}
        />
      </div>
      <svg key={side} viewBox="-256 -54 512 378" role="img" aria-label={`Carte de tirs : ${made} réussis sur ${shots.length}`}>
        <Court />
        {shots.map((s, i) => (
          <circle
            key={i}
            cx={s.x}
            cy={Math.min(s.y, 310)}
            r={s.m ? 6.5 : 5}
            className={`shot ${s.s === 0 ? 'home' : 'away'} ${s.m ? 'made' : 'miss'}`}
            style={{ '--d': `${Math.min(i * 5, 700)}ms` } as CSSProperties}
          >
            <title>
              {[names.get(s.p ?? -1), s.m ? 'réussi' : 'manqué', s.z != null ? ZONE_LABEL[s.z].toLowerCase() : '', s.c != null ? CONTEST[s.c] : ''].filter(Boolean).join(', ')}
            </title>
          </circle>
        ))}
      </svg>
      <div className="shotchart-legend">
        {side !== 0 && (
          <span>
            <i className="sw-shot away made" /> {g.away.tri} réussi <i className="sw-shot away miss" /> manqué
          </span>
        )}
        {side !== 1 && (
          <span>
            <i className="sw-shot home made" /> {g.home.tri} réussi <i className="sw-shot home miss" /> manqué
          </span>
        )}
        <span className="mono muted">
          {made}/{shots.length} tirs
        </span>
      </div>
    </div>
  );
}

export function ShotProfile({ r, g }: { r: Result; g: Game }) {
  const sp = r.shotProfile;
  if (!sp) return null;
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const A = sp.away;
  const H = sp.home;
  const share = (p: typeof A, z: number) => p.fga[z] / (sum(p.fga) || 1);
  const top = Math.max(...[0, 1, 2, 3, 4, 5].flatMap((z) => [share(A, z), share(H, z)]), 0.01);
  const fg = (p: typeof A, z: number) => (p.fga[z] > 0.05 ? pct0(p.fgm[z] / p.fga[z]) : '-');
  const close = (p: typeof A) => {
    const tot = sum(p.cont ?? []);
    return tot > 0 ? (p.cont[0] + p.cont[1]) / tot : undefined;
  };
  const extras: Array<[string, string, string]> = [];
  const cA = close(A);
  const cH = close(H);
  if (cA != null && cH != null) extras.push(['Tirs avec un défenseur à moins de 1,2 m', pct0(cA), pct0(cH)]);
  extras.push(['Tirs en contre-attaque', n1(A.transFga), n1(H.transFga)]);
  extras.push(['Paniers sur passe décisive', pct0(A.astM / (sum(A.fgm) || 1)), pct0(H.astM / (sum(H.fgm) || 1))]);
  return (
    <div className="profile">
      <div className="duel-legend">
        <span>
          <TeamMark team={g.away} size="sm" /> {g.away.name}
        </span>
        <span>
          {g.home.name} <TeamMark team={g.home} size="sm" />
        </span>
      </div>
      <div className="profile-grid">
        {[0, 1, 2, 3, 4, 5].map((z) => (
          <div className="profile-row" key={z} style={{ '--i': z } as CSSProperties}>
            <span className="pv mono">
              <b>{n1(A.fga[z])}</b> <small>{fg(A, z)}</small>
            </span>
            <span className="pbar away">
              <span style={{ width: `${(share(A, z) / top) * 100}%` }} />
            </span>
            <span className="pk">{ZONE_LABEL[z]}</span>
            <span className="pbar home">
              <span style={{ width: `${(share(H, z) / top) * 100}%` }} />
            </span>
            <span className="pv mono right">
              <small>{fg(H, z)}</small> <b>{n1(H.fga[z])}</b>
            </span>
          </div>
        ))}
      </div>
      <dl className="profile-extra">
        {extras.map(([k, a, h]) => (
          <div key={k}>
            <dd className="mono">{a}</dd>
            <dt>{k}</dt>
            <dd className="mono right">{h}</dd>
          </div>
        ))}
      </dl>
      <p className="note">
        Moyenne par match simulé : tirs tentés et réussite par zone. Chaque tir dépend des habitudes du tireur (zone, distance, type d'action), du défenseur qui le
        conteste et de la façon dont la défense adverse protège chaque zone.
      </p>
    </div>
  );
}
