# Cotes fréquentes : Flashscore et fournisseurs actuels

Flashscore complète les fournisseurs déjà utilisés par Razzia : ESPN/DraftKings en NBA,
Pinnacle pour l'ATP, football-data pour le foot et The Odds API pour le comparateur NBA.
Ces sources et les fichiers des simulations restent en place. Les nouvelles lectures mettent
à jour les cotes affichées, sans relancer les simulations ni changer leurs probabilités.

## Cadence sur Vercel

- Fiche de match ouverte : nouvelle lecture légère des cotes **5 secondes après la fin de l'appel précédent**.
- Programmes NBA, ATP et foot, et comparateur du ticket : intervalle de **15 secondes** après l'appel.
- Pause lorsque l'onglet est masqué, reprise des fiches/programmes à son retour ; aucun appel simultané
  du même lecteur. Les lectures identiques en cours et le cache de 5 secondes sont partagés par instance.
- Le ticket relit aussi cette source avant sa validation. Les handicaps restent associés à leur ligne.

Les fiches d'avant-match utilisent uniquement des offres d'avant-match encore actives. Le nouvel
endpoint sait lire les cotes live ; celles-ci restent séparées des probabilités des simulations
d'avant-match. Les marchés annexes live ne sont pas demandés par ce lecteur rapide ; le collecteur
Flashscore complet conserve son fonctionnement et ses flux.

Ce fonctionnement utilise les fonctions Vercel et le navigateur, **sans nouveau serveur ni compte**.
Il collecte pendant l'utilisation des pages. Aucun worker permanent n'est installé : cela ne fournit
pas une surveillance continue toutes les cinq secondes quand personne n'utilise le site.

Le dépôt contient `supabase/horloge.sql`, une installation manuelle d'une tâche toutes les cinq minutes
pour les simulations et les bilans. La présence de ce fichier ne prouve pas que la tâche est activée
dans le projet Supabase. Cette modification ne change pas cette horloge ni les tables des comptes/tickets.

## Fraîcheur et choix du bookmaker

Chaque marché conserve son fournisseur, son bookmaker, sa phase, sa période, sa ligne et ses dates.
Les côtés doivent être complets, actifs et provenir du même bookmaker et de la même ligne. Une cote
absente ou suspendue ne devient jamais un prix inventé. Les autres lignes restent dans `markets`.

- `observedAt` : date de lecture HTTP.
- `updated` : date publiée par The Odds API ; pour Flashscore, date de lecture moins l'âge HTTP du cache.
  Ce dernier repère n'est **pas** une date garantie de changement du prix chez le bookmaker.
- `sourceAgeSeconds` : âge HTTP chez Flashscore, `null` lorsque la source ne le fournit pas.

Le lecteur écarte les marchés dont le repère de fraîcheur dépasse **15 minutes avant-match** ou
**30 secondes en live**. Lorsque l'âge HTTP est inconnu, il reste explicitement `null` ; la lecture
ne permet pas de mesurer le délai depuis le bookmaker. Une cadence de lecture de cinq secondes ne
garantit pas une mise à jour des prix toutes les cinq secondes par Flashscore.

Parmi les bookmakers disponibles, la cote vainqueur avec le repère le plus récent détermine le
bookmaker sélectionné pour la fiche ; à égalité, Pinnacle est prioritaire. La fiche garde un relevé
cohérent de ce bookmaker. Une cote existante datée plus récemment n'est pas écrasée par un relevé
plus ancien. Les cotes initiales restent le repli lorsqu'aucun nouveau relevé compatible n'est disponible.
Le retrait d'une offre du nouveau relevé retire aussi son utilisation par la fiche.

Les noms et les codes NBA sont rapprochés dans les deux sens, avec contrôle de l'horaire et rejet des
associations ambiguës. Les handicaps changent de signe lorsque les côtés sont inversés ; les totaux
gardent leur seuil. NBA : les offres incluent les prolongations ; tennis : jeux et sets restent distincts.
Un Unibet international n'est pas assimilé à Unibet France : le filtre des meilleurs prix français
conserve les fournisseurs explicitement français.

## Préserver les crédits The Odds API

`ODDS_API_KEY` reste facultative pour Flashscore. Si elle est configurée, le fournisseur payant garde
un cache mémoire de dix minutes. Sur Vercel, la variante publique
`GET /api/cotes?provider=the-odds-api` possède aussi son propre cache CDN de dix minutes entre
instances ; une erreur est gardée une minute. Les lectures fréquentes de Flashscore utilisent une
réponse séparée `no-store`. Les limites et `Retry-After` des fournisseurs sont respectés indépendamment.

`ODDS_FLASHSCORE=0` permet de désactiver le nouveau fournisseur de cotes. Les paramètres des sources
de statistiques live restent décrits dans `docs/live-stats.md`.

## API

`GET /api/cotes` conserve le comparateur NBA et ajoute les fournisseurs Flashscore disponibles.
Il fonctionne aussi lorsque The Odds API n'est pas configuré. Une panne totale est signalée par
HTTP 503 ; les erreurs d'une source restent dans `errors` lorsque les autres peuvent répondre.

Pour actualiser seulement les matchs affichés, envoyer un lot de **40 matchs maximum**, avec les
noms dans l'ordre désiré et les identifiants habituels de Razzia :

```http
POST /api/cotes
Content-Type: application/json

{"sport":"nba","matches":[{"id":"401234567","home":"BOS","away":"MIA","start":"2026-11-12T01:00:00Z","state":"pre"}]}
```

`sport` accepte `nba`, `foot`, `tennis`. La réponse contient `games`, `at`, `refreshAfterMs` et `errors`.
Chaque match conserve son identifiant demandé ; `sourceId` identifie Flashscore, `books` contient les
offres normalisées et `selected` désigne le bookmaker retenu. Il est aussi possible de lire un match
par son identifiant Flashscore : `GET /api/cotes?sport=tennis&id=abcdefgh`.

`src/odds/api.ts` est la source de l'API ; `api/cotes.js` est généré. La génération évite des imports
TypeScript entre les fonctions déployées.

```sh
npm run test:odds
npm run test:flashscore
npm run test:live-stats
npm run typecheck
npm run build:live-api
npm run build
```
