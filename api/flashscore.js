// Fichier généré par scripts/build-live-api.mjs à partir de src/live (ne pas modifier à la main).

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
  return { sport, fetchedAt: feed.fetchedAt, ageSeconds: feed.ageSeconds, matches };
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
  constructor(message, status, retryAfterMs) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
};
var Flashscore = class {
  fetcher;
  now;
  ttlMs;
  concurrency;
  active = 0;
  waiting = [];
  cache = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  settings;
  settingPending;
  blockedUntil = 0;
  constructor(options = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 1e3;
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error("Concurrence invalide");
  }
  retryAfterMs() {
    return Math.max(0, this.blockedUntil - this.now());
  }
  async request(url, headers = {}) {
    if (this.active >= this.concurrency) await new Promise((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      if (this.now() < this.blockedUntil) throw new SourceError("Flashscore en pause apr\xE8s un refus ou une limite de d\xE9bit", 429, this.blockedUntil - this.now());
      const response = await this.fetcher(url, { headers, signal: AbortSignal.timeout(8e3) });
      if (!response.ok) {
        const retry = response.headers.get("retry-after");
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1e3 : retry ? Date.parse(retry) - this.now() : 6e4;
        const retryAfterMs = Number.isFinite(delay) ? Math.max(5e3, delay) : 6e4;
        if (response.status === 403 || response.status === 429) this.blockedUntil = this.now() + retryAfterMs;
        throw new SourceError("Flashscore : HTTP " + response.status, response.status, retryAfterMs);
      }
      const raw = await response.text();
      const age = response.headers.get("age");
      return { raw, fetchedAt: new Date(this.now()).toISOString(), sourceDate: response.headers.get("date"), ageSeconds: age == null ? null : number(age) };
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  async sign() {
    if (this.settings && this.now() - this.settings.at < 36e5) return this.settings.sign;
    if (this.settingPending) return this.settingPending;
    this.settingPending = (async () => {
      const page = await this.request("https://www.flashscore.com/basketball/usa/nba/");
      this.settings = { ...publicSettings(page.raw), at: this.now() };
      return this.settings.sign;
    })();
    try {
      return await this.settingPending;
    } finally {
      this.settingPending = void 0;
    }
  }
  async feed(name) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error("Nom de flux invalide");
    const cached = this.cache.get(name);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.feed;
    const existing = this.pending.get(name);
    if (existing) return existing;
    const pending = (async () => {
      const sign = await this.sign();
      const feed = await this.request("https://global.flashscore.ninja/2/x/feed/" + name, { "x-fsign": sign, Referer: "https://www.flashscore.com/" });
      this.cache.set(name, { at: this.now(), feed });
      if (this.cache.size > 1e3) this.cache.delete(this.cache.keys().next().value);
      return feed;
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
  async detail(match, board) {
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
    await Promise.all(Object.entries(names).map(async ([kind, name]) => {
      try {
        feeds[kind] = await this.feed(name);
      } catch (e) {
        errors[kind] = e instanceof Error ? e.message : "Flux indisponible";
      }
    }));
    return {
      source: "flashscore",
      match,
      boardFetchedAt: board.fetchedAt,
      boardAgeSeconds: board.ageSeconds,
      collectedAt: new Date(this.now()).toISOString(),
      complete: !Object.keys(errors).length,
      statistics: parseStatistics(feeds.statistics?.raw ?? ""),
      feeds,
      errors
    };
  }
};

// src/live/flashscore-api.ts
function flashscoreApi(client = new Flashscore()) {
  return async (request) => {
    const params = new URL(request.url).searchParams;
    const sport = params.get("sport"), id = params.get("id");
    const headers = { "Cache-Control": "no-store" };
    if (sport != null && !SPORTS.includes(sport) || id != null && (!sport || !/^[a-zA-Z0-9]{8}$/.test(id))) {
      return Response.json({ error: "Utiliser sport=foot|tennis|nba et un identifiant Flashscore de 8 caract\xE8res." }, { status: 400, headers });
    }
    try {
      if (id && sport) {
        const board = await client.board(sport);
        const match = board.matches.find((m) => m.id === id);
        if (!match) return Response.json({ error: "Match absent du tableau Flashscore du jour." }, { status: 404, headers });
        const detail = await client.detail(match, board);
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
        status: e instanceof SourceError && [403, 429].includes(e.status) ? 503 : 502,
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
