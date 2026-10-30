// Page Suivi, façon ticket de bookmaker : le ticket en préparation (paris ajoutés depuis les fiches) à valider en simple
// ou en combiné avec une mise, les tickets en cours et terminés (chaque sélection cochée quand elle passe), le bilan.
// Réservée aux comptes : les tickets sont enregistrés dans le compte. Sans compte, la page invite à se connecter.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Basketball, ChartLineUp, Check, CheckCircle, Lightning, ListChecks, Stack, TennisBall, Ticket as TicketIcon, Trash, X } from '@phosphor-icons/react';
import { useAuth } from './auth.ts';
import { supabase } from './supabase.ts';
import {
  comboOdds, deleteTicket, markSeen, matchKey, placeTickets, settleTickets, slip, ticketState, useResults, useSlip, useTickets,
  type Leg, type LegStatus, type SettleEvent, type Ticket,
} from './suivi.ts';
import { toast } from './toast.tsx';
import { Empty, Link, Segmented } from './ui.tsx';
import { WarpBg } from './shaders.tsx';

const dec = (v: number) => v.toFixed(2).replace('.', ',');
const eur = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${eur(Math.abs(v))}`;
const whenShort = (iso: string) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const parseNum = (s: string) => Number(s.replace(',', '.').replace(/[^\d.]/g, ''));
const STATUS: Record<LegStatus, string> = { pending: 'À venir', live: 'En cours', won: 'Gagné', lost: 'Perdu' };
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
        <div>
          <span className="caps">Mon suivi</span>
          <h1>Suivi</h1>
        </div>
        <Stats tickets={tickets} />
      </header>
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

/** Bilan des tickets terminés : bénéfice, réussite, mises, et ce qui est encore en jeu. */
function Stats({ tickets }: { tickets?: Ticket[] }) {
  const s = useMemo(() => {
    const done = (tickets ?? []).filter((t) => t.status !== 'pending');
    const won = done.filter((t) => t.status === 'won');
    const staked = done.reduce((x, t) => x + t.stake, 0);
    const back = won.reduce((x, t) => x + gainOf(t), 0);
    const open = (tickets ?? []).filter((t) => t.status === 'pending');
    return { n: done.length, won: won.length, profit: back - staked, staked, rate: done.length ? won.length / done.length : undefined, roi: staked ? (back - staked) / staked : undefined, inPlay: open.reduce((x, t) => x + t.stake, 0), open: open.length };
  }, [tickets]);
  return (
    <dl className="suivi-stats">
      <div>
        <dt>Bilan</dt>
        <dd className={s.profit > 0 ? 'up' : s.profit < 0 ? 'down' : ''}>{signed(s.profit)}</dd>
        <span>{s.roi != null ? `${s.roi > 0 ? '+' : ''}${Math.round(s.roi * 100)} % de ROI` : 'Aucun ticket terminé'}</span>
      </div>
      <div>
        <dt>Réussite</dt>
        <dd>{s.rate != null ? `${Math.round(s.rate * 100)} %` : '-'}</dd>
        <span>
          {s.won} gagné{s.won > 1 ? 's' : ''} sur {s.n}
        </span>
      </div>
      <div>
        <dt>En jeu</dt>
        <dd>{eur(s.inPlay)}</dd>
        <span>
          {s.open} ticket{s.open > 1 ? 's' : ''} en cours
        </span>
      </div>
    </dl>
  );
}

function LegMark({ s }: { s: LegStatus }) {
  if (s === 'won') return <span className="lm won" aria-label="Gagné"><Check size={13} weight="bold" /></span>;
  if (s === 'lost') return <span className="lm lost" aria-label="Perdu"><X size={13} weight="bold" /></span>;
  if (s === 'live') return <span className="lm live" aria-label="En cours"><i /></span>;
  return <span className="lm" aria-label="À venir" />;
}

/** Un ticket validé : sélections cochées une à une, mise, cote, gain potentiel ou gain, statut. */
function TicketCard({ t, live, isNew, owner, demo, i = 0 }: { t: Ticket; live: Record<string, LegStatus>; isNew?: boolean; owner?: string; demo?: boolean; i?: number }) {
  const ls = t.legs.map((l) => (l.status === 'won' || l.status === 'lost' ? l.status : live[l.key] ?? l.status ?? 'pending'));
  const state: LegStatus = t.status === 'won' || t.status === 'lost' ? t.status : ticketState(ls);
  const okN = ls.filter((s) => s === 'won').length;
  const [confirm, setConfirm] = useState(false);
  return (
    <article className={`tk ${state}${isNew ? ' is-new' : ''}`} style={{ '--i': i } as CSSProperties}>
      <header className="tk-head">
        <span className="tk-kind">
          {t.kind === 'combine' ? <Stack size={16} /> : <TicketIcon size={16} />} {kindLabel(t)}
        </span>
        {isNew && <span className="tk-new">Nouveau</span>}
        <span className={`tk-st ${state}`}>{state === 'live' && t.legs.length > 1 && okN ? `${okN}/${t.legs.length} validées` : STATUS[state]}</span>
      </header>
      {t.legs.length > 1 && (
        <div className="tk-prog" aria-hidden="true">
          {ls.map((s, k) => (
            <span key={k} className={s} />
          ))}
        </div>
      )}
      <ol className="tk-legs">
        {t.legs.map((l, k) => (
          <li key={l.key} className={ls[k]}>
            <LegMark s={ls[k]} />
            <div className="tk-leg-main">
              {demo ? (
                <b>{l.title}</b>
              ) : (
                <Link href={l.path} className="tk-leg-t">
                  {l.title}
                </Link>
              )}
              <span>
                {l.sport === 'nba' ? <Basketball size={13} /> : <TennisBall size={13} />} {l.match.awayName} – {l.match.homeName}
                {!demo && ` · ${when(l.start)}`}
              </span>
            </div>
            <span className="tk-odd mono">{l.odds ? dec(l.odds) : '-'}</span>
          </li>
        ))}
      </ol>
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
          <span>{state === 'won' ? 'Gain' : state === 'lost' ? 'Résultat' : 'Gain potentiel'}</span>
          <b className={state}>{state === 'lost' ? signed(-t.stake) : eur(gainOf(t))}</b>
        </div>
        {!demo && owner && (
          <div className="tk-actions">
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

/** Ticket en préparation : simple ou combiné, cote modifiable (celle de ton bookmaker), mise, gain potentiel. */
function BetSlip({ owner, legs, onPlaced }: { owner: string; legs: Leg[]; onPlaced: () => void }) {
  const [kind, setKind] = useState<Ticket['kind']>(legs.length > 1 ? 'combine' : 'simple');
  const [stakeTxt, setStakeTxt] = useState('10');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (legs.length < 2 && kind === 'combine') setKind('simple');
  }, [legs.length]);
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
  const blocked = combine && clash.size > 0;
  // Chance du combiné selon les simulations : un match compte une fois, avec son pari le moins probable.
  const byMatch = new Map<string, number>();
  for (const l of legs) byMatch.set(matchKey(l), Math.min(byMatch.get(matchKey(l)) ?? 1, l.p));
  const pAll = [...byMatch.values()].reduce((x, p) => x * p, 1);
  const gain = combine ? stake * total : legs.reduce((x, l) => x + stake * (l.odds ?? 1), 0);
  const valid = legs.length > 0 && stake > 0 && !blocked && legs.every((l) => (l.odds ?? 0) > 1);
  const place = async () => {
    setBusy(true);
    try {
      await placeTickets(owner, combine ? 'combine' : 'simple', Math.round(stake * 100) / 100, legs);
      slip.clear();
      onPlaced();
      toast({ tone: 'ok', title: combine ? 'Combiné validé' : legs.length > 1 ? `${legs.length} paris validés` : 'Pari validé', text: `Gain potentiel ${eur(gain)}. On te prévient à chaque sélection.` });
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
              <SlipLeg key={l.key} l={l} clash={combine && clash.has(matchKey(l))} stake={combine ? undefined : stake} />
            ))}
          </ul>
          {blocked && <p className="slip-warn">Deux paris du même match ne peuvent pas être combinés. Retire-en un ou passe en simple.</p>}
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
          <p className="slip-note">Razzia ne prend pas de paris : le ticket sert à suivre ceux que tu joues chez ton bookmaker. Mets sa cote si elle diffère.</p>
        </>
      )}
    </aside>
  );
}

function SlipLeg({ l, clash, stake }: { l: Leg; clash: boolean; stake?: number }) {
  const [txt, setTxt] = useState(l.odds ? dec(l.odds) : '');
  useEffect(() => setTxt(l.odds ? dec(l.odds) : ''), [l.odds]);
  const commit = () => {
    const v = parseNum(txt);
    if (v > 1 && v !== l.odds) slip.setOdds(l.key, Math.round(v * 100) / 100);
    else setTxt(l.odds ? dec(l.odds) : '');
  };
  return (
    <li className={`slip-leg${clash ? ' clash' : ''}`}>
      <div className="slip-leg-main">
        <Link href={l.path} className="slip-leg-t">
          {l.title}
        </Link>
        <span>
          {l.sport === 'nba' ? <Basketball size={13} /> : <TennisBall size={13} />} {l.match.awayName} – {l.match.homeName} · {whenShort(l.start)}
        </span>
        {stake != null && stake > 0 && l.odds && <span className="slip-leg-g">Gain potentiel {eur(stake * l.odds)}</span>}
      </div>
      <label className="slip-odd" title={l.fair ? 'Cote juste Razzia : mets celle de ton bookmaker' : 'Cote de ton bookmaker'}>
        <span>{l.fair ? 'Cote juste' : 'Cote'}</span>
        <input inputMode="decimal" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={`Cote de ${l.title}`} />
      </label>
      <button className="slip-rm" onClick={() => slip.remove(l.key)} aria-label={`Retirer ${l.title}`}>
        <X size={14} />
      </button>
    </li>
  );
}

/** En bas de l'écran, hors page Suivi : le ticket en préparation, en un coup d'œil. */
export function SlipBar({ path }: { path: string }) {
  const legs = useSlip();
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

