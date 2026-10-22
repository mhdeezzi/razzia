// Version légère du match typique pour la web app : score et probabilité de victoire au fil du match, temps forts
// et feuille de match (sans le flux d'évènements complet, réservé au rendu 2D).
//   node src/cli/typicalcompact.ts out/<match>/typical.json <sortie.json>
import { readFileSync, writeFileSync } from 'node:fs';
import type { SimEvent } from '../nba/engine/game.ts';

const [src, dst] = process.argv.slice(2);
const tf = JSON.parse(readFileSync(src, 'utf8'));
const ev: SimEvent[] = tf.result.events ?? [];
const players = new Map<number, { name: string; short: string; side: 0 | 1 }>(tf.players.map((p: any) => [p.id, p]));
const name = (id?: number) => (id != null ? players.get(id)?.name ?? '' : '');

// Courbe : un point toutes les 30 secondes de jeu (dernier état connu).
const flow: Array<{ t: number; h: number; a: number; wp?: number }> = [];
const end = ev.length ? ev[ev.length - 1].t : 0;
let k = 0;
for (let t = 0; t <= end + 29; t += 30) {
  while (k + 1 < ev.length && ev[k + 1].t <= t) k++;
  const e = ev[k];
  if (e) flow.push({ t: Math.min(t, end), h: e.hs, a: e.as, wp: e.wp != null ? Math.round(e.wp * 1000) / 1000 : undefined });
}

// Paniers : pour repérer les séries et les fins de match.
const scores = ev.filter((e) => (e.type === 'shot' && e.made) || (e.type === 'ft' && (e.pts ?? 0) > 0));
const describe = (e: SimEvent) => {
  const who = name(e.pid);
  if (e.type === 'ft') return `${who}, ${e.pts} lancer${(e.pts ?? 0) > 1 ? 's' : ''} franc${(e.pts ?? 0) > 1 ? 's' : ''}`;
  const ast = e.pid2 != null && players.get(e.pid2)?.side === players.get(e.pid!)?.side ? ` (passe de ${name(e.pid2)})` : '';
  return `${who}, ${e.pts === 3 ? 'panier à 3 points' : 'panier'}${ast}`;
};
const clock = (e: SimEvent) => `${e.p <= 4 ? `Q${e.p}` : `Prol. ${e.p - 4}`} ${Math.floor(e.clock / 60)}:${String(Math.floor(e.clock % 60)).padStart(2, '0')}`;

// Plus grosse série d'une équipe (points sans réponse).
let best = { side: 0 as 0 | 1, pts: 0, from: 0, to: 0 };
let cur = { side: -1, pts: 0, from: 0 };
scores.forEach((e, i) => {
  if (e.side === cur.side) cur.pts += e.pts ?? 0;
  else cur = { side: e.side!, pts: e.pts ?? 0, from: i };
  if (cur.pts > best.pts) best = { side: cur.side as 0 | 1, pts: cur.pts, from: cur.from, to: i };
});
const moments: Array<{ when: string; side?: 0 | 1; text: string; score: string }> = [];
if (best.pts >= 8) {
  const a = scores[best.from];
  const b = scores[best.to];
  moments.push({ when: `${clock(a)} à ${clock(b)}`, side: best.side, text: `Série de ${best.pts}-0`, score: `${b.as}-${b.hs}` });
}
// Fin de match : paniers des 2 dernières minutes de la dernière période.
const last = ev.length ? ev[ev.length - 1].p : 4;
for (const e of scores) if (e.p === last && e.clock <= 120) moments.push({ when: clock(e), side: e.side, text: describe(e), score: `${e.as}-${e.hs}` });

const line = (l: any) => ({
  id: l.id, min: Math.round(l.sec / 6) / 10, pts: l.pts, reb: l.oreb + l.dreb, ast: l.ast, fgm: l.fgm, fga: l.fga, fg3m: l.fg3m, fg3a: l.fg3a,
  ftm: l.ftm, fta: l.fta, stl: l.stl, blk: l.blk, tov: l.tov, pm: l.pm, started: l.started,
});
const team = (r: any) => ({ pts: r.pts, q: r.q, lines: r.lines.filter((l: any) => l.played).map(line) });
writeFileSync(
  dst,
  JSON.stringify({
    index: tf.index, n: tf.n,
    home: team(tf.result.home), away: team(tf.result.away), periods: tf.result.periods,
    leadChanges: tf.result.leadChanges, largestLead: tf.result.largestLead,
    players: tf.players.map((p: any) => ({ id: p.id, name: p.name, side: p.side })),
    flow, moments: moments.slice(-12),
    // Tous les tirs : position (dixièmes de pied, panier en 0,0), réussi, équipe (0 = domicile), joueur, zone, contestation.
    shots: ev.filter((e) => e.type === 'shot' && e.x != null && e.y != null && e.label !== 'heave').map((e) => ({ x: e.x, y: e.y, m: e.made ? 1 : 0, s: e.side, p: e.pid, z: e.zone, c: e.ct })),
  }),
);
console.log(`match typique : ${flow.length} points de courbe, ${moments.length} temps forts`);
