// Calendrier ATP d'ESPN (simple messieurs, du jour à dans 6 jours) : chaque match programmé que Pinnacle n'a pas
// encore coté devient une fiche sans cote dans <dossier>/atp/AAAA-MM-JJ.json (identifiant ESPN), pour qu'on puisse le
// simuler avec le moteur seul. Qualifications et joueurs inconnus (TBD) ignorés. Une fiche ESPN reprend la cote dès
// que Pinnacle publie le même match (même paire de joueurs, même jour).
//   node src/cli/tennisfixtures.ts <dossier>   (cotes-tennis par défaut)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { espnFixtures, leagueOf, pairKey } from '../tennis/espn.ts';

const dir = join(process.argv[2] ?? 'cotes-tennis', 'atp');
const fixtures = [...(await espnFixtures()).values()].filter((f) => f.state === 'pre');

// Fiches existantes, jour par jour ; nom de tournoi repris d'une fiche Pinnacle où joue l'un des deux joueurs.
const files = new Map<string, Record<string, any>>();
const load = (day: string) => {
  if (!files.has(day)) { const f = join(dir, `${day}.json`); files.set(day, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}); }
  return files.get(day)!;
};
const priced = [...Array(9).keys()].flatMap((i) => Object.values(load(new Date(Date.now() + (i - 2) * 86_400_000).toISOString().slice(0, 10)))).filter((m: any) => m.last?.ml);

const at = new Date().toISOString();
let added = 0;
for (const f of fixtures) {
  const day = f.start.slice(0, 10), data = load(day), pk = pairKey(f.home, f.away);
  if (Object.values(data).some((m: any) => m.source !== 'espn' && m.last?.ml && pairKey(m.home, m.away) === pk)) continue; // déjà coté par Pinnacle
  // Une fiche par identifiant ESPN vu pour ce match : l'app peut envoyer l'un ou l'autre.
  for (const id of f.ids) {
    if (data[id]) { Object.assign(data[id], { start: f.start, home: f.home, away: f.away }); continue; }
    data[id] = { id: Number(id), source: 'espn', league: leagueOf(f, priced as any), start: f.start, home: f.home, away: f.away, first: { at }, last: { at }, moves: [] };
    added++;
  }
}
// Fiche ESPN restée sans cote alors que Pinnacle a coté le même match : la cote Pinnacle lui est recopiée.
let linked = 0;
for (const data of files.values())
  for (const m of Object.values(data) as any[]) {
    if (m.source !== 'espn' || m.last?.ml) continue;
    const twin: any = Object.values(data).find((x: any) => x.source !== 'espn' && x.last?.ml && pairKey(x.home, x.away) === pairKey(m.home, m.away));
    if (twin) { m.first = twin.first; m.last = twin.last; m.moves = twin.moves; m.pinnacle = twin.id; linked++; }
  }
mkdirSync(dir, { recursive: true });
for (const [day, data] of files) if (Object.keys(data).length) writeFileSync(join(dir, `${day}.json`), JSON.stringify(data));
console.log(`calendrier ESPN : ${fixtures.length} matchs programmés, ${added} fiches sans cote ajoutées, ${linked} reliées à une cote Pinnacle`);
for (const f of fixtures) console.log(`  ${f.start} ${f.event} ${f.round} ${f.home} - ${f.away} : ${f.ids.join(', ')}`);
