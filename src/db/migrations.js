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
  // v4 (0.7.0) : stock, conditionnements habituels, listes de courses (une par semaine)
  (db) => {
    db.createObjectStore('inventory', { keyPath: 'id' });
    db.createObjectStore('packages', { keyPath: 'ingredientId' });
    db.createObjectStore('shoppingLists', { keyPath: 'week' });
  },
  // v5 (0.8.0) : magasins, prix, budget, depenses reelles
  (db) => {
    db.createObjectStore('stores', { keyPath: 'id' });
    db.createObjectStore('prices', { keyPath: 'id' }).createIndex('storeId', 'storeId');
    db.createObjectStore('budget', { keyPath: 'id' });
    db.createObjectStore('expenses', { keyPath: 'id' }).createIndex('date', 'date');
  },
  // v6 (0.9.0) : assistant (conversations, historique des changements, preferences),
  // Drive (produits releves, commandes), programme minceur et pesees
  (db) => {
    db.createObjectStore('conversations', { keyPath: 'week' });
    db.createObjectStore('changeHistory', { keyPath: 'id' }).createIndex('week', 'week');
    db.createObjectStore('preferences', { keyPath: 'id' });
    db.createObjectStore('driveProducts', { keyPath: 'key' }).createIndex('storeId', 'storeId');
    db.createObjectStore('driveOrders', { keyPath: 'id' });
    db.createObjectStore('program', { keyPath: 'id' });
    db.createObjectStore('weights', { keyPath: 'date' });
  },
  // v7 (0.10.0) : sorties courses (une par semaine : jour, magasins, creneau Drive)
  (db) => {
    db.createObjectStore('shoppingTrips', { keyPath: 'week' });
  },
  // v8 (0.13.0) : historique des prix releves
  (db) => {
    db.createObjectStore('priceHistory', { keyPath: 'id' }).createIndex('ingredientId', 'ingredientId');
  },
];

/** Version actuelle du schema de la base. */
export const DB_VERSION = migrations.length;
