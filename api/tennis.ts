// Tennis (ATP) : programme d'après les cotes Pinnacle notées (branche cotes-tennis), simulations à la demande via GitHub
// Actions (workflow simulate-tennis.yml) et la branche resultats.
//   GET  /api/tennis?slate=1             -> {matches, sims, players} : matchs à venir (cotes), déjà simulés, fiche des joueurs
//   GET  /api/tennis?bilan=1             -> bilan des simulations terminées (bilan-tennis.yml, toutes les 3 heures)
//   POST /api/tennis {id, day}           -> lance une simulation, renvoie {status:'queued', req}
//   POST /api/tennis {ids, days}         -> toute la journée en un seul passage GitHub (un jour par match), même réponse
//   GET  /api/tennis?id=&day=[&req=]     -> {status:'done', result} | {status:'queued'|'running'|'failed'|'none'}
//   GET  /api/tennis?req=                -> état d'un passage « toute la journée » : {status, startedAt?, url?}
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
      const [s, p] = await Promise.all([raw('tennis/index.json', 'resultats'), raw('players.json', 'cotes-tennis')]);
      return Response.json({ matches, sims: s.ok ? await s.json() : [], players: p.ok ? await p.json() : {} }, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
    }
    if (q.get('bilan')) {
      const b = await raw('tennis/bilan.json', 'resultats');
      return b.ok ? Response.json(await b.json(), { headers: { 'Cache-Control': 'public, s-maxage=300' } }) : Response.json({ games: 0 }, { headers: noStore });
    }
    const id = q.get('id'), day = q.get('day'), req = q.get('req');
    if (!id && req && /^[a-z0-9]{4,12}$/.test(req)) {
      const run = await findRun(req);
      if (!run) return Response.json({ status: 'queued' }, { headers: noStore });
      const status = run.status !== 'completed' ? (run.status === 'queued' ? 'queued' : 'running') : run.conclusion === 'success' ? 'done' : 'failed';
      return Response.json({ status, startedAt: run.run_started_at, url: run.html_url }, { headers: noStore });
    }
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
  const ids: unknown[] = Array.isArray(body.ids) ? body.ids : [body.id];
  const days: unknown[] = Array.isArray(body.days) ? body.days : [body.day];
  if (!ids.length || ids.length > 64 || days.length !== ids.length || !ids.every(okId) || !days.every(okDay)) return bad('Paramètres invalides');
  const req = Math.random().toString(36).slice(2, 10);
  try {
    const inputs = { id: ids.join(','), day: days.every((d) => d === days[0]) ? String(days[0]) : days.join(','), request_id: req };
    const r = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs }) });
    if (r.status === 401) return bad('Clé GitHub refusée (401) : invalide ou expirée.', 502);
    if (r.status === 403 || r.status === 404) return bad(`Clé GitHub sans les droits nécessaires (${r.status}) : Actions en lecture et écriture sur ${REPO}.`, 502);
    if (!r.ok) return bad(`GitHub a refusé le lancement (${r.status}) : ${(await r.text()).slice(0, 200)}`, 502);
    return Response.json({ status: 'queued', req }, { headers: noStore });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
