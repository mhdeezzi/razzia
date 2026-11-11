// Collecteur permanent : npm run flashscore -- --interval=5000 (ou --once pour un seul passage).
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { collect, Flashscore, SPORTS, type Sport, type OddsLocale } from '../live/flashscore.ts';

export function options(args: string[]) {
  let interval = 5000, output = 'data/cache/flashscore/latest.json', once = false, odds = true, prematch = false;
  let oddsLocale: OddsLocale = 'fr';
  let sports: Sport[] = [...SPORTS], ids: Set<string> | undefined;
  for (const arg of args) {
    if (arg === '--once') once = true;
    else if (arg === '--odds') odds = true;
    else if (arg === '--no-odds') odds = false;
    else if (arg === '--prematch') prematch = true;
    else if (arg.startsWith('--odds-locale=')) {
      const value = arg.slice(14);
      if (value !== 'fr' && value !== 'global') throw new Error('Marchés de cotes : fr ou global');
      oddsLocale = value;
    }
    else if (arg.startsWith('--interval=')) interval = Number(arg.slice(11));
    else if (arg.startsWith('--output=')) output = arg.slice(9);
    else if (arg.startsWith('--sports=')) {
      const values = [...new Set(arg.slice(9).split(','))];
      if (values.some((v) => !SPORTS.includes(v as Sport))) throw new Error('Sports acceptés : foot,tennis,nba');
      sports = values as Sport[];
    } else if (arg.startsWith('--ids=')) {
      const values = arg.slice(6).split(',');
      if (values.some((id) => !/^[a-zA-Z0-9]{8}$/.test(id))) throw new Error('Identifiants Flashscore invalides');
      ids = new Set(values);
    } else throw new Error('Option inconnue : ' + arg);
  }
  if (!Number.isInteger(interval) || interval < 1000 || interval > 5000) throw new Error('Intervalle : un entier de 1000 à 5000 ms');
  if (!output) throw new Error('Chemin de sortie vide');
  return { interval, output: resolve(output), once, sports, ids, odds, prematch, oddsLocale };
}

/** Retry-After court depuis sa réception, pas depuis le début du passage qui a pu durer plusieurs secondes. */
export function pollDelay(interval: number, duration: number, retryAfter: number, failures: number): number {
  return Math.max(0, interval - duration, retryAfter, failures ? Math.min(60_000, interval * 2 ** Math.min(failures, 6)) : 0);
}

export async function main(args = process.argv.slice(2)) {
  const config = options(args);
  const client = new Flashscore({ ttlMs: 0, oddsLocale: config.oddsLocale });
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await mkdir(dirname(config.output), { recursive: true });
  let previous = new Set<string>(), failures = 0;
  try {
    do {
      const start = Date.now();
      const snapshot = await collect(client, config.sports, config.ids, previous, { odds: config.odds, prematch: config.prematch });
      const next = new Set<string>();
      for (const sport of config.sports) {
        const board = snapshot.boards[sport];
        if (!board) for (const key of previous) { if (key.startsWith(sport + ':')) next.add(key); }
        else for (const match of board.matches) { if (match.state === 'in') next.add(sport + ':' + match.id); }
      }
      // Si une dernière lecture échoue en partie, réessayer le résultat final au prochain passage.
      for (const detail of snapshot.matches) {
        if (detail.match.state === 'post' && !detail.complete) next.add(detail.match.sport + ':' + detail.match.id);
      }
      previous = next;
      const temporary = config.output + '.' + process.pid + '.tmp';
      await writeFile(temporary, JSON.stringify(snapshot) + '\n');
      await rename(temporary, config.output);
      const statsErrors = Object.keys(snapshot.errors).length + snapshot.matches.filter((m) => Object.keys(m.errors).some((key) => key !== 'odds')).length;
      const oddsErrors = snapshot.matches.filter((m) => m.errors.odds != null).length;
      const errors = statsErrors + oddsErrors;
      failures = statsErrors ? failures + 1 : 0;
      console.log(JSON.stringify({ at: snapshot.collectedAt, matches: snapshot.matches.length, errors, oddsErrors, oddsQuotes: snapshot.matches.reduce((n, m) => n + (m.odds?.quotes.length ?? 0), 0), durationMs: snapshot.durationMs, overrun: snapshot.durationMs > config.interval, output: config.output }));
      if (config.once) { if (errors) process.exitCode = 1; break; }
      const pause = pollDelay(config.interval, Date.now() - start, client.retryAfterMs(), failures);
      await delay(pause, undefined, { signal: stop.signal }).catch((e) => { if (!stop.signal.aborted) throw e; });
    } while (!stop.signal.aborted);
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : 'Échec du collecteur'); process.exitCode = 1; });
}
