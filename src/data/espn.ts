// ESPN : blessures du jour, cotes DraftKings (spread / total / moneyline) et props joueurs.
import { fetchJson, pool, writeCache } from './http.ts';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';

export interface InjuryItem {
  team: string; // nom complet ESPN, ex. "Oklahoma City Thunder"
  name: string;
  status: string; // Out, Day-To-Day, Questionable, Doubtful...
  date: string;
  detail: string;
}

export async function getInjuries(ttlHours = 1): Promise<InjuryItem[]> {
  const j = await fetchJson<any>(`${SITE}/injuries`, { ttlHours, namespace: 'espn', cacheKey: 'injuries' });
  const out: InjuryItem[] = [];
  for (const t of j.injuries ?? []) {
    for (const i of t.injuries ?? []) {
      out.push({
        team: t.displayName, name: i.athlete?.displayName ?? '', status: i.status ?? '', date: i.date ?? '',
        detail: i.shortComment ?? '',
      });
    }
  }
  return out;
}

export interface MarketLines {
  provider: string;
  eventId: string;
  homeTri: string;
  awayTri: string;
  spreadHome?: number; // ex. -2.5 => domicile favori de 2,5
  total?: number;
  mlHome?: number; // cote américaine
  mlAway?: number;
  mlHomeOpen?: number;
  mlAwayOpen?: number;
}

const toNum = (v: any): number | undefined => {
  if (v == null || v === '' || v === 'OFF') return undefined;
  const n = Number(String(v).replace('+', ''));
  return Number.isFinite(n) ? n : undefined;
};

export async function getScoreboard(dateYmd: string, ttlHours = 1): Promise<any[]> {
  const d = dateYmd.replaceAll('-', '');
  const j = await fetchJson<any>(`${SITE}/scoreboard?dates=${d}`, { ttlHours, namespace: 'espn', cacheKey: `scoreboard_${d}` });
  return j.events ?? [];
}

export async function getMarket(dateYmd: string, homeTri: string, awayTri: string): Promise<MarketLines | undefined> {
  const events = await getScoreboard(dateYmd);
  const norm = (t: string) => ({ GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' } as Record<string, string>)[t] ?? t;
  for (const e of events) {
    const c = e.competitions?.[0];
    const home = c?.competitors?.find((x: any) => x.homeAway === 'home');
    const away = c?.competitors?.find((x: any) => x.homeAway === 'away');
    if (!home || !away) continue;
    if (norm(home.team.abbreviation) !== homeTri || norm(away.team.abbreviation) !== awayTri) continue;
    const o = c.odds?.[0];
    const m: MarketLines = { provider: o?.provider?.name ?? 'n/a', eventId: e.id, homeTri, awayTri };
    if (o) {
      m.spreadHome = toNum(o.spread);
      m.total = toNum(o.overUnder);
      m.mlHome = toNum(o.moneyline?.home?.close?.odds);
      m.mlAway = toNum(o.moneyline?.away?.close?.odds);
      m.mlHomeOpen = toNum(o.moneyline?.home?.open?.odds);
      m.mlAwayOpen = toNum(o.moneyline?.away?.open?.odds);
    }
    if (m.spreadHome == null || m.mlHome == null) {
      // Match terminé : cotes de clôture via le résumé du match (pickcenter).
      const sum = await fetchJson<any>(`${SITE}/summary?event=${e.id}`, { ttlHours: 24 * 365, namespace: 'espn_summary', cacheKey: e.id }).catch(() => undefined);
      const pc = sum?.pickcenter?.[0];
      if (pc) {
        m.provider = pc.provider?.name ?? m.provider;
        m.spreadHome = toNum(pc.spread);
        m.total = toNum(pc.overUnder);
        m.mlHome = toNum(pc.homeTeamOdds?.moneyLine);
        m.mlAway = toNum(pc.awayTeamOdds?.moneyLine);
      }
    }
    if (m.mlHome == null || m.mlHomeOpen == null) {
      // L'API « core » garde les cotes de toute la saison (le résumé les perd pour les matchs anciens), ouverture comprise.
      const core = await coreOdds(e.id).catch(() => undefined);
      if (core) {
        if (m.mlHome == null || m.mlAway == null) {
          m.provider = core.provider;
          m.mlHome = core.mlHome;
          m.mlAway = core.mlAway;
          m.spreadHome ??= core.spreadHome;
          m.total ??= core.total;
        }
        m.mlHomeOpen ??= core.mlHomeOpen;
        m.mlAwayOpen ??= core.mlAwayOpen;
      }
    }
    return m;
  }
  return undefined;
}

/** Cotes d'un match par l'API core d'ESPN (premier bookmaker listé) : clôture et ouverture. */
async function coreOdds(eventId: string): Promise<Omit<MarketLines, 'eventId' | 'homeTri' | 'awayTri'> | undefined> {
  const list = await fetchJson<any>(`${CORE}/events/${eventId}/competitions/${eventId}/odds`, { ttlHours: 24, namespace: 'espn_core', cacheKey: `odds_${eventId}` });
  let o = list.items?.[0];
  if (o?.$ref && !o.homeTeamOdds) o = await fetchJson<any>(String(o.$ref).replace('http://', 'https://'), { ttlHours: 24, namespace: 'espn_core', cacheKey: `odds_${eventId}_0` });
  if (!o?.homeTeamOdds) return undefined;
  const ml = (side: any, k?: 'open' | 'close') => toNum(k ? side?.[k]?.moneyLine?.american : side?.moneyLine);
  return {
    provider: o.provider?.name ?? 'n/a',
    spreadHome: toNum(o.spread),
    total: toNum(o.overUnder),
    mlHome: ml(o.homeTeamOdds) ?? ml(o.homeTeamOdds, 'close'),
    mlAway: ml(o.awayTeamOdds) ?? ml(o.awayTeamOdds, 'close'),
    mlHomeOpen: ml(o.homeTeamOdds, 'open'),
    mlAwayOpen: ml(o.awayTeamOdds, 'open'),
  };
}

export function americanToProb(a: number): number {
  return a < 0 ? -a / (-a + 100) : 100 / (a + 100);
}

/** Probabilités sans marge (vig) à partir de deux cotes américaines. */
export function noVig(a: number, b: number): [number, number] {
  const pa = americanToProb(a);
  const pb = americanToProb(b);
  return [pa / (pa + pb), pb / (pa + pb)];
}

export interface PropLine {
  player: string; // nom ESPN
  market: string; // ex. "Total Points"
  line?: number;
  over?: number; // cote américaine (dernier relevé / clôture)
  under?: number;
  openLine?: number; // ligne et cotes d'ouverture
  openOver?: number;
  openUnder?: number;
  price?: number; // marchés sans ligne (first basket, double-double)
}

/**
 * Props DraftKings exposées par l'API "core" d'ESPN. Les deux côtés d'une ligne arrivent par paires
 * (ordre ESPN : Over puis Under) — l'ordre est conservé tel quel.
 */
export async function getProps(eventId: string, ttlHours = 1): Promise<PropLine[]> {
  // ESPN plafonne la taille de page à 1000 (au-delà, la requête retombe silencieusement sur 25 éléments) : on pagine.
  const items: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const pg = await fetchJson<any>(
      `${CORE}/events/${eventId}/competitions/${eventId}/odds/100/propBets?lang=en&region=us&limit=1000&page=${page}`,
      { ttlHours, namespace: 'espn', cacheKey: `propsv2_${eventId}_${page}` },
    ).catch(() => undefined);
    if (!pg?.items?.length) break;
    items.push(...pg.items);
    if (page >= (pg.pageCount ?? 1)) break;
  }
  const j = { items };
  if (!items.length) return [];
  // Archive permanente (dernier relevé avant le match) : base des futurs backtests de props.
  writeCache('props_archive', eventId, j);
  const athleteRefs = [...new Set<string>(j.items.map((x: any) => x.athlete?.$ref).filter(Boolean))];
  const names = new Map<string, string>();
  await pool(athleteRefs, 6, async (ref) => {
    const id = /athletes\/(\d+)/.exec(ref)?.[1] ?? ref;
    const a = await fetchJson<any>(ref.replace('http:', 'https:'), { ttlHours: 24 * 30, namespace: 'espn_athletes', cacheKey: id }).catch(() => undefined);
    if (a?.displayName) names.set(ref, a.displayName);
  });
  const grouped = new Map<string, PropLine>();
  for (const x of j.items) {
    const player = names.get(x.athlete?.$ref) ?? '';
    const market = x.type?.name ?? '';
    const line = toNum(x.current?.target?.value ?? x.odds?.total?.value);
    const price = toNum(x.odds?.american?.value);
    if (line == null) {
      grouped.set(`${player}|${market}|${grouped.size}`, { player, market, price });
      continue;
    }
    const k = `${player}|${market}|${line}`;
    const g = grouped.get(k);
    const openLine = toNum(x.open?.target?.value ?? x.odds?.total?.open);
    const openPrice = toNum(x.odds?.american?.open);
    // Ordre ESPN vérifié sur 12 289 résultats (backtest des props) : 1er côté = Over, 2e = Under.
    if (!g) grouped.set(k, { player, market, line, over: price, openLine, openOver: openPrice });
    else if (g.under == null) {
      g.under = price;
      g.openUnder = openPrice;
    }
  }
  return [...grouped.values()];
}
