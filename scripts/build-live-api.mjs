// Regroupe l'API du direct (src/live/api.ts, le moteur et ses coefficients) en un seul fichier, api/live.js : les
// fonctions Vercel du site n'importent rien d'autre qu'elles-mêmes. À relancer après toute modification de src/live :
//   node scripts/build-live-api.mjs
import { build } from 'esbuild';
await build({
  entryPoints: ['src/live/api.ts'],
  outfile: 'api/live.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  banner: { js: '// Fichier généré par scripts/build-live-api.mjs à partir de src/live (ne pas modifier à la main).' },
});
console.log('api/live.js écrit');
