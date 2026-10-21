// Pronostics par catégorie (marchés de match uniquement) : pour chaque pari, l'issue qui se produit le plus souvent
// sur les 5 000 simulations, avec sa fréquence et la cote du bookmaker pour comparaison.
import { decimal, line, n1, noVig, pct, signed, type Game, type Result } from './data.ts';

export interface Outcome {
  id: string;
  title: string;
  p: number; // fréquence dans les simulations
  odds?: number; // cote décimale de cette issue
  implied?: number; // probabilité de la cote, marge retirée
  text?: string;
}

export interface Category {
  id: string;
  label: string;
  items: Outcome[];
}

/** « des Knicks », « du Heat » : les noms de franchise au singulier prennent « du ». */
const deTeam = (name: string) => (['Heat', 'Magic', 'Thunder', 'Jazz'].includes(name) ? `du ${name}` : `des ${name}`);
const STD_PRICE = -110; // prix standard quand la cote du handicap ou du total n'est pas publiée

export function buildCategories(r: Result, g: Game): Category[] {
  const o = g.odds ?? {};
  const mk = r.market;
  const cats: Category[] = [];

  const homeWins = r.pHome >= r.pAway;
  const ml = noVig(o.mlHome, o.mlAway);
  const winSide = homeWins ? 'home' : 'away';
  cats.push({
    id: 'win', label: 'Vainqueur',
    items: [{
      id: 'win', title: `Victoire ${deTeam(g[winSide].name)}`, p: Math.max(r.pHome, r.pAway),
      odds: (homeWins ? o.mlHome : o.mlAway) != null ? decimal((homeWins ? o.mlHome : o.mlAway)!) : undefined,
      implied: ml ? (homeWins ? ml[0] : ml[1]) : undefined,
      text: `${g[winSide].city} ${g[winSide].name} gagne ${Math.round(Math.max(r.pHome, r.pAway) * 5000).toLocaleString('fr-FR')} des 5 000 matchs simulés. Score médian : ${g.away.tri} ${Math.round(r.awayPts.p50)}, ${g.home.tri} ${Math.round(r.homePts.p50)}. Prolongation dans ${pct(r.pOT)} des cas.`,
    }],
  });

  if (mk?.spreadHome != null && mk.pHomeCover != null) {
    const homeCovers = mk.pHomeCover >= 0.5;
    const side = homeCovers ? 'home' : 'away';
    const l = homeCovers ? mk.spreadHome : -mk.spreadHome;
    const sp = noVig(o.spreadOddsHome ?? STD_PRICE, o.spreadOddsAway ?? STD_PRICE)!;
    const price = (homeCovers ? o.spreadOddsHome : o.spreadOddsAway) ?? (o.spreadOddsHome == null && o.spreadOddsAway == null ? undefined : STD_PRICE);
    const margin = homeCovers ? r.margin.mean : -r.margin.mean;
    cats.push({
      id: 'spread', label: 'Handicap',
      items: [{
        id: 'spread', title: `${g[side].name} ${l > 0 ? '+' : ''}${line(l)}`, p: Math.max(mk.pHomeCover, 1 - mk.pHomeCover),
        odds: price != null ? decimal(price) : undefined, implied: homeCovers ? sp[0] : sp[1],
        text: `Écart moyen simulé : ${signed(margin)} pour ${g[side].name}. Dans 80 % des matchs, l'écart final va de ${signed(homeCovers ? r.margin.p10 : -r.margin.p90)} à ${signed(homeCovers ? r.margin.p90 : -r.margin.p10)}.`,
      }],
    });
  }

  if (mk?.total != null && mk.pOver != null) {
    const over = mk.pOver >= 0.5;
    const tp = noVig(o.overOdds ?? STD_PRICE, o.underOdds ?? STD_PRICE)!;
    const price = (over ? o.overOdds : o.underOdds) ?? (o.overOdds == null && o.underOdds == null ? undefined : STD_PRICE);
    cats.push({
      id: 'total', label: 'Total',
      items: [{
        id: 'total', title: `${over ? 'Plus' : 'Moins'} de ${line(mk.total)} points`, p: Math.max(mk.pOver, 1 - mk.pOver),
        odds: price != null ? decimal(price) : undefined, implied: over ? tp[0] : tp[1],
        text: `${n1(r.total.mean)} points au total en moyenne, sur environ ${n1(r.poss.mean)} possessions par équipe. Dans 80 % des matchs, le total va de ${Math.round(r.total.p10)} à ${Math.round(r.total.p90)}.`,
      }],
    });
  }

  const fhHome = r.firstHalf.pHome >= 0.5;
  cats.push({
    id: 'half', label: 'Mi-temps',
    items: [{
      id: 'half', title: `${fhHome ? g.home.name : g.away.name} devant à la pause`, p: Math.max(r.firstHalf.pHome, 1 - r.firstHalf.pHome),
      text: `Score moyen à la pause : ${g.away.tri} ${n1(r.firstHalf.away)}, ${g.home.tri} ${n1(r.firstHalf.home)}. Quart-temps moyens de ${g[fhHome ? 'home' : 'away'].name} : ${r.quarters[fhHome ? 'home' : 'away'].map(n1).join(', ')}.`,
    }],
  });

  // Les plus sûrs : handicaps et totaux alternatifs qui passent dans au moins 80 % des simulations
  // (la ligne la plus exigeante qui reste au-dessus de 80 %).
  const sure: Outcome[] = [];
  const pickLine = <T,>(rows: T[], p: (r: T) => number) => rows.filter((x) => p(x) >= 0.8).sort((a, b) => p(a) - p(b))[0];
  const favSide = homeWins ? 'home' : 'away';
  const sp = pickLine(r.spreadLadder, (x) => (favSide === 'home' ? x.pHomeCover : 1 - x.pHomeCover));
  if (sp) {
    const l = favSide === 'home' ? sp.line : -sp.line;
    const p = favSide === 'home' ? sp.pHomeCover : 1 - sp.pHomeCover;
    sure.push({ id: 'sure-sp', title: `${g[favSide].name} ${l > 0 ? '+' : ''}${line(l)}`, p, text: l > 0 ? `${g[favSide].name} gagne, ou perd de ${Math.floor(l)} points au plus.` : `${g[favSide].name} gagne de ${Math.ceil(-l)} points ou plus.` });
  }
  const ov = pickLine(r.totalLadder, (x) => x.pOver);
  if (ov) sure.push({ id: 'sure-over', title: `Plus de ${line(ov.line)} points`, p: ov.pOver, text: `Total des deux équipes au-dessus de ${line(ov.line)} points.` });
  const un = pickLine(r.totalLadder, (x) => 1 - x.pOver);
  if (un) sure.push({ id: 'sure-under', title: `Moins de ${line(un.line)} points`, p: 1 - un.pOver, text: `Total des deux équipes en dessous de ${line(un.line)} points.` });
  if (sure.length) cats.unshift({ id: 'sure', label: 'Les plus sûrs', items: sure });
  return cats;
}
