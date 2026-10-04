/**
 * Planning : relie les ecrans, les regles du domaine et la base.
 */
import { removeMealFrom, saveMealIn, validateMeal } from '../domain/planning/planning.js';
import { getAllMeals, putMeal, deleteMealRecord } from '../db/repositories/mealRepository.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { getHousehold } from './householdService.js';
import { recipesById } from './catalog.js';

/** @typedef {import('../domain/planning/planning.js').Meal} Meal */

const BREAKFAST_KEY = 'planningShowBreakfast';

/** @returns {Promise<Meal[]>} */
export function getMeals() {
  return getAllMeals();
}

/** @returns {string} */
export function newMealId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Enregistre un repas (nouveau, modifie ou deplace). Seul ce repas est ecrit.
 * @param {Meal} meal
 * @returns {Promise<string[]>} erreurs (vide = enregistre)
 */
export async function saveMeal(meal) {
  const [meals, household] = await Promise.all([getAllMeals(), getHousehold()]);
  const existing = meals.find((m) => m.id === meal.id);
  // Deverrouiller seulement : pas besoin de revalider le contenu.
  const errors = existing?.locked ? [] : validateMeal(meal, meals, household, new Set(recipesById.keys()));
  if (errors.length > 0) return errors;
  const result = saveMealIn(meals, meal);
  if (!result.ok) return [result.error];
  await putMeal(meal);
  return [];
}

/**
 * @param {string} mealId
 * @returns {Promise<string | null>} message d'erreur, ou null si retire
 */
export async function deleteMeal(mealId) {
  const result = removeMealFrom(await getAllMeals(), mealId);
  if (!result.ok) return result.error;
  await deleteMealRecord(mealId);
  return null;
}

/** @returns {Promise<boolean>} */
export async function getShowBreakfast() {
  return (await getSetting(BREAKFAST_KEY)) === true;
}

/**
 * @param {boolean} value
 * @returns {Promise<void>}
 */
export async function setShowBreakfast(value) {
  await setSetting(BREAKFAST_KEY, value);
}
