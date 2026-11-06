// Programme foot des prochains jours (hier à J+7) pour l'app : matchs affichés seulement (src/foot/picks.ts), avec les
// cotes du moment (football-data, matchs de championnat) quand elles sont publiées.
//   node src/cli/footslate.ts <fichier de sortie>
import { writeFileSync } from 'node:fs';
import { FD_CODE, fdDate, fdTeamId, loadGames, parseCsv, type Odds } from '../foot/data.ts';
import { fixtures, LEAGUES } from '../foot/fotmob.ts';
import { shown, SHOWN_LEAGUES } from '../foot/picks.ts';

export interface SlateFoot {
  id: string; lg: number; league: string; round?: string; start: string;
  home: { id: number; name: string }; away: { id: number; name: string };
  state: 'pre' | 'in' | 'post'; score?: [number, number]; odds?: Odds;
}

const out = process.argv[2] ?? 'slate.json';
loadGames(); // noms football-data -> équipes FotMob
const odds = new Map<string, Odds>();
try {
  const r = await fetch('https://football-data.co.uk/fixtures.csv', { signal: AbortSignal.timeout(30_000) });
  for (const x of parseCsv(await r.text())) {
    const lg = Number(Object.entries(FD_CODE).find(([, c]) => c === x.Div)?.[0]);
    const h = lg && fdTeamId(lg, x.HomeTeam), a = lg && fdTeamId(lg, x.AwayTeam);
    const o = (k: string) => { const v = Number(x[k]); return v > 1 ? v : undefined; };
    const H = o('PSH') ?? o('AvgH'), D = o('PSD') ?? o('AvgD'), A = o('PSA') ?? o('AvgA');
    if (h && a && H && D && A) odds.set(`${h}|${a}|${fdDate(x.Date)}`, { h: H, d: D, a: A, over25: o('P>2.5') ?? o('Avg>2.5'), under25: o('P<2.5') ?? o('Avg<2.5'), src: o('PSH') ? 'pinnacle' : 'moyenne' });
  }
} catch (e) { console.log('cotes du moment indisponibles', String(e).slice(0, 100)); }
const now = Date.now(), from = now - 36 * 3600e3, to = now + 8 * 864e5;
const y = new Date().getUTCFullYear(), m = new Date().getUTCMonth();
const season = m >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
const list: SlateFoot[] = [];
for (const lg of SHOWN_LEAGUES) {
  const fx = await fixtures(lg, season, true);
  for (const f of fx.matches) {
    const t = Date.parse(f.date);
    if (f.cancelled || !(t > from && t < to) || !shown(f)) continue;
    const day = f.date.slice(0, 10);
    const od = odds.get(`${f.home.id}|${f.away.id}|${day}`) ?? odds.get(`${f.home.id}|${f.away.id}|${new Date(t - 864e5).toISOString().slice(0, 10)}`) ?? odds.get(`${f.home.id}|${f.away.id}|${new Date(t + 864e5).toISOString().slice(0, 10)}`);
    list.push({
      id: f.id, lg, league: LEAGUES.find((l) => l.id === lg)!.name, round: f.round, start: f.date, home: f.home, away: f.away,
      state: f.finished ? 'post' : t < now ? 'in' : 'pre', score: f.score, odds: od,
    });
  }
}
list.sort((a, b) => a.start.localeCompare(b.start));
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), matches: list }));
console.log(`programme foot : ${list.length} matchs (${list.filter((x) => x.odds).length} avec cotes)`);
