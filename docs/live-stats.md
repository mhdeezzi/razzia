# Stats du direct : point de branchement et moteur

## Où brancher une nouvelle source

**`src/live/source.ts`**, liste `SOURCES` (bloc « BRANCHER ICI »).

1. Copier `src/live/sources/modele.ts` (modèle commenté, non branché) et remplir deux fonctions :
   - `live(sport)` : les matchs en cours chez le fournisseur ;
   - `match(sport, id)` : les données d'un match.
2. Ajouter la source à `SOURCES`.
3. Mettre la clé du fournisseur dans les variables Vercel (par exemple `TENNIS_SOURCE_KEY`), jamais dans le code.
4. `npm run build:live-api` (régénère `api/live.js`), puis `GET /api/live?sport=tennis&id=…`.

La source rend les données **telles que le fournisseur les donne** :

- les stats avec leurs libellés d'origine et leurs valeurs (`« Backhand unforced errors » : 9 / 15`, `« 64% (32/50) »`) ;
- au tennis, les points avec le serveur, le vainqueur et la description de fin de point d'origine (`« Forehand winner »`, `« Ace »`, `« Faute directe »`) ;
- au foot et en NBA, les événements avec leur type d'origine.

Rien n'est à traduire à la main.

Une source non configurée (sans clé) est ignorée sans erreur. Une source en panne n'empêche pas la réponse : le direct continue avec FotMob et ESPN.

## Ce que le moteur sait lire

`src/live/stats/catalog.ts` range **n'importe quelle stat** sous une clé canonique, dans n'importe quelle langue et pour n'importe quel fournisseur :

- **Tennis :**
  - service : aces, doubles fautes, 1re balle passée, points gagnés sur 1re et sur 2e balle, jeux de service, vitesses ;
  - retour, balles de break, points d'affilée, filet, longueur des échanges, distance, durée ;
  - **coups gagnants, fautes directes et fautes provoquées, au total ou par coup** : coup droit, revers, volée, smash, amortie, lob, passing, retour.
- **Foot :** xG, xGOT, xA, grosses occasions, tirs (cadrés, contrés, dans et hors de la surface), possession, corners, fautes, cartons, passes, duels…
- **NBA :** tirs à 2 pts, à 3 pts et lancers, rebonds, passes décisives, pertes de balle, interceptions, contres, fautes, points dans la raquette, en contre-attaque, de seconde chance…
- **Une stat inconnue n'est jamais jetée :** elle est gardée sous `other.<libellé>` avec sa valeur. Pour l'ajouter au catalogue, il suffit d'ajouter une ligne.
- **Valeurs lues :** `77% (213/277)`, `12/20`, `30-79`, `4 of 7`, `45%`, `1:45:02`, `201 km/h`, `125 mph`…
- **Périodes :** match, set 1, 2…, quart-temps, mi-temps, prolongation.

`src/live/stats/tennis-points.ts` lit le tennis **point par point** : serveur, vainqueur, 1re ou 2e balle, fin du point, coup, longueur de l'échange, balle de break. Il en déduit le score complet (sets, jeux, points, serveur, jeu décisif) et tous les comptes, y compris les fautes directes et les coups gagnants par coup. Il lit aussi la notation coup par coup du Match Charting Project.

`src/live/stats/tennis-engine.ts` nourrit le moteur avec le niveau de détail reçu :

| Reçu | Ce que le moteur en fait |
|---|---|
| Score seul | forme du jour révisée par les sets joués |
| Stats de match | forme révisée par les points au service (total, ou 1re + 2e balle, ou retour adverse) |
| Fautes directes / coups gagnants | chaque point compte selon sa fin (poids appris) |
| Point par point | tout ce qui précède, plus la révision du set en cours (passage à vide, réveil) |

La réponse de `/api/live` contient `engine.read` : service réel et attendu, fautes directes et coups gagnants par coup, aces, doubles fautes, série en cours, balles de break. Ces chiffres servent aux jauges de la page.

## Ce que disent les tests (tennis, point par point)

`npm run live:tennis-stats` reprend 1 025 matchs ATP 2024-2026 relevés coup par coup par le Match Charting Project, reliés aux cotes Pinnacle. L'apprentissage se fait sur 2024, le contrôle sur 464 matchs de 2025-2026 jamais vus, avec une situation tous les 16 points :

| Le moteur voit | Log-loss (plus bas = mieux) |
|---|---|
| Rien (cotes d'avant-match) | 0,557 |
| Score seul (sets, jeux, points) | 0,4665 |
| + points au service | 0,4652 |
| + révision du set en cours | 0,4629 |
| + poids des fautes directes (1,2, appris) | 0,4626 |

- **Fautes directes :** un point perdu sur sa propre faute directe en dit un peu *plus* sur le niveau du jour qu'un autre point, pas moins. L'effet est faible.
- **Forme du moment (prime aux 20 derniers points) :** aucun gain mesuré, donc pas retenue.
- **Défaut restant :** un favori mené dans le set en cours reste un peu surestimé, de 5 à 10 points.

**Licence :** les données du Match Charting Project sont sous CC BY-NC-SA 4.0 (usage non commercial). Les poids appris (`src/live/tennis-weights.json`) ne s'activent qu'avec `LIVE_TENNIS_WEIGHTS=mcp`, pour les essais. Sans cette variable, le moteur utilise des poids neutres. Avant une mise en ligne payante, il faudra les réapprendre avec les données du fournisseur sous licence : même programme, autre lecteur de points.

## Tests automatiques

```sh
npm run test:live-stats
```

Ils couvrent :

- le catalogue : langues et fournisseurs, stat inconnue gardée ;
- la lecture des valeurs ;
- les points en texte libre et en notation coup par coup ;
- le score refait à partir des points, jeu décisif compris ;
- les comptes : service, retour, fautes par coup, balles de break ;
- le moteur, du score seul au point par point ;
- le point de branchement, joueurs dans l'autre ordre compris.
