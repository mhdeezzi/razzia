// Calendrier ATP d'ESPN (simple messieurs, du jour à dans 6 jours) : chaque match programmé que Pinnacle n'a pas
// encore coté devient une fiche sans cote dans <dossier>/atp/AAAA-MM-JJ.json (identifiant ESPN), pour qu'on puisse le
// simuler avec le moteur seul. Qualifications et joueurs inconnus (TBD) ignorés. Une fiche ESPN reprend la cote dès
// que Pinnacle publie le même match (même paire de joueurs, même jour).
//   node src/cli/tennisfixtures.ts <dossier>   (cotes-tennis par défaut)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.argv[2] ?? 'cotes-tennis', 'atp');
const key = (n: string) => (n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const pair = (a: string, b: string) => [key(a), key(b)].sort().join('|');

// Tour ESPN -> code des fiches Pinnacle (« ATP Paris - R16 ») ; undefined : qualifications, ignorées.
function roundCode(name = ''): string | undefined {
  if (/qualif/i.test(name)) return undefined;
  if (/semi/i.test(name)) return 'SF';
  if (/quarter/i.test(name)) return 'QF';
  if (/^final/i.test(name)) return 'F';
  const of = name.match(/round of (\d+)/i);
  if (of) return `R${of[1]}`;
  const n = name.match(/round (\d)/i);
  return n ? `R${n[1]}` : '';
}

interface Fixture { id: string; event: string; round: string; start: string; home: string; away: string }
const fixtures = new Map<string, Fixture>();
const ymd = (i: number) => new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
for (const q of ['', ...[1, 2, 3, 4, 5, 6].map((i) => `?dates=${ymd(i)}`)]) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard${q}`, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  if (!r?.ok) { console.log(`ESPN ${q || 'du jour'} : indisponible`); continue; }
  for (const ev of (await r.json()).events ?? [])
    for (const g of ev.groupings ?? []) {
      if (g.grouping?.slug !== 'mens-singles') continue;
      for (const c of g.competitions ?? []) {
        const ps = (c.competitors ?? []).filter((p: any) => p.athlete?.displayName && p.athlete.displayName !== 'TBD');
        const round = roundCode(c.round?.displayName), start = c.startDate ?? c.date;
        if (ps.length !== 2 || round === undefined || (c.status?.type?.state ?? 'pre') !== 'pre' || !/^\d{5,14}$/.test(String(c.id)) || !start) continue;
        fixtures.set(pair(ps[0].athlete.displayName, ps[1].athlete.displayName), { id: String(c.id), event: ev.shortName ?? ev.name ?? '', round, start: new Date(start).toISOString(), home: ps[0].athlete.displayName, away: ps[1].athlete.displayName });
      }
    }
}

// Fiches existantes, jour par jour ; nom de tournoi repris d'une fiche Pinnacle où joue l'un des deux joueurs.
const files = new Map<string, Record<string, any>>();
const load = (day: string) => {
  if (!files.has(day)) { const f = join(dir, `${day}.json`); files.set(day, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}); }
  return files.get(day)!;
};
const priced = [...Array(9).keys()].flatMap((i) => Object.values(load(new Date(Date.now() + (i - 2) * 86_400_000).toISOString().slice(0, 10)))).filter((m: any) => m.last?.ml);
const tourney = (f: Fixture) => {
  const twin: any = priced.find((m: any) => [key(m.home), key(m.away)].some((k) => k === key(f.home) || k === key(f.away)) && Math.abs(Date.parse(m.start) - Date.parse(f.start)) < 7 * 86_400_000);
  return twin ? String(twin.league).split(' - ')[0] : `ATP ${f.event}`;
};

const at = new Date().toISOString();
let added = 0;
for (const [pk, f] of fixtures) {
  const day = f.start.slice(0, 10), data = load(day);
  if (Object.values(data).some((m: any) => m.last?.ml && pair(m.home, m.away) === pk)) continue; // déjà coté par Pinnacle
  if (!data[f.id]) added++;
  data[f.id] = { id: Number(f.id), source: 'espn', league: `${tourney(f)}${f.round ? ` - ${f.round}` : ''}`, start: f.start, home: f.home, away: f.away, first: { at }, last: { at }, moves: [] };
}
// Fiche ESPN restée sans cote alors que Pinnacle a coté le même match : la cote Pinnacle lui est recopiée.
let linked = 0;
for (const data of files.values())
  for (const m of Object.values(data) as any[]) {
    if (m.source !== 'espn' || m.last?.ml) continue;
    const twin: any = Object.values(data).find((x: any) => x.source !== 'espn' && x.last?.ml && pair(x.home, x.away) === pair(m.home, m.away));
    if (twin) { m.first = twin.first; m.last = twin.last; m.moves = twin.moves; m.pinnacle = twin.id; linked++; }
  }
mkdirSync(dir, { recursive: true });
for (const [day, data] of files) if (Object.keys(data).length) writeFileSync(join(dir, `${day}.json`), JSON.stringify(data));
console.log(`calendrier ESPN : ${fixtures.size} matchs programmés, ${added} fiches sans cote ajoutées, ${linked} reliées à une cote Pinnacle`);
