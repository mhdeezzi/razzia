// Calendrier ATP d'ESPN (simple messieurs, du jour à dans 6 jours) : chaque match programmé que Pinnacle n'a pas
// encore coté devient une fiche sans cote dans <dossier>/atp/AAAA-MM-JJ.json (identifiant ESPN), pour qu'on puisse le
// simuler avec le moteur seul. Qualifications et joueurs inconnus (TBD) ignorés. Une fiche ESPN reprend la cote dès
// que Pinnacle publie le même match (même paire de joueurs, même jour).
//   node src/cli/tennisfixtures.ts <dossier>   (cotes-tennis par défaut)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { espnFixtures, leagueOf, samePair, samePlayer } from '../tennis/espn.ts';

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
  const day = f.start.slice(0, 10), data = load(day);
  // Une fiche par identifiant ESPN vu pour ce match (l'app peut envoyer l'un ou l'autre) ; si Pinnacle cote déjà le
  // match, la fiche ESPN reprend sa cote et son nom de tournoi (la boucle suivante relie aussi les fiches plus anciennes).
  const twin: any = Object.values(data).find((m: any) => m.source !== 'espn' && m.last?.ml && samePair(m, f));
  for (const id of f.ids) {
    // Match déplacé à un autre jour par ESPN : sa fiche (et sa cote) change de fichier au lieu d'être recréée vide.
    const moved = [...files.entries()].find(([d, x]) => d !== day && x[id]);
    if (moved && !data[id]) { data[id] = moved[1][id]; delete moved[1][id]; }
    if (data[id]) { Object.assign(data[id], { start: f.start, home: data[id].last?.ml ? data[id].home : f.home, away: data[id].last?.ml ? data[id].away : f.away }); continue; }
    data[id] = { id: Number(id), source: 'espn', league: twin?.league ?? leagueOf(f, priced as any), start: f.start, home: f.home, away: f.away, first: { at }, last: { at }, moves: [] };
    added++;
  }
}
// Fiche ESPN restée sans cote alors que Pinnacle a coté le même match : la cote Pinnacle lui est recopiée.
let linked = 0;
// Cherchée aussi la veille et le lendemain : ESPN décale parfois un match d'un jour (ordre de jeu) avant Pinnacle.
const allRows = () => [...files.values()].flatMap((d) => Object.values(d)) as any[];
for (const data of files.values())
  for (const m of Object.values(data) as any[]) {
    if (m.source !== 'espn') continue;
    const twin: any = allRows().find((x: any) => x.source !== 'espn' && x.last?.ml && samePair(x, m) && Math.abs(Date.parse(x.start) - Date.parse(m.start)) < 48 * 3_600_000);
    // Cote Pinnacle recopiée à chaque passage (elle bouge) ; le nom de tournoi Pinnacle sert au moteur (surface, format).
    // Joueurs dans l'ordre de Pinnacle : la cote [domicile, extérieur] suit cet ordre.
    // Orthographe d'ESPN gardée (photo des joueurs), dans l'ordre de Pinnacle.
    if (twin) {
      const [home, away] = samePlayer(m.home, twin.home) ? [m.home, m.away] : [m.away, m.home];
      Object.assign(m, { league: twin.league, home, away, first: twin.first, last: twin.last, moves: twin.moves, pinnacle: twin.id });
      linked++;
    }
  }
mkdirSync(dir, { recursive: true });
for (const [day, data] of files) if (Object.keys(data).length) writeFileSync(join(dir, `${day}.json`), JSON.stringify(data));
console.log(`calendrier ESPN : ${fixtures.length} matchs programmés, ${added} fiches ajoutées, ${linked} reliées à une cote Pinnacle`);
for (const f of fixtures) console.log(`  ${f.start} ${f.event} ${f.round} ${f.home} - ${f.away} : ${f.ids.join(', ')}`);
