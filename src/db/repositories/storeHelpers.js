import { openDatabase, promisify } from '../database.js';

/**
 * Lecture et ecriture generiques d'un magasin IndexedDB (une seule implementation).
 * @param {string} store
 */
export function objectStore(store) {
  return {
    /** @returns {Promise<any[]>} */
    async getAll() {
      const db = await openDatabase();
      return promisify(db.transaction(store).objectStore(store).getAll());
    },
    /**
     * @param {IDBValidKey} key
     * @returns {Promise<any>}
     */
    async get(key) {
      const db = await openDatabase();
      return promisify(db.transaction(store).objectStore(store).get(key));
    },
    /**
     * @param {unknown} value
     * @returns {Promise<void>}
     */
    async put(value) {
      const db = await openDatabase();
      await promisify(db.transaction(store, 'readwrite').objectStore(store).put(value));
    },
    /**
     * @param {IDBValidKey} key
     * @returns {Promise<void>}
     */
    async delete(key) {
      const db = await openDatabase();
      await promisify(db.transaction(store, 'readwrite').objectStore(store).delete(key));
    },
  };
}
