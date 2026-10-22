// Résultats des 5 000 simulations : verdict, paris mis en avant, duel statistique, lignes, joueurs, props.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import { line, n1, odds, pct, pct0, signed, type Game, type Result } from './data.ts';
import { buildCategories, type Outcome } from './picks.ts';
import { TypicalGame } from './typical.tsx';
import { ShotProfile } from './court.tsx';
import { CountUp, Ring, Segmented, TeamMark } from './ui.tsx';
import { HotPlayers, LineupNotice } from './hot.tsx';

type Dist = Result['margin'];
const range = (d: Dist) => `${Math.round(d.p10)}-${Math.round(d.p90)}`;
const pctInt = (v: number) => `${Math.round(v * 100)} %`;

export function Results({ r, g, onRelaunch, busy }: { r: Result; g: Game; onRelaunch: () => void; busy: boolean }) {
  return (
    <div className="res-layout">
    <div className="results">
      <div className="res-head">
        <span className="slash">{r.n.toLocaleString('fr-FR')} matchs simulés</span>
        <button className="btn btn-ghost" onClick={onRelaunch} disabled={busy}>
          {busy ? <span className="spin" /> : <ArrowClockwise size={16} />} Relancer
        </button>
      </div>
      <LineupNotice r={r} g={g} onRelaunch={onRelaunch} busy={busy} />
      <Verdict r={r} g={g} />
      {r.typical && (
        <Section i={0} title="Le match typique" tag="déroulé le plus probable">
          <TypicalGame t={r.typical} g={g} />
        </Section>
      )}
      <Section i={1} title="Pronostics par catégorie" tag="issue la plus fréquente">
        <Categories r={r} g={g} />
      </Section>
      <Section i={1} title="Duel statistique" tag="match moyen simulé">
        <Duel r={r} g={g} />
      </Section>
      {r.shotProfile && (
        <Section i={2} title="Profil de tir" tag="zones, défense, contre-attaque">
          <ShotProfile r={r} g={g} />
        </Section>
      )}
      <Section i={2} title="Lignes" tag="probabilités">
        <Lines r={r} g={g} />
      </Section>
      <Section i={3} title="Joueurs" tag="projections">
        <Players r={r} g={g} />
      </Section>
      {r.insights && r.insights.length > 0 && (
        <Section i={5} title="Ce que disent les données">
          <ol className="insights">
            {r.insights.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </Section>
      )}
      <p className="footnote">
        {r.meta ? `Données jusqu'au ${new Date(r.meta.dataThrough).toLocaleDateString('fr-FR')}, ${r.meta.gamesUsed.toLocaleString('fr-FR')} matchs analysés. ` : ''}
        Les probabilités décrivent le modèle, pas une certitude : à confronter aux annonces de dernière minute. Jouer comporte des risques.
      </p>
    </div>
    <HotPlayers r={r} g={g} />
    </div>
  );
}

function Section({ title, tag, i = 0, right, children }: { title: string; tag?: string; i?: number; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="section" style={{ '--i': i } as CSSProperties}>
      <div className="section-head">
        <h3>{title}</h3>
        {right ?? (tag && <span className="slash">{tag}</span>)}
      </div>
      {children}
    </section>
  );
}

function Verdict({ r, g }: { r: Result; g: Game }) {
  const homeFav = r.pHome >= r.pAway;
  const fav = homeFav ? g.home : g.away;
  const pFav = Math.max(r.pHome, r.pAway);
  const mk = r.market;
  const bookFav = mk?.bookHome != null ? (homeFav ? mk.bookHome : 1 - mk.bookHome) : undefined;
  return (
    <section className="verdict">
      <Ring value={pFav} format={pctInt} label="Victoire" />
      <div>
        <span className="caps">Vainqueur le plus fréquent</span>
        <p className="verdict-team">
          <TeamMark team={fav} size="md" /> {fav.city} {fav.name}
        </p>
        <p className="verdict-sub">
          Gagne dans <b className="mono">{pct(pFav)}</b> des simulations.
        </p>
        <div className="split" role="img" aria-label={`${g.away.tri} ${pct(r.pAway)}, ${g.home.tri} ${pct(r.pHome)}`}>
          <div className="split-bar">
            <span style={{ flexGrow: r.pAway }} />
            <span style={{ flexGrow: r.pHome }} />
          </div>
          <div className="split-legend">
            <span>
              {g.away.tri} {pct(r.pAway)}
            </span>
            <span>
              {pct(r.pHome)} {g.home.tri}
            </span>
          </div>
        </div>
      </div>
      <dl className="verdict-side">
        <div>
          <dt>Score médian</dt>
          <dd>
            {g.away.tri} <CountUp value={r.awayPts.p50} format={(v) => String(Math.round(v))} /> <span className="muted">-</span>{' '}
            <CountUp value={r.homePts.p50} format={(v) => String(Math.round(v))} /> {g.home.tri}
          </dd>
        </div>
        {bookFav != null && (
          <div>
            <dt>Marché sans marge</dt>
            <dd>
              {pct(bookFav)} <Delta v={pFav - bookFav} />
            </dd>
          </div>
        )}
        <div>
          <dt>Prolongation</dt>
          <dd>{pct(r.pOT)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Delta({ v }: { v: number }) {
  const pts = v * 100;
  return <span className={`delta ${pts > 0 ? 'up' : ''}`}>{`${pts > 0 ? '+' : pts < 0 ? '-' : ''}${n1(Math.abs(pts))} pt`}</span>;
}

function Categories({ r, g }: { r: Result; g: Game }) {
  const cats = useMemo(() => buildCategories(r, g), [r, g]);
  const [id, setId] = useState(cats[0]?.id);
  const cat = cats.find((c) => c.id === id) ?? cats[0];
  if (!cat) return null;
  return (
    <>
      <div className="cat-tabs">
        <Segmented<string>
          ariaLabel="Catégorie de pari"
          value={cat.id}
          onChange={setId}
          options={cats.map((c) => ({ value: c.id, label: c.label }))}
        />
      </div>
      <p className="note">Pour chaque pari, l'issue qui se produit le plus souvent sur les {r.n.toLocaleString('fr-FR')} matchs simulés. La cote est affichée pour comparaison.</p>
      <div key={cat.id} className="cat-body">
        {cat.items.map((o) => (
          <OutcomeCard key={o.id} o={o} />
        ))}
      </div>
    </>
  );
}

const dec = (v: number) => v.toFixed(2).replace('.', ',');

function OutcomeCard({ o }: { o: Outcome }) {
  return (
    <article className="pick">
      <Ring value={o.p} format={pctInt} label="Fréquence" />
      <div>
        <h4>{o.title}</h4>
        {o.odds != null && (
          <span className="odds-pill">
            Cote <b>{dec(o.odds)}</b>
          </span>
        )}
        {o.text && <p>{o.text}</p>}
        <div className="pick-stats">
          <div>
            <span>Sur 5 000 matchs</span>
            <b>{Math.round(o.p * 5000).toLocaleString('fr-FR')}</b>
          </div>
          {o.implied != null && (
            <div>
              <span>Probabilité de la cote</span>
              <b>{pct(o.implied)}</b>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

const DUEL: Array<{ k: string; label: string; f: (t: Record<string, number>) => number; fmt: (v: number) => string; lowerBetter?: boolean }> = [
  { k: 'pts', label: 'Points', f: (t) => t.pts, fmt: n1 },
  { k: 'fg', label: 'Réussite au tir', f: (t) => t.fgm / t.fga, fmt: pct0 },
  { k: 'fg3', label: 'Réussite à 3 points', f: (t) => t.fg3m / t.fg3a, fmt: pct0 },
  { k: 'fg3a', label: 'Tirs à 3 points tentés', f: (t) => t.fg3a, fmt: n1 },
  { k: 'fta', label: 'Lancers francs tentés', f: (t) => t.fta, fmt: n1 },
  { k: 'reb', label: 'Rebonds', f: (t) => t.reb, fmt: n1 },
  { k: 'oreb', label: 'Rebonds offensifs', f: (t) => t.oreb, fmt: n1 },
  { k: 'ast', label: 'Passes décisives', f: (t) => t.ast, fmt: n1 },
  { k: 'tov', label: 'Balles perdues', f: (t) => t.tov, fmt: n1, lowerBetter: true },
  { k: 'stl', label: 'Interceptions', f: (t) => t.stl, fmt: n1 },
  { k: 'blk', label: 'Contres', f: (t) => t.blk, fmt: n1 },
];

function Duel({ r, g }: { r: Result; g: Game }) {
  return (
    <div className="duel">
      <div className="duel-legend">
        <span>
          <TeamMark team={g.away} size="sm" /> {g.away.name}
        </span>
        <span>
          {g.home.name} <TeamMark team={g.home} size="sm" />
        </span>
      </div>
      {DUEL.map((d, i) => {
        const a = d.f(r.teamStats.away);
        const h = d.f(r.teamStats.home);
        const share = a + h > 0 ? a / (a + h) : 0.5;
        const awayLeads = d.lowerBetter ? a < h : a > h;
        return (
          <div className="duel-row" key={d.k} style={{ '--i': i } as CSSProperties}>
            <div className="duel-top">
              <span className={`v mono ${awayLeads ? 'lead' : ''}`}>{d.fmt(a)}</span>
              <span className="k">{d.label}</span>
              <span className={`v mono ${!awayLeads ? 'lead' : ''}`}>{d.fmt(h)}</span>
            </div>
            <div className="duel-bar">
              <span className={`a ${awayLeads ? '' : 'dim'}`} style={{ flexBasis: `${share * 100}%` }} />
              <span className={`h ${awayLeads ? 'dim' : ''}`} style={{ flexBasis: `${(1 - share) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Lines({ r, g }: { r: Result; g: Game }) {
  const mk = r.market;
  return (
    <>
      <div className="tiles">
        <div className="tile">
          <p className="tile-title">Handicap</p>
          <p className="tile-value">{mk?.spreadHome != null ? `${g.home.tri} ${mk.spreadHome > 0 ? '+' : ''}${line(mk.spreadHome)}` : 'Pas de ligne'}</p>
          {mk?.pHomeCover != null && <TwoWay a={[g.home.tri, mk.pHomeCover]} b={[g.away.tri, 1 - mk.pHomeCover]} />}
          <p className="tile-foot">
            Écart moyen {g.home.tri} <span className="mono">{signed(r.margin.mean)}</span>, 80 % entre <span className="mono">{signed(r.margin.p10)}</span> et{' '}
            <span className="mono">{signed(r.margin.p90)}</span>
          </p>
        </div>
        <div className="tile">
          <p className="tile-title">Total de points</p>
          <p className="tile-value">{mk?.total != null ? line(mk.total) : 'Pas de ligne'}</p>
          {mk?.pOver != null && <TwoWay a={['Plus', mk.pOver]} b={['Moins', 1 - mk.pOver]} />}
          <p className="tile-foot">
            Total moyen <span className="mono">{n1(r.total.mean)}</span>, 80 % entre <span className="mono">{range(r.total)}</span>
          </p>
        </div>
        <div className="tile">
          <p className="tile-title">Possessions par équipe</p>
          <p className="tile-value">{n1(r.poss.mean)}</p>
          <p className="tile-foot">
            1re mi-temps : {g.home.tri} devant dans <span className="mono">{pct0(r.firstHalf.pHome)}</span> des cas, <span className="mono">{n1(r.firstHalf.away)}</span> à{' '}
            <span className="mono">{n1(r.firstHalf.home)}</span> en moyenne.
          </p>
        </div>
      </div>
      <div className="ladders">
        <Ladder title={`${g.home.tri} couvre le handicap`} rows={r.spreadLadder.map((l) => ({ label: `${g.home.tri} ${l.line > 0 ? '+' : ''}${line(l.line)}`, p: l.pHomeCover, mark: l.line === mk?.spreadHome }))} />
        <Ladder title="Plus de ... points" rows={r.totalLadder.map((l) => ({ label: `Plus de ${line(l.line)}`, p: l.pOver, mark: l.line === mk?.total }))} />
      </div>
      <div className="scroll-x">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="sticky">Quart-temps</th>
              {r.quarters.home.map((_, i) => (
                <th key={i}>Q{i + 1}</th>
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
                {r.quarters[side].map((v, i) => (
                  <td key={i} className="mono">
                    {n1(v)}
                  </td>
                ))}
                <td className="mono strong">{n1(r.teamStats[side].pts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TwoWay({ a, b }: { a: [string, number]; b: [string, number] }) {
  return (
    <div className="twoway">
      {[a, b].map(([k, p]) => (
        <div key={k} className={p >= 0.5 ? 'is-lean' : ''}>
          <span>{k}</span>
          <span className="mono">{pct(p)}</span>
        </div>
      ))}
    </div>
  );
}

function Ladder({ title, rows }: { title: string; rows: Array<{ label: string; p: number; mark?: boolean }> }) {
  return (
    <table className="ladder">
      <caption>{title}</caption>
      <tbody>
        {rows.map((x, i) => (
          <tr key={x.label} className={x.mark ? 'is-market' : ''}>
            <td>{x.label}</td>
            <td className="mono">{pct(x.p)}</td>
            <td className="ladder-bar">
              <span style={{ width: `${x.p * 100}%`, '--i': i } as CSSProperties} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STATS: Array<[string, string]> = [
  ['min', 'MIN'],
  ['pts', 'PTS'],
  ['reb', 'REB'],
  ['ast', 'PD'],
  ['fg3m', '3PM'],
  ['pra', 'P+R+A'],
];

function Players({ r, g }: { r: Result; g: Game }) {
  const [side, setSide] = useState<0 | 1>(1); // 1 = extérieur, 0 = domicile (convention du moteur)
  const list = useMemo(
    () => r.players.filter((p) => p.side === side && p.playRate > 0.02).sort((a, b) => b.stats.min.mean - a.stats.min.mean),
    [r, side],
  );
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented<0 | 1>
          ariaLabel="Équipe"
          value={side}
          onChange={setSide}
          options={[
            { value: 1, label: <><TeamMark team={g.away} size="sm" /> {g.away.name}</> },
            { value: 0, label: <><TeamMark team={g.home} size="sm" /> {g.home.name}</> },
          ]}
        />
        <p className="note">Moyenne des simulations, et fourchette où tombent 80 % d'entre elles.</p>
      </div>
      <div className="scroll-x" key={side}>
        <table className="grid-table">
          <thead>
            <tr>
              <th className="sticky">Joueur</th>
              <th>Joue</th>
              {STATS.map(([, l]) => (
                <th key={l}>{l}</th>
              ))}
              <th>Double-double</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const st = p.status.toLowerCase();
              return (
                <tr key={p.id}>
                  <th scope="row" className="sticky">
                    <span className="pl-name">{p.name}</span>
                    {p.starter && <span className="tag">Titulaire</span>}
                    {!st.startsWith('active') && st && <span className="tag tag-warn">{p.status}</span>}
                  </th>
                  <td className="mono">{pct0(p.playRate)}</td>
                  {STATS.map(([k]) => (
                    <td key={k} className="stat">
                      <span className="mono">{n1(p.stats[k].mean)}</span>
                      <span className="rng mono">{range(p.stats[k])}</span>
                    </td>
                  ))}
                  <td className="mono">{pct0(p.dd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
