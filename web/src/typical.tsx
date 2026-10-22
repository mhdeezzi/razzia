// Le match typique : la simulation la plus représentative des 5 000 (vainqueur majoritaire, score proche de la
// médiane, chaque joueur proche de sa moyenne). Score, déroulé, temps forts et feuille de match.
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { pct0, type Game, type Typical } from './data.ts';
import { Segmented, TeamMark } from './ui.tsx';
import { ShotChart } from './court.tsx';

const REG = 2880;
const periodStart = (p: number) => (p <= 4 ? (p - 1) * 720 : REG + (p - 5) * 300);
const clockAt = (t: number) => {
  const p = t < REG ? Math.floor(t / 720) + 1 : 5 + Math.floor((t - REG) / 300);
  const len = p <= 4 ? 720 : 300;
  const left = Math.max(0, len - (t - periodStart(p)));
  return `${p <= 4 ? `Q${p}` : `Prol.${p > 5 ? ` ${p - 4}` : ''}`} ${Math.floor(left / 60)}:${String(Math.round(left % 60)).padStart(2, '0')}`;
};

export function TypicalGame({ t, g }: { t: Typical; g: Game }) {
  const homeWon = t.home.pts > t.away.pts;
  const periods = Math.max(t.home.q.length, t.away.q.length);
  return (
    <div className="typ">
      <div className="typ-score">
        <div className={`typ-side ${homeWon ? '' : 'won'}`}>
          <TeamMark team={g.away} size="lg" />
          <span className="typ-name">{g.away.name}</span>
          <span className="typ-pts mono">{t.away.pts}</span>
        </div>
        <span className="typ-final">Final{periods > 4 ? ` (prol.)` : ''}</span>
        <div className={`typ-side home ${homeWon ? 'won' : ''}`}>
          <span className="typ-pts mono">{t.home.pts}</span>
          <span className="typ-name">{g.home.name}</span>
          <TeamMark team={g.home} size="lg" />
        </div>
      </div>
      <div className="typ-facts">
        <span>
          Simulation n° <b className="mono">{(t.index + 1).toLocaleString('fr-FR')}</b> sur {t.n.toLocaleString('fr-FR')}
        </span>
        <span>
          <b className="mono">{t.leadChanges}</b> changement{t.leadChanges > 1 ? 's' : ''} de leader
        </span>
        <span>
          Plus grosse avance : {g.home.tri} <b className="mono">+{t.largestLead[0]}</b>, {g.away.tri} <b className="mono">+{t.largestLead[1]}</b>
        </span>
      </div>

      <Flow t={t} g={g} />

      <div className="scroll-x">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="sticky">Score</th>
              {Array.from({ length: periods }, (_, i) => (
                <th key={i}>{i < 4 ? `Q${i + 1}` : `Prol.${i > 4 ? ` ${i - 3}` : ''}`}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(['away', 'home'] as const).map((side) => (
              <tr key={side}>
                <th scope="row" className="sticky">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <TeamMark team={g[side]} size="sm" /> {g[side].name}
                  </span>
                </th>
                {t[side].q.map((v, i) => (
                  <td key={i} className="mono">
                    {v}
                  </td>
                ))}
                <td className="mono strong">{t[side].pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {t.moments.length > 0 && (
        <div className="moments">
          <p className="caps">Temps forts</p>
          <ol>
            {t.moments.map((m, i) => {
              const team = m.side === 0 ? g.home : m.side === 1 ? g.away : undefined;
              return (
                <li key={i}>
                  <span className="mono muted">{m.when}</span>
                  {team ? <TeamMark team={team} size="sm" /> : <span />}
                  <span>{m.text}</span>
                  <span className="mono">{m.score}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <ShotChart t={t} g={g} />

      <BoxScore t={t} g={g} />
    </div>
  );
}

/** Écart au score au fil du match : au-dessus de l'axe, l'équipe à domicile mène ; en dessous, l'équipe extérieure. */
function Flow({ t, g }: { t: Typical; g: Game }) {
  const W = 1000;
  const H = 220;
  const pts = t.flow;
  const end = pts.length ? pts[pts.length - 1].t : REG;
  const maxAbs = Math.max(10, ...pts.map((p) => Math.abs(p.h - p.a)));
  const x = (s: number) => (s / end) * W;
  const y = (m: number) => H / 2 - (m / maxAbs) * (H / 2 - 12);
  const d = useMemo(() => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.h - p.a).toFixed(1)}`).join(''), [pts]);
  const area = `${d}L${W},${H / 2}L0,${H / 2}Z`;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number>();
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const s = ((e.clientX - r.left) / r.width) * end;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t - s) < Math.abs(pts[best].t - s)) best = i;
    setHover(best);
  };
  const h = hover != null ? pts[hover] : undefined;
  const marks = [720, 1440, 2160, ...(end > REG ? [REG] : [])];
  return (
    <figure className="flow">
      <div className="flow-legend">
        <span>
          <i className="sw sw-home" /> {g.home.name} mène
        </span>
        <span>
          <i className="sw sw-away" /> {g.away.name} mène
        </span>
        {h && (
          <span className="flow-tip mono">
            {clockAt(h.t)} | {g.away.tri} {h.a} - {h.h} {g.home.tri}
            {h.wp != null && ` | ${g.home.tri} ${pct0(h.wp)}`}
          </span>
        )}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHover(undefined)} role="img" aria-label="Écart au score pendant le match typique">
        <defs>
          <clipPath id="fl-top">
            <rect x="0" y="0" width={W} height={H / 2} />
          </clipPath>
          <clipPath id="fl-bot">
            <rect x="0" y={H / 2} width={W} height={H / 2} />
          </clipPath>
          <linearGradient id="fl-gh" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--rose)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--rose)" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="fl-ga" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="var(--blue)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--blue)" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {marks.map((m) => (
          <line key={m} x1={x(m)} x2={x(m)} y1="0" y2={H} className="flow-grid" />
        ))}
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="flow-axis" />
        <g className="flow-draw">
          <path d={area} fill="url(#fl-gh)" clipPath="url(#fl-top)" />
          <path d={area} fill="url(#fl-ga)" clipPath="url(#fl-bot)" />
          <path d={d} className="flow-line" clipPath="url(#fl-top)" style={{ stroke: 'var(--rose)' }} />
          <path d={d} className="flow-line" clipPath="url(#fl-bot)" style={{ stroke: 'var(--blue)' }} />
        </g>
        {h && <line x1={x(h.t)} x2={x(h.t)} y1="0" y2={H} className="flow-cursor" />}
      </svg>
      <div className="flow-axis-labels mono">
        {['Q1', 'Q2', 'Q3', 'Q4', ...(end > REG ? ['Prol.'] : [])].map((q) => (
          <span key={q}>{q}</span>
        ))}
      </div>
    </figure>
  );
}

function BoxScore({ t, g }: { t: Typical; g: Game }) {
  const [side, setSide] = useState<'away' | 'home'>('away');
  const names = useMemo(() => new Map(t.players.map((p) => [p.id, p.name])), [t]);
  const lines = [...t[side].lines].sort((a, b) => b.min - a.min);
  return (
    <div className="box-score">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p className="caps">Feuille de match</p>
        <Segmented<'away' | 'home'>
          ariaLabel="Équipe"
          value={side}
          onChange={setSide}
          options={[
            { value: 'away', label: <><TeamMark team={g.away} size="sm" /> {g.away.name}</> },
            { value: 'home', label: <><TeamMark team={g.home} size="sm" /> {g.home.name}</> },
          ]}
        />
      </div>
      <div className="scroll-x" key={side}>
        <table className="grid-table">
          <thead>
            <tr>
              <th className="sticky">Joueur</th>
              <th>MIN</th>
              <th>PTS</th>
              <th>REB</th>
              <th>PD</th>
              <th>Tirs</th>
              <th>3 pts</th>
              <th>LF</th>
              <th>INT</th>
              <th>CTR</th>
              <th>BP</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <th scope="row" className="sticky">
                  {names.get(l.id) ?? l.id}
                  {l.started && <span className="tag" style={{ marginLeft: 8 }}>Titulaire</span>}
                </th>
                <td className="mono">{Math.round(l.min)}</td>
                <td className="mono strong">{l.pts}</td>
                <td className="mono">{l.reb}</td>
                <td className="mono">{l.ast}</td>
                <td className="mono">
                  {l.fgm}-{l.fga}
                </td>
                <td className="mono">
                  {l.fg3m}-{l.fg3a}
                </td>
                <td className="mono">
                  {l.ftm}-{l.fta}
                </td>
                <td className="mono">{l.stl}</td>
                <td className="mono">{l.blk}</td>
                <td className="mono">{l.tov}</td>
                <td className={`mono ${l.pm > 0 ? 'pos' : 'muted'}`}>{l.pm > 0 ? `+${l.pm}` : l.pm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
