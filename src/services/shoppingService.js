/**
 * Stock et courses : relie les ecrans, les regles du domaine et la base.
 */
import { aggregateNeeds, buildShoppingLines, mealNeedLines, validateInventoryItem, validatePackage } from '../domain/shopping/shopping.js';
import { weekDays } from '../domain/planning/dates.js';
import { getInventory, getPackages, getShoppingList, inventoryStore, packageStore, shoppingListStore } from '../db/repositories/shoppingRepository.js';
import { getMeals } from './planningService.js';
import { getHousehold } from './householdService.js';
import { recipesById, preparationsById, ingredientsById } from './catalog.js';

/** @typedef {import('../domain/shopping/shopping.js').InventoryItem} InventoryItem */
/** @typedef {import('../domain/shopping/shopping.js').Package} Package */
/** @typedef {import('../domain/shopping/shopping.js').ShoppingListState} ShoppingListState */

export { getInventory, getPackages, getShoppingList };

/** @returns {string} */
export function newId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Besoins agreges des repas d'une semaine (avant stock).
 * @param {string} monday
 */
export async function weekNeeds(monday) {
  const days = new Set(weekDays(monday));
  const [meals, household] = await Promise.all([getMeals(), getHousehold()]);
  const weekMeals = meals.filter((m) => days.has(m.date));
  return {
    mealCount: weekMeals.length,
    needs: aggregateNeeds(mealNeedLines(weekMeals, household, recipesById, preparationsById), ingredientsById),
  };
}

/**
 * Liste de courses de la semaine : besoins, stock et conditionnements.
 * @param {string} monday
 */
export async function weekShoppingList(monday) {
  const [{ mealCount, needs }, inventory, packages, state] = await Promise.all([
    weekNeeds(monday),
    getInventory(),
    getPackages(),
    getShoppingList(monday),
  ]);
  return { mealCount, lines: buildShoppingLines(needs, inventory, packages, ingredientsById), state };
}

/**
 * @param {ShoppingListState} state
 * @returns {Promise<void>}
 */
export function saveShoppingList(state) {
  return shoppingListStore.put(state);
}

/**
 * @param {InventoryItem} item
 * @returns {Promise<string[]>}
 */
export async function saveInventoryItem(item) {
  const errors = validateInventoryItem(item, ingredientsById);
  if (errors.length === 0) await inventoryStore.put(item);
  return errors;
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteInventoryItem(id) {
  return inventoryStore.delete(id);
}

/**
 * @param {Package} pkg
 * @returns {Promise<string[]>}
 */
export async function savePackage(pkg) {
  const errors = validatePackage(pkg, ingredientsById);
  if (errors.length === 0) await packageStore.put({ ...pkg, label: pkg.label.trim() });
  return errors;
}

/**
 * @param {string} ingredientId
 * @returns {Promise<void>}
 */
export function deletePackage(ingredientId) {
  return packageStore.delete(ingredientId);
}
