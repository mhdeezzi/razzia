// Instantané des tableaux stats.nba.com (Synergy, tracking, matchups, passes…), qui bloque les serveurs cloud.
// Depuis le Mac, après `npm run ingest` :  node src/cli/snapshot.ts --push
//   -> archive data/cache/stats/ et la pousse (seule, sans historique) sur la branche donnees-stats.
// Sur GitHub Actions :  node src/cli/snapshot.ts --pull   -> la restaure dans data/cache/stats/.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, ROOT } from '../data/http.ts';

const BRANCH = 'donnees-stats';
const git = (args: string[], input?: string) => execFileSync('git', args, { cwd: ROOT, input, encoding: 'utf8', maxBuffer: 1 << 30 }).trim();

if (process.argv.includes('--push')) {
  if (!existsSync(join(CACHE_DIR, 'stats'))) throw new Error('data/cache/stats/ absent : lancer `npm run ingest` d\'abord.');
  const tar = join(ROOT, 'data', 'stats.tar');
  execFileSync('tar', ['-cf', tar, '-C', CACHE_DIR, 'stats']);
  const blob = git(['hash-object', '-w', tar]);
  const tree = git(['mktree'], `100644 blob ${blob}\tstats.tar\n`);
  const commit = git(['commit-tree', tree, '-m', `Instantané stats.nba.com du ${new Date().toISOString().slice(0, 16)}`]);
  git(['push', '--force', 'origin', `${commit}:refs/heads/${BRANCH}`]);
  console.log(`Instantané poussé sur ${BRANCH} (${(statSync(tar).size / 1e6).toFixed(1)} Mo).`);
  rmSync(tar);
} else if (process.argv.includes('--pull')) {
  git(['fetch', '--depth', '1', 'origin', BRANCH]);
  const tar = join(ROOT, 'data', 'stats.tar');
  mkdirSync(CACHE_DIR, { recursive: true });
  execFileSync('sh', ['-c', `git show FETCH_HEAD:stats.tar > "${tar}"`], { cwd: ROOT });
  execFileSync('tar', ['-xf', tar, '-C', CACHE_DIR]);
  rmSync(tar);
  console.log(`${git(['log', '-1', '--format=%s', 'FETCH_HEAD'])} : restauré.`);
} else {
  console.log('Usage : node src/cli/snapshot.ts --push | --pull');
}
