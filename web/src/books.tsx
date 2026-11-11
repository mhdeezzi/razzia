// Comparateur de cotes : fournisseurs existants et Flashscore, contre la référence Pinnacle sans marge (/api/cotes).
// Valeur d'une cote = cote × probabilité de référence - 1 : positive, la cote paie plus que le risque réel estimé.
import { useEffect, useState } from 'react';
import { Scales } from '@phosphor-icons/react';
import { listSims, pct, simKey, type Game } from './data.ts';
import { TeamMark } from './ui.tsx';
import type { OddsGame } from '../../src/odds/prices.ts';

interface BookRow {
  key: string;
  title: string;
  french?: boolean;
  updated?: string;
  phase?: 'prematch' | 'live';
  home?: number;
  away?: number;
  spread?: { point: number; home: number; away: number };
}
interface BookGame {
  home: string;
  away: string;
  start: string;
  state?: 'pre' | 'in' | 'post';
  ref?: { home: number; away: number };
  books: BookRow[];
}
interface Cotes {
  games: BookGame[];
  at: string;
  error?: string;
}

// Cache court côté navigateur. Le serveur garde le cache payant The Odds API séparé pendant dix minutes.
let cotes: Promise<Cotes> | undefined;
let cotesAt = 0;
let loading = false;
export function loadCotes(): Promise<Cotes> {
  if (!loading && cotes && Date.now() - cotesAt > 5000) cotes = undefined;
  if (!cotes) {
    loading = true;
    cotes = fetch('/api/cotes', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) cotes = undefined;
        return r.ok ? (j as Cotes) : { games: [], at: '', error: j.error ?? `Erreur ${r.status}` };
      })
      .catch((e: Error) => {
        cotes = undefined;
        return { games: [], at: '', error: e.message };
      }).finally(() => { loading = false; cotesAt = Date.now(); });
  }
  return cotes;
}

const dec = (v?: number) => (v == null ? '-' : v.toFixed(2).replace('.', ','));
const ev = (odds: number | undefined, p: number | undefined) => (odds == null || p == null ? undefined : odds * p - 1);

export function BookOdds({ g, current }: { g: Game; current?: OddsGame }) {
  const [data, setData] = useState<Cotes>();
  const [pRazzia, setPRazzia] = useState<number>();
  useEffect(() => {
    void loadCotes().then(setData);
    void listSims().then((m) => setPRazzia(m.get(simKey(g))?.pHome));
  }, [g.id]);
  const found = current ?? data?.games?.find((x) => x.home.endsWith(g.home.name) && x.away.endsWith(g.away.name));
  const bg = found && (!found.state || found.state === 'pre') ? found : undefined;
  const books = (bg?.books ?? []).filter((b) => b.key !== 'pinnacle' && !/^pinnacle(?:\s|$)/i.test(b.title) && b.home && b.away);
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
        {!data && !current ? (
          <span className="sk sk-row" aria-busy="true" />
        ) : data?.error && !current ? (
          <p className="muted small">{data.error}</p>
        ) : !books.length ? (
          <p className="muted small">Cotes des bookmakers pas encore publiées pour ce match.</p>
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
                    <td title={b.updated ? `Données de ${new Date(b.updated).toLocaleTimeString('fr-FR')}` : undefined}>{b.title.replace(/\s*\(FR\)/, '')}</td>
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
  if (!g || (g.state && g.state !== 'pre') || Date.parse(g.start) <= Date.now()) return undefined;
  let best: { odds: number; book: string } | undefined;
  for (const b of g.books) {
    if (b.phase && b.phase !== 'prematch') continue;
    if (!b.french && !['betclic_fr', 'unibet_fr', 'winamax_fr', 'parionssport_fr', 'netbet_fr', 'pmu_fr'].includes(b.key)) continue;
    let o: number | undefined;
    if (l.bet.kind === 'win') o = b[l.bet.side];
    else if (b.spread && l.bet.line != null && Math.abs((l.bet.side === 'home' ? b.spread.point : -b.spread.point) - l.bet.line) < 0.01) o = b.spread[l.bet.side];
    if (o && (!best || o > best.odds)) best = { odds: o, book: b.title };
  }
  return best;
}

/** Actualisation visible du comparateur, sans appels simultanés. */
export function useCotes(): Cotes | undefined {
  const [c, setC] = useState<Cotes>();
  useEffect(() => {
    let stopped = false, timer: number | undefined;
    const load = async () => {
      if (document.visibilityState !== 'hidden') {
        const data = await loadCotes();
        if (!stopped) setC(data);
      }
      if (!stopped) timer = window.setTimeout(load, 15_000);
    };
    void load();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);
  return c;
}
