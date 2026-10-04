import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/household/household.js').Household} Household */

const household = objectStore('household');

/**
 * Le foyer enregistre, ou null s'il n'a jamais ete cree.
 * @returns {Promise<Household | null>}
 */
export async function loadHouseholdRecord() {
  return (await household.get('main')) ?? null;
}

/**
 * @param {Household} value
 * @returns {Promise<void>}
 */
export function saveHouseholdRecord(value) {
  return household.put(value);
}
