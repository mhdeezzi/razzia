// Pronostics par catégorie : pour chaque pari, l'issue qui se produit le plus souvent sur les 5 000 simulations,
// avec sa fréquence et la cote du bookmaker pour comparaison.
import { decimal, line, n1, noVig, pct, signed, type Game, type Result } from './data.ts';

export interface Outcome {
  id: string;
  title: string;
  p: number; // fréquence dans les simulations
  odds?: number; // cote décimale de cette issue
  implied?: number; // probabilité de la cote, marge retirée
  text?: string;
  player?: string;
  confidence?: 'haute' | 'moyenne' | 'faible';
  confidenceWhy?: string;
}

export interface Category {
  id: string;
  label: string;
  kind: 'match' | 'player';
  items: Outcome[];
}

const PLAYER_CATS: Array<[string, string, string]> = [
  ['Total Points', 'Points', 'points'],
  ['Total Rebounds', 'Rebonds', 'rebonds'],
  ['Total Assists', 'Passes', 'passes décisives'],
  ['Total 3-Pointers Made', '3 points', 'paniers à 3 points'],
  ['Total Points, Rebounds, and Assists', 'P+R+A', 'points + rebonds + passes'],
];
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
    id: 'win', label: 'Vainqueur', kind: 'match',
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
      id: 'spread', label: 'Handicap', kind: 'match',
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
      id: 'total', label: 'Total', kind: 'match',
      items: [{
        id: 'total', title: `${over ? 'Plus' : 'Moins'} de ${line(mk.total)} points`, p: Math.max(mk.pOver, 1 - mk.pOver),
        odds: price != null ? decimal(price) : undefined, implied: over ? tp[0] : tp[1],
        text: `${n1(r.total.mean)} points au total en moyenne, sur environ ${n1(r.poss.mean)} possessions par équipe. Dans 80 % des matchs, le total va de ${Math.round(r.total.p10)} à ${Math.round(r.total.p90)}.`,
      }],
    });
  }

  const fhHome = r.firstHalf.pHome >= 0.5;
  cats.push({
    id: 'half', label: 'Mi-temps', kind: 'match',
    items: [{
      id: 'half', title: `${fhHome ? g.home.name : g.away.name} devant à la pause`, p: Math.max(r.firstHalf.pHome, 1 - r.firstHalf.pHome),
      text: `Score moyen à la pause : ${g.away.tri} ${n1(r.firstHalf.away)}, ${g.home.tri} ${n1(r.firstHalf.home)}. Quart-temps moyens de ${g[fhHome ? 'home' : 'away'].name} : ${r.quarters[fhHome ? 'home' : 'away'].map(n1).join(', ')}.`,
    }],
  });

  for (const [market, label, noun] of PLAYER_CATS) {
    const items: Outcome[] = r.props
      .filter((pr) => pr.market === market && pr.line != null)
      .map((pr) => {
        const over = pr.pOver >= pr.pUnder;
        const price = over ? pr.bookOver : pr.bookUnder;
        return {
          id: `${pr.player}-${market}`, player: pr.player, title: `${over ? 'Plus' : 'Moins'} de ${line(pr.line)} ${noun}`,
          p: over ? pr.pOver : pr.pUnder, odds: price != null ? decimal(price) : undefined,
          implied: pr.impliedOver != null ? (over ? pr.impliedOver : 1 - pr.impliedOver) : undefined,
          confidence: pr.confidence, confidenceWhy: pr.confidenceWhy,
        };
      })
      .sort((a, b) => b.p - a.p);
    if (items.length) cats.push({ id: market, label, kind: 'player', items });
  }
  return cats;
}
