import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Viewer de développement (rendu 2D du match typique, tableau de bord brut) : sert out/ tel quel.
//   npm run viewer
export default defineConfig({
  root: resolve(import.meta.dirname),
  publicDir: resolve(import.meta.dirname, '..', 'out'),
  server: { port: 5178, open: true },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
});
