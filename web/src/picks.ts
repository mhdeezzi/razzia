// Pronostics par catégorie (vainqueur et handicap) : pour chaque pari, l'issue retenue sur les 25 000 simulations, avec
// sa fréquence et la cote du bookmaker (ou la cote juste) pour comparaison.
import { decimal, line, noVig, pct, signed, type Game, type Result } from './data.ts';

export interface Outcome {
  id: string;
  title: string;
  p: number; // fréquence dans les simulations
  odds?: number; // cote décimale de cette issue
  fair?: number; // cote juste (1 / fréquence dans les simulations), quand aucune cote n'est publiée
  warn?: string; // étiquette rouge « Déconseillé » ou orange « Risqué »
  safe?: string; // étiquette bleue (« Safe ») : plus sûr que le vainqueur
  implied?: number; // probabilité de la cote, marge retirée
  text?: string;
  // Qui porte le pari : logo de l'équipe (basket) ou photo du joueur (tennis), à gauche du titre.
  who?: { tri?: string; color?: string; logo?: string; name?: string; photo?: string; alt?: string };
  // Le pari en clair, pour le suivi : vainqueur, handicap (points donnés à ce camp), au moins N sets, N-0, ou points d'un
  // joueur au-dessus / en dessous d'une ligne (player : son nom, event : identifiant ESPN du match pour la feuille).
  bet?: { kind: 'win' | 'spread' | 'sets' | 'straight' | 'pts'; side: 'home' | 'away'; line?: number; need?: number; over?: boolean; player?: string; event?: string };
  dist?: { mean: number; sd: number; p10: number; p25: number; p50: number; p75: number; p90: number }; // points d'un joueur (ligne réglable dans le ticket)
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
/**
 * Favori sous 66 % (65,9 % compris) : pile ou face, le handicap « plus sûr » passe devant, le vainqueur est déconseillé,
 * et c'est le handicap qui compte au bilan. Avec le plafond au marché, deux saisons : 531 -> 475 ratés (80,7 %).
 */
export const HEDGE_FIRST = 0.66;
/** Favori sous 66 % : pile ou face. */
export const FLIP = 0.66;
/** Début de saison (une équipe a joué moins de 5 matchs) : pile ou face d'office pour un favori sous 70 %. */
export const EARLY_GAMES = 5;
export const EARLY_FLIP = 0.7;
/** Matchs joués cette saison par l'équipe qui en a le moins (anciennes simulations : d'après le momentum). */
export const gamesPlayed = (r: Result) =>
  Math.min(r.gamesPlayed?.home ?? r.momentum?.home?.nCur ?? 99, r.gamesPlayed?.away ?? r.momentum?.away?.nCur ?? 99);
/** Pile ou face : favori sous 66 %, ou sous 70 % en tout début de saison. */
export const isFlip = (r: Result, p: number) => flipP(p, gamesPlayed(r));
/** Même règle à partir du seul pourcentage du favori et des matchs joués (programme). */
export const flipP = (p: number, gp = 99) => shown(p) < FLIP || (gp < EARLY_GAMES && shown(p) < EARLY_FLIP);
/** « Risqué » (pastille orange) : favori entre 66 et 70 %. Deux saisons testées (1 200 matchs) : il ne gagnait que 59 %
 * du temps, moins que la tranche 60-66 %. */
export const RISKY = 0.7;
/** Teinte de la pastille du favori : rouge pile ou face, orange risqué, sinon rien (vert). */
export const pillTier = (p: number, gp = 99) => (flipP(p, gp) ? ' flip' : shown(p) < RISKY ? ' risky' : '');
/** Handicap « plus sûr » : la ligne la plus exigeante qui passe dans au moins 80 % des simulations. */
// « Razzia assuré » : à 77 % ou plus (un match sur quatre), le moteur a vu juste 84,6 % du temps sur la saison 2025-26.
export const SURE = 0.77;
export const SAFE_COVER = 0.8;
/** Probabilité arrondie comme à l'écran (une décimale), pour que les seuils suivent le pourcentage affiché. */
export const shown = (p: number) => Math.round(p * 1000) / 1000;

const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
/**
 * Lignes de handicap simulées, prolongées de 13 points de chaque côté. Les simulations publiées avant la ligne à 80 % ne
 * couvrent que 12 points autour de l'écart médian, alors que sur un match très serré la ligne qui passe dans 80 % des
 * simulations est vers +13. Au-delà : loi normale de l'écart simulé (moyenne, écart-type), sans jamais redescendre.
 */
export function ladder(r: Result): Result['spreadLadder'] {
  const lad = [...r.spreadLadder].sort((a, b) => a.line - b.line);
  if (!lad.length || !(r.margin?.sd > 0)) return lad;
  const mean = r.margin.mean + (r.market?.capShift ?? 0); // plafond au marché : lignes déjà décalées d'autant
  const cdf = (line: number) => 0.5 * (1 + erf((mean + line) / r.margin.sd / Math.SQRT2));
  const lo: Result['spreadLadder'] = [], hi: Result['spreadLadder'] = [];
  for (let k = 1, c = lad[0].pHomeCover; k <= 13; k++) lo.unshift({ line: lad[0].line - k, pHomeCover: (c = Math.min(c, cdf(lad[0].line - k))) });
  for (let k = 1, c = lad.at(-1)!.pHomeCover; k <= 13; k++) hi.push({ line: lad.at(-1)!.line + k, pHomeCover: (c = Math.max(c, cdf(lad.at(-1)!.line + k))) });
  return [...lo, ...lad, ...hi];
}

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
      id: 'win', title: `Victoire ${deTeam(g[winSide].name)}`, who: g[winSide], bet: { kind: 'win', side: winSide }, p: winP, fair: 1 / winP,
      odds: (homeWins ? o.mlHome : o.mlAway) != null ? decimal((homeWins ? o.mlHome : o.mlAway)!) : undefined,
      implied: ml ? (homeWins ? ml[0] : ml[1]) : undefined,
      text: `${g[winSide].city} ${g[winSide].name} gagne ${Math.round(winP * (r.n || 25000)).toLocaleString('fr-FR')} des ${(r.n || 25000).toLocaleString('fr-FR')} matchs simulés. Score médian : ${g.away.tri} ${Math.round(r.awayPts.p50)}, ${g.home.tri} ${Math.round(r.homePts.p50)}. Prolongation dans ${pct(r.pOT)} des cas.`,
    }],
  });

  // Handicap : toujours sur le favori et toujours plus sûr que le simple vainqueur (sinon il ne sert à rien).
  const fav = winSide;
  const spreads: Outcome[] = [];
  if (mk?.spreadHome != null && mk.pHomeCover != null) {
    const pFav = fav === 'home' ? mk.pHomeCover : 1 - mk.pHomeCover;
    const l = fav === 'home' ? mk.spreadHome : -mk.spreadHome;
    const sp = noVig(o.spreadOddsHome ?? STD_PRICE, o.spreadOddsAway ?? STD_PRICE)!;
    // Prix du programme seulement s'il porte sur la même ligne que la simulation : sinon, cote d'une autre ligne.
    const sameLine = o.spreadHome == null || Math.abs(o.spreadHome - mk.spreadHome) < 0.01;
    const price = !sameLine ? undefined : (fav === 'home' ? o.spreadOddsHome : o.spreadOddsAway) ?? (o.spreadOddsHome == null && o.spreadOddsAway == null ? undefined : STD_PRICE);
    const margin = fav === 'home' ? r.margin.mean : -r.margin.mean;
    if (pFav > winP)
      spreads.push({
        id: 'spread', title: `${g[fav].name} ${l > 0 ? '+' : ''}${line(l)}`, who: g[fav], bet: { kind: 'spread', side: fav, line: l }, p: pFav, fair: 1 / pFav,
        odds: price != null ? decimal(price) : undefined, implied: fav === 'home' ? sp[0] : sp[1],
        text: `Écart moyen simulé : ${signed(margin)} pour ${g[fav].name}. Dans 80 % des matchs, l'écart final va de ${signed(fav === 'home' ? r.margin.p10 : -r.margin.p90)} à ${signed(fav === 'home' ? r.margin.p90 : -r.margin.p10)}.`,
      });
  }
  // Plus sûr que le simple vainqueur : le favori avec des points d'avance, la ligne la plus exigeante qui passe dans 80 %
  // des simulations et plus souvent que la victoire ; pas proposé sous une cote de 1,15.
  const cover = (x: { pHomeCover: number }) => (fav === 'home' ? x.pHomeCover : 1 - x.pHomeCover);
  const hedge = ladder(r)
    .filter((x) => (fav === 'home' ? x.line : -x.line) > 0 && cover(x) >= SAFE_COVER && cover(x) > winP && cover(x) <= 1 / MIN_ODDS)
    .sort((a, b) => cover(a) - cover(b))[0];
  if (hedge) {
    const l = fav === 'home' ? hedge.line : -hedge.line;
    spreads.push({
      id: 'hedge', title: `${g[fav].name} +${line(l)}`, who: g[fav], bet: { kind: 'spread', side: fav, line: l }, p: cover(hedge), fair: 1 / cover(hedge),
      text: `Plus sûr que le simple vainqueur : ${g[fav].name} gagne, ou perd de ${Math.floor(l)} points au plus. Passe dans ${pct(cover(hedge))} des simulations ; intéressant si la cote proposée dépasse la cote juste.`,
    });
  }
  // Une seule solution : celle qui passe le plus souvent. Un seul point, sur l'onglet en deuxième position : bleu sur le
  // handicap (plus sûr que le vainqueur), rouge sur le vainqueur d'un favori sous 66 % (le handicap passe devant).
  const best = spreads.sort((a, b) => b.p - a.p)[0];
  const hedgeFirst = !!best && (shown(winP) < HEDGE_FIRST || isFlip(r, winP));
  if (best) cats.push({ id: 'spread', label: 'Handicap', items: [hedgeFirst ? best : { ...best, safe: 'Safe' }], good: !hedgeFirst });
  // Favori sous 66 % : parier sur le vainqueur est déconseillé ; le handicap passe en premier.
  if (hedgeFirst) {
    const win = cats.shift()!;
    win.warn = true;
    win.items = win.items.map((o) => ({ ...o, warn: 'Déconseillé' }));
    cats.push(win);
  } else if (shown(winP) < RISKY) {
    // Favori entre 66 et 70 % : le vainqueur reste en tête, avec l'étiquette orange « Risqué ».
    cats[0].items = cats[0].items.map((o) => ({ ...o, warn: 'Risqué' }));
  }

  // Marqueur : parmi les joueurs « En feu ce soir » (mêmes quatre), celui qui a la plus grande chance de gros match ; le
  // pari : plus de points que sa moyenne habituelle.
  const hot = r.players
    .filter((p) => p.heat && p.heat.pBig >= 0.1 && p.stats?.pts)
    .sort((a, b) => b.heat!.index - a.heat!.index)
    .slice(0, 4)
    .sort((a, b) => b.heat!.pBig - a.heat!.pBig)[0];
  if (hot) {
    const d = hot.stats.pts, h = hot.heat!;
    const l = Math.max(0.5, Math.floor(h.base) + 0.5);
    const pOver = pOverPts(d, l);
    const side = hot.side === 0 ? 'home' : 'away';
    const ln = l.toFixed(1).replace('.', ',');
    cats.push({
      id: 'scorer', label: 'Marqueur',
      items: [{
        id: `pts-${hot.id}`, title: `${hot.name}\u00a0: plus de ${ln}\u00a0pts`, p: pOver, fair: 1 / pOver, dist: d,
        who: { name: hot.name, photo: `https://cdn.nba.com/headshots/nba/latest/260x190/${hot.id}.png` },
        bet: { kind: 'pts', side, line: l, over: true, player: hot.name, event: g.id },
        text: `Le joueur d'« En feu ce soir » le plus proche d'un gros match : plus de ${ln} points (sa moyenne habituelle) dans ${pct(pOver)} des simulations, ${h.threshold} points ou plus dans ${pct(h.pBig)}.`,
      }],
    });
  }

  return cats;
}

/**
 * Chance qu'un joueur marque plus de `line` points, quand il joue : courbe des simulations (déciles et quartiles),
 * prolongée par une loi normale au-delà. Un joueur qui ne joue pas : pari remboursé, donc sans effet ici.
 */
export function pOverPts(d: { mean: number; sd: number; p10: number; p25: number; p50: number; p75: number; p90: number }, line: number): number {
  const q: Array<[number, number]> = [[d.p10, 0.1], [d.p25, 0.25], [d.p50, 0.5], [d.p75, 0.75], [d.p90, 0.9]];
  const norm = (x: number) => 0.5 * (1 + erf((x - d.mean) / Math.max(1, d.sd) / Math.SQRT2));
  let F: number;
  if (line <= q[0][0]) F = Math.min(0.1, norm(line));
  else if (line >= q[4][0]) F = Math.max(0.9, norm(line));
  else {
    const k = q.findIndex(([v]) => v >= line);
    const [v0, f0] = q[k - 1], [v1, f1] = q[k];
    F = v1 === v0 ? f1 : f0 + ((line - v0) / (v1 - v0)) * (f1 - f0);
  }
  return Math.min(0.99, Math.max(0.01, 1 - F));
}