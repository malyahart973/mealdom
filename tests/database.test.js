/**
 * Tests des migrations IndexedDB. Ils ne s'executent que dans un navigateur
 * (ouvrir tests/index.html) car ils utilisent une vraie base de test.
 */
import { test, assertEqual } from './runner.js';
import { migrations } from '../src/db/migrations.js';

const hasIndexedDb = typeof indexedDB !== 'undefined';
const ALL_STORES = ['budget', 'changeHistory', 'conversations', 'driveOrders', 'driveProducts', 'expenses', 'household', 'inventory', 'meals', 'packages', 'preferences', 'prices', 'program', 'settings', 'shoppingLists', 'stores', 'weights'];
const V5_STORES = ['budget', 'expenses', 'household', 'inventory', 'meals', 'packages', 'prices', 'settings', 'shoppingLists', 'stores'];

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
const done = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * Ecrit un enregistrement et attend la fin de la transaction.
 * @param {IDBDatabase} db
 * @param {string} store
 * @param {unknown} value
 */
const write = (db, store, value) =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

if (hasIndexedDb) {
  const { openDatabaseWith } = await import('../src/db/database.js');

  test('Migration v1 -> dernière version : les réglages sont conservés', async () => {
    const name = `mealdom-test-v1-${Date.now()}`;
    const v1 = await openDatabaseWith(name, migrations.slice(0, 1));
    await write(v1, 'settings', { key: 'lastExportAt', value: '2026-10-01' });
    v1.close();

    const latest = await openDatabaseWith(name, migrations);
    assertEqual(latest.version, migrations.length);
    assertEqual([...latest.objectStoreNames].sort(), ALL_STORES);
    assertEqual(await done(latest.transaction('settings').objectStore('settings').get('lastExportAt')), {
      key: 'lastExportAt',
      value: '2026-10-01',
    });
    latest.close();
    await done(indexedDB.deleteDatabase(name));
  });

  test('Migration v2 -> v3 : le foyer est conservé et les repas sont ajoutés', async () => {
    const name = `mealdom-test-v2-${Date.now()}`;
    const v2 = await openDatabaseWith(name, migrations.slice(0, 2));
    await write(v2, 'household', { id: 'main', members: [{ id: 'a', name: 'Léa' }] });
    v2.close();

    const v3 = await openDatabaseWith(name, migrations.slice(0, 3));
    const household = /** @type {{ members: { name: string }[] }} */ (
      await done(v3.transaction('household').objectStore('household').get('main'))
    );
    assertEqual(household.members[0].name, 'Léa');
    assertEqual([...v3.transaction('meals').objectStore('meals').indexNames], ['date']);
    v3.close();
    await done(indexedDB.deleteDatabase(name));
  });

  test('Migration v3 -> v4 : les repas sont conservés, stock et courses ajoutés', async () => {
    const name = `mealdom-test-v3-${Date.now()}`;
    const v3 = await openDatabaseWith(name, migrations.slice(0, 3));
    await write(v3, 'meals', { id: 'm1', date: '2026-10-05', slot: 'dinner' });
    v3.close();

    const v4 = await openDatabaseWith(name, migrations.slice(0, 4));
    assertEqual(await done(v4.transaction('meals').objectStore('meals').get('m1')), { id: 'm1', date: '2026-10-05', slot: 'dinner' });
    assertEqual([...v4.objectStoreNames].sort(), ['household', 'inventory', 'meals', 'packages', 'settings', 'shoppingLists']);
    v4.close();
    await done(indexedDB.deleteDatabase(name));
  });

  test('Migration v4 -> v5 : le stock est conservé, magasins et budget ajoutés', async () => {
    const name = `mealdom-test-v4-${Date.now()}`;
    const v4 = await openDatabaseWith(name, migrations.slice(0, 4));
    await write(v4, 'inventory', { id: 'i1', ingredientId: 'rice_white', quantity: 500, unit: 'g', location: 'pantry' });
    v4.close();

    const v5 = await openDatabaseWith(name, migrations.slice(0, 5));
    const item = /** @type {{ quantity: number }} */ (await done(v5.transaction('inventory').objectStore('inventory').get('i1')));
    assertEqual(item.quantity, 500);
    assertEqual([...v5.objectStoreNames].sort(), V5_STORES);
    v5.close();
    await done(indexedDB.deleteDatabase(name));
  });

  test('Migration v5 -> v6 : repas et budget conservés, assistant, Drive et programme ajoutés', async () => {
    const name = `mealdom-test-v5-${Date.now()}`;
    const v5 = await openDatabaseWith(name, migrations.slice(0, 5));
    await write(v5, 'meals', { id: 'm1', date: '2026-10-19', slot: 'dinner' });
    await write(v5, 'budget', { id: 'main', monthlyCents: 60000, weeklyCents: 15000, exceptional: [] });
    v5.close();

    const v6 = await openDatabaseWith(name, migrations.slice(0, 6));
    assertEqual(await done(v6.transaction('meals').objectStore('meals').get('m1')), { id: 'm1', date: '2026-10-19', slot: 'dinner' });
    const budget = /** @type {{ weeklyCents: number }} */ (await done(v6.transaction('budget').objectStore('budget').get('main')));
    assertEqual(budget.weeklyCents, 15000);
    assertEqual([...v6.objectStoreNames].sort(), ALL_STORES);
    v6.close();
    await done(indexedDB.deleteDatabase(name));
  });

  test('Nouvelle installation : toutes les migrations sont appliquées', async () => {
    const name = `mealdom-test-new-${Date.now()}`;
    const db = await openDatabaseWith(name, migrations);
    assertEqual(db.version, migrations.length);
    assertEqual([...db.objectStoreNames].sort(), ALL_STORES);
    db.close();
    await done(indexedDB.deleteDatabase(name));
  });
}
