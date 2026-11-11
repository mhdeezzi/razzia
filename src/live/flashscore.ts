// Lecture des flux publics Flashscore. Les identifiants sont propres à Flashscore : ne jamais les
// confondre avec ceux de FotMob/ESPN ou relancer une simulation d'avant-match depuis ces données.
import { oddsData, readOdds, type OddsQuery, type OddsSnapshot, type OddsReadOptions } from './flashscore-odds.ts';
export const SPORTS = ['foot', 'tennis', 'nba'] as const;
export type Sport = typeof SPORTS[number];
export type Fields = Array<[string, string]>;
export interface Feed {
  fetchedAt: string;
  sourceDate: string | null;
  ageSeconds: number | null;
  raw: string;
  /** Dernière lecture réussie conservée pendant une panne ; fetchedAt reste inchangé. */
  stale?: boolean;
  staleReason?: string;
}
export interface Match {
  id: string;
  sport: Sport;
  league: string;
  start: string | null;
  state: 'pre' | 'in' | 'post' | 'unknown';
  stage: string;
  home: string;
  away: string;
  score: [number | null, number | null];
  fields: Fields;
  leagueFields: Fields;
}
export interface Board { sport: Sport; fetchedAt: string; ageSeconds: number | null; matches: Match[]; stale: boolean; staleReason?: string }
export interface Statistic { period: string; group: string; id?: string; label: string; home: string | null; away: string | null }
export interface Detail {
  source: 'flashscore';
  match: Match;
  boardFetchedAt: string;
  boardAgeSeconds: number | null;
  boardStale: boolean;
  collectedAt: string;
  complete: boolean;
  statistics: Statistic[];
  feeds: Record<string, Feed>;
  errors: Record<string, string>;
  odds?: OddsSnapshot;
}

/** Les champs répétés et les codes inconnus restent disponibles, dans leur ordre d'origine. */
export function records(raw: string): Fields[] {
  return raw.split('~').map((record) => record.split('¬').flatMap((field): Fields => {
    const i = field.indexOf('÷');
    return i < 0 ? [] : [[field.slice(0, i), field.slice(i + 1)]];
  })).filter((fields) => fields.length > 0);
}
const field = (fields: Fields, key: string) => fields.find(([k]) => k === key)?.[1];
const number = (value: string | undefined): number | null => value != null && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

export function parseBoard(sport: Sport, feed: Feed): Board {
  const matches: Match[] = [];
  let leagueFields: Fields = [];
  for (const fields of records(feed.raw)) {
    if (field(fields, 'ZA') != null) leagueFields = fields;
    const id = field(fields, 'AA');
    if (!id || !/^[a-zA-Z0-9]{8}$/.test(id)) continue;
    const league = field(leagueFields, 'ZA') ?? '';
    // Le flux basket couvre le monde entier ; Razzia ne suit ici que la NBA (ni NCAA ni WNBA).
    if (sport === 'nba' && !/^USA: NBA(?:\s+-|$)/.test(league)) continue;
    const state = field(fields, 'AB');
    const timestamp = number(field(fields, 'AD'));
    const date = timestamp == null ? null : new Date(timestamp * 1000);
    matches.push({
      id, sport, league, leagueFields, fields,
      start: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
      state: state === '1' ? 'pre' : state === '2' ? 'in' : state === '3' ? 'post' : 'unknown',
      stage: field(fields, 'AC') ?? '', home: field(fields, 'AE') ?? '', away: field(fields, 'AF') ?? '',
      score: [number(field(fields, 'AG')), number(field(fields, 'AH'))],
    });
  }
  return { sport, fetchedAt: feed.fetchedAt, ageSeconds: feed.ageSeconds, matches, stale: !!feed.stale, staleReason: feed.staleReason };
}

/** Les valeurs restent textuelles : « 77% (213/277) » ne devient pas seulement 77. */
export function parseStatistics(raw: string): Statistic[] {
  let period = '', group = '';
  const out: Statistic[] = [];
  for (const fields of records(raw)) {
    period = field(fields, 'SE') ?? period;
    group = field(fields, 'SF') ?? group;
    const label = field(fields, 'SG');
    if (label != null) out.push({ period, group, id: field(fields, 'SD'), label, home: field(fields, 'SH') ?? null, away: field(fields, 'SI') ?? null });
  }
  return out;
}

/** Extrait un objet JSON, sans exécuter le JavaScript de la page et sans couper sur un ';' dans une chaîne. */
export function publicSettings(html: string): { sign: string } {
  const match = /window\.environment\s*=\s*/.exec(html);
  if (!match) throw new Error('Configuration publique Flashscore introuvable');
  const start = match.index + match[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      const settings = JSON.parse(html.slice(start, i + 1));
      const sign: unknown = settings.config?.app?.feed_sign;
      if (typeof sign !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(sign)) throw new Error('Format de configuration Flashscore modifié');
      return { sign };
    }
  }
  throw new Error('Configuration publique Flashscore incomplète');
}

export class SourceError extends Error {
  status: number;
  retryAfterMs: number;
  refreshable: boolean;
  constructor(message: string, status: number, retryAfterMs: number, refreshable = false) {
    super(message); this.status = status; this.retryAfterMs = retryAfterMs; this.refreshable = refreshable;
  }
}

type Signature = { sign: string; at: number };
const SETTINGS_TTL_MS = 5 * 60_000;
const SETTINGS_RETRY_MS = 30_000;
const STALE_MS = 60_000;

export interface ClientOptions { fetch?: typeof fetch; now?: () => number; ttlMs?: number; concurrency?: number }
export class Flashscore {
  private fetcher: typeof fetch;
  private now: () => number;
  private ttlMs: number;
  private concurrency: number;
  private active = 0;
  private waiting: Array<() => void> = [];
  private cache = new Map<string, { at: number; feed: Feed }>();
  private pending = new Map<string, Promise<Feed>>();
  private oddsCache = new Map<string, { at: number; feed: Feed }>();
  private oddsPending = new Map<string, Promise<Feed>>();
  private settings?: Signature;
  private settingPending?: Promise<Signature>;
  private settingsRetryAt = 0;
  private settingsError?: unknown;
  private renewal?: { rejected: string; promise: Promise<Signature> };
  private blockedUntil = 0;
  private oddsBlockedUntil = 0;

  constructor(options: ClientOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 1000;
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error('Concurrence invalide');
  }

  retryAfterMs(): number {
    return Math.max(0, this.blockedUntil - this.now(), this.settings ? 0 : this.settingsRetryAt - this.now());
  }

  oddsRetryAfterMs(): number { return Math.max(0, this.oddsBlockedUntil - this.now()); }

  private pause(error: SourceError): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + error.retryAfterMs);
  }

  private async request(url: string, headers: Record<string, string> | (() => Record<string, string>) = {}, mayRefresh = false, settingsRequest = false, oddsRequest = false): Promise<Feed> {
    if (this.active >= this.concurrency) await new Promise<void>((resolve) => settingsRequest ? this.waiting.unshift(resolve) : this.waiting.push(resolve));
    else this.active++;
    try {
      const blockedUntil = oddsRequest ? this.oddsBlockedUntil : this.blockedUntil;
      if (this.now() < blockedUntil) throw new SourceError('Flashscore en pause après un refus ou une limite de débit', 429, blockedUntil - this.now());
      const response = await this.fetcher(url, { headers: typeof headers === 'function' ? headers() : headers, signal: AbortSignal.timeout(8000) });
      if (oddsRequest && response.status === 202) {
        const ms = Number(response.headers.get('x-retry-after-ms'));
        const retry = response.headers.get('retry-after');
        const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - this.now() : 0;
        const wait = Math.max(Number.isFinite(ms) && ms > 0 ? ms : 5000, Number.isFinite(retryMs) ? retryMs : 0);
        this.oddsBlockedUntil = Math.max(this.oddsBlockedUntil, this.now() + wait);
        await response.body?.cancel().catch(() => undefined);
        throw new SourceError('Cotes Flashscore en préparation', 202, wait);
      }
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - this.now() : 60_000;
        const retryAfterMs = Number.isFinite(delay) ? Math.max(5000, delay) : 60_000;
        // Un refus de signature sans Retry-After permet UNE relecture de la configuration publique.
        // Une limitation explicite de la source est toujours respectée avant toute autre lecture.
        const refreshable = mayRefresh && [401, 403].includes(response.status) && retry == null;
        const error = new SourceError('Flashscore : HTTP ' + response.status, response.status, retryAfterMs, refreshable);
        // La page de configuration a sa propre pause : son indisponibilité ne révoque pas une clé encore valide.
        if (!settingsRequest && !refreshable && ([401, 403, 429].includes(response.status) || retry != null)) {
          if (oddsRequest) this.oddsBlockedUntil = Math.max(this.oddsBlockedUntil, this.now() + retryAfterMs);
          else this.pause(error);
        }
        await response.body?.cancel().catch(() => undefined);
        throw error;
      }
      const raw = await response.text();
      const age = response.headers.get('age');
      return { raw, fetchedAt: new Date(this.now()).toISOString(), sourceDate: response.headers.get('date'), ageSeconds: age == null ? null : number(age), stale: false };
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private async refreshSettings(): Promise<Signature> {
    if (this.settingPending) return this.settingPending;
    if (this.now() < this.settingsRetryAt) throw this.settingsError;
    this.settingPending = (async () => {
      const page = await this.request('https://www.flashscore.com/basketball/usa/nba/', { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, false, true);
      this.settings = { ...publicSettings(page.raw), at: this.now() };
      this.settingsRetryAt = 0;
      this.settingsError = undefined;
      return this.settings;
    })();
    try { return await this.settingPending; }
    catch (error) {
      this.settingsError = error;
      this.settingsRetryAt = this.now() + Math.max(SETTINGS_RETRY_MS, this.retryAfterMs(), error instanceof SourceError ? error.retryAfterMs : 0);
      throw error;
    } finally { this.settingPending = undefined; }
  }

  private async sign(): Promise<Signature> {
    const current = this.settings;
    if (!current) return this.refreshSettings();
    // Renouvellement préventif en arrière-plan : la signature encore valide continue de servir le live.
    if (this.now() - current.at >= SETTINGS_TTL_MS && this.now() >= this.settingsRetryAt && !this.settingPending) {
      void this.refreshSettings().catch(() => undefined);
    }
    return current;
  }

  private async renew(rejected: string, error: SourceError): Promise<Signature> {
    if (this.retryAfterMs()) throw new SourceError('Flashscore en pause après un refus ou une limite de débit', 429, this.retryAfterMs());
    // Un refus tardif d'un appel déjà parti ne doit pas invalider la nouvelle signature.
    if (this.settings && this.settings.sign !== rejected) return this.settings;
    if (this.renewal?.rejected === rejected) return this.renewal.promise;
    const promise = (async () => {
      try {
        const next = await this.refreshSettings();
        if (next.sign === rejected) throw error;
        return next;
      } catch (refreshError) {
        this.pause(error);
        throw refreshError;
      }
    })();
    this.renewal = { rejected, promise };
    try { return await promise; }
    finally { if (this.renewal?.promise === promise) this.renewal = undefined; }
  }

  private async readFeed(name: string): Promise<Feed> {
    let signature = await this.sign();
    const read = async (mayRefresh: boolean) => {
      const feed = await this.request('https://global.flashscore.ninja/2/x/feed/' + name, () => {
        // Une requête en attente du sémaphore prend la signature la plus récente au moment de partir.
        signature = this.settings ?? signature;
        return { 'x-fsign': signature.sign, Referer: 'https://www.flashscore.com/' };
      }, mayRefresh);
      // Une page HTML/une erreur JSON servie en HTTP 200 n'est pas un tableau de scores vide.
      if (feed.raw.trim() && !/^~*[A-Z][A-Z0-9]*÷/.test(feed.raw.trim())) {
        const error = new SourceError('Réponse Flashscore inattendue (flux remplacé par une page ou une erreur)', 502, 60_000, mayRefresh);
        if (!mayRefresh) this.pause(error);
        throw error;
      }
      return feed;
    };
    try { return await read(true); }
    catch (error) {
      if (!(error instanceof SourceError) || !error.refreshable) throw error;
      signature = await this.renew(signature.sign, error);
      return read(false); // Une seule reprise, et uniquement avec une signature différente.
    }
  }

  async feed(name: string): Promise<Feed> {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Nom de flux invalide');
    const cached = this.cache.get(name);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.feed;
    const existing = this.pending.get(name);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const feed = await this.readFeed(name);
        this.cache.set(name, { at: this.now(), feed });
        if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value!);
        return feed;
      } catch (error) {
        // Conserve au plus une minute de données explicites, sans modifier leur date ni leur cache.
        if (cached && this.now() - cached.at <= STALE_MS) return {
          ...cached.feed, stale: true, staleReason: error instanceof Error ? error.message : 'Source indisponible',
        };
        throw error;
      }
    })();
    this.pending.set(name, pending);
    try { return await pending; } finally { this.pending.delete(name); }
  }

  async board(sport: Sport): Promise<Board> {
    if (!SPORTS.includes(sport)) throw new Error('Sport invalide');
    const id = { foot: 1, tennis: 2, nba: 3 }[sport];
    return parseBoard(sport, await this.feed('f_' + id + '_0_3_en_1'));
  }

  private async oddsFeed(query: OddsQuery): Promise<Feed> {
    if (!/^[a-zA-Z0-9]{8}$/.test(query.eventId) || !['oce', 'lobtm', 'ole2'].includes(query.hash)) throw new Error('Requête de cotes invalide');
    const params = new URLSearchParams({ _hash: query.hash, eventId: query.eventId });
    if (query.hash === 'ole2') {
      if (!Number.isSafeInteger(query.bookmakerId) || query.bookmakerId! <= 0 || !/^[A-Z0-9_]{1,80}$/.test(query.market ?? '') || !/^[A-Z0-9_]{1,80}$/.test(query.scope ?? '')) throw new Error('Marché live invalide');
      params.set('bookmakerId', String(query.bookmakerId));
      params.set('betType', query.market!); params.set('betScope', query.scope!);
    } else {
      params.set('projectId', '2'); params.set('geoIpCode', ''); params.set('geoIpSubdivisionCode', '');
    }
    const key = 'odds:' + params;
    const cached = this.oddsCache.get(key);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.feed;
    const existing = this.oddsPending.get(key);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const origin = query.hash === 'oce' ? 'https://global.ds.lsapp.eu/odds/pq_graphql' : 'https://2.ds.lsapp.eu/pq_graphql';
        const feed = await this.request(origin + '?' + params, { Accept: 'application/json' }, false, false, true);
        oddsData(feed, query.hash === 'oce' ? 'findOddsByEventId' : query.hash === 'lobtm' ? 'getLiveOddsBettingTypeMenu' : 'findLiveOddsForBookmaker');
        this.oddsCache.set(key, { at: this.now(), feed });
        if (this.oddsCache.size > 1000) this.oddsCache.delete(this.oddsCache.keys().next().value!);
        return feed;
      } catch (error) {
        if (cached && this.now() - cached.at <= STALE_MS) return { ...cached.feed, stale: true, staleReason: error instanceof Error ? error.message : 'Cotes indisponibles' };
        throw error;
      }
    })();
    this.oddsPending.set(key, pending);
    try { return await pending; } finally { this.oddsPending.delete(key); }
  }

  async odds(match: Match, options: OddsReadOptions = {}): Promise<OddsSnapshot> {
    const result = await readOdds(match, (query) => this.oddsFeed(query), options);
    return { ...result, retryAfterMs: this.oddsRetryAfterMs() };
  }

  async detail(match: Match, board: Board, options: { odds?: boolean } = {}): Promise<Detail> {
    if (!/^[a-zA-Z0-9]{8}$/.test(match.id)) throw new Error('Identifiant Flashscore invalide');
    const id = match.id;
    const names: Record<string, string> = {
      summary: 'df_sur_1_' + id, common: 'dc_1_' + id,
      statistics: 'df_st_1_' + id, players: 'df_psn_1_' + id,
      timeline: 'df_sui_1_' + id,
    };
    if (match.sport === 'tennis') {
      names.history = 'df_mh_1_' + id;
      names.currentGame = 'df_mhs_1_' + id;
    }
    const feeds: Record<string, Feed> = {}, errors: Record<string, string> = {};
    if (board.stale) errors.board = board.staleReason ?? 'Dernier tableau connu, source indisponible';
    await Promise.all(Object.entries(names).map(async ([kind, name]) => {
      try {
        feeds[kind] = await this.feed(name);
        if (feeds[kind].stale) errors[kind] = feeds[kind].staleReason ?? 'Dernière lecture connue, source indisponible';
      }
      catch (e) { errors[kind] = e instanceof Error ? e.message : 'Flux indisponible'; }
    }));
    const odds = options.odds ? await this.odds(match) : undefined;
    if (odds && !odds.complete) errors.odds = Object.values(odds.errors).join('; ');
    return {
      source: 'flashscore', match, boardFetchedAt: board.fetchedAt, boardAgeSeconds: board.ageSeconds, boardStale: board.stale,
      collectedAt: new Date(this.now()).toISOString(), complete: !Object.keys(errors).length,
      statistics: parseStatistics(feeds.statistics?.raw ?? ''), feeds, errors, ...(odds ? { odds } : {}),
    };
  }
}

export interface Snapshot {
  source: 'flashscore'; startedAt: string; collectedAt: string; durationMs: number;
  boards: Partial<Record<Sport, Board>>; matches: Detail[]; errors: Record<string, string>;
}

/** Inclut une dernière lecture des matchs qui viennent de finir ; aucun recalcul d'avant-match. */
export async function collect(client: Flashscore, sports: Sport[], ids?: Set<string>, previous = new Set<string>(), options: { odds?: boolean; prematch?: boolean } = {}): Promise<Snapshot> {
  const started = Date.now();
  const boards: Partial<Record<Sport, Board>> = {}, errors: Record<string, string> = {};
  await Promise.all(sports.map(async (sport) => {
    try {
      const board = await client.board(sport);
      boards[sport] = board;
      if (board.stale) errors[sport] = board.staleReason ?? 'Dernier tableau connu, source indisponible';
    }
    catch (e) { errors[sport] = e instanceof Error ? e.message : 'Source indisponible'; }
  }));
  const matches: Detail[] = [];
  // Traite quatre matchs à la fois : pas de milliers de promesses/requêtes en file un soir chargé.
  const jobs = Object.values(boards).flatMap((board) => board.matches.filter((m) =>
    (!ids || ids.has(m.id)) && (m.state === 'in' || (m.state === 'pre' && options.prematch) || (m.state === 'post' && previous.has(m.sport + ':' + m.id))),
  ).map((match) => ({ match, board })));
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (index < jobs.length) {
      const { match, board } = jobs[index++];
      matches.push(await client.detail(match, board, options));
    }
  }));
  matches.sort((a, b) => (a.match.sport + a.match.id).localeCompare(b.match.sport + b.match.id));
  return { source: 'flashscore', startedAt: new Date(started).toISOString(), collectedAt: new Date().toISOString(), durationMs: Date.now() - started, boards, matches, errors };
}
