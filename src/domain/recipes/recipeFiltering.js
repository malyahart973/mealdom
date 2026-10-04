/**
 * Filtrage des recettes (RecipeFilteringService du cahier des charges).
 * Sert a la recherche et, plus tard, aux suggestions compatibles avec le foyer.
 */
import { normalizeText } from '../ingredients/ingredients.js';
import { checkRecipeAllergens, isFeasibleWithEquipment } from './recipes.js';

/** @typedef {import('./recipes.js').Recipe} Recipe */
/** @typedef {import('./recipes.js').Preparation} Preparation */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */

/**
 * @typedef {Object} RecipeFilter
 * @property {string} [query]                 Texte recherche (nom, cuisine, ingredient)
 * @property {boolean} [vesselOnly]           Seulement One Pot / One Pan / One Tray
 * @property {string[]} [forbiddenAllergens]  Allergies du foyer
 * @property {string[] | null} [equipment]    Equipement du foyer (null = non renseigne)
 */

/**
 * @typedef {Object} FilterContext
 * @property {Map<string, Ingredient>} ingredients
 * @property {Map<string, Preparation>} preparations
 * @property {Map<string, string>} cuisineLabels
 */

/**
 * Texte dans lequel on cherche : nom, cuisine et noms des ingredients.
 * @param {Recipe} recipe
 * @param {FilterContext} ctx
 * @returns {string}
 */
function searchableText(recipe, ctx) {
  const parts = [recipe.name, ctx.cuisineLabels.get(recipe.cuisine) ?? ''];
  for (const line of recipe.ingredients) parts.push(ctx.ingredients.get(line.ingredientId)?.name ?? '');
  for (const line of recipe.preparations) parts.push(ctx.preparations.get(line.preparationId)?.name ?? '');
  return normalizeText(parts.join(' '));
}

/**
 * Applique les filtres. Seules les recettes "validated" sont proposees.
 * Une recette dont les allergenes ne peuvent pas etre verifies est exclue
 * des qu'une allergie est declaree.
 * @param {Recipe[]} recipes
 * @param {RecipeFilter} filter
 * @param {FilterContext} ctx
 * @returns {Recipe[]}
 */
export function filterRecipes(recipes, filter, ctx) {
  const words = normalizeText(filter.query ?? '').split(' ').filter(Boolean);
  const forbidden = filter.forbiddenAllergens ?? [];

  return recipes.filter((recipe) => {
    if (recipe.status !== 'validated') return false;
    if (filter.vesselOnly && !recipe.vessel) return false;
    if (forbidden.length > 0) {
      const check = checkRecipeAllergens(recipe, forbidden, ctx.preparations, ctx.ingredients);
      if (check.status !== 'compatible') return false;
    }
    if (filter.equipment && !isFeasibleWithEquipment(recipe, filter.equipment, ctx.preparations)) return false;
    if (words.length > 0) {
      const text = searchableText(recipe, ctx);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
}
