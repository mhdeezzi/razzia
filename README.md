# SimLab — simulateur Monte Carlo possession par possession (NBA)

Reproduit — et dépasse — ce que fait **RotoBot SIMS** : chaque match est simulé 5 000 fois possession par
possession à partir des vraies données du jour, puis le **match le plus typique** est rejoué en 2D façon
diffusion TV, avec toutes les probabilités utiles aux paris (vainqueur, spread, total, props joueurs).

```
npm install                     # une seule fois (typescript, vite)
npm run ingest                  # données NBA (play-by-play + tableaux stats.nba.com), incrémental
npm run sim -- --game DEN@OKC --date 2026-10-22
npm run slate -- --date 2026-10-22     # toute la soirée + meilleurs écarts sur les props
npm run viewer                  # rendu 2D + tableau de bord : http://localhost:5178
npm run backtest -- --games 80  # calibration sur des matchs passés (+ comparaison au marché)
npm run props-backtest -- --from 2026-01-01 --to 2026-06-30   # props : sims vs lignes d'ouverture/clôture
```

Node ≥ 22.18 (TypeScript exécuté nativement, sans build). Aucune clé d'API n'est nécessaire.

---

## 1. Ce que fait RotoBot (rétro-ingénierie)

Sources : leur thread X sous la vidéo OKC @ SAS du 20/10/2026, leur « transparency thread », la vidéo elle-même.

| Élément | Ce qu'ils publient |
|---|---|
| Volume | 5 000 sims par match NBA (2 000 en NFL au début) |
| Base | « Every possession is built from real 2025-26 play-by-play: where each player shoots from, how often he makes it, who he passes to, and who's guarding him » |
| Données citées | taux de pertes de balle (attaque et provoquées), adresse adverse au cercle vs ligue, part de tirs à 3 pts concédée, play types Synergy (pick-and-roll, isolation, transition, roll man, cut, spot-up) avec points/possession et percentiles, impact défensif individuel au tir (« shooters hit 5.8 points better than usual against Kenrich Williams… at the rim, Holmgren held them 15.2 under »), switches sur écran (« a Harper screen switches SGA onto Wembanyama »), historique face-à-face, blessures, effectifs du jour |
| Match typique | « the winner most sims picked, a score near the median, and every player near his average » |
| Calibration | portées à 80 % censées contenir 80 % des vrais résultats ; leurs erreurs avouées : distributions trop étroites (« 20% of real … beat our 90th percentile »), excès de confiance sur les vainqueurs → « win odds lean on the market until the sample grows » |
| Rendu 2D | terrain en perspective, jetons numérotés, tableau de score (fautes, BONUS, horloge des 24 s), proba de victoire en direct, box scores live (IN/OUT), étiquettes d'action (OFFENSIVE REBOUND, 3-POINTER, MISMATCH), bandeau « TEAM BALL half court / second chance », écrans de fin, box score final, résumé « Across all 5,000 sims » vs bookmakers |

**Tout cela est reproduit ici**, avec en plus : calibration mesurée par backtest (et non déclarative),
comparaison systématique au marché, props DraftKings évaluées automatiquement, rotations dynamiques,
effet élastique des scores, partage d'usage/passes/rebonds réaliste entre stars et joueurs de rôle,
export vidéo, et une architecture prête pour d'autres sports.

## 2. Données utilisées (toutes gratuites)

| Source | Contenu | Usage |
|---|---|---|
| `cdn.nba.com` play-by-play (1 324 matchs : saison 2025-26 + playoffs + 2026-27) | chaque action avec coordonnées du tir, type (dunk, floater, step-back…), passeur, contreur, intercepteur, faute provoquée, remplacements | cartes de tir par zone, adresse par zone **pondérée par la forme**, réseau de passes décisives, contres/interceptions/fautes par joueur, rebonds par zone de tir, rotations (courbe de présence minute par minute), possessions (type de départ, durée, transition) |
| `stats.nba.com` Synergy | 11 play types × attaque/défense × joueurs/équipes | qui finit l'action et sur quel type de jeu, pertes/fautes/and-one par type de jeu, fréquences concédées par chaque défense, part de transition (signature du coach) |
| `stats.nba.com` tracking défensif | FG% concédé vs attendu (< 6 ft, 2 pts, 3 pts, global) par défenseur le plus proche | impact du défenseur qui conteste chaque tir |
| `stats.nba.com` matchups | minutes de duel attaquant × défenseur | assignations défensives (profil taille/usage + historique des duels), proxy du taux de switch |
| `stats.nba.com` passes (tracking) | passes et passes décisives par coéquipier | animation de la circulation du ballon |
| `stats.nba.com` stats avancées, four factors, index joueurs | usage, rythme, TOV%, effectifs **actuels** (transferts/mercato), tailles, postes, rang de draft | |
| ESPN | blessures du jour, cotes DraftKings (spread, total, moneyline, clôture), **props joueurs** | statuts, comparaison au marché, edges |

Pondération temporelle : saison en cours avec décroissance « forme » (demi-vie ≈ 23 matchs), saison
précédente lissée (l'intersaison casse la notion de forme) et playoffs légèrement escomptés.

## 3. Le moteur (une possession)

1. **Ballon mort ?** temps morts (série adverse ≥ 8-0, fin de match serrée) et changements de joueurs.
2. **Transition ?** probabilité selon le type de départ (après interception, rebond défensif, panier encaissé),
   calée sur la part de transition Synergy de l'équipe et ce que concède la défense.
3. **Qui finit l'action et comment** : tirage conjoint (joueur, play type) ∝ usage Synergy × forme du soir ×
   fréquences concédées par la défense × « chasse » au défenseur faible (relative au défenseur habituel du joueur).
   Partage sur-linéaire de l'usage (∝ usage^1,4) pour que les stars gardent leur part.
4. **Pick-and-roll** : porteur, écran, switch selon le taux de switch de la défense → MISMATCH.
5. **Issue** : perte de balle (interception ou ballon mort, faute offensive), faute de tir sur tentative manquée
   (2 ou 3 LF), ou tir. Fautes hors tir avec rampe en fin de quart-temps, pénalité NBA exacte (5e faute, 2e dans
   les 2 dernières minutes), fautes techniques.
6. **Tir** : zone = carte de tir réelle du joueur × inclinaison du type de jeu ; position = un de ses vrais tirs
   dans cette zone. Adresse (logit) = adresse du joueur dans la zone (forme, rétrécissement bayésien) + effet
   du type de jeu (Synergy) + défenseur qui conteste (tracking, centré) + domicile + effets du soir + effet élastique.
7. **Contre / passe décisive** (probabilité réelle d'être assisté du tireur par zone, effet meneur, passeur
   ∝ taux de passes^2 × affinité du duo) / **rebond** (log5 des cinq sur le terrain, zone du tir, partage ∝ taux^1,25),
   putback.
8. **Horloge** : durée de décision calée sur le rythme des deux équipes (calibrée par pré-simulation),
   24 s / 14 s, 2-pour-1, dernier tir, fautes intentionnelles de l'équipe menée, prolongations.
9. **Rotations** : minutes attendues robustes (sorties sur blessure écartées), redistribution des minutes des
   absents vers les cadres et le même poste, courbe de présence par minute de chaque joueur (habitudes du coach),
   fatigue, gestion des fautes, garbage time, cinq de fin de match.

Effets aléatoires par simulation (pour des distributions honnêtes, l'erreur avouée de RotoBot) : forme du
soir de chaque joueur et de chaque équipe, adresse à 3 pts du soir, usage, minutes, rythme, arbitrage,
environnement de tir commun.

## 4. Calibration (backtest sur 2025-26, données antérieures à chaque match)

`npm run backtest` rejoue des matchs passés et mesure (dernier run : voir `out/backtests/`) :

- statistiques d'équipe simulées vs réelles (FGA, FG%, 3PA, 3P%, FTA, pertes, rebonds, passes…) ;
- erreur et biais sur la marge et le total, σ simulé (cible ≈ 14 pour la marge, ≈ 19 pour le total) ;
- Brier / log-loss sur le vainqueur, comparés au marché (clôture DraftKings) et au mélange 50/50 ;
- **couverture des portées 80 %** (P10–P90) par stat joueur, biais par niveau de joueur (stars incluses).

Limite connue : pour les matchs 2025-26, les tableaux Synergy/tracking sont des agrégats de saison
(légère fuite d'information) ; le play-by-play, lui, est strictement antérieur à chaque match.

**Résultats de référence** (80 matchs de janvier à avril 2026, 300 sims chacun, `out/backtests/`) :

| Mesure | Simulé | Réel / cible |
|---|---|---|
| Points par équipe | 116,0 | 113,4 (ligue : 115,6) |
| FGA / FG% | 88,3 / 47,8 % | 88,5 / 46,8 % (ligue : 47,1 %) |
| 3PA / 3P% | 36,8 / 36,6 % | 36,8 / 35,4 % (ligue : 36,0 %) |
| FTA / pertes / passes | 23,2 / 13,9 / 25,6 | 22,6 / 14,1 / 26,6 |
| σ marge / σ total | 14,3 / 19,9 | ≈ 14 / ≈ 19 |
| Portée 80 % points / rebonds / PRA / minutes | 82,4 % / 81,5 % / 77,9 % / 76,0 % | 80 % |
| Brier vainqueur : modèle / marché / 50-50 | 0,218 / **0,196** / 0,204 | — |
| Erreur absolue marge : modèle / ligne | 12,1 / **11,6** | — |

Lecture honnête : le moteur reproduit très bien la distribution des stats (c'est ce qui compte pour les props,
le match typique et les paris combinés corrélés), mais **la ligne de clôture reste meilleure pour le vainqueur
et le spread**, comme RotoBot l'a lui-même constaté. Les écarts modèle/ligne ≥ 3 pts n'ont pas été rentables
sur cet échantillon (17/33, 51,5 %). Utilisez la proba « mélangée » avec le marché pour les côtés, et les sims pour les
props, les quarts-temps, les combinés et les marchés dérivés — en vérifiant toujours les blessures de dernière
minute (un edge énorme signale le plus souvent une information manquante).

### Backtest des props (`npm run props-backtest`)

Lignes DraftKings archivées par ESPN (96 matchs de 2025-26 avec props, dont 90 % en playoffs, **12 289 lignes**),
sims avec données antérieures au match, résultats réels :

- Sens des paires ESPN vérifié sur les résultats : 1er côté = Over.
- **Face aux lignes de clôture** : les sims seules sont moins précises que la ligne (Brier 0,253 vs 0,244) et trop
  confiantes ; l'empilement calibré (validation croisée par match) n'apporte presque rien (0,2439). Pas d'edge à la clôture.
- **Face aux lignes d'ouverture** : la ligne bouge ensuite dans le sens du modèle dans 64 à 76 % des cas ; en pariant à
  l'ouverture (mélange 0,3–0,5, edge ≥ 4–8 %) le ROI est de +5 à +7 % sur ~2 000–3 000 paris. Mais cet avantage vient
  des lignes qui ont bougé (nouvelle information) ; quand la ligne n'a pas bougé, ROI ≈ 0. Une partie peut venir de ce
  que le backtest connaît les vrais absents. **Conclusion : jouer tôt, avant le mouvement, jamais à la clôture.**
- En production : probabilité = 35 % sims + 65 % marché (25 % / 12 % si la confiance est moyenne / faible), une
  seule ligne par joueur dans les rapports, et toutes les props consultées sont archivées (`data/cache/props_archive`)
  pour refaire ce backtest sur la saison régulière 2026-27 au fil des semaines.

## 5. Rendu 2D et vidéo

`npm run viewer` puis choisir le match. Lecture 1×/2×/4×/8×, saut par quart-temps, **Export vidéo**
(WebM/MP4 enregistré depuis le canvas, prêt à poster). Onglet « Analyse des sims » : probabilités, échelles de
spread/total, distributions joueurs (P10–P90), props DraftKings avec edges, « ce que disent les données ».

## 6. Routine quotidienne

```
npm run ingest                      # nouveaux matchs + tableaux de la saison en cours (cache 6 h)
npm run slate -- --date AAAA-MM-JJ  # toute la soirée
npm run sim -- --game AWAY@HOME --date AAAA-MM-JJ --out "Nom Joueur" --in "Autre Joueur"
```

`--out` / `--in` forcent un statut (annonce tardive). Statuts ESPN : Out = absent, Questionable = 50 %,
Doubtful = 15 %, Day-To-Day = 65 % (tirage par simulation).

## 7. Autres sports

`src/core/` (aléa reproductible), le runner Monte Carlo, la sélection du match typique, l'agrégation, la
calibration par backtest et le viewer sont indépendants du basket. Un nouveau sport = un module
`src/<sport>/` avec : ingestion, features (point-in-time), modèle de match, moteur d'évènements (snap en NFL,
possession/phase en football, at-bat en MLB), et une chorégraphie pour le rendu.

## Arborescence

```
src/data/        clients HTTP (cache gzip, débit limité) : nbaStats, cdn, espn
src/nba/model/   pbp (parseur), features (forme), tables (Synergy/tracking), build (modèle de match), types
src/nba/engine/  game (moteur), montecarlo (calibration, sims, résumé, match typique, proba live), batch, worker
src/cli/         ingest, sim, slate, backtest
viewer/          rendu 2D (canvas), tableau de bord, export vidéo
out/             résultats (model.json, summary.json, typical.json, report.md) et backtests
```
