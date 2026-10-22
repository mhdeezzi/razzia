// Regroupe les morceaux d'un contrôle de justesse (un fichier JSON par machine) et donne, par variante, la ligne de
// référence : % de bons vainqueurs de Razzia contre celui du marché, sur exactement les mêmes matchs.
//   node src/cli/btmerge.ts <dossier des morceaux>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Row {
  pHome: number;
  y: number;
  pMkt?: number;
  pOpen?: number;
  mlHomeOpen?: number;
  mlAwayOpen?: number;
  spread?: number;
  simMargin?: number;
  target?: number;
  players?: number;
}

const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : f.endsWith('.json') ? [join(d, f)] : []));
const byVariant = new Map<string, Row[]>();
for (const f of files(process.argv[2] ?? '.')) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const l = byVariant.get(j.variant) ?? [];
  l.push(...j.rows);
  byVariant.set(j.variant, l);
}

const pc = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
const lg = (p: number) => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const decimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const right = (p: number, y: number) => (p >= 0.5) === (y === 1);

const out: string[] = [];
for (const [variant, rows] of [...byVariant.entries()].sort()) {
  const n = rows.length;
  const acc = rows.filter((r) => right(r.pHome, r.y)).length / n;
  const brier = rows.reduce((s, r) => s + (r.pHome - r.y) ** 2, 0) / n;
  const M = rows.filter((r) => r.pMkt != null);
  out.push(`### ${variant} (${n} matchs)`);
  out.push(`Bon vainqueur : ${pc(acc)} ; Brier ${brier.toFixed(4)}`);
  if (M.length) {
    const accR = M.filter((r) => right(r.pHome, r.y)).length / M.length;
    const accM = M.filter((r) => right(r.pMkt!, r.y)).length / M.length;
    const bM = M.reduce((s, r) => s + (r.pMkt! - r.y) ** 2, 0) / M.length;
    // Mélange moteur + marché (logit) : part du moteur qui minimise le Brier.
    const W = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1];
    const blend = W.map((w) => ({ w, b: M.reduce((s, r) => s + (sig(w * lg(r.pHome) + (1 - w) * lg(r.pMkt!)) - r.y) ** 2, 0) / M.length, a: M.filter((r) => right(sig(w * lg(r.pHome) + (1 - w) * lg(r.pMkt!)), r.y)).length / M.length }));
    const best = [...blend].sort((a, b) => a.b - b.b)[0];
    out.push(`Brier marché ${bM.toFixed(4)} ; mélange : ${blend.map((x) => `${Math.round(x.w * 100)} % ${x.b.toFixed(4)}`).join(' | ')} -> meilleur ${Math.round(best.w * 100)} % (bon vainqueur ${pc(best.a)})`);
    // Valeur de clôture contre l'ouverture.
    const O = M.filter((r) => r.pOpen != null);
    const bets = O.filter((r) => Math.abs(r.pHome - r.pOpen!) >= 0.04);
    if (bets.length) {
      let clv = 0, pos = 0, profit = 0, won = 0, nOdds = 0;
      for (const r of bets) {
        const home = r.pHome > r.pOpen!;
        const move = home ? r.pMkt! - r.pOpen! : r.pOpen! - r.pMkt!;
        clv += move;
        if (move > 0) pos++;
        const win = home ? r.y === 1 : r.y === 0;
        if (win) won++;
        const ml = home ? r.mlHomeOpen : r.mlAwayOpen;
        if (ml != null) {
          nOdds++;
          profit += win ? decimal(ml) - 1 : -1;
        }
      }
      out.push(`Valeur de clôture (écart moteur / ouverture ≥ 4 pts, ${bets.length} matchs) : la cote bouge dans notre sens ${pc(pos / bets.length)} du temps, ${(clv / bets.length * 100).toFixed(2).replace('.', ',')} pts en moyenne ; gagnés ${pc(won / bets.length)}${nOdds ? `, rendement à l'ouverture ${pc(profit / nOdds)}` : ''}`);
    }
    // Gros favoris : écart attendu à chaque étage contre la ligne.
    const F = M.filter((r) => r.spread != null && r.simMargin != null && r.target != null && r.players != null);
    if (F.length > 10) {
      const slope = (k: 'simMargin' | 'target' | 'players') => {
        const mx = F.reduce((a, r) => a - r.spread!, 0) / F.length;
        const my = F.reduce((a, r) => a + r[k]!, 0) / F.length;
        let sxy = 0, sxx = 0;
        for (const r of F) {
          sxy += (-r.spread! - mx) * (r[k]! - my);
          sxx += (-r.spread! - mx) ** 2;
        }
        return (sxy / sxx).toFixed(2).replace('.', ',');
      };
      out.push(`Favoris : pente de l'écart attendu contre la ligne (1 = aussi tranché que le marché) : joueurs seuls ${slope('players')}, notes ${slope('target')}, simulé ${slope('simMargin')}`);
    }
    out.push(`**Référence : Razzia ${pc(accR)} — marché ${pc(accM)} (mêmes ${M.length} matchs)**`);
  } else out.push(`**Référence : Razzia ${pc(acc)} (${n} matchs, pas de cotes du marché)**`);
  out.push('');
}
console.log(out.join('\n'));
