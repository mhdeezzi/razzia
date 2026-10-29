// Signaux du match : chat noir (confrontations récentes), momentum des équipes. Le match serré est signalé par le
// badge « Pile ou face » du verdict.
import { Cat, ChartLineDown, ChartLineUp } from '@phosphor-icons/react';
import { type Game, type Result } from './data.ts';
import { TeamMark } from './ui.tsx';

const n1 = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}`;

export function Signals({ r, g }: { r: Result; g: Game }) {
  const cat = r.h2h?.blackCat;
  const victim = cat ? (cat.victim === 'home' ? g.home : g.away) : undefined;
  const moves = (['away', 'home'] as const)
    .map((k) => ({ team: g[k], m: r.momentum?.[k] }))
    .filter((x) => x.m && Math.abs(x.m.delta) >= 4);
  if (!cat && !moves.length) return null;
  return (
    <div className="signals">
      {cat && victim && (
        <div className="signal signal-cat">
          <span className="signal-icon">
            <Cat size={18} weight="fill" />
          </span>
          <div>
            <p className="signal-title">
              Chat noir pour {victim.city} {victim.name}
            </p>
            <p>{cat.text}</p>
          </div>
        </div>
      )}
      {moves.map(({ team, m }) => (
        <div key={team.tri} className={`signal ${m!.delta > 0 ? 'signal-up' : 'signal-down'}`}>
          <span className="signal-icon">{m!.delta > 0 ? <ChartLineUp size={18} weight="bold" /> : <ChartLineDown size={18} weight="bold" />}</span>
          <div>
            <p className="signal-title">
              <TeamMark team={team} size="sm" /> {team.name} {m!.delta > 0 ? 'en pleine montée' : 'en baisse'}
            </p>
            <p>
              {n1(m!.recent)} pts d'écart par match sur les {m!.n} derniers matchs, contre {n1(m!.base)} les deux saisons précédentes
              {m!.streak >= 4 ? `, ${m!.streak} victoires de suite` : m!.streak <= -4 ? `, ${-m!.streak} défaites de suite` : ''}.
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
