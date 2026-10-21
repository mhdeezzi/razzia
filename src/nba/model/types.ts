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
  h2h?: { games: number; pts: number; reb: number; ast: number; ptsAll: number };
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
  ortg: number; // points par possession en attaque (forme récente)
  drtg: number; // points par possession concédés
  continuity: number; // part des minutes attendues jouées par des joueurs déjà dans l'équipe
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
  usageGamma: number; // partage de l'usage dans un cinq : part ∝ usage^γ (γ > 1 : la star garde sa part)
  rubber: number; // effet élastique : logit d'adresse retiré par tranche de 10 pts d'avance
  sdGameNight: number; // environnement de tir commun aux deux équipes (logit)
  sdWhistle: number; // arbitrage du soir (multiplicateur log des fautes, commun aux deux équipes)
  foulMult: number; // calage global des fautes hors tir
  sfMult: number; // calage global des fautes de tir (lancers)
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
