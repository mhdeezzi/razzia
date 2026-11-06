// Chargement des données foot : fiches FotMob (data/cache/foot/m) et cotes football-data.co.uk (data/cache/foot/fd),
// reliées par date et score (les noms d'équipes diffèrent d'une source à l'autre : « Paris Saint-Germain » / « Paris SG »).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FOOT_DIR, LEAGUES, type MatchRec } from './fotmob.ts';

export interface Odds { h: number; d: number; a: number; over25?: number; under25?: number; src: string }
export interface Game extends MatchRec { odds?: Odds; closing?: Odds; key: string }

const FD_CODE: Record<number, string> = { 47: 'E0', 87: 'SP1', 55: 'I1', 54: 'D1', 53: 'F1', 57: 'N1', 61: 'P1', 40: 'B1', 64: 'SC0', 71: 'T1', 135: 'G1' };
const FD_NEW: Record<number, string> = { 38: 'AUT', 69: 'SWZ', 46: 'DNK', 59: 'NOR' };

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0]?.split(',') ?? [];
  return lines.slice(1).map((l) => { const v = l.split(','); return Object.fromEntries(head.map((h, i) => [h, v[i] ?? ''])); });
}
const fdDate = (s: string) => { const m = s.match(/(\d+)\/(\d+)\/(\d+)/); if (!m) return ''; const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
const f = (v: string | undefined) => { const n = Number(v); return Number.isFinite(n) && n > 1 ? n : undefined; };

interface FdRow { lg: number; date: string; home: string; away: string; hg: number; ag: number; odds?: Odds; closing?: Odds }

function loadFd(): FdRow[] {
  const dir = join(FOOT_DIR, 'fd');
  if (!existsSync(dir)) return [];
  const rows: FdRow[] = [];
  const push = (lg: number, r: Record<string, string>, home: string, away: string, hg: string, ag: string) => {
    const date = fdDate(r.Date);
    if (!date || hg === '' || ag === '') return;
    // Cotes Pinnacle d'avant-match (relevées plusieurs jours avant, comme celles qu'on aurait au moment de simuler),
    // sinon moyenne du marché ; cotes de clôture à part (pour mesurer, jamais pour prédire).
    const pre = f(r.PSH) && f(r.PSD) && f(r.PSA) ? { h: f(r.PSH)!, d: f(r.PSD)!, a: f(r.PSA)!, over25: f(r['P>2.5']), under25: f(r['P<2.5']), src: 'pinnacle' }
      : f(r.AvgH) && f(r.AvgD) && f(r.AvgA) ? { h: f(r.AvgH)!, d: f(r.AvgD)!, a: f(r.AvgA)!, over25: f(r['Avg>2.5']), under25: f(r['Avg<2.5']), src: 'moyenne' }
      : f(r.B365H) && f(r.B365D) && f(r.B365A) ? { h: f(r.B365H)!, d: f(r.B365D)!, a: f(r.B365A)!, over25: f(r['B365>2.5']), under25: f(r['B365<2.5']), src: 'bet365' } : undefined;
    const close = f(r.PSCH) && f(r.PSCD) && f(r.PSCA) ? { h: f(r.PSCH)!, d: f(r.PSCD)!, a: f(r.PSCA)!, over25: f(r['PC>2.5']), under25: f(r['PC<2.5']), src: 'pinnacle-cloture' }
      : f(r.AvgCH) && f(r.AvgCD) && f(r.AvgCA) ? { h: f(r.AvgCH)!, d: f(r.AvgCD)!, a: f(r.AvgCA)!, over25: f(r['AvgC>2.5']), under25: f(r['AvgC<2.5']), src: 'moyenne-cloture' } : undefined;
    rows.push({ lg, date, home, away, hg: Number(hg), ag: Number(ag), odds: pre, closing: close });
  };
  for (const file of readdirSync(dir)) {
    const text = readFileSync(join(dir, file), 'utf8');
    if (text.startsWith('<')) continue;
    const code = file.replace(/\.csv$/, '').split('_')[0];
    const lg = Number(Object.entries(FD_CODE).find(([, c]) => c === code)?.[0] ?? Object.entries(FD_NEW).find(([, c]) => c === code)?.[0]);
    if (!lg) continue;
    for (const r of parseCsv(text)) {
      if (r.HomeTeam) push(lg, r, r.HomeTeam, r.AwayTeam, r.FTHG, r.FTAG);
      else if (r.Home) push(lg, r, r.Home, r.Away, r.HG, r.AG);
    }
  }
  return rows;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(fc|cf|afc|sc|ac|as|ss|ssc|rc|rcd|ud|cd|sv|vfb|vfl|tsg|1\.|fk|sk|bk|if|ogc|losc|stade|real|club|calcio|football|de|la|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const sim = (a: string, b: string) => {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  let inter = 0;
  for (const x of A) if (B.has(x) || [...B].some((y) => (y.length >= 4 && x.startsWith(y)) || (x.length >= 4 && y.startsWith(x)))) inter++;
  return inter / Math.max(1, Math.min(A.size, B.size));
};

let cache: Game[] | undefined;
const fdNames = new Map<string, number>();
/** Équipe FotMob correspondant à un nom football-data dans un championnat (après loadGames). */
export const fdTeamId = (lg: number, name: string) => fdNames.get(`${lg}|${name}`);
export { parseCsv, fdDate, FD_CODE };
/** Tous les matchs joués (fiches FotMob), triés par date, avec leurs cotes quand on les retrouve. */
export function loadGames(): Game[] {
  if (cache) return cache;
  const dir = join(FOOT_DIR, 'm');
  const games: Game[] = existsSync(dir) ? readdirSync(dir).map((fn) => JSON.parse(readFileSync(join(dir, fn), 'utf8')) as Game) : [];
  games.sort((a, b) => a.date.localeCompare(b.date));
  for (const g of games) g.key = g.id;
  // Correspondance des noms : chaque nom football-data est rattaché au nom FotMob avec lequel il partage le plus de
  // matchs (même championnat, même jour à 1 jour près, même score).
  const fd = loadFd();
  const byLgDay = new Map<string, Game[]>();
  for (const g of games) for (const dd of [0]) byLgDay.set(`${g.lg}|${g.date.slice(0, 10)}`, [...(byLgDay.get(`${g.lg}|${g.date.slice(0, 10)}`) ?? []), g]);
  const votes = new Map<string, Map<number, number>>();
  const vote = (lg: number, name: string, id: number, w: number) => {
    const k = `${lg}|${name}`;
    const m = votes.get(k) ?? new Map<number, number>();
    m.set(id, (m.get(id) ?? 0) + w);
    votes.set(k, m);
  };
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  for (const r of fd)
    for (const n of [0, -1, 1])
      for (const g of byLgDay.get(`${r.lg}|${shift(r.date, n)}`) ?? []) {
        if (g.score[0] !== r.hg || g.score[1] !== r.ag) continue;
        const w = (sim(r.home, g.home.name) + sim(r.away, g.away.name)) / 2 + (n === 0 ? 0.5 : 0);
        vote(r.lg, r.home, g.home.id, w);
        vote(r.lg, r.away, g.away.id, w);
      }
  const nameToId = new Map<string, number>();
  for (const [k, m] of votes) { const id = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; nameToId.set(k, id); fdNames.set(k, id); }
  const byKey = new Map<string, Game>();
  for (const g of games) byKey.set(`${g.lg}|${g.home.id}|${g.away.id}|${g.season}`, g);
  let linked = 0;
  for (const r of fd) {
    const h = nameToId.get(`${r.lg}|${r.home}`), a = nameToId.get(`${r.lg}|${r.away}`);
    if (!h || !a) continue;
    // Même affiche, à moins de 4 jours (matchs reportés : la date football-data peut différer).
    const cand = games.filter((g) => g.lg === r.lg && g.home.id === h && g.away.id === a && Math.abs(Date.parse(g.date) - Date.parse(`${r.date}T15:00:00Z`)) < 4 * 864e5);
    const g = cand[0];
    if (!g) continue;
    g.odds = r.odds; g.closing = r.closing; linked++;
  }
  cache = games;
  return games;
}

export const leagueName = (id: number) => LEAGUES.find((l) => l.id === id)?.name ?? String(id);
