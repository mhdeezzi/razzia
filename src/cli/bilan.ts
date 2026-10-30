// Bilan des simulations publiées, façon parieur pro : pour chaque match terminé, la cote au moment de la simulation
// contre la cote de clôture (la ligne a-t-elle bougé dans le sens de Razzia ?) et le résultat.
//   node src/cli/bilan.ts <dossier sims de la branche resultats>   -> écrit <dossier>/bilan.json
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMarket, getScoreboard, noVig } from '../data/espn.ts';

const dir = process.argv[2];
if (!dir) throw new Error('Usage : node src/cli/bilan.ts <dossier sims>');

const decimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const VALUE = 0.04; // écart moteur / marché à partir duquel Razzia signale une valeur
const HEDGE_FIRST = 0.66; // favori sous 66 % (pile ou face) : le vainqueur est déconseillé, c'est le handicap qui compte
const SAFE_COVER = 0.8; // handicap « plus sûr » : la ligne la plus exigeante qui passe dans 80 % des simulations
const MIN_ODDS = 1.15; // handicap « plus sûr » proposé seulement si sa cote juste dépasse 1,15

type Pick = { kind: 'vainqueur' | 'handicap'; label?: string; won: boolean };
type Rung = { line: number; pHomeCover: number };

const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
/**
 * Lignes de handicap simulées, prolongées de 13 points de chaque côté (comme sur la fiche) : les anciennes simulations ne
 * couvrent que 12 points autour de l'écart médian. Au-delà : loi normale de l'écart simulé, sans jamais redescendre.
 */
function ladder(s: any): Rung[] {
  const lad: Rung[] = [...(s.spreadLadder ?? [])].sort((a: Rung, b: Rung) => a.line - b.line);
  const mean: number | undefined = s.margin?.mean != null ? s.margin.mean + (s.market?.capShift ?? 0) : undefined, sd: number | undefined = s.margin?.sd;
  if (!lad.length || mean == null || !(sd! > 0)) return lad;
  const cdf = (line: number) => 0.5 * (1 + erf((mean + line) / sd! / Math.SQRT2));
  const lo: Rung[] = [], hi: Rung[] = [];
  for (let k = 1, c = lad[0].pHomeCover; k <= 13; k++) lo.unshift({ line: lad[0].line - k, pHomeCover: (c = Math.min(c, cdf(lad[0].line - k))) });
  for (let k = 1, c = lad.at(-1)!.pHomeCover; k <= 13; k++) hi.push({ line: lad.at(-1)!.line + k, pHomeCover: (c = Math.max(c, cdf(lad.at(-1)!.line + k))) });
  return [...lo, ...lad, ...hi];
}
/**
 * Pronostic retenu, celui que la fiche met en avant : le vainqueur, ou pour un favori sous 66 % (pourcentage
 * affiché, une décimale) le handicap « plus sûr » (le favori avec des points d'avance, à 80 % des simulations).
 */
function pickOf(s: any, home: string, away: string, hs: number, as: number): Pick {
  const p: number = s.market?.blendedHome ?? s.pHome;
  const fav = p >= 0.5 ? 'home' : 'away';
  const winP = Math.max(p, 1 - p);
  const favMargin = fav === 'home' ? hs - as : as - hs;
  // Début de saison (une équipe a joué moins de 5 matchs) : pile ou face d'office sous 70 %.
  const gp = Math.min(s.gamesPlayed?.home ?? s.momentum?.home?.nCur ?? 99, s.gamesPlayed?.away ?? s.momentum?.away?.nCur ?? 99);
  if (Math.round(winP * 1000) / 1000 < (gp < 5 ? 0.7 : HEDGE_FIRST)) {
    const cover = (x: { pHomeCover: number }) => (fav === 'home' ? x.pHomeCover : 1 - x.pHomeCover);
    const h = ladder(s)
      .filter((x) => (fav === 'home' ? x.line : -x.line) > 0 && cover(x) >= SAFE_COVER && cover(x) > winP && cover(x) <= 1 / MIN_ODDS)
      .sort((a, b) => cover(a) - cover(b))[0];
    if (h) {
      const l = fav === 'home' ? h.line : -h.line;
      return { kind: 'handicap', label: `${fav === 'home' ? home : away} +${String(l).replace('.', ',')}`, won: favMargin + l > 0 };
    }
  }
  return { kind: 'vainqueur', won: favMargin > 0 };
}

/**
 * Dernière version d'une simulation publiée avant le coup d'envoi, dans l'historique git de la branche resultats : une
 * relance partie en retard (file d'attente GitHub) remplace la fiche après le début du match ; le pronostic d'avant-match
 * reste celui qui compte. Rien sans historique : le match reste alors hors du bilan.
 */
function beforeTip(name: string, tip: number): any | undefined {
  const repo = join(dir, '..'), path = `sims/${name}/summary.json`;
  try {
    const log = execFileSync('git', ['-C', repo, 'log', '--format=%H', '--', path], { encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const h of log) {
      const v = JSON.parse(execFileSync('git', ['-C', repo, 'show', `${h}:${path}`], { encoding: 'utf8', maxBuffer: 256 << 20 }));
      if (v.meta?.builtAt && Date.parse(v.meta.builtAt) < tip) return v;
    }
  } catch {
    /* pas de dépôt git ou version illisible */
  }
  return undefined;
}

interface Row {
  dir: string;
  date: string;
  away: string;
  home: string;
  pModel: number; // probabilité domicile du moteur
  pBlend?: number; // moteur + marché
  pBook?: number; // marché sans marge au moment de la simulation
  pClose?: number; // marché sans marge à la clôture
  homeWon: boolean;
  score: string;
  pick: Pick;
  value?: { side: 'home' | 'away'; edge: number; clv?: number; odds?: number; won: boolean; profit?: number };
}

const rows: Row[] = [];
const finals = new Map<string, any[]>();
for (const d of readdirSync(dir, { withFileTypes: true })) {
  const f = join(dir, d.name, 'summary.json');
  if (!d.isDirectory() || !existsSync(f)) continue;
  const m = /^(\d{4}-\d{2}-\d{2})_([A-Z]{3})@([A-Z]{3})$/.exec(d.name);
  if (!m) continue;
  const [, date, away, home] = m;
  if (Date.parse(`${date}T12:00:00Z`) > Date.now() - 86_400_000 / 2) continue; // trop récent pour être terminé
  let s = JSON.parse(readFileSync(f, 'utf8'));
  if (!finals.has(date)) finals.set(date, await getScoreboard(date, 6).catch(() => []));
  const norm = (t: string) => ({ GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' } as Record<string, string>)[t] ?? t;
  const ev = finals.get(date)!.find((e) => {
    const c = e.competitions?.[0]?.competitors ?? [];
    return norm(c.find((x: any) => x.homeAway === 'home')?.team?.abbreviation ?? '') === home && norm(c.find((x: any) => x.homeAway === 'away')?.team?.abbreviation ?? '') === away;
  });
  const comp = ev?.competitions?.[0];
  if (!comp?.status?.type?.completed) continue;
  // Seules les prévisions faites avant le coup d'envoi comptent dans le bilan.
  if (s.meta?.builtAt && ev.date && Date.parse(s.meta.builtAt) >= Date.parse(ev.date)) {
    const prev = beforeTip(d.name, Date.parse(ev.date));
    if (!prev) continue;
    s = prev;
  }
  const hs = Number(comp.competitors.find((x: any) => x.homeAway === 'home').score);
  const as = Number(comp.competitors.find((x: any) => x.homeAway === 'away').score);
  const close = await getMarket(date, home, away).catch(() => undefined);
  const pClose = close?.mlHome != null && close.mlAway != null ? noVig(close.mlHome, close.mlAway)[0] : undefined;
  const pBook = s.market?.bookHome as number | undefined;
  const row: Row = { dir: d.name, date, away, home, pModel: s.pHome, pBlend: s.market?.blendedHome, pBook, pClose, homeWon: hs > as, score: `${as}-${hs}`, pick: pickOf(s, home, away, hs, as) };
  if (pBook != null && Math.abs(s.pHome - pBook) >= VALUE) {
    const side = s.pHome > pBook ? 'home' : 'away';
    const won = side === 'home' ? hs > as : as > hs;
    const ml = side === 'home' ? s.market?.mlHome : s.market?.mlAway;
    row.value = {
      side, edge: Math.abs(s.pHome - pBook), won,
      clv: pClose != null ? (side === 'home' ? pClose - pBook : pBook - pClose) : undefined,
      odds: ml != null ? decimal(ml) : undefined,
      profit: ml != null ? (won ? decimal(ml) - 1 : -1) : undefined,
    };
  }
  rows.push(row);
}
rows.sort((a, b) => b.date.localeCompare(a.date));

const brier = (k: 'pModel' | 'pBlend' | 'pBook' | 'pClose') => {
  const r = rows.filter((x) => x[k] != null);
  return r.length ? r.reduce((s, x) => s + ((x[k] as number) - (x.homeWon ? 1 : 0)) ** 2, 0) / r.length : undefined;
};
const hit = (k: 'pModel' | 'pBlend' | 'pBook') => {
  const r = rows.filter((x) => x[k] != null);
  return r.length ? r.filter((x) => ((x[k] as number) >= 0.5) === x.homeWon).length / r.length : undefined;
};
const vals = rows.filter((x) => x.value);
const withClv = vals.filter((x) => x.value!.clv != null);
const withOdds = vals.filter((x) => x.value!.profit != null);
const out = {
  at: new Date().toISOString(),
  games: rows.length,
  brier: { model: brier('pModel'), blend: brier('pBlend'), book: brier('pBook'), close: brier('pClose') },
  accuracy: { model: hit('pModel'), blend: hit('pBlend'), book: hit('pBook'), pick: rows.length ? rows.filter((x) => x.pick.won).length / rows.length : undefined },
  // Favoris sous 66 % comptés comme leur handicap « plus sûr » (le pronostic affiché à la place du vainqueur).
  handicaps: { n: rows.filter((x) => x.pick.kind === 'handicap').length, won: rows.filter((x) => x.pick.kind === 'handicap' && x.pick.won).length },
  value: {
    n: vals.length,
    won: vals.filter((x) => x.value!.won).length,
    clvMean: withClv.length ? withClv.reduce((s, x) => s + x.value!.clv!, 0) / withClv.length : undefined,
    clvPositive: withClv.length ? withClv.filter((x) => x.value!.clv! > 0).length / withClv.length : undefined,
    roi: withOdds.length ? withOdds.reduce((s, x) => s + x.value!.profit!, 0) / withOdds.length : undefined,
    nOdds: withOdds.length,
  },
  rows: rows.slice(0, 2500), // toute la saison (le bandeau public calcule son bilan sur l'ensemble)
};
writeFileSync(join(dir, 'bilan.json'), JSON.stringify(out));
console.log(`bilan : ${rows.length} matchs, ${vals.length} valeurs signalées`);
