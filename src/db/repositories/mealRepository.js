import { openDatabase, promisify } from '../database.js';

/** @typedef {import('../../domain/planning/planning.js').Meal} Meal */

const STORE = 'meals';

/** @returns {Promise<Meal[]>} */
export async function getAllMeals() {
  const db = await openDatabase();
  return /** @type {Meal[]} */ (await promisify(db.transaction(STORE).objectStore(STORE).getAll()));
}

/**
 * @param {Meal} meal
 * @returns {Promise<void>}
 */
export async function putMeal(meal) {
  const db = await openDatabase();
  await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).put(meal));
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteMealRecord(id) {
  const db = await openDatabase();
  await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
}
