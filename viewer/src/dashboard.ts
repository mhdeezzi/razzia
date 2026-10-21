// Tableau de bord des 5 000 simulations : probabilités, échelles de lignes, distributions joueurs, props.
import type { Summary } from './types.ts';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const f1 = (v: number) => v.toFixed(1);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface DashExtra {
  insights?: string[];
  meta?: { dataThrough: string; gamesUsed: number; date: string };
  actual?: { home: number; away: number };
  typical?: { home: number; away: number; index: number };
}

export function renderDashboard(root: HTMLElement, s: Summary, x: DashExtra): void {
  const A = s.away;
  const Hm = s.home;
  const mk = s.market;
  const fav = s.pHome >= 0.5 ? Hm : A;
  const cards = `
  <div class="cards">
    <div class="card"><h3>Victoire</h3><div class="big">${pct(Math.max(s.pHome, s.pAway))}</div><div class="sub">${esc(fav.city)} ${esc(fav.name)} · ${A.tri} ${pct(s.pAway)} / ${Hm.tri} ${pct(s.pHome)} · prolongation ${pct(s.pOT)}</div></div>
    <div class="card"><h3>Score moyen</h3><div class="big">${f1(s.awayPts.mean)} – ${f1(s.homePts.mean)}</div><div class="sub">${A.tri} – ${Hm.tri} · médianes ${s.awayPts.p50.toFixed(0)}–${s.homePts.p50.toFixed(0)}</div></div>
    <div class="card"><h3>Écart (domicile)</h3><div class="big">${s.margin.mean > 0 ? '+' : ''}${f1(s.margin.mean)}</div><div class="sub">σ ${f1(s.margin.sd)} · 80 % entre ${f1(s.margin.p10)} et ${f1(s.margin.p90)}</div></div>
    <div class="card"><h3>Total</h3><div class="big">${f1(s.total.mean)}</div><div class="sub">σ ${f1(s.total.sd)} · 80 % entre ${f1(s.total.p10)} et ${f1(s.total.p90)} · ${f1(s.poss.mean)} poss.</div></div>
    ${mk ? `<div class="card"><h3>Marché vs modèle</h3><div class="sub" style="font-size:14px;color:var(--text)">
      ${mk.spreadHome != null ? `${Hm.tri} ${mk.spreadHome > 0 ? '+' : ''}${mk.spreadHome} : couvre ${pct(mk.pHomeCover ?? 0)}<br>` : ''}
      ${mk.total != null ? `Total ${mk.total} : over ${pct(mk.pOver ?? 0)} / under ${pct(1 - (mk.pOver ?? 0))}<br>` : ''}
      ${mk.bookHome != null ? `${Hm.tri} sans marge : livre ${pct(mk.bookHome)} vs sims ${pct(s.pHome)}<br>` : ''}
      ${mk.blendedHome != null ? `Mélange début de saison : ${pct(mk.blendedHome)}` : ''}</div></div>` : ''}
    ${x.actual ? `<div class="card"><h3>Résultat réel</h3><div class="big">${x.actual.away} – ${x.actual.home}</div><div class="sub">match typique : ${x.typical?.away ?? '-'}–${x.typical?.home ?? '-'}</div></div>` : ''}
  </div>`;

  const ladder = (rows: Array<{ line: number; p: number }>, title: string, label: (l: number) => string) => `
    <div class="card"><h3>${title}</h3><div class="tbl" style="max-height:320px"><table><thead><tr><th>Ligne</th><th>Probabilité</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${label(r.line)}</td><td>${pct(r.p)}</td><td style="width:45%"><div style="height:8px;border-radius:4px;background:linear-gradient(90deg,#3b82f6 ${r.p * 100}%,#1b2538 ${r.p * 100}%)"></div></td></tr>`).join('')}
    </tbody></table></div></div>`;
  const ladders = `<div class="grid2">
    ${ladder(s.spreadLadder.map((l) => ({ line: l.line, p: l.pHomeCover })), `${Hm.tri} couvre le spread`, (l) => `${Hm.tri} ${l > 0 ? '+' : ''}${l}`)}
    ${ladder(s.totalLadder.map((l) => ({ line: l.line, p: l.pOver })), 'Over du total', (l) => `Over ${l}`)}
  </div>`;

  const rows = (side: 0 | 1) =>
    s.players
      .filter((p) => p.side === side && p.playRate > 0.02)
      .sort((a, b) => b.stats.min.mean - a.stats.min.mean)
      .map((p) => {
        const r = (k: string) => `${f1(p.stats[k].mean)} <span class="range">${p.stats[k].p10.toFixed(0)}–${p.stats[k].p90.toFixed(0)}</span>`;
        return `<tr><td>${esc(p.name)}${p.starter ? ' <span class="range">TIT</span>' : ''}${p.status.toLowerCase().startsWith('active') ? '' : ` <span class="pill under">${esc(p.status)}</span>`}</td>
          <td>${pct(p.playRate)}</td><td>${r('min')}</td><td>${r('pts')}</td><td>${r('reb')}</td><td>${r('ast')}</td><td>${r('fg3m')}</td><td>${r('pra')}</td>
          <td>${pct(p.dd)}</td><td>${pct(p.firstBasket)}</td><td>${f1(p.form.ptsL10)}</td><td>${p.h2h ? `${f1(p.h2h.pts)} (${p.h2h.games})` : '–'}</td></tr>`;
      })
      .join('');
  const ptable = (side: 0 | 1, t: Summary['home']) => `
    <div class="card"><h3>${esc(t.city)} ${esc(t.name)} — moyenne et portée 80 % (P10–P90)</h3><div class="tbl"><table><thead><tr>
      <th>Joueur</th><th>Joue</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th><th>PRA</th><th>Double-double</th><th>1er panier</th><th>PTS L10</th><th>PTS vs adv.</th>
    </tr></thead><tbody>${rows(side)}</tbody></table></div></div>`;

  const props = s.props.filter((p) => p.impliedOver != null && p.pLean != null).slice(0, 40);
  const conf = (c: string) => `<span class="pill ${c === 'haute' ? 'over' : c === 'faible' ? 'under' : ''}">${c}</span>`;
  const propsHtml = props.length
    ? `<div class="card"><h3>Props DraftKings vs sims — probabilité mélangée au marché selon la confiance (triées par edge)</h3><div class="tbl"><table><thead><tr><th>Joueur</th><th>Marché</th><th>Ligne</th><th>Lean</th><th>Sims (brut)</th><th>Mélangée</th><th>Implicite</th><th>Edge</th><th>Confiance</th></tr></thead><tbody>
      ${props.map((p) => {
        const raw = p.lean === 'over' ? p.pOver : p.pUnder;
        const pi = p.lean === 'over' ? p.impliedOver! : 1 - p.impliedOver!;
        return `<tr><td>${esc(p.player)}</td><td>${esc(p.market.replace('Total ', ''))}</td><td>${p.line}</td><td><span class="pill ${p.lean}">${p.lean.toUpperCase()}</span></td><td>${pct(raw)}</td><td>${pct(p.pLean!)}</td><td>${pct(pi)}</td><td style="color:${(p.edge ?? 0) > 0 ? 'var(--good)' : 'var(--muted)'}">${p.edge != null ? pct(p.edge) : '–'}</td><td title="${esc(p.confidenceWhy)}">${conf(p.confidence)}</td></tr>`;
      }).join('')}</tbody></table></div><div class="sub">Confiance faible : transfert, rookie, rôle déduit de la pré-saison ou statut incertain — le marché a souvent une information de rôle que les données n'ont pas encore.</div></div>`
    : '';

  const insights = x.insights?.length ? `<div class="card"><h3>Ce que disent les données</h3><ul class="insights">${x.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : '';
  const ts = s.teamStats;
  const teamTbl = `<div class="card"><h3>Statistiques d'équipe moyennes</h3><table><thead><tr><th></th>${['PTS', 'FGA', 'FG%', '3PA', '3P%', 'FTA', 'TOV', 'OREB', 'REB', 'AST', 'STL', 'BLK'].map((k) => `<th>${k}</th>`).join('')}</tr></thead><tbody>
    ${(['away', 'home'] as const).map((k) => {
      const t = ts[k];
      return `<tr><td>${k === 'home' ? Hm.tri : A.tri}</td><td>${f1(t.pts)}</td><td>${f1(t.fga)}</td><td>${pct(t.fgm / t.fga)}</td><td>${f1(t.fg3a)}</td><td>${pct(t.fg3m / t.fg3a)}</td><td>${f1(t.fta)}</td><td>${f1(t.tov)}</td><td>${f1(t.oreb)}</td><td>${f1(t.reb)}</td><td>${f1(t.ast)}</td><td>${f1(t.stl)}</td><td>${f1(t.blk)}</td></tr>`;
    }).join('')}</tbody></table>
    <div class="sub">Quarts-temps moyens : ${A.tri} ${s.quarters.away.map(f1).join(' / ')} · ${Hm.tri} ${s.quarters.home.map(f1).join(' / ')} · 1re mi-temps ${Hm.tri} gagne ${pct(s.firstHalf.pHome)}</div></div>`;

  root.innerHTML = `<div class="dash">
    <p class="section-title">${esc(A.city)} ${esc(A.name)} @ ${esc(Hm.city)} ${esc(Hm.name)} — ${s.n.toLocaleString('fr-FR')} simulations</p>
    ${x.meta ? `<div class="muted">Données jusqu'au ${x.meta.dataThrough} · ${x.meta.gamesUsed} matchs de play-by-play · match du ${x.meta.date}</div>` : ''}
    ${cards}${teamTbl}${ladders}${ptable(1, A)}${ptable(0, Hm)}${propsHtml}${insights}
  </div>`;
}
