// Tennis : ce que le marché rate. Pour chaque match du circuit 2024-2026 relié aux cotes Pinnacle, écrit le marché, le
// moteur et l'état des deux joueurs (forme, exploits, défaites surprises, classement, retour de blessure) ; l'analyse se
// fait ensuite sur ce fichier (apprendre sur 2024, vérifier sur 2025-2026).
//   node src/dev/tennisedge.ts <sortie.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { loadHistory } from '../tennis/data.ts';
import type { Match } from '../tennis/history.ts';
import { Ratings } from '../tennis/ratings.ts';
import { engineProb } from '../tennis/engine.ts';

type TD = { Date: string; Winner: string; Loser: string; PSW?: number; PSL?: number; Series: string; WRank?: number; LRank?: number };
const td = (JSON.parse(readFileSync('data/cache/tennis/tennisdata/td.json', 'utf8')) as TD[]).filter((r) => r.PSW && r.PSL);
const norm = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-'.]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const short = (full: string) => { const p = norm(full).split(' '); return `${p.slice(1).join(' ')} ${p[0][0]}`; };
const odds = new Map<string, TD[]>();
for (const r of td) { const k = `${norm(r.Winner)}|${norm(r.Loser)}`; (odds.get(k) ?? odds.set(k, []).get(k)!).push(r); }

// Journal par joueur : résultat, probabilité Elo d'avant-match, classement de l'adversaire.
type Log = { date: string; won: boolean; pElo: number; oppRank: number; oppStreak: number; oppW5: number; oppElo: number };
const logs = new Map<string, Log[]>();
const feats = (id: string, date: string) => {
  const L = logs.get(id) ?? []; // seulement les matchs déjà joués : le journal est complété après chaque match
  const l10 = L.slice(-10), l20 = L.slice(-20), l5 = L.slice(-5);
  let streak = 0;
  for (let i = L.length - 1; i >= 0; i--) { if (L[i].won) streak++; else break; }
  return {
    w5: l5.filter((x) => x.won).length,
    w10: l10.filter((x) => x.won).length,
    n10: l10.length,
    streak,
    exploits: l10.filter((x) => x.won && x.pElo < 0.45).length, // victoires en outsider
    surprises: l20.filter((x) => !x.won && x.pElo > 0.55 && x.oppRank > 30).length, // défaites en favori contre des non-stars
    fav20: l20.filter((x) => x.pElo > 0.55).length,
    res10: l10.reduce((s, x) => s + (x.won ? 1 : 0) - x.pElo, 0),
    // L'exploit : dernier match gagné contre un joueur en pleine série (son état juste avant ce match).
    last: L.length ? { won: L[L.length - 1].won, date: L[L.length - 1].date, oppRank: L[L.length - 1].oppRank, oppStreak: L[L.length - 1].oppStreak, oppW5: L[L.length - 1].oppW5, oppElo: L[L.length - 1].oppElo, pElo: L[L.length - 1].pElo } : null,
    prev: L.length > 1 ? { won: L[L.length - 2].won, oppStreak: L[L.length - 2].oppStreak, oppRank: L[L.length - 2].oppRank, pElo: L[L.length - 2].pElo } : null,
  };
};

const history = await loadHistory('data/cache/tennis/tml', 2015);
const R = new Ratings();
const out: unknown[] = [];
const snapRow = (m: Pick<Match, 'date' | 'surface' | 'tid'> & { bo: 3 | 5 }, aId: string, bId: string, pmA: number, extra: Record<string, unknown>) => {
  const a = R.snapshot(aId, m), b = R.snapshot(bId, m);
  const pe = engineProb(R, a, b, m.surface, m.bo).p;
  return { ...extra, pm: pmA, pe, pElo: R.eloProb(a, b), rankA: a.rank ?? 1500, rankB: b.rank ?? 1500, cbA: a.comeback, cbB: b.comeback, eloA: a.elo, eloB: b.elo, fA: feats(aId, m.date), fB: feats(bId, m.date), daysA: a.daysOff, daysB: b.daysOff };
};
for (const m of history) {
  if (m.date >= '2024-01-01' && !m.walkover && !m.retired && m.level !== 'C' && !m.qual) {
    const c = odds.get(`${short(m.w.name)}|${short(m.l.name)}`)?.find((r) => Math.abs(Date.parse(r.Date) - Date.parse(m.date)) < 12 * 86_400_000);
    if (c) {
      const pw = (1 / c.PSW!) / (1 / c.PSW! + 1 / c.PSL!);
      // A = favori du marché.
      const [aId, bId, pmA, y] = pw >= 0.5 ? [m.w.id, m.l.id, pw, 1] : [m.l.id, m.w.id, 1 - pw, 0];
      out.push(snapRow(m, aId, bId, pmA, { date: m.date, y, series: c.Series, round: m.round, a: aId, b: bId }));
    }
  }
  // Journal mis à jour avec la probabilité Elo d'avant-match.
  if (!m.walkover) {
    const a = R.snapshot(m.w.id, m), b = R.snapshot(m.l.id, m), p = R.eloProb(a, b);
    const fw = feats(m.w.id, m.date), fl = feats(m.l.id, m.date);
    (logs.get(m.w.id) ?? logs.set(m.w.id, []).get(m.w.id)!).push({ date: m.date, won: true, pElo: p, oppRank: m.l.rank ?? 1500, oppStreak: fl.streak, oppW5: fl.w5, oppElo: b.elo });
    (logs.get(m.l.id) ?? logs.set(m.l.id, []).get(m.l.id)!).push({ date: m.date, won: false, pElo: 1 - p, oppRank: m.w.rank ?? 1500, oppStreak: fw.streak, oppW5: fw.w5, oppElo: a.elo });
  }
  R.update(m);
}
// Rune - Vacherot, Bâle, 30 octobre 2026 (marché Rune 57,4 %).
const ru = 'holger rune', va = 'valentin vacherot';
const ids = [...R.S.keys()].filter((k) => k.includes('rune') || k.includes('vacherot'));
const find = (s: string) => ids.find((k) => k.includes(s))!;
out.push(snapRow({ date: '2026-10-30', surface: 'Hard', tid: 'basel', bo: 3 }, find('rune'), find('vacherot'), 0.5737, { date: '2026-10-30', y: null, series: 'ATP500', round: 'QF', a: ru, b: va, cible: true }));
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(`${out.length} lignes`, ids);
