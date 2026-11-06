// Simulations à la demande, via GitHub Actions (workflow simulate.yml) et la branche resultats.
//   POST /api/sim  {date, away, home}          -> lance une simulation, renvoie {status:'queued', req}
//   GET  /api/sim?date=&away=&home=[&req=]     -> {status:'done', result} | {status:'queued'|'running'|'failed'|'none'}
//   GET  /api/sim?reqs=a,b,c                   -> état de plusieurs demandes en un appel (simulation de toute une soirée)
//   GET  /api/sim?list=1                       -> simulations disponibles [{dir, pHome, pAway, at}]
//   GET  /api/sim?bilan=1                      -> bilan des simulations (valeur de clôture, résultats)
//   GET  /api/sim?tick=1                       -> horloge : relance d'avant-match et bilans (tâche planifiée Supabase)
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
const realDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;

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
  // Lecture impossible : on ne fait pas comme s'il n'y avait rien en cours (le lancement est alors refusé).
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return ((await r.json()).workflow_runs ?? []).filter((w: any) => w.status !== 'completed');
}

/**
 * GitHub saute la plupart des tâches planifiées (le bilan « tous les quarts d'heure » passait toutes les 3 à 6 heures) :
 * quand quelqu'un lit un bilan vieux de plus de 20 minutes, ou à chaque battement de l'horloge (?tick=1), on relance son
 * calcul, sauf s'il tourne déjà ou vient d'être lancé. Une erreur ici n'empêche rien.
 */
async function refreshBilan(workflow: string, at: string | undefined, gapMin = 10): Promise<boolean> {
  if (at && Date.now() - Date.parse(at) < 20 * 60_000) return false;
  try {
    const r = await gh(`/actions/workflows/${workflow}/runs?per_page=3`);
    if (!r.ok) return false;
    const runs: any[] = (await r.json()).workflow_runs ?? [];
    if (runs.some((w) => w.status !== 'completed' || Date.now() - Date.parse(w.created_at) < gapMin * 60_000)) return false;
    return (await gh(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) })).ok;
  } catch {
    return false; /* GitHub injoignable : le bilan reste tel quel */
  }
}

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_TRI: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' };
const etDate = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));

/**
 * Battement de l'horloge (GET /api/sim?tick=1), appelé toutes les 5 minutes par une tâche planifiée Supabase : les
 * tâches planifiées GitHub partent avec des heures de retard. Relance chaque match qui débute dans 5 à 15 minutes
 *  (titulaires confirmés par NBA.com souvent moins de 30 min avant, simulation en 2 à 3 min), une seule fois : rien si une
 * simulation a été publiée depuis 17 minutes avant le match ou si une est en cours. Foot : chaque match du programme 30 min
 * avant (compositions officielles). Recalcule aussi les bilans NBA, tennis et foot (au plus tous les quarts d'heure).
 */
async function tick(): Promise<Response> {
  const now = Date.now();
  const relaunched: string[] = [];
  const days = [...new Set([etDate(now), etDate(now + 6 * 3_600_000), etDate(now + 20 * 3_600_000)])];
  const boards = await Promise.all(
    days.map((d) => fetch(`${ESPN}/scoreboard?dates=${d.replaceAll('-', '')}`, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : { events: [] }), () => ({ events: [] }))),
  );
  const soon = boards
    .flatMap((b: any) => b.events ?? [])
    .map((e: any) => {
      const c = e.competitions?.[0];
      const side = (ha: string) => c?.competitors?.find((x: any) => x.homeAway === ha)?.team?.abbreviation ?? '';
      const tip = Date.parse(e.date);
      const tri = (a: string) => ESPN_TRI[a] ?? a;
      const odds = c?.odds?.[0];
      const hasOdds = !!(odds && (odds.moneyline || odds.homeTeamOdds?.moneyLine != null || odds.details));
      return { tip, state: c?.status?.type?.state, away: tri(side('away')), home: tri(side('home')), date: etDate(tip), hasOdds };
    })
    .filter((g) => g.state === 'pre');
  const upcoming = soon;
  // 5 à 15 min avant : NBA.com confirme souvent les titulaires moins de 30 min avant le match (à 30 min, la relance
  // prenait encore les compositions « probables »). La simulation prend environ 2 minutes.
  const near = upcoming.filter((g) => g.tip - now >= 5 * 60_000 && g.tip - now <= 15 * 60_000);
  // Simulée avant la publication des cotes (index : noOdds) et cotes parues depuis : relancée une fois, plus de 30 min
  // avant le match (ensuite c'est la relance d'avant-match qui s'en charge).
  const later = upcoming.filter((g) => g.hasOdds && g.tip - now > 30 * 60_000 && g.tip - now <= 20 * 3_600_000);
  // Calculs en cours illisibles : pas de relance NBA à ce battement (sinon risque de doublon), on retente au suivant.
  const running = near.length || later.length ? await inFlight().catch(() => undefined) : undefined;
  if (running) {
    const r = await gh(`/contents/sims/index.json?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    const index: Array<{ dir: string; at: string; noOdds?: boolean }> = r.ok ? await r.json() : [];
    for (const g of later) {
      const dir = `${g.date}_${g.away}@${g.home}`;
      if (!index.some((e) => e.dir === dir && e.noOdds)) continue;
      if (running.some((w) => String(w.display_title ?? '').startsWith(`Sim ${g.away}@${g.home} ${g.date} · `))) continue;
      const d = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { date: g.date, away: g.away, home: g.home, request_id: 'cotes' } }),
      });
      if (d.ok) relaunched.push(`${dir} (cotes)`);
    }
    for (const g of near) {
      const dir = `${g.date}_${g.away}@${g.home}`;
      if (index.some((e) => e.dir === dir && Date.parse(e.at) >= g.tip - 17 * 60_000)) continue;
      if (running.some((w) => String(w.display_title ?? '').startsWith(`Sim ${g.away}@${g.home} ${g.date} · `))) continue;
      const d = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { date: g.date, away: g.away, home: g.home, request_id: 'avant-match', fresh: 'true' } }),
      });
      if (d.ok) relaunched.push(dir);
    }
  }
  // Tennis : même règle. Un match simulé sans cote (index : noOdds) qui en a une maintenant (fichier de cotes du jour) est
  // relancé une fois, de 20 h à 30 min avant le début (jamais une fois commencé).
  try {
    const ti = await gh(`/contents/tennis/index.json?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    const tIndex: Array<{ id: string; day: string; start: string; noOdds?: boolean }> = ti.ok ? await ti.json() : [];
    const todo = tIndex.filter((e) => e.noOdds && Date.parse(e.start) - now > 30 * 60_000 && Date.parse(e.start) - now <= 20 * 3_600_000);
    if (todo.length) {
      const odds = new Map<string, any>();
      for (const day of new Set(todo.map((e) => e.day))) {
        const r = await gh(`/contents/atp/${day}.json?ref=cotes-tennis`, { headers: { Accept: 'application/vnd.github.raw+json' } });
        odds.set(day, r.ok ? await r.json() : {});
      }
      const tr = await gh(`/actions/workflows/simulate-tennis.yml/runs?per_page=50`);
      const tRunning: any[] = tr.ok ? ((await tr.json()).workflow_runs ?? []).filter((w: any) => w.status !== 'completed') : [];
      const ids = todo.filter((e) => {
        const o = odds.get(e.day)?.[e.id];
        const ml = o?.last?.ml ?? o?.first?.ml;
        return ml && !tRunning.some((w) => String(w.display_title ?? '').split(' ')[1]?.split(',').includes(e.id));
      });
      const byDay = new Map<string, string[]>();
      for (const e of ids) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e.id]);
      for (const [day, list] of byDay) {
        const d = await gh(`/actions/workflows/simulate-tennis.yml/dispatches`, {
          method: 'POST',
          body: JSON.stringify({ ref: 'main', inputs: { id: list.join(','), day, request_id: 'cotes' } }),
        });
        if (d.ok) relaunched.push(...list.map((x) => `tennis ${x} (cotes)`));
      }
    }
  } catch {
    /* tennis indisponible : le basket continue */
  }
  // Foot : chaque match du programme est simulé tout seul 30 minutes avant le coup d'envoi (entre 40 et 20 min), avec
  // les compositions officielles (FotMob les publie environ une heure avant), sauf s'il l'a déjà été depuis 45 minutes
  // avant le match. Si les compositions n'étaient pas encore officielles, nouvelle relance entre 15 et 5 minutes avant.
  // Jamais une fois le match commencé. Le programme est aussi rafraîchi s'il a plus de 1 h 15 (GitHub part en retard).
  let footData = false;
  try {
    const [sl, fi] = await Promise.all([
      gh(`/contents/slate.json?ref=donnees-foot`, { headers: { Accept: 'application/vnd.github.raw+json' } }),
      gh(`/contents/foot/index.json?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } }),
    ]);
    const slate: { at?: string; matches?: Array<{ id: string; start: string; state: string }> } = sl.ok ? await sl.json() : {};
    const fIndex: Array<{ id: string; start: string; at: string; lineup?: string }> = fi.ok ? await fi.json() : [];
    const last = new Map(fIndex.map((e) => [e.id, e]));
    const ids: string[] = [];
    for (const m of slate.matches ?? []) {
      const t = Date.parse(m.start), left = t - now, e = last.get(m.id);
      if (m.state === 'post') continue;
      if (left >= 20 * 60_000 && left <= 40 * 60_000 && !(e && Date.parse(e.at) >= t - 45 * 60_000)) ids.push(m.id);
      else if (left >= 5 * 60_000 && left <= 15 * 60_000 && e && e.lineup !== 'standard' && Date.parse(e.at) < t - 17 * 60_000) ids.push(m.id);
    }
    if (ids.length) {
      const fr = await gh(`/actions/workflows/simulate-foot.yml/runs?per_page=50`);
      const fRunning: any[] = fr.ok ? ((await fr.json()).workflow_runs ?? []).filter((w: any) => w.status !== 'completed') : [];
      const todo = ids.filter((id) => !fRunning.some((w) => String(w.display_title ?? '').split(' ')[1]?.split(',').includes(id)));
      if (todo.length) {
        const d = await gh(`/actions/workflows/simulate-foot.yml/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { ids: todo.join(','), request_id: 'avant-match' } }) });
        if (d.ok) relaunched.push(...todo.map((x) => `foot ${x}`));
      }
    }
    if (!slate.at || now - Date.parse(slate.at) > 75 * 60_000) footData = await refreshBilan('donnees-foot.yml', undefined, 30);
  } catch {
    /* foot indisponible : le reste continue */
  }
  // Cotes ATP : relevé toutes les heures. La tâche planifiée de GitHub ne part en pratique que toutes les 4 à 8 heures
  // (relevés du 6 novembre à 0 h 18 puis 7 h 57) : l'horloge la lance si aucun relevé n'a eu lieu depuis une heure.
  const [bilan, bilanTennis, bilanFoot, oddsTennis] = await Promise.all([
    refreshBilan('bilan.yml', undefined, 14), refreshBilan('bilan-tennis.yml', undefined, 14), refreshBilan('bilan-foot.yml', undefined, 14),
    refreshBilan('cotes-tennis.yml', undefined, 60),
  ]);
  return Response.json({ at: new Date(now).toISOString(), soon: near.length, relaunched, bilan, bilanTennis, bilanFoot, footData, oddsTennis }, { headers: noStore });
}

/**
 * Contrôle de santé (GET /api/sim?sante=1) : âge de chaque donnée, calculs bloqués et échecs récents. Répond 503 dès
 * qu'un point ne va pas, pour qu'un service de surveillance (UptimeRobot, Better Stack…) envoie une alerte par e-mail.
 */
async function health(): Promise<Response> {
  const now = Date.now();
  const H = 3_600_000;
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const age = (t?: string) => (t ? (now - Date.parse(t)) / H : Infinity);
  const fmt = (h: number) => (h === Infinity ? 'inconnu' : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
  const add = (name: string, h: number, max: number) => checks.push({ name, ok: h <= max, detail: `il y a ${fmt(h)} (seuil ${max} h)` });
  const lastOk = async (wf: string) => {
    const r = await gh(`/actions/workflows/${wf}/runs?status=success&per_page=1`);
    return r.ok ? ((await r.json()).workflow_runs?.[0]?.updated_at as string | undefined) : undefined;
  };
  const branchAt = async (b: string) => {
    const r = await gh(`/branches/${b}`);
    return r.ok ? ((await r.json()).commit?.commit?.committer?.date as string | undefined) : undefined;
  };
  const slate = await gh(`/contents/slate.json?ref=donnees-foot`, { headers: { Accept: 'application/vnd.github.raw+json' } })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  const [stats, odds, b1, b2, b3] = await Promise.all([
    branchAt('donnees-stats'), lastOk('cotes-tennis.yml'), lastOk('bilan.yml'), lastOk('bilan-tennis.yml'), lastOk('bilan-foot.yml'),
  ]);
  add('Stats NBA (Mac, chaque jour)', age(stats), 30);
  add('Programme foot', age((slate as any).at), 3);
  add('Cotes ATP', age(odds), 3);
  // Les bilans sont relancés par l'horloge toutes les 14 min : un bilan vieux d'une heure veut dire horloge arrêtée.
  add('Bilan NBA (et horloge)', age(b1), 1);
  add('Bilan tennis', age(b2), 1);
  add('Bilan foot', age(b3), 1);
  for (const [name, wf] of [['Simulations NBA', WORKFLOW], ['Simulations tennis', 'simulate-tennis.yml'], ['Simulations foot', 'simulate-foot.yml']]) {
    const r = await gh(`/actions/workflows/${wf}/runs?per_page=50`);
    if (!r.ok) {
      checks.push({ name, ok: false, detail: `GitHub ne répond pas (${r.status})` });
      continue;
    }
    const runs: any[] = (await r.json()).workflow_runs ?? [];
    const stuck = runs.filter((w) => w.status !== 'completed' && age(w.created_at) > 0.5).length;
    const recent = runs.filter((w) => w.status === 'completed' && age(w.updated_at) < 6);
    const failed = recent.filter((w) => w.conclusion === 'failure').length;
    // Bloqué plus de 30 min, ou au moins 3 échecs et plus d'un quart des calculs des 6 dernières heures.
    const ok = stuck === 0 && !(failed >= 3 && failed > recent.length / 4);
    checks.push({ name, ok, detail: `${stuck} bloqué(s) plus de 30 min, ${failed} échec(s) sur ${recent.length} en 6 h` });
  }
  const ok = checks.every((c) => c.ok);
  return Response.json({ ok, at: new Date(now).toISOString(), checks }, { status: ok ? 200 : 503, headers: noStore });
}

/** Calcul en cours pour ce match, quel que soit l'appareil qui l'a lancé (relance d'avant-match comprise). */
async function liveRun(k: { date: string; away: string; home: string }): Promise<any | undefined> {
  try {
    return (await inFlight()).find((w) => String(w.display_title ?? '').startsWith(`Sim ${k.away}@${k.home} ${k.date} · `));
  } catch {
    return undefined;
  }
}
/** Réponse « en cours » partagée : l'identifiant de la demande permet à chaque appareil de suivre le même calcul. */
const shared = (w: any, previous?: unknown) => ({
  status: w.status === 'in_progress' ? 'running' : 'queued',
  req: String(w.display_title).split(' · ').pop(),
  startedAt: w.run_started_at ?? w.created_at,
  ...(previous ? { previous } : {}),
});

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  try {
    // Horloge : réservée à la tâche planifiée Supabase quand une clé TICK_KEY est réglée dans Vercel (elle l'envoie en
    // &key=…) ; sans clé réglée, ouverte comme avant.
    if (q.get('tick')) {
      if (process.env.TICK_KEY && q.get('key') !== process.env.TICK_KEY) return bad('Accès refusé', 403);
      return await tick();
    }
    // Santé : chaque appel lit GitHub une dizaine de fois, donc même clé que l'horloge quand elle est réglée.
    if (q.get('sante')) {
      if (process.env.TICK_KEY && q.get('key') !== process.env.TICK_KEY) return bad('Accès refusé', 403);
      return await health();
    }
    if (q.get('bilan')) {
      const r = await gh(`/contents/sims/bilan.json?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!r.ok) return Response.json({ error: 'Bilan pas encore calculé (une fois par jour, matchs terminés).' }, { status: 404, headers: noStore });
      const b = await r.json();
      return Response.json(b, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
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
          ? { status: req.length !== 12 || reqFresh(req) ? 'queued' : 'failed' }
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
      if (!req) {
        const live = await liveRun(k);
        if (live && !(result.meta?.builtAt && Date.parse(result.meta.builtAt) > Date.parse(live.created_at))) return Response.json(shared(live, result), { headers: noStore });
        return Response.json({ status: 'done', result }, { headers: noStore });
      }
      const run = await findRun(req);
      // Relance terminée en échec : l'ancien résultat reste affiché, mais on le dit.
      if (run?.status === 'completed' && run.conclusion !== 'success') return Response.json({ status: 'done', result, relaunchFailed: true, url: run.html_url }, { headers: noStore });
      if (!run && reqFresh(req)) return Response.json({ status: 'queued', previous: result }, { headers: noStore });
      if (!run || run.status === 'completed') return Response.json({ status: 'done', result }, { headers: noStore });
      // Résultat publié après la demande : il est prêt, même si GitHub affiche encore la demande « en attente »
      // (son état peut retarder de plusieurs minutes sur la publication réelle).
      if (result.meta?.builtAt && Date.parse(result.meta.builtAt) > Date.parse(run.created_at)) return Response.json({ status: 'done', result }, { headers: noStore });
      return Response.json({ status: run.status === 'queued' ? 'queued' : 'running', startedAt: run.run_started_at, previous: result }, { headers: noStore });
    }
    if (!req) {
      // Simulation lancée par quelqu'un d'autre (ou sur un autre appareil) : on la suit au lieu d'afficher « aucune ».
      const live = await liveRun(k);
      return Response.json(live ? shared(live) : { status: 'none' }, { headers: noStore });
    }
    const run = await findRun(req);
    if (!run) return Response.json(reqFresh(req) ? { status: 'queued' } : { status: 'failed' }, { headers: noStore });
    if (run.status === 'completed') {
      // Succès mais fichier pas encore visible : la publication vient de se terminer.
      return Response.json({ status: run.conclusion === 'success' ? 'running' : 'failed', url: run.html_url }, { headers: noStore });
    }
    return Response.json({ status: run.status === 'queued' ? 'queued' : 'running', startedAt: run.run_started_at, url: run.html_url }, { headers: noStore });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}

// Identifiant de demande = heure (base 36, 8 car.) + 4 car. au hasard : tant que GitHub n'affiche pas encore
// le passage, une demande récente reste « en attente » au lieu de renvoyer l'ancien résultat comme terminé.
const newReq = () => Date.now().toString(36).padStart(8, '0') + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
const reqFresh = (req: string) => req.length === 12 && Date.now() - parseInt(req.slice(0, 8), 36) < 15 * 60_000;

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
  // Le match doit être au programme et pas encore commencé : on ne simule jamais un match commencé.
  try {
    const p = await fetch(new URL(`/api/games?days=1&from=${k.date}`, request.url), { signal: AbortSignal.timeout(12_000) });
    const games: any[] = p.ok ? ((await p.json()).games ?? []) : [];
    if (!p.ok) return bad('Programme indisponible pour le moment : réessaie dans un instant.', 503);
    const g = games.find((x) => x.away?.tri === k.away && x.home?.tri === k.home);
    if (!g) return bad('Match introuvable au programme.', 404);
    if (g.state !== 'pre' || Date.parse(g.start) <= Date.now()) return bad('Match commencé : pas de simulation.', 409);
  } catch {
    return bad('Programme indisponible pour le moment : réessaie dans un instant.', 503);
  }
  try {
    const running = await inFlight();
    // Déjà en cours pour ce match : on rattache la demande au calcul existant au lieu d'en lancer un deuxième.
    const same = running.find((w) => String(w.display_title ?? '').startsWith(`Sim ${k.away}@${k.home} ${k.date} · `));
    if (same) return Response.json({ status: 'queued', req: String(same.display_title).split(' · ').pop() }, { headers: noStore });
    if (running.length >= MAX_IN_FLIGHT) return bad('Trop de simulations en cours : réessaie dans quelques minutes.', 429);
  } catch {
    // Impossible de savoir ce qui tourne déjà : refus explicite plutôt qu'un lancement à l'aveugle.
    return bad('Impossible de vérifier les calculs en cours : réessaie dans un instant.', 503);
  }
  const req = newReq();
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
