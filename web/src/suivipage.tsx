// Page Suivi, façon ticket de bookmaker : le ticket en préparation (paris ajoutés depuis les fiches) à valider en simple
// ou en combiné avec une mise, les tickets en cours et terminés (chaque sélection cochée quand elle passe), le bilan.
// Réservée aux comptes : les tickets sont enregistrés dans le compte. Sans compte, la page invite à se connecter.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Basketball, ChartLineUp, CheckCircle, Clock, Lightning, ListChecks, Plus, Prohibit, ShareNetwork, Stack, TennisBall, ThumbsDown, ThumbsUp, Ticket as TicketIcon, Trash, X } from '@phosphor-icons/react';
import { useAuth } from './auth.ts';
import { supabase } from './supabase.ts';
import {
  comboOdds, completing, deleteTicket, final, markSeen, matchKey, placeTickets, settleTickets, slip, ticketState, useCompleting, useResults, useSlip, useTickets,
  type Leg, type LegStatus, type SettleEvent, type Ticket,
} from './suivi.ts';
import { freshOdds, moved } from './liveodds.ts';
import { shareTicket, type ShareFormat } from './share.ts';
import { bestFrench, useCotes } from './books.tsx';
import { toast } from './toast.tsx';
import { Empty, Link, navigate, Segmented } from './ui.tsx';
import { WarpBg } from './shaders.tsx';

const dec = (v: number) => v.toFixed(2).replace('.', ',');
const eur = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${eur(Math.abs(v))}`;
const whenShort = (iso: string) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const parseNum = (s: string) => Number(s.replace(',', '.').replace(/[^\d.]/g, ''));
const STATUS: Record<LegStatus, string> = { pending: 'À venir', live: 'En cours', won: 'Gagné', lost: 'Perdu', void: 'Remboursé' };
const kindLabel = (t: Pick<Ticket, 'kind' | 'legs'>) => (t.kind === 'combine' ? `Combiné · ${t.legs.length} sélections` : 'Simple');
const gainOf = (t: Pick<Ticket, 'stake' | 'odds'>) => t.stake * t.odds;

export function SuiviPage() {
  const { ready, user } = useAuth();
  const legs = useSlip();
  if (!supabase)
    return (
      <div className="page">
        <Empty title="Les comptes ne sont pas encore configurés sur ce site.">Le suivi des paris a besoin d'un compte.</Empty>
      </div>
    );
  if (!ready) return <div className="page"><span className="sk sk-hero" aria-busy="true" /></div>;
  if (!user) return <SuiviGate n={legs.length} />;
  return <SuiviSpace owner={user.id} legs={legs} />;
}

/** Sans compte : ce que fait le suivi, un exemple de ticket, et les boutons pour se connecter ou créer un compte. */
function SuiviGate({ n }: { n: number }) {
  return (
    <div className="page">
      <section className="gate mesh has-shader">
        <WarpBg c1="#2f9a68" c2="#1f3f6e" />
        <div className="gate-copy">
          <span className="caps">Suivi des paris</span>
          <h1>
            Tes paris,
            <br />
            suivis pour de vrai.
          </h1>
          <p className="lede">Ajoute les paris des simulations à ton ticket, valide-le en simple ou en combiné, et regarde chaque sélection passer au vert.</p>
          <ul className="gate-list">
            <li>
              <Stack size={20} /> Simples et combinés, cote totale et gain potentiel
            </li>
            <li>
              <CheckCircle size={20} /> Validation automatique après chaque match
            </li>
            <li>
              <ChartLineUp size={20} /> Ton bilan : mises, gains, taux de réussite
            </li>
          </ul>
          <div className="gate-cta">
            <Link href="/compte?mode=up&next=/suivi" className="btn btn-primary btn-lg">
              Créer un compte <ArrowRight size={17} weight="bold" />
            </Link>
            <Link href="/compte?next=/suivi" className="btn glass btn-lg">
              Se connecter
            </Link>
          </div>
          {n > 0 && (
            <p className="gate-note">
              <TicketIcon size={16} /> Ton ticket en préparation ({n} pari{n > 1 ? 's' : ''}) t'attend : il sera là une fois connecté.
            </p>
          )}
        </div>
        <div className="gate-demo" aria-hidden="true">
          <TicketCard
            t={{ id: 'demo', created_at: new Date().toISOString(), kind: 'combine', stake: 10, odds: 4.62, status: 'pending', settled_at: null, seen: true, legs: DEMO }}
            live={{ 'd3': 'live' }}
            demo
          />
        </div>
      </section>
    </div>
  );
}

const demoLeg = (key: string, title: string, away: string, home: string, odds: number, status?: LegStatus, sport: 'nba' | 'atp' = 'nba'): Leg => ({
  key, sport, date: '', start: new Date().toISOString(), match: { home, away, homeName: home, awayName: away }, title, odds, fair: false, p: 0.6,
  bet: { kind: 'win', side: 'home' }, path: '/', at: '', status,
});
const DEMO: Leg[] = [
  demoLeg('d1', 'Knicks gagnent', 'Celtics', 'Knicks', 1.63, 'won'),
  demoLeg('d2', 'Nuggets gagnent', 'Thunder', 'Nuggets', 1.83, 'won'),
  demoLeg('d3', 'Sinner gagne', 'Rune', 'Sinner', 1.55, undefined, 'atp'),
];

function SuiviSpace({ owner, legs }: { owner: string; legs: Leg[] }) {
  const { tickets, error } = useTickets(owner);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  // Tickets réglés pas encore vus : marqués « Nouveau » le temps de la visite, puis la pastille de Suivi s'éteint.
  const fresh = useRef<Set<string>>();
  useEffect(() => {
    if (!tickets || fresh.current) return;
    fresh.current = new Set(tickets.filter((t) => !t.seen).map((t) => t.id));
    if (fresh.current.size) setTab('done');
    const t = window.setTimeout(() => void markSeen(owner, [...fresh.current!]), 1500);
    return () => window.clearTimeout(t);
  }, [tickets, owner]);
  const open = tickets?.filter((t) => t.status === 'pending') ?? [];
  const done = tickets?.filter((t) => t.status !== 'pending') ?? [];
  const live = useResults(open.flatMap((t) => t.legs));
  const shown = tab === 'open' ? open : done;
  return (
    <div className="page">
      <header className="suivi-top">
        <h1>Mon suivi</h1>
      </header>
      <BilanLine tickets={tickets} />
      <div className="suivi-layout">
        <section className="suivi-main" aria-label="Mes tickets">
          <div className="suivi-tabs">
            <Segmented<'open' | 'done'>
              ariaLabel="Tickets"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'open', label: <>En cours <span className="seg-n">{open.length}</span></> },
                { value: 'done', label: <>Terminés <span className="seg-n">{done.length}</span></> },
              ]}
            />
          </div>
          {error && <p className="auth-msg">{error}</p>}
          {!tickets && !error && <span className="sk sk-panel" aria-busy="true" />}
          {tickets && shown.length === 0 && (
            <div className="suivi-empty">
              <ListChecks size={28} weight="light" />
              <p>{tab === 'open' ? 'Aucun ticket en cours.' : 'Aucun ticket terminé pour l’instant.'}</p>
              <span className="muted small">
                {tab === 'open' ? 'Ouvre une fiche de match, touche « Suivre » sur un pari, puis valide ton ticket ici.' : 'Tes tickets arrivent ici une fois tous leurs matchs joués.'}
              </span>
              {tab === 'open' && !legs.length && (
                <Link href="/" className="btn glass">
                  Voir le programme
                </Link>
              )}
            </div>
          )}
          <div className="tk-list">
            {shown.map((t, i) => (
              <TicketCard key={t.id} t={t} live={live} isNew={fresh.current?.has(t.id)} owner={owner} i={i} />
            ))}
          </div>
        </section>
        <BetSlip owner={owner} legs={legs} onPlaced={() => setTab('open')} />
      </div>
    </div>
  );
}

/** Bénéfice d'un ticket réglé (remboursé : zéro). */
const profitOf = (t: Ticket) => (t.status === 'won' ? gainOf(t) - t.stake : t.status === 'lost' ? -t.stake : 0);

/**
 * Ligne dédiée au bilan, sous le titre : bénéfice du mois, bénéfice depuis le début (et rendement), réussite, argent
 * en jeu, et la courbe des gains cumulés ticket après ticket.
 */
function BilanLine({ tickets }: { tickets?: Ticket[] }) {
  const s = useMemo(() => {
    const done = (tickets ?? []).filter((t) => t.status !== 'pending').sort((a, b) => (a.settled_at ?? a.created_at).localeCompare(b.settled_at ?? b.created_at));
    const month = new Date().toISOString().slice(0, 7);
    const won = done.filter((t) => t.status === 'won').length;
    const staked = done.reduce((x, t) => x + t.stake, 0);
    const profit = done.reduce((x, t) => x + profitOf(t), 0);
    const open = (tickets ?? []).filter((t) => t.status === 'pending');
    let run = 0;
    const pts = [0, ...done.map((t) => (run += profitOf(t)))];
    return {
      n: done.length, won, profit, roi: staked ? profit / staked : undefined, pts,
      monthProfit: done.filter((t) => (t.settled_at ?? t.created_at).slice(0, 7) === month).reduce((x, t) => x + profitOf(t), 0),
      inPlay: open.reduce((x, t) => x + t.stake, 0), open: open.length,
    };
  }, [tickets]);
  const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const monthName = new Date().toLocaleDateString('fr-FR', { month: 'long' });
  return (
    <section className="bilan-line" aria-label="Mon bilan">
      <div>
        <span>Bilan {/^[aeiou]/.test(monthName) ? 'd’' : 'de '}{monthName}</span>
        <b className={tone(s.monthProfit)}>{signed(s.monthProfit)}</b>
        <em>tickets réglés ce mois-ci</em>
      </div>
      <div>
        <span>Depuis le début</span>
        <b className={tone(s.profit)}>{signed(s.profit)}</b>
        <em>{s.roi != null ? `${s.roi > 0 ? '+' : ''}${Math.round(s.roi * 100)} % de rendement` : 'Aucun ticket terminé'}</em>
      </div>
      <div>
        <span>Réussite</span>
        <b>{s.n ? `${Math.round((s.won / s.n) * 100)} %` : '-'}</b>
        <em>
          {s.won} gagné{s.won > 1 ? 's' : ''} sur {s.n}
        </em>
      </div>
      <div>
        <span>En jeu</span>
        <b>{eur(s.inPlay)}</b>
        <em>
          {s.open} ticket{s.open > 1 ? 's' : ''} en cours
        </em>
      </div>
      {s.pts.length > 2 && <Spark pts={s.pts} />}
    </section>
  );
}

/** Courbe des gains cumulés : verte au-dessus de zéro, rouge en dessous. */
function Spark({ pts }: { pts: number[] }) {
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts);
  const W = 240, H = 56, pad = 4;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => pad + ((hi - v) / (hi - lo || 1)) * (H - 2 * pad);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zero = y(0);
  return (
    <svg className="bilan-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Gains cumulés, ticket après ticket">
      <defs>
        <linearGradient id="spark-s" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
          <stop offset={zero / H} stopColor="#3dd68c" />
          <stop offset={zero / H} stopColor="#e2232b" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={zero} y2={zero} className="curve-zero" />
      <polyline points={line} className="curve-line" stroke="url(#spark-s)" />
    </svg>
  );
}

/** État d'une sélection, en rond plein : pouce vert gagné, pouce rouge perdu, horloge jaune à venir, LIVE en direct, interdit gris annulé. */
function LegMark({ s }: { s: LegStatus }) {
  if (s === 'won') return <span className="lm won" aria-label="Gagné"><ThumbsUp size={16} weight="fill" /></span>;
  if (s === 'lost') return <span className="lm lost" aria-label="Perdu"><ThumbsDown size={16} weight="fill" /></span>;
  if (s === 'live') return <span className="lm live" aria-label="En direct">LIVE</span>;
  if (s === 'void') return <span className="lm void" aria-label="Annulé, remboursé"><Prohibit size={17} weight="bold" /></span>;
  return <span className="lm wait" aria-label="À venir"><Clock size={18} weight="fill" /></span>;
}

/** Pastille du ticket, à côté de son nom : 3/3 et pouce, 1/3 et pouce rouge, sélections à venir et horloge, LIVE, annulé. */
function TicketPill({ state, ls }: { state: LegStatus; ls: LegStatus[] }) {
  const n = ls.length, ok = ls.filter((x) => x === 'won' || x === 'void').length, wait = ls.filter((x) => x === 'pending' || x === 'live').length;
  const label = `${STATUS[state]} · ${ok} sur ${n} validée${ok > 1 ? 's' : ''}`;
  if (state === 'won') return <span className="tk-st won" aria-label={label}>{n > 1 ? `${ok}/${n}` : ''}<ThumbsUp size={15} weight="fill" /></span>;
  if (state === 'lost') return <span className="tk-st lost" aria-label={label}>{n > 1 ? `${ok}/${n}` : ''}<ThumbsDown size={15} weight="fill" /></span>;
  if (state === 'void') return <span className="tk-st void" aria-label={label}>Remboursé<Prohibit size={14} weight="bold" /></span>;
  // LIVE seulement quand un match se joue ; sinon (sélections déjà gagnées, les autres à venir) : horloge jaune.
  if (state === 'live' && ls.includes('live')) return <span className="tk-st live" aria-label={label}><i />LIVE{n > 1 ? <b>{ok}/{n}</b> : null}</span>;
  return <span className="tk-st wait" aria-label={label}>{wait}<Clock size={15} weight="fill" /></span>;
}

/** Un ticket validé : sélections cochées une à une, ligne de suivi, mise, cote, gain potentiel ou gain, statut. */
function TicketCard({ t, live, isNew, owner, demo, i = 0 }: { t: Ticket; live: Record<string, LegStatus>; isNew?: boolean; owner?: string; demo?: boolean; i?: number }) {
  const ls = t.legs.map((l) => (final(l.status) ? l.status : live[l.key] ?? l.status ?? 'pending'));
  const state: LegStatus = t.status === 'won' || t.status === 'lost' ? t.status : ticketState(ls);
  const okN = ls.filter((s) => s === 'won' || s === 'void').length;
  const [confirm, setConfirm] = useState(false);
  const [share, setShare] = useState(false);
  const doShare = async (f: ShareFormat) => {
    setShare(false);
    const r = await shareTicket(t, live, f).catch((e) => console.error('partage', e));
    if (r === 'downloaded') toast({ tone: 'info', title: 'Image enregistrée', text: f === 'story' ? 'Ajoute-la à ta story Instagram.' : 'Joins-la au post X qui vient de s’ouvrir.' });
  };
  // Compléter : un ticket simple encore en cours devient un combiné, avec la même mise.
  const canComplete = !demo && owner && t.kind === 'simple' && t.status === 'pending' && (state === 'pending' || state === 'live');
  const complete = () => {
    completing.set({ id: t.id, stake: t.stake, odds: t.odds, matches: t.legs.map(matchKey) });
    navigate(t.legs[0]?.sport === 'atp' ? '/tennis' : '/');
  };
  return (
    <article className={`tk ${state}${isNew ? ' is-new' : ''}`} style={{ '--i': i } as CSSProperties}>
      <header className="tk-head">
        <span className="tk-kind">{t.kind === 'combine' ? `Combiné (${t.legs.length})` : 'Simple'}</span>
        <TicketPill state={state} ls={ls} />
        {isNew && <span className="tk-new">Nouveau</span>}
      </header>
      <ol className="tk-legs">
        {t.legs.map((l, k) => (
          <li key={l.key} className={ls[k]}>
            <span className={`tk-sport ${l.sport}`}>{l.sport === 'nba' ? <Basketball size={22} weight="fill" /> : <TennisBall size={22} weight="fill" />}</span>
            <div className="tk-leg-main">
              <span className="tk-comp">
                {l.sport === 'nba' ? 'NBA' : 'ATP'} · {demo ? 'ce soir' : l.note ?? when(l.start)}
              </span>
              <b className="tk-match">
                {l.match.awayName} - {l.match.homeName}
              </b>
              <span className="tk-bet">
                {demo ? (
                  <b>{l.title}</b>
                ) : (
                  <Link href={l.path} className="tk-leg-t">
                    {l.title}
                  </Link>
                )}{' '}
                <b className="mono">({ls[k] === 'void' ? '1,00' : l.odds ? dec(l.odds) : '-'})</b>
              </span>
            </div>
            <LegMark s={ls[k]} />
          </li>
        ))}
      </ol>
      {/* Ligne de suivi : une part par sélection, pleine et animée en jaune tant qu'un match se joue. */}
      <div className={`tk-line${t.legs.length === 1 ? ' one' : ''}`} role="img" aria-label={`${okN} sélection${okN > 1 ? 's' : ''} validée${okN > 1 ? 's' : ''} sur ${t.legs.length}`}>
        {ls.map((s, k) => (
          <span key={k} className={s} />
        ))}
      </div>
      <footer className="tk-foot">
        <div>
          <span>Mise</span>
          <b>{eur(t.stake)}</b>
        </div>
        <div>
          <span>Cote</span>
          <b>{dec(t.odds)}</b>
        </div>
        <div className="tk-gain">
          <span>{state === 'won' ? 'Gain' : state === 'lost' ? 'Résultat' : 'Gain possible'}</span>
          <b className={state}>{state === 'lost' ? signed(-t.stake) : eur(gainOf(t))}</b>
        </div>
        {!demo && owner && (
          <div className="tk-actions">
            {!confirm && (
              <span className="tk-share">
                <button className="tk-del icon" onClick={() => setShare(!share)} aria-label="Partager le ticket" title="Partager en image (Instagram, X)" aria-expanded={share}>
                  <ShareNetwork size={15} />
                </button>
                {share && (
                  <span className="tk-share-menu" role="menu">
                    <button role="menuitem" onClick={() => void doShare('story')}>
                      Story Instagram
                    </button>
                    <button role="menuitem" onClick={() => void doShare('post')}>
                      Post X
                    </button>
                  </span>
                )}
              </span>
            )}
            {canComplete && !confirm && (
              <button className="tk-del tk-more" onClick={complete} title="Ajouter un pari d'un autre match : le ticket devient un combiné, même mise">
                <Plus size={14} weight="bold" /> Compléter
              </button>
            )}
            {confirm ? (
              <>
                <button className="tk-del yes" onClick={() => void deleteTicket(owner, t.id).catch((e: Error) => toast({ tone: 'bad', title: 'Suppression impossible', text: e.message }))}>
                  Supprimer
                </button>
                <button className="tk-del" onClick={() => setConfirm(false)}>
                  Annuler
                </button>
              </>
            ) : (
              <button className="tk-del icon" onClick={() => setConfirm(true)} aria-label="Supprimer le ticket" title="Supprimer le ticket">
                <Trash size={15} />
              </button>
            )}
          </div>
        )}
      </footer>
      {!demo && <p className="tk-date">Validé le {when(t.created_at)}</p>}
    </article>
  );
}

/**
 * Ticket en préparation : simple ou combiné, mise, gain potentiel. Les cotes ne se saisissent pas : elles sont relues
 * chaque minute et juste avant de valider ; si elles ont bougé, le ticket le montre et attend une nouvelle validation.
 */
function BetSlip({ owner, legs, onPlaced }: { owner: string; legs: Leg[]; onPlaced: () => void }) {
  const [kind, setKind] = useState<Ticket['kind']>(legs.length > 1 ? 'combine' : 'simple');
  const [stakeTxt, setStakeTxt] = useState('10');
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const cotes = useCotes();
  useEffect(() => {
    if (legs.length < 2 && kind === 'combine') setKind('simple');
  }, [legs.length]);
  // Relit les cotes du moment ; renvoie true si une cote ou une ligne a bougé (ou si un match a commencé).
  // 'failed' : vérification impossible (réseau) ; la validation attend alors une vérification réussie.
  const refresh = async (): Promise<boolean | 'failed'> => {
    const cur = slip.list();
    if (!cur.length) return false;
    setChecking(true);
    const f = await freshOdds(cur).catch(() => undefined);
    setChecking(false);
    if (!f) return 'failed';
    let changed = false;
    const shut = new Set<string>();
    for (const l of cur) {
      const x = f[l.key];
      if (x === null) shut.add(l.key);
      if (!x) continue;
      if (moved(l, x)) {
        changed = true;
        slip.update(l.key, { odds: x.odds, fair: x.fair, p: x.p, title: x.title, bet: x.bet, was: l.odds });
      }
    }
    setClosed(shut);
    return changed || [...shut].some((k) => !closed.has(k));
  };
  const sig = legs.map((l) => l.key).join('|');
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(t);
  }, [sig]);
  const stake = parseNum(stakeTxt);
  const combine = kind === 'combine' && legs.length > 1;
  // Deux paris du même match ne se combinent pas (ils dépendent l'un de l'autre).
  const clash = new Set<string>();
  const seen = new Map<string, string>();
  for (const l of legs) {
    const k = matchKey(l);
    if (seen.has(k)) clash.add(k);
    seen.set(k, l.key);
  }
  const total = comboOdds(legs);
  const blocked = (combine && clash.size > 0) || legs.some((l) => closed.has(l.key));
  // Chance du combiné selon les simulations : un match compte une fois, avec son pari le moins probable.
  const byMatch = new Map<string, number>();
  for (const l of legs) byMatch.set(matchKey(l), Math.min(byMatch.get(matchKey(l)) ?? 1, l.p));
  const pAll = [...byMatch.values()].reduce((x, p) => x * p, 1);
  const gain = combine ? stake * total : legs.reduce((x, l) => x + stake * (l.odds ?? 1), 0);
  const valid = legs.length > 0 && stake > 0 && !blocked && legs.every((l) => (l.odds ?? 0) > 1);
  const place = async () => {
    setBusy(true);
    // Dernière vérification des cotes : si elles ont bougé, on montre les nouvelles et on attend une nouvelle validation.
    const check = await refresh();
    if (check === 'failed') {
      setBusy(false);
      return toast({ tone: 'bad', title: 'Cotes non vérifiées', text: 'Impossible de relire les cotes du moment. Vérifie ta connexion puis valide à nouveau.' });
    }
    if (check) {
      setBusy(false);
      return toast({ tone: 'info', title: 'Les cotes ont bougé', text: 'Ton ticket affiche les cotes du moment. Vérifie puis valide à nouveau.' });
    }
    try {
      const now = slip.list();
      const g = combine ? stake * comboOdds(now) : now.reduce((x, l) => x + stake * (l.odds ?? 1), 0);
      await placeTickets(owner, combine ? 'combine' : 'simple', Math.round(stake * 100) / 100, now);
      slip.clear();
      onPlaced();
      toast({ tone: 'ok', title: combine ? 'Combiné validé' : now.length > 1 ? `${now.length} paris validés` : 'Pari validé', text: `Gain potentiel ${eur(g)}. On te prévient à chaque sélection.` });
    } catch (e) {
      toast({ tone: 'bad', title: 'Ticket non enregistré', text: (e as Error).message });
    }
    setBusy(false);
  };
  return (
    <aside className={`slip${legs.length ? ' has-legs' : ''}`} aria-label="Ticket en préparation">
      <header className="slip-head">
        <h2>
          <TicketIcon size={20} /> Ticket {legs.length > 0 && <span className="slip-n">{legs.length}</span>}
        </h2>
        {legs.length > 0 && (
          <button className="slip-clear" onClick={() => slip.clear()}>
            Tout retirer
          </button>
        )}
      </header>
      {!legs.length ? (
        <div className="slip-empty">
          <p>Ton ticket est vide.</p>
          <span>Dans une fiche de match, touche « Suivre » sur un pari : il arrive ici.</span>
        </div>
      ) : (
        <>
          <Segmented<Ticket['kind']>
            ariaLabel="Type de ticket"
            value={combine ? 'combine' : 'simple'}
            onChange={setKind}
            options={[
              { value: 'simple', label: `Simple${legs.length > 1 ? ` ×${legs.length}` : ''}` },
              { value: 'combine', label: 'Combiné', disabled: legs.length < 2 },
            ]}
          />
          <ul className="slip-legs">
            {legs.map((l) => (
              <SlipLeg key={l.key} l={l} clash={combine && clash.has(matchKey(l))} shut={closed.has(l.key)} stake={combine ? undefined : stake} best={bestFrench(cotes, l)} />
            ))}
          </ul>
          {combine && clash.size > 0 && <p className="slip-warn">Deux paris du même match ne peuvent pas être combinés. Retire-en un ou passe en simple.</p>}
          {legs.some((l) => closed.has(l.key)) && <p className="slip-warn">Un match a commencé ou n'est plus proposé : retire ce pari pour valider.</p>}
          <label className="slip-stake">
            <span>{combine || legs.length === 1 ? 'Mise' : 'Mise par pari'}</span>
            <span className="slip-stake-in">
              <input inputMode="decimal" value={stakeTxt} onChange={(e) => setStakeTxt(e.target.value)} aria-label="Mise en euros" />€
            </span>
          </label>
          <div className="slip-chips">
            {[5, 10, 20, 50].map((v) => (
              <button key={v} className={`chip${stake === v ? ' is-on' : ''}`} onClick={() => setStakeTxt(String(v))}>
                {v} €
              </button>
            ))}
          </div>
          <dl className="slip-sum">
            {combine && (
              <div>
                <dt>Cote totale</dt>
                <dd className="mono">{dec(total)}</dd>
              </div>
            )}
            {!combine && legs.length > 1 && (
              <div>
                <dt>Mise totale</dt>
                <dd>{eur(stake * legs.length)}</dd>
              </div>
            )}
            {combine && (
              <div>
                <dt>Passe dans les simulations</dt>
                <dd>{(pAll * 100).toFixed(1).replace('.', ',')} %</dd>
              </div>
            )}
            <div className="slip-gain">
              <dt>Gain potentiel</dt>
              <dd>{eur(stake > 0 ? gain : 0)}</dd>
            </div>
          </dl>
          <button className="btn btn-primary btn-lg slip-go" disabled={!valid || busy} onClick={() => void place()}>
            {busy ? <span className="spin" /> : <Lightning size={17} weight="fill" />} Valider le ticket
          </button>
          <p className="slip-note">
            <span className={`slip-live${checking ? ' on' : ''}`} /> Cotes du moment, relues chaque minute et juste avant de valider. Razzia ne prend pas de paris :
            le ticket sert à suivre ceux que tu joues.
          </p>
        </>
      )}
    </aside>
  );
}

function SlipLeg({ l, clash, shut, stake, best }: { l: Leg; clash: boolean; shut: boolean; stake?: number; best?: { odds: number; book: string } }) {
  const up = l.was != null && l.odds != null && l.odds > l.was;
  const down = l.was != null && l.odds != null && l.odds < l.was;
  return (
    <li className={`slip-leg${clash || shut ? ' clash' : ''}`}>
      <div className="slip-leg-main">
        <Link href={l.path} className="slip-leg-t">
          {l.title}
        </Link>
        <span>
          {l.sport === 'nba' ? <Basketball size={13} /> : <TennisBall size={13} />} {l.match.awayName} – {l.match.homeName} · {whenShort(l.start)}
        </span>
        {shut && <span className="slip-leg-shut">Match commencé ou plus proposé</span>}
        {!shut && stake != null && stake > 0 && l.odds && <span className="slip-leg-g">Gain potentiel {eur(stake * l.odds)}</span>}
        {!shut && best && (
          <span className={`slip-leg-best${l.odds && best.odds > l.odds ? ' up' : ''}`}>
            Meilleure cote en France : <b>{dec(best.odds)}</b> chez {best.book}
          </span>
        )}
      </div>
      <span className={`slip-odd${up ? ' up' : down ? ' down' : ''}`} title={l.fair ? 'Cote juste Razzia (aucune cote publiée)' : 'Cote du moment'}>
        <span>{l.fair ? 'Cote juste' : 'Cote'}</span>
        <b className="mono">
          {up && <ArrowUp size={12} weight="bold" />}
          {down && <ArrowDown size={12} weight="bold" />}
          {l.odds ? dec(l.odds) : '-'}
        </b>
        {l.was != null && l.was !== l.odds && <s className="mono">{dec(l.was)}</s>}
      </span>
      <button className="slip-rm" onClick={() => slip.remove(l.key)} aria-label={`Retirer ${l.title}`}>
        <X size={14} />
      </button>
    </li>
  );
}

/** En bas de l'écran, hors page Suivi : le ticket en préparation, en un coup d'œil. */
export function SlipBar({ path }: { path: string }) {
  const legs = useSlip();
  const c = useCompleting();
  if (c) return <CompleteBar c={c} path={path} />;
  if (!legs.length || path === '/suivi' || path === '/compte') return null;
  return (
    <Link href="/suivi" className="slipbar">
      <span className="slipbar-n">{legs.length}</span>
      <span>
        Ticket · {legs.length > 1 ? `cote ${dec(comboOdds(legs))}` : legs[0].title}
      </span>
      <ArrowRight size={16} weight="bold" />
    </Link>
  );
}

/** Pendant qu'on complète un ticket : rappel en bas de l'écran, et annuler. */
function CompleteBar({ c, path }: { c: { stake: number; odds: number }; path: string }) {
  if (path === '/suivi' || path === '/compte') return null;
  return (
    <div className="slipbar completebar" role="status">
      <span className="slipbar-n">
        <Plus size={16} weight="bold" />
      </span>
      <span>
        <b>Complète ton ticket</b>
        <span className="completebar-sub">
          {eur(c.stake)} · cote {dec(c.odds)} · choisis un pari dans une fiche
        </span>
      </span>
      <button className="completebar-x" onClick={() => completing.set(null)} aria-label="Annuler">
        Annuler
      </button>
    </div>
  );
}

/** Règle les tickets en attente (au chargement, puis toutes les 2 minutes) et prévient : sélection validée, ticket réglé. */
export function TicketWatcher() {
  const { user } = useAuth();
  const { tickets } = useTickets(user?.id);
  useEffect(() => {
    if (!user || !tickets) return;
    let alive = true;
    const run = async () => {
      const ev = await settleTickets(user.id, tickets);
      if (alive) announce(ev);
    };
    void run();
    const t = window.setInterval(run, 120_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [user?.id, tickets]);
  return null;
}

function announce(ev: SettleEvent[]) {
  const settled = new Set(ev.filter((e) => e.kind === 'ticket').map((e) => e.ticket.id));
  for (const e of ev) {
    if (e.kind === 'ticket')
      toast(
        e.status === 'won'
          ? { tone: 'ok', title: 'Ticket gagné', text: `${kindLabel(e.ticket)} · ${eur(gainOf(e.ticket))}`, href: '/suivi' }
          : { tone: 'bad', title: 'Ticket perdu', text: `${kindLabel(e.ticket)} · ${e.ticket.legs.find((l) => l.status === 'lost')?.title ?? ''}`, href: '/suivi' },
      );
    else if (!settled.has(e.ticket.id) && e.status === 'won' && e.leg) {
      const ok = e.ticket.legs.filter((l) => l.status === 'won').length;
      toast({ tone: 'ok', title: 'Sélection validée', text: `${e.leg.title} · ${ok}/${e.ticket.legs.length} dans ton combiné`, href: '/suivi' });
    }
  }
}

/** Pastille de la barre du haut : tickets réglés pas encore vus. */
export function useUnseen(): number {
  const { user } = useAuth();
  const { tickets } = useTickets(user?.id);
  return tickets?.filter((t) => !t.seen).length ?? 0;
}

