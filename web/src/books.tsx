// Comparateur de cotes : bookmakers français contre la référence Pinnacle sans marge (/api/cotes).
// Valeur d'une cote = cote × probabilité de référence - 1 : positive, la cote paie plus que le risque réel estimé.
import { useEffect, useState } from 'react';
import { Scales } from '@phosphor-icons/react';
import { listSims, pct, simKey, type Game } from './data.ts';
import { TeamMark } from './ui.tsx';

interface BookRow {
  key: string;
  title: string;
  home?: number;
  away?: number;
  spread?: { point: number; home: number; away: number };
}
interface BookGame {
  home: string;
  away: string;
  start: string;
  ref?: { home: number; away: number };
  books: BookRow[];
}
interface Cotes {
  games: BookGame[];
  at: string;
  error?: string;
}

let cotes: Promise<Cotes> | undefined;
export function loadCotes(): Promise<Cotes> {
  cotes ??= fetch('/api/cotes')
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      return r.ok ? (j as Cotes) : { games: [], at: '', error: j.error ?? `Erreur ${r.status}` };
    })
    .catch((e: Error) => ({ games: [], at: '', error: e.message }));
  return cotes;
}

const dec = (v?: number) => (v == null ? '-' : v.toFixed(2).replace('.', ','));
const ev = (odds: number | undefined, p: number | undefined) => (odds == null || p == null ? undefined : odds * p - 1);

export function BookOdds({ g }: { g: Game }) {
  const [data, setData] = useState<Cotes>();
  const [pRazzia, setPRazzia] = useState<number>();
  useEffect(() => {
    void loadCotes().then(setData);
    void listSims().then((m) => setPRazzia(m.get(simKey(g))?.pHome));
  }, [g]);
  const bg = data?.games?.find((x) => x.home.endsWith(g.home.name) && x.away.endsWith(g.away.name));
  const books = (bg?.books ?? []).filter((b) => b.key !== 'pinnacle' && b.home && b.away);
  const best = (side: 'home' | 'away') => Math.max(...books.map((b) => b[side] ?? 0));
  const ref = bg?.ref;
  const cell = (b: BookRow, side: 'home' | 'away') => {
    const v = ev(b[side], ref?.[side]);
    const r = pRazzia != null ? ev(b[side], side === 'home' ? pRazzia : 1 - pRazzia) : undefined;
    return (
      <td className={`mono${b[side] === best(side) ? ' strong' : ''}`} title={`Valeur contre Pinnacle : ${v != null ? pct(v) : '-'}${r != null ? ` ; contre Razzia : ${pct(r)}` : ''}`}>
        {dec(b[side])}
        {v != null && <span className={`ev ${v > 0 ? 'pos' : 'neg'}`}>{v > 0 ? '+' : ''}{(v * 100).toFixed(1).replace('.', ',')} %</span>}
      </td>
    );
  };
  return (
    <section className="box">
      <div className="box-head">
        <span className="box-icon">
          <Scales size={18} />
        </span>
        Comparateur de cotes
      </div>
      <div className="box-body">
        {!data ? (
          <span className="sk sk-row" aria-busy="true" />
        ) : data.error ? (
          <p className="muted small">{data.error}</p>
        ) : !books.length ? (
          <p className="muted small">Cotes des bookmakers français pas encore publiées pour ce match.</p>
        ) : (
          <>
            <table className="odds-t books-t">
              <thead>
                <tr>
                  <th>Bookmaker</th>
                  <th>
                    <TeamMark team={g.away} size="sm" />
                  </th>
                  <th>
                    <TeamMark team={g.home} size="sm" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.key}>
                    <td>{b.title.replace(/\s*\(FR\)/, '')}</td>
                    {cell(b, 'away')}
                    {cell(b, 'home')}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small books-note">
              {ref
                ? `Référence Pinnacle sans marge : ${g.away.tri} ${pct(ref.away)}, ${g.home.tri} ${pct(ref.home)}. En vert, la cote paie plus que ce risque.`
                : 'Pas de cote Pinnacle de référence pour ce match.'}
              {pRazzia != null ? ` Razzia : ${g.home.tri} ${pct(pRazzia)} (survol d'une cote pour sa valeur selon Razzia).` : ''}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Meilleure cote française d'un pari du ticket (vainqueur, ou handicap à la même ligne), parmi Betclic, Unibet,
 * Winamax, Parions Sport, NetBet et PMU. Basket seulement ; rien quand le comparateur n'a pas le match.
 */
export function bestFrench(c: Cotes | undefined, l: { sport: string; match: { homeName: string; awayName: string }; bet: { kind: string; side: 'home' | 'away'; line?: number } }) {
  if (!c || l.sport !== 'nba' || (l.bet.kind !== 'win' && l.bet.kind !== 'spread')) return undefined;
  const g = c.games?.find((x) => x.home.endsWith(l.match.homeName) && x.away.endsWith(l.match.awayName));
  if (!g) return undefined;
  let best: { odds: number; book: string } | undefined;
  for (const b of g.books) {
    if (b.key === 'pinnacle') continue;
    let o: number | undefined;
    if (l.bet.kind === 'win') o = b[l.bet.side];
    else if (b.spread && l.bet.line != null && Math.abs((l.bet.side === 'home' ? b.spread.point : -b.spread.point) - l.bet.line) < 0.01) o = b.spread[l.bet.side];
    if (o && (!best || o > best.odds)) best = { odds: o, book: b.title };
  }
  return best;
}

/** Comparateur chargé une fois (cache 10 minutes côté serveur). */
export function useCotes(): Cotes | undefined {
  const [c, setC] = useState<Cotes>();
  useEffect(() => {
    void loadCotes().then(setC);
  }, []);
  return c;
}
