// Sonde : contenu brut du fichier des compositions NBA.com d'un jour (PROBE_EXTRA = AAAAMMJJ), pour vérifier
// comment distinguer les titulaires des remplaçants.
const d = (process.env.PROBE_EXTRA ?? '').trim() || new Date().toISOString().slice(0, 10).replaceAll('-', '');
const r = await fetch(`https://stats.nba.com/js/data/leaders/00_daily_lineups_${d}.json`, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.nba.com/' } });
console.log('statut', r.status);
const j: any = await r.json();
for (const g of (j.games ?? []).slice(0, 3)) {
  for (const t of [g.homeTeam, g.awayTeam]) {
    console.log(`== ${g.gameId} ${t.teamAbbreviation} (${t.players?.length} joueurs)`);
    for (const p of t.players ?? []) console.log('  ', JSON.stringify(p));
  }
}
