import { openDatabase, promisify } from '../database.js';

/** @typedef {import('../../domain/household/household.js').Household} Household */

const STORE = 'household';

/**
 * Le foyer enregistre, ou null s'il n'a jamais ete cree.
 * @returns {Promise<Household | null>}
 */
export async function loadHouseholdRecord() {
  const db = await openDatabase();
  const record = await promisify(db.transaction(STORE).objectStore(STORE).get('main'));
  return record ? /** @type {Household} */ (record) : null;
}

/**
 * @param {Household} household
 * @returns {Promise<void>}
 */
export async function saveHouseholdRecord(household) {
  const db = await openDatabase();
  await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).put(household));
}
