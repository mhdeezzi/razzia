// Copie les résultats de simulation consultables par le site (index + summary/typical de chaque match)
// de out/ vers site-data/, dossier versionné que Vercel sert tel quel.
//   node src/cli/publish.ts [--since 2026-10-01]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../data/http.ts';

const i = process.argv.indexOf('--since');
const since = i >= 0 ? process.argv[i + 1] : '0000-00-00';
const src = join(ROOT, 'out');
const dst = join(ROOT, 'site-data');

const idx: Array<{ dir: string; date: string }> = JSON.parse(readFileSync(join(src, 'index.json'), 'utf8'));
const kept = idx.filter((e) => e.date >= since && existsSync(join(src, e.dir, 'summary.json')) && existsSync(join(src, e.dir, 'typical.json')));

rmSync(dst, { recursive: true, force: true });
for (const e of kept) {
  mkdirSync(join(dst, e.dir), { recursive: true });
  for (const f of ['summary.json', 'typical.json']) cpSync(join(src, e.dir, f), join(dst, e.dir, f));
}
writeFileSync(join(dst, 'index.json'), JSON.stringify(kept, null, 1));
console.log(`${kept.length} matchs publiés dans site-data/ — git add site-data && git commit && git push pour mettre le site à jour.`);
