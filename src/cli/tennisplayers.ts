// Fiche courte des joueurs à l'affiche (programme ATP) : code ATP (photo officielle), pays, classement, âge, et une
// photo Wikipédia de secours. Lit les fichiers de cotes à venir, l'historique TennisMyLife des deux dernières années ;
// écrit <dossier>/players.json (les photos Wikipédia déjà cherchées sont gardées).
//   node src/cli/tennisplayers.ts <dossier cotes>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHistory } from '../tennis/data.ts';
import { nameKey } from '../tennis/history.ts';
import { photoOf } from '../tennis/photos.ts';

const dir = process.argv[2] ?? 'cotes-tennis';
const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const names = new Set<string>();
for (const f of readdirSync(join(dir, 'atp')).filter((f) => f.endsWith('.json') && f.slice(0, 10) >= since))
  for (const m of Object.values(JSON.parse(readFileSync(join(dir, 'atp', f), 'utf8'))) as Array<{ home: string; away: string }>) {
    names.add(m.home);
    names.add(m.away);
  }
const now = new Date();
const history = await loadHistory('data/cache/tennis/tml', now.getUTCFullYear() - 1, now);
const last = new Map<string, { atp?: string; ioc: string; rank?: number; age?: number; date: string }>();
for (const m of history) for (const s of [m.w, m.l]) last.set(s.id, { atp: s.atp ?? last.get(s.id)?.atp, ioc: s.ioc, rank: s.rank ?? last.get(s.id)?.rank, age: s.age, date: m.date });
const file = join(dir, 'players.json');
const before: Record<string, { wiki?: string | null }> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const out: Record<string, object> = {};
for (const name of names) {
  const x = last.get(nameKey(name));
  // Photo Wikipédia seulement pour les joueurs sans code ATP connu (la photo officielle suffit sinon).
  const wiki = x?.atp ? undefined : name in before ? before[name].wiki : ((await photoOf(name, 'data/cache/tennis')) ?? null);
  out[name] = { atp: x?.atp, ioc: x?.ioc, rank: x?.rank, age: x?.age != null ? +(x.age + (Date.parse(now.toISOString().slice(0, 10)) - Date.parse(x.date)) / 31_557_600_000).toFixed(1) : undefined, ...(wiki !== undefined ? { wiki } : {}) };
}
writeFileSync(file, JSON.stringify(out));
console.log(`joueurs à l'affiche : ${names.size}, avec code ATP : ${Object.values(out).filter((x: any) => x.atp).length}`);
