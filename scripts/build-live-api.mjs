// Regroupe les API du direct, Flashscore et des cotes (src/live et src/odds) : les
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
await build({
  entryPoints: ['src/live/flashscore-api.ts'],
  outfile: 'api/flashscore.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  banner: { js: '// Fichier généré par scripts/build-live-api.mjs à partir de src/live (ne pas modifier à la main).' },
});
console.log('api/flashscore.js écrit');
await build({
  entryPoints: ['src/odds/api.ts'], outfile: 'api/cotes.js', bundle: true, platform: 'node', format: 'esm', target: 'node22', legalComments: 'none',
  banner: { js: '// Fichier généré par scripts/build-live-api.mjs à partir de src/odds (ne pas modifier à la main).' },
});
console.log('api/cotes.js écrit');
