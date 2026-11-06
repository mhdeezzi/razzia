// Collecte foot : calendriers puis fiches de match FotMob, pour les saisons demandées.
//   node src/cli/footingest.ts [--main] [--from 2020] [--concurrency 4]
import { CALENDAR_CUPS, FOOT_DIR, LEAGUES, fixtures, match } from '../foot/fotmob.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const onlyMain = process.argv.includes('--main');
const onlyOthers = process.argv.includes('--others');
const from = Number(arg('--from', '2020'));
const conc = Number(arg('--concurrency', '4'));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const todo: Array<Parameters<typeof match>[0]> = [];
for (const L of LEAGUES.filter((l) => (onlyMain ? l.main : onlyOthers ? !l.main : true))) {
  const first = await fixtures(L.id, `${new Date().getUTCFullYear()}/${new Date().getUTCFullYear() + 1}`).catch(() => undefined);
  const seasons = (first?.seasons ?? []).filter((s) => Number(s.slice(0, 4)) >= (L.main ? from : Math.max(from, 2023)));
  for (const s of seasons) {
    const fx = await fixtures(L.id, s, s === seasons[0]);
    const done = fx.matches.filter((m) => m.finished && !m.cancelled);
    const missing = done.filter((m) => !existsSync(join(FOOT_DIR, 'm', `${m.id}.json`)));
    log(`${L.name} ${s} : ${done.length} matchs joués, ${missing.length} à récupérer`);
    todo.push(...missing);
  }
}
// Coupes nationales et Conference League : calendrier seulement (jours de repos).
for (const id of CALENDAR_CUPS) {
  const first = await fixtures(id, `${new Date().getUTCFullYear()}/${new Date().getUTCFullYear() + 1}`, true).catch(() => undefined);
  for (const s of (first?.seasons ?? []).filter((x) => Number(x.slice(0, 4)) >= from)) await fixtures(id, s, s === first!.seasons[0]).catch(() => undefined);
  log(`calendrier coupe ${id} : ${(first?.seasons ?? []).filter((x) => Number(x.slice(0, 4)) >= from).length} saisons`);
}
log(`total à récupérer : ${todo.length}`);
let i = 0, ok = 0, fail = 0;
await Promise.all(Array.from({ length: conc }, async () => {
  while (i < todo.length) {
    const f = todo[i++];
    try { (await match(f)) ? ok++ : fail++; } catch (e) { fail++; if (fail < 20) log('échec', f.id, String(e).slice(0, 120)); }
    if ((ok + fail) % 250 === 0) log(`${ok + fail}/${todo.length} (échecs ${fail})`);
  }
}));
log(`terminé : ${ok} fiches, ${fail} échecs`);
