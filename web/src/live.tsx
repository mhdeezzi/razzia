// Simulation en direct : la page des matchs en cours (les trois sports sur une seule carte) et la fiche d'un match.
// La fiche compare à chaque instant la simulation d'avant-match (scénario prévu, en pointillés) et le match réel :
// à chaque action, les 25 000 simulations sont relancées depuis le score du moment et l'éventail des fins possibles
// se redessine. Les données viennent du moteur de démonstration (livedemo.ts) en attendant le moteur live.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import {
  ArrowCounterClockwise, ArrowDownRight, ArrowLeft, ArrowsLeftRight, ArrowUpRight, ArrowUUpLeft, Basketball, BatteryLow, CaretRight, Check, Clover, Crosshair,
  FlagCheckered, Flag, Info, Lightning, Pause, Play, SoccerBall, TennisBall, Timer, TrendUp, Warning, Waveform, X,
} from '@phosphor-icons/react';
import './live.css';
import { pct0 } from './data.ts';
import { isLiveId, useLiveList, useLiveMatch } from './livereal.ts';
import { advAt, clock, demoOf, DEMOS, type Demo, type Ev, type Frame, type Gauge, type P3, type PickState, type Side, type Sport } from './livedemo.ts';
import { CountUp, Empty, glow, Link, Segmented, TeamMark, useEntryState } from './ui.tsx';
import { WarpBg } from './shaders.tsx';
import { Avatar } from './tennis.tsx';
import { smoothPath } from './typical.tsx';

const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const css = (v: Record<string, string | number>) => v as CSSProperties;
const SPORT_ICON: Record<Sport, (size: number) => ReactNode> = {
  foot: (s) => <SoccerBall size={s} />,
  tennis: (s) => <TennisBall size={s} />,
  nba: (s) => <Basketball size={s} />,
};
const sideOf = (m: Demo, s: 0 | 1) => (s === 0 ? m.home : m.away);

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

/** Évolution du favori d'avant-match : « VIL 59 % → 86 % ». */
function Delta({ m, f }: { m: Demo; f: Frame }) {
  const fav = m.pre.p[0] >= m.pre.p[2] ? 0 : 2;
  const pre = m.pre.p[fav], now = f.p[fav];
  const up = now - pre > 0.02, down = pre - now > 0.02;
  return (
    <span className={`lv-delta${up ? ' up' : down ? ' down' : ''}`} title="Avant le match, puis maintenant">
      {up ? <ArrowUpRight size={13} weight="bold" /> : down ? <ArrowDownRight size={13} weight="bold" /> : null}
      <span>{(fav === 0 ? m.home : m.away).tri}</span>
      <span>
        {pct0(pre)} → <Num v={now} f={pct0} />
      </span>
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
          <span className="hb-label">RAZZIA · Foot, tennis, basket</span>
          <span className="hb-label hb-right">
            25 000 simulations<span className="hb-more"> relancées à chaque action</span>
          </span>
        </div>
        <h1 className="hb-title">
          <span>Simulation</span> <span className="hb-title-2">en direct</span>
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

const QUIET: Ev['kind'][] = ['kick', 'pause', 'sub', 'timeout', 'yellow'];
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
  const lead = f.p[0] >= f.p[2] ? 0 : 2;
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
      <span className="card-a-p">
        {(lead === 0 ? m.home : m.away).tri} <Num v={f.p[lead]} f={pct0} />
      </span>
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
      <MiniFil m={m} f={f} />
      <div className="lv-card-p">
        <span style={{ color: h }}>
          <b>
            <Num v={f.p[0]} f={pct0} />
          </b>{' '}
          {m.home.tri}
        </span>
        {m.sport === 'foot' && (
          <span className="lv-nul">
            <b>
              <Num v={f.p[1]} f={pct0} />
            </b>{' '}
            Nul
          </span>
        )}
        <span style={{ color: a }}>
          {m.away.tri}{' '}
          <b>
            <Num v={f.p[2]} f={pct0} />
          </b>
        </span>
      </div>
      <div className="lv-card-f">
        <span key={f.nEv} className="lv-last">
          {f.last?.title}
        </span>
        <Delta m={m} f={f} />
      </div>
    </Link>
  );
}

/** Courbe du match en petit : pointillés pour le scénario d'avant-match, trait plein pour le match, point qui avance. */
function MiniFil({ m, f }: { m: Demo; f: Frame }) {
  const id = useId().replace(/:/g, '');
  const W = 300, H = 48;
  const x = (t: number) => (t / m.len) * W, y = (v: number) => 5 + (1 - v) * (H - 10);
  const [live, ghost] = useMemo(() => [m.series, m.ghost].map((s) => s.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.adv).toFixed(1)}`).join('')), [m]);
  return (
    <span className="lv-mini" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`g${id}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={H}>
            <stop offset="0.5" stopColor="var(--h)" />
            <stop offset="0.5" stopColor="var(--a)" />
          </linearGradient>
          <clipPath id={`c${id}`}>
            <rect x="0" y="0" width={x(f.t)} height={H} />
          </clipPath>
        </defs>
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="lv-mini-mid" />
        <path d={ghost} className="lv-mini-ghost" />
        <path d={live} className="lv-mini-live" stroke={`url(#g${id})`} clipPath={`url(#c${id})`} />
      </svg>
      {!f.ended && <i className="lv-mini-head" style={{ left: `${(100 * f.t) / m.len}%`, top: `${(100 * y(f.adv)) / H}%`, background: f.adv >= 0.5 ? 'var(--h)' : 'var(--a)' }} />}
    </span>
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
  const relances = m.events.filter((e) => e.big && e.t <= f.t).length;
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
      <Now m={m} f={f} fx={fx} relances={relances} />
      <Fil m={m} f={f} fx={fx} />
      <div className="lv-grid">
        <div className="lv-col">
          <Gauges m={m} f={f} />
          <Momentum m={m} f={f} />
          <Compare m={m} f={f} />
        </div>
        <div className="lv-col">
          <PickBox m={m} f={f} />
          <Feed m={m} f={f} />
        </div>
      </div>
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
      <WarpBg c1={h} c2={a} />
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

/** Part arrondie au demi-point : la barre ne relance pas son glissé à chaque rafraîchissement. */
const step = (v: number) => Math.max(0.005, Math.round(v * 200) / 200);

/** « Qui gagne, maintenant » : la barre des chances en direct, avec les repères d'avant-match. */
function Now({ m, f, fx, relances }: { m: Demo; f: Frame; fx?: Fx; relances: number }) {
  const foot = m.sport === 'foot';
  const cell = (label: string, v: number, pre: number, cls: string) => (
    <div className={`lv-now-c ${cls}`}>
      <span className="lv-now-k">{label}</span>
      <b className="lv-now-v">
        <Num v={v} f={pct0} />
      </b>
      <span className="lv-now-pre">avant-match {pct0(pre)}</span>
    </div>
  );
  return (
    <section className="lv-box lv-now">
      <div className="lv-box-h">
        <h2>Qui gagne, maintenant</h2>
        <span key={fx?.n ?? 0} className={`lv-relance${fx ? ' is-go' : ''}`}>
          <Lightning size={14} weight="fill" />
          {fx ? (
            <>
              Relance n° {relances} · <b className="mono"><CountUp value={25000} format={(v) => Math.round(v).toLocaleString('fr-FR')} duration={900} /></b> simulations
            </>
          ) : (
            <>25 000 simulations relancées à chaque action</>
          )}
        </span>
      </div>
      <div className={`lv-now-g${foot ? ' is-3' : ''}`}>
        {cell(m.home.short, f.p[0], m.pre.p[0], 'h')}
        {foot && cell('Match nul', f.p[1], m.pre.p[1], 'd')}
        {cell(m.away.short, f.p[2], m.pre.p[2], 'a')}
      </div>
      <div className="lv-pbar" role="img" aria-label={`${m.home.short} ${pct0(f.p[0])}${foot ? `, nul ${pct0(f.p[1])}` : ''}, ${m.away.short} ${pct0(f.p[2])}`}>
        <span className="h" style={{ flexGrow: step(f.p[0]) }} />
        {foot && <span className="d" style={{ flexGrow: step(f.p[1]) }} />}
        <span className="a" style={{ flexGrow: step(f.p[2]) }} />
        <i className="lv-pbar-pre" style={{ left: `${100 * m.pre.p[0]}%` }} />
        {foot && <i className="lv-pbar-pre" style={{ left: `${100 * (m.pre.p[0] + m.pre.p[1])}%` }} />}
      </div>
      <p className="lv-pbar-l">
        <i /> Répartition d'avant-match
      </p>
    </section>
  );
}

// ——— Le fil du match ———
interface Strand { o: 1 | 0.5 | 0; e: number; k: number; amp: number; i: number }
interface Fan { gen: number; t: number; adv: number; burst: boolean; out?: boolean; strands: Strand[] }
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Fins possibles tirées dans les proportions du moment : autant de fils par issue que de chances. */
function makeFan(gen: number, t: number, adv: number, p: P3, foot: boolean, n: number, burst: boolean): Fan {
  const rnd = seeded(gen * 7919 + Math.round(t * 13));
  let nh = Math.round(p[0] * n), na = Math.round(p[2] * n);
  if (!foot) na = n - nh;
  const nd = Math.max(0, n - nh - na);
  if (nh + na + nd > n) na = n - nh - nd;
  const strands: Strand[] = [];
  const add = (o: 1 | 0.5 | 0, cnt: number, lo: number, hi: number) => {
    for (let j = 0; j < cnt; j++) strands.push({ o, e: lo + ((j + 0.5) / cnt) * (hi - lo), k: 0.55 + 1.9 * rnd(), amp: (rnd() - 0.5) * 0.22, i: Math.floor(rnd() * n) });
  };
  add(1, nh, 0.86, 0.995);
  add(0.5, nd, 0.45, 0.55);
  add(0, na, 0.005, 0.14);
  return { gen, t, adv, burst, strands };
}

const PADY = 28;
/** Le fil du match : scénario d'avant-match en pointillés, match réel en trait plein, et l'éventail des fins possibles
 *  qui se redessine à chaque relance. */
function Fil({ m, f, fx }: { m: Demo; f: Frame; fx?: Fx }) {
  const id = useId().replace(/:/g, '');
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current!;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { w, h } = size;
  const small = w < 560;
  const pw = Math.max(1, w - (small ? 64 : 112));
  const X = (t: number) => (t / m.len) * pw;
  const Y = (v: number) => PADY + (1 - v) * (h - 2 * PADY);
  const mid = Y(0.5);
  const [live, ghost] = useMemo(() => [m.series, m.ghost].map((s) => s.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.adv).toFixed(1)}`).join('')), [m, w, h]);

  // Tout ce qui suit le temps (trait révélé, point de tête, repère « maintenant ») bouge à chaque image, sans passer par React.
  const past = useRef<SVGRectElement>(null), fut = useRef<SVGRectElement>(null), now = useRef<SVGLineElement>(null), head = useRef<SVGGElement>(null), chip = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!w) return;
    let raf = 0;
    let yy: number | undefined;
    const loop = () => {
      const { t } = clock.of(m);
      const x = X(t), y = Y(advAt(m.series, t));
      // Le point de tête rejoint sa hauteur en glissant : un but le fait monter le long du trait, sans téléportation.
      yy = yy == null || still() ? y : yy + (y - yy) * 0.16;
      past.current?.setAttribute('width', x.toFixed(1));
      fut.current?.setAttribute('x', x.toFixed(1));
      fut.current?.setAttribute('width', Math.max(0, pw - x).toFixed(1));
      now.current?.setAttribute('x1', x.toFixed(1));
      now.current?.setAttribute('x2', x.toFixed(1));
      head.current?.setAttribute('transform', `translate(${x.toFixed(1)} ${yy.toFixed(1)})`);
      if (chip.current) chip.current.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0) translateX(-50%)`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [m, w, h]);

  // Éventail des fins possibles : redessiné à chaque action marquante (relance), rafraîchi en douceur entre deux.
  const slot = Math.floor(f.t / (m.len * 0.07));
  const [fans, setFans] = useState<Fan[]>([]);
  const seen = useRef(fx?.n);
  useEffect(() => {
    const burst = fx?.n !== seen.current && !still();
    seen.current = fx?.n;
    setFans((xs) => {
      const lastFan = xs[xs.length - 1];
      return [...(lastFan ? [{ ...lastFan, out: true }] : []), makeFan((lastFan?.gen ?? 0) + 1, f.t, f.adv, f.p, m.sport === 'foot', small ? 18 : 30, burst)];
    });
  }, [slot, fx?.n, m, small]);
  const paths = useMemo(
    () =>
      fans.map((fan) => {
        const x0 = X(fan.t);
        return fan.strands.map((s) => {
          const pts: Array<[number, number]> = [];
          for (let q = 0; q <= 8; q++) {
            const u = Math.pow(q / 8, s.k), sm = u * u * (3 - 2 * u);
            pts.push([x0 + (q / 8) * (pw - x0), Y(clamp(fan.adv + (s.e - fan.adv) * sm + s.amp * Math.sin((Math.PI * q) / 8) * (1 - q / 20), 0.005, 0.995))]);
          }
          return smoothPath(pts);
        });
      }),
    [fans, w, h],
  );

  const [hover, setHover] = useState<number>();
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current!.getBoundingClientRect();
    const t = ((e.clientX - r.left) / pw) * m.len;
    setHover(t >= 0 && t <= f.t ? t : undefined);
  };
  const hv = hover != null ? m.at(hover) : undefined;
  const pins = m.events.filter((e) => e.big);
  const foot = m.sport === 'foot';
  // Effet de la dernière action marquante sur les chances, affiché un instant à côté du point de tête.
  const gain = Math.round((fx?.ev.impact ?? 0) * 100);
  const pop = fx && w > 0 && !f.ended && Math.abs(gain) >= 2 && fx.ev.t <= f.t ? { x: X(fx.ev.t), y: Y(advAt(m.series, fx.ev.t)), pts: gain } : undefined;
  return (
    <section className="lv-box lv-fil">
      <div className="lv-box-h">
        <h2>Le fil du match</h2>
        <p className="lv-legend">
          <span><i className="l-live" /> Match réel</span>
          <span><i className="l-ghost" /> Scénario d'avant-match ({m.ghostScore})</span>
          <span><i className="l-fan" /> Fins possibles</span>
        </p>
      </div>
      <div ref={box} className="lv-chart" onPointerMove={onMove} onPointerLeave={() => setHover(undefined)}>
        {w > 0 && (
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Avantage au fil du match : ${m.home.short} en haut, ${m.away.short} en bas`}>
            <defs>
              <linearGradient id={`s${id}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={h}>
                <stop offset={mid / h} stopColor="var(--h)" />
                <stop offset={mid / h} stopColor="var(--a)" />
              </linearGradient>
              <linearGradient id={`h${id}`} gradientUnits="userSpaceOnUse" x1="0" y1={PADY} x2="0" y2={mid}>
                <stop offset="0" stopColor="var(--h)" stopOpacity="0.42" />
                <stop offset="1" stopColor="var(--h)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`a${id}`} gradientUnits="userSpaceOnUse" x1="0" y1={h - PADY} x2="0" y2={mid}>
                <stop offset="0" stopColor="var(--a)" stopOpacity="0.42" />
                <stop offset="1" stopColor="var(--a)" stopOpacity="0" />
              </linearGradient>
              <clipPath id={`p${id}`}>
                <rect ref={past} x="0" y="0" width="0" height={h} />
              </clipPath>
              <clipPath id={`f${id}`}>
                <rect ref={fut} x="0" y="0" width="0" height={h} />
              </clipPath>
              <clipPath id={`t${id}`}>
                <rect x="0" y="0" width={pw} height={mid} />
              </clipPath>
              <clipPath id={`b${id}`}>
                <rect x="0" y={mid} width={pw} height={h - mid} />
              </clipPath>
            </defs>
            {m.marks.map((k) => (
              <line key={k.t} x1={X(k.t)} x2={X(k.t)} y1="0" y2={h} className="lv-c-grid" />
            ))}
            <line x1="0" x2={pw} y1={mid} y2={mid} className="lv-c-axis" />
            <line x1={pw} x2={pw} y1={PADY - 12} y2={h - PADY + 12} className="lv-c-end" />
            <path d={ghost} className="lv-c-ghost" />
            {!f.ended && (
              <g clipPath={`url(#f${id})`}>
                {fans.map((fan, k) => (
                  <g key={fan.gen} className={`lv-fan${fan.out ? ' is-out' : fan.burst ? ' is-burst' : ''}`}>
                    {fan.strands.map((s, j) => (
                      <path key={j} d={paths[k]?.[j]} pathLength={1} className={`lv-strand o${s.o === 1 ? 'h' : s.o === 0 ? 'a' : 'd'}`} style={css({ '--i': s.i })} />
                    ))}
                  </g>
                ))}
              </g>
            )}
            <g clipPath={`url(#p${id})`}>
              <path d={`${live}L${pw},${mid}L0,${mid}Z`} fill={`url(#h${id})`} clipPath={`url(#t${id})`} />
              <path d={`${live}L${pw},${mid}L0,${mid}Z`} fill={`url(#a${id})`} clipPath={`url(#b${id})`} />
              <path d={live} className="lv-c-live" stroke={`url(#s${id})`} />
            </g>
            {pins.map((e) => (
              <circle key={`${e.t}${e.kind}`} cx={X(e.t)} cy={Y(advAt(m.series, e.t))} r="4.5" className={`lv-pin${e.t <= f.t ? ' is-on' : ''}`} style={{ fill: e.side === 1 ? 'var(--a)' : 'var(--h)' }} />
            ))}
            <line ref={now} x1="0" x2="0" y1="0" y2={h} className={`lv-c-now${f.ended ? ' is-over' : ''}`} />
            {hv && <line x1={X(hv.t)} x2={X(hv.t)} y1="0" y2={h} className="lv-c-cursor" />}
            <g ref={head} className={`lv-head${f.ended ? ' is-over' : ''}`} style={{ color: f.adv >= 0.5 ? 'var(--h)' : 'var(--a)' }}>
              {fx && <circle key={fx.n} r="7" className="lv-head-burst" />}
              <circle r="7" className="lv-head-pulse" />
              <circle r="5.5" className="lv-head-dot" />
            </g>
          </svg>
        )}
        <span className="lv-c-side top">{m.home.short}</span>
        {foot && <span className="lv-c-side mid">Nul</span>}
        <span className="lv-c-side bot">{m.away.short}</span>
        {m.marks.map((k) => (
          <span key={k.t} className="lv-c-mark" style={{ left: X(k.t) }}>
            {k.label}
          </span>
        ))}
        {!f.ended && (
          <span ref={chip} className="lv-c-chip mono">
            {f.clock}
          </span>
        )}
        {pop && (
          <span key={fx!.n} className={`lv-c-pop${pop.y < 64 ? ' is-down' : ''}${pop.x > pw - 110 ? ' is-left' : ''}`} style={{ left: pop.x, top: pop.y, color: pop.pts > 0 ? 'var(--h)' : 'var(--a)' }}>
            {(pop.pts > 0 ? m.home : m.away).tri} +{Math.abs(pop.pts)}
          </span>
        )}
        {w > 0 && (
          <div className="lv-ends" style={{ left: pw, height: h }}>
            <span className="h" style={{ top: Y(0.93) }}>
              <b><Num v={f.p[0]} f={pct0} /></b>
              <i>{m.home.tri}</i>
            </span>
            {foot && (
              <span className="d" style={{ top: Y(0.5) }}>
                <b><Num v={f.p[1]} f={pct0} /></b>
                <i>Nul</i>
              </span>
            )}
            <span className="a" style={{ top: Y(0.07) }}>
              <b><Num v={f.p[2]} f={pct0} /></b>
              <i>{m.away.tri}</i>
            </span>
          </div>
        )}
        {hv && (
          <span className={`flow-tip mono${X(hv.t) > pw * 0.62 ? ' left' : ''}`} style={{ left: X(hv.t) }}>
            <b>{hv.clock}</b> {m.home.tri} {hv.tennis ? setsLine(hv) : hv.score.join('-')} {m.away.tri}
            <small>
              {' '}
              · {m.home.tri} {pct0(hv.p[0])}
              {foot ? ` · nul ${pct0(hv.p[1])}` : ''} · {m.away.tri} {pct0(hv.p[2])}
            </small>
          </span>
        )}
      </div>
      <Axis m={m} pad={w - pw} />
    </section>
  );
}

/** Périodes du match sous un graphique, chacune à sa largeur. */
function Axis({ m, pad = 0 }: { m: Demo; pad?: number }) {
  const b = [0, ...m.marks.map((k) => k.t), m.len];
  return (
    <div className="lv-c-axis-l mono" style={{ paddingRight: pad }}>
      {m.axis.map((q, i) => (
        <span key={q} style={{ flexGrow: (b[i + 1] ?? m.len) - b[i] }}>
          {q}
        </span>
      ))}
    </div>
  );
}

// ——— Signaux du moteur live ———
const GAUGES: Record<Gauge, { title: Record<Sport, string>; sub: Record<Sport, string>; icon: ReactNode }> = {
  energy: { title: { foot: 'Fatigue', tennis: 'Fatigue', nba: 'Fatigue' }, sub: { foot: 'Énergie restante', tennis: 'Énergie restante', nba: 'Énergie restante' }, icon: <BatteryLow size={19} /> },
  fouls: { title: { foot: 'Fautes', tennis: 'Fautes directes', nba: 'Fautes' }, sub: { foot: 'Fautes commises', tennis: 'Depuis le début du match', nba: "Fautes d'équipe" }, icon: <Warning size={19} /> },
  rhythm: { title: { foot: 'Rythme', tennis: 'Service', nba: 'Adresse' }, sub: { foot: 'Intensité du jeu', tennis: 'Premières balles passées', nba: 'Réussite au tir' }, icon: <Waveform size={19} /> },
  luck: { title: { foot: 'Chance', tennis: 'Chance', nba: 'Chance' }, sub: { foot: 'Buts marqués face aux buts attendus', tennis: 'Points importants gagnés', nba: "Réussite de loin face à l'habitude" }, icon: <Clover size={19} /> },
  comeback: { title: { foot: 'Remontée', tennis: 'Remontée', nba: 'Remontée' }, sub: { foot: 'Chance de revenir pour le camp mené', tennis: 'Chance de gagner pour le joueur mené', nba: 'Chance de gagner pour le camp mené' }, icon: <ArrowUUpLeft size={19} /> },
};
const ORDER: Gauge[] = ['energy', 'fouls', 'rhythm', 'luck', 'comeback'];

function Gauges({ m, f }: { m: Demo; f: Frame }) {
  return (
    <section className="lv-box lv-sig">
      <div className="lv-box-h">
        <h2>Ce que le moteur repère</h2>
        <span className="lv-box-n">mis à jour en continu</span>
      </div>
      <div className="lv-gauges">
        {ORDER.filter((g) => !m.gaugeKeys || m.gaugeKeys.includes(g)).map((g) => {
          const sigs = m.events.filter((e) => e.gauge === g && e.t <= f.t);
          const sig = sigs[sigs.length - 1];
          const fresh = sig && f.t - sig.t < m.len * 0.06 && !f.ended;
          return (
            <article key={g} className={`lv-g${sig ? ` is-${sig.tone ?? 'up'}` : ''}${fresh ? ' is-new' : ''}${g === 'comeback' ? ' is-wide' : ''}`}>
              <header>
                <span className="lv-g-ic">{GAUGES[g].icon}</span>
                <div>
                  <h3>{GAUGES[g].title[m.sport]}</h3>
                  <p>{GAUGES[g].sub[m.sport]}</p>
                </div>
              </header>
              <GaugeViz g={g} m={m} f={f} />
              {(sig || g !== 'comeback') && (
                <p key={sig?.t ?? 'idle'} className="lv-g-say">
                  {sig ? (
                    <>
                      <b>{sig.title}.</b> {sig.text}
                    </>
                  ) : (
                    'Rien à signaler pour le moment.'
                  )}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

const wave = (v: number) => {
  let d = '';
  for (let x = 0; x <= 240; x += 3) {
    const k = (x / 120) * Math.PI * 2;
    d += `${x ? 'L' : 'M'}${x},${(12 + Math.sin(k * 3) * (1.2 + 8.6 * v) * (0.55 + 0.45 * Math.sin(k + 1))).toFixed(1)}`;
  }
  return d;
};

function GaugeViz({ g, m, f }: { g: Gauge; m: Demo; f: Frame }) {
  const sides = [m.home, m.away];
  if (g === 'comeback') {
    const c = f.gauges.comeback;
    const lit = c ? clamp(Math.round(c.p * 30), c.p > 0.004 ? 1 : 0, 30) : 0;
    return (
      <div className="lv-back">
        <div className="lv-back-d" style={css({ '--k': c ? (c.side === 0 ? 'var(--h)' : 'var(--a)') : '#fff' })}>
          {Array.from({ length: 30 }, (_, i) => (
            <i key={i} className={i < lit ? 'on' : ''} />
          ))}
        </div>
        <p className="lv-back-v">
          {c ? (
            <>
              <b>
                <Num v={c.p} f={pct0} />
              </b>
              <span>{sideOf(m, c.side).short} {m.sport === 'foot' ? 'ne perd pas' : 'gagne'}</span>
            </>
          ) : (
            <span>{f.ended ? 'Match terminé.' : "Score à égalité : personne n'a à remonter."}</span>
          )}
        </p>
      </div>
    );
  }
  const v = f.gauges[g];
  return (
    <div className="lv-g-rows">
      {sides.map((s, i) => (
        <div key={s.tri} className="lv-g-row" style={css({ '--k': i === 0 ? 'var(--h)' : 'var(--a)' })}>
          <span className="lv-g-tri">{s.tri}</span>
          {g === 'energy' && (
            <>
              <span className={`lv-pips${v[i] < 0.4 ? ' is-crit' : v[i] < 0.56 ? ' is-low' : ''}`}>
                {Array.from({ length: 12 }, (_, k) => (
                  <i key={k} className={k < Math.round(v[i] * 12) ? 'on' : ''} />
                ))}
              </span>
              <b>{pct0(v[i])}</b>
            </>
          )}
          {g === 'fouls' && (
            <>
              <span className="lv-ticks">
                {Array.from({ length: Math.min(28, Math.floor(v[i])) }, (_, k) => (
                  <i key={k} />
                ))}
              </span>
              <b className="mono">{Math.floor(v[i])}</b>
            </>
          )}
          {g === 'rhythm' && (
            <>
              <span className={`lv-wave${v[i] < 0.4 ? ' is-slow' : v[i] > 0.66 ? ' is-fast' : ''}`}>
                <svg viewBox="0 0 240 24" preserveAspectRatio="none">
                  <path d={wave(v[i])} />
                </svg>
              </span>
              <b>{m.sport === 'foot' ? (v[i] < 0.4 ? 'faible' : v[i] > 0.66 ? 'élevé' : 'moyen') : pct0(m.sport === 'tennis' ? 0.36 + 0.4 * v[i] : 0.3 + 0.3 * v[i])}</b>
            </>
          )}
          {g === 'luck' && (
            <>
              <span className="lv-luck">
                <i style={{ left: `${50 + 50 * clamp(v[i], -1, 1)}%` }} />
              </span>
              <b>{Math.abs(v[i]) < 0.15 ? 'neutre' : v[i] > 0 ? 'chanceux' : 'malchanceux'}</b>
            </>
          )}
        </div>
      ))}
      {g === 'luck' && (
        <p className="lv-luck-l">
          <span>Malchance</span>
          <span>Réussite</span>
        </p>
      )}
    </div>
  );
}

// ——— Fil des actions ———
const EV_ICON: Partial<Record<Ev['kind'], ReactNode>> = {
  kick: <Play size={15} weight="fill" />, chance: <Crosshair size={15} />, sub: <ArrowsLeftRight size={15} />, pause: <Pause size={15} weight="fill" />, set: <Flag size={15} weight="fill" />,
  run: <TrendUp size={15} weight="bold" />, three: <Basketball size={15} />, timeout: <Timer size={15} />, end: <FlagCheckered size={15} />, goal: <SoccerBall size={15} weight="fill" />, break: <TennisBall size={15} weight="fill" />,
};
const evIcon = (e: Ev) => (e.kind === 'signal' && e.gauge ? GAUGES[e.gauge].icon : e.kind === 'red' || e.kind === 'yellow' ? <i className={`lv-cardlet ${e.kind}`} /> : EV_ICON[e.kind]);

function Feed({ m, f }: { m: Demo; f: Frame }) {
  const list = m.events.filter((e) => e.t <= f.t).reverse();
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

// ——— Le pari Razzia, suivi en direct ———
const PICK: Record<PickState, { label: string; note: string; icon?: ReactNode }> = {
  won: { label: 'Gagné', note: 'Le pari est passé.', icon: <Check size={13} weight="bold" /> },
  lost: { label: 'Perdu', note: 'Le pari ne peut plus passer.', icon: <X size={13} weight="bold" /> },
  safe: { label: 'En très bonne voie', note: 'Il passe dans presque toutes les simulations relancées.' },
  ok: { label: 'Dans les clous', note: "Le match suit à peu près le scénario d'avant-match." },
  warn: { label: 'Sous pression', note: "Le match s'écarte du scénario : le pari a perdu du terrain." },
  bad: { label: 'Mal engagé', note: 'Il ne passe plus que dans une minorité de simulations.' },
};

function PickBox({ m, f }: { m: Demo; f: Frame }) {
  const st = f.pick.state;
  const d = f.pick.p - m.pre.pick;
  return (
    <section className={`lv-box lv-pick is-${st}`}>
      <div className="lv-box-h">
        <h2>Le pari Razzia</h2>
        <span key={st} className="lv-pick-st">
          {PICK[st].icon}
          {PICK[st].label}
        </span>
      </div>
      <div className="lv-pick-m">
        <div>
          <p className="lv-pick-l">{m.pick.label}</p>
          <p className="lv-pick-o">
            {m.pick.fair ? 'Cote Razzia d’avant-match' : 'Pris avant le match à'} <b className="mono">{m.pick.odds.toFixed(2).replace('.', ',')}</b>
          </p>
        </div>
        <p className="lv-pick-p">
          <b>
            <Num v={f.pick.p} f={pct0} />
          </b>
          <span className={d > 0.02 ? 'up' : d < -0.02 ? 'down' : ''}>
            {d > 0.02 ? '+' : d < -0.02 ? '−' : '±'}
            {Math.abs(Math.round(d * 100))} pts
          </span>
        </p>
      </div>
      <div className="lv-pick-bar">
        <span style={{ transform: `scaleX(${clamp(step(f.pick.p), 0.01, 1)})` }} />
        <i style={{ left: `${100 * m.pre.pick}%` }} />
      </div>
      <p className="lv-pick-n">
        <span>
          Avant-match : <b>{pct0(m.pre.pick)}</b>
        </span>
        <span>{PICK[st].note}</span>
      </p>
    </section>
  );
}

// ——— Qui pousse : la pression, tranche par tranche ———
function Momentum({ m, f }: { m: Demo; f: Frame }) {
  const n = m.mom.length;
  const on = Math.floor(f.progress * n);
  const share = m.mom.slice(0, Math.max(1, on));
  const home = share.filter((v) => v > 0).length / share.length;
  return (
    <section className="lv-box lv-mom">
      <div className="lv-box-h">
        <h2>Qui pousse</h2>
        <p className="lv-legend">
          <span style={{ color: 'var(--h)' }}>
            {m.home.short} <b>{pct0(home)}</b>
          </span>
          <span style={{ color: 'var(--a)' }}>
            {m.away.short} <b>{pct0(1 - home)}</b>
          </span>
        </p>
      </div>
      <div className="lv-mom-c" role="img" aria-label={`Temps forts : ${m.home.short} ${pct0(home)}, ${m.away.short} ${pct0(1 - home)}`}>
        {m.mom.map((v, i) => (
          <span key={i} className={`${v >= 0 ? 'h' : 'a'}${i < on ? ' on' : ''}${i === on - 1 && !f.ended ? ' now' : ''}`}>
            <i style={{ height: `${Math.max(3, Math.abs(v) * 50)}%` }} />
          </span>
        ))}
        {m.marks.map((k) => (
          <em key={k.t} style={{ left: `${(100 * k.t) / m.len}%` }} />
        ))}
      </div>
      <Axis m={m} />
    </section>
  );
}

// ——— Avant le match / maintenant ———
function Compare({ m, f }: { m: Demo; f: Frame }) {
  return (
    <section className="lv-box lv-cmp">
      <div className="lv-box-h">
        <h2>Avant le match, et maintenant</h2>
        <span className="lv-box-n">simulation de base · simulation en direct</span>
      </div>
      <table>
        <thead>
          <tr>
            <th />
            <th>Avant-match</th>
            <th>Maintenant</th>
          </tr>
        </thead>
        <tbody>
          {f.rows.map((r) => (
            <tr key={r.k}>
              <th scope="row">{r.k}</th>
              <td className="mono">{r.pre}</td>
              <td className={`mono${r.d > 0.02 ? ' up' : r.d < -0.02 ? ' down' : ''}`}>
                <span key={r.k.startsWith('Score final le plus') ? r.now : 'v'} className={`lv-cmp-v${r.k.startsWith('Score final le plus') ? ' is-new' : ''}`}>
                  {r.now}
                </span>
                {r.d > 0.02 ? <ArrowUpRight size={13} weight="bold" /> : r.d < -0.02 ? <ArrowDownRight size={13} weight="bold" /> : <i />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
