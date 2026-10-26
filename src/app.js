/**
 * Point d'entree de MealDom.
 * Ce fichier demarre l'application ; il ne contient aucune regle metier.
 */
import { startRouter } from './router.js';
import { requestPersistentStorage } from './services/storage.js';
import { registerServiceWorker, applyUpdate } from './services/serviceWorker.js';
import { loadUserRecipes } from './services/userRecipeService.js';

/**
 * Recupere un element obligatoire de la page.
 * @param {string} id
 * @returns {HTMLElement}
 */
function requireElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} introuvable dans index.html`);
  return el;
}

function watchConnection() {
  const badge = requireElement('net-status');
  const update = () => {
    badge.hidden = navigator.onLine;
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

async function start() {
  watchConnection();
  // Les recettes personnelles rejoignent le catalogue avant le premier ecran.
  try {
    await loadUserRecipes();
  } catch (error) {
    console.error('Recettes personnelles non chargées', error);
  }
  startRouter(requireElement('view'), requireElement('tabbar'), /** @type {HTMLButtonElement} */ (requireElement('back-button')));
  requestPersistentStorage();

  const banner = requireElement('update-banner');
  const updateButton = requireElement('update-button');
  registerServiceWorker((worker) => {
    banner.hidden = false;
    updateButton.onclick = () => applyUpdate(worker);
  });
}

start();
