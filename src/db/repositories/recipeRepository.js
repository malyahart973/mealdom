import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/recipes/recipes.js').Recipe} Recipe */

/** Recettes personnelles (saisies ou importees par la cliente). */
export const userRecipeStore = objectStore('userRecipes');

/** @returns {Promise<Recipe[]>} */
export const getUserRecipes = () => userRecipeStore.getAll();
