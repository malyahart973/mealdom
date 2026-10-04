import { migrations, DB_VERSION } from './migrations.js';

const DB_NAME = 'mealdom';

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

/**
 * Ouvre la base locale (une seule fois) en appliquant les migrations manquantes.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = /** @type {IDBTransaction} */ (request.transaction);
      for (let v = event.oldVersion; v < DB_VERSION; v++) {
        migrations[v](db, tx);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Base de donnees bloquee : fermez les autres onglets MealDom.'));
  });
  return dbPromise;
}

/**
 * Transforme une requete IndexedDB en promesse.
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
export function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
