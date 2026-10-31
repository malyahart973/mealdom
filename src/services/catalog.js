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
import { recipeFamily } from '../domain/recipes/families.js';
import { recipeKeeping } from '../domain/batchCooking/keeping.js';

export const ingredientsById = new Map(INGREDIENTS.map((i) => [i.id, i]));
export const preparationsById = new Map(PREPARATIONS.map((p) => [p.id, p]));
/** Toutes les recettes connues, archivees comprises (repas deja planifies). */
export const recipesById = new Map(ALL_RECIPES.map((r) => [r.id, r]));
export const cuisineLabels = new Map(CUISINES.map((c) => [c.id, c.label]));
/** Recettes proposees : le catalogue et les recettes personnelles actives. */
export const recipes = [...ALL_RECIPES];

/** Famille de chaque recette (une seule par plat). */
export const familyOf = new Map(ALL_RECIPES.map((r) => [r.id, recipeFamily(r, ingredientsById)]));

/** Conservation de chaque plat cuisine a l'avance (batch cooking). */
export const keepingOf = new Map(ALL_RECIPES.map((r) => [r.id, recipeKeeping(r, familyOf.get(r.id) ?? '', ingredientsById)]));

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
  nutritionCache ??= new Map([...recipesById.values()].map((r) => [r.id, recipeNutrition(r, nutritionContext).perPortion]));
  return nutritionCache;
}

/**
 * Ajoute ou met a jour une recette personnelle dans le catalogue en memoire.
 * Une recette archivee reste lisible (repas deja planifies) mais n'est plus proposee.
 * @param {import('../domain/recipes/recipes.js').Recipe} recipe
 */
export function registerRecipe(recipe) {
  recipesById.set(recipe.id, recipe);
  familyOf.set(recipe.id, recipeFamily(recipe, ingredientsById));
  keepingOf.set(recipe.id, recipeKeeping(recipe, familyOf.get(recipe.id) ?? '', ingredientsById));
  nutritionCache?.set(recipe.id, recipeNutrition(recipe, nutritionContext).perPortion);
  const index = recipes.findIndex((r) => r.id === recipe.id);
  if (recipe.status === 'archived') {
    if (index >= 0) recipes.splice(index, 1);
  } else if (index >= 0) recipes[index] = recipe;
  else recipes.push(recipe);
}
