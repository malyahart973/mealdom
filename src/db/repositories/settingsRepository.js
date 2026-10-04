import { openDatabase, promisify } from '../database.js';

/** @typedef {{ key: string, value: unknown }} SettingRecord */

const STORE = 'settings';

/**
 * Lit un reglage. Renvoie null s'il n'existe pas.
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function getSetting(key) {
  const db = await openDatabase();
  const record = /** @type {SettingRecord | undefined} */ (
    await promisify(db.transaction(STORE).objectStore(STORE).get(key))
  );
  return record ? record.value : null;
}

/**
 * Enregistre un reglage.
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  const db = await openDatabase();
  await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ key, value }));
}

/**
 * Lit tous les reglages (utilise pour l'export).
 * @returns {Promise<SettingRecord[]>}
 */
export async function getAllSettings() {
  const db = await openDatabase();
  return /** @type {SettingRecord[]} */ (await promisify(db.transaction(STORE).objectStore(STORE).getAll()));
}
