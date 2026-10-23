// Cotes Pinnacle des matchs ATP du circuit principal (sans qualifications, Challenger, ITF ni doubles), notées à chaque
// passage : la première cote vue sert d'ouverture, la dernière de cote du moment, et les changements du vainqueur sont
// gardés pour suivre l'argent. Un fichier par jour de match (UTC) : <dossier>/atp/AAAA-MM-JJ.json.
//   node src/cli/tennisodds.ts <dossier>   (cotes-tennis par défaut)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.argv[2] ?? 'cotes-tennis', 'atp');
const API = 'https://guest.api.arcadia.pinnacle.com/0.1/sports/33';
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', Accept: 'application/json' };

/** Cotes d'un match à un instant : vainqueur, 1er set, sets (+/- 1,5 : « Un set » et 2-0), total de sets, jeux. */
interface Odds {
  ml?: [number, number]; // domicile, extérieur (cotes décimales)
  set1?: [number, number]; // vainqueur du 1er set
  sets?: Array<{ line: number; home: number; away: number }>; // line : sets d'avance donnés au joueur « domicile »
  totalSets?: Array<{ line: number; over: number; under: number }>;
  games?: Array<{ line: number; home: number; away: number }>; // handicap en jeux
  totalGames?: Array<{ line: number; over: number; under: number }>;
}
interface Entry {
  id: number;
  league: string; // ex. « ATP Brussels - SF »
  start: string;
  home: string;
  away: string;
  first: { at: string } & Odds;
  last: { at: string } & Odds;
  moves: Array<{ at: string; ml: [number, number] }>; // chaque changement de la cote du vainqueur
}

const decimal = (american: number) => +(american > 0 ? 1 + american / 100 : 1 + 100 / -american).toFixed(3);
async function getJson(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Pinnacle ${path} : ${res.status}`);
  return res.json();
}

const matchups: any[] = await getJson('/matchups?withSpecials=false');
const markets: any[] = await getJson('/markets/straight?primaryOnly=false&withSpecials=false');
const isAtp = (name = '') => /^ATP /.test(name) && !/Challenger|Doubles|Qualif|ITF/i.test(name);

// Matchs principaux (unités : sets) et matchs rattachés en jeux (parent = match principal).
const main = new Map<number, any>(), gamesOf = new Map<number, number>();
for (const m of matchups) {
  if (!isAtp(m.league?.name) || m.participants?.length !== 2) continue;
  if (m.parentId || m.parent?.id) gamesOf.set(m.id, m.parentId ?? m.parent.id);
  else if (m.units === 'Sets') main.set(m.id, m);
}
const odds = new Map<number, Odds>();
const pair = (prices: any[], a: string, b: string): [number, number] | undefined => {
  const x = prices.find((p) => p.designation === a), y = prices.find((p) => p.designation === b);
  return x && y ? [decimal(x.price), decimal(y.price)] : undefined;
};
for (const k of markets) {
  const games = gamesOf.has(k.matchupId);
  const id = games ? gamesOf.get(k.matchupId)! : k.matchupId;
  if (!main.has(id) || k.status !== 'open') continue;
  const o = odds.get(id) ?? {};
  const pr: any[] = k.prices ?? [];
  if (k.type === 'moneyline' && !games && k.period === 0) o.ml = pair(pr, 'home', 'away');
  else if (k.type === 'moneyline' && !games && k.period === 1) o.set1 = pair(pr, 'home', 'away');
  else if (k.type === 'spread' && k.period === 0) {
    const h = pr.find((p) => p.designation === 'home'), a = pr.find((p) => p.designation === 'away');
    if (h && a) (games ? (o.games ??= []) : (o.sets ??= [])).push({ line: h.points, home: decimal(h.price), away: decimal(a.price) });
  } else if (k.type === 'total' && k.period === 0) {
    const ov = pr.find((p) => p.designation === 'over'), un = pr.find((p) => p.designation === 'under');
    if (ov && un) (games ? (o.totalGames ??= []) : (o.totalSets ??= [])).push({ line: ov.points, over: decimal(ov.price), under: decimal(un.price) });
  }
  odds.set(id, o);
}

const at = new Date().toISOString();
const byDay = new Map<string, Array<[any, Odds]>>();
for (const [id, m] of main) {
  const o = odds.get(id);
  if (!o?.ml) continue;
  const day = String(m.startTime).slice(0, 10);
  byDay.set(day, [...(byDay.get(day) ?? []), [m, o]]);
}
mkdirSync(dir, { recursive: true });
let added = 0, moved = 0;
for (const [day, list] of byDay) {
  const file = join(dir, `${day}.json`);
  const data: Record<string, Entry> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  for (const [m, o] of list) {
    const home = m.participants.find((p: any) => p.alignment === 'home') ?? m.participants[0];
    const away = m.participants.find((p: any) => p.alignment === 'away') ?? m.participants[1];
    const prev = data[m.id];
    if (!prev) {
      data[m.id] = { id: m.id, league: m.league.name, start: m.startTime, home: home.name, away: away.name, first: { at, ...o }, last: { at, ...o }, moves: [{ at, ml: o.ml! }] };
      added++;
      continue;
    }
    prev.start = m.startTime;
    prev.last = { at, ...o };
    const lm = prev.moves.at(-1)!.ml;
    if (lm[0] !== o.ml![0] || lm[1] !== o.ml![1]) { prev.moves.push({ at, ml: o.ml! }); moved++; }
  }
  writeFileSync(file, JSON.stringify(data));
}
const all = [...byDay.values()].flat();
console.log(`cotes ATP : ${all.length} matchs (${added} nouveaux, ${moved} cotes du vainqueur qui ont bougé), jours : ${[...byDay.keys()].sort().join(', ')}`);
for (const [m, o] of all.slice(0, 3)) console.log(`  ${m.league.name} ${m.participants.map((p: any) => p.name).join(' - ')} : ${JSON.stringify(o)}`);
