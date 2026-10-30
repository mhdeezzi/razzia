// Match typique au tennis : la simulation la plus représentative (vainqueur du pronostic, score en sets le plus
// fréquent, nombre de jeux proche de la médiane), rejouée point par point. Score, chances jeu par jeu, temps forts.
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { pct0 } from './data.ts';
import { smoothPath } from './typical.tsx';
import type { TennisResult } from './tennis.tsx';

export interface TypicalTennis {
  index: number;
  winner: 'A' | 'B';
  sets: Array<[number, number]>;
  games: Array<{ s: number; a: number; b: number; srv: 0 | 1; brk?: 1; tb?: [number, number]; wp: number }>;
  wp0: number;
  stats: Array<{ srvPts: number; srvWon: number; pts: number; bp: number; bpWon: number }>;
}

// Nom de famille, avec sa particule (« De Minaur », « Van de Zandschulp »).
const PARTICLE = new Set(['de', 'da', 'di', 'del', 'della', 'van', 'von', 'der', 'den', 'du', 'le', 'la', 'dos', 'das']);
const last = (name: string) => {
  const w = name.split(' ');
  let i = w.length - 1;
  while (i > 1 && PARTICLE.has(w[i - 1].toLowerCase())) i--;
  return w.slice(i).join(' ');
};
const ord = (i: number) => (i === 0 ? '1er' : `${i + 1}e`);

export function TennisTypical({ r, t }: { r: TennisResult; t: TypicalTennis }) {
  const names = [last(r.home.name), last(r.away.name)];
  const won = t.winner === 'A' ? 0 : 1;
  // Jeu décisif de chaque set (points du perdant du jeu décisif en exposant, comme sur les tableaux de score).
  const tbOf = (s: number) => t.games.find((g) => g.s === s && g.tb)?.tb;
  return (
    <div className="typ">
      <table className="t-board">
        <tbody>
          {[r.home, r.away].map((p, k) => (
            <tr key={k} className={k === won ? 'won' : ''}>
              <th scope="row">{p.name}</th>
              {t.sets.map((s, i) => {
                const tb = tbOf(i);
                const mine = s[k], other = s[1 - k];
                return (
                  <td key={i} className={`mono${mine > other ? ' strong' : ''}`}>
                    {mine}
                    {tb && mine < other && <sup>{tb[k]}</sup>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="typ-facts">
        <span>
          Simulation n° <b className="mono">{(t.index + 1).toLocaleString('fr-FR')}</b> sur {r.sim.n.toLocaleString('fr-FR')}
        </span>
        <span>
          <b className="mono">{t.games.length}</b> jeux
        </span>
      </div>
      <TennisFlow r={r} t={t} names={names} />
      <Moments t={t} names={names} />
      <Stats t={t} names={names} />
    </div>
  );
}

/** Chances de victoire du joueur 1 jeu après jeu : au-dessus de l'axe il est favori (rouge), en dessous l'autre (bleu). */
function TennisFlow({ t, names }: { r: TennisResult; t: TypicalTennis; names: string[] }) {
  const W = 1000;
  const H = 220;
  const pts = [{ k: 0, wp: t.wp0, label: 'Avant le match' }, ...t.games.map((g, i) => ({ k: i + 1, wp: g.wp, label: `${ord(g.s)} set · ${g.a}-${g.b}` }))];
  const end = pts.length - 1 || 1;
  const x = (k: number) => (k / end) * W;
  const y = (wp: number) => H / 2 - (wp - 0.5) * (H - 28);
  const d = useMemo(() => smoothPath(pts.map((p) => [x(p.k), y(p.wp)])), [t]);
  const area = `${d}L${W},${H / 2}L0,${H / 2}Z`;
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number>();
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const b = ref.current!.getBoundingClientRect();
    setHover(Math.max(0, Math.min(end, Math.round(((e.clientX - b.left) / b.width) * end))));
  };
  const h = hover != null ? pts[hover] : undefined;
  // Fin de chaque set (numéro du dernier jeu du set) : lignes de séparation et étiquettes.
  const setEnds = t.sets.map((_, s) => t.games.findLastIndex((g) => g.s === s) + 1);
  return (
    <figure className="flow">
      <div ref={ref} className="flow-chart" onPointerMove={onMove} onPointerLeave={() => setHover(undefined)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Chances de victoire jeu après jeu pendant le match typique">
          <defs>
            <clipPath id="tf-top">
              <rect x="0" y="0" width={W} height={H / 2} />
            </clipPath>
            <clipPath id="tf-bot">
              <rect x="0" y={H / 2} width={W} height={H / 2} />
            </clipPath>
            <linearGradient id="tf-gh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--rose)" stopOpacity="0.5" />
              <stop offset="1" stopColor="var(--rose)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="tf-ga" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="var(--blue)" stopOpacity="0.5" />
              <stop offset="1" stopColor="var(--blue)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {setEnds.slice(0, -1).map((k) => (
            <line key={k} x1={x(k)} x2={x(k)} y1="0" y2={H} className="flow-grid" />
          ))}
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="flow-axis" />
          <g className="flow-draw">
            <path d={area} fill="url(#tf-gh)" clipPath="url(#tf-top)" />
            <path d={area} fill="url(#tf-ga)" clipPath="url(#tf-bot)" />
            <path d={d} className="flow-line home" clipPath="url(#tf-top)" />
            <path d={d} className="flow-line away" clipPath="url(#tf-bot)" />
          </g>
          {h && <line x1={x(h.k)} x2={x(h.k)} y1="0" y2={H} className="flow-cursor" />}
        </svg>
        <span className="flow-side top">{names[0]} favori</span>
        <span className="flow-side bot">{names[1]} favori</span>
        {h && (
          <span className={`flow-tip mono${x(h.k) > W * 0.7 ? ' left' : ''}`} style={{ left: `${(100 * x(h.k)) / W}%` }}>
            <b>{h.label}</b>
            <small>
              {' '}
              · {names[h.wp >= 0.5 ? 0 : 1]} {pct0(Math.max(h.wp, 1 - h.wp))}
            </small>
          </span>
        )}
      </div>
      <div className="flow-axis-labels mono t-flow-sets">
        {setEnds.map((k, s) => (
          <span key={s} style={{ flex: k - (s ? setEnds[s - 1] : 0) }}>
            {ord(s)} set
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Temps forts : breaks, jeux décisifs, fin de chaque set. */
function Moments({ t, names }: { t: TypicalTennis; names: string[] }) {
  const items: Array<{ when: string; text: string; score: string }> = [];
  let sa = 0, sb = 0; // sets gagnés par chacun
  t.games.forEach((g, i) => {
    const when = `${ord(g.s)} set`;
    const games = `${g.a}-${g.b}`;
    if (g.brk) items.push({ when, text: `Break de ${names[1 - g.srv]}`, score: games });
    if (g.tb) items.push({ when, text: `Jeu décisif pour ${names[g.tb[0] > g.tb[1] ? 0 : 1]}, ${Math.max(...g.tb)}-${Math.min(...g.tb)}`, score: games });
    const next = t.games[i + 1];
    if (!next || next.s !== g.s) {
      if (g.a > g.b) sa++;
      else sb++;
      const w = g.a > g.b ? 0 : 1;
      items.push({ when, text: !next ? `${names[w]} gagne le match, ${Math.max(sa, sb)} sets à ${Math.min(sa, sb)}` : `${names[w]} gagne le ${ord(g.s)} set`, score: games });
    }
  });
  if (!items.length) return null;
  return (
    <div className="moments">
      <p className="caps">Temps forts</p>
      <ol>
        {items.map((m, i) => (
          <li key={i} className="t-moment">
            <span className="mono muted">{m.when}</span>
            <span>{m.text}</span>
            <span className="mono">{m.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Stats({ t, names }: { t: TypicalTennis; names: string[] }) {
  const [a, b] = t.stats;
  const pc = (x: number, n: number) => (n ? `${Math.round((100 * x) / n)} %` : '-');
  const rows: Array<[string, string, string]> = [
    ['Points gagnés', String(a.pts), String(b.pts)],
    ['Points gagnés au service', `${a.srvWon}/${a.srvPts} (${pc(a.srvWon, a.srvPts)})`, `${b.srvWon}/${b.srvPts} (${pc(b.srvWon, b.srvPts)})`],
    ['Balles de break converties', `${a.bpWon}/${a.bp}`, `${b.bpWon}/${b.bp}`],
  ];
  return (
    <div className="t-stats">
      <span />
      <b>{names[0]}</b>
      <b>{names[1]}</b>
      {rows.map(([l, x, y]) => (
        <div key={l} className="t-stats-row">
          <span>{l}</span>
          <span className="mono">{x}</span>
          <span className="mono">{y}</span>
        </div>
      ))}
    </div>
  );
}
