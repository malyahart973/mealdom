import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/planning/planning.js').Meal} Meal */

const meals = objectStore('meals');

/** @returns {Promise<Meal[]>} */
export function getAllMeals() {
  return meals.getAll();
}

/**
 * @param {Meal} meal
 * @returns {Promise<void>}
 */
export function putMeal(meal) {
  return meals.put(meal);
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteMealRecord(id) {
  return meals.delete(id);
}
