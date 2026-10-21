// Décomposition réelle des fautes et des lancers (saison régulière 2025-26), par équipe et par match.
import { loadGames } from '../nba/model/features.ts';
const games = loadGames().filter((x) => x.g.gameId.startsWith('00225'));
let nonShoot = 0, nonShootBonus = 0, shootMiss = 0, shootMiss3 = 0, and1 = 0, off = 0, techFT = 0, fta = 0, trips = 0, teamGames = 0;
for (const { g } of games) {
  teamGames += 2;
  for (const a of g.actions) {
    if (a.at === 'foul') {
      if (a.st === 'offensive') off++;
      else if (a.st === 'technical' || a.ds === 'technical') continue;
      else if (a.ds === 'shooting') {
        if (a.q?.includes('1freethrow')) and1++;
        else { shootMiss++; if (a.q?.includes('3freethrow')) shootMiss3++; }
      } else if (a.st === 'personal' || a.st === 'loose ball' || a.ds) {
        nonShoot++;
        if (a.q?.includes('2freethrow')) nonShootBonus++;
      }
    }
    if (a.at === 'freethrow') { fta++; if (a.ds === 'technical' || a.st?.includes('technical')) techFT++; if (/^1 of/.test(a.st ?? '')) trips++; }
  }
}
const pg = (x: number) => (x / teamGames).toFixed(2);
console.log('par équipe et par match :');
console.log(' fautes hors tir', pg(nonShoot), ' dont en bonus (2 LF)', pg(nonShootBonus), `(${(nonShootBonus / nonShoot * 100).toFixed(0)}%)`);
console.log(' fautes de tir sur tentative manquée', pg(shootMiss), ' dont à 3 pts', pg(shootMiss3), '| and-one', pg(and1), '| offensives', pg(off));
console.log(' FTA', pg(fta), ' dont techniques', pg(techFT), '| séries de LF', pg(trips));
