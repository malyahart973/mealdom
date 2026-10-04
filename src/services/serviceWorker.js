/**
 * Enregistre le service worker (fonctionnement hors ligne)
 * et previent quand une nouvelle version est prete.
 * @param {(worker: ServiceWorker) => void} onUpdateReady
 */
export async function registerServiceWorker(onUpdateReady) {
  if (!('serviceWorker' in navigator)) return;

  // Ne recharger la page que lors d'une MISE A JOUR, pas lors de la premiere installation.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    if (registration.waiting && navigator.serviceWorker.controller) {
      onUpdateReady(registration.waiting);
    }
    // Une application installee reste souvent ouverte en arriere-plan :
    // on verifie les mises a jour a chaque retour sur l'application.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdateReady(worker);
        }
      });
    });
  } catch (error) {
    console.error("Le mode hors ligne n'a pas pu etre active :", error);
  }
}

/**
 * Active la nouvelle version (la page se recharge ensuite).
 * @param {ServiceWorker} worker
 */
export function applyUpdate(worker) {
  worker.postMessage({ type: 'SKIP_WAITING' });
}
