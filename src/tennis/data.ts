// Historique ATP en direct (GitHub Actions) : fichiers TennisMyLife de 2015 à aujourd'hui (circuit principal,
// Challengers, qualifications, tournois de la semaine), au format Sackmann mais datés au jour du match. Les années
// passées sont téléchargées une fois ; l'année en cours et la semaine sont relues si elles ont plus de 3 heures.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFiles, sortMatches, type Match } from './history.ts';

const TML = 'https://stats.tennismylife.org/data';
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };

async function download(url: string, file: string, maxAgeH: number): Promise<boolean> {
  if (existsSync(file) && (Date.now() - statSync(file).mtimeMs) / 3_600_000 < maxAgeH) return true;
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return existsSync(file);
    writeFileSync(file, await res.text());
    return true;
  } catch {
    return existsSync(file); // hors ligne : on garde la copie en cache
  }
}

/**
 * Tous les matchs ATP depuis `from` (tri chronologique, doublons entre l'année et la semaine en cours retirés).
 * Avec `from` = l'an dernier : de quoi connaître code ATP, pays et classement des joueurs à l'affiche.
 */
export async function loadHistory(dir: string, from = 2015, now = new Date()): Promise<Match[]> {
  mkdirSync(dir, { recursive: true });
  const year = now.getUTCFullYear();
  const files: string[] = [];
  for (let y = from; y <= year; y++) {
    const age = y === year ? 3 : Infinity;
    for (const f of [`${y}.csv`, `${y}_challenger.csv`, `atp_quali/${y}_atp_quali.csv`]) {
      const local = join(dir, f.replace('/', '_'));
      if (await download(`${TML}/${f}`, local, age)) files.push(local);
    }
  }
  for (const f of ['ongoing_tourneys.csv', 'challenger_ongoing_tourneys.csv']) {
    const local = join(dir, f);
    if (await download(`${TML}/${f}`, local, 3)) files.push(local);
  }
  const seen = new Set<string>();
  return sortMatches(
    readFiles(files, true).filter((m) => {
      const k = `${m.tid}|${m.round}|${m.w.id}|${m.l.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  );
}
