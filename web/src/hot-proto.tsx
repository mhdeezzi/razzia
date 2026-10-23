// Maquettes « En feu ce soir » (temporaire, pour choisir) : ?feu=a | b | c.
import { type CSSProperties } from 'react';
import { Fire } from '@phosphor-icons/react';
import { n1, pct0, type Game, type Result } from './data.ts';
import { TeamMark } from './ui.tsx';
import './hot-proto.css';

type P = Result['players'][number];

/** Libellé court d'une raison : « En forme », « Défense favorable », « Plus de minutes »… */
const short = (t: string) => {
  const head = t.split(' : ')[0];
  if (head.startsWith('Plus de temps de jeu')) return 'Plus de minutes';
  if (head === 'Joue à domicile') return 'À domicile';
  return head;
};
/** Le détail chiffré après les deux-points, raccourci. */
const detail = (t: string) =>
  t.includes(' : ')
    ? t.split(' : ')[1].replace(/ \(.*\)$/, '').replace(' sur ses 10 derniers matchs', ' sur 10 matchs').replace(' de moyenne', '').replace(/ contre .* habituels$/, '').replace(' attendues', '')
    : '';

function Head() {
  return (
    <div className="section-head">
      <h3 className="feu-h">
        <Fire size={16} weight="fill" className="feu-ico" /> En feu ce soir
      </h3>
      <span className="slash">chance de gros match</span>
    </div>
  );
}

export function HotProto({ v, hot, g }: { v: string; hot: P[]; g: Game }) {
  const team = (p: P) => (p.side === 0 ? g.home : g.away);

  if (v === 'a')
    return (
      <section className="section">
        <Head />
        <ol className="feuA">
          {hot.map((p, i) => {
            const h = p.heat!;
            return (
              <li key={p.id} className="feuA-row" style={{ '--i': i } as CSSProperties}>
                <span className="feuA-rank">{String(i + 1).padStart(2, '0')}</span>
                <TeamMark team={team(p)} size="sm" />
                <div className="feuA-main">
                  <p className="feuA-name">
                    {p.name} <span className="feuA-line">{h.threshold}+ pts</span>
                  </p>
                  <p className="feuA-why">{h.reasons.slice(0, 2).map((t) => (detail(t) ? `${short(t)} : ${detail(t)}` : t)).join('  ·  ') || `${n1(h.base)} pts d'habitude`}</p>
                </div>
                <div className="feuA-p">
                  <b className="num">{pct0(h.pBig)}</b>
                  <span>{n1(h.base)} pts d'habitude</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    );

  if (v === 'b')
    return (
      <section className="section">
        <Head />
        <ol className="feuB">
          {hot.map((p, i) => {
            const h = p.heat!;
            return (
              <li key={p.id} className="feuB-tile" style={{ '--i': i } as CSSProperties}>
                <div className="feuB-top">
                  <TeamMark team={team(p)} size="sm" />
                  <p className="feuB-name">{p.name}</p>
                </div>
                <div className="feuB-bet">
                  <div>
                    <p className="feuB-line">
                      {h.threshold}+ <small>pts</small>
                    </p>
                    <p className="feuB-base">{n1(h.base)} pts d'habitude</p>
                  </div>
                  <p className="feuB-p num">{pct0(h.pBig)}</p>
                </div>
                {h.reasons.length > 0 && (
                  <ul className="feuB-chips">
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

  return (
    <section className="section">
      <Head />
      <ol className="feuC">
        {hot.map((p, i) => {
          const h = p.heat!;
          return (
            <li key={p.id} className="feuC-row" style={{ '--i': i } as CSSProperties}>
              <div className="feuC-who">
                <TeamMark team={team(p)} size="sm" />
                <p className="feuC-name">{p.name}</p>
                <span className="feuC-line">{h.threshold}+ pts</span>
              </div>
              <div className="feuC-track">
                <span style={{ width: `${Math.min(100, h.pBig * 200)}%` }} />
              </div>
              <b className="num feuC-p">{pct0(h.pBig)}</b>
              <p className="feuC-why">{h.reasons.slice(0, 3).map(short).join('  ·  ') || `${n1(h.base)} pts d'habitude`}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
