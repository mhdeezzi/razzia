// Moteur de simulation d'un match NBA, possession par possession.
// Chaque possession : type de départ -> transition ? -> qui finit l'action et sur quel type de jeu (Synergy)
// -> qui défend (assignation + switch sur écran) -> issue (perte, faute, tir) -> zone et position du tir
// -> adresse (forme par zone, type de jeu, défenseur qui conteste, schéma, domicile, effets du soir)
// -> contre / passe décisive / rebond (lineups) -> horloge, fautes d'équipe, rotations.
import type { Edge, GameModel, LeagueModel, PlayerModel, TeamModel, PT, Z6 } from '../model/types.ts';
import { HALF_COURT_PT } from '../model/types.ts';
import { Rng, logistic, logit } from '../../core/rng.ts';

export const PT_AST_PRIOR: Record<PT, number> = {
  Transition: 0.5, Isolation: 0.04, PRBallHandler: 0.06, PRRollman: 0.9, Postup: 0.22, Spotup: 0.9, Handoff: 0.72, Cut: 0.88,
  OffScreen: 0.88, OffRebound: 0.03, Misc: 0.45,
};
const THREE = [false, false, false, true, true, true];
const RIM_ZONES = [true, true, false, false, false, false];

/** Leviers concrets d'une équipe en attaque, déduits de ses écarts d'occasions (points / 100 possessions, voir Edge). */
interface Lever {
  tov: number; // multiplicateur des pertes
  orb: number; // multiplicateur de la cote du rebond offensif
  trans: number; // multiplicateur des contre-attaques
  fta: number; // multiplicateur des fautes de tir provoquées
  zone: number[]; // multiplicateurs de choix de zone (meilleurs emplacements)
  tilt: number; // inclinaison du niveau de contestation (positif : plus ouvert)
  make: number; // logit d'adresse : part de la réussite que l'inclinaison ne couvre pas
  tiltLogit: number; // équivalent logit de l'inclinaison, pour un tireur sans profil de contestation
}
const NEUTRAL: Lever = { tov: 1, orb: 1, trans: 1, fta: 1, zone: [1, 1, 1, 1, 1, 1], tilt: 0, make: 0, tiltLogit: 0 };

function leverOf(e: Edge | undefined, L: LeagueModel): Lever {
  if (!e) return NEUTRAL;
  const c = (x: number, lim: number) => Math.max(-lim, Math.min(lim, x));
  // Qualité d'emplacement : inclinaison des zones vers celles qui rapportent le plus par tir (ligue).
  const val = L.zoneFg.map((p, z) => (THREE[z] ? 3 : 2) * p);
  const mu = val.reduce((a, v, z) => a + v * L.zoneFreq[z], 0);
  const v = val.map((x) => x - mu);
  const varv = v.reduce((a, x, z) => a + x * x * L.zoneFreq[z], 0) || 0.02;
  const t = c(e.shotQ, 8) / 88 / varv;
  // Contestation : l'inclinaison déplace les tirs entre niveaux (adresse de la ligue par niveau) ; le reste en logit.
  const C = L.contest;
  let tilt = 0;
  let make = 0;
  let tiltLogit = 0;
  const target = c(e.contest, 8) / 88; // points par tir
  if (C?.f2 && C.f3) {
    const grad = (s: number[], f: number[], val: number) => {
      const m = s.reduce((a, x) => a + x, 0) || 1;
      const ef = s.reduce((a, x, i) => a + x * f[i], 0) / m;
      return (val * s.reduce((a, x, i) => a + x * (i - 1.5) * (f[i] - ef), 0)) / m;
    };
    const g = 0.6 * grad(C.s2, C.f2, 2) + 0.4 * grad(C.s3, C.f3, 3); // points par tir par unité d'inclinaison
    if (Math.abs(g) > 0.01) tilt = c(target / g, 1.2);
    make = (target - tilt * g) / 0.56;
    tiltLogit = (tilt * g) / 0.56;
  } else make = target / 0.56; // ≈ 0,56 point par tir et par unité de logit (valeur × p(1-p))
  return {
    tov: Math.exp(-c(e.tov, 8) / 14.6),
    orb: Math.exp(c(e.orb, 8) / 10.8),
    trans: Math.exp(c(e.trans, 3) / 2.25),
    fta: Math.exp(c(e.fta, 6) / 15.5),
    zone: v.map((x) => Math.exp(t * x)),
    tilt,
    make: c(make, 0.25),
    tiltLogit,
  };
}

export interface Line {
  id: number;
  sec: number;
  pts: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  pm: number;
  started: boolean;
  played: boolean;
}

export interface TeamResult {
  pts: number;
  q: number[];
  lines: Line[];
  poss: number;
  fga: number;
  fg3a: number;
  fta: number;
  tov: number;
  oreb: number;
  zFga?: number[]; // tirs tentés par zone (RA, raquette, mi-distance, coin gauche, coin droit, 3 pts de face)
  zFgm?: number[];
  astM?: number; // paniers après une passe décisive
  transFga?: number; // tirs en contre-attaque
  transFgm?: number;
  cont?: number[]; // tirs par niveau de contestation (0 = très serré ... 3 = grand ouvert)
}

export type EvType = 'start' | 'jump' | 'poss' | 'shot' | 'ft' | 'reb' | 'tov' | 'foul' | 'sub' | 'timeout' | 'period_start' | 'period_end' | 'end';

export interface SimEvent {
  t: number;
  p: number;
  clock: number;
  sc?: number;
  type: EvType;
  side?: 0 | 1;
  pid?: number;
  pid2?: number;
  zone?: number;
  x?: number;
  y?: number;
  made?: boolean;
  pts?: number;
  n?: number; // tentatives (lancers francs)
  kind?: string;
  pt?: string;
  label?: string;
  text: string;
  hs: number;
  as: number;
  on?: [number[], number[]];
  inn?: number[];
  out?: number[];
  mismatch?: [number, number];
  handler?: number;
  screener?: number;
  passes?: number[];
  def?: number;
  fouls?: [number, number];
  bonus?: [boolean, boolean];
  wp?: number;
  ct?: number; // niveau de contestation du tir (0 = très serré ... 3 = grand ouvert)
}

export interface GameResult {
  seed: number;
  home: TeamResult;
  away: TeamResult;
  periods: number;
  firstScorer: number;
  leadChanges: number;
  largestLead: [number, number];
  events?: SimEvent[];
  active: [number[], number[]];
}

interface PState {
  m: PlayerModel;
  side: 0 | 1;
  li: number; // index local
  active: boolean;
  fouledOut: boolean;
  pf: number;
  sec: number;
  stintStart: number;
  on: boolean;
  target: number; // minutes cibles (s)
  pres: number[]; // présence normalisée par minute
  presCum: number[]; // présence cumulée (s) à la fin de chaque minute
  night: number; // effet logit du soir sur l'adresse
  usage: number; // multiplicateur d'usage du soir × usage^(γ-1)
  line: Line;
}

interface Side {
  t: TeamModel;
  ps: PState[];
  lineup: number[]; // index locaux
  fouls: number; // fautes d'équipe sur la période
  foulsLast2: number;
  timeouts: number;
  night: number;
  night3: number;
  run: number; // points consécutifs de l'adversaire (pour temps morts)
  q: number[];
}

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

export interface SimOptions {
  log?: boolean;
}

export class GameSim {
  m: GameModel;
  r: Rng;
  rc: Rng; // aléa cosmétique (animation) : n'affecte jamais le résultat
  log: boolean;
  ev: SimEvent[] = [];
  S: [Side, Side];
  p = 1;
  clock = 720;
  t = 0; // temps écoulé
  score: [number, number] = [0, 0];
  firstScorer = 0;
  leadChanges = 0;
  lastLeader = 0;
  largest: [number, number] = [0, 0];
  paceMult = 1;
  gameNight = 0; // environnement de tir commun
  whistle = 1; // arbitrage du soir
  // défenseur principal de chaque attaquant : assign[sideOff][li attaquant] = li défenseur
  assign: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  openingTipWinner: 0 | 1 = 0;
  shotClock = 24;
  lever: [Lever, Lever] = [NEUTRAL, NEUTRAL]; // leviers d'occasions de chaque attaque (ascendant, chat noir)

  constructor(m: GameModel, seed: number, opt: SimOptions = {}) {
    this.m = m;
    this.r = new Rng(seed);
    this.rc = new Rng(seed ^ 0x5bd1e995);
    this.log = !!opt.log;
    const P = m.params;
    this.paceMult = Math.exp(this.r.normal(0, P.sdPace));
    this.gameNight = this.r.normal(0, P.sdGameNight);
    this.whistle = Math.exp(this.r.normal(0, P.sdWhistle));
    this.lever = [leverOf(P.edge?.[0], m.league), leverOf(P.edge?.[1], m.league)];
    this.S = [this.makeSide(m.home, 0), this.makeSide(m.away, 1)];
  }

  private makeSide(t: TeamModel, side: 0 | 1): Side {
    const P = this.m.params;
    const ps: PState[] = t.players.map((m, li) => ({
      m, side, li, active: this.r.next() < m.avail, fouledOut: false, pf: 0, sec: 0, stintStart: 0, on: false, target: 0,
      pres: [], presCum: [], night: this.r.normal(0, P.sdPlayerNight),
      usage: Math.exp(this.r.normal(0, P.sdUsage)) * Math.pow(Math.max(0.02, m.usg), P.usageGamma - 1),
      line: { id: m.id, sec: 0, pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0, started: false, played: false },
    }));
    // Au moins 8 joueurs disponibles.
    const act = ps.filter((p) => p.active).length;
    if (act < 8) {
      const extra = ps.filter((p) => !p.active && p.m.avail > 0).sort((a, b) => b.m.expMin - a.m.expMin);
      for (const p of extra.slice(0, 8 - act)) p.active = true;
    }
    // Soir de l'équipe + incertitude sur sa force réelle (effectif remanié, début de saison).
    const night = this.r.normal(0, P.sdTeamNight) + this.r.normal(0, (P.uncWeight ?? 0) * (t.strengthSd ?? 0));
    const s: Side = { t, ps, lineup: [], fouls: 0, foulsLast2: 0, timeouts: 7, night, night3: this.r.normal(0, P.sdTeam3Night), run: 0, q: [] };
    this.planRotation(s);
    return s;
  }

  /** Minutes cibles du soir et courbes de présence normalisées (IPF : lignes = minutes, colonnes = 5 joueurs). */
  private planRotation(s: Side): void {
    const P = this.m.params;
    const act = s.ps.filter((p) => p.active);
    const mins = new Map<PState, number>();
    // Hiérarchie de rotation : minutes du joueur mélangées au gabarit de la ligue pour son rang parmi les présents
    // (un 11e homme joue peu, même s'il avait 20 minutes dans son ancienne équipe).
    const rankMin = this.m.league.rankMinutes ?? [];
    const order = [...act].sort((a, b) => b.m.expMin - a.m.expMin);
    for (const p of act) {
      const r = order.indexOf(p);
      const tpl = rankMin.length ? rankMin[Math.min(r, rankMin.length - 1)] * (r >= rankMin.length ? 0.5 : 1) : p.m.expMin;
      // Incertitude de minutes selon le rôle : faible pour un titulaire installé, forte pour un remplaçant.
      const sd = P.sdMinutes * clamp(1.6 - 0.04 * p.m.expMin, 0.8, 1.4);
      // Le gabarit par rang ne compte vraiment qu'en l'absence d'historique récent avec l'équipe (début de saison, transfert).
      const wTpl = (p.m.form.gpCur ?? 0) >= 5 ? 0.1 : 0.4;
      mins.set(p, ((1 - wTpl) * p.m.expMin + wTpl * tpl) * Math.exp(this.r.normal(0, sd)));
    }
    // Minutes des absents : on comble seulement le déficit jusqu'à 240 min, en priorité vers les cadres (∝ m^1,2)
    // et vers le même poste que les absents ; en cas d'excédent, on retire surtout aux rôles intermédiaires/banc.
    const absentGroups = new Map<string, number>();
    for (const ab of s.ps.filter((p) => !p.active && p.m.expMin > 0)) absentGroups.set(ab.m.group, (absentGroups.get(ab.m.group) ?? 0) + ab.m.expMin);
    const absentTot = [...absentGroups.values()].reduce((a, b) => a + b, 0);
    const cap = (p: PState) => Math.min(42, Math.max(36, p.m.expMin + 8));
    // Hiérarchie du coach : les minutes en trop (mercato, retours) sont retirées d'abord aux joueurs les plus faibles,
    // les minutes libérées vont d'abord aux meilleurs.
    const qRef = act.reduce((a, p) => a + p.m.quality * mins.get(p)!, 0) / Math.max(1, act.reduce((a, p) => a + mins.get(p)!, 0));
    const qs = P.qualityCut || 0;
    const lvl = (p: PState, k: number) => (qs > 0 ? Math.exp((k * (p.m.quality - qRef)) / qs) : 1);
    for (let it = 0; it < 10; it++) {
      const tot = [...mins.values()].reduce((a, b) => a + b, 0);
      const diff = 240 - tot;
      if (Math.abs(diff) < 0.05) break;
      if (diff > 0) {
        const room = act.filter((p) => mins.get(p)! < cap(p) - 0.01);
        const w = (p: PState) => Math.pow(Math.max(1, mins.get(p)!), 1.2) * (1 + (absentTot > 0 ? (2 * (absentGroups.get(p.m.group) ?? 0)) / absentTot : 0)) * lvl(p, 0.5);
        const ws = room.reduce((a, p) => a + w(p), 0);
        if (!ws) break;
        for (const p of room) mins.set(p, Math.min(cap(p), mins.get(p)! + (diff * w(p)) / ws));
      } else {
        const w = new Map(act.map((p) => [p, Math.max(0.01, mins.get(p)! * (1 - Math.min(mins.get(p)!, 46) / 48) ** 2 * lvl(p, -1))]));
        const ws = [...w.values()].reduce((a, b) => a + b, 0);
        for (const p of act) mins.set(p, Math.max(0, mins.get(p)! + (diff * w.get(p)!) / ws));
      }
    }
    for (const p of act) p.target = mins.get(p)! * 60;

    // Matrice de présence : départ = courbe du joueur, puis IPF.
    const M = act.map((p) => {
      const base = p.m.presence.length === 48 ? p.m.presence.slice() : new Array(48).fill(p.target / 2880);
      const tot = base.reduce((a, b) => a + b, 0) || 1;
      return base.map((v) => clamp((v * (p.target / 60)) / tot, 0, 1));
    });
    for (let it = 0; it < 12; it++) {
      for (let c = 0; c < 48; c++) {
        let col = 0;
        for (let i = 0; i < act.length; i++) col += M[i][c];
        if (col <= 0) continue;
        if (col > 5) for (let i = 0; i < act.length; i++) M[i][c] *= 5 / col;
        else {
          // Remplissage proportionnel à la marge restante (aucune probabilité > 1).
          let head = 0;
          for (let i = 0; i < act.length; i++) head += (1 - M[i][c]) * Math.max(0.05, M[i][c]);
          const need = 5 - col;
          if (head > 0) for (let i = 0; i < act.length; i++) M[i][c] = Math.min(1, M[i][c] + (need * (1 - M[i][c]) * Math.max(0.05, M[i][c])) / head);
        }
      }
      for (let i = 0; i < act.length; i++) {
        const row = M[i].reduce((a, b) => a + b, 0);
        const want = act[i].target / 60;
        if (row > 0) M[i] = M[i].map((v) => clamp((v * want) / row, 0, 1));
      }
    }
    act.forEach((p, i) => {
      p.pres = M[i];
      let c = 0;
      p.presCum = M[i].map((v) => (c += v * 60));
    });
  }

  // ------------------------------------------------------------------ utilitaires
  private onCourt(side: 0 | 1): PState[] {
    return this.S[side].lineup.map((li) => this.S[side].ps[li]);
  }
  private name(p: PState): string {
    return p.m.short;
  }
  private elapsed(): number {
    return this.t;
  }
  private margin(side: 0 | 1): number {
    return side === 0 ? this.score[0] - this.score[1] : this.score[1] - this.score[0];
  }
  private emit(e: Omit<SimEvent, 't' | 'p' | 'clock' | 'hs' | 'as'>): void {
    if (!this.log) return;
    this.ev.push({
      t: Math.round(this.t * 10) / 10, p: this.p, clock: Math.round(this.clock * 10) / 10, sc: Math.round(this.shotClock * 10) / 10,
      hs: this.score[0], as: this.score[1], fouls: [this.S[0].fouls, this.S[1].fouls], bonus: [this.inBonus(1), this.inBonus(0)], ...e,
    });
  }

  /** Fait avancer l'horloge de dt secondes (minutes jouées, durée des passages). */
  private tick(dt: number): void {
    if (dt <= 0) return;
    dt = Math.min(dt, this.clock);
    this.clock -= dt;
    this.t += dt;
    for (const side of [0, 1] as const) for (const p of this.onCourt(side)) p.sec += dt;
  }

  private addPoints(side: 0 | 1, pts: number, scorer: PState): void {
    if (!this.firstScorer) this.firstScorer = scorer.m.id;
    this.score[side] += pts;
    scorer.line.pts += pts;
    const S = this.S[side];
    S.q[this.p - 1] = (S.q[this.p - 1] ?? 0) + pts;
    for (const p of this.onCourt(side)) p.line.pm += pts;
    for (const p of this.onCourt(side === 0 ? 1 : 0)) p.line.pm -= pts;
    this.S[side === 0 ? 1 : 0].run += pts;
    this.S[side].run = 0;
    const lead = this.score[0] - this.score[1];
    const leader = lead > 0 ? 1 : lead < 0 ? -1 : 0;
    if (leader !== 0 && this.lastLeader !== 0 && leader !== this.lastLeader) this.leadChanges++;
    if (leader !== 0) this.lastLeader = leader;
    if (lead > this.largest[0]) this.largest[0] = lead;
    if (-lead > this.largest[1]) this.largest[1] = -lead;
  }

  /** Pénalité (lancers sur faute hors tir) : à partir de la 5e faute d'équipe du quart-temps (4e en prolongation),
   * ou de la 2e faute dans les 2 dernières minutes. Appelée avant de compter la faute en cours. */
  private inBonus(foulingSide: 0 | 1): boolean {
    const S = this.S[foulingSide];
    const limit = this.p > 4 ? 3 : 4;
    return S.fouls >= limit || (this.clock <= 120 && S.foulsLast2 >= 1);
  }

  // ------------------------------------------------------------------ rotations
  private lineupScore(p: PState, side: 0 | 1): number {
    if (!p.active || p.fouledOut) return -1e9;
    const t = this.elapsed();
    const minute = Math.min(47, Math.floor(t / 60));
    const reg = this.p <= 4;
    let s: number;
    if (reg) {
      const look = (p.pres[minute] + p.pres[Math.min(47, minute + 1)] + p.pres[Math.min(47, minute + 2)]) / 3;
      const expSoFar = minute > 0 ? p.presCum[minute - 1] + (t - minute * 60) * p.pres[minute] : t * p.pres[0];
      const debt = (expSoFar - p.sec) / 60; // minutes de retard (positif = doit jouer)
      s = look + 0.15 * clamp(debt, -6, 6);
    } else {
      s = p.pres[47] + p.target / 2880; // prolongation : joueurs de fin de match
    }
    if (p.on) {
      s += 0.14;
      const stint = this.t - p.stintStart;
      const lim = Math.max(240, p.m.stintMean * 1.35);
      if (stint > lim) s -= 0.25 * ((stint - lim) / 120);
    }
    // Fautes : prudence selon la période.
    const q = this.p;
    if ((q === 1 && p.pf >= 2) || (q === 2 && p.pf >= 3)) s -= 0.7;
    else if (q === 3 && p.pf >= 4) s -= 0.8;
    else if (q >= 4 && p.pf >= 5) s -= this.clock > 240 && q === 4 ? 1.6 : 0.5;
    // Fin de match serrée : les cadres.
    const margin = Math.abs(this.score[0] - this.score[1]);
    const crunch = this.p >= 4 && this.clock <= 300 && margin <= 10;
    const rank = this.S[side].ps.filter((x) => x.active).sort((a, b) => b.target - a.target).indexOf(p);
    if (crunch && rank < 6) s += 0.35 * p.target / 2400;
    // Garbage time.
    const garbage = this.p >= 4 && ((this.clock <= 300 && margin >= 20) || (this.clock <= 480 && margin >= 26));
    if (garbage) s += rank < 7 ? -1.2 : 0.4;
    return s + this.r.normal(0, 0.04);
  }

  private chooseLineup(side: 0 | 1): number[] {
    const S = this.S[side];
    const scored = S.ps.map((p) => ({ p, s: this.lineupScore(p, side) })).filter((x) => x.s > -1e8).sort((a, b) => b.s - a.s);
    const pick: PState[] = [];
    for (const { p } of scored) {
      if (pick.length >= 5) break;
      const bigs = pick.filter((x) => x.m.group === 'B').length;
      const guards = pick.filter((x) => x.m.group === 'G').length;
      // Garde-fous seulement pour les cas extrêmes : les courbes de présence reflètent déjà les vraies rotations.
      if (p.m.group === 'B' && bigs >= 3 && scored.length > 7) continue;
      if (p.m.group === 'G' && guards >= 4 && scored.length > 7) continue;
      pick.push(p);
    }
    for (const { p } of scored) {
      if (pick.length >= 5) break;
      if (!pick.includes(p)) pick.push(p);
    }
    // Moins de 5 joueurs éligibles (effectif court et exclusions pour fautes) : comme en NBA, les exclus restent en jeu.
    // Jamais un joueur absent du match, sauf effectif impossible (moins de 5 présents : garde-fou pour ne pas planter).
    if (pick.length < 5)
      for (const p of S.ps.filter((q) => !pick.includes(q) && q.active).sort((a, b) => b.m.expMin - a.m.expMin)) {
        if (pick.length >= 5) break;
        pick.push(p);
      }
    if (pick.length < 5)
      for (const p of S.ps.filter((q) => !pick.includes(q)).sort((a, b) => b.m.expMin - a.m.expMin)) {
        if (pick.length >= 5) break;
        pick.push(p);
      }
    return pick.map((p) => p.li);
  }

  /** Applique les changements (uniquement sur ballon mort). */
  private substitutions(force = false): void {
    const changes: Array<[0 | 1, number[], number[]]> = [];
    for (const side of [0, 1] as const) {
      const S = this.S[side];
      const want = this.chooseLineup(side);
      const cur = S.lineup;
      const inn = want.filter((li) => !cur.includes(li));
      const out = cur.filter((li) => !want.includes(li));
      if (!inn.length && !force) continue;
      for (const li of out) {
        const p = S.ps[li];
        p.on = false;
      }
      for (const li of inn) {
        const p = S.ps[li];
        p.on = true;
        p.stintStart = this.t;
        p.line.played = true;
      }
      S.lineup = want;
      if (inn.length) changes.push([side, inn.map((li) => S.ps[li].m.id), out.map((li) => S.ps[li].m.id)]);
    }
    if (changes.length) {
      this.assignDefense();
      for (const [side, inn, out] of changes) {
        const nIn = inn.map((id) => this.S[side].ps.find((p) => p.m.id === id)!.m.short);
        const nOut = out.map((id) => this.S[side].ps.find((p) => p.m.id === id)!.m.short);
        this.emit({ type: 'sub', side, inn, out, text: `${this.S[side].t.name}: ${nIn.join(', ')} in for ${nOut.join(', ')}`, on: this.lineups() });
      }
    }
  }

  private lineups(): [number[], number[]] {
    return [this.onCourt(0).map((p) => p.m.id), this.onCourt(1).map((p) => p.m.id)];
  }

  /** Assignation défensive (qui défend sur qui) : maximise l'affinité taille/usage/historique de duels. */
  private assignDefense(): void {
    const h2h = this.m.h2hMatchups;
    for (const off of [0, 1] as const) {
      const def = off === 0 ? 1 : 0;
      const O = this.onCourt(off);
      const D = this.onCourt(def);
      // Menace offensive (usage × niveau) : le coach met son meilleur défenseur sur la plus grosse menace et cache
      // son défenseur le plus faible sur l'attaquant le moins dangereux, dans les limites de la taille.
      const threat = (o: PState) => Math.max(0.05, o.m.usg) * Math.max(3, o.m.quality);
      const tAvg = O.reduce((a, o) => a + threat(o), 0) / Math.max(1, O.length);
      const cd = this.m.params.coachDef ?? 0;
      const aff = O.map((o) =>
        D.map((d) => {
          const gp = d.m.guardProfile;
          let a = -(((o.m.heightIn - gp.height) / 3) ** 2) - ((o.m.usg - gp.usg) / 0.06) ** 2;
          const hh = h2h[o.m.id]?.[d.m.id] ?? 0;
          a += 1.6 * Math.log1p(hh / 15);
          a += cd * (threat(o) / tAvg - 1) * (-d.m.dOverall / 0.1);
          return a;
        }),
      );
      // 5! = 120 permutations.
      let best = -Infinity;
      let bestPerm: number[] = [0, 1, 2, 3, 4];
      const n = Math.min(O.length, D.length);
      const perm = [...Array(n).keys()];
      const permute = (k: number) => {
        if (k === n) {
          let s = 0;
          for (let i = 0; i < n; i++) s += aff[i][perm[i]];
          if (s > best) {
            best = s;
            bestPerm = perm.slice();
          }
          return;
        }
        for (let i = k; i < n; i++) {
          [perm[k], perm[i]] = [perm[i], perm[k]];
          permute(k + 1);
          [perm[k], perm[i]] = [perm[i], perm[k]];
        }
      };
      permute(0);
      const map = new Map<number, number>();
      // Défense en sous-nombre (ne devrait plus arriver) : l'attaquant en trop prend le défenseur qui lui va le mieux.
      O.forEach((o, i) => {
        const j = i < n ? bestPerm[i] : aff[i].indexOf(Math.max(...aff[i]));
        if (D[j]) map.set(o.li, D[j].li);
      });
      this.assign[off] = map;
    }
  }

  // ------------------------------------------------------------------ boucle de match
  run(): GameResult {
    for (const side of [0, 1] as const) {
      this.S[side].lineup = this.startersOf(side);
      for (const li of this.S[side].lineup) {
        const p = this.S[side].ps[li];
        p.on = true;
        p.line.started = true;
        p.line.played = true;
        p.stintStart = 0;
      }
    }
    this.assignDefense();
    this.emit({ type: 'start', text: `${this.m.away.name} at ${this.m.home.name}`, on: this.lineups() });

    // Entre-deux : avantage de taille des sauteurs.
    const jumper = (side: 0 | 1) => this.onCourt(side).sort((a, b) => b.m.heightIn - a.m.heightIn)[0];
    const jh = jumper(0);
    const ja = jumper(1);
    const pHome = clamp(0.5 + 0.035 * (jh.m.heightIn - ja.m.heightIn), 0.2, 0.8);
    this.openingTipWinner = this.r.chance(pHome) ? 0 : 1;
    this.emit({ type: 'jump', side: this.openingTipWinner, pid: jh.m.id, pid2: ja.m.id, text: `${jh.m.short} and ${ja.m.short} go up` });

    let period = 1;
    while (true) {
      this.p = period;
      this.clock = period <= 4 ? 720 : 300;
      for (const S of this.S) {
        S.fouls = 0;
        S.foulsLast2 = 0;
        S.run = 0;
        S.q[period - 1] = 0;
        if (period === 5) S.timeouts = Math.max(S.timeouts, 2);
        if (period === 4) S.timeouts = Math.min(S.timeouts, 4);
      }
      let off: 0 | 1;
      if (period === 1) off = this.openingTipWinner;
      else if (period <= 4) off = period === 4 ? this.openingTipWinner : ((1 - this.openingTipWinner) as 0 | 1);
      else off = this.r.chance(0.5) ? 0 : 1;
      if (period > 1) {
        this.substitutions(true);
        this.emit({ type: 'period_start', side: off, text: period <= 4 ? `Start of Q${period}` : `Start of OT${period - 4}`, on: this.lineups() });
      }
      let start: StartKind = 'start';
      while (this.clock > 0.05) {
        const res = this.possession(off, start);
        start = res.next;
        off = res.nextOff;
      }
      this.emit({ type: 'period_end', text: period <= 4 ? `End of Q${period}` : `End of OT${period - 4}` });
      for (const side of [0, 1] as const) for (const p of this.onCourt(side)) p.stintStart = this.t;
      if (period >= 4 && this.score[0] !== this.score[1]) break;
      if (period >= 8) break; // 4 prolongations au plus : la taille du stockage (MAXQ, batch.ts)
      period++;
    }
    this.emit({ type: 'end', text: 'Final' });

    const team = (side: 0 | 1): TeamResult => {
      const S = this.S[side];
      const lines = S.ps.map((p) => ({ ...p.line, sec: Math.round(p.sec) }));
      return {
        pts: this.score[side], q: S.q.slice(), lines, poss: this.possCount[side],
        fga: lines.reduce((a, l) => a + l.fga, 0), fg3a: lines.reduce((a, l) => a + l.fg3a, 0), fta: lines.reduce((a, l) => a + l.fta, 0),
        tov: lines.reduce((a, l) => a + l.tov, 0) + this.teamTov[side], oreb: lines.reduce((a, l) => a + l.oreb, 0),
        ...this.prof[side],
      };
    };
    return {
      seed: 0, home: team(0), away: team(1), periods: this.p, firstScorer: this.firstScorer, leadChanges: this.leadChanges,
      largestLead: this.largest, events: this.log ? this.ev : undefined,
      active: [this.S[0].ps.filter((p) => p.active).map((p) => p.m.id), this.S[1].ps.filter((p) => p.active).map((p) => p.m.id)],
    };
  }
  possCount: [number, number] = [0, 0];
  teamTov: [number, number] = [0, 0];
  prof = [0, 1].map(() => ({ zFga: [0, 0, 0, 0, 0, 0], zFgm: [0, 0, 0, 0, 0, 0], astM: 0, transFga: 0, transFgm: 0, cont: [0, 0, 0, 0] }));

  private startersOf(side: 0 | 1): number[] {
    const S = this.S[side];
    const st = S.ps.filter((p) => p.active && p.m.starter).map((p) => p.li);
    if (st.length >= 5) return st.slice(0, 5);
    const rest = S.ps.filter((p) => p.active && !st.includes(p.li)).sort((a, b) => b.target - a.target);
    for (const p of rest) {
      if (st.length >= 5) break;
      st.push(p.li);
    }
    return st;
  }

  // ------------------------------------------------------------------ possession
  private possession(off: 0 | 1, start: StartKind): { next: StartKind; nextOff: 0 | 1 } {
    const def: 0 | 1 = off === 0 ? 1 : 0;
    const O = this.S[off];
    const D = this.S[def];
    const P = this.m.params;
    // Changements uniquement sur ballon mort (le chrono ne s'arrête sur panier marqué qu'en fin de match).
    const clockStopsOnMake = this.p >= 4 && this.clock <= 120;
    const deadBall = start === 'deadTO' || start === 'start' || start === 'ft' || (start === 'made' && clockStopsOnMake);
    const timeout = (start === 'made' || start === 'deadTO' || start === 'ft') && this.maybeTimeout(off, def);
    if (deadBall || timeout) this.substitutions();
    if (start !== 'oreb') this.possCount[off]++;
    this.shotClock = 24;

    const lateGame = this.p >= 4 && this.clock <= 120;
    const trailing = this.margin(off) < 0;
    const lead = this.margin(off);

    // Faute intentionnelle de l'équipe menée en fin de match.
    if (this.p >= 4 && this.clock <= 65 && lead >= 3 && lead <= 3 + Math.ceil(this.clock / 9) && this.clock > 2) {
      const dt = Math.min(this.clock, this.r.uniform(1, 4));
      this.tick(dt);
      const target = this.pickWeighted(this.onCourt(off), (p) => Math.sqrt(Math.max(0.05, p.m.usg)) * (1.15 - p.m.ft));
      const pickFouler = () => this.pickWeighted(this.onCourt(def), (p) => (1 + p.m.pfOther * 20) * (p.pf >= 5 ? 0.05 : p.pf >= 4 ? 0.4 : 1));
      if (!this.inBonus(def)) {
        // Pas encore en pénalité : faute « à donner », remise en jeu, puis on refait faute aussitôt.
        const first = pickFouler();
        this.commitFoul(first, def, false);
        this.emit({ type: 'foul', side: def, pid: first.m.id, pid2: target.m.id, kind: 'take', text: `${first.m.short} fouls ${target.m.short} on purpose (foul to give)` });
        this.tick(Math.max(0, Math.min(this.clock - 0.1, this.r.uniform(0.5, 2))));
      }
      const fouler = pickFouler();
      this.commitFoul(fouler, def, false);
      this.emit({ type: 'foul', side: def, pid: fouler.m.id, pid2: target.m.id, kind: 'take', text: `${fouler.m.short} fouls ${target.m.short} on purpose` });
      return this.freeThrows(target, off, 2, 'foul');
    }

    // Faute technique (1 lancer, possession conservée).
    if (this.r.chance(P.techRate)) {
      const tSide: 0 | 1 = this.r.chance(0.5) ? off : def;
      const culprit = this.pickWeighted(this.onCourt(tSide), () => 1);
      const shooterT = this.onCourt(tSide === 0 ? 1 : 0).sort((a, b) => b.m.ft - a.m.ft)[0];
      this.emit({ type: 'foul', side: tSide, pid: culprit.m.id, kind: 'technical', text: `Technical foul on ${culprit.m.short}` });
      shooterT.line.fta++;
      const ok = this.r.chance(shooterT.m.ft);
      if (ok) {
        shooterT.line.ftm++;
        this.addPoints(shooterT.side, 1, shooterT);
      }
      this.emit({ type: 'ft', side: shooterT.side, pid: shooterT.m.id, made: ok, pts: ok ? 1 : 0, n: 1, kind: 'technical', text: `${shooterT.m.short} ${ok ? 1 : 0} of 1 (technical)` });
    }

    // Transition ?
    const ps = start === 'oreb' ? 0 : O.t.transOff[start === 'ft' ? 'made' : start] ?? 0.05;
    const pTrans = clamp(ps * D.t.transDefMult * this.lever[off].trans, 0, 0.85);
    let isTrans = (start === 'dreb' || start === 'steal') && this.r.chance(pTrans);
    if (start === 'made' && this.r.chance(pTrans * 0.6)) isTrans = true;
    let kind = isTrans ? 'transition' : start === 'oreb' ? 'second chance' : 'half court';
    let segment = start === 'oreb' ? 1 : 0;
    let putbackBy: PState | null = null;

    for (;;) {
      if (this.clock <= 0.05) return { next: 'start', nextOff: def };
      this.shotClock = segment === 0 ? 24 : 14;

      // Faute défensive hors tir (bonus ou remise en jeu).
      // Les fautes hors tir se concentrent en fin de quart-temps (équipes dans le bonus, fautes « à donner »).
      const plen = this.p <= 4 ? 720 : 300;
      const ramp = 0.55 + 0.9 * (1 - this.clock / plen);
      if (!putbackBy && this.r.chance(ramp * this.whistle * P.foulMult * D.t.foulRate * (off === 0 ? P.homeFoulMult : 1 / P.homeFoulMult))) {
        const dt = Math.min(this.clock, this.r.uniform(2, 9));
        this.tick(dt);
        this.shotClock -= dt;
        const fouler = this.pickWeighted(this.onCourt(def), (p) => (p.m.pfOther + 0.002) * (p.pf >= 5 ? 0.5 : 1));
        const victim = this.pickWeighted(this.onCourt(off), (p) => p.m.drawOther + (this.inBonus(def) ? p.m.drawBonus : 0) + 0.004);
        const bonus = this.inBonus(def);
        this.commitFoul(fouler, def, false);
        this.emit({ type: 'foul', side: def, pid: fouler.m.id, pid2: victim.m.id, kind: 'personal', text: `${fouler.m.short} personal foul${bonus ? `, ${victim.m.short} to the line` : ''}` });
        if (bonus) return this.freeThrows(victim, off, 2, 'bonus');
        if (this.clock <= 0.05) return { next: 'start', nextOff: def };
        this.substitutions();
        this.shotClock = Math.max(this.shotClock, 14);
      }

      // Qui finit l'action, sur quel type de jeu.
      const oc = this.onCourt(off);
      let shooter: PState;
      let pt: PT;
      let handler: PState | undefined;
      let screener: PState | undefined;
      let mismatch: [number, number] | undefined;
      let primaryDef: PState;
      if (putbackBy) {
        shooter = putbackBy;
        pt = 'OffRebound';
        kind = 'second chance';
      } else if (isTrans && segment === 0) {
        pt = 'Transition';
        shooter = this.pickWeighted(oc, (p) => p.m.pt.Transition * p.usage + 0.002);
      } else {
        const ws: number[] = [];
        const opts: Array<[PState, PT]> = [];
        for (const p of oc) {
          const hunt = this.huntFactor(p, off);
          for (const k of HALF_COURT_PT) {
            let w = p.m.pt[k] * p.usage * Math.sqrt(D.t.ptDefMult[k]) * hunt;
            if (lateGame && trailing && (k === 'Spotup' || k === 'OffScreen')) w *= 1.3;
            ws.push(w);
            opts.push([p, k]);
          }
        }
        const idx = this.r.pick(ws);
        [shooter, pt] = opts[idx];
      }
      primaryDef = this.S[def].ps[this.assign[off].get(shooter.li) ?? this.S[def].lineup[0]];

      // Pick-and-roll : porteur, écran, switch éventuel -> mismatch.
      if (pt === 'PRBallHandler' || pt === 'PRRollman') {
        const others = oc.filter((p) => p !== shooter);
        if (pt === 'PRBallHandler') {
          handler = shooter;
          screener = this.pickWeighted(others, (p) => p.m.pt.PRRollman + (p.m.group === 'B' ? 0.02 : 0.004));
        } else {
          screener = shooter;
          handler = this.pickWeighted(others, (p) => p.m.pt.PRBallHandler + 0.002);
        }
        const hDef = this.S[def].ps[this.assign[off].get(handler.li)!];
        const sDef = this.S[def].ps[this.assign[off].get(screener.li)!];
        if (hDef && sDef && this.r.chance(D.t.switchRate)) {
          // Switch : le défenseur de l'écran passe sur le porteur.
          primaryDef = pt === 'PRBallHandler' ? sDef : hDef;
          const victim = pt === 'PRBallHandler' ? handler : screener;
          if (Math.abs(primaryDef.m.heightIn - victim.m.heightIn) >= 5) mismatch = [primaryDef.m.id, victim.m.id];
          // Sur un mismatch clair, l'attaque en profite plus souvent en isolation au tour suivant.
        }
      } else if (pt === 'Isolation' || pt === 'Postup') {
        handler = shooter;
      } else if (!isTrans) {
        handler = this.pickWeighted(oc.filter((p) => p !== shooter), (p) => p.m.pt.PRBallHandler + p.m.pt.Isolation + 0.01);
      }

      // Durée jusqu'à la décision.
      let dur: number;
      if (pt === 'OffRebound') dur = this.r.uniform(0.6, 2.6);
      else if (pt === 'Transition') dur = clamp(this.r.gammaMean(5.5, 4), 2, 11);
      else {
        let mu = O.t.hcDurOff * D.t.hcDurDef * P.durScale / this.paceMult;
        if (segment > 0) mu *= 0.62;
        if (lateGame && trailing && lead >= -12) mu *= 0.65;
        if (lateGame && lead > 0) mu *= 1.3;
        dur = this.r.gammaMean(mu, 3.2);
      }
      let lateClock = false;
      if (dur > this.shotClock - 0.4) {
        dur = this.shotClock - this.r.uniform(0.3, 1.6);
        lateClock = true;
      }
      // Fin de période : dernier tir, 2-pour-1.
      const endPeriod = dur >= this.clock - 0.3;
      if (this.clock <= 24.5 && this.clock < this.shotClock && !isTrans && pt !== 'OffRebound' && this.r.chance(0.85)) {
        dur = Math.max(0.2, this.clock - this.r.uniform(0.3, 2.8));
      } else if (endPeriod) {
        dur = Math.max(0.2, this.clock - this.r.uniform(0.1, 1.2));
      } else if (segment === 0 && this.clock > 28 && this.clock <= 40 && !isTrans && this.r.chance(0.6)) {
        dur = Math.min(dur, Math.max(2, this.clock - 26 - this.r.uniform(0, 4)));
      }
      const passes = this.log ? this.passChain(oc, shooter, handler, pt) : undefined;
      if (this.log) {
        this.emit({
          type: 'poss', side: off, kind: segment > 0 ? 'second chance' : kind, pt, pid: shooter.m.id, handler: handler?.m.id, screener: screener?.m.id,
          mismatch, passes, def: primaryDef.m.id,
          text: `${O.t.name.toUpperCase()} BALL`,
        });
      }
      this.tick(dur);
      this.shotClock = Math.max(0, this.shotClock - dur);

      // Heave : quelques dixièmes au chrono et ballon loin du panier.
      if (this.clock <= 0.05 && dur < 1.5 && pt !== 'OffRebound') {
        const heave = this.r.chance(0.03);
        shooter.line.fga++;
        shooter.line.fg3a++;
        if (heave) {
          shooter.line.fgm++;
          shooter.line.fg3m++;
          this.addPoints(off, 3, shooter);
        }
        this.emit({ type: 'shot', side: off, pid: shooter.m.id, made: heave, pts: heave ? 3 : 0, zone: 5, x: 0, y: 600, label: 'heave', text: heave ? `${shooter.m.short} banks in a heave!` : `${shooter.m.short} heave no good` });
        return { next: 'start', nextOff: def };
      }

      // Issue de la possession.
      const eff = shooter.m.eff[pt];
      const dOn = this.onCourt(def);
      const lineupStl = dOn.reduce((a, p) => a + p.m.stl, 0) / 0.065;
      const Lv = this.lever[off];
      const tovP = clamp(eff.tov * D.t.tovForceMult * Math.sqrt(clamp(lineupStl, 0.6, 1.6)) * (lateClock ? 1.1 : 1) * Lv.tov, 0, 0.5);
      const sfP = clamp(P.sfMult * this.whistle * eff.sfMiss * (off === 0 ? P.homeFoulMult : 1 / P.homeFoulMult) * Lv.fta, 0, 0.35);
      const u = this.r.next();
      if (u < tovP) return this.turnover(shooter, off, def, primaryDef, pt, lateClock);
      if (u < tovP + sfP) {
        // Faute de tir sur tentative manquée : surtout sur pénétration (≈ 8 % seulement sur tirs à 3 pts).
        const share3 = shooter.m.zone[pt][3] + shooter.m.zone[pt][4] + shooter.m.zone[pt][5];
        const z = this.r.chance(clamp(0.08 * (share3 / 0.4), 0.01, 0.25)) ? 5 : this.r.pick([0.62, 0.25, 0.13, 0, 0, 0]);
        const fouler = this.shootingFouler(dOn, primaryDef);
        this.commitFoul(fouler, def, true);
        const n = THREE[z] ? 3 : 2;
        this.emit({ type: 'foul', side: def, pid: fouler.m.id, pid2: shooter.m.id, zone: z, kind: 'shooting', text: `${fouler.m.short} fouls ${shooter.m.short} on the shot` });
        return this.freeThrows(shooter, off, n, 'shooting');
      }

      // Tir.
      const z = this.pickZone(shooter, pt, off, def);
      const contest = this.contestDefender(z, primaryDef, def, false);
      const spot = this.shotSpot(shooter, z);
      const three = THREE[z];
      let lp = logit(shooter.m.fg[z]) + eff.adj + P.fgBias + (P.teamBias?.[off] ?? 0);
      // Distance dans la zone : pente de la ligue, centrée sur les tirs habituels du joueur (moyenne nulle pour lui).
      if (shooter.m.spots[z]?.length && this.m.league.distFg?.length) {
        const dft = Math.min(40, Math.floor(Math.hypot(spot[0], spot[1]) / 10));
        lp += (P.distWeight ?? 0) * (logit(this.m.league.distFg[dft]) - (shooter.m.spotLogit?.[z] ?? 0));
      }
      // Contestation : niveau tiré selon les habitudes du tireur et la défense adverse (relative à la ligue),
      // puis adresse du joueur à ce niveau, relative à son adresse moyenne (effet nul contre une défense moyenne).
      const C = shooter.m.contest;
      const Dc = D.t.defContest;
      const Lc = this.m.league.contest;
      let contestLevel: number | undefined;
      if (C && Dc && Lc && P.contestWeight) {
        const sh = three ? C.s3 : C.s2;
        const fg = three ? C.f3 : C.f2;
        const dw = three ? Dc.s3 : Dc.s2;
        const lw = three ? Lc.s3 : Lc.s2;
        const tilt = this.lever[off].tilt;
        const w = sh.map((v, c) => v * (dw[c] / Math.max(1e-6, lw[c])) * Math.exp(tilt * (c - 1.5)));
        const tot = w.reduce((a, v) => a + v, 0) || 1;
        contestLevel = this.r.pick(w.map((v) => v / tot));
        const avg = sh.reduce((a, v, c) => a + v * fg[c], 0);
        lp += P.contestWeight * (logit(fg[contestLevel]) - logit(avg));
      }
      // Duel : historique du tireur face au défenseur qui conteste.
      lp += (P.duelWeight ?? 0) * (this.m.duel?.[shooter.m.id]?.[contest.m.id] ?? 0);
      lp += this.lever[off].make + (contestLevel != null ? 0 : this.lever[off].tiltLogit);
      const dd = z === 0 ? contest.m.dRim : z === 1 ? (contest.m.dRim + contest.m.dMid) / 2 : z === 2 ? contest.m.dMid : contest.m.d3;
      lp += P.defWeight * dd;
      if (off === 0) lp += P.homeFgLogit;
      else lp -= P.homeFgLogit;
      lp += O.night + (three ? O.night3 + (P.fg3Bias ?? 0) : 0) + shooter.night + this.gameNight;
      // Effet élastique : l'équipe qui mène se relâche, celle qui est menée élève son niveau.
      lp -= P.rubber * clamp(this.margin(off) / 10, -2.5, 2.5);
      lp -= (P.fatigueOff ?? 0.03) * (O.t.fatigue ?? (O.t.b2b ? 1 : 0));
      lp += (P.fatigueDef ?? 0) * (D.t.fatigue ?? 0);
      const stint = this.t - shooter.stintStart;
      if (stint > 540) lp -= 0.01 * ((stint - 540) / 60);
      if (mismatch && mismatch[1] === shooter.m.id) lp += 0.06;
      const pMake = logistic(lp);
      const made = this.r.chance(pMake);
      const pr = this.prof[off];
      pr.zFga[z]++;
      if (made) pr.zFgm[z]++;
      if (contestLevel != null) pr.cont[contestLevel]++;
      if (pt === 'Transition') {
        pr.transFga++;
        if (made) pr.transFgm++;
      }
      shooter.line.fga++;
      if (three) shooter.line.fg3a++;
      const label = this.shotLabel(shooter, z, pt);

      if (made) {
        shooter.line.fgm++;
        if (three) shooter.line.fg3m++;
        const pts = three ? 3 : 2;
        this.addPoints(off, pts, shooter);
        // Passe décisive.
        let assister: PState | undefined;
        // Effet « meneur » : plus de paniers assistés quand un grand passeur est sur le terrain.
        const lineupPass = oc.reduce((a, q) => (q === shooter ? a : a + q.m.astRate), 0) / (4 * 0.053);
        const pAst = clamp(P.astScale * shooter.m.astd[z] * (PT_AST_PRIOR[pt] / Math.max(0.05, shooter.m.astNorm?.[z] ?? 0.5)) * Math.pow(clamp(lineupPass, 0.5, 2.2), 0.35), 0, 0.97);
        if (this.r.chance(pAst)) {
          assister = pt === 'PRRollman' && handler ? handler : this.pickAssister(oc, shooter);
          if (assister) {
            assister.line.ast++;
            pr.astM++;
          }
        }
        const and1 = this.r.chance(clamp(this.whistle * eff.and1 * (off === 0 ? P.homeFoulMult : 1 / P.homeFoulMult), 0, 0.3));
        this.emit({
          type: 'shot', side: off, pid: shooter.m.id, pid2: assister?.m.id, made: true, pts, zone: z, x: spot[0], y: spot[1], pt, label, ct: contestLevel,
          def: contest.m.id, mismatch,
          text: `${shooter.m.short} ${this.verb(label, three, true)}${assister ? `, ${assister.m.short} assist` : ''}`,
        });
        if (and1) {
          const fouler = this.shootingFouler(dOn, contest);
          this.commitFoul(fouler, def, true);
          this.emit({ type: 'foul', side: def, pid: fouler.m.id, pid2: shooter.m.id, kind: 'and-one', text: `And one! ${fouler.m.short} with the foul` });
          return this.freeThrows(shooter, off, 1, 'and-one');
        }
        return { next: 'made', nextOff: def };
      }

      // Raté : contre ?
      const blkRate = dOn.reduce((a, p) => a + p.m.blk[z], 0);
      const pBlockGivenMiss = clamp(blkRate / Math.max(0.05, 1 - pMake), 0, 0.5);
      let blocker: PState | undefined;
      if (this.r.chance(pBlockGivenMiss)) {
        blocker = this.pickWeighted(dOn, (p) => p.m.blk[z] * (p === contest ? 2 : 1) + 1e-5);
        blocker.line.blk++;
      }
      this.emit({
        type: 'shot', side: off, pid: shooter.m.id, pid2: blocker?.m.id, made: false, pts: 0, zone: z, x: spot[0], y: spot[1], pt, label, def: contest.m.id, mismatch, ct: contestLevel,
        text: blocker ? `${blocker.m.short} blocks ${shooter.m.short}` : `${shooter.m.short} misses ${this.verb(label, three, false)}`,
      });
      // Temps de vol du ballon / lutte au rebond.
      this.tick(Math.min(this.clock, this.r.uniform(0.6, 2.0)));
      // Le temps est écoulé pendant que le ballon est en l'air : pas de rebond, fin de période.
      if (this.clock <= 0) return { next: 'start', nextOff: def };
      const reb = this.rebound(off, def, z, !!blocker);
      if (reb.side === off) {
        segment++;
        putbackBy = reb.player && RIM_ZONES[z] && this.r.chance(reb.player.m.putback) ? reb.player : null;
        if (!reb.player) putbackBy = null;
        kind = 'second chance';
        isTrans = false;
        continue;
      }
      return { next: 'dreb', nextOff: def };
    }
  }

  private maybeTimeout(off: 0 | 1, def: 0 | 1): boolean {
    // L'équipe qui encaisse une série (≥ 8-0) appelle un temps mort.
    for (const side of [off, def]) {
      const S = this.S[side];
      if (S.run >= 8 && S.timeouts > 0 && this.r.chance(0.7)) {
        S.timeouts--;
        S.run = 0;
        this.emit({ type: 'timeout', side, text: `Timeout ${S.t.name}` });
        return true;
      }
    }
    // Fin de match serrée : temps mort pour organiser l'attaque.
    if (this.p >= 4 && this.clock <= 40 && Math.abs(this.margin(off)) <= 3 && this.S[off].timeouts > 0 && this.r.chance(0.35)) {
      this.S[off].timeouts--;
      this.emit({ type: 'timeout', side: off, text: `Timeout ${this.S[off].t.name}` });
      return true;
    }
    return false;
  }

  private huntFactor(p: PState, off: 0 | 1): number {
    // « Qui se fait chasser » : défenseur plus faible que ceux que ce joueur affronte habituellement -> plus d'usage.
    const d = this.S[off === 0 ? 1 : 0].ps[this.assign[off].get(p.li) ?? 0];
    if (!d) return 1;
    // Asymétrique : on attaque un défenseur faible, mais on ne délaisse pas sa star face à un bon défenseur.
    return Math.exp(this.m.params.hunting * clamp((d.m.dOverall - p.m.typicalDefQ) / 0.12, 0, 1) * 0.5);
  }

  private pickWeighted(arr: PState[], w: (p: PState) => number): PState {
    return arr[this.r.pick(arr.map(w))];
  }
  private pickWeightedC(arr: PState[], w: (p: PState) => number): PState {
    return arr[this.rc.pick(arr.map(w))];
  }

  private pickZone(p: PState, pt: PT, off: 0 | 1, def: 0 | 1): number {
    const base = p.m.zone[pt];
    const dm = this.S[def].t.zoneDefMult;
    const lateTrail = this.p >= 4 && this.clock <= 120 && this.margin(off) < 0 && this.margin(off) >= -12;
    const tm = this.m.params.threeMult;
    const lz = this.lever[off].zone;
    const w = base.map((q, z) => q * Math.pow(dm[z], 0.7) * (THREE[z] ? tm * (lateTrail ? 1.5 : 1) : 1) * lz[z]);
    return this.r.pick(w);
  }

  private contestDefender(z: number, primary: PState, def: 0 | 1, foul: boolean): PState {
    const D = this.onCourt(def);
    const mult = z === 0 ? 1.6 : z === 1 ? 2.2 : z === 2 ? 3.5 : 3.0;
    return this.pickWeighted(D, (d) => {
      const rate = RIM_ZONES[z] ? d.m.rimRate : z === 2 ? d.m.midRate : d.m.threeRate;
      return (rate + 0.01) * (d === primary ? mult : 1) * (foul ? 0.5 + d.m.pfShoot * 25 : 1);
    });
  }

  /** Auteur d'une faute de tir : taux réel de fautes de tir de chaque défenseur, le défenseur direct pesant davantage. */
  private shootingFouler(dOn: PState[], primary: PState): PState {
    return this.pickWeighted(dOn, (d) => (d.m.pfShoot + 0.002) * (d === primary ? 1.8 : 1) * (d.pf >= 5 ? 0.5 : 1));
  }

  private shotSpot(p: PState, z: number): [number, number] {
    const spots = p.m.spots[z];
    if (spots && spots.length) {
      const s = spots[Math.floor(this.r.next() * spots.length)];
      return [s[0], s[1]];
    }
    // Position générique par zone.
    const ang = this.r.uniform(-1.2, 1.2);
    const dist = [20, 90, 170, 235, 235, 255][z];
    if (z === 3) return [-225, this.r.uniform(0, 80)];
    if (z === 4) return [225, this.r.uniform(0, 80)];
    return [Math.round(Math.sin(ang) * dist), Math.round(Math.cos(ang) * dist)];
  }

  private shotLabel(p: PState, z: number, pt: PT): string {
    if (pt === 'OffRebound' && RIM_ZONES[z]) return this.r.chance(0.5) ? 'putback layup' : 'tip shot';
    const labs = p.m.labels[z];
    if (labs && labs.length) {
      const i = this.r.pick(labs.map((x) => x[1]));
      return labs[i][0];
    }
    return THREE[z] ? 'jumper' : z === 0 ? 'layup' : 'jumper';
  }

  private verb(label: string, three: boolean, made: boolean): string {
    const l = label.replace('jump shot', 'jumper');
    if (three) {
      const pre = l.includes('step back') ? 'step-back ' : l.includes('pullup') ? 'pull-up ' : '';
      return made ? `${pre}three` : `a ${pre}three`;
    }
    if (made) return l;
    return /^[aeiou]/.test(l) ? `an ${l}` : `a ${l}`;
  }

  /** Passeur décisif : taux réel de passes décisives du joueur × affinité du duo (part de ses passes vers ce tireur). */
  private pickAssister(oc: PState[], shooter: PState): PState | undefined {
    const mates = oc.filter((p) => p !== shooter);
    if (!mates.length) return undefined;
    // Duo « connu » : historique de passes dans un sens ou dans l'autre. Un duo nouveau (mercato) reste neutre.
    const knownPair = (a: PState, b: PState) => (a.m.astTo[b.m.id] ?? 0) > 0 || (b.m.astTo[a.m.id] ?? 0) > 0;
    return this.pickWeighted(mates, (p) => {
      let pair = 1;
      if (knownPair(p, shooter)) {
        const known = oc.filter((q) => q !== p && knownPair(p, q));
        const tot = known.reduce((a, q) => a + (p.m.astTo[q.m.id] ?? 0), 0);
        if (tot > 5) pair = ((p.m.astTo[shooter.m.id] ?? 0) / tot) * known.length;
      }
      return Math.pow(p.m.astRate + 0.003, this.m.params.astGamma) * (0.4 + 0.6 * clamp(pair, 0.3, 3));
    });
  }

  private passChain(oc: PState[], shooter: PState, handler: PState | undefined, pt: PT): number[] {
    // Séquence de porteurs du ballon pour l'animation (réseau de passes du tracking).
    const chain: PState[] = [];
    const first = handler ?? this.pickWeightedC(oc, (p) => p.m.pt.PRBallHandler + p.m.pt.Isolation + 0.01);
    chain.push(first);
    const n = pt === 'Transition' || pt === 'OffRebound' ? 0 : pt === 'Isolation' || pt === 'Postup' ? (this.rc.chance(0.5) ? 1 : 0) : this.rc.pick([0.25, 0.4, 0.25, 0.1]);
    let cur = first;
    for (let i = 0; i < n; i++) {
      const mates = oc.filter((p) => p !== cur);
      const nxt = this.pickWeightedC(mates, (p) => (cur.m.passTo[p.m.id] ?? 0) + 15);
      chain.push(nxt);
      cur = nxt;
    }
    if (chain[chain.length - 1] !== shooter) chain.push(shooter);
    return chain.map((p) => p.m.id);
  }

  private commitFoul(p: PState, side: 0 | 1, shooting: boolean): void {
    void shooting;
    p.pf++;
    p.line.pf++;
    const S = this.S[side];
    S.fouls++;
    if (this.clock <= 120) S.foulsLast2++;
    if (p.pf >= 6) {
      p.fouledOut = true;
      this.emit({ type: 'foul', side, pid: p.m.id, kind: 'foul-out', text: `${p.m.short} fouls out` });
    }
  }

  private turnover(p: PState, off: 0 | 1, def: 0 | 1, primary: PState, pt: PT, lateClock: boolean): { next: StartKind; nextOff: 0 | 1 } {
    void pt;
    p.line.tov++;
    const dOn = this.onCourt(def);
    const lineupStl = dOn.reduce((a, q) => a + q.m.stl, 0) / 0.065;
    const offFoul = this.r.chance(clamp(0.12 * Math.sqrt(p.m.pfOff / 0.006), 0.04, 0.3));
    if (offFoul) {
      p.pf++;
      p.line.pf++;
      if (p.pf >= 6) p.fouledOut = true;
      this.emit({ type: 'tov', side: off, pid: p.m.id, kind: 'offensive foul', text: `Offensive foul on ${p.m.short}` });
      return { next: 'deadTO', nextOff: def };
    }
    if (lateClock && this.r.chance(0.25)) {
      this.teamTov[off]++;
      p.line.tov--;
      this.emit({ type: 'tov', side: off, kind: 'shot clock', text: `${this.S[off].t.name}: shot clock violation` });
      return { next: 'deadTO', nextOff: def };
    }
    const live = this.r.chance(clamp(p.m.tovLiveShare * Math.pow(clamp(lineupStl, 0.6, 1.6), 0.3), 0.2, 0.85));
    if (live) {
      const stealer = this.pickWeighted(dOn, (q) => (q.m.stl + 0.002) * (q === primary ? 2 : 1));
      stealer.line.stl++;
      this.emit({ type: 'tov', side: off, pid: p.m.id, pid2: stealer.m.id, kind: 'steal', text: `${stealer.m.short} steals it from ${p.m.short}` });
      return { next: 'steal', nextOff: def };
    }
    const what = this.r.pick([0.45, 0.25, 0.3]);
    this.emit({ type: 'tov', side: off, pid: p.m.id, kind: ['bad pass', 'traveling', 'out of bounds'][what], text: `${p.m.short} turnover (${['bad pass', 'traveling', 'out of bounds'][what]})` });
    return { next: 'deadTO', nextOff: def };
  }

  private freeThrows(p: PState, off: 0 | 1, n: number, why: string): { next: StartKind; nextOff: 0 | 1 } {
    const def: 0 | 1 = off === 0 ? 1 : 0;
    // Pas de changement entre les lancers : le tireur reste ; les remplacements se font au ballon mort suivant.
    let made = 0;
    let lastMade = false;
    for (let i = 0; i < n; i++) {
      p.line.fta++;
      const ok = this.r.chance(clamp(p.m.ft, 0.3, 0.97));
      if (ok) {
        p.line.ftm++;
        made++;
        this.addPoints(off, 1, p);
      }
      lastMade = ok;
    }
    this.emit({ type: 'ft', side: off, pid: p.m.id, made: made > 0, pts: made, n, kind: why, text: `${p.m.short} ${made} of ${n} at the line` });
    if (lastMade) return { next: 'ft', nextOff: def };
    // Lancers tirés après la sirène (faute au buzzer) : la période est finie, pas de rebond.
    if (this.clock <= 0) return { next: 'start', nextOff: def };
    // Dernier lancer manqué : rebond.
    const oreb = this.r.chance(this.m.league.orebFt);
    const side = oreb ? off : def;
    const rb = this.pickWeighted(this.onCourt(side), (q) => Math.pow((oreb ? q.m.orb : q.m.drb) + 0.005, this.m.params.rebGamma));
    if (oreb) rb.line.oreb++;
    else rb.line.dreb++;
    this.emit({ type: 'reb', side, pid: rb.m.id, kind: oreb ? 'offensive' : 'defensive', text: `${rb.m.short} ${oreb ? 'offensive' : 'defensive'} rebound` });
    if (oreb) return { next: 'oreb', nextOff: off };
    return { next: 'dreb', nextOff: def };
  }

  private rebound(off: 0 | 1, def: 0 | 1, z: number, blocked: boolean): { side: 0 | 1; player?: PState } {
    const O = this.onCourt(off);
    const D = this.onCourt(def);
    const L = this.m.league;
    const lgO = L.orebByZone.reduce((a, v, i) => a + v * L.zoneFreq[i], 0);
    const So = O.reduce((a, p) => a + p.m.orb, 0) / 0.94;
    const Sd = D.reduce((a, p) => a + p.m.drb, 0) / 0.94;
    const odds = (x: number) => clamp(x, 0.02, 0.98) / (1 - clamp(x, 0.02, 0.98));
    let o = (this.m.params.orebMult * odds(So) * odds(1 - Sd)) / odds(lgO);
    o *= odds(L.orebByZone[z]) / odds(lgO);
    if (blocked) o *= 1.15;
    o *= this.lever[off].orb;
    const pO = o / (1 + o);
    const isOff = this.r.chance(pO);
    const side: 0 | 1 = isOff ? off : def;
    // Rebond d'équipe (ballon sorti) : pas de joueur crédité.
    if (this.r.chance(this.m.params.teamRebShare)) {
      this.emit({ type: 'reb', side, kind: isOff ? 'offensive' : 'defensive', text: `${this.S[side].t.name} ball (team rebound)` });
      return { side };
    }
    const grp = (p: PState) => (RIM_ZONES[z] ? (p.m.group === 'B' ? 1.15 : p.m.group === 'G' ? 0.9 : 1) : THREE[z] ? (p.m.group === 'G' ? 1.12 : p.m.group === 'B' ? 0.9 : 1) : 1);
    const pool = isOff ? O : D;
    const rb = this.pickWeighted(pool, (p) => Math.pow((isOff ? p.m.orb : p.m.drb) + 0.004, this.m.params.rebGamma) * grp(p));
    if (isOff) rb.line.oreb++;
    else rb.line.dreb++;
    this.emit({ type: 'reb', side, pid: rb.m.id, kind: isOff ? 'offensive' : 'defensive', text: `${rb.m.short} ${isOff ? 'offensive' : 'defensive'} rebound` });
    return { side, player: rb };
  }
}

export type StartKind = 'made' | 'dreb' | 'steal' | 'deadTO' | 'start' | 'ft' | 'oreb';

export function simulateGame(m: GameModel, seed: number, opt: SimOptions = {}): GameResult {
  const g = new GameSim(m, seed, opt);
  const res = g.run();
  res.seed = seed;
  return res;
}

export type { Z6 };
