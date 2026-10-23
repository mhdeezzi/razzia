// Sonde tennis n° 2 : copies de l'historique Sackmann, TennisMyLife, cotes Pinnacle en détail, historique et
// statistiques de match chez ESPN. Rapide : chaque requête est coupée à 12 s.
//   node src/dev/probetennis2.ts
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', Accept: 'text/html,application/json,*/*', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' };
async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string } | undefined> {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(12_000) });
    const body = await res.text();
    console.log(`${res.ok ? 'OK ' : 'NON'} ${res.status} ${Date.now() - t} ms ${body.length} o  ${url}`);
    return { status: res.status, body };
  } catch (e) {
    console.log(`NON ${(e as Error).name} ${Date.now() - t} ms  ${url}`);
    return undefined;
  }
}
const json = (s?: string) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };
const show = (label: string, v: unknown) => console.log(`   ${label} : ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 1200));
const GH = { Accept: 'application/vnd.github+json' };

console.log('\n=== Copie de l\'historique Sackmann ===');
const ar = json((await get('https://api.github.com/repos/Aneeshers/tennis-sackmann-archive', GH))?.body);
if (ar) show('dépôt', { branche: ar.default_branch, maj: ar.pushed_at, taille: ar.size });
const top = json((await get('https://api.github.com/repos/Aneeshers/tennis-sackmann-archive/contents', GH))?.body);
if (Array.isArray(top)) show('dossiers', top.map((f: any) => f.name).join(', '));
for (const d of Array.isArray(top) ? top.filter((f: any) => f.type === 'dir' && /atp/i.test(f.name)) : []) {
  const sub = json((await get(`https://api.github.com/repos/Aneeshers/tennis-sackmann-archive/contents/${d.path}`, GH))?.body);
  if (!Array.isArray(sub)) continue;
  const names = sub.map((f: any) => f.name);
  show(`${d.path} (${names.length} fichiers)`, names.filter((n: string) => /202[3-6]|current|players/.test(n)).join(', '));
  for (const n of names.filter((x: string) => /^atp_matches_202[456]\.csv$/.test(x))) {
    const f = await get(`https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/${ar?.default_branch ?? 'main'}/${d.path}/${n}`);
    if (f?.status === 200) {
      const lines = f.body.trim().split('\n'), head = lines[0].split(','), di = head.indexOf('tourney_date');
      const dates = lines.slice(1).map((l) => l.split(',')[di]).sort();
      show(n, `${lines.length - 1} matchs du ${dates[0]} au ${dates.at(-1)} ; colonnes : ${head.length}`);
      if (n.endsWith('2025.csv')) show('ligne exemple', lines[1]);
    }
  }
}

console.log('\n=== TennisMyLife ===');
const tml = await get('https://stats.tennismylife.org/tennis-match-database');
if (tml?.status === 200) show('liens de téléchargement', [...tml.body.matchAll(/href="([^"]+\.(?:csv|zip|xlsx)[^"]*)"/g)].map((m) => m[1]).slice(0, 30).join(' '));
const tmlGh = json((await get('https://api.github.com/repos/Tennismylife/TML-Database/contents', GH))?.body);
if (Array.isArray(tmlGh)) show('TML-Database (GitHub)', tmlGh.map((f: any) => f.name).filter((n: string) => /202|ongoing|player/i.test(n)).join(', '));

console.log('\n=== Cotes historiques ===');
for (const u of ['https://www.tennis-data.co.uk/2025/2025.xlsx', 'https://www.tennis-data.co.uk/data.php', 'http://tennis-data.co.uk/2025/2025.xlsx']) await get(u);

console.log('\n=== Pinnacle (cotes à venir) ===');
const mu = json((await get('https://guest.api.arcadia.pinnacle.com/0.1/sports/33/matchups?withSpecials=false'))?.body);
if (Array.isArray(mu)) {
  const leagues: Record<string, number> = {};
  for (const m of mu) leagues[m.league?.name ?? '?'] = (leagues[m.league?.name ?? '?'] ?? 0) + 1;
  show('tournois', Object.entries(leagues).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${v}`).join(' | '));
  const atp = mu.find((m: any) => /^ATP/.test(m.league?.name ?? '') && !/Challenger|Doubles/i.test(m.league?.name ?? '') && m.participants?.length === 2);
  if (atp) show('exemple ATP', { id: atp.id, tournoi: atp.league?.name, debut: atp.startTime, joueurs: atp.participants.map((p: any) => p.name), type: atp.type, units: atp.units });
  const mk = json((await get('https://guest.api.arcadia.pinnacle.com/0.1/sports/33/markets/straight?primaryOnly=false&withSpecials=false'))?.body);
  if (Array.isArray(mk) && atp) {
    const own = mk.filter((x: any) => x.matchupId === atp.id);
    show('marchés de ce match', own.map((x: any) => ({ type: x.type, period: x.period, prix: x.prices?.map((p: any) => `${p.designation ?? p.participantId}${p.points != null ? ' ' + p.points : ''} ${p.price}`) })));
    show('types de marchés (tous matchs)', [...new Set(mk.map((x: any) => `${x.type}/p${x.period}`))].join(' '));
  }
}

console.log('\n=== ESPN : historique, statistiques de match, joueurs ===');
const old = json((await get('https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=20250120'))?.body);
if (old) {
  const comps = (old.events ?? []).flatMap((e: any) => (e.groupings ?? []).flatMap((g: any) => (g.competitions ?? []).map((c: any) => ({ ...c, ev: e.id, grp: g.grouping?.displayName }))));
  show('20/01/2025', `${(old.events ?? []).map((e: any) => e.name).join(' | ')} ; ${comps.length} matchs ; groupes : ${[...new Set(comps.map((c: any) => c.grp))].join(', ')}`);
  const c = comps.find((x: any) => x.grp === "Men's Singles" && x.status?.type?.completed) ?? comps[0];
  if (c) {
    show('match', { ev: c.ev, id: c.id, round: c.round?.displayName, joueurs: c.competitors?.map((p: any) => `${p.athlete?.displayName} (${p.athlete?.id ?? p.id}) ${p.linescores?.map((l: any) => l.value).join('-')}`) });
    const sum = json((await get(`https://site.api.espn.com/apis/site/v2/sports/tennis/atp/summary?event=${c.id}`))?.body);
    if (sum) show('summary : clés', Object.keys(sum).join(', '));
    const cs = json((await get(`https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/${c.ev}/competitions/${c.id}/competitors/${c.competitors?.[0]?.id}/statistics`))?.body);
    if (cs) show('statistiques du joueur', JSON.stringify(cs).slice(0, 900));
    const ath = json((await get(`https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/athletes/${c.competitors?.[0]?.athlete?.id ?? c.competitors?.[0]?.id}`))?.body);
    if (ath) show('fiche joueur', { nom: ath.displayName, naissance: ath.birthPlace, main: ath.hand, taille: ath.displayHeight, pays: ath.flag?.alt ?? ath.citizenship, photo: ath.headshot?.href });
  }
}
const now = json((await get('https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard'))?.body);
const top1 = (now?.events ?? []).flatMap((e: any) => (e.groupings ?? []).flatMap((g: any) => g.competitions ?? [])).flatMap((c: any) => c.competitors ?? []).sort((a: any, b: any) => (+(a.seed ?? 99)) - (+(b.seed ?? 99)))[0];
if (top1) { show('tête de série n° 1 cette semaine', `${top1.athlete?.displayName} (${top1.athlete?.id})`); await get(`https://a.espncdn.com/i/headshots/tennis/players/full/${top1.athlete?.id}.png`); }
