// Pronostics par catégorie (vainqueur et handicap) : pour chaque pari, l'issue retenue sur les 5 000 simulations, avec
// sa fréquence et la cote du bookmaker (ou la cote juste) pour comparaison.
import { decimal, line, noVig, pct, signed, type Game, type Result } from './data.ts';

export interface Outcome {
  id: string;
  title: string;
  p: number; // fréquence dans les simulations
  odds?: number; // cote décimale de cette issue
  fair?: number; // cote juste (1 / fréquence dans les simulations), quand aucune cote n'est publiée
  warn?: string; // étiquette rouge (« Déconseillé »)
  implied?: number; // probabilité de la cote, marge retirée
  text?: string;
}

export interface Category {
  id: string;
  label: string;
  items: Outcome[];
  warn?: boolean; // déconseillé (point rouge sur l'onglet)
  good?: boolean; // plus sûr que le vainqueur (point bleu sur l'onglet)
}

/** « des Knicks », « du Heat » : les noms de franchise au singulier prennent « du ». */
const deTeam = (name: string) => (['Heat', 'Magic', 'Thunder', 'Jazz'].includes(name) ? `du ${name}` : `des ${name}`);
const STD_PRICE = -110; // prix standard quand la cote du handicap ou du total n'est pas publiée
/** En dessous de cette cote, un pari ne rapporte presque rien : le handicap « plus sûr » n'est pas proposé. */
export const MIN_ODDS = 1.15;
/** Favori sous 55 % : pile ou face, le vainqueur est déconseillé et le handicap passe devant. */
export const FLIP = 0.55;

export function buildCategories(r: Result, g: Game): Category[] {
  const o = g.odds ?? {};
  const mk = r.market;
  const cats: Category[] = [];

  // Vainqueur : la probabilité affichée en tête de fiche (moteur, avec le mouvement de cote).
  const pShown = r.market?.blendedHome ?? r.pHome;
  const homeWins = pShown >= 0.5;
  const winP = Math.max(pShown, 1 - pShown);
  const ml = noVig(o.mlHome, o.mlAway);
  const winSide = homeWins ? 'home' : 'away';
  cats.push({
    id: 'win', label: 'Vainqueur',
    items: [{
      id: 'win', title: `Victoire ${deTeam(g[winSide].name)}`, p: winP,
      odds: (homeWins ? o.mlHome : o.mlAway) != null ? decimal((homeWins ? o.mlHome : o.mlAway)!) : undefined,
      implied: ml ? (homeWins ? ml[0] : ml[1]) : undefined,
      text: `${g[winSide].city} ${g[winSide].name} gagne ${Math.round(winP * 5000).toLocaleString('fr-FR')} des 5 000 matchs simulés. Score médian : ${g.away.tri} ${Math.round(r.awayPts.p50)}, ${g.home.tri} ${Math.round(r.homePts.p50)}. Prolongation dans ${pct(r.pOT)} des cas.`,
    }],
  });

  // Handicap : toujours sur le favori et toujours plus sûr que le simple vainqueur (sinon il ne sert à rien).
  const fav = winSide;
  const spreads: Outcome[] = [];
  if (mk?.spreadHome != null && mk.pHomeCover != null) {
    const pFav = fav === 'home' ? mk.pHomeCover : 1 - mk.pHomeCover;
    const l = fav === 'home' ? mk.spreadHome : -mk.spreadHome;
    const sp = noVig(o.spreadOddsHome ?? STD_PRICE, o.spreadOddsAway ?? STD_PRICE)!;
    const price = (fav === 'home' ? o.spreadOddsHome : o.spreadOddsAway) ?? (o.spreadOddsHome == null && o.spreadOddsAway == null ? undefined : STD_PRICE);
    const margin = fav === 'home' ? r.margin.mean : -r.margin.mean;
    if (pFav > winP)
      spreads.push({
        id: 'spread', title: `${g[fav].name} ${l > 0 ? '+' : ''}${line(l)}`, p: pFav,
        odds: price != null ? decimal(price) : undefined, implied: fav === 'home' ? sp[0] : sp[1],
        text: `Écart moyen simulé : ${signed(margin)} pour ${g[fav].name}. Dans 80 % des matchs, l'écart final va de ${signed(fav === 'home' ? r.margin.p10 : -r.margin.p90)} à ${signed(fav === 'home' ? r.margin.p90 : -r.margin.p10)}.`,
      });
  }
  // Plus sûr que le simple vainqueur (surtout sur un pile ou face) : le favori avec des points d'avance, la ligne la plus
  // exigeante qui passe dans 75 % des simulations et plus souvent que la victoire ; pas proposé sous une cote de 1,15.
  const cover = (x: { pHomeCover: number }) => (fav === 'home' ? x.pHomeCover : 1 - x.pHomeCover);
  const hedge = r.spreadLadder
    .filter((x) => (fav === 'home' ? x.line : -x.line) > 0 && cover(x) >= 0.75 && cover(x) > winP && cover(x) <= 1 / MIN_ODDS)
    .sort((a, b) => cover(a) - cover(b))[0];
  if (hedge) {
    const l = fav === 'home' ? hedge.line : -hedge.line;
    spreads.push({
      id: 'hedge', title: `${g[fav].name} +${line(l)}`, p: cover(hedge), fair: 1 / cover(hedge),
      text: `Plus sûr que le simple vainqueur : ${g[fav].name} gagne, ou perd de ${Math.floor(l)} points au plus. Passe dans ${pct(cover(hedge))} des simulations ; intéressant si la cote proposée dépasse la cote juste.`,
    });
  }
  // Une seule solution : celle qui passe le plus souvent. Un seul point, sur l'onglet en deuxième position : bleu sur le
  // handicap (plus sûr que le vainqueur), rouge sur le vainqueur d'un pile ou face (le handicap passe alors en premier).
  const best = spreads.sort((a, b) => b.p - a.p)[0];
  if (best) cats.push({ id: 'spread', label: 'Handicap', items: [best], good: winP >= FLIP });
  // Pile ou face : parier sur le vainqueur est déconseillé ; le handicap passe en premier.
  if (winP < FLIP && best) {
    const win = cats.shift()!;
    win.warn = true;
    win.items = win.items.map((o) => ({ ...o, warn: 'Déconseillé' }));
    cats.push(win);
  }

  return cats;
}
