// Parseur de play-by-play : reconstitue les 5 sur le terrain, les possessions et tous les évènements
// individuels (tirs par zone avec défenseurs présents, passes décisives, contres, interceptions, fautes, rebonds).
import type { Act, GameRecord } from '../../data/cdn.ts';
import { zoneOf, isThree, type Zone } from './zones.ts';

export type StartType = 'made' | 'dreb' | 'steal' | 'deadTO' | 'start';
export const START_TYPES: StartType[] = ['made', 'dreb', 'steal', 'deadTO', 'start'];

export interface ShotRec {
  pid: number;
  tm: number;
  zone: Zone;
  x: number;
  y: number;
  made: 0 | 1;
  ast?: number;
  blk?: number;
  fb: boolean; // contre-attaque (qualifier officiel)
  second: boolean; // seconde chance (après rebond offensif)
  putback: boolean;
  and1: boolean;
  sub?: string; // subType (Jump Shot, Layup, DUNK, Hook...)
  ds?: string; // descriptor (pullup, driving, step back, alley-oop...)
  p: number;
  c: number;
  def: number[]; // 5 défenseurs sur le terrain
  home: boolean;
  margin: number; // écart (équipe qui tire) avant le tir
}

export interface PossRec {
  tm: number;
  start: StartType;
  dur: number; // secondes entre le début et la première décision (tir / perte / lancers)
  trans: boolean;
  pts: number;
  home: boolean;
  p: number;
  startClock: number;
}

export interface PlayerGame {
  pid: number;
  tm: number;
  starter: boolean;
  sec: number; // secondes sur le terrain (inférées)
  offPoss: number;
  defPoss: number;
  presence: number[]; // secondes par minute de jeu (0..47) + [48] = prolongations
  fta: number;
  ftm: number;
  tov: number;
  tovLive: number;
  stl: number;
  blk: number;
  pfShoot: number;
  pfOther: number;
  pfOff: number;
  fdShoot: number; // fautes de tir provoquées
  fdOther: number; // fautes hors tir provoquées
  fdBonus: number; // dont en situation de bonus (lancers)
  oreb: number;
  dreb: number;
  orebOpp: number;
  drebOpp: number;
  oppFgaOn: Record<Zone, number>; // tirs adverses par zone pendant sa présence (pour taux de contre)
  stints: number[]; // longueurs des passages sur le terrain (s)
}

export interface TeamGame {
  tm: number;
  home: boolean;
  poss: number;
  pts: number;
  starts: Record<StartType, number>;
  transByStart: Record<StartType, number>;
  durSum: number; // durée cumulée des possessions demi-terrain (1re décision)
  durN: number;
  nonShootFouls: number; // fautes défensives hors tir commises
  shootFoulsNoMake: number; // fautes de tir sur tentative manquée (2 ou 3 LF, pas de FGA)
  shootFoulsThree: number;
  timeouts: number;
  liveTov: number;
  deadTov: number;
}

export interface ParsedGame {
  gameId: string;
  date: string;
  homeId: number;
  awayId: number;
  shots: ShotRec[];
  poss: PossRec[];
  players: Map<number, PlayerGame>;
  teams: Map<number, TeamGame>;
  ast: Array<[number, number]>; // [passeur, marqueur]
  rebByZone: Array<{ zone: Zone | 'FT'; off: boolean }>;
  ftMissOreb: { n: number; off: number };
  lineupOk: boolean;
}

const elapsed = (p: number, c: number): number => (p <= 4 ? (p - 1) * 720 + (720 - c) : 2880 + (p - 5) * 300 + (300 - c));
const periodLen = (p: number): number => (p <= 4 ? 720 : 300);

function emptyZoneRec(): Record<Zone, number> {
  return { RA: 0, PAINT: 0, MID: 0, LC3: 0, RC3: 0, ATB3: 0 };
}
function emptyStartRec(): Record<StartType, number> {
  return { made: 0, dreb: 0, steal: 0, deadTO: 0, start: 0 };
}

/** Personnes impliquées dans une action, avec leur équipe. */
function involved(a: Act, home: number, away: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!a.tm) return out;
  const other = a.tm === home ? away : home;
  if (a.at === 'substitution' || a.at === 'timeout' || a.at === 'jumpball') return out;
  if (a.at === 'foul' && (a.st === 'technical' || a.ds === 'technical' || a.st === 'double')) return out;
  if (a.at === 'ejection' || a.at === 'instantreplay' || a.at === 'stoppage') return out;
  const isTeamAct = a.q?.includes('team');
  if (a.pid && !isTeamAct) out.push([a.pid, a.tm]);
  if (a.ast) out.push([a.ast, a.tm]);
  if (a.blk) out.push([a.blk, other]);
  if (a.stl) out.push([a.stl, other]);
  if (a.fd) out.push([a.fd, other]);
  return out;
}

function inferPeriodStarters(acts: Act[], teamId: number, home: number, away: number, played: Set<number>, prevEnd: number[]): number[] {
  const subbedIn = new Set<number>();
  const seen = new Set<number>();
  const starters: number[] = [];
  for (const a of acts) {
    if (a.at === 'substitution' && a.tm === teamId && a.pid) {
      if (a.st === 'in') {
        subbedIn.add(a.pid);
        seen.add(a.pid);
      } else if (a.st === 'out' && !seen.has(a.pid)) {
        starters.push(a.pid);
        seen.add(a.pid);
      }
      continue;
    }
    for (const [pid, tm] of involved(a, home, away)) {
      if (tm !== teamId || seen.has(pid) || subbedIn.has(pid) || !played.has(pid)) continue;
      starters.push(pid);
      seen.add(pid);
    }
    if (starters.length >= 5) break;
  }
  if (starters.length < 5) {
    // Joueur resté toute la période sans action enregistrée : on complète avec la fin de période précédente.
    for (const pid of prevEnd) {
      if (starters.length >= 5) break;
      if (!seen.has(pid)) {
        starters.push(pid);
        seen.add(pid);
      }
    }
  }
  return starters.slice(0, 5);
}

export function shotLabel(sub?: string, ds?: string): string {
  const s = (sub ?? '').toLowerCase();
  const d = (ds ?? '').toLowerCase();
  const base = s === 'dunk' ? 'dunk' : s === 'layup' ? 'layup' : s === 'hook' ? 'hook shot' : s === 'jump shot' ? 'jumper' : s || 'shot';
  return d ? `${d} ${base}` : base;
}

export function parseGame(g: GameRecord): ParsedGame {
  const home = g.home.id;
  const away = g.away.id;
  const acts = g.actions;
  const played = new Set<number>();
  for (const t of [g.home, g.away]) for (const p of t.players) if (p.sec > 0) played.add(p.id);
  const teamOf = new Map<number, number>();
  for (const p of g.home.players) teamOf.set(p.id, home);
  for (const p of g.away.players) teamOf.set(p.id, away);

  const players = new Map<number, PlayerGame>();
  const P = (pid: number): PlayerGame => {
    let r = players.get(pid);
    if (!r) {
      r = {
        pid, tm: teamOf.get(pid) ?? 0, starter: false, sec: 0, offPoss: 0, defPoss: 0, presence: new Array(49).fill(0),
        fta: 0, ftm: 0, tov: 0, tovLive: 0, stl: 0, blk: 0, pfShoot: 0, pfOther: 0, pfOff: 0, fdShoot: 0, fdOther: 0, fdBonus: 0,
        oreb: 0, dreb: 0, orebOpp: 0, drebOpp: 0, oppFgaOn: emptyZoneRec(), stints: [],
      };
      players.set(pid, r);
    }
    return r;
  };
  for (const t of [g.home, g.away]) for (const p of t.players) if (p.starter) P(p.id).starter = true;

  const teams = new Map<number, TeamGame>();
  for (const [tm, h] of [[home, true], [away, false]] as const) {
    teams.set(tm, {
      tm, home: h, poss: 0, pts: 0, starts: emptyStartRec(), transByStart: emptyStartRec(), durSum: 0, durN: 0,
      nonShootFouls: 0, shootFoulsNoMake: 0, shootFoulsThree: 0, timeouts: 0, liveTov: 0, deadTov: 0,
    });
  }

  const shots: ShotRec[] = [];
  const poss: PossRec[] = [];
  const astPairs: Array<[number, number]> = [];
  const rebByZone: ParsedGame['rebByZone'] = [];
  const ftMissOreb = { n: 0, off: 0 };
  const onCourt = new Map<number, Set<number>>([[home, new Set()], [away, new Set()]]);
  const stintStart = new Map<number, number>();
  let lineupOk = true;

  // Regroupe par période.
  const periods = [...new Set(acts.map((a) => a.p))].sort((a, b) => a - b);
  let prevEnd = new Map<number, number[]>([[home, []], [away, []]]);

  // Suivi des possessions.
  type CurPoss = PossRec & { firstDecision?: number; segment: number; lastOrebClock?: number };
  const st: { cur: CurPoss | null } = { cur: null };
  const resetCur = () => {
    st.cur = null;
  };
  let lastTerminal: { type: StartType; clock: number } = { type: 'start', clock: 720 };
  const shotByNum = new Map<number, ShotRec>();
  const ftByNum = new Map<number, { tm: number; last: boolean }>();
  let lastShot: ShotRec | undefined;
  let lastTov: { tm: number; pid?: number; stl?: number } | undefined;

  const finalize = () => {
    if (!st.cur) return;
    const T = teams.get(st.cur.tm)!;
    T.poss++;
    T.starts[st.cur.start]++;
    if (st.cur.trans) T.transByStart[st.cur.start]++;
    if (!st.cur.trans && st.cur.firstDecision != null && st.cur.dur > 0 && st.cur.dur <= 24.5) {
      T.durSum += st.cur.dur;
      T.durN++;
    }
    for (const pid of onCourt.get(st.cur.tm)!) P(pid).offPoss++;
    for (const pid of onCourt.get(st.cur.tm === home ? away : home)!) P(pid).defPoss++;
    poss.push({ tm: st.cur.tm, start: st.cur.start, dur: st.cur.dur, trans: st.cur.trans, pts: st.cur.pts, home: st.cur.tm === home, p: st.cur.p, startClock: st.cur.startClock });
    st.cur = null;
  };

  const ensurePoss = (tm: number, a: Act) => {
    if (st.cur && st.cur.tm === tm) return;
    finalize();
    st.cur = { tm, start: lastTerminal.type, dur: 0, trans: false, pts: 0, home: tm === home, p: a.p, startClock: lastTerminal.clock, segment: 0 };
  };
  const decision = (a: Act) => {
    if (st.cur && st.cur.firstDecision == null) {
      st.cur.firstDecision = a.c;
      st.cur.dur = Math.max(0, st.cur.startClock - a.c);
      if (st.cur.start !== 'made' && st.cur.start !== 'start' && st.cur.dur <= 5) st.cur.trans = true;
    }
  };

  let lastClock = 720;
  let lastP = 1;
  const accrue = (p: number, c: number) => {
    // Ajoute le temps écoulé depuis la dernière action aux joueurs sur le terrain.
    if (p !== lastP) return;
    const t0 = elapsed(p, lastClock);
    const t1 = elapsed(p, c);
    if (t1 <= t0) return;
    for (const set of onCourt.values()) {
      for (const pid of set) {
        const r = P(pid);
        r.sec += t1 - t0;
        if (p <= 4) {
          let t = t0;
          while (t < t1) {
            const bin = Math.floor(t / 60);
            const nxt = Math.min(t1, (bin + 1) * 60);
            r.presence[Math.min(bin, 47)] += nxt - t;
            t = nxt;
          }
        } else r.presence[48] += t1 - t0;
      }
    }
    lastClock = c;
  };
  const startStint = (pid: number, p: number, c: number) => stintStart.set(pid, elapsed(p, c));
  const endStint = (pid: number, p: number, c: number) => {
    const s = stintStart.get(pid);
    if (s != null) P(pid).stints.push(elapsed(p, c) - s);
    stintStart.delete(pid);
  };

  for (const per of periods) {
    const pacts = acts.filter((a) => a.p === per);
    for (const tm of [home, away]) {
      const st = inferPeriodStarters(pacts, tm, home, away, played, prevEnd.get(tm) ?? []);
      if (st.length < 5) lineupOk = false;
      onCourt.set(tm, new Set(st));
      for (const pid of st) startStint(pid, per, periodLen(per));
    }
    lastP = per;
    lastClock = periodLen(per);
    lastTerminal = { type: 'start', clock: periodLen(per) };
    resetCur();

    for (let i = 0; i < pacts.length; i++) {
      const a = pacts[i];
      accrue(per, a.c);
      const tm = a.tm;
      const opp = tm === home ? away : home;

      switch (a.at) {
        case 'substitution': {
          if (!tm || !a.pid) break;
          const set = onCourt.get(tm)!;
          if (a.st === 'out') {
            set.delete(a.pid);
            endStint(a.pid, per, a.c);
          } else if (a.st === 'in') {
            set.add(a.pid);
            startStint(a.pid, per, a.c);
          }
          break;
        }
        case '2pt':
        case '3pt': {
          if (!tm || !a.pid) break;
          ensurePoss(tm, a);
          decision(a);
          const three = a.at === '3pt';
          const zone = zoneOf(three, a.x, a.y, a.ar);
          const fb = !!a.q?.includes('fastbreak');
          if (fb && st.cur && st.cur.segment === 0) st.cur.trans = true;
          const second = !!st.cur && st.cur.segment > 0;
          const putback = second && (a.ds === 'putback' || a.ds === 'tip' || (st.cur!.lastOrebClock != null && st.cur!.lastOrebClock - a.c <= 3 && (zone === 'RA' || zone === 'PAINT')));
          const margin = tm === home ? a.hs - a.as : a.as - a.hs;
          const made = (a.res ?? 0) as 0 | 1;
          const s: ShotRec = {
            pid: a.pid, tm, zone, x: a.x ?? 0, y: a.y ?? 0, made, ast: a.ast, blk: a.blk, fb, second, putback, and1: false,
            sub: a.st, ds: a.ds, p: per, c: a.c, def: [...onCourt.get(opp)!], home: tm === home,
            margin: made ? margin - (three ? 3 : 2) : margin,
          };
          shots.push(s);
          shotByNum.set(a.n, s);
          lastShot = s;
          for (const pid of onCourt.get(opp)!) P(pid).oppFgaOn[zone]++;
          if (a.blk) P(a.blk).blk++;
          if (made) {
            if (st.cur) st.cur.pts += three ? 3 : 2;
            teams.get(tm)!.pts += three ? 3 : 2;
            if (a.ast) astPairs.push([a.ast, a.pid]);
            lastTerminal = { type: 'made', clock: a.c };
          }
          break;
        }
        case 'block': {
          if (a.pid && lastShot && !lastShot.made && !lastShot.blk) {
            lastShot.blk = a.pid;
            P(a.pid).blk++;
          }
          break;
        }
        case 'freethrow': {
          if (!tm) break;
          const technical = a.ds === 'technical' || a.st?.includes('technical') || a.ds === 'flagrant';
          const m = /(\d) of (\d)/.exec(a.st ?? '');
          const last = m ? m[1] === m[2] : true;
          if (a.pid) {
            const r = P(a.pid);
            r.fta++;
            if (a.res) r.ftm++;
          }
          if (a.res) teams.get(tm)!.pts += 1;
          if (technical) break;
          ensurePoss(tm, a);
          decision(a);
          if (a.q?.includes('fastbreak') && st.cur && st.cur.segment === 0) st.cur.trans = true;
          if (a.res && st.cur) st.cur.pts += 1;
          ftByNum.set(a.n, { tm, last });
          if (last && a.res) lastTerminal = { type: 'made', clock: a.c };
          break;
        }
        case 'rebound': {
          if (!tm) break;
          const deadball = a.q?.includes('deadball');
          const off = a.st === 'offensive';
          const src = a.sh != null ? shotByNum.get(a.sh) : undefined;
          const ftSrc = a.sh != null ? ftByNum.get(a.sh) : undefined;
          if (deadball && !src) break; // rebond d'équipe après 1er LF manqué
          const shooterTeam = src?.tm ?? ftSrc?.tm ?? (off ? tm : opp);
          const isOff = tm === shooterTeam;
          const defTeam = shooterTeam === home ? away : home;
          for (const pid of onCourt.get(shooterTeam)!) P(pid).orebOpp++;
          for (const pid of onCourt.get(defTeam)!) P(pid).drebOpp++;
          if (a.pid && !a.q?.includes('team')) {
            if (isOff) P(a.pid).oreb++;
            else P(a.pid).dreb++;
          }
          if (src) rebByZone.push({ zone: src.zone, off: isOff });
          else if (ftSrc) {
            ftMissOreb.n++;
            if (isOff) ftMissOreb.off++;
          }
          if (isOff) {
            ensurePoss(tm, a);
            if (st.cur) {
              st.cur.segment++;
              st.cur.lastOrebClock = a.c;
            }
          } else {
            lastTerminal = { type: 'dreb', clock: a.c };
          }
          break;
        }
        case 'turnover': {
          if (!tm) break;
          ensurePoss(tm, a);
          decision(a);
          const pid = a.q?.includes('team') ? undefined : a.pid;
          const live = !!a.stl || a.st === 'bad pass' || a.st === 'lost ball';
          if (pid) {
            P(pid).tov++;
            if (live) P(pid).tovLive++;
          }
          if (a.stl) P(a.stl).stl++;
          if (live) teams.get(tm)!.liveTov++;
          else teams.get(tm)!.deadTov++;
          lastTov = { tm, pid, stl: a.stl };
          lastTerminal = { type: a.stl ? 'steal' : (live ? 'steal' : 'deadTO'), clock: a.c };
          break;
        }
        case 'steal': {
          if (a.pid && lastTov && !lastTov.stl) {
            lastTov.stl = a.pid;
            P(a.pid).stl++;
            lastTerminal = { type: 'steal', clock: a.c };
          }
          break;
        }
        case 'foul': {
          if (!tm || !a.pid) break;
          if (a.st === 'technical' || a.ds === 'technical' || a.st === 'double') break;
          const r = P(a.pid);
          if (a.st === 'offensive' || a.ds === 'charge') {
            r.pfOff++;
            break;
          }
          const shooting = a.ds === 'shooting' || a.q?.some((q) => q === '2freethrow' || q === '3freethrow' || q === '1freethrow');
          if (shooting && a.ds === 'shooting') {
            r.pfShoot++;
            if (a.fd) P(a.fd).fdShoot++;
            // Faute sur tir réussi (and-one) : même horloge que le dernier panier marqué par le joueur fauté.
            if (lastShot && lastShot.made && lastShot.pid === a.fd && lastShot.c === a.c && lastShot.p === per) lastShot.and1 = true;
            else {
              const T = teams.get(opp)!;
              T.shootFoulsNoMake++;
              if (a.q?.includes('3freethrow')) T.shootFoulsThree++;
              if (opp) {
                ensurePoss(opp, a);
                decision(a);
              }
            }
          } else {
            r.pfOther++;
            teams.get(tm)!.nonShootFouls++;
            if (a.fd) {
              P(a.fd).fdOther++;
              if (a.q?.includes('2freethrow')) P(a.fd).fdBonus++;
            }
          }
          break;
        }
        case 'timeout': {
          if (tm) teams.get(tm)!.timeouts++;
          break;
        }
        case 'period': {
          if (a.st === 'end') {
            accrue(per, 0);
            finalize();
          }
          break;
        }
        default:
          break;
      }
    }
    accrue(per, 0);
    finalize();
    for (const tm of [home, away]) {
      for (const pid of onCourt.get(tm)!) endStint(pid, per, 0);
      prevEnd.set(tm, [...onCourt.get(tm)!]);
    }
  }

  return { gameId: g.gameId, date: g.date, homeId: home, awayId: away, shots, poss, players, teams, ast: astPairs, rebByZone, ftMissOreb, lineupOk };
}

export const _test = { isThree };
