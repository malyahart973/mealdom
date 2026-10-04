/**
 * Une recette convient-elle au foyer ? Implementation UNIQUE, utilisee
 * par le filtrage des recettes et par la fiche recette (avec les raisons).
 */
import { checkAllergens } from '../ingredients/ingredients.js';
import { allIngredientIds, isFeasibleWithEquipment } from '../recipes/recipes.js';
import { DIETS } from './household.js';

/** @typedef {import('./household.js').Household} Household */
/** @typedef {import('./household.js').Diet} Diet */
/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */

/**
 * @typedef {{ type: 'allergen', allergen: string, members: string[] }
 *   | { type: 'diet', diet: Diet, members: string[] }
 *   | { type: 'dislike', ingredientId: string, members: string[] }
 *   | { type: 'equipment' }
 *   | { type: 'unknown_ingredient', ingredientIds: string[] }} IncompatibilityReason
 */

/**
 * @typedef {Object} Compatibility
 * @property {'compatible' | 'incompatible' | 'unknown'} status
 * @property {IncompatibilityReason[]} reasons
 */

/**
 * Ajoute un nom de membre a une raison existante ou cree la raison.
 * @param {Map<string, string[]>} map
 * @param {string} key
 * @param {string} name
 */
function addMember(map, key, name) {
  const list = map.get(key) ?? [];
  if (!list.includes(name)) list.push(name);
  map.set(key, list);
}

/**
 * Evalue une recette pour le foyer.
 * - allergies : contrainte absolue ;
 * - regime : contrainte obligatoire ;
 * - aliments refuses : preference forte ;
 * - equipement : il faut pouvoir realiser la recette et ses preparations ;
 * - ingredient inconnu : on ne peut rien garantir -> "unknown".
 * @param {Recipe} recipe
 * @param {Household} household
 * @param {{ ingredients: Map<string, Ingredient>, preparations: Map<string, Preparation> }} ctx
 * @returns {Compatibility}
 */
export function evaluateRecipeForHousehold(recipe, household, ctx) {
  const ids = allIngredientIds(recipe, ctx.preparations);
  const unknownIds = ids.filter((id) => !ctx.ingredients.has(id));

  /** @type {Map<string, string[]>} */ const allergens = new Map();
  /** @type {Map<string, string[]>} */ const diets = new Map();
  /** @type {Map<string, string[]>} */ const dislikes = new Map();

  for (const member of household.members) {
    if (member.allergens.length > 0) {
      const check = checkAllergens(ids, member.allergens, ctx.ingredients);
      if (check.status === 'incompatible') for (const a of check.found) addMember(allergens, a, member.name);
    }
    if (member.diet) {
      const excluded = new Set(DIETS.find((d) => d.id === member.diet)?.excludes ?? []);
      const breaks = ids.some((id) => (ctx.ingredients.get(id)?.categories ?? []).some((c) => excluded.has(c)));
      if (breaks) addMember(diets, member.diet, member.name);
    }
    for (const id of member.dislikes) if (ids.includes(id)) addMember(dislikes, id, member.name);
  }

  /** @type {IncompatibilityReason[]} */
  const reasons = [];
  for (const [allergen, members] of allergens) reasons.push({ type: 'allergen', allergen, members });
  for (const [diet, members] of diets) reasons.push({ type: 'diet', diet: /** @type {Diet} */ (diet), members });
  for (const [ingredientId, members] of dislikes) reasons.push({ type: 'dislike', ingredientId, members });
  if (!isFeasibleWithEquipment(recipe, household.equipment, ctx.preparations)) reasons.push({ type: 'equipment' });

  if (reasons.length > 0) {
    if (unknownIds.length > 0) reasons.push({ type: 'unknown_ingredient', ingredientIds: unknownIds });
    return { status: 'incompatible', reasons };
  }
  if (unknownIds.length > 0) return { status: 'unknown', reasons: [{ type: 'unknown_ingredient', ingredientIds: unknownIds }] };
  return { status: 'compatible', reasons: [] };
}
