import { migrations } from './migrations.js';

const DB_NAME = 'mealdom';

/** @typedef {import('./migrations.js').Migration} Migration */

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

/**
 * Ouvre une base en appliquant les migrations manquantes.
 * Parametrable pour pouvoir tester les migrations sur une base de test.
 * @param {string} name
 * @param {Migration[]} migrationList
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabaseWith(name, migrationList) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, migrationList.length);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = /** @type {IDBTransaction} */ (request.transaction);
      for (let v = event.oldVersion; v < migrationList.length; v++) {
        migrationList[v](db, tx);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // "blocked" : une ancienne connexion n'est pas encore fermee. L'ouverture reprend
    // d'elle-meme des qu'elle se ferme (voir onversionchange dans openDatabase).
    request.onblocked = () => console.warn('Mise a jour de la base en attente : fermez les autres onglets MealDom.');
  });
}

/**
 * Ouvre la base de l'application (une seule fois).
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (!dbPromise) {
    dbPromise = openDatabaseWith(DB_NAME, migrations).then((db) => {
      // Une nouvelle version ouverte dans un autre onglet demande la fermeture : on recharge.
      db.onversionchange = () => {
        db.close();
        window.location.reload();
      };
      return db;
    });
  }
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
