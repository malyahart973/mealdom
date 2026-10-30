# MealDom

Application installable sur téléphone (PWA) pour organiser les repas du foyer :
planning, plus de 600 recettes du monde (dont plus de 250 asiatiques), batch cooking, stock, liste de courses,
budget, comparaison des magasins, Drive Hyper U Cayenne, programme minceur avec suivi du poids,
et un assistant conversationnel qui modifie le planning à la demande.

Fonctionne sans compte et sans Internet. Les données restent sur l'appareil.
Seule exception, facultative : avec une clé API Anthropic, l'assistant envoie les demandes à l'IA Claude.

## Assistant : qui fait quoi

- **L'IA propose, explique et calcule** : elle comprend la demande, lit le planning et les prix au moyen
  d'outils en lecture seule, puis propose des opérations (remplacer un repas, changer un ingrédient, ajuster les portions...).
- **Le moteur de l'application vérifie et exécute** : chaque opération est validée par les mêmes règles que la saisie
  manuelle (foyer, allergies, verrouillage), chiffrée avec les prix enregistrés, puis montrée en avant/après.
  Rien ne change avant « Accepter » ; chaque changement accepté peut être annulé.
- L'IA n'a aucun accès direct à la base et ne peut pas commander. Une commande Drive se valide séparément, après
  vérification des prix, quantités, disponibilités et du magasin.
- Sans clé (ou hors ligne), le moteur local comprend les demandes courantes et fait les mêmes propositions.
- Aucune promotion, aucun prix, aucune disponibilité n'est inventé : ils viennent des relevés (datés) ou d'un import.

## Drive Hyper U Cayenne

Hyper U ne publie pas d'accès pour les applications. MealDom ne lit donc pas le site du Drive : les prix,
formats et promotions sont relevés sur le site (saisie ou import CSV) avec leur date. Un prix de plus de 48 h
est signalé « à revérifier ». MealDom prépare le panier, contrôle la commande et la fait valider explicitement ;
la commande se passe ensuite sur le site du Drive.

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
    stores/           Magasins, prix relevés, disponibilité, coût estimé des courses
    budget/           Montants en centimes, budget, dépenses réelles, prévision
    nutrition/        Valeurs nutritionnelles, programme minceur (besoins, portions), suivi du poids
    drive/            Produits Drive, promotions, chiffrage vérifié/estimé, contrôle de commande
    assistant/        Compréhension des demandes, moteur de propositions, opérations, préférences, outils de l'IA
    trips/            Coût des trajets, regroupement des achats par magasin, sortie courses et agenda, positions et distances
  data/               Données de référence (ingrédients, valeurs nutritionnelles, cuisines, préparations, portions)
    catalog/          Catalogue de recettes par famille (petit-déjeuner, goûter, Asie, monde, léger)
  db/                 Base locale et accès aux données
  utils/              Petits outils communs
  styles/main.css     Style (charte Roucou & Mangue)
  styles/fonts/       Polices intégrées (licence SIL OFL)
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

- **0.14.0** — Assistant guidé « Planifier ma semaine » : trois questions, la semaine en cartes, « Changer » ou « Retirer » un plat, un seul bouton « Valider » (annulable). Recettes rangées par famille (un plat dans une seule famille), semaine variée en familles et en régions. 48 recettes faciles du quotidien (quiches, tartes salées, pizzas, gratins, veloutés, omelettes, plats au four, desserts), dont 13 avec une méthode au robot cuiseur (type Thermomix). « Mes recettes » : saisie, import d’un texte collé (sans IA), d’un lien ou d’une photo / capture d’écran (IA), à vérifier avant enregistrement. Écran unique « Ajouter un prix » : scan du code-barres (lecteur du téléphone ou lecteur ZXing intégré, hors ligne), fiche Open Food Facts, prix toujours saisi ou lu sur l’étiquette. Programme minceur : compter les calories ou rééquilibrage sans compter, option « plus de protéines », jeûne intermittent (12/12, 14/10, 16/8), 3 à 5 repas par jour avec collation du matin, semaine type de sport (calories en partie remangées les jours de séance), trame de repas personnelle (coach, diététicienne), cinq rythmes comparés dont la stabilisation. Base v9.
- **0.13.2** — Correction : le bouton « Accepter » de l’assistant restait grisé pour les gros changements (planning de la semaine) tant qu’une case peu visible n’était pas cochée ; il est maintenant toujours actif et demande une confirmation claire. « Fais-moi un planning » est désormais résumé comme compris.
- **0.13.1** — Nouvelle icône « couï garni » : un couï (calebasse) aux couleurs roucou et mangue, avec un fruit et une feuille, sur fond vert fleuve.
- **0.13.0** — Nouvelle charte « Roucou & Mangue » (polices Bricolage Grotesque et DM Sans intégrées, thèmes clair et sombre), accueil redessiné avec l’anneau des calories prévues du jour. Partage de la liste de courses en un geste. Dates de péremption dans le stock (produits à consommer en priorité, priorité dans les propositions). Historique des prix (base v8) avec courbe par magasin, hausses et baisses. Produits de saison en Guyane (péyi, prix au plus bas, calendrier modifiable) et mode « de saison » de l’assistant.
- **0.12.0** — Disponibilité des ingrédients en Guyane : indications par défaut (épicerie asiatique, marché, importé, souvent introuvable), corrections de la cliente, alternatives appliquées d’office aux ingrédients introuvables, recettes impossibles écartées des propositions, filtre « Faciles à trouver en Guyane », indications sur la liste de courses, remplacement d’ingrédient dans la fiche repas. Distance domicile ↔ magasin calculée (adresse via la Géoplateforme de l’IGN ou position GPS, itinéraire OSRM/OpenStreetMap, estimation signalée si le service ne répond pas).
- **0.11.0** — « Ajuster au budget » avec les prix réels du Drive : produits moins chers d’abord, puis remplacement des repas les plus coûteux par des plats économiques (légumineuses, œufs), sans jamais compter sur un prix inconnu ; proposition avant/après à valider. Priorité aux marques U et Prix Mini. Photo d’un produit ou d’une étiquette pour remplir le formulaire (lecture par l’IA, à vérifier). Bouton micro pour dicter à l’assistant.
- **0.10.0** — Organiser les courses : regroupement des achats sur 1 à 3 magasins (prix relevés + Drive), coût des trajets (distance, consommation, prix du carburant), objectif « limiter les trajets », sortie courses de la semaine avec ordre de passage et créneau de retrait Drive, repas prévus avant les courses, ajout à l'agenda du téléphone, rappel sur l'accueil. Modèle de fichier CSV pour l'import des prix Drive. Base v7.
- **0.9.0** — Assistant conversationnel (IA Claude facultative + moteur local hors ligne) : demandes libres, modes combinables (promotions, gourmand, économie, équilibre, rapidité, anti-gaspillage...), aperçu avant/après chiffré, Accepter/Modifier/Annuler, historique et annulation, préférences retenues. Catalogue de 602 recettes (petit-déjeuner, repas, goûter). Programme minceur (besoins, objectifs par repas, portions en grammes) et suivi du poids avec courbe. Drive Hyper U Cayenne (relevés, promotions, panier vérifié, commande validée explicitement). Goûter dans le planning. Base v6.
- **0.8.0** — Magasins et prix relevés, coût estimé des courses, budget mensuel/hebdomadaire/exceptionnel, dépenses réelles, prévision de fin de mois. Base v5.
- **0.7.0** — Stock, liste de courses de la semaine (agrégation, déduction du stock, conditionnements, rayons, cases à cocher hors ligne, articles ajoutés à la main). Bouton Retour dans la barre du haut. Base v4.
- **0.6.0** — Batch cooking de la semaine (préparations partagées, quantités, ordre, cuissons en parallèle). 2 préparations et 2 recettes ajoutées. Vérification des mises à jour au retour dans l'application.
- **0.5.0** — Planning manuel de la semaine : ajout, modification, déplacement, verrouillage, invités, dîner qui sert au déjeuner du lendemain. Repas du jour sur l'accueil. Base v3.
- **0.4.0** — Foyer : personnes, allergies, régimes, aliments refusés, équipement, portion enfant, objectifs. Recettes adaptées au foyer. Base v2.
- **0.3.0** — Modèle des recettes et des préparations, 5 premières recettes, écrans Recettes et Fiche recette.
- **0.2.0** — Unités et conversions, ingrédients normalisés, 14 allergènes, calcul des portions.
- **0.1.0** — Fondation : structure, navigation, mode hors ligne, installation, base locale, export des données, rappel de sauvegarde.
