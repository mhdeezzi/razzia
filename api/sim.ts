// Simulations à la demande, via GitHub Actions (workflow simulate.yml) et la branche resultats.
//   POST /api/sim  {date, away, home}          -> lance une simulation, renvoie {status:'queued', req}
//   GET  /api/sim?date=&away=&home=[&req=]     -> {status:'done', result} | {status:'queued'|'running'|'failed'|'none'}
//   GET  /api/sim?reqs=a,b,c                   -> état de plusieurs demandes en un appel (simulation de toute une soirée)
//   GET  /api/sim?list=1                       -> simulations disponibles [{dir, pHome, pAway, at}]
//   GET  /api/sim?bilan=1                      -> bilan des simulations (valeur de clôture, résultats)
// Variables Vercel : GH_TOKEN (jeton GitHub avec Actions: write et Contents: read sur le dépôt), GH_REPO (optionnel).
const REPO = process.env.GH_REPO ?? 'mhdeezzi/razzia';
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

const TEAMS = new Set('ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split(' '));
/** Vraie date du calendrier (pas de 31 février). */
const realDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;

function matchKey(p: unknown): { date: string; away: string; home: string; dir: string } | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const o = p as { date?: unknown; away?: unknown; home?: unknown };
  const date = String(o.date ?? '');
  const away = String(o.away ?? '').toUpperCase();
  const home = String(o.home ?? '').toUpperCase();
  if (!realDate(date) || !TEAMS.has(away) || !TEAMS.has(home) || away === home) return undefined;
  return { date, away, home, dir: `${date}_${away}@${home}` };
}

// Garde-fous du lancement (l'API est publique) : une seule simulation en cours par match, un plafond global de
// simulations en file, et seulement pour les matchs d'hier à dans 7 jours.
const MAX_IN_FLIGHT = 40;
async function inFlight(): Promise<any[]> {
  const r = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=100`);
  if (!r.ok) return [];
  return ((await r.json()).workflow_runs ?? []).filter((w: any) => w.status !== 'completed');
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  try {
    if (q.get('bilan')) {
      const r = await gh(`/contents/sims/bilan.json?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!r.ok) return Response.json({ error: 'Bilan pas encore calculé (une fois par jour, matchs terminés).' }, { status: 404, headers: noStore });
      return Response.json(await r.json(), { headers: { 'Cache-Control': 'public, s-maxage=60' } });
    }
    if (q.get('reqs')) {
      const reqs = q.get('reqs')!.split(',').filter((r) => /^[a-z0-9]{1,16}$/.test(r)).slice(0, 30);
      const r = await gh(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=100`);
      if (!r.ok) return bad(`GitHub ne répond pas (${r.status})`, 502);
      const all: any[] = (await r.json()).workflow_runs ?? [];
      const runs: Record<string, { status: string; startedAt?: string; url?: string }> = {};
      for (const req of reqs) {
        const w = all.find((x) => String(x.display_title ?? '').endsWith(`· ${req}`));
        // Pas encore listée : la demande vient de partir.
        runs[req] = !w
          ? { status: 'queued' }
          : {
              status: w.status !== 'completed' ? (w.status === 'in_progress' ? 'running' : 'queued') : w.conclusion === 'success' ? 'done' : 'failed',
              startedAt: w.run_started_at,
              url: w.html_url,
            };
      }
      return Response.json({ runs, actions: `https://github.com/${REPO}/actions/workflows/${WORKFLOW}` }, { headers: noStore });
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
      // Relance terminée en échec : l'ancien résultat reste affiché, mais on le dit.
      if (run?.status === 'completed' && run.conclusion !== 'success') return Response.json({ status: 'done', result, relaunchFailed: true, url: run.html_url }, { headers: noStore });
      if (!run || run.status === 'completed') return Response.json({ status: 'done', result }, { headers: noStore });
      // Résultat publié après la demande : il est prêt, même si GitHub affiche encore la demande « en attente »
      // (son état peut retarder de plusieurs minutes sur la publication réelle).
      if (result.meta?.builtAt && Date.parse(result.meta.builtAt) > Date.parse(run.created_at)) return Response.json({ status: 'done', result }, { headers: noStore });
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
  const r = await gh(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=100`);
  if (!r.ok) return undefined;
  const j = await r.json();
  return (j.workflow_runs ?? []).find((w: any) => String(w.display_title ?? '').endsWith(`· ${req}`));
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const k = matchKey(body);
  if (!k) return bad('Paramètres invalides');
  const days = (Date.parse(`${k.date}T12:00:00Z`) - Date.now()) / 86_400_000;
  if (days < -1.5 || days > 7.5) return bad('Match hors de la période simulable (d’hier à dans 7 jours)');
  try {
    const running = await inFlight();
    // Déjà en cours pour ce match : on rattache la demande au calcul existant au lieu d'en lancer un deuxième.
    const same = running.find((w) => String(w.display_title ?? '').startsWith(`Sim ${k.away}@${k.home} ${k.date} · `));
    if (same) return Response.json({ status: 'queued', req: String(same.display_title).split(' · ').pop() }, { headers: noStore });
    if (running.length >= MAX_IN_FLIGHT) return bad('Trop de simulations en cours : réessaie dans quelques minutes.', 429);
  } catch {
    /* lecture des calculs en cours impossible : on lance quand même */
  }
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
