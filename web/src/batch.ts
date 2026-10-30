// Simulation de toute une soirée : une demande par match à venir, lancées ensemble (GitHub calcule jusqu'à 20 matchs en parallèle).
// Une seule soirée à la fois : le verrou vit dans le navigateur (partagé entre onglets) et tombe quand tout est publié ou a échoué.
import { useSyncExternalStore } from 'react';
import { listSims, pending, simKey, simRuns, startSim, type Game } from './data.ts';

export type ItemState = 'sending' | 'queued' | 'running' | 'done' | 'failed';
export interface BatchItem {
  key: string;
  away: string;
  home: string;
  req?: string;
  state: ItemState;
  startedAt?: string;
  url?: string;
  error?: string;
}
export interface Batch {
  date: string;
  at: number;
  endedAt?: number;
  actions?: string;
  items: BatchItem[];
}

const KEY = 'soiree';
const MAX_RUN = 2 * 3600e3; // au-delà, une soirée bloquée ne verrouille plus le bouton
const KEEP_DONE = 30 * 60e3; // une soirée terminée reste affichée une demi-heure
const LOST = 10 * 60e3; // demande jamais apparue chez GitHub
const POLL = 7000;

const terminal = (s: ItemState) => s === 'done' || s === 'failed';
export const isRunning = (b?: Batch): b is Batch => !!b && !b.endedAt && Date.now() - b.at < MAX_RUN;

function load(): Batch | undefined {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Batch | null;
    if (!b || (b.endedAt ? Date.now() - b.endedAt > KEEP_DONE : Date.now() - b.at > MAX_RUN)) return undefined;
    return b;
  } catch {
    return undefined;
  }
}

let current = load();
const listeners = new Set<() => void>();
let timer: number | undefined;

function commit(b: Batch | undefined) {
  if (b && !b.endedAt && b.items.every((i) => terminal(i.state))) b = { ...b, endedAt: Date.now() };
  current = b;
  try {
    if (b) localStorage.setItem(KEY, JSON.stringify(b));
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : le verrou ne vaut que pour cet onglet */
  }
  listeners.forEach((f) => f());
}

function patch(key: string, change: Partial<BatchItem>) {
  if (!current) return;
  commit({ ...current, items: current.items.map((i) => (i.key === key ? { ...i, ...change } : i)) });
}

function schedule(ms: number) {
  window.clearTimeout(timer);
  timer = isRunning(current) ? window.setTimeout(poll, ms) : undefined;
}

async function poll() {
  const b = current;
  if (!isRunning(b)) return;
  const watched = b.items.filter((i) => i.req && !terminal(i.state));
  if (watched.length) {
    try {
      const [{ runs, actions }, sims] = await Promise.all([simRuns(watched.map((i) => i.req!)), listSims(true, true)]);
      if (current !== b) return schedule(POLL); // modifiée entre-temps (autre onglet) : on repart de la nouvelle version
      let published = false;
      const items = b.items.map((i): BatchItem => {
        if (terminal(i.state)) return i;
        // Simulation déjà publiée depuis la demande : prête, même si GitHub affiche encore « en attente » (son état peut
        // retarder de plusieurs minutes).
        const sim = sims.get(i.key);
        if (sim && Date.parse(sim.at) > b.at) {
          pending.clear(i.key);
          return { ...i, state: 'done' };
        }
        const r = i.req ? runs[i.req] : undefined;
        if (!r) return i;
        if (r.status === 'done') {
          published = true;
          pending.clear(i.key);
        }
        if (r.status === 'queued' && !r.url && Date.now() - b.at > LOST) return { ...i, state: 'failed', error: "La demande n'est jamais arrivée chez GitHub." };
        return { ...i, state: r.status, startedAt: r.startedAt ?? i.startedAt, url: r.url ?? i.url };
      });
      commit({ ...b, actions, items });
      if (published) void listSims(true, true);
    } catch {
      /* réseau : nouvel essai au prochain tour */
    }
  }
  // Envoi interrompu (onglet fermé pendant l'envoi) : la demande n'est jamais partie.
  if (current && Date.now() - current.at > 2 * 60e3)
    for (const i of current.items) if (i.state === 'sending') patch(i.key, { state: 'failed', error: "L'envoi a été interrompu." });
  schedule(POLL);
}

async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) await fn(list[next++]);
  }));
}

/** Lance la soirée `date` : refusé tant qu'une autre soirée tourne. */
export async function startBatch(date: string, games: Game[]): Promise<void> {
  if (isRunning(current) || !games.length) return;
  // Un match déjà en calcul (lancé depuis sa fiche) est suivi tel quel, sans nouvelle demande.
  const items = games.map((g): BatchItem => {
    const p = pending.get(simKey(g));
    return { key: simKey(g), away: g.away.tri, home: g.home.tri, req: p?.req, state: p ? 'queued' : 'sending' };
  });
  commit({ date, at: Date.now(), items });
  schedule(4000);
  // Par paquets de 4 : la fonction Vercel et l'API GitHub encaissent mieux qu'une rafale.
  await pool(games.filter((_, k) => !items[k].req), 4, async (g) => {
    const key = simKey(g);
    try {
      const req = await startSim(g);
      pending.set(key, { req, at: Date.now() });
      patch(key, { req, state: 'queued' });
    } catch (e) {
      patch(key, { state: 'failed', error: (e as Error).message });
    }
  });
}

/** Retire une soirée terminée de l'écran (sans effet tant qu'elle tourne). */
export function dismissBatch() {
  if (!isRunning(current)) commit(undefined);
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}
export const useBatch = () => useSyncExternalStore(subscribe, () => current);

// Autre onglet : même soirée, même verrou.
addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  current = load();
  listeners.forEach((f) => f());
  schedule(POLL);
});
schedule(500);
