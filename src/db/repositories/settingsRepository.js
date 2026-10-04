import { objectStore } from './storeHelpers.js';

/** @typedef {{ key: string, value: unknown }} SettingRecord */

const settings = objectStore('settings');

/**
 * Lit un reglage. Renvoie null s'il n'existe pas.
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function getSetting(key) {
  const record = /** @type {SettingRecord | undefined} */ (await settings.get(key));
  return record ? record.value : null;
}

/**
 * Enregistre un reglage.
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export function setSetting(key, value) {
  return settings.put({ key, value });
}

/**
 * Lit tous les reglages (utilise pour l'export).
 * @returns {Promise<SettingRecord[]>}
 */
export function getAllSettings() {
  return settings.getAll();
}
