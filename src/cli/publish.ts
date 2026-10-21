// Ajoute les résultats de simulation consultables par le site (summary/typical de chaque match) de out/ à
// site-data/, dossier versionné que Vercel sert tel quel. Les matchs déjà publiés sont conservés.
//   node src/cli/publish.ts [--keep-days 30]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../data/http.ts';

type Entry = { dir: string; date: string };
const i = process.argv.indexOf('--keep-days');
const keepDays = i >= 0 ? Number(process.argv[i + 1]) : 30;
const src = join(ROOT, 'out');
const dst = join(ROOT, 'site-data');
const readIdx = (f: string): Entry[] => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []);

const fresh = readIdx(join(src, 'index.json')).filter((e) => existsSync(join(src, e.dir, 'summary.json')) && existsSync(join(src, e.dir, 'typical.json')));
for (const e of fresh) {
  mkdirSync(join(dst, e.dir), { recursive: true });
  for (const f of ['summary.json', 'typical.json']) cpSync(join(src, e.dir, f), join(dst, e.dir, f));
}

const cutoff = new Date(Date.now() - keepDays * 864e5).toISOString().slice(0, 10);
const byDir = new Map(readIdx(join(dst, 'index.json')).map((e) => [e.dir, e]));
for (const e of fresh) byDir.set(e.dir, e);
const kept: Entry[] = [];
for (const e of byDir.values()) {
  if (e.date >= cutoff) kept.push(e);
  else rmSync(join(dst, e.dir), { recursive: true, force: true });
}
kept.sort((a, b) => a.date.localeCompare(b.date) || a.dir.localeCompare(b.dir));
writeFileSync(join(dst, 'index.json'), JSON.stringify(kept, null, 1));
console.log(`${fresh.length} matchs ajoutés, ${kept.length} en ligne (${keepDays} derniers jours).`);
