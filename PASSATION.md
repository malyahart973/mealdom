# MealDom : passation pour une autre IA

État au 6 novembre 2026. Ce document résume le projet, sa façon de travailler et ce qui reste à faire.

## À donner à l'IA en premier

> Tu reprends MealDom, une PWA de planning de repas pour un foyer en Guyane française.
> HTML, CSS et JavaScript en modules, sans compilation ni Node, typés en JSDoc.
> Dépôt GitHub `malyahart973/mealdom`. Netlify publie la branche `main`.
> Le travail se fait sur `claude/conversational-culinary-ai-wh088m`, et main n'est mise à jour qu'à la demande explicite de l'utilisateur (« fusionne et publie »).
> Lis d'abord `PASSATION.md` puis `README.md`. Réponds en français, simplement : l'utilisateur utilise l'application sur iPhone et veut qu'elle reste simple.

## 1. Le projet

- **Pour qui** : une personne en Guyane qui suit le programme alimentaire de son coach sportif. Elle ne rentre pas déjeuner chez elle et cuisine surtout en batch cooking.
- **Ce que fait l'application** :
  - planning des repas et ajout rapide ;
  - environ 600 recettes et recettes personnelles ;
  - programme minceur calculé ou programme du coach importé ;
  - pesées et mensurations ;
  - batch cooking et mode cuisine pas à pas ;
  - stock, courses et budget, magasins et circuit de courses, prix et ticket de caisse, Drive Hyper U Cayenne ;
  - un assistant : moteur local, ou IA Claude si l'utilisateur a mis sa clé.
- **Données** : tout reste dans IndexedDB, sur le téléphone. Il n'y a ni compte ni serveur. La sauvegarde est un fichier JSON exporté, qu'on peut restaurer.
- **Langue** : interface, code et commentaires en français. Les commentaires sont écrits sans accents.

## 2. Publier une version

1. Travailler sur la branche `claude/conversational-culinary-ai-wh088m`, puis pousser.
2. Sur demande « fusionne et publie », vérifier que main est bien derrière : `git fetch origin main && git merge-base --is-ancestor origin/main HEAD`.
3. Puis `git push origin HEAD:main` : une avance rapide, sans commit de fusion.
4. Netlify publie `main` tel quel (`netlify.toml` : `publish = "."`).

Points obligatoires à chaque livraison :

- **Version** : augmenter `src/version.js` (`MEALDOM_VERSION`). Sinon les téléphones ne reçoivent pas la mise à jour.
- **Historique** : ajouter une ligne en tête de la section « Historique » du `README.md`.
- **Mode hors ligne** : tout nouveau fichier va dans la liste `APP_FILES` de `sw.js`.

Mises à jour sur iPhone :

- Le service worker est enregistré sous l'adresse `sw.js?v=<version>`, avec `updateViaCache: 'none'`.
- Au démarrage et à chaque retour dans l'application, la page lit `src/version.js?check=…` sans cache. Le service worker ignore les requêtes qui contiennent `?check`.
- Si la version publiée est différente, l'application réenregistre le service worker sous la nouvelle adresse, et la bannière « Mise à jour disponible » apparaît.
- Pourquoi : Safari ne compare que les octets de `sw.js`, pas ceux des fichiers qu'il importe. Code dans `src/services/serviceWorker.js`.

## 3. Architecture et règles

```
index.html, sw.js, manifest.webmanifest, _headers (sw.js et version.js jamais en cache)
src/version.js     version unique
src/router.js      routes (#/...), titres, onglet, écran parent
src/pages/         écrans : affichage seulement, aucun calcul métier
src/services/      liens entre écrans, base et navigateur
src/domain/        règles métier pures, testées
src/db/            IndexedDB : migrations.js (v9) et repositories/
src/data/          ingrédients, nutrition, catalogue de recettes
src/utils/         html, format, partage (share.js), voix, etc.
tests/             tests du domaine (tests/index.html + runner.js)
```

Règles du projet (voir aussi la section « Règles » du README) :

- Aucun calcul métier dans `pages/` : il va dans `domain/`, avec ses tests.
- Une seule implémentation par règle. Exemples : `SLOT_LABELS` et `SLOT_NAMES` (planning.js), `weekToPlan` (dates.js), `shareText` (utils/share.js).
- Une migration de base déjà publiée ne se modifie jamais : on en ajoute une nouvelle à la fin.
- La sauvegarde et la restauration utilisent la liste `BACKUP_STORES` (`domain/backup/backup.js`). Un test vérifie qu'elle couvre tous les magasins de la base.
- Les réglages sont stockés dans le magasin `settings`. Clés :
  - assistant : `assistantApiKey` (jamais exportée), `assistantModel`, `assistantUseAi`, `guidedChoices` ;
  - programme : `coachPlan`, `measurements`, `recipeRatings`, `batchPlan` ;
  - Drive : `driveStoreId`, `driveLoyaltyCard`, `drivePreferredProducts`, `driveProductPreference` ;
  - trajets et prix : `homeLocation`, `storeLegs`, `tripFuelCents`, `tripConsumption`, `lastPriceStore` ;
  - sauvegarde : `lastExportAt`.
- CSS (`src/styles/main.css`) :
  - les couleurs sont des variables, avec un thème sombre ;
  - la règle globale `[hidden] { display: none !important; }` est voulue : sans elle, `display:flex` affichait des éléments masqués ;
  - aucun débordement horizontal à 390 px de large.

## 4. Lancer et tester

- **Serveur local** : `python3 -m http.server 8123` à la racine, puis ouvrir http://localhost:8123/.
- **Vérification des types** (obligatoire avant chaque commit) : `npx tsc -p jsconfig.json`. Elle ne doit rien afficher.
- **Tests du domaine dans le navigateur** : http://localhost:8123/tests/ doit afficher « Tous les tests réussis » (533 à ce jour).
- **Tests du domaine avec Node** : ce lanceur n'est pas dans le dépôt. Enregistrer ce fichier, puis lancer `node run-tests.mjs /chemin/vers/mealdom` (524 tests sans IndexedDB) :

```js
import { readFileSync } from 'node:fs';
const root = process.argv[2];
const html = readFileSync(`${root}/tests/index.html`, 'utf8');
const files = [...html.matchAll(/import '\.\/([\w.]+\.test\.js)'/g)].map((m) => m[1]);
const { runTests } = await import(`${root}/tests/runner.js`);
for (const f of files) await import(`${root}/tests/${f}`);
const results = await runTests();
const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log('FAIL', r.name, '::', r.error);
console.log(`${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length ? 1 : 0);
```

- **Nouveau fichier de test** : l'importer dans `tests/index.html`.
- **Parcours dans le navigateur** : jusqu'ici faits avec Playwright, en 390×844, en clair et en sombre, en vérifiant `scrollWidth` = 390. Ces scripts ne sont pas dans le dépôt.

## 5. État actuel

- **En ligne** (main, Netlify) : **0.17.0**.
- **Sur la branche, pas encore publiée** : **0.17.1**, commit `91f2332`. Elle contient deux changements :
  1. **« Je ne rentre pas le midi »**, avec le programme du coach : chaque dîner est cuisiné aussi pour la boîte du déjeuner du lendemain. Détails en section 7.
  2. **« Vider la semaine »**, dans le planning : retire les repas à venir de la semaine, verrouillés compris. Les jours passés restent. Un bouton « Annuler » s'affiche juste après.
- Tests au moment de la passation :
  - `tsc` ne signale aucune erreur ;
  - 524 tests Node et 533 tests navigateur réussis ;
  - parcours Playwright sans erreur ni débordement.

## 6. Fonctionnalités et fichiers clés

| Domaine | Fichiers |
|---|---|
| Accueil (repas du jour, bilan du coach avec pesée rapide, sauvegarde) | `pages/home.js` |
| Planning, « Vider la semaine » | `pages/planning.js`, `domain/planning/planning.js`, `services/assistantService.js` (`clearWeek`) |
| Ajout rapide d'un repas (recherche, favoris, récents, repas du coach, repas libre) | `pages/mealPicker.js` ; routes `#/planning/ajouter/<date>/<repas>` et `#/planning/repas/<id>/changer` |
| Détail d'un repas (personnes, invités, restes, batch par repas) | `pages/meal.js` |
| Assistant : un seul écran « Planifier ma semaine », avec la demande libre dedans | `pages/assistantGuided.js`, `pages/assistantPanel.js`, `services/assistantService.js`, `domain/assistant/*` |
| Programme : écran unique « Mon programme » (suivi, repas du coach ou repères calculés, réglages repliés) | `pages/program.js`, `pages/coach.js` (import, vérification, bloc coach), `domain/nutrition/coach.js`, `domain/nutrition/program.js` |
| Pesées et mensurations, bilan à envoyer au coach | `pages/weight.js`, `domain/nutrition/measurements.js` |
| Batch cooking (séances, conservation, étiquettes, agenda .ics) | `domain/batchCooking/*`, `pages/batch.js`, `pages/batchLabels.js` |
| Mode cuisine pas à pas | `pages/cook.js`, `services/cookService.js` |
| Courses, stock | `pages/shopping.js`, `pages/stock.js`, `domain/shopping/*` |
| Prix, ticket de caisse, magasins, Drive | `pages/prices.js`, `pages/addPrice.js`, `pages/receipt.js`, `domain/stores/*`, `domain/drive/*` |
| Circuit de courses (domicile → A → B → domicile) | `domain/trips/*`, `pages/trip.js` |
| Sauvegarde : export (menu de partage sur téléphone) et restauration | `services/backupService.js`, `domain/backup/backup.js`, `pages/settings.js` |
| Menu « Plus » (4 rubriques) | `pages/more.js` |

## 7. Points délicats à connaître

**Repas du coach.** Ce sont des recettes construites à la volée à partir de leur identifiant (`coachRecipe(id, plan)`) :

- `coach-<repas>-a-<protéine>-<légume>-<féculent|none>` : repas composé ;
- `coach-<repas>-o<n>` : menu fixe n° n ;
- `coach-dinner-a-<p>-<v>-<féculent du dîner|none>-plus-<féculent de la boîte|none>` : dîner plus boîte du lendemain midi.
  - Les ingrédients additionnent les quantités du dîner et celles du déjeuner du coach.
  - La recette compte 2 portions (un dîner, une boîte) et porte `nextLunch` sur le repas, ce qui augmente les quantités au batch cooking et dans les courses.
  - Les étapes séparent « Ce soir » et « Boîte de demain midi ».
  - Ne fonctionne que si le déjeuner et le dîner du coach sont tous deux des repas composés.

Ces recettes sont enregistrées avec `registerPlannedRecipe`. La planification de la semaine se fait dans `planCoachWeek` :

- rotation des protéines, des légumes et des féculents ;
- les repas qui ne viennent pas du coach sont remplacés à ses heures, sauf les repas verrouillés et les repas libres ;
- `removals` : les déjeuners prévus là où la boîte les remplace.

Le bouton « Changer » de l'aperçu appelle `nextCoachVariant` et propose une autre variante du programme, en gardant la boîte s'il y en a une.

**Repas libre.** `recipeId: 'free'` et le nom dans `meal.recipeName` (restaurant, plat improvisé). Il n'est jamais remplacé, ni par l'assistant, ni par le coach, ni par le batch cooking, et il ne crée aucune course.

**Restes du lendemain midi.** `meal.nextLunch = { attendees, guests }` est posé sur un dîner. Le déjeuner du lendemain n'a alors pas de repas propre : il s'affiche « Restes du dîner ». Pour afficher le nom, utiliser `entryName`, qui retire « (+ demain midi) ».

**Propositions de l'assistant.**
- Ce sont des opérations : `add_meal`, `replace_recipe`, `remove_meal`, `set_next_lunch`, etc.
- Elles sont validées par les mêmes règles que la saisie manuelle (`domain/assistant/proposal.js`).
- Rien n'est appliqué avant « Valider » ou « Accepter ».
- Chaque changement est enregistré dans `changeHistory` et peut être annulé avec `undoChange`.

**IA Claude.** La clé de l'utilisateur est utilisée depuis le navigateur (`services/llmService.js`), pour lire un PDF ou une photo (programme du coach, ticket, étiquette) et pour la demande libre. Sans clé, le moteur local prend le relais.

## 8. Règles à respecter avec cet utilisateur

- Ne jamais inventer un prix, une promotion, une disponibilité ou une économie.
- Ne jamais passer une commande Drive sans validation explicite. Ne pas enregistrer le mot de passe U, ne pas contourner les protections anti-robot, ne pas lire le site du Drive automatiquement.
- Ne pas se connecter à Cookidoo avec les identifiants de l'utilisateur.
- Ne jamais mettre ses données personnelles (nom, poids, programme réel) dans le dépôt : les tests utilisent des données anonymes.
- Ne jamais lui conseiller d'effacer les données du site : cela supprimerait ses données locales. Pour un nouveau téléphone : exporter, puis restaurer.
- Mettre à jour `main` seulement quand il le demande (« fusionne et publie »). Ne pas créer de pull request sans demande.
- Il veut une application **simple** : peu d'écrans et peu d'onglets, des actions directes, des messages courts en français.

## 9. Idées non réalisées

- Publier la 0.17.1 (à sa demande).
- Boîte du midi quand le déjeuner du coach est un menu fixe (aujourd'hui non prise en charge : un message l'explique).
- Si les personnes présentes au dîner et au déjeuner diffèrent, les quantités de la recette « + demain midi » sont approchées (2 portions mises à l'échelle).
- Ajouter au dépôt le lanceur de tests Node et quelques parcours Playwright.
- Un test automatique de « Vider la semaine » (vérifié à la main dans le navigateur seulement).
