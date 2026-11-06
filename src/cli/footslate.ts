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
// 20 matchs au plus par jour (heure de Paris). La Ligue des Champions passe toujours (elle peut dépasser 20) ; les matchs
// de championnat complètent jusqu'à 20, les plus suivis d'abord : on écarte les affiches entre petites équipes.
const MAX_DAY = 20;
// Attrait de chaque club (identifiant FotMob) : 3 les géants, 2 les clubs très suivis, 1 les autres.
const POP: Record<number, number> = {
  9847: 3, 8633: 3, 8634: 3, 9823: 3, 8456: 3, 8650: 3, 9825: 3, 8455: 3, 10260: 3, 9885: 3, 8636: 3, 8564: 3,
  9906: 2, 8586: 2, 10261: 2, 9789: 2, 8592: 2, 9875: 2, 8686: 2, 9748: 2, 9829: 2, 10252: 2, 8524: 2, 8639: 2, 10171: 2,
  8302: 2, 8315: 2, 8560: 2, 10205: 2, 8588: 2, 9831: 2, 10267: 2, 9773: 2, 9768: 2, 8637: 2, 8695: 2, 8640: 2, 10235: 2,
  178475: 2, 10269: 2, 9851: 2, 8543: 2,
};
// À attrait égal : Ligue 1, Premier League, LaLiga puis Serie A.
const LG_W: Record<number, number> = { 53: 0.4, 47: 0.35, 87: 0.3, 55: 0.25 };
const pop = (id: number) => POP[id] ?? 1;
const hype = (m: SlateFoot) => pop(m.home.id) + pop(m.away.id) + (pop(m.home.id) >= 2 && pop(m.away.id) >= 2 ? 1 : 0) + (LG_W[m.lg] ?? 0);
const parisDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
const days = new Map<string, SlateFoot[]>();
for (const m of list) days.set(parisDay(m.start), [...(days.get(parisDay(m.start)) ?? []), m]);
const kept: SlateFoot[] = [];
let dropped = 0;
for (const [, ms] of days) {
  const ucl = ms.filter((m) => m.lg === 42);
  const rest = ms.filter((m) => m.lg !== 42).sort((a, b) => hype(b) - hype(a) || a.start.localeCompare(b.start));
  const room = Math.max(0, MAX_DAY - ucl.length);
  kept.push(...ucl, ...rest.slice(0, room));
  dropped += Math.max(0, rest.length - room);
}
kept.sort((a, b) => a.start.localeCompare(b.start));
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), matches: kept }));
console.log(`programme foot : ${kept.length} matchs (${kept.filter((x) => x.odds).length} avec cotes), ${dropped} petits matchs écartés (plus de ${MAX_DAY} par jour)`);
