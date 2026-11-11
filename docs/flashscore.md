# Collecteur Flashscore : foot, tennis et NBA

Le collecteur lit les flux utilisés par le site Flashscore : tableau des matchs, résumé, statistiques
d'équipe par période, statistiques joueurs, chronologie et, au tennis, historique point par point et
jeu en cours. Tous les champs de chaque flux lu restent dans `feeds.*.raw`, y compris ceux que Razzia
ne sait pas encore interpréter. `statistics` expose aussi les libellés et les valeurs des deux côtés,
sans tronquer les pourcentages ou les ratios. Le basket est filtré sur la NBA ; les tableaux foot et
tennis couvrent les compétitions diffusées par Flashscore.

Ce sont des flux internes non documentés, testés le 11 novembre 2026, sans compte ni clé API.
Leur format, leur accès et leur couverture peuvent changer. Certaines statistiques/chronologies
peuvent être absentes pour une compétition. Un flux vide est conservé comme tel, jamais remplacé
par des zéros. `complete` signifie que tous les flux demandés ont répondu, pas que toutes les
statistiques imaginables existent pour ce match.

## Lancer le robot

Node >= 22.18, sans dépendance supplémentaire :

```sh
npm run flashscore -- --once
npm run flashscore -- --interval=5000
npm run flashscore -- --sports=foot,tennis,nba --interval=1000
npm run flashscore -- --sports=tennis --ids=Oh3fgg23 --once
```

`--ids` limite aux identifiants Flashscore choisis. Sans filtre, tous les matchs en cours des sports
choisis sont lus. Une dernière lecture est faite lorsque le tableau les annonce terminés.
Le fichier `data/cache/flashscore/latest.json` est remplacé atomiquement après chaque passage ;
`--output=/chemin/latest.json` permet de choisir un autre emplacement. Ce répertoire est ignoré par Git.
Les journaux indiquent le nombre de matchs, les erreurs et si le passage a dépassé l'intervalle.
Ctrl+C/SIGTERM arrête le robot après les lectures en cours.

Un processus permanent (VPS, conteneur ou service de type worker) est nécessaire pour une collecte
24 h/24. Le dépôt ne lance aucun abonnement, serveur ni tâche permanente automatiquement.
Un cron GitHub Actions/Vercel ne fournit pas une cadence permanente de 1 à 5 secondes.
Dans un environnement à proxy, Node 24 peut utiliser les variables proxy héritées avec
`NODE_USE_ENV_PROXY=1` ; conserver le certificat CA fourni par cet environnement.

## API dans Razzia

Après déploiement Vercel :

```text
GET /api/flashscore                         tableaux des matchs en cours des trois sports
GET /api/flashscore?sport=nba               tableau NBA en cours
GET /api/flashscore?sport=tennis&id=Oh3fgg23  données complètes d'un match du tableau du jour
```

L'API lit Flashscore à la demande. Elle est aussi servie par `npm run dev` en local.
Elle fonctionne indépendamment du robot CLI et ne lit pas son fichier local. Pour afficher un
match dans Razzia, consommer cet endpoint et relire après 1 à 5 secondes **après la fin de l'appel**,
en respectant `Retry-After` lorsqu'il est présent. Le cache local dure une seconde, les requêtes
identiques sont regroupées et quatre appels réseau au maximum partent simultanément par instance.
Les réponses API utilisent `Cache-Control: no-store` pour éviter une couche de retard CDN.

Les identifiants Flashscore alphanumériques ne sont pas les identifiants ESPN/FotMob déjà présents
dans `/api/live`. Cette API constitue la source de données Flashscore ; elle ne remplace pas la page
live actuelle et ne rapproche pas automatiquement les matchs avec les simulations Razzia.
Les données collectées ne relancent jamais une simulation d'avant-match.

## Fraîcheur et erreurs

L'intervalle configurable est de 1 000 à 5 000 ms. Le robot attend la fin d'un passage avant d'en
lancer un autre. Si le volume de matchs ou la latence dépasse cet intervalle, `overrun: true` le
signale dans le journal ; on peut réduire le périmètre avec `--sports` et `--ids`.

Une lecture toutes les cinq secondes ne signifie pas une publication toutes les cinq secondes par
Flashscore. Chaque flux expose `fetchedAt`, `sourceDate` et `ageSeconds` (l'en-tête HTTP Age, pas une
mesure du retard depuis le terrain). Les scores du tableau ont leur propre `boardFetchedAt` et
`boardAgeSeconds`. Des réponses NBA mises en cache depuis plus de vingt secondes ont été observées
pendant le test initial. Aucune latence de bout en bout de 1 à 5 secondes n'est garantie.

### Renouvellement automatique de `x-fsign`

La signature n'est pas écrite dans le code : elle est lue dans la configuration publique du site.
Elle est relue préventivement toutes les cinq minutes, en arrière-plan, sans attendre ce délai si
un flux refuse la signature. La relecture demande une revalidation HTTP (`Cache-Control: no-cache`).
Si la page de configuration devient indisponible alors que la signature fonctionne encore, les
lectures continuent avec cette signature et la relecture est temporisée séparément.

Un HTTP 401/403 sans `Retry-After`, ou une réponse HTML/JSON inattendue à la place d'un flux,
déclenche une seule relecture de la configuration. Les appels simultanés partagent cette relecture.
La requête refusée est reprise une seule fois, uniquement si la signature a changé. Les requêtes
en file utilisent la signature la plus récente à leur départ et un refus tardif d'une ancienne
signature ne révoque pas la nouvelle. La lecture de configuration est prioritaire dans la file,
sans dépasser la limite de concurrence réseau.

Une signature inchangée, un nouvel échec après renouvellement ou une configuration inaccessible
mettent les flux en pause. Un HTTP 429 ou un refus accompagné de `Retry-After` est respecté avant
toute nouvelle lecture ou tentative de renouvellement. La temporisation du robot tient compte du
temps déjà passé à lire les données : elle ne raccourcit pas le délai restant imposé par la source.
Aucun changement d'hôte ou de compte n'est utilisé pour contourner un refus.

### Données conservées pendant une panne

Les données indisponibles sont signalées dans `errors`. Dans la même instance, la dernière lecture
réussie d'un flux peut être conservée pendant **60 secondes au maximum**, sans renouveler sa date.
Elle porte `stale: true` et `staleReason` ; les tableaux ont aussi ces indicateurs. Une fiche avec
un tableau ancien expose `boardStale: true` et `errors.board`. Les réponses avec ces erreurs ont
`complete: false`. Si la fiche cherchée n'existe pas dans un tableau ancien, l'API répond 503 plutôt
que d'affirmer à tort qu'elle n'existe pas.

Cette conservation reste en mémoire : elle ne survit pas à un redémarrage ou au démarrage d'une
autre instance Vercel. Au-delà d'une minute, une erreur est renvoyée. Un tableau qui échoue n'est
jamais présenté comme un sport sans match. Les échecs répétés ralentissent aussi le robot et
`--once` rend un code de sortie non nul si une partie de la collecte est indisponible ou ancienne.

## Vérifier et reconstruire

```sh
npm run test:flashscore
npm run typecheck
npm run build:live-api
npm run build
```

`api/flashscore.js` est généré depuis `src/live/flashscore-api.ts` ; ne pas le modifier à la main.
La construction utilise esbuild, déjà présent via Vite. Les tests vérifient notamment les champs
répétés, les périodes, les données manquantes, le filtrage NBA, la fraîcheur, la concurrence, les
résultats finaux, les pauses imposées par la source, les rotations 401/403, les renouvellements
simultanés, les refus tardifs, les pannes de configuration, les fausses réponses HTTP 200 et
l'expiration des données conservées.
