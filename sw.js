/* Service worker de MealDom : permet d'utiliser l'application sans Internet. */
importScripts('./src/version.js');

const CACHE_NAME = `mealdom-${self.MEALDOM_VERSION}`;

// Tous les fichiers de l'application. A COMPLETER a chaque nouveau fichier.
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './src/version.js',
  './src/config.js',
  './src/app.js',
  './src/router.js',
  './src/styles/main.css',
  './src/pages/home.js',
  './src/pages/placeholder.js',
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
  './src/utils/html.js',
  './src/utils/format.js',
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
