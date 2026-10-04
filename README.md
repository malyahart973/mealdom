# MealDom

Application installable sur téléphone (PWA) pour organiser les repas du foyer :
planning, recettes du monde, batch cooking, stock, liste de courses, budget et comparaison des magasins.

Fonctionne sans compte et sans Internet. Les données restent sur l'appareil.

## Technique

- HTML, CSS et JavaScript en modules, **sans Node et sans compilation**.
- Vérification stricte du code par VS Code (`jsconfig.json`, typage JSDoc).
- Données locales : IndexedDB (`src/db/`), avec migrations versionnées.
- Hors ligne : service worker (`sw.js`).
- Publication : n'importe quel hébergeur de site statique en HTTPS (Netlify, Cloudflare Pages...). Les en-têtes de cache sont dans `_headers`.

## Organisation

```
index.html            Page unique de l'application
sw.js                 Mode hors ligne (liste des fichiers à mettre en cache)
manifest.webmanifest  Installation sur le téléphone
icons/                Icônes
src/
  version.js          Numéro de version (unique)
  config.js           Réglages généraux
  app.js              Démarrage
  router.js           Navigation entre les écrans
  pages/              Écrans (affichage uniquement)
  services/           Liens entre écrans, données et navigateur
  domain/             Règles métier (calculs purs, testés)
    units/            Unités et conversions universelles
    ingredients/      Ingrédients, 14 allergènes, conversions propres à un aliment
    portions/         Portions adulte/enfant, arrondi, dîner + déjeuner du lendemain
    recipes/          Recettes, préparations réutilisables, équipements, filtrage
    household/        Foyer, membres, régimes, compatibilité recette / foyer
    planning/         Dates, planning manuel, portions par repas, restes, verrouillage
    batchCooking/     Préparations de la semaine, quantités totales, ordre et durée de la session
    shopping/         Besoins de la semaine, agrégation, stock, conditionnements, liste de courses
  data/               Données de référence (ingrédients, cuisines, préparations, recettes, portions)
  db/                 Base locale et accès aux données
  utils/              Petits outils communs
  styles/main.css     Style
tests/                Tests des règles métier (ouvrir tests/index.html)
```

## Règles

- Aucun calcul métier dans `pages/` : il va dans `domain/`, avec ses tests.
- Une seule implémentation par règle : on modifie l'existant, on ne crée pas de copie.
- Chaque nouveau fichier est ajouté à la liste `APP_FILES` de `sw.js`.
- Chaque livraison augmente la version dans `src/version.js`.
- Une migration de base publiée n'est jamais modifiée : on en ajoute une nouvelle.

## Tester

- Application : ouvrir le site Netlify, ou `index.html` avec Live Server.
- Calculs : ouvrir `/tests/` sur le site Netlify (ou `tests/index.html` avec Live Server).

## Historique

- **0.7.0** — Stock, liste de courses de la semaine (agrégation, déduction du stock, conditionnements, rayons, cases à cocher hors ligne, articles ajoutés à la main). Bouton Retour dans la barre du haut. Base v4.
- **0.6.0** — Batch cooking de la semaine (préparations partagées, quantités, ordre, cuissons en parallèle). 2 préparations et 2 recettes ajoutées. Vérification des mises à jour au retour dans l'application.
- **0.5.0** — Planning manuel de la semaine : ajout, modification, déplacement, verrouillage, invités, dîner qui sert au déjeuner du lendemain. Repas du jour sur l'accueil. Base v3.
- **0.4.0** — Foyer : personnes, allergies, régimes, aliments refusés, équipement, portion enfant, objectifs. Recettes adaptées au foyer. Base v2.
- **0.3.0** — Modèle des recettes et des préparations, 5 premières recettes, écrans Recettes et Fiche recette.
- **0.2.0** — Unités et conversions, ingrédients normalisés, 14 allergènes, calcul des portions.
- **0.1.0** — Fondation : structure, navigation, mode hors ligne, installation, base locale, export des données, rappel de sauvegarde.
