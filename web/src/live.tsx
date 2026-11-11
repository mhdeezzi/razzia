// Le direct : la page des matchs en cours (les trois sports) et la fiche d'un match. Tout y est tourné vers la suite :
// le prono du moment choisi par le moteur live, ce qu'il voit venir (but, break, réussite qui retombe), les fins
// possibles et les scénarios des prochaines minutes (liveahead.ts, livepred.tsx). Les matchs réels viennent de
// /api/live (livereal.ts) ; sans match en cours, des matchs fictifs (livedemo.ts) passent dans le même moteur.
// Les widgets « razzialive » (coin, bandeau, story) s'ouvrent seuls sur /live/<match>/widget pour un direct vidéo.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowCounterClockwise, ArrowLeft, ArrowsLeftRight, Basketball, CaretRight, Check, Copy, Crosshair,
  FlagCheckered, Flag, Info, Lightning, Pause, Play, SoccerBall, TennisBall, Timer, TrendUp,
} from '@phosphor-icons/react';
import './live.css';
import { pct0 } from './data.ts';
import { isLiveId, useLiveList, useLiveMatch } from './livereal.ts';
import { clock, demoOf, DEMOS, type Demo, type Ev, type Frame, type Side, type Sport } from './livedemo.ts';
import { ahead, STAB, TIER, type Ahead } from './liveahead.ts';
import { FanChart, Prono, RazziaLive, Scenarios, WavesChart } from './livepred.tsx';
import { Empty, glow, Link, Segmented, TeamMark, useEntryState } from './ui.tsx';
import { WarpBg } from './shaders.tsx';
import { Avatar } from './tennis.tsx';

const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const css = (v: Record<string, string | number>) => v as CSSProperties;
const SPORT_ICON: Record<Sport, (size: number) => ReactNode> = {
  foot: (s) => <SoccerBall size={s} />,
  tennis: (s) => <TennisBall size={s} />,
  nba: (s) => <Basketball size={s} />,
};
const sideOf = (m: Demo, s: 0 | 1) => (s === 0 ? m.home : m.away);
/** Ce que le moteur voit venir pour ce match, à cet instant. */
const aheadOf = (m: Demo, f: Frame): Ahead | undefined => (f.eng ? ahead(m.id, f.eng, [m.home.short, m.away.short]) : undefined);
/** Le dessin des fins possibles se retrace quand le score ou le prono change, pas à chaque seconde. */
const epochOf = (f: Frame, a?: Ahead) => `${a?.pick.key}|${f.eng?.sport === 'nba' ? '' : f.tennis ? f.tennis.sets.map((x) => x.join('-')).join(' ') : f.score.join('-')}|${f.ended}`;

/** Rafraîchit le composant à intervalle régulier, et tout de suite quand l'horloge de démonstration change. */
function useBeat(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const bump = () => set((n) => n + 1);
    const id = window.setInterval(bump, ms);
    const off = clock.subscribe(bump);
    return () => {
      window.clearInterval(id);
      off();
    };
  }, [ms]);
}
function useFrame(m: Demo, ms = 250): Frame {
  useBeat(ms);
  return m.at(clock.of(m).t);
}

interface Fx { n: number; ev: Ev }
/** Dernière action marquante qui vient de tomber (but, break, série) : déclenche les animations une seule fois. */
function useFx(m: Demo, f: Frame): Fx | undefined {
  const prev = useRef(f.nEv);
  const [fx, setFx] = useState<Fx>();
  useEffect(() => {
    const was = prev.current;
    prev.current = f.nEv;
    // Retour au coup d'envoi ou saut dans le match (curseur de démonstration) : rien à rejouer.
    if (f.nEv <= was || f.nEv - was > 3) return;
    const ev = m.events.slice(was, f.nEv).reverse().find((e) => e.big);
    if (ev) setFx((x) => ({ n: (x?.n ?? 0) + 1, ev }));
  }, [f.nEv, m]);
  return fx;
}

// ——— Briques ———
/** Nombre qui glisse vers sa nouvelle valeur en partant de celle affichée (interruptible). */
function Num({ v, f, ms = 600 }: { v: number; f: (v: number) => string; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const cur = useRef(v);
  const fmt = useRef(f);
  fmt.current = f;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = cur.current;
    if (from === v || still()) {
      cur.current = v;
      el.textContent = fmt.current(v);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      cur.current = from + (v - from) * (1 - Math.pow(1 - k, 3));
      el.textContent = fmt.current(cur.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v, ms]);
  return <span ref={ref}>{f(cur.current)}</span>;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
/** Score façon compteur : chaque chiffre roule vers le suivant. */
function Roll({ v }: { v: number }) {
  const s = String(v);
  return (
    <span className="lv-roll" role="img" aria-label={s}>
      {[...s].map((c, i) => (
        <span key={s.length - i} className="lv-roll-d" aria-hidden="true">
          <span className="lv-roll-col" style={{ transform: `translateY(${-Number(c) * 10}%)` }}>
            {DIGITS.map((d) => (
              <i key={d}>{d}</i>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

function Mark({ s, size }: { s: Side; size: 'sm' | 'md' | 'xl' }) {
  return s.photo || s.player ? <Avatar name={s.name} photo={s.photo} size={size === 'md' ? 'row' : size} /> : <TeamMark team={{ tri: s.mark ?? s.tri, color: s.color, logo: s.logo }} size={size} />;
}

function LiveTag({ f }: { f: Frame }) {
  return f.ended ? (
    <span className="lv-tag is-over">Terminé</span>
  ) : (
    <span className="lv-tag">
      <i className="lv-dot" /> <span className="mono">{f.clock}</span>
    </span>
  );
}

// ——— Page des matchs en direct ———
type Filter = 'all' | Sport;

export function LivePage() {
  useBeat(1000);
  const [sport, setSport] = useEntryState<Filter>('sport', 'all');
  const real = useLiveList();
  // Vrais matchs en cours quand il y en a, sinon l'aperçu fictif (dit clairement par la note sous le bandeau).
  const ALL = real.list.length ? real.list : DEMOS;
  const states = ALL.map((m) => ({ m, ...clock.of(m) }));
  const live = states.filter((s) => !s.ended);
  const count = (s: Sport) => live.filter((x) => x.m.sport === s).length;
  const list = ALL.filter((m) => sport === 'all' || m.sport === sport);
  const feed = recent(ALL, 9);
  const hot = feed.find((x) => x.e.big && x.age < 60)?.m ?? [...live].sort((a, b) => b.t / b.m.len - a.t / a.m.len)[0]?.m ?? ALL[0];
  return (
    <div className="page lv-page">
      <header className="hero-banner mesh has-shader lv-top">
        <WarpBg c1="#c0354a" c2="#3a3f5c" />
        <div className="hb-top" aria-hidden="true">
          <span className="hb-label lv-top-wm">
            <RazziaLive size={20} />
          </span>
          <span className="hb-label hb-right">
            Le prono<span className="hb-more"> relancé à chaque action</span>
          </span>
        </div>
        <h1 className="hb-title">
          <span>La suite</span> <span className="hb-title-2">du match</span>
        </h1>
        <Une m={hot} />
        <div className="hb-foot">
          <p className="dash-meta">
            <i className="lv-dot" />
            <span>
              {live.length} match{live.length > 1 ? 's' : ''} en direct
            </span>
          </p>
          <Segmented<Filter>
            tone="dark"
            ariaLabel="Sport"
            value={sport}
            onChange={setSport}
            options={[
              { value: 'all', label: <>Tous <span className="mono seg-n">{live.length}</span></> },
              { value: 'foot', label: <><SoccerBall size={16} /> <span className="lv-seg-l">Football</span> <span className="mono seg-n">{count('foot')}</span></> },
              { value: 'tennis', label: <><TennisBall size={16} /> <span className="lv-seg-l">Tennis</span> <span className="mono seg-n">{count('tennis')}</span></> },
              { value: 'nba', label: <><Basketball size={16} /> <span className="lv-seg-l">Basket</span> <span className="mono seg-n">{count('nba')}</span></> },
            ]}
          />
        </div>
      </header>

      {real.list.length ? <RealNote at={real.at} /> : <DemoNote loading={real.loading} error={real.error} />}

      <div className="lv-hub">
        <div className="lv-cards" key={sport}>
          {list.map((m, i) => (
            <LiveCard key={m.id} m={m} i={i} />
          ))}
        </div>
        <aside className="lv-rail" aria-label="Dernières actions">
          <div className="lv-rail-h">
            <h2>Fil du direct</h2>
            <span className="lv-rail-n">tous les matchs</span>
          </div>
          <ol className="lv-rail-l">
            {feed.map(({ m, e, age }) => (
              <li key={`${m.id}-${e.t}-${e.kind}`} className={e.big ? 'is-big' : undefined}>
                <Link href={`/live/${m.id}`} className="lv-rail-i" style={css({ '--k': glow(sideOf(m, e.side ?? 0).color) })}>
                  <span className="lv-rail-ic">{SPORT_ICON[m.sport](15)}</span>
                  <span className="lv-rail-m">
                    <b>{e.title}</b>
                    <span>
                      {m.home.tri} {e.score} {m.away.tri} · {e.at}
                    </span>
                  </span>
                  <span className="lv-rail-t mono">{ago(age)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

const QUIET: Ev['kind'][] = ['kick', 'pause', 'sub', 'timeout', 'yellow', 'signal'];
const ago = (s: number) => (s < 4 ? "à l'instant" : s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/** Dernières actions de tous les matchs, de la plus récente à la plus ancienne. */
function recent(all: Demo[], limit: number) {
  const out: Array<{ m: Demo; e: Ev; age: number }> = [];
  for (const m of all) {
    const { t } = clock.of(m);
    for (const e of m.events) if (e.t <= t && !QUIET.includes(e.kind)) out.push({ m, e, age: (t - e.t) / m.pace });
  }
  return out.sort((a, b) => a.age - b.age).slice(0, limit);
}

function DemoNote({ loading, error }: { loading?: boolean; error?: string }) {
  return (
    <p className="lv-note">
      <Info size={16} weight="bold" />
      <span>
        {loading ? <><b>Recherche des matchs en cours…</b> En attendant, voici l'aperçu avec des matchs fictifs.</> : error ? <><b>Le direct ne répond pas pour le moment.</b> Voici l'aperçu avec des matchs fictifs.</> : <><b>Aucun match en cours pour le moment.</b> Voici l'aperçu avec des matchs fictifs : les vrais matchs apparaissent ici dès le coup d'envoi.</>}
      </span>
    </p>
  );
}

/** Vrais matchs : d'où viennent les chiffres et quand ils ont été lus. */
function RealNote({ at }: { at?: number }) {
  const age = at ? Math.max(0, Math.round((Date.now() - at) / 1000)) : 0;
  return (
    <p className="lv-note is-real">
      <i className="lv-dot" />
      <span>
        <b>En direct.</b> Moteur live Razzia, au départ de nos pronostics d'avant-match ; score et actions FotMob (foot) et ESPN (NBA, tennis). Mis à jour {age < 4 ? "à l'instant" : `il y a ${age} s`}.
      </span>
    </p>
  );
}

/** « À la une » : le match où il vient de se passer quelque chose. */
function Une({ m }: { m: Demo }) {
  const f = useFrame(m, 500);
  const a = aheadOf(m, f);
  return (
    <Link href={`/live/${m.id}`} className="hb-une lv-une">
      <span className="hb-une-k">À la une</span>
      <span className="hb-une-m">
        <Mark s={m.home} size="sm" />
        <b>
          {m.home.short} <i>{f.tennis ? setsLine(f) : f.score.join('-')}</i> {m.away.short}
        </b>
        <Mark s={m.away} size="sm" />
      </span>
      <LiveTag f={f} />
      {a && (
        <span className="card-a-p">
          {a.pick.label} <Num v={a.pick.p} f={pct0} />
        </span>
      )}
      <CaretRight size={15} className="hb-une-go" />
    </Link>
  );
}
const setsLine = (f: Frame) => (f.tennis ? f.tennis.sets.map((s) => s.join('-')).join(' ') : '');

/** Carte d'un match en cours : score qui roule, courbe du match qui avance, chances de chaque camp. */
function LiveCard({ m, i }: { m: Demo; i: number }) {
  const f = useFrame(m, 400);
  const fx = useFx(m, f);
  const h = glow(m.home.color), a = glow(m.away.color);
  const pa = aheadOf(m, f);
  return (
    <Link href={`/live/${m.id}`} className={`card lv-card${f.ended ? ' is-over' : ''}`} style={css({ '--i': i, '--h': h, '--a': a })}>
      {fx && <i key={fx.n} className="lv-hit" style={css({ '--k': fx.ev.side === 1 ? a : h })} aria-hidden="true" />}
      <div className="lv-card-top">
        <span className="lv-sport">
          {SPORT_ICON[m.sport](15)} {m.league}
        </span>
        {fx?.ev.word && !f.ended && (
          <b key={fx.n} className="lv-word" style={css({ '--k': fx.ev.side === 1 ? a : h })}>
            {fx.ev.word}
          </b>
        )}
        <LiveTag f={f} />
      </div>
      <div className="lv-card-t">
        {([0, 1] as const).map((s) => (
          <p key={s} className={`lv-team${f.ended && f.score[s] < f.score[1 - s] ? ' is-lost' : ''}`}>
            <Mark s={sideOf(m, s)} size="md" />
            <span className="lv-name">{sideOf(m, s).short}</span>
            {f.tennis && !f.ended && f.tennis.server === s && <i className="lv-serve" title="Au service" />}
            {f.tennis ? (
              <span className="lv-sets mono">
                {f.tennis.sets.map((set, k) => (
                  <i key={k} className={k < f.tennis!.sets.length - 1 || f.ended ? (set[s] > set[1 - s] ? 'w' : 'l') : 'c'}>
                    {set[s]}
                  </i>
                ))}
                {!f.ended && <b>{f.tennis.pts[s]}</b>}
              </span>
            ) : (
              <span className="lv-score">
                <Roll v={f.score[s]} />
              </span>
            )}
          </p>
        ))}
      </div>
      {pa && (
        <div className="lv-card-pick">
          <div>
            <span className="caps">{f.ended ? 'Prono final' : 'Prono du direct'}</span>
            <p className="lv-card-pl">{pa.pick.label}</p>
          </div>
          <b className="lv-card-pp">
            <Num v={pa.pick.p} f={pct0} />
          </b>
        </div>
      )}
      {pa?.fan && <FanChart a={pa} col={pa.pick.side === 0 ? h : a} epoch={epochOf(f, pa)} mini />}
      {pa && !f.ended && (
        <div className="lv-card-f">
          <span className={`lv-sigline${pa.signal.kind !== 'none' ? ' is-hot' : ''}`}>
            <i />
            {pa.signal.kind === 'none' ? `Tenue : ${STAB[pa.stab].toLowerCase()}` : pa.signal.title}
            {pa.signal.kind !== 'none' && pa.signal.p != null && <b className="mono">{pct0(pa.signal.p)}</b>}
          </span>
          {(pa.pick.tier === 'sure' || pa.pick.tier === 'safe' || pa.pick.tier === 'risky' || pa.pick.tier === 'flip') && (
            <span className={`lv-tier is-${TIER[pa.pick.tier].tone}`}>{pa.pick.tier === 'flip' ? 'Déconseillé' : TIER[pa.pick.tier].label}</span>
          )}
        </div>
      )}
    </Link>
  );
}

// ——— Fiche d'un match en direct ———
export function LiveMatchPage({ id }: { id: string }) {
  if (isLiveId(id)) return <RealMatch id={id} />;
  const m = demoOf(id);
  if (!m)
    return (
      <div className="page">
        <Empty title="Ce match n'est pas en direct.">
          <Link href="/live" className="btn btn-primary">
            Voir les matchs en direct
          </Link>
        </Empty>
      </div>
    );
  return <LiveMatch m={m} />;
}

/** Match réel : la fiche complète du moteur, relue toutes les 5 secondes. */
function RealMatch({ id }: { id: string }) {
  const { m, loading, error } = useLiveMatch(id);
  if (m) return <LiveMatch m={m} />;
  if (loading) return <div className="page"><span className="sk sk-hero" aria-busy="true" /></div>;
  return (
    <div className="page">
      <Empty title="Ce match n'est plus en direct.">
        {error && <p className="dash-meta">{error}</p>}
        <Link href="/live" className="btn btn-primary">
          Voir les matchs en direct
        </Link>
      </Empty>
    </div>
  );
}

function LiveMatch({ m }: { m: Demo }) {
  const f = useFrame(m);
  const fx = useFx(m, f);
  const h = glow(m.home.color), a = glow(m.away.color);
  const pa = aheadOf(m, f);
  const col = pa?.pick.side === 1 ? a : h, epoch = epochOf(f, pa);
  return (
    <div className="page lv-match" style={css({ '--h': h, '--a': a })}>
      <div className="lv-bar">
        <Link href="/live" back className="back">
          <ArrowLeft size={16} /> En direct
        </Link>
        {m.live ? <LiveBar m={m} /> : <DemoBar m={m} f={f} />}
      </div>
      <p className="lv-sr" aria-live="polite">
        {f.last ? `${f.last.title}. ${m.home.short} ${f.score[0]}, ${m.away.short} ${f.score[1]}.` : ''}
      </p>
      <Hero m={m} f={f} fx={fx} />
      {pa ? (
        <>
          <Prono a={pa} marble={col} mark={<Mark s={sideOf(m, pa.pick.side)} size="md" />} />
          {pa.fan && (
            <section className="lv-box lv-fan">
              <div className="lv-box-h">
                <h2>Les fins possibles</h2>
                <p className="lv-legend">
                  <span><i style={{ background: col }} /> {pa.pick.label} passe</span>
                  <span><i className="is-grey" /> Il tombe</span>
                </p>
              </div>
              <FanChart a={pa} col={col} epoch={epoch} />
              <p className="lv-say">
                {pa.fan.lines.length} fins tirées au sort, de maintenant jusqu'à la fin du match. En couleur, les <b>{pa.fan.wins}</b> où le prono passe.
              </p>
            </section>
          )}
          <div className="lv-grid">
            <div className="lv-col">
              {pa.waves && (
                <section className="lv-box lv-waves">
                  <div className="lv-box-h">
                    <h2>{pa.waves.title}</h2>
                    <p className="lv-legend">
                      <span><i className="is-dot" style={{ background: h }} /> {pa.waves.legend[0]}</span>
                      <span><i className="is-dot" style={{ background: a }} /> {pa.waves.legend[1]}</span>
                    </p>
                  </div>
                  <WavesChart a={pa} hc={h} ac={a} epoch={epoch} />
                  <p className="lv-say">{pa.waves.say}</p>
                </section>
              )}
              {pa.scen.length > 0 && (
                <section className="lv-box">
                  <div className="lv-box-h">
                    <h2>Ce qui peut tout changer</h2>
                    <span className="lv-box-n">{pa.horizon}</span>
                  </div>
                  <Scenarios a={pa} />
                </section>
              )}
            </div>
            <div className="lv-col">
              <Feed m={m} f={f} />
            </div>
          </div>
          <Widgets m={m} f={f} a={pa} />
        </>
      ) : (
        <div className="lv-grid">
          <div className="lv-col">
            <Empty title="Le moteur n'a pas encore de quoi faire un prono sur ce match." />
          </div>
          <div className="lv-col">
            <Feed m={m} f={f} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Match réel : la source et l'âge des données, à la place des commandes de l'aperçu. */
function LiveBar({ m }: { m: Demo }) {
  useBeat(1000);
  const age = m.live ? Math.max(0, Math.round((Date.now() - m.live.at) / 1000)) : 0;
  return (
    <div className="lv-demo is-real">
      <span className="lv-demo-k">
        <i className="lv-dot" /> En direct · {m.live?.src} · moteur Razzia
      </span>
      <span className="mono lv-demo-age">{age < 4 ? "à l'instant" : `il y a ${age} s`}</span>
    </div>
  );
}

/** Commandes de l'aperçu : rejouer, pause, vitesse, et un curseur pour se placer dans le match. */
function DemoBar({ m, f }: { m: Demo; f: Frame }) {
  const paused = clock.rate === 0;
  const last = useRef(1);
  if (clock.rate > 0) last.current = clock.rate;
  return (
    <div className="lv-demo">
      <span className="lv-demo-k">Aperçu · match fictif</span>
      <button className="lv-demo-b" onClick={() => clock.seek(m, 0)} title="Rejouer depuis le coup d'envoi" aria-label="Rejouer depuis le coup d'envoi">
        <ArrowCounterClockwise size={15} weight="bold" />
      </button>
      <button className="lv-demo-b" onClick={() => clock.setRate(paused ? last.current : 0)} title={paused ? 'Reprendre' : 'Pause'} aria-label={paused ? 'Reprendre' : 'Pause'}>
        {paused ? <Play size={15} weight="fill" /> : <Pause size={15} weight="fill" />}
      </button>
      {[1, 3].map((r) => (
        <button key={r} className={`lv-demo-b lv-demo-r${clock.rate === r ? ' is-on' : ''}`} onClick={() => clock.setRate(r)} aria-pressed={clock.rate === r}>
          ×{r}
        </button>
      ))}
      <input className="lv-demo-s" type="range" min={0} max={1000} value={Math.round(f.progress * 1000)} onChange={(e) => clock.seek(m, Number(e.target.value) / 1000)} aria-label="Moment du match" style={css({ '--v': f.progress })} />
    </div>
  );
}

/** Bandeau : marbre aux couleurs des deux camps, score qui roule, et le mot de l'action qui traverse l'écran. */
function Hero({ m, f, fx }: { m: Demo; f: Frame; fx?: Fx }) {
  const h = glow(m.home.color), a = glow(m.away.color);
  const team = (s: 0 | 1) => {
    const side = sideOf(m, s);
    return (
      <div className={`hero-team ${s === 0 ? 'home' : 'away'}${f.ended && f.score[s] < f.score[1 - s] ? ' t-lost' : ''}`}>
        <span className="lv-hero-mark">
          {fx && fx.ev.side === s && <i key={fx.n} className="lv-ping" style={css({ '--k': s === 0 ? h : a })} aria-hidden="true" />}
          <Mark s={side} size="xl" />
        </span>
        <div>
          <p className="hero-name">{side.name}</p>
          <p className="hero-rec">
            {f.tennis ? (
              f.tennis.server === s && !f.ended ? (
                <span className="lv-serving">
                  <i className="lv-serve" /> Au service
                </span>
              ) : (
                '\u00a0'
              )
            ) : s === 0 ? (
              'Domicile'
            ) : (
              'Extérieur'
            )}
          </p>
        </div>
      </div>
    );
  };
  return (
    <header className={`hero mesh has-shader lv-hero is-${m.sport}`}>
      <WarpBg c1={h} mono />
      {fx && <i key={`s${fx.n}`} className="lv-sweep" style={css({ '--k': fx.ev.side === 1 ? a : h })} aria-hidden="true" />}
      {fx?.ev.word && (
        <span key={`w${fx.n}`} className={`lv-jumbo${fx.ev.side === 1 ? ' is-away' : ''}`} aria-hidden="true">
          {fx.ev.word}
        </span>
      )}
      <div className="hero-meta">
        <span>
          {SPORT_ICON[m.sport](15)} {m.league}
        </span>
        <i />
        <span>{m.where}</span>
      </div>
      <div className="hero-grid">
        {team(0)}
        <div className="hero-mid">
          <span className="hero-score lv-hero-score">
            <Roll v={f.score[0]} />
            <span className="lv-colon">:</span>
            <Roll v={f.score[1]} />
          </span>
          {f.tennis && !f.ended && <TennisBoard f={f} />}
          <span className={`hero-time lv-hero-time${f.ended ? ' is-over' : ''}`}>
            {!f.ended && <i className="lv-dot" />}
            <b className="mono">{f.clock}</b>
            <span>{f.phase}</span>
          </span>
        </div>
        {team(1)}
      </div>
      <div className="lv-prog" aria-hidden="true">
        <span className="lv-prog-fill" style={{ transform: `scaleX(${f.progress})` }} />
        {m.marks.map((k) => (
          <i key={k.t} style={{ left: `${(100 * k.t) / m.len}%` }} />
        ))}
      </div>
    </header>
  );
}

/** Tennis : jeux du set en cours et points du jeu, sous le score en sets. */
function TennisBoard({ f }: { f: Frame }) {
  const t = f.tennis!;
  const cur = t.sets[t.sets.length - 1];
  return (
    <span className="lv-tboard mono">
      <span>
        Jeux <b>{cur[0]}</b>-<b>{cur[1]}</b>
      </span>
      <span key={t.pts.join()} className="lv-tpts">
        <b>{t.pts[0]}</b>-<b>{t.pts[1]}</b>
      </span>
    </span>
  );
}

// ——— Fil des actions ———
const EV_ICON: Partial<Record<Ev['kind'], ReactNode>> = {
  kick: <Play size={15} weight="fill" />, chance: <Crosshair size={15} />, sub: <ArrowsLeftRight size={15} />, pause: <Pause size={15} weight="fill" />, set: <Flag size={15} weight="fill" />,
  run: <TrendUp size={15} weight="bold" />, three: <Basketball size={15} />, timeout: <Timer size={15} />, end: <FlagCheckered size={15} />, goal: <SoccerBall size={15} weight="fill" />, break: <TennisBall size={15} weight="fill" />,
};
const evIcon = (e: Ev) => (e.kind === 'signal' ? <Lightning size={15} /> : e.kind === 'red' || e.kind === 'yellow' ? <i className={`lv-cardlet ${e.kind}`} /> : EV_ICON[e.kind]);

function Feed({ m, f }: { m: Demo; f: Frame }) {
  const list = m.events.filter((e) => e.t <= f.t && e.kind !== 'signal').reverse();
  return (
    <section className="lv-box lv-feed">
      <div className="lv-box-h">
        <h2>Action par action</h2>
        <LiveTag f={f} />
      </div>
      <ol>
        {list.map((e) => {
          const pts = Math.round((e.impact ?? 0) * 100);
          const who = pts > 0 ? m.home : m.away;
          return (
            <li key={`${e.t}${e.kind}`} className={`${e.big ? 'is-big' : ''}${e.kind === 'signal' ? ' is-sig' : ''}`} style={css({ '--k': e.side == null ? '#8e8e93' : e.side === 0 ? 'var(--h)' : 'var(--a)' })}>
              <span className="lv-feed-ic">{evIcon(e)}</span>
              <div className="lv-feed-b">
                <p className="lv-feed-m mono">{e.at}</p>
                <p className="lv-feed-h">
                  {e.title}
                  {(e.kind === 'goal' || e.kind === 'run' || e.kind === 'three') && <span className="mono">{e.score}</span>}
                </p>
                {e.text && <p className="lv-feed-x">{e.text}</p>}
              </div>
              {Math.abs(pts) >= 2 && (
                <span className="lv-feed-i mono" style={{ color: pts > 0 ? 'var(--h)' : 'var(--a)' }} title={`Effet sur les chances de ${who.short}`}>
                  {who.tri} +{Math.abs(pts)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ——— Widgets « razzialive » : à poser sur un direct vidéo (TikTok, Twitch, YouTube) ———
export type WidgetFormat = 'coin' | 'bande' | 'story';
const FORMATS: Array<{ id: WidgetFormat; name: string; hint: string }> = [
  { id: 'coin', name: 'Le coin', hint: 'Carré, dans un angle de la vidéo' },
  { id: 'story', name: 'La story', hint: 'Vertical, pour TikTok et Instagram' },
  { id: 'bande', name: 'Le bandeau', hint: 'Large, en bas de l’écran' },
];

/** Un widget : le marbre des deux camps, le score, le prono et ses fins possibles, l'annonce du moteur. */
function Widget({ m, f, a, format }: { m: Demo; f: Frame; a: Ahead; format: WidgetFormat }) {
  const h = glow(m.home.color), aw = glow(m.away.color), col = a.pick.side === 1 ? aw : h;
  const score = f.tennis ? setsLine(f) : `${f.score[0]} – ${f.score[1]}`;
  const hot = a.signal.kind !== 'none';
  return (
    <article className={`lw lw-${format} is-${m.sport}`} style={css({ '--h': h, '--a': aw, '--k': col })}>
      <div className="lw-brand">
        <RazziaLive size={format === 'story' ? 26 : 21} />
        <LiveTag f={f} />
      </div>
      <header className="lw-top mesh has-shader">
        <WarpBg c1={h} mono />
        <div className="lw-score">
          <Mark s={m.home} size="md" />
          <b className="lw-n">{m.home.tri}</b>
          <span className="lw-s">{score}</span>
          <b className="lw-n">{m.away.tri}</b>
          <Mark s={m.away} size="md" />
        </div>
      </header>
      <div className="lw-pick">
        <span className="caps">Prono du direct</span>
        <p>
          <b>{a.pick.label}</b>
          <i>
            <Num v={a.pick.p} f={pct0} />
          </i>
        </p>
      </div>
      {a.fan && <FanChart a={a} col={col} epoch={epochOf(f, a)} mini />}
      <p className={`lw-sig${hot ? ' is-hot' : ''}`}>
        <i />
        <span>
          {hot ? a.signal.title : `Tenue du prono : ${STAB[a.stab].toLowerCase()}`}
          {hot && a.signal.p != null && <b className="mono"> {pct0(a.signal.p)}</b>}
        </span>
        <em>razzia.me</em>
      </p>
    </article>
  );
}

/** Aperçu des trois widgets sur la fiche, avec le lien à coller dans le logiciel de direct. */
function Widgets({ m, f, a }: { m: Demo; f: Frame; a: Ahead }) {
  const [copied, setCopied] = useState<WidgetFormat>();
  const copy = (id: WidgetFormat) => {
    void navigator.clipboard?.writeText(`${location.origin}/live/${m.id}/widget?f=${id}`).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied(undefined), 1600);
    });
  };
  return (
    <section className="lv-box lv-wid">
      <div className="lv-box-h">
        <h2>Widgets pour ton direct</h2>
        <span className="lv-box-n">À ajouter comme source « navigateur » dans TikTok Live Studio ou OBS</span>
      </div>
      <div className="lv-wid-g">
        {FORMATS.map((w) => (
          <figure key={w.id} className={`lv-wid-i is-${w.id}`}>
            <div className="lv-wid-v">
              <Widget m={m} f={f} a={a} format={w.id} />
            </div>
            <figcaption>
              <div>
                <b>{w.name}</b>
                <span>{w.hint}</span>
              </div>
              <button className="btn btn-ghost lv-wid-b" onClick={() => copy(w.id)}>
                {copied === w.id ? <Check size={15} weight="bold" /> : <Copy size={15} />} {copied === w.id ? 'Copié' : 'Copier le lien'}
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/** Page d'un widget seul, sans barre ni pied de page : fond noir (ou vert à incruster avec ?fond=vert). */
export function LiveWidgetPage({ id, format, fond }: { id: string; format: WidgetFormat; fond?: string }) {
  useEffect(() => {
    document.documentElement.classList.add('is-widget');
    if (fond === 'vert') document.documentElement.classList.add('is-chroma');
    return () => document.documentElement.classList.remove('is-widget', 'is-chroma');
  }, [fond]);
  return isLiveId(id) ? <RealWidget id={id} format={format} /> : <DemoWidget id={id} format={format} />;
}
function RealWidget({ id, format }: { id: string; format: WidgetFormat }) {
  const { m } = useLiveMatch(id);
  return m ? <WidgetOf m={m} format={format} /> : null;
}
function DemoWidget({ id, format }: { id: string; format: WidgetFormat }) {
  const m = demoOf(id);
  return m ? <WidgetOf m={m} format={format} /> : null;
}
function WidgetOf({ m, format }: { m: Demo; format: WidgetFormat }) {
  const f = useFrame(m);
  const a = aheadOf(m, f);
  return <main className={`lw-page is-${format}`}>{a && <Widget m={m} f={f} a={a} format={format} />}</main>;
}

