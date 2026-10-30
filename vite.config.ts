import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

// Web app (web/) : programme, fiches de match, simulations à la demande. Les fonctions serveur sont dans api/
// (déployées par Vercel) ; en local, ce plugin les sert aussi sous /api.
const root = import.meta.dirname;

function localApi(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/api\/([a-z]+)/);
        if (!m) return next();
        try {
          const mod = await server.ssrLoadModule(resolve(root, 'api', `${m[1]}.ts`));
          const handler = mod[req.method ?? 'GET'];
          if (!handler) return next();
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          });
          const r: Response = await handler(request);
          res.statusCode = r.status;
          r.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

export default defineConfig({
  root: resolve(root, 'web'),
  publicDir: resolve(root, 'web', 'public'),
  plugins: [localApi()],
  esbuild: { jsx: 'automatic' },
  server: { port: 5180 },
  build: { outDir: resolve(root, 'dist'), emptyOutDir: true },
});
