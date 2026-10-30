// Suivi des paris, comme un ticket de bookmaker : depuis une fiche, « Suivre » ajoute un pari au ticket en préparation
// (gardé dans le navigateur) ; sur la page Suivi, le ticket se valide en simple ou en combiné avec une mise, et part
// dans le compte (table Supabase « tickets »). Les tickets se règlent seuls d'après les scores : chaque sélection passe
// gagnée ou perdue, puis le ticket ; l'app le signale (message et pastille sur Suivi).
import { useEffect, useState } from 'react';
import type { Outcome } from './picks.ts';
import { supabase } from './supabase.ts';

export type LegStatus = 'pending' | 'live' | 'won' | 'lost';

export interface Leg {
  key: string; // match + pari : un même pari n'est qu'une fois dans le ticket
  sport: 'nba' | 'atp';
  date: string; // jour du match (NBA : date à New York ; tennis : jour du programme)
  start: string; // heure du match (ISO)
  match: { id?: string; home: string; away: string; homeName: string; awayName: string };
  title: string;
  odds?: number; // cote du bookmaker au moment de l'ajout (modifiable dans le ticket), sinon cote juste
  fair: boolean; // true : cote juste (aucune cote publiée)
  p: number; // fréquence dans les simulations
  bet: NonNullable<Outcome['bet']>;
  path: string; // lien vers la fiche
  at: string;
  status?: LegStatus; // dans un ticket validé : issue figée une fois le match fini
}

/** Identifiant du match d'un pari : deux paris du même match ne se combinent pas. */
export const matchKey = (l: Pick<Leg, 'sport' | 'date' | 'match'>) => `${l.sport}:${l.date}:${l.match.id ?? `${l.match.away}@${l.match.home}`}`;

/** Cote totale d'un combiné (produit des cotes). */
export const comboOdds = (legs: Leg[]) => legs.reduce((x, l) => x * (l.odds ?? 1), 1);

// ——— Ticket en préparation (navigateur) ———

const KEY = 'razzia-suivi';
const EVENT = 'razzia-suivi';

function read(): Leg[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Leg[];
  } catch {
    return [];
  }
}
function write(legs: Leg[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(legs));
  } catch {
    /* stockage indisponible : le ticket reste le temps de la page */
  }
  dispatchEvent(new Event(EVENT));
}

export const slip = {
  list: read,
  add(leg: Leg) {
    write([...read().filter((l) => l.key !== leg.key), leg]);
  },
  remove(key: string) {
    write(read().filter((l) => l.key !== key));
  },
  setOdds(key: string, odds: number) {
    write(read().map((l) => (l.key === key ? { ...l, odds, fair: false } : l)));
  },
  clear() {
    write([]);
  },
};

/** Paris du ticket en préparation, à jour quand un autre composant (ou un autre onglet) le modifie. */
export function useSlip(): Leg[] {
  const [legs, setLegs] = useState<Leg[]>(read);
  useEffect(() => {
    const on = () => setLegs(read());
    addEventListener(EVENT, on);
    addEventListener('storage', on);
    return () => {
      removeEventListener(EVENT, on);
      removeEventListener('storage', on);
    };
  }, []);
  return legs;
}

// ——— Tickets validés (compte) ———

export type TicketStatus = 'pending' | 'won' | 'lost';
export interface Ticket {
  id: string;
  created_at: string;
  kind: 'simple' | 'combine';
  stake: number;
  odds: number;
  legs: Leg[];
  status: TicketStatus;
  settled_at: string | null;
  seen: boolean; // false : ticket réglé que l'utilisateur n'a pas encore vu
}

type Store = { tickets?: Ticket[]; error?: string; owner?: string };
let store: Store = {};
const subs = new Set<(s: Store) => void>();
const setStore = (s: Store) => {
  store = s;
  subs.forEach((f) => f(store));
};
const num = (t: Ticket): Ticket => ({ ...t, stake: Number(t.stake), odds: Number(t.odds) });
// Table pas encore créée dans Supabase : message clair plutôt que l'erreur brute.
const tableError = (e: { code?: string; message: string }) =>
  e.code === '42P01' || e.code === 'PGRST205' ? "La table des tickets n'existe pas encore dans Supabase (voir supabase/tickets.sql)." : e.message;

/** Relit les tickets du compte connecté (une seule lecture à la fois quand plusieurs composants la demandent). */
let inflight: Promise<void> | undefined;
export async function loadTickets(owner: string, fresh = false): Promise<void> {
  if (!supabase) return;
  const sb = supabase;
  // Après un ajout ou une suppression, une lecture déjà partie peut être périmée : on en relance une après elle.
  if (fresh && inflight) await inflight;
  inflight ??= (async () => {
    const { data, error } = await sb.from('tickets').select('*').order('created_at', { ascending: false }).limit(500);
    setStore(error ? { ...store, owner, error: tableError(error) } : { owner, tickets: (data as Ticket[]).map(num) });
  })().finally(() => (inflight = undefined));
  return inflight;
}

/** Tickets du compte (undefined pendant le chargement) ; vidés à la déconnexion. */
export function useTickets(owner: string | undefined): Store {
  const [s, setS] = useState(store);
  useEffect(() => {
    subs.add(setS);
    if (!owner) setStore({});
    else if (store.owner !== owner) void loadTickets(owner);
    else setS(store);
    return () => void subs.delete(setS);
  }, [owner]);
  return s.owner === owner ? s : {};
}

/** Valide le ticket : un ticket par pari en simple (même mise chacun), un seul en combiné. */
export async function placeTickets(owner: string, kind: Ticket['kind'], stake: number, legs: Leg[]) {
  if (!supabase) throw new Error('Comptes non configurés.');
  const clean = legs.map(({ status: _s, ...l }) => l);
  const rows: Array<Pick<Ticket, 'kind' | 'stake' | 'odds' | 'legs'>> = kind === 'combine' ? [{ kind, stake, odds: round(comboOdds(clean), 3), legs: clean }] : clean.map((l) => ({ kind, stake, odds: l.odds ?? 1, legs: [l] }));
  const { error } = await supabase.from('tickets').insert(rows);
  if (error) throw new Error(tableError(error));
  await loadTickets(owner, true);
}

export async function deleteTicket(owner: string, id: string) {
  if (!supabase) return;
  const { error } = await supabase.from('tickets').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await loadTickets(owner, true);
}

/** Tickets réglés vus : la pastille de Suivi s'éteint. */
export async function markSeen(owner: string, ids: string[]) {
  if (!supabase || !ids.length) return;
  await supabase.from('tickets').update({ seen: true }).in('id', ids);
  if (store.owner === owner && store.tickets) setStore({ ...store, tickets: store.tickets.map((t) => (ids.includes(t.id) ? { ...t, seen: true } : t)) });
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Issue d'un ticket à partir de ses sélections : perdu dès une sélection perdue, gagné quand toutes le sont. */
export function ticketState(s: LegStatus[]): LegStatus {
  if (s.includes('lost')) return 'lost';
  if (s.length && s.every((x) => x === 'won')) return 'won';
  return s.includes('live') || s.includes('won') ? 'live' : 'pending';
}

// ——— Résultats ———

interface NbaFinal { state: 'pre' | 'in' | 'post'; home: number; away: number }
interface AtpFinal { state: 'pre' | 'in' | 'post'; sets: { home: number; away: number }; winner?: 'home' | 'away' }

/** Issue d'un pari d'après le score : gagné, perdu, ou pas encore joué / en cours. */
export function statusOf(leg: Leg, nba?: NbaFinal, atp?: AtpFinal): LegStatus {
  const other = leg.bet.side === 'home' ? 'away' : 'home';
  if (leg.sport === 'nba') {
    if (!nba || nba.state === 'pre') return 'pending';
    if (nba.state === 'in') return 'live';
    const margin = nba[leg.bet.side] - nba[other];
    if (leg.bet.kind === 'spread') return margin + (leg.bet.line ?? 0) > 0 ? 'won' : 'lost';
    return margin > 0 ? 'won' : 'lost';
  }
  if (!atp || atp.state === 'pre') return 'pending';
  if (atp.state === 'in' && !atp.winner) return 'live';
  const mine = atp.sets[leg.bet.side], theirs = atp.sets[other];
  if (leg.bet.kind === 'win') return atp.winner === leg.bet.side ? 'won' : 'lost';
  if (leg.bet.kind === 'sets') return atp.winner === leg.bet.side || mine >= (leg.bet.need ?? 1) ? 'won' : 'lost';
  return atp.winner === leg.bet.side && theirs === 0 ? 'won' : 'lost';
}

/** Statut de chaque pari (clé du pari) d'après les scores : programme NBA du jour du match, programme tennis récent. */
export async function fetchStatuses(legs: Leg[]): Promise<Record<string, LegStatus>> {
  const res: Record<string, LegStatus> = {};
  const nbaDays = [...new Set(legs.filter((l) => l.sport === 'nba').map((l) => l.date))];
  const nbaGames = new Map<string, NbaFinal>();
  await Promise.all(
    nbaDays.map(async (d) => {
      try {
        const r = await fetch(`/api/games?days=1&from=${d}`).then((x) => x.json());
        for (const g of r.games ?? []) nbaGames.set(`${g.date}_${g.away.tri}@${g.home.tri}`, { state: g.state, home: g.home.score ?? 0, away: g.away.score ?? 0 });
      } catch {
        /* réseau : on garde « à venir » */
      }
    }),
  );
  const atpGames = new Map<string, AtpFinal>();
  if (legs.some((l) => l.sport === 'atp')) {
    try {
      const r = await fetch('/api/tennis?slate=1').then((x) => x.json());
      for (const m of r.matches ?? []) {
        const l = m.live;
        const won = (side: 'home' | 'away') => (l?.[side] ?? []).filter((x: { w?: boolean }) => x.w).length;
        atpGames.set(String(m.id), { state: l?.state ?? 'pre', sets: { home: won('home'), away: won('away') }, winner: l?.winner });
      }
    } catch {
      /* idem */
    }
  }
  for (const l of legs)
    res[l.key] = statusOf(l, l.sport === 'nba' ? nbaGames.get(`${l.date}_${l.match.away}@${l.match.home}`) : undefined, l.sport === 'atp' ? atpGames.get(l.match.id ?? '') : undefined);
  return res;
}

/** Statuts en direct des paris affichés (relus chaque minute tant qu'un match est en cours). */
export function useResults(legs: Leg[]): Record<string, LegStatus> {
  const [out, setOut] = useState<Record<string, LegStatus>>({});
  const todo = legs.filter((l) => !l.status || l.status === 'pending' || l.status === 'live');
  const sig = todo.map((l) => l.key).join('|');
  useEffect(() => {
    if (!todo.length) return;
    let alive = true;
    const run = () => fetchStatuses(todo).then((r) => alive && setOut(r));
    void run();
    const t = window.setInterval(run, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [sig]);
  return out;
}

export interface SettleEvent { kind: 'leg' | 'ticket'; status: 'won' | 'lost'; ticket: Ticket; leg?: Leg }

/**
 * Règle les tickets en attente du compte : fige l'issue des sélections terminées, puis celle du ticket. Renvoie ce qui
 * vient de changer (sélection validée, ticket gagné ou perdu) pour le signaler.
 */
// Un seul règlement à la fois, et chaque nouvelle n'est annoncée qu'une fois (plusieurs relectures peuvent se croiser).
let settling = false;
const told = new Set<string>();
export async function settleTickets(owner: string, tickets: Ticket[]): Promise<SettleEvent[]> {
  if (!supabase || settling) return [];
  settling = true;
  try {
    return await settle(owner, tickets);
  } finally {
    settling = false;
  }
}

async function settle(owner: string, tickets: Ticket[]): Promise<SettleEvent[]> {
  if (!supabase) return [];
  const now = Date.now();
  const open = tickets.filter((t) => t.status === 'pending' && t.legs.some((l) => (!l.status || l.status === 'pending' || l.status === 'live') && Date.parse(l.start) < now));
  if (!open.length) return [];
  const st = await fetchStatuses(open.flatMap((t) => t.legs.filter((l) => l.status !== 'won' && l.status !== 'lost')));
  const events: SettleEvent[] = [];
  const tell = (k: string, e: SettleEvent) => {
    if (told.has(k)) return;
    told.add(k);
    events.push(e);
  };
  for (const t of open) {
    const fresh: Leg[] = [];
    const legs = t.legs.map((l) => {
      const s = st[l.key];
      if (l.status === 'won' || l.status === 'lost' || (s !== 'won' && s !== 'lost')) return l;
      fresh.push({ ...l, status: s });
      return { ...l, status: s };
    });
    if (!fresh.length) continue;
    const fin = ticketState(legs.map((l) => l.status ?? 'pending'));
    const status: TicketStatus = fin === 'won' || fin === 'lost' ? fin : 'pending';
    const patch = status === 'pending' ? { legs } : { legs, status, settled_at: new Date().toISOString(), seen: false };
    // Seulement si le ticket était encore en attente (un autre onglet a pu le régler entre-temps).
    const { data, error } = await supabase.from('tickets').update(patch).eq('id', t.id).eq('status', 'pending').select('id');
    if (error || !data?.length) continue;
    const next = { ...t, ...patch } as Ticket;
    if (t.legs.length > 1) for (const l of fresh) tell(`${t.id}:${l.key}`, { kind: 'leg', status: l.status as 'won' | 'lost', ticket: next, leg: l });
    if (status !== 'pending') tell(t.id, { kind: 'ticket', status, ticket: next });
  }
  if (events.length) await loadTickets(owner, true);
  return events;
}
