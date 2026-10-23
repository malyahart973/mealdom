/**
 * Magasins, prix, budget et depenses : relie les ecrans, les regles et la base.
 */
import { validateStore, validatePrice, priceId, estimateShoppingCost } from '../domain/stores/stores.js';
import { createDefaultBudget, validateExpense } from '../domain/budget/budget.js';
import {
  getStores,
  getPrices,
  getExpenses,
  getBudgetRecord,
  storeStore,
  priceStore,
  budgetStore,
  expenseStore,
} from '../db/repositories/budgetRepository.js';
import { ingredientsById } from './catalog.js';
import { weekShoppingList } from './shoppingService.js';
import { recordPrice } from './priceHistoryService.js';

/** @typedef {import('../domain/stores/stores.js').Store} Store */
/** @typedef {import('../domain/stores/stores.js').Price} Price */
/** @typedef {import('../domain/budget/budget.js').Budget} Budget */
/** @typedef {import('../domain/budget/budget.js').Expense} Expense */

export { getStores, getPrices, getExpenses };

/** @returns {Promise<Budget>} */
export async function getBudget() {
  return (await getBudgetRecord()) ?? createDefaultBudget();
}

/**
 * @param {Budget} budget
 * @returns {Promise<void>}
 */
export function saveBudget(budget) {
  return budgetStore.put(budget);
}

/**
 * @param {Store} store
 * @returns {Promise<string[]>}
 */
export async function saveStore(store) {
  const errors = validateStore(store);
  if (errors.length === 0) await storeStore.put({ ...store, name: store.name.trim(), commune: store.commune.trim() });
  return errors;
}

/**
 * Supprime un magasin et ses prix. Les depenses gardent le nom du magasin.
 * @param {string} storeId
 * @returns {Promise<void>}
 */
export async function deleteStore(storeId) {
  const prices = (await getPrices()).filter((p) => p.storeId === storeId);
  for (const p of prices) await priceStore.delete(p.id);
  await storeStore.delete(storeId);
}

/**
 * @param {Price} price
 * @returns {Promise<string[]>}
 */
export async function savePrice(price) {
  const record = { ...price, id: priceId(price.storeId, price.ingredientId), label: price.label.trim() };
  const errors = validatePrice(record, ingredientsById);
  if (errors.length === 0) {
    await priceStore.put(record);
    await recordPrice(record);
  }
  return errors;
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deletePrice(id) {
  return priceStore.delete(id);
}

/**
 * @param {Expense} expense
 * @returns {Promise<string[]>}
 */
export async function saveExpense(expense) {
  const errors = validateExpense(expense);
  if (errors.length === 0) await expenseStore.put({ ...expense, note: expense.note.trim() });
  return errors;
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteExpense(id) {
  return expenseStore.delete(id);
}

/**
 * Liste de courses de la semaine et son cout estime avec les prix connus.
 * @param {string} monday
 */
export async function weekShoppingEstimate(monday) {
  const [list, prices] = await Promise.all([weekShoppingList(monday), getPrices()]);
  return { ...list, estimate: estimateShoppingCost(list.lines, prices, ingredientsById) };
}
