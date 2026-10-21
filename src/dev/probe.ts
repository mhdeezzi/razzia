// Teste l'accès à chaque source de données depuis la machine courante (statut HTTP, durée, taille).
//   node src/dev/probe.ts
const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Referer: 'https://www.nba.com/',
  Origin: 'https://www.nba.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};
const URLS = [
  'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json',
  'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json',
  'https://stats.nba.com/stats/leaguedashteamstats?Season=2025-26&SeasonType=Regular%20Season&MeasureType=Base&PerMode=PerGame&LeagueID=00&LastNGames=0&Month=0&OpponentTeamID=0&PaceAdjust=N&Period=0&PlusMinus=N&Rank=N&TeamID=0',
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries',
  'https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1/leagues/42648',
];
let failed = 0;
for (const url of URLS) {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
    const body = await res.text();
    console.log(`${res.ok ? 'OK ' : 'NON'} ${res.status} ${Date.now() - t} ms ${body.length} o  ${new URL(url).host}${new URL(url).pathname}`);
    if (!res.ok) failed++;
  } catch (e) {
    failed++;
    console.log(`NON ${(e as Error).name} ${Date.now() - t} ms  ${new URL(url).host}${new URL(url).pathname}`);
  }
}
console.log(failed ? `${failed} source(s) inaccessible(s).` : 'Toutes les sources répondent.');
