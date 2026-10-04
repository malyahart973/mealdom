import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/shopping/shopping.js').InventoryItem} InventoryItem */
/** @typedef {import('../../domain/shopping/shopping.js').Package} Package */
/** @typedef {import('../../domain/shopping/shopping.js').ShoppingListState} ShoppingListState */

export const inventoryStore = objectStore('inventory');
export const packageStore = objectStore('packages');
export const shoppingListStore = objectStore('shoppingLists');

/** @returns {Promise<InventoryItem[]>} */
export const getInventory = () => inventoryStore.getAll();

/** @returns {Promise<Package[]>} */
export const getPackages = () => packageStore.getAll();

/** @returns {Promise<ShoppingListState[]>} */
export const getShoppingLists = () => shoppingListStore.getAll();

/**
 * @param {string} week
 * @returns {Promise<ShoppingListState>}
 */
export async function getShoppingList(week) {
  return (await shoppingListStore.get(week)) ?? { week, checked: [], extras: [] };
}
