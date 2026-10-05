import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/stores/stores.js').Store} Store */
/** @typedef {import('../../domain/stores/stores.js').Price} Price */
/** @typedef {import('../../domain/budget/budget.js').Budget} Budget */
/** @typedef {import('../../domain/budget/budget.js').Expense} Expense */

export const storeStore = objectStore('stores');
export const priceStore = objectStore('prices');
export const budgetStore = objectStore('budget');
export const expenseStore = objectStore('expenses');

/** @returns {Promise<Store[]>} */
export const getStores = () => storeStore.getAll();

/** @returns {Promise<Price[]>} */
export const getPrices = () => priceStore.getAll();

/** @returns {Promise<Budget | null>} */
export async function getBudgetRecord() {
  return (await budgetStore.get('main')) ?? null;
}

/** @returns {Promise<Expense[]>} */
export const getExpenses = () => expenseStore.getAll();
