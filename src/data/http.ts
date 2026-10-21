// Client HTTP partagé : en-têtes navigateur (stats.nba.com / cdn.nba.com filtrent les clients non-navigateur),
// limitation de débit par hôte, reprises avec backoff, et cache disque gzip.
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const ROOT = join(import.meta.dirname, '..', '..');
export const CACHE_DIR = join(ROOT, 'data', 'cache');

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Referer: 'https://www.nba.com/',
  Origin: 'https://www.nba.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Intervalle minimal entre deux requêtes vers un même hôte (ms).
const HOST_INTERVAL: Record<string, number> = {
  'stats.nba.com': 650,
  'cdn.nba.com': 40,
  'site.api.espn.com': 150,
  'sports.core.api.espn.com': 150,
  'api.pbpstats.com': 400,
};
const lastHit = new Map<string, Promise<void>>();

async function throttle(host: string): Promise<void> {
  const gap = HOST_INTERVAL[host] ?? 200;
  const prev = lastHit.get(host) ?? Promise.resolve();
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, gap)));
  lastHit.set(host, next);
  await prev;
}

export interface FetchOpts {
  /** Durée de validité du cache en heures. Infinity = permanent (données d'une saison terminée). */
  ttlHours?: number;
  /** Clé de cache explicite (sinon hash de l'URL). */
  cacheKey?: string;
  namespace?: string;
  timeoutMs?: number;
  retries?: number;
}

function cachePath(ns: string, key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const name = safe.length > 120 ? createHash('sha1').update(key).digest('hex') : safe;
  return join(CACHE_DIR, ns, name + '.json.gz');
}

export function readCache<T>(ns: string, key: string, ttlHours = Infinity): T | undefined {
  const p = cachePath(ns, key);
  if (!existsSync(p)) return undefined;
  if (Number.isFinite(ttlHours)) {
    const ageH = (Date.now() - statSync(p).mtimeMs) / 3.6e6;
    if (ageH > ttlHours) return undefined;
  }
  return JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as T;
}

export function writeCache(ns: string, key: string, value: unknown): void {
  const p = cachePath(ns, key);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, gzipSync(Buffer.from(JSON.stringify(value))));
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} pour ${url}`);
    this.status = status;
  }
}

export async function fetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const ns = opts.namespace ?? new URL(url).host;
  const key = opts.cacheKey ?? createHash('sha1').update(url).digest('hex');
  const ttl = opts.ttlHours ?? 12;
  const cached = readCache<T>(ns, key, ttl);
  if (cached !== undefined) return cached;

  const host = new URL(url).host;
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      if (res.status === 404 || res.status === 403) throw new HttpError(res.status, url);
      if (!res.ok) throw new HttpError(res.status, url);
      const body = (await res.json()) as T;
      writeCache(ns, key, body);
      return body;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && (e.status === 404 || e.status === 403)) throw e;
      const wait = 1500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** Exécute des tâches asynchrones avec une concurrence bornée. */
export async function pool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
