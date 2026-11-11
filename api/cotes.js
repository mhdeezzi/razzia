// Fichier généré par scripts/build-live-api.mjs à partir de src/odds (ne pas modifier à la main).

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
  async request(url, headers2 = {}, mayRefresh = false, settingsRequest = false, oddsRequest = false) {
    if (this.active >= this.concurrency) await new Promise((resolve) => settingsRequest ? this.waiting.unshift(resolve) : this.waiting.push(resolve));
    else this.active++;
    try {
      const blockedUntil = oddsRequest ? this.oddsBlockedUntil : this.blockedUntil;
      if (this.now() < blockedUntil) throw new SourceError("Flashscore en pause apr\xE8s un refus ou une limite de d\xE9bit", 429, blockedUntil - this.now());
      const response = await this.fetcher(url, { headers: typeof headers2 === "function" ? headers2() : headers2, signal: AbortSignal.timeout(8e3) });
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
  async board(sport) {
    if (!SPORTS.includes(sport)) throw new Error("Sport invalide");
    const id = { foot: 1, tennis: 2, nba: 3 }[sport];
    return parseBoard(sport, await this.feed("f_" + id + "_0_3_en_1"));
  }
  async oddsFeed(query) {
    if (!/^[a-zA-Z0-9]{8}$/.test(query.eventId) || !["oce", "lobtm", "ole2"].includes(query.hash)) throw new Error("Requ\xEAte de cotes invalide");
    const params = new URLSearchParams({ _hash: query.hash, eventId: query.eventId });
    if (query.hash === "ole2") {
      if (!Number.isSafeInteger(query.bookmakerId) || query.bookmakerId <= 0 || !/^[A-Z0-9_]{1,80}$/.test(query.market ?? "") || !/^[A-Z0-9_]{1,80}$/.test(query.scope ?? "")) throw new Error("March\xE9 live invalide");
      params.set("bookmakerId", String(query.bookmakerId));
      params.set("betType", query.market);
      params.set("betScope", query.scope);
    } else {
      params.set("projectId", "2");
      params.set("geoIpCode", "");
      params.set("geoIpSubdivisionCode", "");
    }
    const key = "odds:" + params;
    const cached = this.oddsCache.get(key);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.feed;
    const existing = this.oddsPending.get(key);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const origin = query.hash === "oce" ? "https://global.ds.lsapp.eu/odds/pq_graphql" : "https://2.ds.lsapp.eu/pq_graphql";
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
    return { ...result, retryAfterMs: this.oddsRetryAfterMs() };
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

// src/live/sources/matching.ts
var words = (s) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
var norm = (s) => words(s).join(" ");
var NBA = {
  ATL: ["Atlanta Hawks"],
  BOS: ["Boston Celtics"],
  BKN: ["Brooklyn Nets", "BRK"],
  CHA: ["Charlotte Hornets"],
  CHI: ["Chicago Bulls"],
  CLE: ["Cleveland Cavaliers"],
  DAL: ["Dallas Mavericks"],
  DEN: ["Denver Nuggets"],
  DET: ["Detroit Pistons"],
  GSW: ["Golden State Warriors", "GS"],
  HOU: ["Houston Rockets"],
  IND: ["Indiana Pacers"],
  LAC: ["Los Angeles Clippers", "LA Clippers"],
  LAL: ["Los Angeles Lakers", "LA Lakers"],
  MEM: ["Memphis Grizzlies"],
  MIA: ["Miami Heat"],
  MIL: ["Milwaukee Bucks"],
  MIN: ["Minnesota Timberwolves"],
  NOP: ["New Orleans Pelicans", "NO"],
  NYK: ["New York Knicks", "NY"],
  OKC: ["Oklahoma City Thunder"],
  ORL: ["Orlando Magic"],
  PHI: ["Philadelphia 76ers"],
  PHX: ["Phoenix Suns", "PHO"],
  POR: ["Portland Trail Blazers"],
  SAC: ["Sacramento Kings"],
  SAS: ["San Antonio Spurs", "SA"],
  TOR: ["Toronto Raptors"],
  UTA: ["Utah Jazz", "UTAH"],
  WAS: ["Washington Wizards", "WSH"]
};
var nbaNames = new Map(Object.entries(NBA).flatMap(([tri, names]) => [tri, ...names].map((name) => [norm(name), tri])));
var footballAliases = {
  psg: "paris saint germain",
  "paris sg": "paris saint germain",
  "man utd": "manchester united",
  "manchester utd": "manchester united",
  "man city": "manchester city",
  inter: "inter milan",
  internazionale: "inter milan",
  "internazionale milano": "inter milan"
};
var club = (s) => {
  const name = words(s).filter((w) => !["fc", "cf", "afc", "sc"].includes(w)).map((w) => ["w", "women", "feminin", "feminines"].includes(w) ? "women" : w).join(" ");
  return footballAliases[name] ?? name;
};
function player(s) {
  const tokens = words(s);
  if (!tokens.length) return { surnames: [] };
  const tail = tokens.findIndex((w) => w.length === 1);
  if (tail > 0 && tokens.slice(tail).every((w) => w.length === 1)) return { surnames: [tokens.slice(0, tail).join(" ")], initial: tokens[tail] };
  let first = 0;
  while (tokens[first]?.length === 1) first++;
  if (first) return { surnames: [tokens.slice(first).join(" ")].filter(Boolean), initial: tokens[0] };
  if (tokens.length === 1) return { surnames: tokens };
  return { surnames: tokens.slice(1).map((_, i) => tokens.slice(i + 1).join(" ")), initial: tokens[0][0], firstName: tokens[0] };
}
function sameParticipant(a, b, sport) {
  if (!norm(a) || !norm(b)) return false;
  if (norm(a) === norm(b)) return true;
  if (sport === "nba") {
    const x2 = nbaNames.get(norm(a)), y2 = nbaNames.get(norm(b));
    return x2 != null && x2 === y2;
  }
  if (sport === "foot") return !!club(a) && club(a) === club(b);
  if (a.includes("/") || b.includes("/")) return false;
  const x = player(a), y = player(b);
  if (x.firstName && y.firstName && x.firstName !== y.firstName) return false;
  return !!x.initial && x.initial === y.initial && x.surnames.some((name) => y.surnames.includes(name));
}

// src/odds/prices.ts
var MAX_AGE = { prematch: 15 * 6e4, live: 3e4 };
var decimal2 = (value) => typeof value === "number" && Number.isFinite(value) && value > 1;
var quoteTime = (q) => Date.parse(q.fetchedAt) - (q.ageSeconds ?? 0) * 1e3;
var freshMarket = (m, now = Date.now()) => Number.isFinite(Date.parse(m.updated)) && now - Date.parse(m.updated) >= -5e3 && now - Date.parse(m.updated) <= MAX_AGE[m.phase];
var identity = (q, sport) => {
  const scope = sport === "nba" ? "FULL_TIME_OVER_TIME" : "FULL_TIME";
  if (sport === "tennis" && q.market === "HOME_AWAY" && q.scope === "FIRST_SET" && q.side) return { kind: "set1", side: q.side };
  if (q.scope !== scope) return void 0;
  if (q.market === (sport === "foot" ? "HOME_DRAW_AWAY" : "HOME_AWAY") && q.side) return { kind: "win", side: q.side };
  const rawLine = q.handicap?.value;
  if (rawLine == null || !/^-?\d+(?:\.\d+)?$/.test(rawLine)) return void 0;
  const line = Number(rawLine), unit = q.handicap?.type;
  if (!Number.isFinite(line)) return void 0;
  const tennis = sport === "tennis";
  if (tennis && unit !== "GAMES" && unit !== "SETS") return void 0;
  if (!tennis && unit && !["UNKNOWN", sport === "nba" ? "POINTS" : "GOALS"].includes(unit)) return void 0;
  if (q.market === "ASIAN_HANDICAP" && (q.side === "home" || q.side === "away")) {
    return { kind: tennis ? unit === "SETS" ? "sets" : "games" : "spread", line: q.side === "away" ? -line : line, side: q.side };
  }
  if (q.market === "OVER_UNDER" && ["OVER", "UNDER"].includes(q.outcome)) return { kind: tennis ? unit === "SETS" ? "totalSets" : "totalGames" : "total", line, side: q.outcome.toLowerCase() };
  return void 0;
};
function flashscoreBooks(snapshot, sport, flip = false, now = Date.now()) {
  const groups = /* @__PURE__ */ new Map();
  for (const q of snapshot.quotes) {
    if (q.status !== "active" || !decimal2(q.odds) || !Number.isFinite(quoteTime(q)) || now - quoteTime(q) > MAX_AGE[q.phase] || quoteTime(q) > now + 5e3) continue;
    const id = identity(q, sport);
    if (!id) continue;
    const key = JSON.stringify([q.bookmakerId, q.phase, q.scope, id.kind, id.line ?? null]);
    const group = groups.get(key) ?? { book: q.bookmakerId, title: q.bookmakerName ?? `Bookmaker ${q.bookmakerId}`, kind: id.kind, scope: q.scope, phase: q.phase, line: id.line, values: /* @__PURE__ */ new Map() };
    group.values.set(id.side, [...group.values.get(id.side) ?? [], q]);
    groups.set(key, group);
  }
  const books = /* @__PURE__ */ new Map();
  for (const g of groups.values()) {
    const sides = g.kind.startsWith("total") ? ["over", "under"] : g.kind === "win" && sport === "foot" ? ["home", "draw", "away"] : ["home", "away"];
    if (sides.some((s) => g.values.get(s)?.length !== 1)) continue;
    const quotes = sides.map((s) => g.values.get(s)[0]);
    const updated = new Date(Math.min(...quotes.map(quoteTime))).toISOString();
    const m = { kind: g.kind, scope: g.scope, phase: g.phase, line: g.line, updated, observedAt: new Date(Math.max(...quotes.map((q) => Date.parse(q.fetchedAt)))).toISOString(), sourceAgeSeconds: quotes.some((q) => q.ageSeconds == null) ? null : Math.max(...quotes.map((q) => q.ageSeconds)) };
    for (const side of sides) {
      const target = flip && side === "home" ? "away" : flip && side === "away" ? "home" : side;
      Object.assign(m, { [target]: g.values.get(side)[0].odds });
    }
    if (flip && m.line != null && ["spread", "sets", "games"].includes(m.kind)) m.line = -m.line;
    const key = `flashscore:${g.book}:${g.phase}`;
    const b = books.get(key) ?? { key, title: g.title, source: "flashscore", french: /(?:\.fr\b|\(FR\))/i.test(g.title), phase: g.phase, updated, markets: [] };
    b.markets.push(m);
    books.set(key, b);
  }
  return [...books.values()].map(flattenBook);
}
function mainLine(markets, kind) {
  return markets.filter((m) => m.kind === kind).sort((a, b) => Math.abs((a.home ?? a.over ?? 0) - (a.away ?? a.under ?? 0)) - Math.abs((b.home ?? b.over ?? 0) - (b.away ?? b.under ?? 0)) || (a.line ?? 0) - (b.line ?? 0))[0];
}
function flattenBook(b) {
  const win = mainLine(b.markets, "win"), spread = mainLine(b.markets, "spread"), total = mainLine(b.markets, "total");
  return {
    ...b,
    updated: win?.updated ?? b.markets[0]?.updated ?? b.updated,
    home: win?.home,
    away: win?.away,
    draw: win?.draw,
    spread: spread && { point: spread.line, home: spread.home, away: spread.away },
    total: total && { point: total.line, over: total.over, under: total.under }
  };
}
function selectBook(books, phase, now = Date.now()) {
  return books.filter((b) => b.phase === phase && b.markets.some((m) => m.kind === "win" && freshMarket(m, now))).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated) || Number(/pinnacle/i.test(b.title)) - Number(/pinnacle/i.test(a.title)) || a.key.localeCompare(b.key))[0];
}
function withReference(game, now = Date.now()) {
  const phase = game.state === "pre" ? "prematch" : "live";
  const pin = game.books.find((b) => /^pinnacle(?:\s|$)/i.test(b.title) && b.phase === phase && b.markets.some((m) => m.kind === "win" && freshMarket(m, now)));
  const sum = pin?.home && pin.away ? 1 / pin.home + 1 / pin.away + (pin.draw ? 1 / pin.draw : 0) : 0;
  return { ...game, selected: selectBook(game.books, phase, now)?.key, ref: sum && pin ? { home: 1 / pin.home / sum, away: 1 / pin.away / sum } : void 0 };
}

// src/odds/flashscore-provider.ts
var FlashscoreOddsProvider = class {
  client;
  now;
  cache = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.client = options.client ?? new Flashscore({ ttlMs: 5e3 });
  }
  async board(sport) {
    if (process.env.ODDS_FLASHSCORE === "0") throw new Error("Fournisseur Flashscore d\xE9sactiv\xE9");
    const b = await this.client.board(sport);
    if (b.stale) throw new Error("Tableau Flashscore ancien");
    return b;
  }
  async read(sport, targets, board) {
    const b = board ?? await this.board(sport);
    let index = 0;
    const games = Array(targets.length);
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (index < targets.length) {
        const i = index++, target = targets[i];
        const order2 = (home, away) => sameParticipant(target.home, home, sport) && sameParticipant(target.away, away, sport);
        const candidates = b.matches.filter((m) => m.state !== "unknown" && m.start && Math.abs(Date.parse(m.start) - Date.parse(target.start)) < 18 * 36e5 && order2(m.home, m.away) !== order2(m.away, m.home));
        if (target.state === "post" || candidates.length !== 1) {
          games[i] = { ...target, sport, books: [] };
          continue;
        }
        const match = candidates[0], flip = !order2(match.home, match.away);
        if (match.state === "post" || target.state === "in" && match.state === "pre") {
          games[i] = { ...target, sport, state: match.state === "post" ? "post" : "in", sourceId: match.id, books: [] };
          continue;
        }
        const key = JSON.stringify([sport, match.id, match.state, flip]);
        const cached = this.cache.get(key);
        let value;
        if (cached && this.now() - cached.at < 5e3) value = cached.value;
        else {
          let pending = this.pending.get(key);
          if (!pending) {
            pending = (async () => {
              const snapshot = await this.client.odds(match, { liveMarkets: ["HOME_AWAY", "HOME_DRAW_AWAY", "ASIAN_HANDICAP", "OVER_UNDER"], liveScopes: [sport === "nba" ? "FULL_TIME_OVER_TIME" : "FULL_TIME"] });
              const value2 = withReference({ ...target, sport, state: match.state === "in" ? "in" : "pre", sourceId: match.id, books: flashscoreBooks(snapshot, sport, flip, this.now()), errors: snapshot.errors }, this.now());
              this.cache.set(key, { at: this.now(), value: value2 });
              if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
              return value2;
            })();
            this.pending.set(key, pending);
          }
          try {
            value = await pending;
          } finally {
            if (this.pending.get(key) === pending) this.pending.delete(key);
          }
        }
        games[i] = { ...value, id: target.id, home: target.home, away: target.away, start: target.start };
      }
    }));
    return games;
  }
};

// src/odds/the-odds-provider.ts
var BOOKS = ["pinnacle", "betclic_fr", "unibet_fr", "winamax_fr", "parionssport_fr", "netbet_fr", "pmu_fr"];
var TheOddsProvider = class {
  key;
  request;
  now;
  cache;
  pending;
  retryAt = 0;
  constructor(options = {}) {
    this.key = (options.key ?? process.env.ODDS_API_KEY ?? "").trim();
    this.request = options.fetch ?? ((...args) => fetch(...args));
    this.now = options.now ?? Date.now;
  }
  configured() {
    return !!this.key;
  }
  async read() {
    if (!this.key) return { games: [], error: "The Odds API non configur\xE9" };
    if (this.cache && this.now() - this.cache.at < 6e5) return this.cache.value;
    if (this.now() < this.retryAt) return { ...this.cache?.value, games: this.cache?.value.games ?? [], error: "The Odds API temporairement indisponible" };
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const url = new URL("https://api.the-odds-api.com/v4/sports/basketball_nba/odds");
        url.search = new URLSearchParams({ apiKey: this.key, bookmakers: BOOKS.join(","), markets: "h2h,spreads,totals", oddsFormat: "decimal" }).toString();
        const r = await this.request(url, { signal: AbortSignal.timeout(12e3) });
        if (!r.ok) {
          const wait = r.headers.get("retry-after");
          this.retryAt = this.now() + Math.max(6e4, wait && /^\d+$/.test(wait) ? Number(wait) * 1e3 : wait ? Math.max(0, Date.parse(wait) - this.now()) || 0 : 0);
          throw new Error(`The Odds API ${r.status}`);
        }
        const data = await r.json();
        if (!Array.isArray(data)) throw new Error("R\xE9ponse The Odds API illisible");
        const observedAt = new Date(this.now()).toISOString();
        const games = data.flatMap((e) => {
          if (typeof e.home_team !== "string" || typeof e.away_team !== "string" || !e.home_team || !e.away_team || !Number.isFinite(Date.parse(e.commence_time))) return [];
          const state = Date.parse(e.commence_time) > this.now() ? "pre" : "in";
          const phase = state === "pre" ? "prematch" : "live";
          const books = (e.bookmakers ?? []).filter((b) => typeof b.key === "string" && typeof b.title === "string").map((b) => {
            const markets = [];
            for (const m of b.markets ?? []) {
              const outcomes = Array.isArray(m.outcomes) ? m.outcomes : [];
              const pick = (name) => {
                const matches = outcomes.filter((o2) => o2.name === name);
                return matches.length === 1 ? matches[0] : void 0;
              };
              const h = pick(e.home_team), a = pick(e.away_team), o = pick("Over"), u = pick("Under");
              const updated = m.last_update ?? b.last_update;
              if (!Number.isFinite(Date.parse(updated))) continue;
              const common = { scope: "FULL_TIME_OVER_TIME", phase, updated, observedAt, sourceAgeSeconds: null };
              if (m.key === "h2h" && decimal2(h?.price) && decimal2(a?.price)) markets.push({ ...common, kind: "win", home: h.price, away: a.price });
              if (m.key === "spreads" && decimal2(h?.price) && decimal2(a?.price) && Number.isFinite(h?.point) && a?.point === -h.point) markets.push({ ...common, kind: "spread", line: h.point, home: h.price, away: a.price });
              if (m.key === "totals" && decimal2(o?.price) && decimal2(u?.price) && Number.isFinite(o?.point) && o.point === u?.point) markets.push({ ...common, kind: "total", line: o.point, over: o.price, under: u.price });
            }
            return flattenBook({ key: b.key, title: b.title, source: "the-odds-api", french: BOOKS.includes(b.key) && b.key !== "pinnacle", phase, updated: b.last_update ?? "", markets: markets.filter((m) => freshMarket(m, this.now())) });
          }).filter((b) => b.markets.length);
          return [{ id: String(e.id), sport: "nba", home: e.home_team, away: e.away_team, start: e.commence_time, state, books }];
        });
        const remaining = r.headers.get("x-requests-remaining");
        const value = { games, ...remaining != null && Number.isFinite(Number(remaining)) ? { creditsLeft: Number(remaining) } : {} };
        this.cache = { at: this.now(), value };
        return value;
      } catch (error) {
        this.retryAt = Math.max(this.retryAt, this.now() + 6e4);
        return { ...this.cache?.value, games: this.cache?.value.games ?? [], error: error instanceof Error && error.message.startsWith("The Odds API ") ? error.message : "The Odds API indisponible" };
      }
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = void 0;
    }
  }
};

// src/odds/api.ts
var headers = { "Cache-Control": "no-store" };
var bad = (error, status = 400) => Response.json({ error }, { status, headers });
var order = (a, b, sport) => {
  const same = sameParticipant(a.home, b.home, sport) && sameParticipant(a.away, b.away, sport);
  const flipped = sameParticipant(a.home, b.away, sport) && sameParticipant(a.away, b.home, sport);
  return same !== flipped ? flipped : void 0;
};
function align(b, flip, now) {
  return flattenBook({ ...b, markets: b.markets.filter((m) => freshMarket(m, now)).map((m) => !flip ? m : { ...m, home: m.away, away: m.home, line: m.line != null && ["spread", "sets", "games"].includes(m.kind) ? -m.line : m.line }) });
}
function validTarget(m) {
  if (!m || typeof m !== "object") return false;
  const v = m;
  return typeof v.id === "string" && /^[\w@:.+-]{1,100}$/.test(v.id) && ["home", "away"].every((k) => typeof v[k] === "string" && v[k].trim().length > 0 && v[k].length <= 150) && typeof v.start === "string" && Number.isFinite(Date.parse(v.start)) && ["pre", "in", "post"].includes(String(v.state));
}
function oddsApi(options = {}) {
  const flashscore = options.flashscore ?? new FlashscoreOddsProvider(), existing = options.existing ?? new TheOddsProvider(), now = options.now ?? Date.now;
  const readExisting = async (request) => {
    if (options.existing || !process.env.VERCEL || !existing.configured()) return existing.read();
    try {
      const url = new URL("/api/cotes?provider=the-odds-api", request.url);
      const response = await fetch(url, { signal: AbortSignal.timeout(15e3) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.games)) throw new Error();
      return data;
    } catch {
      return { games: [], error: "Cache The Odds API indisponible" };
    }
  };
  return async (request) => {
    const q = new URL(request.url).searchParams;
    if (request.method === "GET" && q.get("provider") === "the-odds-api") {
      const value = await existing.read();
      return Response.json(value, { headers: { "Cache-Control": `public, s-maxage=${value.error ? 60 : 600}` } });
    }
    let sport = q.get("sport") ?? "nba";
    let targets;
    if (request.method === "POST") {
      if (Number(request.headers.get("content-length")) > 4e4) return bad("Demande trop volumineuse", 413);
      const text2 = await request.text();
      if (text2.length > 4e4) return bad("Demande trop volumineuse", 413);
      let body;
      try {
        body = JSON.parse(text2);
      } catch {
        return bad("JSON invalide");
      }
      const b = body;
      sport = b?.sport ?? "";
      if (!Array.isArray(b?.matches) || b.matches.length > 40 || !b.matches.every(validTarget)) return bad("Entre 0 et 40 matchs valides sont attendus");
      targets = b.matches;
      if (new Set(targets.map((m) => m.id)).size !== targets.length) return bad("Identifiants de matchs r\xE9p\xE9t\xE9s");
    } else if (request.method !== "GET") return bad("M\xE9thode refus\xE9e", 405);
    if (!SPORTS.includes(sport)) return bad("Sport invalide");
    const s = sport, id = q.get("id");
    if (id && !/^[a-zA-Z0-9]{8}$/.test(id)) return bad("Identifiant Flashscore invalide");
    if (request.method === "GET" && s !== "nba" && !id) return bad("Envoyer les matchs \xE0 rafra\xEEchir avec POST, ou un identifiant Flashscore avec GET");
    if (targets?.length === 0) return Response.json({ games: [], at: new Date(now()).toISOString(), refreshAfterMs: 5e3, errors: {} }, { headers });
    const errors = {};
    const [base, source] = await Promise.allSettled([s === "nba" ? readExisting(request) : Promise.resolve({ games: [] }), flashscore.board(s)]);
    const legacy = base.status === "fulfilled" ? base.value : { games: [], error: "Fournisseur existant indisponible" };
    if ("error" in legacy && legacy.error) errors["the-odds-api"] = legacy.error;
    if (source.status === "rejected") errors.flashscore = "Cotes Flashscore indisponibles";
    if (!targets) {
      const matches = source.status === "fulfilled" ? source.value.matches.filter((m) => id ? m.id === id : m.state === "pre" || m.state === "in") : [];
      if (id && source.status === "fulfilled" && !matches.length) return bad("Match Flashscore introuvable", 404);
      targets = matches.filter((m) => m.start).map((m) => ({ id: m.id, home: m.home, away: m.away, start: m.start, state: m.state === "in" ? "in" : m.state === "post" ? "post" : "pre" }));
      for (const b of legacy.games) if (!targets.some((t) => order(t, b, s) !== void 0 && Math.abs(Date.parse(t.start) - Date.parse(b.start)) < 18 * 36e5)) targets.push(b);
    }
    let fresh = targets.map((t) => ({ ...t, sport: s, books: [] }));
    if (source.status === "fulfilled") {
      try {
        fresh = await flashscore.read(s, targets, source.value);
      } catch {
        errors.flashscore = "Lecture des cotes Flashscore indisponible";
      }
    }
    const games = fresh.map((game) => {
      if (game.state === "post") return { ...game, books: [], selected: void 0, ref: void 0 };
      const candidates = legacy.games.filter((b2) => order(game, b2, s) !== void 0 && Math.abs(Date.parse(game.start) - Date.parse(b2.start)) < 18 * 36e5);
      const b = candidates.length === 1 ? candidates[0] : void 0;
      const books = [...b ? b.books.map((book) => align(book, order(game, b, s), now())) : [], ...game.books.map((book) => align(book, false, now()))].filter((b2) => b2.markets.length && b2.phase === (game.state === "pre" ? "prematch" : "live"));
      return withReference({ ...game, books }, now());
    });
    const status = !games.some((g) => g.books.length) && source.status === "rejected" && !legacy.games.length ? 503 : 200;
    return Response.json({ games, at: new Date(now()).toISOString(), refreshAfterMs: 5e3, errors, ..."creditsLeft" in legacy ? { creditsLeft: legacy.creditsLeft } : {}, ...status !== 200 ? { error: "Fournisseurs de cotes indisponibles" } : {} }, { status, headers });
  };
}
var handler = oddsApi();
var GET = handler;
var POST = handler;
export {
  GET,
  POST,
  oddsApi
};
