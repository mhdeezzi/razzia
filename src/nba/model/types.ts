// Modèle de match complet consommé par le moteur de simulation (sérialisable en JSON).
import type { StartType } from './pbp.ts';

export const PT_LIST = [
  'Transition', 'Isolation', 'PRBallHandler', 'PRRollman', 'Postup', 'Spotup', 'Handoff', 'Cut', 'OffScreen', 'OffRebound', 'Misc',
] as const;
export type PT = (typeof PT_LIST)[number];
export const HALF_COURT_PT: PT[] = ['Isolation', 'PRBallHandler', 'PRRollman', 'Postup', 'Spotup', 'Handoff', 'Cut', 'OffScreen', 'Misc'];
export const PT_LABEL: Record<PT, string> = {
  Transition: 'transition', Isolation: 'isolation', PRBallHandler: 'pick-and-roll', PRRollman: 'roll to the rim', Postup: 'post-up',
  Spotup: 'spot-up', Handoff: 'handoff', Cut: 'cut', OffScreen: 'off screen', OffRebound: 'putback', Misc: 'half court',
};

/** Probabilités de fin de possession pour un joueur et un type de jeu. */
export interface PTEff {
  tov: number; // perte de balle
  sfMiss: number; // faute de tir sur tentative manquée (2-3 LF, pas de FGA)
  and1: number; // P(faute | panier réussi)
  adj: number; // ajustement d'adresse (logit) propre à ce type de jeu
  n: number; // possessions observées
}

export type Z6 = [number, number, number, number, number, number];

export interface PlayerModel {
  id: number;
  name: string;
  short: string; // nom affiché (ex. "SGA", "Wembanyama")
  jersey: string;
  pos: string;
  group: 'G' | 'W' | 'B';
  heightIn: number;
  teamId: number;
  status: string; // Active / Out / Questionable ...
  avail: number; // probabilité de jouer
  starter: boolean;
  presence: number[]; // 48 : probabilité d'être sur le terrain par minute
  expMin: number;
  rapm?: { o: number; d: number; poss: number }; // note d'impact (points / 100 poss. en attaque, retirés en défense)
  quality: number; // niveau du joueur : Game Score ramené à 36 minutes (forme récente, rétréci) — hiérarchie du coach
  momentum?: { recent: number; base: number; delta: number }; // Game Score/36 : 15 derniers matchs contre saisons précédentes
  stintMean: number;
  usg: number;
  pt: Record<PT, number>; // fins de possession par possession d'équipe sur le terrain
  eff: Record<PT, PTEff>;
  zone: Record<PT, Z6>; // distribution de zone de tir selon le type de jeu
  fg: Z6; // adresse par zone (forme récente, rétrécie bayésienne)
  ft: number;
  astd: Z6; // P(assisté | réussi, zone) du joueur (forme récente, rétrécie vers la ligue)
  astNorm: Z6; // prior moyen « type de jeu » de ses paniers par zone (pour moduler astd par type de jeu)
  spots: Array<Array<[number, number]>>;
  spotLogit: Z6; // logit moyen de l'adresse de la ligue à la distance de ses tirs habituels, par zone
  contest?: Contest; // tendance et adresse du joueur selon la distance du défenseur (stats.nba.com)
  labels: Array<Array<[string, number]>>;
  astTo: Record<string, number>; // passeur -> poids vers coéquipier (id)
  passTo: Record<string, number>; // passes (tracking) vers coéquipier
  astRate: number; // passes décisives par possession sur le terrain
  putback: number; // P(tentative immédiate | rebond offensif)
  orb: number;
  drb: number;
  // défense
  dRim: number; // delta logit (rétréci) à moins de 6 pieds
  dMid: number;
  d3: number;
  dOverall: number;
  rimRate: number; // tirs contestés < 6 ft par minute
  midRate: number;
  threeRate: number;
  stl: number; // interceptions par possession adverse
  blk: Z6; // P(contre | tir contesté dans la zone)
  pfShoot: number; // fautes de tir par possession adverse
  pfOther: number;
  pfOff: number; // fautes offensives par possession offensive
  drawOther: number; // fautes hors tir provoquées par possession offensive sur le terrain
  drawBonus: number; // dont en bonus
  typicalDefQ: number; // qualité moyenne (dOverall) des défenseurs qu'il affronte habituellement
  tovLiveShare: number;
  guardProfile: { height: number; usg: number };
  h2h?: { games: number; pts: number; reb: number; ast: number; ptsAll: number; last?: { date: string; pts: number }; best?: number };
  form: { gp: number; gpCur: number; ptsL10: number; minL10: number; ptsSeason: number; minSeason: number; rebL10: number; astL10: number; fg3mL10: number };
  notes: string[];
}

export interface TeamModel {
  id: number;
  tri: string;
  name: string;
  city: string;
  color: string;
  color2: string;
  players: PlayerModel[];
  pace: number; // possessions / 48 min
  hcDurOff: number; // durée moyenne (s) jusqu'à la décision en demi-terrain, attaque
  hcDurDef: number; // idem, adversaire face à cette défense
  transOff: Record<StartType, number>;
  transDefMult: number;
  ptDefMult: Record<PT, number>; // fréquence de type de jeu concédée / ligue
  tovForceMult: number;
  zoneDefMult: Z6; // fréquence de zone concédée / ligue
  zoneDefFg: Z6; // résidu logit concédé par zone (schéma)
  foulRate: number; // fautes défensives hors tir par possession adverse
  switchRate: number;
  restDays: number;
  b2b: boolean;
  fatigue: number; // 1 = back-to-back ; + voyage de 2 fuseaux ou plus vers l'est sans repos ; + altitude (visiteur)
  fatigueWhy: string[];
  defContest?: { s2: number[]; s3: number[] }; // part des tirs adverses par niveau de contestation (défense)
  sos: [number, number]; // force moyenne des adversaires affrontés : [défense - ligue, attaque - ligue] (points par possession)
  ortg: number; // points par possession en attaque (forme récente)
  drtg: number; // points par possession concédés
  continuity: number; // part des minutes attendues jouées par des joueurs déjà dans l'équipe
  gpCur: number; // matchs joués cette saison
  strengthSd: number; // incertitude sur la force réelle (logit d'adresse) : effectif remanié, début de saison
  momentum?: TeamMomentum;
  record?: { w: number; l: number }; // bilan de la saison en cours (saison régulière)
  noStakes?: boolean; // fin de saison sans enjeu : après la mi-février, moins de 33 % de victoires
  ratings: Record<string, number | string>;
}

export interface LeagueModel {
  zoneFg: Z6;
  zoneFreq: Z6;
  zoneAstd: Z6;
  orebByZone: Z6;
  orebFt: number;
  transByStart: Record<StartType, number>;
  hcDur: number;
  pace: number;
  ptFreq: Record<PT, number>;
  nonShootFoulRate: number;
  ft: number;
  homeMargin: number;
  ppg: number;
  rankMinutes: number[]; // minutes moyennes par rang dans la rotation (0 = joueur le plus utilisé)
  contest?: { s2: number[]; s3: number[]; f2?: number[]; f3?: number[] }; // parts et adresse par niveau de contestation (ligue)
  distFg: number[]; // adresse de la ligue par distance au panier (pied par pied, 0 à 40)
}

/**
 * Momentum : écart moyen de points des 15 derniers matchs (playoffs compris) contre celui des deux saisons précédentes,
 * corrigé du terrain. Positif = l'équipe fait mieux que ce qu'elle a jamais montré ces dernières années.
 */
export interface TeamMomentum {
  recent: number; // écart moyen par match, 15 derniers matchs
  base: number; // écart moyen par match, saisons précédentes (hors 15 derniers)
  delta: number; // recent - base
  n: number; // matchs récents comptés
  nBase: number;
  streak: number; // série en cours (+ victoires, - défaites)
  xRecent?: number; // occasions (points attendus créés - concédés sur 100 possessions), 15 derniers matchs
  xBase?: number;
  occ?: { recent: OccSummary; base: OccSummary }; // détail des occasions : pertes, rebonds, qualité des tirs, lancers
}

/** Occasions d'une équipe sur une période (voir xpts.ts) : ce qu'elle se crée et ce qu'elle concède. */
export interface OccSummary {
  tov: number;
  tovForced: number;
  orb: number;
  orbAllowed: number;
  trans: number;
  transAllowed: number;
  fta: number;
  ftaAllowed: number;
  xFg: number; // points attendus par tir (emplacement et type de tir)
  xFgAllowed: number;
  make: number; // points réels - attendus par tir (tireurs compris)
  makeAllowed: number;
}

/** Leviers du moteur pour une équipe en attaque (0 = neutre) : ascendant, chat noir, etc. Exprimés en points / 100 poss. */
export interface Edge {
  tov: number; // pertes évitées
  orb: number; // rebonds offensifs en plus
  trans: number; // contre-attaques en plus
  fta: number; // fautes de tir provoquées en plus
  shotQ: number; // meilleurs emplacements de tir (plus de cercle et de corners, moins de mi-distance)
  contest: number; // tirs moins contestés (négatif : plus contestés)
}

/** Confrontations des deux dernières années, avec l'écart attendu avant chaque match (forme des 30 matchs précédents). */
export interface TeamH2H {
  meetings: Array<{ date: string; homeTri: string; hs: number; as: number; expHome: number }>; // expHome : écart attendu pour l'équipe à domicile de ce match
  residualHome: number; // écart réel - attendu, moyenne du point de vue de l'équipe à domicile ce soir (rétréci)
  blackCat?: { victim: 'home' | 'away'; favored: number; lost: number; residual: number; text: string };
  // Ce qui change dans ces confrontations par rapport à l'habitude de chaque équipe (rétréci), en points / 100 poss. :
  // emplacements de tir, tirs contestés ou ratés, pertes, rebonds offensifs.
  shots?: { home: Edge; away: Edge; n: number };
}

/** Contestation : 0 = très serré (0-2 pieds), 1 = serré, 2 = ouvert, 3 = grand ouvert (6+ pieds). */
export interface Contest {
  s2: number[]; // part des tirs à 2 pts par niveau
  s3: number[];
  f2: number[]; // adresse à 2 pts par niveau (rétrécie vers la ligue)
  f3: number[];
}

export interface SimParams {
  homeFgLogit: number;
  homeFoulMult: number;
  durScale: number; // calibré pour atteindre le rythme attendu
  sdTeamNight: number;
  sdTeam3Night: number;
  sdPlayerNight: number;
  sdUsage: number;
  sdMinutes: number;
  sdPace: number;
  defWeight: number;
  hunting: number;
  astScale: number;
  techRate: number; // fautes techniques par possession
  teamRebShare: number; // rebonds non crédités à un joueur (ballon sorti, fin de période)
  orebMult: number; // calage global du rebond offensif (cotes)
  fgBias: number; // intercept d'adresse global (logit), calé par backtest
  fg3Bias: number; // intercept spécifique aux tirs à 3 pts
  threeMult: number; // calage global de la sélection des zones à 3 pts (surveillé par le backtest)
  astGamma: number;
  rebGamma: number; // partage des rebonds entre joueurs : part ∝ taux^γ // partage des passes décisives : part ∝ taux^γ (les créateurs gardent leur part)
  teamBias: [number, number]; // ancrage de force collective (logit d'adresse) domicile, extérieur
  uncWeight: number; // poids de l'incertitude de force collective (strengthSd) tirée à chaque simulation
  momentumWeight: number; // part du momentum d'équipe (écart récent - saisons précédentes) ajoutée à la force visée
  momentumEarly: number; // part supplémentaire en début de saison (moins de 25 matchs), où le momentum compte le plus
  noStakesPenalty: number; // points d'écart retirés à une équipe en fin de saison sans enjeu
  coachDef: number; // le coach met son meilleur défenseur sur la plus grosse menace et cache son plus faible
  h2hWeight: number; // part de l'écart réel - attendu des confrontations récentes (chat noir) ajoutée à l'écart visé
  h2hShotWeight?: number; // part des écarts de qualité de tir dans les confrontations (emplacements, contestation, pertes, rebonds)
  blendModel?: number; // part du moteur dans la probabilité affichée (mélange logit avec la cote sans marge)
  rapmWeight?: number; // part des notes d'impact joueurs (selon qui joue ce soir) dans la force visée, contre les notes d'équipe
  momentumOcc?: number; // part des occasions (plutôt que du score) dans la mesure du momentum : 0 = score seul, 1 = occasions seules
  edge?: [Edge, Edge]; // leviers appliqués (domicile, extérieur), calculés avant les simulations
  qualityCut: number; // échelle (Game Score/36) : un coach coupe d'abord les minutes des joueurs les plus faibles
  usageGamma: number; // partage de l'usage dans un cinq : part ∝ usage^γ (γ > 1 : la star garde sa part)
  rubber: number; // effet élastique : logit d'adresse retiré par tranche de 10 pts d'avance
  sdGameNight: number; // environnement de tir commun aux deux équipes (logit)
  sdWhistle: number; // arbitrage du soir (multiplicateur log des fautes, commun aux deux équipes)
  foulMult: number; // calage global des fautes hors tir
  sfMult: number; // calage global des fautes de tir (lancers)
  distWeight: number; // poids de la distance du tir dans la zone (pente de la ligue, autour des tirs habituels du joueur)
  duelWeight: number; // poids de l'historique du duel tireur / défenseur qui conteste
  fatigueOff: number; // logit d'adresse retiré par unité de fatigue (back-to-back, voyage vers l'est, altitude)
  fatigueDef: number; // logit d'adresse concédé en plus par unité de fatigue de la défense
  sosWeight: number; // correction des notes d'équipe par la force des adversaires affrontés
  contestWeight: number; // poids de l'adresse du joueur au niveau de contestation tiré (0 = ignoré)
  calA?: number; // recalibration finale de la probabilité de victoire (Platt), mesurée par backtest
  calB?: number;
}

export interface GameModel {
  meta: {
    gameId: string;
    date: string;
    season: string;
    builtAt: string;
    dataThrough: string;
    gamesUsed: number;
    sources: string[];
  };
  league: LeagueModel;
  duel?: Record<number, Record<number, number>>; // tireur -> défenseur -> écart d'adresse du duel (logit, rétréci)
  h2h?: TeamH2H; // confrontations récentes entre les deux équipes (chat noir)
  home: TeamModel;
  away: TeamModel;
  market?: {
    provider: string;
    spreadHome?: number;
    total?: number;
    mlHome?: number;
    mlAway?: number;
    pHomeNoVig?: number;
  };
  props?: Array<{ player: string; market: string; line?: number; over?: number; under?: number; price?: number }>;
  h2hMatchups: Record<string, Record<string, number>>; // attaquant -> défenseur -> minutes de duel (saison(s) précédente(s))
  params: SimParams;
  insights: string[];
}
