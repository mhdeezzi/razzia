// Football : programme des prochains jours (branche donnees-foot, tenu à jour par donnees-foot.yml), scores en direct
// (FotMob), simulations à la demande via GitHub Actions (simulate-foot.yml) et la branche resultats.
//   GET  /api/foot?slate=1          -> {matches, sims} : matchs affichés (Premier League, LaLiga, Ligue 1, Serie A avec un
//                                      grand club, Ligue des Champions), état et score du moment, déjà simulés
//   GET  /api/foot?bilan=1          -> bilan des simulations terminées (bilan-foot.yml)
//   POST /api/foot {id} | {ids}     -> lance une simulation (ou toute une journée en un passage), renvoie {status, req}
//   GET  /api/foot?id=[&req=]       -> {status:'done', result} | {status:'queued'|'running'|'failed'|'none'}
//   GET  /api/foot?req=             -> état d'un passage « toute la journée »
const REPO = process.env.GH_REPO ?? 'mhdeezzi/razzia';
const WORKFLOW = 'simulate-foot.yml';
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
const okId = (id: unknown) => /^\d{5,12}$/.test(String(id ?? ''));

/** Scores du jour chez FotMob (hier, aujourd'hui) : état, score, minute. Sans réponse, le programme garde son état. */
async function live(): Promise<Map<string, { state: 'pre' | 'in' | 'post'; score: [number, number]; minute?: string }>> {
  const out = new Map<string, { state: 'pre' | 'in' | 'post'; score: [number, number]; minute?: string }>();
  const days = [-1, 0].map((k) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10).replaceAll('-', ''));
  await Promise.all(days.map(async (d) => {
    try {
      const r = await fetch(`https://www.fotmob.com/api/data/matches?date=${d}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      for (const l of (await r.json()).leagues ?? [])
        for (const m of l.matches ?? []) {
          const st = m.status ?? {};
          out.set(String(m.id), { state: st.finished ? 'post' : st.started ? 'in' : 'pre', score: [Number(m.home?.score) || 0, Number(m.away?.score) || 0], minute: st.liveTime?.short });
        }
    } catch {
      /* FotMob injoignable */
    }
  }));
  return out;
}

// Identifiant de demande = heure (base 36, 8 car.) + 4 car. au hasard : tant que GitHub n'affiche pas encore
// le passage, une demande récente reste « en attente » au lieu de renvoyer l'ancien résultat comme terminé.
const newReq = () => Date.now().toString(36).padStart(8, '0') + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
const reqFresh = (req: string) => req.length === 12 && Date.now() - parseInt(req.slice(0, 8), 36) < 15 * 60_000;

async function findRun(req: string): Promise<any | undefined> {
  const r = await gh(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=100`);
  if (!r.ok) return undefined;
  return ((await r.json()).workflow_runs ?? []).find((w: any) => String(w.display_title ?? '').endsWith(`· ${req}`));
}


export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  try {
    if (q.get('slate')) {
      const [sl, ix, lv] = await Promise.all([raw('slate.json', 'donnees-foot'), raw('foot/index.json', 'resultats'), live()]);
      const slate = sl.ok ? await sl.json() : { matches: [] };
      const matches = (slate.matches ?? []).map((m: any) => {
        const l = lv.get(m.id);
        return l ? { ...m, state: l.state, score: l.state === 'pre' ? undefined : l.score, minute: l.minute } : m;
      });
      return Response.json({ at: slate.at, matches, sims: ix.ok ? await ix.json() : [] }, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
    }
    if (q.get('bilan')) {
      const b = await raw('foot/bilan.json', 'resultats');
      if (!b.ok) return Response.json({ games: 0, rows: [] }, { headers: noStore });
      const j = await b.json();
      return Response.json(j, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
    }
    const id = q.get('id'), req = q.get('req');
    if (!id && req && /^[a-z0-9]{4,12}$/.test(req)) {
      const run = await findRun(req);
      if (!run) return Response.json(reqFresh(req) ? { status: 'queued' } : { status: 'failed' }, { headers: noStore });
      const status = run.status !== 'completed' ? (run.status === 'queued' ? 'queued' : 'running') : run.conclusion === 'success' ? 'done' : 'failed';
      return Response.json({ status, startedAt: run.run_started_at, url: run.html_url }, { headers: noStore });
    }
    if (!okId(id)) return bad('Paramètres invalides');
    const file = await raw(`foot/sims/${id}.json`, 'resultats');
    if (file.ok) {
      const result = await file.json();
      if (!req) return Response.json({ status: 'done', result }, { headers: noStore });
      const run = await findRun(req);
      if (run?.status === 'completed' && run.conclusion !== 'success') return Response.json({ status: 'done', result, relaunchFailed: true, url: run.html_url }, { headers: noStore });
      if (!run && reqFresh(req)) return Response.json({ status: 'queued', previous: result }, { headers: noStore });
      if (!run || run.status === 'completed') return Response.json({ status: 'done', result }, { headers: noStore });
      if (result.meta?.builtAt && Date.parse(result.meta.builtAt) > Date.parse(run.created_at)) return Response.json({ status: 'done', result }, { headers: noStore });
      return Response.json({ status: run.status === 'queued' ? 'queued' : 'running', startedAt: run.run_started_at, previous: result }, { headers: noStore });
    }
    if (!req) return Response.json({ status: 'none' }, { headers: noStore });
    const run = await findRun(req);
    if (!run) return Response.json(reqFresh(req) ? { status: 'queued' } : { status: 'failed' }, { headers: noStore });
    if (run.status === 'completed') return Response.json({ status: run.conclusion === 'success' ? 'running' : 'failed', url: run.html_url }, { headers: noStore });
    return Response.json({ status: run.status === 'queued' ? 'queued' : 'running', startedAt: run.run_started_at, url: run.html_url }, { headers: noStore });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) ?? {};
  const ids: unknown[] = Array.isArray(body.ids) ? body.ids : [body.id];
  if (!ids.length || ids.length > 40 || !ids.every(okId)) return bad('Paramètres invalides');
  // Seulement des matchs du programme pas encore commencés ; rattachement à un calcul déjà en cours ; 10 au plus.
  let kIds: string[];
  try {
    const sl = await raw('slate.json', 'donnees-foot');
    if (!sl.ok) return bad('Programme indisponible pour le moment : réessaie dans un instant.', 503);
    const ms: any[] = (await sl.json()).matches ?? [];
    kIds = ids.map(String).filter((id) => { const m = ms.find((x) => x.id === id); return m && m.state === 'pre' && Date.parse(m.start) > Date.now(); });
    if (!kIds.length) return bad(ids.length > 1 ? 'Aucun match à venir dans cette demande.' : 'Match commencé ou introuvable : pas de simulation.', 409);
    const rr = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=50`);
    if (!rr.ok) throw new Error(String(rr.status));
    const running: any[] = ((await rr.json()).workflow_runs ?? []).filter((w: any) => w.status !== 'completed');
    const same = running.find((w) => { const t = String(w.display_title ?? '').split(' ')[1]?.split(',') ?? []; return kIds.every((id) => t.includes(id)); });
    if (same) return Response.json({ status: 'queued', req: String(same.display_title).split(' · ').pop() }, { headers: noStore });
    if (running.length >= 10) return bad('Trop de simulations en cours : réessaie dans quelques minutes.', 429);
  } catch {
    return bad('Impossible de vérifier le programme ou les calculs en cours : réessaie dans un instant.', 503);
  }
  const req = newReq();
  try {
    const r = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { ids: kIds.join(','), request_id: req } }) });
    if (r.status === 401) return bad('Clé GitHub refusée (401) : invalide ou expirée.', 502);
    if (r.status === 403 || r.status === 404) return bad(`Clé GitHub sans les droits nécessaires (${r.status}).`, 502);
    if (!r.ok) return bad(`GitHub a refusé le lancement (${r.status}) : ${(await r.text()).slice(0, 200)}`, 502);
    return Response.json({ status: 'queued', req }, { headers: noStore });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
