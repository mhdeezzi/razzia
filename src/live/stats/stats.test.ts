// Tests des stats du direct : catalogue (n'importe quel libellé), lecture des valeurs, points tennis (texte libre et
// notation coup par coup), score refait à partir des points, moteur nourri au niveau de détail reçu, point de branchement.
//   node --test src/live/stats/stats.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseValue, periodOf, StatBook, statsFromRow } from './catalog.ts';
import { aggregate, outcomeFromText, pointFromMcp, stateFromPoints, type TennisPoint } from './tennis-points.ts';
import { NEUTRAL_WEIGHTS, tennisFromStats } from './tennis-engine.ts';
import { calibrateTennis, DEFAULT_TENNIS } from '../tennis.ts';
import { bookOf, normalizePoints, sameMatch, swap, type SourceMatch } from '../source.ts';

test('catalogue tennis : fournisseurs et langues différents, même clé', () => {
  const k = (l: string) => classify('tennis', l).key;
  assert.equal(k('Unforced Errors'), 'ue');
  assert.equal(k('backhand_unforced_errors'), 'ue.backhand');
  assert.equal(k('Fautes directes en revers'), 'ue.backhand');
  assert.equal(k('Errores no forzados'), 'ue');
  assert.equal(k('Forehand winners'), 'winners.forehand');
  assert.equal(k('volley_winners'), 'winners.volley');
  assert.equal(k('Return unforced errors'), 'ue.return');
  assert.equal(k('1st Serve %'), 'serve.first.in');
  assert.equal(k('1st Serve Points Won'), 'serve.first.won');
  assert.equal(k('Puntos ganados con el primer servicio'), 'serve.first.won');
  assert.equal(k('Break Points Saved'), 'serve.bp.saved');
  assert.equal(k('Break Points Converted'), 'return.bp.converted');
  assert.equal(k('Fastest serve'), 'serve.speed.max');
  assert.equal(k('Double Faults'), 'serve.df');
  assert.equal(k('Max points in a row'), 'points.inrow');
});

test('catalogue foot et NBA, et stat inconnue gardée telle quelle', () => {
  assert.equal(classify('foot', 'Expected goals (xG)').key, 'xg');
  assert.equal(classify('foot', 'Big chances missed').key, 'bigc.missed');
  assert.equal(classify('foot', 'Shots on target').key, 'sot');
  assert.equal(classify('nba', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted').key, 'fg3');
  assert.equal(classify('nba', 'offensiveRebounds').key, 'reb.off');
  assert.equal(classify('nba', 'turnoverPoints').key, 'tovpts');
  const u = classify('tennis', 'Hawk-Eye challenges remaining');
  assert.equal(u.known, false);
  assert.equal(u.group, 'other');
  assert.ok(u.key.startsWith('other.'));
});

test('lecture des valeurs', () => {
  assert.deepEqual(parseValue('77% (213/277)'), { value: 0.77, pct: 0.77, made: 213, att: 277, unit: 'pct', raw: '77% (213/277)' });
  assert.equal(parseValue('12/20').made, 12);
  assert.equal(parseValue('30-79').att, 79);
  assert.equal(parseValue('45%').value, 0.45);
  assert.equal(parseValue('1:45:02').value, 6302);
  assert.ok(Math.abs((parseValue('125 mph').value ?? 0) - 201.168) < 1e-6);
  assert.equal(parseValue('-').value, null);
  assert.equal(periodOf('1st set'), 'set1');
  assert.equal(periodOf('Q3'), 'q3');
  assert.equal(periodOf('ALL'), 'all');
});

test('carnet de stats : famille complète à partir du détail par coup', () => {
  const b = new StatBook();
  b.add(statsFromRow('tennis', { label: 'Forehand unforced errors', home: 6, away: 9 }));
  b.add(statsFromRow('tennis', { label: 'Backhand unforced errors', home: 4, away: 7 }));
  assert.equal(b.family('ue', 0), 10);
  assert.equal(b.family('ue', 1), 16);
});

test('fin de point en texte libre', () => {
  assert.deepEqual(outcomeFromText('Ace'), { outcome: 'ace', stroke: 'serve' });
  assert.deepEqual(outcomeFromText('Backhand unforced error'), { outcome: 'unforced_error', stroke: 'backhand' });
  assert.deepEqual(outcomeFromText('Faute directe en coup droit'), { outcome: 'unforced_error', stroke: 'forehand' });
  assert.equal(outcomeFromText('Double fault').outcome, 'double_fault');
  assert.equal(outcomeFromText('Forehand winner').outcome, 'winner');
});

test('notation coup par coup (Match Charting Project)', () => {
  // A sert, 3 frappes après le service : la dernière est de B, coup gagnant.
  assert.deepEqual(pointFromMcp('4f2b3f1*', '', 0, 1), { server: 0, winner: 1, serve: 1, outcome: 'winner', by: 1, stroke: 'forehand', rally: 4 });
  assert.equal(pointFromMcp('4*', '', 0, 0).outcome, 'ace');
  assert.equal(pointFromMcp('5d', '6x', 1, 0).outcome, 'double_fault');
  const p = pointFromMcp('6n', '5b2f1b3@', 1, 1);
  assert.equal(p.serve, 2);
  assert.equal(p.outcome, 'unforced_error');
  assert.equal(p.by, 0);
  assert.equal(p.stroke, 'backhand');
});

const game = (pts: TennisPoint[], server: 0 | 1, winner: 0 | 1, outcome: TennisPoint['outcome'] = 'winner') => { for (let i = 0; i < 4; i++) pts.push({ server, winner, outcome, by: winner }); };

test('score refait à partir des points : jeux, sets, serveur, jeu décisif', () => {
  const pts: TennisPoint[] = [];
  let s: 0 | 1 = 0;
  for (const w of [0, 1, 0, 0, 0, 1, 0, 1, 0] as const) { game(pts, s, w); s = (1 - s) as 0 | 1; } // 6-3
  const st = stateFromPoints(pts, 3);
  assert.deepEqual(st.sets, [[6, 3]]);
  assert.deepEqual(st.games, [0, 0]);
  assert.equal(st.server, 1); // 9 jeux : l'autre joueur sert le 1er jeu du 2e set
  // Jeu décisif : 6-6 puis A gagne 7-0.
  const tb: TennisPoint[] = [];
  s = 0;
  for (let i = 0; i < 12; i++) { game(tb, s, s); s = (1 - s) as 0 | 1; }
  for (let i = 0; i < 7; i++) tb.push({ server: 0, winner: 0 });
  assert.deepEqual(stateFromPoints(tb, 3).sets, [[7, 6]]);
});

test('agrégats : service, retour, fautes directes par coup, balles de break', () => {
  const pts: TennisPoint[] = [
    { server: 0, winner: 0, serve: 1, outcome: 'ace', by: 0 },
    { server: 0, winner: 1, serve: 2, outcome: 'unforced_error', by: 0, stroke: 'backhand', breakPoint: true },
    { server: 1, winner: 0, serve: 1, outcome: 'winner', by: 0, stroke: 'forehand', rally: 11 },
  ];
  const [a, b] = aggregate(pts);
  assert.equal(a.servePlayed, 2); assert.equal(a.serveWon, 1); assert.equal(a.aces, 1);
  assert.equal(a.ue, 1); assert.equal(a.ueBy.backhand, 1); assert.equal(a.winnersBy.forehand, 1);
  assert.equal(a.bpFaced, 1); assert.equal(b.bpWon, 1); assert.equal(a.rallyLongWon, 1);
});

test('moteur : du score seul jusqu\'au point par point, probabilités valides', () => {
  const base = calibrateTennis(DEFAULT_TENNIS, 0.6, 'Hard', 3);
  const pts: TennisPoint[] = [];
  let s: 0 | 1 = 0;
  for (const w of [1, 1, 1, 1, 0, 1, 1] as const) { game(pts, s, w, w === s ? 'winner' : 'unforced_error'); s = (1 - s) as 0 | 1; }
  const score = tennisFromStats(base, { bestOf: 3, sets: [], games: [1, 6] });
  const points = tennisFromStats(base, { bestOf: 3, pointLog: pts });
  assert.equal(points.read.level, 'points');
  for (const o of [score, points]) { assert.ok(o.win[0] > 0 && o.win[0] < 1); assert.ok(Math.abs(o.win[0] + o.win[1] - 1) < 1e-9); }
  // Plus les fautes directes pèsent, plus un set perdu sur ses propres fautes compte : la chance de A baisse.
  const heavy = tennisFromStats(base, { bestOf: 3, pointLog: pts }, DEFAULT_TENNIS, { ...NEUTRAL_WEIGHTS, outcome: { ...NEUTRAL_WEIGHTS.outcome, unforced_error: 2 } });
  const light = tennisFromStats(base, { bestOf: 3, pointLog: pts }, DEFAULT_TENNIS, { ...NEUTRAL_WEIGHTS, outcome: { ...NEUTRAL_WEIGHTS.outcome, unforced_error: 0.5 } });
  assert.ok(heavy.win[0] < light.win[0]);
  // Stats de match seules (sans point par point).
  const book = bookOf('tennis', [{ label: 'Service points won', home: '55% (33/60)', away: '70% (35/50)' }, { label: 'Unforced Errors', home: 18, away: 7 }]);
  const stats = tennisFromStats(base, { bestOf: 3, sets: [[3, 6]], games: [1, 1], stats: book });
  assert.equal(stats.read.level, 'stats');
  assert.deepEqual(stats.read.ue, [18, 7]);
  assert.ok(stats.win[0] < 0.6);
});

test('point de branchement : points bruts, ordre des joueurs inversé', () => {
  const raw = normalizePoints([{ server: 0, winner: 1, result: 'Backhand unforced error' }, { server: 1, winner: 1, result: 'Ace' }]);
  assert.equal(raw[0].outcome, 'unforced_error'); assert.equal(raw[0].stroke, 'backhand'); assert.equal(raw[1].outcome, 'ace');
  assert.equal(sameMatch({ home: 'Jannik Sinner', away: 'Carlos Alcaraz' }, { home: 'C. Alcaraz', away: 'J. Sinner' }), 'swapped');
  const m: SourceMatch = { id: '1', sport: 'tennis', home: 'Alcaraz', away: 'Sinner', state: 'in', tennis: { sets: [[6, 4]], server: 0, pointLog: [{ server: 0, winner: 0 }] }, stats: [{ label: 'Aces', home: 5, away: 2 }] };
  const s = swap(m);
  assert.deepEqual(s.tennis!.sets, [[4, 6]]);
  assert.equal(s.tennis!.server, 1);
  assert.equal(s.tennis!.pointLog![0].winner, 1);
  assert.equal(s.stats![0].home, 2);
});
