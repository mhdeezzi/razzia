// Fichier généré par scripts/build-live-api.mjs à partir de src/live (ne pas modifier à la main).

// src/live/flashscore-odds.ts
var obj = (v) => v != null && typeof v === "object" && !Array.isArray(v) ? v : void 0;
var text = (v) => typeof v === "string" ? v : null;
var array = (v, name) => {
  if (!Array.isArray(v)) throw new Error("Format des cotes modifi\xE9 : " + name);
  return v;
};
var idOf = (v) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Error("Identifiant bookmaker absent ou invalide");
  return v;
};
var decimal = (v) => {
  const s = typeof v === "number" ? String(v) : text(v);
  return s && /^\d+(?:\.\d+)?$/.test(s) && Number.isFinite(Number(s)) && Number(s) >= 1 ? Number(s) : null;
};
function oddsData(feed, key) {
  const root = obj(JSON.parse(feed.raw));
  const data = obj(root?.data);
  if (!root || root.errors != null && (!Array.isArray(root.errors) || root.errors.length > 0) || !data || !Object.hasOwn(data, key)) throw new Error("R\xE9ponse de cotes incompl\xE8te : " + key);
  if (data[key] === null) return null;
  const value = obj(data[key]);
  if (!value) throw new Error("Format des cotes modifi\xE9 : " + key);
  return value;
}
function bookmakerNames(settings) {
  const entries = obj(settings)?.bookmakers;
  const names = /* @__PURE__ */ new Map();
  if (entries == null) return names;
  for (const entry of array(entries, "bookmakers")) {
    const book = obj(obj(entry)?.bookmaker);
    if (book && typeof book.name === "string") names.set(idOf(book.id), book.name);
  }
  return names;
}
function quote(match, feed, feedKey, phase, book, names, market, scope, value, context = {}) {
  const participantId = text(value.eventParticipantId);
  const homeId = match.fields.find(([k]) => k === "JA")?.[1], awayId = match.fields.find(([k]) => k === "JB")?.[1];
  let side = participantId && participantId === homeId ? "home" : participantId && participantId === awayId ? "away" : null;
  const explicit = text(context.outcome);
  if (!side && ["home", "away", "draw"].includes(explicit ?? "")) side = explicit;
  if (!side && participantId == null && market === "HOME_DRAW_AWAY") side = "draw";
  const handicap = obj(value.handicap) ?? obj(context.handicap);
  const line = handicap && text(handicap.value);
  const change = obj(value.change);
  const active = typeof value.active === "boolean" ? value.active : null;
  const historical = phase === "prematch" && match.state !== "pre";
  const doubleChance = market === "DOUBLE_CHANCE" ? side === "home" ? "1X" : side === "away" ? "X2" : participantId == null ? "12" : null : null;
  const outcome = text(value.selection) ?? text(value.score) ?? text(value.winner) ?? (typeof value.bothTeamsToScore === "boolean" ? value.bothTeamsToScore ? "yes" : "no" : null) ?? text(context.score) ?? explicit ?? doubleChance ?? side ?? participantId ?? "unknown";
  return {
    kind: "bookmaker",
    label: "Cote",
    phase,
    bookmakerId: book,
    bookmakerName: names.get(book) ?? null,
    market,
    scope,
    outcome,
    side,
    participantId,
    handicap: line != null ? { value: line, type: text(handicap?.type) } : null,
    odds: decimal(value.value),
    openingOdds: decimal(value.opening),
    previousOdds: decimal(change?.previous),
    rawValue: text(value.value),
    active,
    status: feed.stale ? "stale" : historical ? "historical" : active === false ? "suspended" : decimal(value.value) == null ? "unknown" : active === true ? "active" : "unknown",
    fetchedAt: feed.fetchedAt,
    ageSeconds: feed.ageSeconds,
    feedKey
  };
}
function parsePrematchOdds(feed, match) {
  const data = oddsData(feed, "findOddsByEventId");
  if (!data) return [];
  if (data.eventId !== match.id) throw new Error("Les cotes re\xE7ues concernent un autre match");
  const names = bookmakerNames(data.settings);
  const quotes = [];
  for (const entry of array(data.odds, "odds")) {
    const market = obj(entry);
    if (!market || typeof market.bettingType !== "string" || typeof market.bettingScope !== "string") throw new Error("March\xE9 de cotes invalide");
    const book = idOf(market.bookmakerId);
    for (const item of array(market.odds, "market.odds")) {
      const value = obj(item);
      if (!value) throw new Error("S\xE9lection de cote invalide");
      quotes.push(quote(match, feed, "prematch", "prematch", book, names, market.bettingType, market.bettingScope, value));
    }
  }
  return quotes;
}
function parseLiveOdds(feed, match, query, names = /* @__PURE__ */ new Map()) {
  const data = oddsData(feed, "findLiveOddsForBookmaker");
  if (!data) return [];
  if (!Object.hasOwn(data, "eventOddsOverview")) throw new Error("March\xE9 live absent de la r\xE9ponse");
  const root = data.eventOddsOverview;
  if (root === null) return [];
  if (!obj(root) && !Array.isArray(root)) throw new Error("March\xE9 live invalide");
  const book = idOf(query.bookmakerId), market = query.market, scope = query.scope;
  if (obj(root)?.bookmakerId != null && obj(root)?.bookmakerId !== book) throw new Error("Les cotes live re\xE7ues concernent un autre bookmaker");
  const feedKey = "live:" + book + ":" + market + ":" + scope;
  const quotes = [];
  let explicitEmpty = false;
  const outcomes = { home: "home", away: "away", draw: "draw", over: "OVER", under: "UNDER", yes: "yes", no: "no", odd: "ODD", even: "EVEN", homeOrDraw: "1X", awayOrDraw: "X2", noDraw: "12", none: "none" };
  const walk = (node, context = {}) => {
    if (Array.isArray(node)) {
      if (!node.length) explicitEmpty = true;
      for (const item of node) walk(item, context);
      return;
    }
    const value = obj(node);
    if (!value) return;
    const inherited = { ...context, ...obj(value.handicap) ? { handicap: value.handicap } : {}, ...typeof value.score === "string" ? { score: value.score } : {} };
    const priceFields = Object.hasOwn(value, "active") || Object.hasOwn(value, "opening") || Object.hasOwn(value, "eventParticipantId");
    if (value.__typename === "EventOddsOverviewItem" || priceFields && (Object.hasOwn(value, "value") || context.outcome != null)) {
      quotes.push(quote(match, feed, feedKey, "live", book, names, market, scope, value, inherited));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (["handicap", "change", "subscriptionSubjects"].includes(key)) continue;
      if (outcomes[key] && child === null) explicitEmpty = true;
      walk(child, { ...inherited, ...outcomes[key] ? { outcome: outcomes[key] } : {} });
    }
  };
  walk(root);
  if (!quotes.length && !explicitEmpty) throw new Error("Structure du march\xE9 live non reconnue");
  return quotes;
}
async function readOdds(match, request, options = {}) {
  const feeds = {}, errors = {};
  const quotes = [];
  let liveMarkets = 0, liveReads = 0;
  const get = async (key, query) => {
    const feed = await request(query);
    feeds[key] = feed;
    if (feed.stale) errors[key] = feed.staleReason ?? "Derni\xE8res cotes connues, source indisponible";
    return feed;
  };
  const prematch = (async () => {
    try {
      quotes.push(...parsePrematchOdds(await get("prematch", { hash: "oce", eventId: match.id }), match));
    } catch (e) {
      errors.prematch = e instanceof Error ? e.message : "Cotes indisponibles";
    }
  })();
  const live = (async () => {
    if (match.state !== "in") return;
    try {
      const menu = oddsData(await get("liveMenu", { hash: "lobtm", eventId: match.id }), "getLiveOddsBettingTypeMenu");
      if (!menu) return;
      const names = bookmakerNames(menu.settings);
      const jobs = /* @__PURE__ */ new Map();
      for (const entry of array(menu.items, "liveMenu.items")) {
        const item = obj(entry);
        if (!item || typeof item.bettingType !== "string" || typeof item.bettingScope !== "string") throw new Error("Menu de march\xE9s live invalide");
        if (item.isActive === false || !array(item.types, "liveMenu.types").includes("LIVE")) continue;
        if (options.liveMarkets && !options.liveMarkets.includes(item.bettingType)) continue;
        if (options.liveScopes && !options.liveScopes.includes(item.bettingScope)) continue;
        for (const book of array(item.bookmakerIds, "liveMenu.bookmakerIds")) {
          const id = idOf(book), key = "live:" + id + ":" + item.bettingType + ":" + item.bettingScope;
          jobs.set(key, { hash: "ole2", eventId: match.id, bookmakerId: id, market: item.bettingType, scope: item.bettingScope });
        }
      }
      liveMarkets = jobs.size;
      const entries = [...jobs];
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (index < entries.length) {
          const [key, query] = entries[index++];
          try {
            quotes.push(...parseLiveOdds(await get(key, query), match, query, names));
            liveReads++;
          } catch (e) {
            errors[key] = e instanceof Error ? e.message : "Cote live indisponible";
          }
        }
      }));
    } catch (e) {
      errors.liveMenu = e instanceof Error ? e.message : "Menu des cotes live indisponible";
    }
  })();
  await Promise.all([prematch, live]);
  quotes.sort((a, b) => (a.phase + a.bookmakerId + a.market + a.scope + a.outcome).localeCompare(b.phase + b.bookmakerId + b.market + b.scope + b.outcome));
  return { source: "flashscore", label: "Cote", complete: !Object.keys(errors).length, quotes, feeds, errors, liveRequested: match.state === "in", liveMarkets, liveReads, retryAfterMs: 0 };
}

// src/live/flashscore.ts
var SPORTS = ["foot", "tennis", "nba"];
function records(raw) {
  return raw.split("~").map((record) => record.split("\xAC").flatMap((field2) => {
    const i = field2.indexOf("\xF7");
    return i < 0 ? [] : [[field2.slice(0, i), field2.slice(i + 1)]];
  })).filter((fields) => fields.length > 0);
}
var field = (fields, key) => fields.find(([k]) => k === key)?.[1];
var number = (value) => value != null && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
function parseBoard(sport, feed) {
  const matches = [];
  let leagueFields = [];
  for (const fields of records(feed.raw)) {
    if (field(fields, "ZA") != null) leagueFields = fields;
    const id = field(fields, "AA");
    if (!id || !/^[a-zA-Z0-9]{8}$/.test(id)) continue;
    const league = field(leagueFields, "ZA") ?? "";
    if (sport === "nba" && !/^USA: NBA(?:\s+-|$)/.test(league)) continue;
    const state = field(fields, "AB");
    const timestamp = number(field(fields, "AD"));
    const date = timestamp == null ? null : new Date(timestamp * 1e3);
    matches.push({
      id,
      sport,
      league,
      leagueFields,
      fields,
      start: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
      state: state === "1" ? "pre" : state === "2" ? "in" : state === "3" ? "post" : "unknown",
      stage: field(fields, "AC") ?? "",
      home: field(fields, "AE") ?? "",
      away: field(fields, "AF") ?? "",
      score: [number(field(fields, "AG")), number(field(fields, "AH"))]
    });
  }
  return { sport, fetchedAt: feed.fetchedAt, ageSeconds: feed.ageSeconds, matches, stale: !!feed.stale, staleReason: feed.staleReason };
}
function parseStatistics(raw) {
  let period = "", group = "";
  const out = [];
  for (const fields of records(raw)) {
    period = field(fields, "SE") ?? period;
    group = field(fields, "SF") ?? group;
    const label = field(fields, "SG");
    if (label != null) out.push({ period, group, id: field(fields, "SD"), label, home: field(fields, "SH") ?? null, away: field(fields, "SI") ?? null });
  }
  return out;
}
function publicSettings(html) {
  const match = /window\.environment\s*=\s*/.exec(html);
  if (!match) throw new Error("Configuration publique Flashscore introuvable");
  const start = match.index + match[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      const settings = JSON.parse(html.slice(start, i + 1));
      const sign = settings.config?.app?.feed_sign;
      if (typeof sign !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(sign)) throw new Error("Format de configuration Flashscore modifi\xE9");
      return { sign };
    }
  }
  throw new Error("Configuration publique Flashscore incompl\xE8te");
}
var SourceError = class extends Error {
  status;
  retryAfterMs;
  refreshable;
  constructor(message, status, retryAfterMs, refreshable = false) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.refreshable = refreshable;
  }
};
var SETTINGS_TTL_MS = 5 * 6e4;
var SETTINGS_RETRY_MS = 3e4;
var STALE_MS = 6e4;
var Flashscore = class {
  fetcher;
  now;
  ttlMs;
  concurrency;
  oddsLocale;
  active = 0;
  waiting = [];
  cache = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  oddsCache = /* @__PURE__ */ new Map();
  oddsPending = /* @__PURE__ */ new Map();
  settings;
  settingPending;
  settingsRetryAt = 0;
  settingsError;
  renewal;
  blockedUntil = 0;
  oddsBlockedUntil = 0;
  constructor(options = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 1e3;
    this.concurrency = options.concurrency ?? 4;
    this.oddsLocale = options.oddsLocale ?? "global";
    if (!["global", "fr"].includes(this.oddsLocale)) throw new Error("March\xE9 Flashscore invalide");
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error("Concurrence invalide");
  }
  retryAfterMs() {
    return Math.max(0, this.blockedUntil - this.now(), this.settings ? 0 : this.settingsRetryAt - this.now());
  }
  oddsRetryAfterMs() {
    return Math.max(0, this.oddsBlockedUntil - this.now());
  }
  pause(error) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + error.retryAfterMs);
  }
  async request(url, headers = {}, mayRefresh = false, settingsRequest = false, oddsRequest = false) {
    if (this.active >= this.concurrency) await new Promise((resolve) => settingsRequest ? this.waiting.unshift(resolve) : this.waiting.push(resolve));
    else this.active++;
    try {
      const blockedUntil = oddsRequest ? this.oddsBlockedUntil : this.blockedUntil;
      if (this.now() < blockedUntil) throw new SourceError("Flashscore en pause apr\xE8s un refus ou une limite de d\xE9bit", 429, blockedUntil - this.now());
      const response = await this.fetcher(url, { headers: typeof headers === "function" ? headers() : headers, signal: AbortSignal.timeout(8e3) });
      if (oddsRequest && response.status === 202) {
        const ms = Number(response.headers.get("x-retry-after-ms"));
        const retry = response.headers.get("retry-after");
        const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1e3 : retry ? Date.parse(retry) - this.now() : 0;
        const wait = Math.max(Number.isFinite(ms) && ms > 0 ? ms : 5e3, Number.isFinite(retryMs) ? retryMs : 0);
        this.oddsBlockedUntil = Math.max(this.oddsBlockedUntil, this.now() + wait);
        await response.body?.cancel().catch(() => void 0);
        throw new SourceError("Cotes Flashscore en pr\xE9paration", 202, wait);
      }
      if (!response.ok) {
        const retry = response.headers.get("retry-after");
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1e3 : retry ? Date.parse(retry) - this.now() : 6e4;
        const retryAfterMs = Number.isFinite(delay) ? Math.max(5e3, delay) : 6e4;
        const refreshable = mayRefresh && [401, 403].includes(response.status) && retry == null;
        const error = new SourceError("Flashscore : HTTP " + response.status, response.status, retryAfterMs, refreshable);
        if (!settingsRequest && !refreshable && ([401, 403, 429].includes(response.status) || retry != null)) {
          if (oddsRequest) this.oddsBlockedUntil = Math.max(this.oddsBlockedUntil, this.now() + retryAfterMs);
          else this.pause(error);
        }
        await response.body?.cancel().catch(() => void 0);
        throw error;
      }
      const raw = await response.text();
      const age = response.headers.get("age");
      return { raw, fetchedAt: new Date(this.now()).toISOString(), sourceDate: response.headers.get("date"), ageSeconds: age == null ? null : number(age), stale: false };
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  async refreshSettings() {
    if (this.settingPending) return this.settingPending;
    if (this.now() < this.settingsRetryAt) throw this.settingsError;
    this.settingPending = (async () => {
      const page = await this.request("https://www.flashscore.com/basketball/usa/nba/", { "Cache-Control": "no-cache", Pragma: "no-cache" }, false, true);
      this.settings = { ...publicSettings(page.raw), at: this.now() };
      this.settingsRetryAt = 0;
      this.settingsError = void 0;
      return this.settings;
    })();
    try {
      return await this.settingPending;
    } catch (error) {
      this.settingsError = error;
      this.settingsRetryAt = this.now() + Math.max(SETTINGS_RETRY_MS, this.retryAfterMs(), error instanceof SourceError ? error.retryAfterMs : 0);
      throw error;
    } finally {
      this.settingPending = void 0;
    }
  }
  async sign() {
    const current = this.settings;
    if (!current) return this.refreshSettings();
    if (this.now() - current.at >= SETTINGS_TTL_MS && this.now() >= this.settingsRetryAt && !this.settingPending) {
      void this.refreshSettings().catch(() => void 0);
    }
    return current;
  }
  async renew(rejected, error) {
    if (this.retryAfterMs()) throw new SourceError("Flashscore en pause apr\xE8s un refus ou une limite de d\xE9bit", 429, this.retryAfterMs());
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
    try {
      return await promise;
    } finally {
      if (this.renewal?.promise === promise) this.renewal = void 0;
    }
  }
  async readFeed(name) {
    let signature = await this.sign();
    const read = async (mayRefresh) => {
      const feed = await this.request("https://global.flashscore.ninja/2/x/feed/" + name, () => {
        signature = this.settings ?? signature;
        return { "x-fsign": signature.sign, Referer: "https://www.flashscore.com/" };
      }, mayRefresh);
      if (feed.raw.trim() && !/^~*[A-Z][A-Z0-9]*÷/.test(feed.raw.trim())) {
        const error = new SourceError("R\xE9ponse Flashscore inattendue (flux remplac\xE9 par une page ou une erreur)", 502, 6e4, mayRefresh);
        if (!mayRefresh) this.pause(error);
        throw error;
      }
      return feed;
    };
    try {
      return await read(true);
    } catch (error) {
      if (!(error instanceof SourceError) || !error.refreshable) throw error;
      signature = await this.renew(signature.sign, error);
      return read(false);
    }
  }
  async feed(name) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error("Nom de flux invalide");
    const cached = this.cache.get(name);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.feed;
    const existing = this.pending.get(name);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const feed = await this.readFeed(name);
        this.cache.set(name, { at: this.now(), feed });
        if (this.cache.size > 1e3) this.cache.delete(this.cache.keys().next().value);
        return feed;
      } catch (error) {
        if (cached && this.now() - cached.at <= STALE_MS) return {
          ...cached.feed,
          stale: true,
          staleReason: error instanceof Error ? error.message : "Source indisponible"
        };
        throw error;
      }
    })();
    this.pending.set(name, pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(name);
    }
  }
  async board(sport, day = 0) {
    if (!SPORTS.includes(sport)) throw new Error("Sport invalide");
    if (!Number.isInteger(day) || day < 0 || day > 7) throw new Error("Jour Flashscore : un entier de 0 \xE0 7");
    const id = { foot: 1, tennis: 2, nba: 3 }[sport];
    return parseBoard(sport, await this.feed("f_" + id + "_" + day + "_3_en_1"));
  }
  async oddsFeed(query) {
    if (!/^[a-zA-Z0-9]{8}$/.test(query.eventId) || !["oce", "lobtm", "ole2"].includes(query.hash)) throw new Error("Requ\xEAte de cotes invalide");
    const params = new URLSearchParams({ _hash: query.hash, eventId: query.eventId });
    const project = this.oddsLocale === "fr" ? "16" : "2";
    if (query.hash === "ole2") {
      if (!Number.isSafeInteger(query.bookmakerId) || query.bookmakerId <= 0 || !/^[A-Z0-9_]{1,80}$/.test(query.market ?? "") || !/^[A-Z0-9_]{1,80}$/.test(query.scope ?? "")) throw new Error("March\xE9 live invalide");
      params.set("bookmakerId", String(query.bookmakerId));
      params.set("betType", query.market);
      params.set("betScope", query.scope);
    } else {
      params.set("projectId", project);
      params.set("geoIpCode", this.oddsLocale === "fr" ? "FR" : "");
      params.set("geoIpSubdivisionCode", "");
    }
    const key = "odds:" + params;
    const cached = this.oddsCache.get(key);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.feed;
    const existing = this.oddsPending.get(key);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const origin = query.hash === "oce" ? "https://global.ds.lsapp.eu/odds/pq_graphql" : `https://${project}.ds.lsapp.eu/pq_graphql`;
        const feed = await this.request(origin + "?" + params, { Accept: "application/json" }, false, false, true);
        oddsData(feed, query.hash === "oce" ? "findOddsByEventId" : query.hash === "lobtm" ? "getLiveOddsBettingTypeMenu" : "findLiveOddsForBookmaker");
        this.oddsCache.set(key, { at: this.now(), feed });
        if (this.oddsCache.size > 1e3) this.oddsCache.delete(this.oddsCache.keys().next().value);
        return feed;
      } catch (error) {
        if (cached && this.now() - cached.at <= STALE_MS) return { ...cached.feed, stale: true, staleReason: error instanceof Error ? error.message : "Cotes indisponibles" };
        throw error;
      }
    })();
    this.oddsPending.set(key, pending);
    try {
      return await pending;
    } finally {
      this.oddsPending.delete(key);
    }
  }
  async odds(match, options = {}) {
    const result = await readOdds(match, (query) => this.oddsFeed(query), options);
    return { ...result, projectId: this.oddsLocale === "fr" ? 16 : 2, countryCode: this.oddsLocale === "fr" ? "FR" : "", retryAfterMs: this.oddsRetryAfterMs() };
  }
  async detail(match, board, options = {}) {
    if (!/^[a-zA-Z0-9]{8}$/.test(match.id)) throw new Error("Identifiant Flashscore invalide");
    const id = match.id;
    const names = {
      summary: "df_sur_1_" + id,
      common: "dc_1_" + id,
      statistics: "df_st_1_" + id,
      players: "df_psn_1_" + id,
      timeline: "df_sui_1_" + id
    };
    if (match.sport === "tennis") {
      names.history = "df_mh_1_" + id;
      names.currentGame = "df_mhs_1_" + id;
    }
    const feeds = {}, errors = {};
    if (board.stale) errors.board = board.staleReason ?? "Dernier tableau connu, source indisponible";
    await Promise.all(Object.entries(names).map(async ([kind, name]) => {
      try {
        feeds[kind] = await this.feed(name);
        if (feeds[kind].stale) errors[kind] = feeds[kind].staleReason ?? "Derni\xE8re lecture connue, source indisponible";
      } catch (e) {
        errors[kind] = e instanceof Error ? e.message : "Flux indisponible";
      }
    }));
    const odds = options.odds ? await this.odds(match) : void 0;
    if (odds && !odds.complete) errors.odds = Object.values(odds.errors).join("; ");
    return {
      source: "flashscore",
      match,
      boardFetchedAt: board.fetchedAt,
      boardAgeSeconds: board.ageSeconds,
      boardStale: board.stale,
      collectedAt: new Date(this.now()).toISOString(),
      complete: !Object.keys(errors).length,
      statistics: parseStatistics(feeds.statistics?.raw ?? ""),
      feeds,
      errors,
      ...odds ? { odds } : {}
    };
  }
};

// src/live/flashscore-api.ts
function flashscoreApi(client = new Flashscore({ oddsLocale: "fr" })) {
  return async (request) => {
    const params = new URL(request.url).searchParams;
    const sport = params.get("sport"), id = params.get("id"), withOdds = params.get("odds");
    const headers = { "Cache-Control": "no-store" };
    if (sport != null && !SPORTS.includes(sport) || id != null && (!sport || !/^[a-zA-Z0-9]{8}$/.test(id)) || withOdds != null && !["0", "1"].includes(withOdds) || withOdds === "1" && !id) {
      return Response.json({ error: "Utiliser sport=foot|tennis|nba et un identifiant Flashscore de 8 caract\xE8res ; odds=1 ajoute les cotes \xE0 une fiche." }, { status: 400, headers });
    }
    try {
      if (id && sport) {
        const board = await client.board(sport);
        const match = board.matches.find((m) => m.id === id);
        if (!match) return Response.json({ error: board.stale ? "Tableau Flashscore indisponible : pr\xE9sence du match non v\xE9rifiable." : "Match absent du tableau Flashscore du jour." }, {
          status: board.stale ? 503 : 404,
          headers: { ...headers, ...client.retryAfterMs() ? { "Retry-After": String(Math.ceil(client.retryAfterMs() / 1e3)) } : {} }
        });
        const detail = await client.detail(match, board, { odds: withOdds === "1" });
        const retry2 = client.retryAfterMs();
        const status = Object.keys(detail.feeds).length ? 200 : retry2 ? 503 : 502;
        return Response.json(detail, { status, headers: { ...headers, ...retry2 ? { "Retry-After": String(Math.ceil(retry2 / 1e3)) } : {} } });
      }
      const sports = sport ? [sport] : SPORTS;
      const boards = {}, errors = {};
      await Promise.all(sports.map(async (s) => {
        try {
          const board = await client.board(s);
          boards[s] = { ...board, matches: board.matches.filter((m) => m.state === "in") };
          if (board.stale) errors[s] = board.staleReason ?? "Dernier tableau connu, source indisponible";
        } catch (e) {
          errors[s] = e instanceof Error ? e.message : "Source indisponible";
        }
      }));
      const retry = client.retryAfterMs();
      return Response.json({ source: "flashscore", at: (/* @__PURE__ */ new Date()).toISOString(), complete: !Object.keys(errors).length, boards, errors }, {
        status: Object.keys(boards).length ? 200 : retry ? 503 : 502,
        headers: { ...headers, ...retry ? { "Retry-After": String(Math.ceil(retry / 1e3)) } : {} }
      });
    } catch (e) {
      const retry = client.retryAfterMs();
      return Response.json({ error: e instanceof Error ? e.message : "Flashscore indisponible" }, {
        status: retry || e instanceof SourceError && [401, 403, 429].includes(e.status) ? 503 : 502,
        headers: { ...headers, ...retry ? { "Retry-After": String(Math.ceil(retry / 1e3)) } : {} }
      });
    }
  };
}
var GET = flashscoreApi();
export {
  GET,
  flashscoreApi
};
