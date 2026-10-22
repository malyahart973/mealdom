/**
 * Acces au catalogue (ingredients, preparations, recettes, cuisines).
 * Les index sont construits une seule fois.
 */
import { INGREDIENTS } from '../data/ingredients.js';
import { PREPARATIONS } from '../data/preparations.js';
import { ALL_RECIPES } from '../data/allRecipes.js';
import { CUISINES } from '../data/cuisines.js';
import { NUTRITION } from '../data/nutrition.js';
import { buildNutritionIndex, recipeNutrition } from '../domain/nutrition/nutrition.js';

export const ingredientsById = new Map(INGREDIENTS.map((i) => [i.id, i]));
export const preparationsById = new Map(PREPARATIONS.map((p) => [p.id, p]));
export const recipesById = new Map(ALL_RECIPES.map((r) => [r.id, r]));
export const cuisineLabels = new Map(CUISINES.map((c) => [c.id, c.label]));
export const recipes = ALL_RECIPES;

/** Contexte utilise par le filtrage des recettes. */
export const filterContext = { ingredients: ingredientsById, preparations: preparationsById, cuisineLabels };

/** Contexte du calcul nutritionnel (valeurs pour 100 g de chaque ingredient). */
export const nutritionContext = { ingredients: ingredientsById, preparations: preparationsById, nutrition: buildNutritionIndex(NUTRITION) };

/** @type {Map<string, import('../domain/nutrition/nutrition.js').Nutrients> | null} */
let nutritionCache = null;

/**
 * Apports d'une portion de chaque recette, calcules au premier appel seulement.
 * @returns {Map<string, import('../domain/nutrition/nutrition.js').Nutrients>}
 */
export function nutritionByRecipe() {
  nutritionCache ??= new Map(ALL_RECIPES.map((r) => [r.id, recipeNutrition(r, nutritionContext).perPortion]));
  return nutritionCache;
}
