// Tennis : retour de longue absence (plus de 90 jours). Rejoue tous les matchs dans l'ordre et mesure l'erreur du
// moteur selon le poids du facteur « retour en cours » (2e au 10e match) et l'accélération de l'Elo pendant le retour.
//   node src/dev/tenniscomeback.ts
import { loadHistory } from '../tennis/data.ts';
import { nameKey } from '../tennis/history.ts';
import { Ratings, DEFAULT_RATING } from '../tennis/ratings.ts';
import { blend, engineProb, WEIGHTS } from '../tennis/engine.ts';

const history = await loadHistory('data/cache/tennis/tml', 2015);
const grid: Array<[number, number]> = [[0, 1], [0.15, 1], [0.25, 1], [0.35, 1], [0.5, 1]];
for (const [w, k] of grid) {
  WEIGHTS.comeback = w;
  const R = new Ratings({ ...DEFAULT_RATING, comebackK: k });
  const acc = { all: { n: 0, ll: 0, ok: 0 }, cb: { n: 0, ll: 0, ok: 0 }, apprentissage: { n: 0, ll: 0, ok: 0 } };
  for (const m of history) {
    if (m.date >= '2016-01-01' && !m.walkover && !m.retired) {
      const a = R.snapshot(m.w.id, m), b = R.snapshot(m.l.id, m);
      const p = Math.min(0.99, Math.max(0.01, engineProb(R, a, b, m.surface, m.bo).p));
      // Réglage choisi sur 2016-2023 (apprentissage), vérifié sur 2024-2026 (tout, joueurs en retour).
      const cb = a.comeback > 0 || b.comeback > 0;
      const keys = m.date < '2024-01-01' ? (cb ? [acc.apprentissage] : []) : [acc.all, ...(cb ? [acc.cb] : [])];
      for (const x of keys) { x.n++; x.ll -= Math.log(p); x.ok += p > 0.5 ? 1 : 0; }
    }
    R.update(m);
  }
  const f = (x: { n: number; ll: number; ok: number }) => `${(x.ll / x.n).toFixed(4)} / ${((x.ok / x.n) * 100).toFixed(1)} % (${x.n})`;
  // Rune - Vacherot, Bâle, 30 octobre 2026 (une victoire de Vacherot en confrontation, marché Rune 57,4 %).
  const m = { date: '2026-10-30', surface: 'Hard' as const, tid: 'basel-2026' };
  const ru = R.snapshot(nameKey('Holger Rune'), m), va = R.snapshot(nameKey('Valentin Vacherot'), m);
  const e = engineProb(R, ru, va, 'Hard', 3, { a: 0, b: 1 }).p;
  console.log(`retour ${w}`.padEnd(12), `apprentissage ${f(acc.apprentissage)} | 2024-26 tout ${f(acc.all)} | joueurs en retour ${f(acc.cb)} | Rune moteur ${(e * 100).toFixed(1)} %, affiché ${(blend(e, 0.5737) * 100).toFixed(1)} % (retour Rune ${ru.comeback.toFixed(2)})`);
}
