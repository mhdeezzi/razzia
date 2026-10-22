// Simulations à la demande, via GitHub Actions (workflow simulate.yml) et la branche resultats.
//   POST /api/sim  {date, away, home}          -> lance une simulation, renvoie {status:'queued', req}
//   GET  /api/sim?date=&away=&home=[&req=]     -> {status:'done', result} | {status:'queued'|'running'|'failed'|'none'}
//   GET  /api/sim?list=1                       -> simulations disponibles [{dir, pHome, pAway, at}]
//   GET  /api/sim?bilan=1                      -> bilan des simulations (valeur de clôture, résultats)
// Variables Vercel : GH_TOKEN (jeton GitHub avec Actions: write et Contents: read sur le dépôt), GH_REPO (optionnel).
const REPO = process.env.GH_REPO ?? 'mhdeezzi/simbet';
const WORKFLOW = 'simulate.yml';
const BRANCH = 'resultats';

// Noms acceptés pour la clé, espaces et retours à la ligne collés par erreur retirés.
const TOKEN = (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_PAT ?? '').trim();

function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const token = TOKEN;
  if (!token)
    throw new Error(
      `Clé GitHub absente de ce déploiement (environnement ${process.env.VERCEL_ENV ?? 'inconnu'}). Dans Vercel : Settings, Environment Variables, ajouter GH_TOKEN en cochant Production et Preview, puis redéployer.`,
    );
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
}

const noStore = { 'Cache-Control': 'no-store' };
const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status, headers: noStore });

function matchKey(p: { date?: unknown; away?: unknown; home?: unknown }): { date: string; away: string; home: string; dir: string } | undefined {
  const date = String(p.date ?? '');
  const away = String(p.away ?? '').toUpperCase();
  const home = String(p.home ?? '').toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[A-Z]{3}$/.test(away) || !/^[A-Z]{3}$/.test(home) || away === home) return undefined;
  return { date, away, home, dir: `${date}_${away}@${home}` };
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  try {
    if (q.get('bilan')) {
      const r = await gh(`/contents/sims/bilan.json?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!r.ok) return Response.json({ error: 'Bilan pas encore calculé (une fois par jour, matchs terminés).' }, { status: 404, headers: noStore });
      return Response.json(await r.json(), { headers: { 'Cache-Control': 'public, s-maxage=300' } });
    }
    if (q.get('list')) {
      const r = await gh(`/contents/sims/index.json?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      const sims = r.ok ? await r.json() : [];
      return Response.json({ sims }, { headers: { 'Cache-Control': 'public, s-maxage=20' } });
    }
    const k = matchKey({ date: q.get('date'), away: q.get('away'), home: q.get('home') });
    if (!k) return bad('Paramètres invalides');
    const file = await gh(`/contents/sims/${encodeURIComponent(k.dir)}/summary.json?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    const req = q.get('req');
    if (file.ok) {
      const result = await file.json();
      const typ = await gh(`/contents/sims/${encodeURIComponent(k.dir)}/typical.json?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (typ.ok) result.typical = await typ.json();
      // Une demande en cours pour ce match (relance) passe avant l'ancien résultat.
      if (!req) return Response.json({ status: 'done', result }, { headers: noStore });
      const run = await findRun(req);
      if (!run || run.status === 'completed') return Response.json({ status: 'done', result }, { headers: noStore });
      return Response.json({ status: run.status === 'queued' ? 'queued' : 'running', startedAt: run.run_started_at, previous: result }, { headers: noStore });
    }
    if (!req) return Response.json({ status: 'none' }, { headers: noStore });
    const run = await findRun(req);
    if (!run) return Response.json({ status: 'queued' }, { headers: noStore });
    if (run.status === 'completed') {
      // Succès mais fichier pas encore visible : la publication vient de se terminer.
      return Response.json({ status: run.conclusion === 'success' ? 'running' : 'failed', url: run.html_url }, { headers: noStore });
    }
    return Response.json({ status: run.status === 'queued' ? 'queued' : 'running', startedAt: run.run_started_at, url: run.html_url }, { headers: noStore });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}

async function findRun(req: string): Promise<any | undefined> {
  const r = await gh(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=40`);
  if (!r.ok) return undefined;
  const j = await r.json();
  return (j.workflow_runs ?? []).find((w: any) => String(w.display_title ?? '').endsWith(`· ${req}`));
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const k = matchKey(body);
  if (!k) return bad('Paramètres invalides');
  const req = Math.random().toString(36).slice(2, 10);
  try {
    const r = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', inputs: { date: k.date, away: k.away, home: k.home, request_id: req } }),
    });
    if (r.status === 401) return bad('Clé GitHub refusée (401) : elle est invalide ou expirée. Générer une nouvelle clé et la remplacer dans Vercel.', 502);
    if (r.status === 403 || r.status === 404)
      return bad(`Clé GitHub sans les droits nécessaires (${r.status}) : elle doit donner accès au dépôt ${REPO} avec la permission Actions en lecture et écriture.`, 502);
    if (!r.ok) return bad(`GitHub a refusé le lancement (${r.status}) : ${(await r.text()).slice(0, 200)}`, 502);
    return Response.json({ status: 'queued', req }, { headers: noStore });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
