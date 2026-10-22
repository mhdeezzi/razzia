// Bilan des simulations publiées : justesse (moteur, moteur + marché, marché) et valeur de clôture des écarts signalés.
// La valeur de clôture dit si le marché a donné raison à Razzia : la cote a bougé dans son sens avant le match.
import { useEffect, useState } from 'react';
import { Empty, Link } from './ui.tsx';
import { pct } from './data.ts';

interface Bilan {
  at: string;
  games: number;
  brier: { model?: number; blend?: number; book?: number; close?: number };
  accuracy: { model?: number; blend?: number; book?: number };
  value: { n: number; won: number; clvMean?: number; clvPositive?: number; roi?: number; nOdds: number };
  rows: Array<{
    dir: string; date: string; away: string; home: string; pModel: number; pBlend?: number; pBook?: number; pClose?: number; homeWon: boolean; score: string;
    value?: { side: 'home' | 'away'; edge: number; clv?: number; odds?: number; won: boolean; profit?: number };
  }>;
  error?: string;
}

const f4 = (v?: number) => (v == null ? '-' : v.toFixed(3).replace('.', ','));
const pts = (v?: number) => (v == null ? '-' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')} pts`);

export function BilanPage() {
  const [b, setB] = useState<Bilan>();
  useEffect(() => {
    fetch('/api/sim?bilan=1')
      .then(async (r) => (r.ok ? r.json() : { ...(await r.json().catch(() => ({}))), games: 0 }))
      .then(setB, (e: Error) => setB({ error: e.message } as Bilan));
  }, []);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Bilan</h1>
        <p className="lede">Les simulations publiées face aux résultats et au marché. Mis à jour chaque jour.</p>
      </header>
      {!b && <span className="sk sk-panel" aria-busy="true" />}
      {b && (b.error || !b.games) && <Empty title={b.error ?? 'Aucun match terminé parmi les simulations publiées.'} />}
      {b && b.games > 0 && (
        <>
          <section className="league-card bilan-kpis">
            <div>
              <span className="caps">Matchs terminés</span>
              <b className="mono">{b.games}</b>
            </div>
            <div>
              <span className="caps">Bon vainqueur</span>
              <b className="mono">{b.accuracy.blend != null ? pct(b.accuracy.blend) : b.accuracy.model != null ? pct(b.accuracy.model) : '-'}</b>
              <small>moteur seul {b.accuracy.model != null ? pct(b.accuracy.model) : '-'}, marché {b.accuracy.book != null ? pct(b.accuracy.book) : '-'}</small>
            </div>
            <div>
              <span className="caps">Brier (plus bas = mieux)</span>
              <b className="mono">{f4(b.brier.blend ?? b.brier.model)}</b>
              <small>moteur {f4(b.brier.model)}, marché {f4(b.brier.book)}, clôture {f4(b.brier.close)}</small>
            </div>
            <div>
              <span className="caps">Valeur de clôture</span>
              <b className="mono">{pts(b.value.clvMean)}</b>
              <small>
                {b.value.n} écarts signalés, cote dans notre sens {b.value.clvPositive != null ? pct(b.value.clvPositive) : '-'} du temps
                {b.value.roi != null ? `, rendement ${pct(b.value.roi)} sur ${b.value.nOdds}` : ''}
              </small>
            </div>
          </section>
          <p className="note" style={{ margin: '12px 0 18px' }}>
            Un écart est signalé quand le moteur s'écarte du marché d'au moins 4 points. La valeur de clôture mesure si la cote a ensuite bougé dans le sens de Razzia : c'est le meilleur indicateur d'un avantage réel, bien avant le taux de réussite.
          </p>
          <section className="league-card">
            <ol className="rows">
              {b.rows.map((r) => (
                <li key={r.dir}>
                  <Link href={`/match/${r.date}/${r.away}-${r.home}`} className="row bilan-row">
                    <span className="muted">{new Date(`${r.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                    <span className="strong">
                      {r.away} @ {r.home} <span className="mono muted">{r.score}</span>
                    </span>
                    <span className="mono">
                      {r.home} {pct(r.pBlend ?? r.pModel)}
                    </span>
                    <span>
                      {r.value ? (
                        <span className={`conf-pill ${r.value.won ? 'sim' : ''}`}>
                          {r.value.side === 'home' ? r.home : r.away} {r.value.won ? 'gagné' : 'perdu'}
                          {r.value.clv != null ? `, clôture ${pts(r.value.clv)}` : ''}
                        </span>
                      ) : (
                        <span className="muted small">{((r.pBlend ?? r.pModel) >= 0.5) === r.homeWon ? 'bon vainqueur' : 'raté'}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
