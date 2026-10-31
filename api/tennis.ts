// Tennis (ATP) : programme d'après les cotes Pinnacle notées (branche cotes-tennis), simulations à la demande via GitHub
// Actions (workflow simulate-tennis.yml) et la branche resultats.
//   GET  /api/tennis?slate=1             -> {matches, sims, players} : matchs (cotes), déjà simulés, fiche des joueurs ;
//                                           chaque match porte son état ESPN (à venir, en direct, terminé) et son score
//   GET  /api/tennis?bilan=1             -> bilan des simulations terminées (bilan-tennis.yml, tous les quarts d'heure)
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
const okDay = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? '')) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === String(d);

// Tableaux ATP d'ESPN (simple messieurs) : scores des tournois en cours et de la veille, et matchs programmés des
// 6 prochains jours (ceux que Pinnacle n'a pas encore cotés s'affichent sans cote, simulables avec le moteur seul).
const key = (n: string) => (n ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
interface Live { state: 'pre' | 'in' | 'post'; ended?: 'final' | 'retired' | 'walkover'; detail?: string; players: Array<{ key: string; winner: boolean; sets: Array<{ g: number; tb?: number; w?: boolean }> }> }
interface Planned { id: string; event: string; round: string; start: string; home: string; away: string }
// Tour ESPN -> code des fiches Pinnacle (« ATP Paris - R16 ») ; qualifications ignorées, comme pour les cotes.
function roundCode(name = ''): string | undefined {
  if (/qualif/i.test(name)) return undefined;
  if (/semi/i.test(name)) return 'SF';
  if (/quarter/i.test(name)) return 'QF';
  if (/^final/i.test(name)) return 'F';
  const of = name.match(/round of (\d+)/i);
  if (of) return `R${of[1]}`;
  const n = name.match(/round (\d)/i);
  return n ? `R${n[1]}` : '';
}
async function espn(): Promise<{ live: Map<string, Live>; planned: Planned[] }> {
  const live = new Map<string, Live>(), planned = new Map<string, Planned>();
  const ymd = (i: number) => new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
  await Promise.all(['', ...[-1, 1, 2, 3, 4, 5, 6].map((i) => `?dates=${ymd(i)}`)].map(async (q) => {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard${q}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      for (const ev of (await r.json()).events ?? [])
        for (const g of ev.groupings ?? []) {
          if (g.grouping?.slug !== 'mens-singles') continue;
          for (const c of g.competitions ?? []) {
            const ps = (c.competitors ?? []).filter((p: any) => p.athlete?.displayName && p.athlete.displayName !== 'TBD');
            if (ps.length !== 2) continue;
            const pair = ps.map((p: any) => key(p.athlete.displayName)).sort().join('|');
            // Terminé seulement sur un vrai statut de fin (score final, abandon, forfait). Temps mort médical, suspension
            // ou pluie : le match reste en direct jusqu'à la reprise ou l'abandon.
            const name = String(c.status?.type?.name ?? '');
            const ended = name === 'STATUS_FINAL' ? 'final' : name === 'STATUS_RETIRED' ? 'retired' : name === 'STATUS_WALKOVER' ? 'walkover' : undefined;
            const raw0 = c.status?.type?.state ?? 'pre';
            const state = raw0 === 'pre' && !ended ? 'pre' : ended ? 'post' : 'in';
            live.set(pair, {
              state, ended, detail: ended === 'retired' ? 'Abandon' : ended === 'walkover' ? 'Forfait' : c.status?.type?.shortDetail,
              players: ps.map((p: any) => ({ key: key(p.athlete.displayName), winner: !!ended && !!p.winner, sets: (p.linescores ?? []).map((l: any) => ({ g: l.value, tb: l.tiebreak, w: l.winner })) })),
            });
            const round = roundCode(c.round?.displayName);
            const start = c.startDate ?? c.date;
            if (state === 'pre' && round !== undefined && /^\d{5,14}$/.test(String(c.id)) && start)
              planned.set(pair, { id: String(c.id), event: ev.shortName ?? ev.name ?? '', round, start, home: ps[0].athlete.displayName, away: ps[1].athlete.displayName });
          }
        }
    } catch {
      /* ESPN indisponible : l'app déduit l'état de l'heure du match */
    }
  }));
  return { live, planned: [...planned.values()] };
}

async function findRun(req: string): Promise<any | undefined> {
  const r = await gh(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=100`);
  if (!r.ok) return undefined;
  return ((await r.json()).workflow_runs ?? []).find((w: any) => String(w.display_title ?? '').endsWith(`· ${req}`));
}

/**
 * GitHub saute la plupart des tâches planifiées (le bilan « tous les quarts d'heure » passait toutes les 3 à 6 heures) :
 * quand quelqu'un lit un bilan vieux de plus de 20 minutes, on relance son calcul, sauf s'il tourne déjà ou vient d'être
 * lancé. Sans effet sur la réponse (le bilan à jour arrive à la lecture suivante) ; une erreur ici n'empêche rien.
 */
async function refreshBilan(workflow: string, at: string | undefined): Promise<void> {
  if (at && Date.now() - Date.parse(at) < 20 * 60_000) return;
  try {
    const r = await gh(`/actions/workflows/${workflow}/runs?per_page=3`);
    if (!r.ok) return;
    const runs: any[] = (await r.json()).workflow_runs ?? [];
    if (runs.some((w) => w.status !== 'completed' || Date.now() - Date.parse(w.created_at) < 10 * 60_000)) return;
    await gh(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  } catch {
    /* GitHub injoignable : le bilan reste tel quel */
  }
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  try {
    if (q.get('slate')) {
      // Fichiers de cotes d'hier à dans 6 jours (UTC) : un par jour de match.
      const days = Array.from({ length: 8 }, (_, i) => new Date(Date.now() + (i - 1) * 86_400_000).toISOString().slice(0, 10));
      const files = await Promise.all(days.map(async (d) => { const r = await raw(`atp/${d}.json`, 'cotes-tennis'); return r.ok ? [d, await r.json()] as const : undefined; }));
      const [s, p, { live, planned }] = await Promise.all([raw('tennis/index.json', 'resultats'), raw('players.json', 'cotes-tennis'), espn()]);
      // Score vu du joueur « domicile » de la fiche de cotes : jeux de chacun par set, vainqueur.
      const score = (home: string, away: string) => {
        const l = live.get([key(home), key(away)].sort().join('|'));
        if (!l) return undefined;
        const h = l.players.find((x) => x.key === key(home)), a = l.players.find((x) => x.key === key(away));
        if (!h || !a) return undefined;
        return { state: l.state, ended: l.ended, detail: l.detail, home: h.sets, away: a.sets, winner: h.winner ? 'home' : a.winner ? 'away' : undefined };
      };
      // Un match relevé d'abord sur ESPN (fiche sans cote, peut-être déjà simulée sous cet identifiant) puis coté par
      // Pinnacle : on garde la fiche ESPN, avec la cote Pinnacle.
      for (const f of files) {
        if (!f) continue;
        const list = Object.values(f[1] as Record<string, any>);
        for (const m of list.filter((x) => x.source === 'espn')) {
          const twin = list.find((x) => x.source !== 'espn' && x.last?.ml && [key(x.home), key(x.away)].sort().join('|') === [key(m.home), key(m.away)].sort().join('|'));
          if (!twin) continue;
          if (!m.last?.ml) Object.assign(m, { first: twin.first, last: twin.last, moves: twin.moves });
          delete (f[1] as Record<string, any>)[twin.id];
        }
      }
      const matches: any[] = files.flatMap((f) => (f ? Object.values(f[1] as Record<string, any>).map((m) => ({ id: String(m.id), day: f[0], league: m.league, start: m.start, home: m.home, away: m.away, odds: m.last, oddsOpen: m.first, live: score(m.home, m.away), noOdds: !m.last?.ml })) : []));
      // Matchs programmés pas encore relevés par la collecte (fiche sans cote) : nom de tournoi repris des fiches cotées du
      // même tournoi quand il y en a ; simulés avec le moteur seul (tennisfixtures.ts crée la fiche avant la simulation).
      const seen = new Set(matches.map((m) => [key(m.home), key(m.away)].sort().join('|')));
      const tourney = new Map<string, string>();
      for (const m of planned) {
        const twin = matches.find((x) => [key(x.home), key(x.away)].some((k) => k === key(m.home) || k === key(m.away)) && Math.abs(Date.parse(x.start) - Date.parse(m.start)) < 7 * 86_400_000);
        if (twin && !tourney.has(m.event)) tourney.set(m.event, twin.league.split(' - ')[0]);
      }
      const last = days.at(-1)!;
      for (const m of planned) {
        const day = m.start.slice(0, 10);
        if (seen.has([key(m.home), key(m.away)].sort().join('|')) || day < days[0] || day > last) continue;
        const league = `${tourney.get(m.event) ?? `ATP ${m.event}`}${m.round ? ` - ${m.round}` : ''}`;
        matches.push({ id: m.id, day, league, start: m.start, home: m.home, away: m.away, noOdds: true });
      }
      // Programme qui a changé avant le match : match décalé (même paire sur deux fiches) ou adversaire remplacé (forfait
      // avant le début, repêché). On garde la fiche que le tableau ESPN annonce encore ; les fiches commencées restent.
      const pk = (m: any) => [key(m.home), key(m.away)].sort().join('|');
      const espnStart = new Map<string, string>([...planned.map((m) => [pk(m), m.start] as [string, string])]);
      const notStarted = (m: any) => !m.live || m.live.state === 'pre';
      const tour = (m: any) => String(m.league ?? '').split(' - ')[0];
      const drop = new Set<any>();
      // 1) Même paire en double, pas commencée : celle à l'heure d'ESPN, sinon la plus tardive.
      const byPair = new Map<string, any[]>();
      for (const m of matches) if (notStarted(m)) byPair.set(pk(m), [...(byPair.get(pk(m)) ?? []), m]);
      for (const [k, l] of byPair) {
        if (l.length < 2) continue;
        const at = espnStart.get(k);
        const keep = (at && l.find((m) => Math.abs(Date.parse(m.start) - Date.parse(at)) < 3 * 3_600_000)) ?? [...l].sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
        for (const m of l) if (m !== keep) drop.add(m);
      }
      // 2) Un joueur dans deux matchs pas commencés du même tournoi à moins de 36 h : son adversaire a changé. On garde
      //    celui qu'ESPN annonce ; si ESPN ne tranche pas (indisponible), on ne retire rien.
      const byPlayer = new Map<string, any[]>();
      for (const m of matches) if (notStarted(m) && !drop.has(m)) for (const n of [m.home, m.away]) byPlayer.set(`${key(n)}|${tour(m)}`, [...(byPlayer.get(`${key(n)}|${tour(m)}`) ?? []), m]);
      for (const l of byPlayer.values()) {
        if (l.length < 2) continue;
        const close = l.filter((m) => l.some((o) => o !== m && Math.abs(Date.parse(o.start) - Date.parse(m.start)) < 36 * 3_600_000));
        const listed = close.filter((m) => espnStart.has(pk(m)));
        if (listed.length >= 1 && listed.length < close.length) for (const m of close) if (!listed.includes(m)) drop.add(m);
      }
      const shown = matches.filter((m) => !drop.has(m));
      return Response.json({ matches: shown, sims: s.ok ? await s.json() : [], players: p.ok ? await p.json() : {} }, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
    }
    if (q.get('bilan')) {
      const b = await raw('tennis/bilan.json', 'resultats');
      if (!b.ok) return Response.json({ games: 0 }, { headers: noStore });
      const j = await b.json();
      await refreshBilan('bilan-tennis.yml', j.at);
      return Response.json(j, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
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
    if (run.status === 'completed') return Response.json({ status: run.conclusion === 'success' ? 'running' : 'failed', url: run.html_url }, { headers: noStore });
    return Response.json({ status: run.status === 'queued' ? 'queued' : 'running', startedAt: run.run_started_at, url: run.html_url }, { headers: noStore });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const body = raw && typeof raw === 'object' ? raw : {};
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
