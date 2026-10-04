/**
 * Migrations de la base locale (IndexedDB).
 * Chaque element du tableau fait passer la base a la version suivante :
 * migrations[0] cree la version 1, migrations[1] la version 2, etc.
 * Ne JAMAIS modifier une migration deja publiee : en ajouter une nouvelle a la fin.
 */

/** @typedef {(db: IDBDatabase, tx: IDBTransaction) => void} Migration */

/** @type {Migration[]} */
export const migrations = [
  // v1 (0.1.0) : reglages de l'application (cle -> valeur)
  (db) => {
    db.createObjectStore('settings', { keyPath: 'key' });
  },
  // v2 (0.4.0) : foyer (un seul enregistrement, id "main")
  (db) => {
    db.createObjectStore('household', { keyPath: 'id' });
  },
  // v3 (0.5.0) : repas planifies, recherchables par date
  (db) => {
    const store = db.createObjectStore('meals', { keyPath: 'id' });
    store.createIndex('date', 'date');
  },
];

/** Version actuelle du schema de la base. */
export const DB_VERSION = migrations.length;
