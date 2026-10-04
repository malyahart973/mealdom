/**
 * Filtrage des recettes (RecipeFilteringService du cahier des charges).
 * Sert a la recherche et, plus tard, aux suggestions compatibles avec le foyer.
 */
import { normalizeText } from '../ingredients/ingredients.js';
import { evaluateRecipeForHousehold } from '../household/compatibility.js';

/** @typedef {import('./recipes.js').Recipe} Recipe */
/** @typedef {import('./recipes.js').Preparation} Preparation */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */

/**
 * @typedef {Object} RecipeFilter
 * @property {string} [query]                 Texte recherche (nom, cuisine, ingredient)
 * @property {boolean} [vesselOnly]           Seulement One Pot / One Pan / One Tray
 * @property {import('../household/household.js').Household | null} [household]
 *   Si fourni : seules les recettes qui conviennent a tout le foyer sont gardees
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
 * Avec un foyer, une recette impossible a verifier ("unknown") est exclue.
 * @param {Recipe[]} recipes
 * @param {RecipeFilter} filter
 * @param {FilterContext} ctx
 * @returns {Recipe[]}
 */
export function filterRecipes(recipes, filter, ctx) {
  const words = normalizeText(filter.query ?? '').split(' ').filter(Boolean);

  return recipes.filter((recipe) => {
    if (recipe.status !== 'validated') return false;
    if (filter.vesselOnly && !recipe.vessel) return false;
    if (filter.household && evaluateRecipeForHousehold(recipe, filter.household, ctx).status !== 'compatible') {
      return false;
    }
    if (words.length > 0) {
      const text = searchableText(recipe, ctx);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
}
