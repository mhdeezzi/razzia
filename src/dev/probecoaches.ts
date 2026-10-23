// Sonde : changements d'entraîneur en cours de saison (Wikipédia, section « Coaching changes » des pages de saison NBA ;
// Basketball-Reference en secours). Affiche les lignes brutes dans le journal GitHub Actions.
const UA = { 'User-Agent': 'razzia-probe/1.0 (analyse NBA)' };
for (const season of ['2024–25', '2025–26']) {
  const page = encodeURIComponent(`${season} NBA season`.replace(/ /g, '_'));
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=wikitext&format=json&formatversion=2`, { headers: UA });
    const text: string = (await r.json()).parse?.wikitext ?? '';
    const i = text.search(/==+\s*Coaching changes\s*==+/i);
    console.log(`\n=== Wikipédia ${season} (${r.status}) ===`);
    console.log(i >= 0 ? text.slice(i, i + 6000) : 'section introuvable');
  } catch (e) {
    console.log(`Wikipédia ${season} : ${(e as Error).message}`);
  }
}
for (const year of [2025, 2026]) {
  try {
    const r = await fetch(`https://www.basketball-reference.com/leagues/NBA_${year}_coaches.html`, { headers: UA });
    const html = await r.text();
    console.log(`\n=== Basketball-Reference ${year} (${r.status}) ===`);
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<t[hd][^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, k, v]) => `${k}=${v.replace(/<[^>]+>/g, '').trim()}`);
      if (cells.some((c) => c.startsWith('coach='))) console.log(cells.slice(0, 8).join(' | '));
    }
  } catch (e) {
    console.log(`Basketball-Reference ${year} : ${(e as Error).message}`);
  }
}
