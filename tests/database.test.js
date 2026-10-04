/**
 * Tests des migrations IndexedDB. Ils ne s'executent que dans un navigateur
 * (ouvrir tests/index.html) car ils utilisent une vraie base de test.
 */
import { test, assertEqual } from './runner.js';
import { migrations } from '../src/db/migrations.js';

const hasIndexedDb = typeof indexedDB !== 'undefined';

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

if (hasIndexedDb) {
  const { openDatabaseWith } = await import('../src/db/database.js');

  test('Migration v1 -> v2 : les réglages existants sont conservés et le foyer est créé', async () => {
    const name = `mealdom-test-${Date.now()}`;
    const v1 = await openDatabaseWith(name, migrations.slice(0, 1));
    const tx = v1.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key: 'lastExportAt', value: '2026-10-01' });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    v1.close();

    const v2 = await openDatabaseWith(name, migrations);
    assertEqual(v2.version, 2);
    assertEqual([...v2.objectStoreNames].sort(), ['household', 'settings']);
    const kept = await done(v2.transaction('settings').objectStore('settings').get('lastExportAt'));
    assertEqual(kept, { key: 'lastExportAt', value: '2026-10-01' });
    v2.close();
    await done(indexedDB.deleteDatabase(name));
  });

  test('Nouvelle installation : toutes les migrations sont appliquées', async () => {
    const name = `mealdom-test-new-${Date.now()}`;
    const db = await openDatabaseWith(name, migrations);
    assertEqual(db.version, migrations.length);
    assertEqual([...db.objectStoreNames].sort(), ['household', 'settings']);
    db.close();
    await done(indexedDB.deleteDatabase(name));
  });
}
