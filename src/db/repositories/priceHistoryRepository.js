import { objectStore } from './storeHelpers.js';
import { openDatabase, promisify } from '../database.js';

/** @typedef {import('../../domain/stores/priceHistory.js').PricePoint} PricePoint */

export const priceHistoryStore = objectStore('priceHistory');

/** @returns {Promise<PricePoint[]>} */
export const getPriceHistory = () => priceHistoryStore.getAll();

/**
 * Points d'un ingredient (par l'index).
 * @param {string} ingredientId
 * @returns {Promise<PricePoint[]>}
 */
export async function getIngredientHistory(ingredientId) {
  const db = await openDatabase();
  return promisify(db.transaction('priceHistory').objectStore('priceHistory').index('ingredientId').getAll(ingredientId));
}
