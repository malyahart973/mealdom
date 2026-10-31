/* Service worker de MealDom : permet d'utiliser l'application sans Internet. */
importScripts('./src/version.js');

const CACHE_NAME = `mealdom-${self.MEALDOM_VERSION}`;

// Tous les fichiers de l'application. A COMPLETER a chaque nouveau fichier.
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './src/version.js',
  './src/config.js',
  './src/app.js',
  './src/router.js',
  './src/styles/main.css',
  './src/styles/fonts/bricolage-grotesque.woff2',
  './src/styles/fonts/dm-sans.woff2',
  './src/pages/home.js',
  './src/pages/more.js',
  './src/pages/settings.js',
  './src/services/backupService.js',
  './src/services/storage.js',
  './src/services/serviceWorker.js',
  './src/db/database.js',
  './src/db/migrations.js',
  './src/db/repositories/settingsRepository.js',
  './src/domain/backup/backup.js',
  './src/domain/units/units.js',
  './src/domain/ingredients/allergens.js',
  './src/domain/ingredients/ingredients.js',
  './src/domain/ingredients/conversion.js',
  './src/domain/portions/portions.js',
  './src/data/ingredients.js',
  './src/data/portionRules.js',
  './src/data/cuisines.js',
  './src/data/preparations.js',
  './src/data/recipes.js',
  './src/data/recipeBuilder.js',
  './src/data/allRecipes.js',
  './src/data/nutrition.js',
  './src/data/catalog/breakfast.js',
  './src/data/catalog/snacks.js',
  './src/data/catalog/asiaEast.js',
  './src/data/catalog/asiaSoutheast.js',
  './src/data/catalog/asiaSouth.js',
  './src/data/catalog/worldEurope.js',
  './src/data/catalog/worldTropics.js',
  './src/data/catalog/worldAmericas.js',
  './src/data/catalog/light.js',
  './src/data/catalog/everyday.js',
  './src/domain/nutrition/nutrition.js',
  './src/domain/nutrition/program.js',
  './src/domain/nutrition/weight.js',
  './src/domain/recipes/equipment.js',
  './src/domain/recipes/cooking.js',
  './src/domain/recipes/recipes.js',
  './src/domain/recipes/families.js',
  './src/domain/recipes/recipeImport.js',
  './src/domain/recipes/recipeFiltering.js',
  './src/services/catalog.js',
  './src/services/userRecipeService.js',
  './src/pages/recipes.js',
  './src/pages/recipe.js',
  './src/pages/recipeEditor.js',
  './src/utils/download.js',
  './src/utils/quantity.js',
  './src/utils/forms.js',
  './src/domain/household/household.js',
  './src/domain/household/compatibility.js',
  './src/db/repositories/householdRepository.js',
  './src/services/householdService.js',
  './src/pages/household.js',
  './src/pages/member.js',
  './src/domain/planning/dates.js',
  './src/domain/planning/planning.js',
  './src/db/repositories/mealRepository.js',
  './src/services/planningService.js',
  './src/pages/planning.js',
  './src/pages/meal.js',
  './src/domain/batchCooking/batchCooking.js',
  './src/domain/batchCooking/keeping.js',
  './src/domain/planning/calendar.js',
  './src/pages/batch.js',
  './src/pages/cook.js',
  './src/domain/shopping/shopping.js',
  './src/db/repositories/storeHelpers.js',
  './src/db/repositories/shoppingRepository.js',
  './src/services/shoppingService.js',
  './src/utils/units-select.js',
  './src/pages/shopping.js',
  './src/pages/package.js',
  './src/pages/stock.js',
  './src/domain/budget/money.js',
  './src/domain/budget/budget.js',
  './src/domain/stores/stores.js',
  './src/db/repositories/budgetRepository.js',
  './src/services/budgetService.js',
  './src/pages/stores.js',
  './src/pages/store.js',
  './src/pages/budget.js',
  './src/utils/html.js',
  './src/utils/format.js',
  './src/domain/drive/drive.js',
  './src/domain/drive/quote.js',
  './src/domain/assistant/substitutes.js',
  './src/domain/assistant/intent.js',
  './src/domain/assistant/scoring.js',
  './src/domain/assistant/proposal.js',
  './src/domain/assistant/engine.js',
  './src/domain/assistant/guided.js',
  './src/domain/assistant/preferences.js',
  './src/domain/assistant/conversation.js',
  './src/domain/assistant/tools.js',
  './src/db/repositories/assistantRepository.js',
  './src/db/repositories/driveRepository.js',
  './src/db/repositories/programRepository.js',
  './src/services/llmService.js',
  './src/services/assistantService.js',
  './src/services/driveService.js',
  './src/services/programService.js',
  './src/pages/assistant.js',
  './src/pages/assistantGuided.js',
  './src/pages/assistantPanel.js',
  './src/pages/assistantPreferences.js',
  './src/pages/drive.js',
  './src/pages/program.js',
  './src/pages/weight.js',
  './src/pages/weightChart.js',
  './src/domain/trips/trips.js',
  './src/db/repositories/tripRepository.js',
  './src/services/tripService.js',
  './src/pages/trip.js',
  './src/domain/assistant/budgetFit.js',
  './src/utils/speech.js',
  './src/utils/barcodeScanner.js',
  './src/vendor/barcode-detector.js',
  './src/vendor/zxing_reader.wasm',
  './src/domain/drive/productPhoto.js',
  './src/services/photoService.js',
  './src/pages/photoField.js',
  './src/data/territory.js',
  './src/domain/ingredients/territory.js',
  './src/services/territoryService.js',
  './src/domain/trips/geo.js',
  './src/services/geoService.js',
  './src/domain/stores/priceHistory.js',
  './src/domain/stores/barcode.js',
  './src/db/repositories/priceHistoryRepository.js',
  './src/db/repositories/recipeRepository.js',
  './src/db/repositories/barcodeRepository.js',
  './src/services/priceHistoryService.js',
  './src/services/barcodeService.js',
  './src/services/batchService.js',
  './src/services/cookService.js',
  './src/pages/priceChart.js',
  './src/pages/prices.js',
  './src/pages/addPrice.js',
  './src/data/seasons.js',
  './src/domain/ingredients/seasons.js',
  './src/services/seasonService.js',
  './src/pages/seasons.js',
  './src/pages/calorieRing.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// L'utilisateur a accepte la mise a jour : la nouvelle version prend la main.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Ouverture de l'application : la page principale en cache, meme sans Internet.
  // Les autres pages (ex. tests/) ne sont pas concernees.
  if (request.mode === 'navigate') {
    const appRoot = new URL('./', self.registration.scope).pathname;
    const path = new URL(request.url).pathname;
    if (path === appRoot || path === `${appRoot}index.html`) {
      event.respondWith(caches.match('./index.html').then((cached) => cached || fetch(request)));
    }
    return;
  }

  // Autres fichiers : d'abord le cache, sinon Internet.
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
