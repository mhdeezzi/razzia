// Vérification des données foot : dates, doublons, équipes qui jouent deux fois en deux jours, score contre buts,
// xG, compositions, cotes reliées au bon match, matchs manquants par saison.
import { loadGames } from '../foot/data.ts';
import { LEAGUES } from '../foot/fotmob.ts';

const games = loadGames();
const issues = new Map<string, string[]>();
const flag = (k: string, s: string) => { const a = issues.get(k) ?? []; a.push(s); issues.set(k, a); };
const name = (lg: number) => LEAGUES.find((l) => l.id === lg)?.key ?? lg;
const seen = new Map<string, number>();
for (const g of games) {
  const t = Date.parse(g.date);
  if (!Number.isFinite(t)) flag('date illisible', `${g.id} ${g.date}`);
  const y = Number(g.season.slice(0, 4));
  if (Number.isFinite(t) && (new Date(t).getUTCFullYear() < y || new Date(t).getUTCFullYear() > y + 1)) flag('date hors saison', `${g.id} ${name(g.lg)} ${g.season} ${g.date}`);
  if (t > Date.now()) flag('match « joué » dans le futur', `${g.id} ${g.date}`);
  const k = `${g.home.id}|${g.away.id}|${g.date.slice(0, 10)}`;
  if (seen.has(k)) flag('doublon', `${g.id} ${g.home.name}-${g.away.name} ${g.date}`);
  seen.set(k, 1);
  const goals = g.events.filter((e) => e[0] !== 'R');
  const gh = goals.filter((e) => e[2] === 0).length, ga = goals.filter((e) => e[2] === 1).length;
  if (gh !== g.score[0] || ga !== g.score[1]) flag('score ≠ buts listés', `${g.id} ${name(g.lg)} ${g.home.name}-${g.away.name} score ${g.score} buts ${gh}-${ga}`);
  if (!g.xg) flag('sans xG', `${name(g.lg)} ${g.season}`);
  else {
    const sx = [0, 1].map((s) => g.shots.filter((x) => x[0] === s).reduce((a, x) => a + x[5], 0));
    if (g.shots.length && (Math.abs(sx[0] - g.xg[0]) > 0.35 || Math.abs(sx[1] - g.xg[1]) > 0.35)) flag('xG des tirs ≠ xG du match', `${g.id} ${sx.map((x) => x.toFixed(2))} vs ${g.xg}`);
  }
  for (const s of [0, 1]) {
    const st = g.sides[s]?.starters ?? [];
    if (st.length !== 11) flag('onze incomplet', `${name(g.lg)} ${g.season} ${g.id} (${st.length})`);
    else if (!st.some((p) => p[2] === 11)) flag('onze sans gardien repéré', `${name(g.lg)} ${g.id}`);
  }
  if (g.fdScore && (g.fdScore[0] !== g.score[0] || g.fdScore[1] !== g.score[1])) flag('cotes reliées à un autre score', `${g.id} ${name(g.lg)} ${g.home.name}-${g.away.name} ${g.date.slice(0, 10)} fotmob ${g.score} football-data ${g.fdScore} (${g.fdDate})`);
  if (g.fdDate && Math.abs(Date.parse(`${g.fdDate}T12:00:00Z`) - t) > 1.5 * 864e5) flag('date football-data ≠ FotMob', `${g.id} ${g.date.slice(0, 10)} vs ${g.fdDate}`);
}
// Une équipe qui joue deux fois en moins de 40 h : date fausse ou match en double.
const last = new Map<number, { t: number; id: string }>();
for (const g of games) for (const id of [g.home.id, g.away.id]) {
  const t = Date.parse(g.date), p = last.get(id);
  if (p && t - p.t < 40 * 3600e3) flag('deux matchs en moins de 40 h', `${id} ${p.id} → ${g.id} ${g.date}`);
  last.set(id, { t, id: g.id });
}
// Volume par championnat et saison, et part des matchs reliés à des cotes.
const vol = new Map<string, [number, number, number]>();
for (const g of games) { const k = `${name(g.lg)} ${g.season}`; const v = vol.get(k) ?? [0, 0, 0]; v[0]++; v[1] += g.odds ? 1 : 0; v[2] += g.xg ? 1 : 0; vol.set(k, v); }
for (const [k, v] of [...vol].sort()) console.log(k.padEnd(18), String(v[0]).padStart(4), 'matchs', `${String(v[1]).padStart(4)} avec cotes`, `${String(v[2]).padStart(4)} avec xG`);
for (const [k, a] of issues) console.log(`\n${k} : ${a.length}`, k === 'sans xG' ? '' : '\n  ' + a.slice(0, 6).join('\n  '));
