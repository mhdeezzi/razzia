// Sonde tennis (ATP) : quelles sources répondent depuis GitHub Actions, et ce qu'elles contiennent (dates couvertes,
// colonnes, cotes, photos). Rapide : chaque requête est coupée à 12 s.
//   node src/dev/probetennis.ts
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', Accept: '*/*' };
const today = new Date().toISOString().slice(0, 10);

async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; ms: number } | undefined> {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(12_000) });
    const body = await res.text();
    console.log(`${res.ok ? 'OK ' : 'NON'} ${res.status} ${Date.now() - t} ms ${body.length} o  ${url}`);
    return { status: res.status, body, ms: Date.now() - t };
  } catch (e) {
    console.log(`NON ${(e as Error).name} ${Date.now() - t} ms  ${url}`);
    return undefined;
  }
}
const json = (s?: string) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };
const show = (label: string, v: unknown) => console.log(`   ${label} : ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 900));

console.log('\n=== Historique des matchs (Jeff Sackmann, GitHub) ===');
for (const y of [2024, 2025, 2026]) {
  const r = await get(`https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_${y}.csv`);
  if (r?.status === 200) {
    const lines = r.body.trim().split('\n');
    const head = lines[0].split(',');
    const di = head.indexOf('tourney_date');
    const dates = lines.slice(1).map((l) => l.split(',')[di]).sort();
    show(`${y}`, `${lines.length - 1} matchs, du ${dates[0]} au ${dates.at(-1)}`);
    if (y === 2024) show('colonnes', head.join(','));
  }
}
const rk = await get('https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_rankings_current.csv');
if (rk?.status === 200) show('dernier classement', rk.body.trim().split('\n').slice(1).map((l) => l.split(',')[0]).sort().at(-1));
for (const repo of ['tennis_atp', 'tennis_MatchChartingProject', 'tennis_pointbypoint']) {
  const c = await get(`https://api.github.com/repos/JeffSackmann/${repo}/commits?per_page=1`, { Accept: 'application/vnd.github+json' });
  const j = json(c?.body);
  if (Array.isArray(j)) show(`${repo} dernière mise à jour`, j[0]?.commit?.committer?.date);
}
const mcp = await get('https://api.github.com/repos/JeffSackmann/tennis_MatchChartingProject/contents', { Accept: 'application/vnd.github+json' });
const files = json(mcp?.body);
if (Array.isArray(files)) show('fichiers du Match Charting Project', files.map((f: any) => `${f.name} (${Math.round(f.size / 1e6)} Mo)`).join(', '));
const cm = await get('https://raw.githubusercontent.com/JeffSackmann/tennis_MatchChartingProject/master/charting-m-matches.csv');
if (cm?.status === 200) {
  const lines = cm.body.trim().split('\n');
  const recent = lines.filter((l) => /^(2024|2025|2026)/.test(l)).length;
  show('matchs ATP décrits coup par coup', `${lines.length - 1} au total, ${recent} depuis 2024 ; exemple : ${lines.at(-1)}`);
}

console.log('\n=== Cotes historiques (tennis-data.co.uk) ===');
for (const y of [2024, 2025, 2026]) await get(`http://www.tennis-data.co.uk/${y}/${y}.xlsx`);
const td = await get('http://www.tennis-data.co.uk/alldata.php');
if (td?.status === 200) show('liens', [...td.body.matchAll(/href="([^"]*20(?:2[4-6])[^"]*)"/g)].map((m) => m[1]).join(' '));

console.log('\n=== Programme, résultats, photos (ESPN) ===');
const sb = await get('https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard');
const S = json(sb?.body);
if (S) {
  const evs = S.events ?? [];
  show('tournois', evs.map((e: any) => `${e.name} (${e.date?.slice(0, 10)})`).join(' | '));
  const comps = evs.flatMap((e: any) => (e.groupings ?? []).flatMap((g: any) => g.competitions ?? []).concat(e.competitions ?? []));
  show('matchs listés', comps.length);
  const c = comps.find((x: any) => x.competitors?.length === 2);
  if (c) {
    show('exemple de match', { date: c.date, round: c.round?.displayName, status: c.status?.type?.description, venue: c.venue?.fullName, odds: c.odds ?? null, players: c.competitors.map((p: any) => ({ id: p.id ?? p.athlete?.id, name: p.athlete?.displayName, flag: p.athlete?.flag?.alt, headshot: p.athlete?.headshot, seed: p.seed, score: p.linescores?.map((l: any) => l.value) })) });
    const id = c.competitors[0]?.athlete?.id ?? c.competitors[0]?.id;
    if (id) await get(`https://a.espncdn.com/i/headshots/tennis/players/full/${id}.png`);
  }
  show('le mot « odds » apparaît', (sb?.body.match(/"odds"/g) ?? []).length + ' fois');
}

console.log('\n=== Cotes des matchs à venir (sources gratuites) ===');
// Kambi : l'offre publique d'Unibet France (sans clé).
const kb = await get('https://eu-offering-api.kambicdn.com/offering/v2018/ubfr/listView/tennis/atp.json?lang=fr_FR&market=FR&client_id=2&channel_id=1&ncid=1&useCombined=true');
const K = json(kb?.body);
if (K?.events) {
  show('matchs ATP avec cotes (Unibet)', K.events.length);
  const e = K.events.find((x: any) => x.betOffers?.length);
  if (e) show('exemple', { match: e.event?.name, debut: e.event?.start, tournoi: e.event?.group, cotes: e.betOffers[0]?.outcomes?.map((o: any) => `${o.participant ?? o.label} ${o.odds / 1000}`) });
}
const sf = await get(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${today}`);
const SF = json(sf?.body);
if (SF?.events) show('Sofascore : matchs du jour', `${SF.events.length} (dont ATP : ${SF.events.filter((e: any) => /ATP/.test(e.tournament?.category?.name ?? '')).length})`);
await get(`https://api.sofascore.com/api/v1/sport/tennis/odds/1/${today}`);
await get('https://guest.api.arcadia.pinnacle.com/0.1/sports/33/matchups?withSpecials=false');

console.log('\n=== Autres (classements Elo, site ATP, photos libres) ===');
const ta = await get('https://tennisabstract.com/reports/atp_elo_ratings.html');
if (ta?.status === 200) show('Elo Tennis Abstract (extrait)', ta.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(ta.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').indexOf('Rank'), ta.body.length).slice(0, 400));
await get('https://www.atptour.com/en/rankings/singles');
await get('https://www.atptour.com/-/media/alias/player-headshot/s0ag');
const wk = await get('https://en.wikipedia.org/w/api.php?action=query&titles=Jannik_Sinner&prop=pageimages&format=json&pithumbsize=400');
const W = json(wk?.body);
if (W) show('photo Wikipédia', Object.values(W.query?.pages ?? {}).map((p: any) => p.thumbnail?.source));
