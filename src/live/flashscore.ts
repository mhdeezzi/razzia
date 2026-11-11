// Lecture des flux publics Flashscore. Les identifiants sont propres à Flashscore : ne jamais les
// confondre avec ceux de FotMob/ESPN ou relancer une simulation d'avant-match depuis ces données.
export const SPORTS = ['foot', 'tennis', 'nba'] as const;
export type Sport = typeof SPORTS[number];
export type Fields = Array<[string, string]>;
export interface Feed {
  fetchedAt: string;
  sourceDate: string | null;
  ageSeconds: number | null;
  raw: string;
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
export interface Board { sport: Sport; fetchedAt: string; ageSeconds: number | null; matches: Match[] }
export interface Statistic { period: string; group: string; id?: string; label: string; home: string | null; away: string | null }
export interface Detail {
  source: 'flashscore';
  match: Match;
  boardFetchedAt: string;
  boardAgeSeconds: number | null;
  collectedAt: string;
  complete: boolean;
  statistics: Statistic[];
  feeds: Record<string, Feed>;
  errors: Record<string, string>;
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
  return { sport, fetchedAt: feed.fetchedAt, ageSeconds: feed.ageSeconds, matches };
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
  constructor(message: string, status: number, retryAfterMs: number) {
    super(message); this.status = status; this.retryAfterMs = retryAfterMs;
  }
}

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
  private settings?: { sign: string; at: number };
  private settingPending?: Promise<string>;
  private blockedUntil = 0;

  constructor(options: ClientOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 1000;
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error('Concurrence invalide');
  }

  retryAfterMs(): number { return Math.max(0, this.blockedUntil - this.now()); }

  private async request(url: string, headers: Record<string, string> = {}): Promise<Feed> {
    if (this.active >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      if (this.now() < this.blockedUntil) throw new SourceError('Flashscore en pause après un refus ou une limite de débit', 429, this.blockedUntil - this.now());
      const response = await this.fetcher(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - this.now() : 60_000;
        const retryAfterMs = Number.isFinite(delay) ? Math.max(5000, delay) : 60_000;
        if (response.status === 403 || response.status === 429) this.blockedUntil = this.now() + retryAfterMs;
        throw new SourceError('Flashscore : HTTP ' + response.status, response.status, retryAfterMs);
      }
      const raw = await response.text();
      const age = response.headers.get('age');
      return { raw, fetchedAt: new Date(this.now()).toISOString(), sourceDate: response.headers.get('date'), ageSeconds: age == null ? null : number(age) };
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private async sign(): Promise<string> {
    if (this.settings && this.now() - this.settings.at < 3_600_000) return this.settings.sign;
    if (this.settingPending) return this.settingPending;
    this.settingPending = (async () => {
      const page = await this.request('https://www.flashscore.com/basketball/usa/nba/');
      this.settings = { ...publicSettings(page.raw), at: this.now() };
      return this.settings.sign;
    })();
    try { return await this.settingPending; } finally { this.settingPending = undefined; }
  }

  async feed(name: string): Promise<Feed> {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Nom de flux invalide');
    const cached = this.cache.get(name);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.feed;
    const existing = this.pending.get(name);
    if (existing) return existing;
    const pending = (async () => {
      const sign = await this.sign();
      const feed = await this.request('https://global.flashscore.ninja/2/x/feed/' + name, { 'x-fsign': sign, Referer: 'https://www.flashscore.com/' });
      this.cache.set(name, { at: this.now(), feed });
      if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value!);
      return feed;
    })();
    this.pending.set(name, pending);
    try { return await pending; } finally { this.pending.delete(name); }
  }

  async board(sport: Sport): Promise<Board> {
    if (!SPORTS.includes(sport)) throw new Error('Sport invalide');
    const id = { foot: 1, tennis: 2, nba: 3 }[sport];
    return parseBoard(sport, await this.feed('f_' + id + '_0_3_en_1'));
  }

  async detail(match: Match, board: Board): Promise<Detail> {
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
    await Promise.all(Object.entries(names).map(async ([kind, name]) => {
      try { feeds[kind] = await this.feed(name); }
      catch (e) { errors[kind] = e instanceof Error ? e.message : 'Flux indisponible'; }
    }));
    return {
      source: 'flashscore', match, boardFetchedAt: board.fetchedAt, boardAgeSeconds: board.ageSeconds,
      collectedAt: new Date(this.now()).toISOString(), complete: !Object.keys(errors).length,
      statistics: parseStatistics(feeds.statistics?.raw ?? ''), feeds, errors,
    };
  }
}

export interface Snapshot {
  source: 'flashscore'; startedAt: string; collectedAt: string; durationMs: number;
  boards: Partial<Record<Sport, Board>>; matches: Detail[]; errors: Record<string, string>;
}

/** Inclut une dernière lecture des matchs qui viennent de finir ; aucun recalcul d'avant-match. */
export async function collect(client: Flashscore, sports: Sport[], ids?: Set<string>, previous = new Set<string>()): Promise<Snapshot> {
  const started = Date.now();
  const boards: Partial<Record<Sport, Board>> = {}, errors: Record<string, string> = {};
  await Promise.all(sports.map(async (sport) => {
    try { boards[sport] = await client.board(sport); }
    catch (e) { errors[sport] = e instanceof Error ? e.message : 'Source indisponible'; }
  }));
  const matches: Detail[] = [];
  // Traite quatre matchs à la fois : pas de milliers de promesses/requêtes en file un soir chargé.
  const jobs = Object.values(boards).flatMap((board) => board.matches.filter((m) =>
    (!ids || ids.has(m.id)) && (m.state === 'in' || (m.state === 'post' && previous.has(m.sport + ':' + m.id))),
  ).map((match) => ({ match, board })));
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (index < jobs.length) {
      const { match, board } = jobs[index++];
      matches.push(await client.detail(match, board));
    }
  }));
  matches.sort((a, b) => (a.match.sport + a.match.id).localeCompare(b.match.sport + b.match.id));
  return { source: 'flashscore', startedAt: new Date(started).toISOString(), collectedAt: new Date().toISOString(), durationMs: Date.now() - started, boards, matches, errors };
}
