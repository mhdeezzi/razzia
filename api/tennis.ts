// Tennis (ATP) : programme d'après les cotes Pinnacle notées (branche cotes-tennis), simulations à la demande via GitHub
// Actions (workflow simulate-tennis.yml) et la branche resultats.
//   GET  /api/tennis?slate=1             -> {matches: [...], sims: [...]} : matchs à venir (cotes) et déjà simulés
//   POST /api/tennis {id, day}           -> lance une simulation, renvoie {status:'queued', req}
//   GET  /api/tennis?id=&day=[&req=]     -> {status:'done', result} | {status:'queued'|'running'|'failed'|'none'}
// Variables Vercel : GH_TOKEN (comme /api/sim), GH_REPO (optionnel).
const REPO = process.env.GH_REPO ?? 'mhdeezzi/razzia';
const WORKFLOW = 'simulate-tennis.yml';
const TOKEN = (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_PAT ?? '').trim();

function gh(path: string, init: RequestInit = {}): Promise<Response> {
  if (!TOKEN) throw new Error('Clé GitHub absente de ce déploiement : ajouter GH_TOKEN dans les variables Vercel.');
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
}
const raw = (path: string, ref: string) => gh(`/contents/${path}?ref=${ref}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
const noStore = { 'Cache-Control': 'no-store' };
const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status, headers: noStore });
const okId = (id: unknown) => /^\d{5,14}$/.test(String(id ?? ''));
const okDay = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''));

async function findRun(req: string): Promise<any | undefined> {
  const r = await gh(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=100`);
  if (!r.ok) return undefined;
  return ((await r.json()).workflow_runs ?? []).find((w: any) => String(w.display_title ?? '').endsWith(`· ${req}`));
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  try {
    if (q.get('slate')) {
      // Fichiers de cotes d'hier à dans 6 jours (UTC) : un par jour de match.
      const days = Array.from({ length: 8 }, (_, i) => new Date(Date.now() + (i - 1) * 86_400_000).toISOString().slice(0, 10));
      const files = await Promise.all(days.map(async (d) => { const r = await raw(`atp/${d}.json`, 'cotes-tennis'); return r.ok ? [d, await r.json()] as const : undefined; }));
      const matches = files.flatMap((f) => (f ? Object.values(f[1] as Record<string, any>).map((m) => ({ id: String(m.id), day: f[0], league: m.league, start: m.start, home: m.home, away: m.away, odds: m.last, oddsOpen: m.first })) : []));
      const s = await raw('tennis/index.json', 'resultats');
      return Response.json({ matches, sims: s.ok ? await s.json() : [] }, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
    }
    const id = q.get('id'), day = q.get('day'), req = q.get('req');
    if (!okId(id) || !okDay(day)) return bad('Paramètres invalides');
    const file = await raw(`tennis/sims/${id}.json`, 'resultats');
    if (file.ok) {
      const result = await file.json();
      if (!req) return Response.json({ status: 'done', result }, { headers: noStore });
      const run = await findRun(req);
      if (!run || run.status === 'completed') return Response.json({ status: 'done', result }, { headers: noStore });
      return Response.json({ status: run.status === 'queued' ? 'queued' : 'running', startedAt: run.run_started_at, previous: result }, { headers: noStore });
    }
    if (!req) return Response.json({ status: 'none' }, { headers: noStore });
    const run = await findRun(req);
    if (!run) return Response.json({ status: 'queued' }, { headers: noStore });
    if (run.status === 'completed') return Response.json({ status: run.conclusion === 'success' ? 'running' : 'failed', url: run.html_url }, { headers: noStore });
    return Response.json({ status: run.status === 'queued' ? 'queued' : 'running', startedAt: run.run_started_at, url: run.html_url }, { headers: noStore });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  if (!okId(body.id) || !okDay(body.day)) return bad('Paramètres invalides');
  const req = Math.random().toString(36).slice(2, 10);
  try {
    const r = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { id: String(body.id), day: body.day, request_id: req } }) });
    if (r.status === 401) return bad('Clé GitHub refusée (401) : invalide ou expirée.', 502);
    if (r.status === 403 || r.status === 404) return bad(`Clé GitHub sans les droits nécessaires (${r.status}) : Actions en lecture et écriture sur ${REPO}.`, 502);
    if (!r.ok) return bad(`GitHub a refusé le lancement (${r.status}) : ${(await r.text()).slice(0, 200)}`, 502);
    return Response.json({ status: 'queued', req }, { headers: noStore });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
