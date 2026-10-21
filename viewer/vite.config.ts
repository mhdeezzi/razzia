import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Le dossier out/ (résultats de simulation) est servi tel quel : /<match>/typical.json, /<match>/summary.json, /index.json
export default defineConfig({
  root: resolve(import.meta.dirname),
  publicDir: resolve(import.meta.dirname, '..', 'out'),
  server: { port: 5178, open: true },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
});
