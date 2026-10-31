/**
 * Enregistre le service worker (fonctionnement hors ligne)
 * et previent quand une nouvelle version est prete.
 *
 * Le service worker est enregistre avec la version dans son adresse (sw.js?v=0.16.4) : une
 * nouvelle version change l'adresse, ce que tous les navigateurs reconnaissent comme une mise a
 * jour (certains, comme Safari, ne regardent pas les fichiers importes par sw.js). Au demarrage et
 * a chaque retour sur l'application, la version publiee est lue sur Internet (jamais en cache).
 */

/** Version de cette page (src/version.js). */
const CURRENT = /** @type {{ MEALDOM_VERSION?: string }} */ (globalThis).MEALDOM_VERSION ?? '';

/**
 * Lit la version publiee sur Internet, sans passer par le cache. null hors ligne ou en cas d'erreur.
 * @returns {Promise<string | null>}
 */
async function publishedVersion() {
  try {
    const response = await fetch(`./src/version.js?check=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return /MEALDOM_VERSION\s*=\s*'([^']+)'/.exec(await response.text())?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} version
 * @returns {string}
 */
const scriptFor = (version) => `./sw.js?v=${encodeURIComponent(version)}`;

/**
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
    // Deja installe : on garde l'enregistrement tel quel (le reenregistrer sous une autre adresse
    // proposerait une mise a jour inutile) ; la verification ci-dessous fait le reste.
    const registration = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register(scriptFor(CURRENT), { updateViaCache: 'none' }));
    if (registration.waiting && navigator.serviceWorker.controller) {
      onUpdateReady(registration.waiting);
    }
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdateReady(worker);
        }
      });
    });
    // Nouvelle version publiee ? On installe son service worker (nouvelle adresse) ; sinon on
    // laisse le navigateur faire sa verification habituelle.
    const check = async () => {
      const latest = await publishedVersion();
      if (latest && latest !== CURRENT) await navigator.serviceWorker.register(scriptFor(latest), { updateViaCache: 'none' });
      else await registration.update();
    };
    check().catch(() => {});
    // Une application installee reste souvent ouverte en arriere-plan :
    // on verifie les mises a jour a chaque retour sur l'application.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check().catch(() => {});
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
