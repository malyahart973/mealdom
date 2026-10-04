/** @typedef {'granted' | 'denied' | 'unsupported'} PersistenceStatus */

/**
 * Demande au navigateur de ne pas effacer les donnees locales.
 * C'est une demande, pas une garantie.
 * @returns {Promise<PersistenceStatus>}
 */
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/**
 * Etat actuel, sans rien demander.
 * @returns {Promise<PersistenceStatus>}
 */
export async function getPersistenceStatus() {
  if (!navigator.storage || !navigator.storage.persisted) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}
