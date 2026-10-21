import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Les résultats de simulation sont servis tels quels : /<match>/typical.json, /<match>/summary.json, /index.json.
// En local : out/ (sorties brutes de `npm run sim`). Pour le site déployé : site-data/ (rempli par `npm run publish-site`).
// Config à la racine : un `vite build` lancé sans options (préréglage Vite de Vercel) produit le même site.
export default defineConfig(({ command }) => ({
  root: resolve(import.meta.dirname, 'viewer'),
  publicDir: resolve(import.meta.dirname, command === 'build' ? 'site-data' : 'out'),
  server: { port: 5178, open: true },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
}));
