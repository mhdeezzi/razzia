// Tennis : les derniers résultats doivent-ils peser plus ? Rejoue tous les matchs dans l'ordre et mesure, sur 2025-2026,
// l'erreur du moteur (log loss, bon vainqueur) selon le K minimal de l'Elo et la vitesse de la note de service.
//   node src/dev/tennisrecency.ts
import { loadHistory } from '../tennis/data.ts';
import { Ratings, DEFAULT_RATING, type RatingParams } from '../tennis/ratings.ts';
import { engineProb } from '../tennis/engine.ts';

const history = await loadHistory('data/cache/tennis/tml', 2015);
const variants: Record<string, Partial<RatingParams>> = {
  actuel: {},
  'K min 20': { kFloor: 20 },
  'K min 28': { kFloor: 28 },
  'K min 36': { kFloor: 36 },
  'service rapide': { serveK: 0.05 },
  'K min 28 + service rapide': { kFloor: 28, serveK: 0.05 },
};
for (const [name, v] of Object.entries(variants)) {
  const R = new Ratings({ ...DEFAULT_RATING, ...v });
  const acc = { all: { n: 0, ll: 0, ok: 0 }, tour: { n: 0, ll: 0, ok: 0 }, y26: { n: 0, ll: 0, ok: 0 } };
  for (const m of history) {
    if (m.date >= '2025-01-01' && !m.walkover && !m.retired) {
      const a = R.snapshot(m.w.id, m), b = R.snapshot(m.l.id, m);
      const p = Math.min(0.99, Math.max(0.01, engineProb(R, a, b, m.surface, m.bo).p));
      for (const k of ['all', ...(m.level !== 'C' && !m.qual ? ['tour'] : []), ...(m.date >= '2026-01-01' ? ['y26'] : [])] as const) {
        const x = acc[k as keyof typeof acc];
        x.n++; x.ll -= Math.log(p); x.ok += p > 0.5 ? 1 : 0;
      }
    }
    R.update(m);
  }
  const f = (x: { n: number; ll: number; ok: number }) => `${(x.ll / x.n).toFixed(4)} / ${((x.ok / x.n) * 100).toFixed(2)} % (${x.n})`;
  console.log(`${name.padEnd(28)} tout ${f(acc.all)} | circuit ${f(acc.tour)} | 2026 ${f(acc.y26)}`);
}
