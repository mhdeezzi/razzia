// Données foot (fiches FotMob, calendriers, cotes football-data) gardées sur la branche donnees-foot, seule et sans
// historique, avec le programme des prochains jours (slate.json) que lit l'app.
//   node src/cli/footsnap.ts --push [--slate fichier]   -> archive data/cache/foot/ et la pousse
//   node src/cli/footsnap.ts --pull                     -> la restaure dans data/cache/foot/
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, ROOT } from '../data/http.ts';

const BRANCH = 'donnees-foot';
const git = (args: string[], input?: string) => execFileSync('git', args, { cwd: ROOT, input, encoding: 'utf8', maxBuffer: 1 << 30 }).trim();
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

if (process.argv.includes('--push')) {
  if (!existsSync(join(CACHE_DIR, 'foot'))) throw new Error('data/cache/foot/ absent');
  const tar = join(ROOT, 'data', 'foot.tgz');
  execFileSync('tar', ['--exclude=foot/backtest.json', '-czf', tar, '-C', CACHE_DIR, 'foot']);
  const lines = [`100644 blob ${git(['hash-object', '-w', tar])}\tfoot.tgz`];
  const slate = arg('--slate');
  if (slate && existsSync(slate)) lines.push(`100644 blob ${git(['hash-object', '-w', slate])}\tslate.json`);
  const tree = git(['mktree'], `${lines.join('\n')}\n`);
  const commit = git(['commit-tree', tree, '-m', `Données foot du ${new Date().toISOString().slice(0, 16)}`]);
  git(['push', '--force', 'origin', `${commit}:refs/heads/${BRANCH}`]);
  console.log(`Données foot poussées sur ${BRANCH} (${(statSync(tar).size / 1e6).toFixed(1)} Mo).`);
  rmSync(tar);
} else if (process.argv.includes('--pull')) {
  git(['fetch', '--depth', '1', 'origin', BRANCH]);
  const tar = join(ROOT, 'data', 'foot.tgz');
  mkdirSync(CACHE_DIR, { recursive: true });
  execFileSync('sh', ['-c', `git show FETCH_HEAD:foot.tgz > "${tar}"`], { cwd: ROOT });
  execFileSync('tar', ['-xzf', tar, '-C', CACHE_DIR]);
  rmSync(tar);
  try { execFileSync('sh', ['-c', `git show FETCH_HEAD:slate.json > "${join(CACHE_DIR, 'foot', 'slate.json')}"`], { cwd: ROOT }); } catch { /* pas encore de programme */ }
  console.log(`${git(['log', '-1', '--format=%s', 'FETCH_HEAD'])} : restauré.`);
} else {
  console.log('Usage : node src/cli/footsnap.ts --push [--slate fichier] | --pull');
}
