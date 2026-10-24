// Résultats des 5 000 simulations : verdict et niveau de confiance d'abord, puis les paris, et le détail (signaux,
// joueurs à suivre, match typique, duel statistique, profil de tir, joueurs).
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowsSplit, CoinVertical, Scales, ShieldCheck } from '@phosphor-icons/react';
import { line, n1, pct, pct0, type Game, type Result } from './data.ts';
import { buildCategories, EARLY_GAMES, gamesPlayed, isFlip, ladder, MIN_ODDS, SAFE_COVER, type Category, type Outcome } from './picks.ts';
import { TypicalGame } from './typical.tsx';
import { ShotProfile } from './court.tsx';
import { Signals } from './signals.tsx';
import { Ring, Segmented, TeamMark } from './ui.tsx';
import { HotStrip, LineupNotice } from './hot.tsx';

type Dist = Result['margin'];
const range = (d: Dist) => `${Math.round(d.p10)}-${Math.round(d.p90)}`;
const pctInt = (v: number) => `${Math.round(v * 100)} %`;

export function Results({ r, g, onRelaunch, busy }: { r: Result; g: Game; onRelaunch: () => void; busy: boolean }) {
  return (
    <div className="results">
      <div className="res-head">
        <span className="slash">{r.n.toLocaleString('fr-FR')} matchs simulés</span>
      </div>
      {/* Pas de « Relancer » : une simulation faite reste ; seul l'avis des compos propose « Relancer avec les compos ». */}
      <LineupNotice r={r} g={g} onRelaunch={onRelaunch} busy={busy} />
      <Verdict r={r} g={g} />
      <Section i={0} title="Pronostics par catégorie" tag="issue la plus fréquente">
        <Categories r={r} g={g} />
      </Section>
      <Signals r={r} g={g} />
      <HotStrip r={r} g={g} />
      {r.typical && (
        <Section i={1} title="Le match typique" tag="déroulé le plus probable">
          <TypicalGame t={r.typical} g={g} />
        </Section>
      )}
      <Section i={2} title="Duel statistique" tag="match moyen simulé">
        <Duel r={r} g={g} />
      </Section>
      {r.shotProfile && (
        <Section i={2} title="Profil de tir" tag="zones, défense, contre-attaque">
          <ShotProfile r={r} g={g} />
        </Section>
      )}
      <Section i={3} title="Joueurs" tag="projections">
        <Players r={r} g={g} />
      </Section>
      <p className="footnote">
        {r.meta ? `Données jusqu'au ${new Date(r.meta.dataThrough).toLocaleDateString('fr-FR')}, ${r.meta.gamesUsed.toLocaleString('fr-FR')} matchs analysés. ` : ''}
        Les probabilités décrivent le modèle, pas une certitude : à confronter aux annonces de dernière minute. Jouer comporte des risques.
      </p>
    </div>
  );
}

// Niveaux de confiance, mesurés sur toute la saison 2025-26 (1 230 matchs) : à 77 % ou plus (un match sur quatre), le
// moteur voit juste 84,6 % du temps. Sous 66 % (65,9 % compris) : pile ou face, le handicap passe devant.
const SURE = 0.77;
// Gros désaccord avec le marché en début de saison (octobre-novembre) : le marché voit l'autre équipe favorite, avec au
// moins 20 points d'écart. Saison 2025-26 : le moteur n'a eu raison que 5 fois sur 10 sur ces matchs. Le favori ne change pas.
const DISAGREE = 0.2;

interface Confidence {
  side: 'home' | 'away';
  p: number; // probabilité Razzia du favori
  engine: number; // probabilité du moteur seul
  book?: number; // marché sans marge
  tier: 'sure' | 'flip' | 'normal';
  disagree: boolean;
  hedge?: { title: string; p: number }; // handicap qui passe dans au moins 80 % des simulations
  early: boolean; // une équipe a joué moins de 5 matchs cette saison
}

function confidenceOf(r: Result, g: Game): Confidence {
  const pHome = r.market?.blendedHome ?? r.pHome;
  const side = pHome >= 0.5 ? 'home' : 'away';
  const p = side === 'home' ? pHome : 1 - pHome;
  const tier = isFlip(r, p) ? 'flip' : p >= SURE ? 'sure' : 'normal';
  const early = gamesPlayed(r) < EARLY_GAMES;
  // Match serré : le favori avec des points d'avance (gagne, ou perd de peu), la ligne la plus exigeante à 80 % ou plus.
  const cover = (x: { line: number; pHomeCover: number }) => (side === 'home' ? x.pHomeCover : 1 - x.pHomeCover);
  const lineOf = (x: { line: number }) => (side === 'home' ? x.line : -x.line);
  const h = ladder(r).filter((x) => cover(x) >= SAFE_COVER && cover(x) > p && cover(x) <= 1 / MIN_ODDS && lineOf(x) > 0).sort((a, b) => cover(a) - cover(b))[0];
  const hedge = h ? { title: `${g[side].name} +${line(lineOf(h))}`, p: cover(h) } : undefined;
  const book = r.market?.bookHome != null ? (side === 'home' ? r.market.bookHome : 1 - r.market.bookHome) : undefined;
  const month = Number(g.date.slice(5, 7));
  const disagree = book != null && book < 0.5 && p - book >= DISAGREE && (month === 10 || month === 11);
  return { side, p, engine: side === 'home' ? r.pHome : r.pAway, book, tier, disagree, hedge, early };
}

function ConfidenceBadge({ c, g }: { c: Confidence; g: Game }) {
  if (c.tier === 'sure')
    return (
      <div className="conf-badge sure">
        <ShieldCheck size={20} weight="bold" />
        <div>
          <p className="conf-badge-title">Razzia assuré</p>
          <p>Quand le moteur est aussi sûr de lui, il a vu juste 85 % du temps sur la saison passée (un match sur quatre).</p>
        </div>
      </div>
    );
  if (c.tier === 'flip')
    return (
      <div className="conf-badge flip">
        <CoinVertical size={20} weight="bold" />
        <div>
          <p className="conf-badge-title">Pile ou face</p>
          <p>
            {c.early && c.p >= 0.66 ? `Début de saison : moins de 5 matchs joués, les équipes repartent de zéro. ${g[c.side].name} reste favori, mais rien n'est sûr.` : `${g[c.side].name} reste favori, mais d'un rien : match imprévisible.`}
            {c.hedge ? (
              <>
                {' '}Plus sûr : <b>{c.hedge.title}</b> (passe dans {pct(c.hedge.p)} des simulations).
              </>
            ) : (
              ' Mieux vaut passer ce match.'
            )}
          </p>
        </div>
      </div>
    );
  return null;
}

function MarketBadge({ c, g }: { c: Confidence; g: Game }) {
  if (!c.disagree || c.book == null) return null;
  const other = g[c.side === 'home' ? 'away' : 'home'];
  return (
    <div className="conf-badge disagree">
      <ArrowsSplit size={20} weight="bold" />
      <div>
        <p className="conf-badge-title">Désaccord avec le marché</p>
        <p>
          Le marché voit <b>{other.name}</b> favori ({pct(1 - c.book)}). En début de saison, sur des écarts aussi grands, le moteur
          n'a eu raison que 5 fois sur 10 la saison passée : prudence.
        </p>
      </div>
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
  const c = confidenceOf(r, g);
  const fav = g[c.side];
  const pFav = c.p;
  const bookFav = c.book;
  // La barre reprend la probabilité Razzia affichée (moteur, cote d'ouverture et mouvement de cote).
  const pH = r.market?.blendedHome ?? r.pHome;
  const pick = useMemo(() => buildCategories(r, g)[0]?.items[0], [r, g]);
  return (
    <section className={`verdict verdict-${c.tier}`}>
      <Ring value={pFav} format={pctInt} label="Victoire" />
      <div>
        <span className="caps">Favori Razzia</span>
        <p className="verdict-team">
          <TeamMark team={fav} size="md" /> {fav.city} {fav.name}
        </p>
        <p className="verdict-sub">
          Probabilité de victoire <b className="num">{pct(pFav)}</b>
.
        </p>
        <PickOdds o={pick} />
        <ConfidenceBadge c={c} g={g} />
        <MarketBadge c={c} g={g} />
        {c.tier !== 'flip' && c.hedge && (
          // Fin de match serrée : le favori avec des points d'avance couvre aussi une défaite de peu.
          <p className="hedge-line">
            <Scales size={16} weight="bold" />
            <span>
              Plus sûr : <b>{c.hedge.title}</b>, passe dans {pct(c.hedge.p)} des simulations (couvre une défaite de peu).
            </span>
          </p>
        )}
        <div className="split" role="img" aria-label={`${g.away.tri} ${pct(1 - pH)}, ${g.home.tri} ${pct(pH)}`}>
          <div className="split-bar">
            <span style={{ flexGrow: 1 - pH }} />
            <span style={{ flexGrow: pH }} />
          </div>
          <div className="split-legend">
            <span>
              {g.away.tri} {pct(1 - pH)}
            </span>
            <span>
              {pct(pH)} {g.home.tri}
            </span>
          </div>
        </div>
      </div>
      <dl className="verdict-side">
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
  return <PickTabs cats={cats} n={r.n} />;
}

/** Onglets de pronostics (un point sur l'onglet en deuxième position) et la carte de l'issue retenue : NBA et tennis. */
export function PickTabs({ cats, n }: { cats: Category[]; n: number }) {
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
          options={cats.map((c) => ({
            value: c.id,
            label: c.warn || c.good ? (
              <>
                {c.label}
                <span className={`tab-dot${c.good ? ' good' : ''}`} aria-label={c.good ? 'plus sûr que le vainqueur' : 'déconseillé'} />
              </>
            ) : (
              c.label
            ),
          }))}
        />
      </div>
      <p className="note">Pour chaque pari, l'issue qui se produit le plus souvent sur les {n.toLocaleString('fr-FR')} matchs simulés. La cote est affichée pour comparaison.</p>
      <div key={cat.id} className="cat-body">
        {cat.items.map((o) => (
          <OutcomeCard key={o.id} o={o} n={n} />
        ))}
      </div>
    </>
  );
}

const dec = (v: number) => v.toFixed(2).replace('.', ',');

/** Sous « Probabilité de victoire » : la cote du pronostic mis en avant (bookmaker, sinon cote juste). */
export function PickOdds({ o }: { o?: Outcome }) {
  const v = o?.odds ?? o?.fair;
  if (!o || v == null) return null;
  return (
    <p className="ring-odds">
      Cote <b>{dec(v)}</b>
    </p>
  );
}

function OutcomeCard({ o, n }: { o: Outcome; n: number }) {
  return (
    <article className="pick">
      {o.warn && <span className="pick-warn">{o.warn}</span>}
      {!o.warn && o.safe && <span className="pick-warn safe">{o.safe}</span>}
      <Ring value={o.p} format={pctInt} label="Fréquence" />
      <div>
        <h4>{o.title}</h4>
        {o.odds != null && (
          <span className="odds-pill">
            Cote <b>{dec(o.odds)}</b>
          </span>
        )}
        {o.odds == null && o.fair != null && (
          <span className="odds-pill">
            Cote juste <b>{dec(o.fair)}</b>
          </span>
        )}
        {o.text && <p>{o.text}</p>}
        <div className="pick-stats">
          <div>
            <span>Sur {n.toLocaleString('fr-FR')} matchs</span>
            <b>{Math.round(o.p * n).toLocaleString('fr-FR')}</b>
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
