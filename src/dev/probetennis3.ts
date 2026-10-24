// Sonde tennis n° 3 : format des fichiers TennisMyLife (colonnes, dates, identifiants) pour compléter l'historique
// Sackmann après mai 2026.
//   node src/dev/probetennis3.ts
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };
for (const u of ['https://stats.tennismylife.org/data/2026.csv', 'https://stats.tennismylife.org/data/ongoing_tourneys.csv', 'https://stats.tennismylife.org/data/challenger_ongoing_tourneys.csv', 'https://stats.tennismylife.org/data/2025.csv']) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15_000) });
    const t = await r.text();
    const lines = t.trim().split('\n');
    console.log(`\n${r.status} ${t.length} o ${lines.length - 1} lignes  ${u}`);
    console.log('  colonnes :', lines[0]);
    console.log('  2e ligne :', lines[1]);
    console.log('  dernière :', lines.at(-1));
    const H = lines[0].split(','), di = H.indexOf('tourney_date'), li = H.indexOf('tourney_level');
    if (di >= 0) { const d = lines.slice(1).map((l) => l.split(',')[di]).sort(); console.log('  dates :', d[0], '->', d.at(-1)); }
    if (li >= 0) { const c: Record<string, number> = {}; for (const l of lines.slice(1)) { const k = l.split(',')[li]; c[k] = (c[k] ?? 0) + 1; } console.log('  niveaux :', JSON.stringify(c)); }
  } catch (e) {
    console.log(`NON ${(e as Error).message} ${u}`);
  }
}
