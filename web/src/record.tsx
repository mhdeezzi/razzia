// Bilan public de Razzia, sous le bandeau des programmes : le pronostic mis en avant par chaque fiche face au résultat,
// depuis le début de la saison. Au basket, les 6 premiers matchs simulés (ancien moteur) ne comptent pas.
import { useEffect, useState } from 'react';
import { Sparkline } from './ui.tsx';

/** Matchs NBA simulés par l'ancien moteur, au tout début de la saison : écartés du bilan. */
const OLD_ENGINE = 6;

interface Row { key: string; won: boolean; sure: boolean }
interface Record { rows: Row[] }

const pct = (v: number) => `${Math.round(v * 100)} %`;

async function nbaRecord(): Promise<Record> {
  const b = await fetch('/api/sim?bilan=1').then((r) => r.json());
  const rows = ((b.rows ?? []) as Array<{ dir: string; date: string; pModel: number; pBlend?: number; pick?: { won: boolean } }>)
    .sort((x, y) => x.date.localeCompare(y.date) || x.dir.localeCompare(y.dir))
    .slice(OLD_ENGINE)
    .filter((r) => r.pick)
    .map((r) => {
      const p = r.pBlend ?? r.pModel;
      return { key: r.dir, won: r.pick!.won, sure: Math.max(p, 1 - p) >= 0.77 };
    });
  return { rows };
}

async function atpRecord(): Promise<Record> {
  const b = await fetch('/api/tennis?bilan=1').then((r) => r.json());
  const rows = ((b.rows ?? []) as Array<{ id: string; day: string; start: string; tier: string; pick: { won: boolean } }>)
    .sort((x, y) => x.start.localeCompare(y.start))
    .map((r) => ({ key: r.id, won: r.pick.won, sure: r.tier === 'sure' }));
  return { rows };
}

/** Bandeau du bilan : pronostics passés, Razzia assuré, courbe de réussite cumulée, dix derniers résultats. */
export function PublicRecord({ sport }: { sport: 'nba' | 'atp' }) {
  const [rec, setRec] = useState<Record>();
  useEffect(() => {
    (sport === 'nba' ? nbaRecord() : atpRecord()).then(setRec, () => setRec({ rows: [] }));
  }, [sport]);
  if (!rec || rec.rows.length < 5) return null;
  const won = rec.rows.filter((r) => r.won).length;
  const sure = rec.rows.filter((r) => r.sure);
  const sureWon = sure.filter((r) => r.won).length;
  let acc = 0;
  const curve = rec.rows.map((r, i) => (acc += r.won ? 1 : 0) / (i + 1));
  const last = rec.rows.slice(-10);
  return (
    <section className="record" aria-label="Bilan de Razzia cette saison">
      <div className="record-k">
        <span className="caps">Bilan Razzia</span>
        <span className="record-sub">depuis le début de la saison</span>
      </div>
      <div className="record-stat">
        <b>{pct(won / rec.rows.length)}</b>
        <span>
          {won} sur {rec.rows.length} passés
        </span>
      </div>
      {sure.length > 0 && (
        <div className="record-stat">
          <b className="up">{pct(sureWon / sure.length)}</b>
          <span>
            Razzia assuré : {sureWon} sur {sure.length}
          </span>
        </div>
      )}
      <div className="record-curve">
        <Sparkline values={curve} label="Réussite cumulée, match après match" />
      </div>
      <div className="record-last" aria-label={`10 derniers : ${last.filter((r) => r.won).length} passés`}>
        <span className="record-sub">10 derniers</span>
        <span className="record-dots">
          {last.map((r) => (
            <i key={r.key} className={r.won ? 'won' : 'lost'} />
          ))}
        </span>
      </div>
    </section>
  );
}
