/**
 * Disponibilite locale des ingredients (Guyane) et alternatives.
 * Trois sources, par ordre de priorite :
 * 1. les corrections de la cliente (« je le trouve » / « introuvable pour moi ») ;
 * 2. les indications par defaut (data/territory.js), jamais presentees comme verifiees ;
 * 3. sinon l'ingredient est considere comme courant.
 */
import { allIngredientIds } from '../recipes/recipes.js';

/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {import('../planning/planning.js').Substitution} Substitution */
/** @typedef {import('../../data/territory.js').TerritoryHint} TerritoryHint */

/** @typedef {'common' | 'specialty' | 'rare' | 'missing'} LocalAvailability */
/** @typedef {'found' | 'missing'} AvailabilityOverride */
/** @typedef {(ingredientId: string) => LocalAvailability} AvailabilityOf */

/**
 * @param {Record<string, TerritoryHint>} hints
 * @param {Record<string, AvailabilityOverride>} overrides
 * @returns {AvailabilityOf}
 */
export function makeAvailability(hints, overrides) {
  return (id) => {
    const o = overrides[id];
    if (o === 'missing') return 'missing';
    if (o === 'found') return 'common';
    return hints[id]?.level ?? 'common';
  };
}

/**
 * Premiere alternative qu'on peut trouver (ni introuvable, ni rare).
 * @param {string} ingredientId
 * @param {AvailabilityOf} availability
 * @param {(id: string) => string[]} substitutesFor
 * @returns {string | null}
 */
export function usableSubstitute(ingredientId, availability, substitutesFor) {
  return substitutesFor(ingredientId).find((s) => availability(s) === 'common' || availability(s) === 'specialty') ?? null;
}

/**
 * @typedef {Object} LocalIssue
 * @property {string} ingredientId
 * @property {LocalAvailability} level
 * @property {string | null} substitute     Alternative trouvable
 * @property {boolean} inPreparation        Dans une preparation de base (non remplacable dans le repas)
 */

/**
 * Ingredients de la recette qui ne sont pas courants, avec leur alternative.
 * @param {Recipe} recipe
 * @param {Map<string, Preparation>} preparations
 * @param {AvailabilityOf} availability
 * @param {(id: string) => string[]} substitutesFor
 * @returns {LocalIssue[]}
 */
export function recipeLocalIssues(recipe, preparations, availability, substitutesFor) {
  const direct = new Set(recipe.ingredients.map((l) => l.ingredientId));
  return allIngredientIds(recipe, preparations)
    .filter((id) => availability(id) !== 'common')
    .map((id) => ({ ingredientId: id, level: availability(id), substitute: usableSubstitute(id, availability, substitutesFor), inPreparation: !direct.has(id) }));
}

/**
 * Remplacements automatiques des ingredients introuvables pour la cliente.
 * @param {Recipe} recipe
 * @param {AvailabilityOf} availability
 * @param {(id: string) => string[]} substitutesFor
 * @returns {Substitution[]}
 */
export function autoSubstitutions(recipe, availability, substitutesFor) {
  /** @type {Substitution[]} */
  const out = [];
  for (const line of recipe.ingredients) {
    if (availability(line.ingredientId) !== 'missing' || out.some((s) => s.from === line.ingredientId)) continue;
    const to = usableSubstitute(line.ingredientId, availability, substitutesFor);
    if (to) out.push({ from: line.ingredientId, to });
  }
  return out;
}

/**
 * La recette est-elle realisable avec ce que la cliente trouve ?
 * Non si un ingredient introuvable n'a pas d'alternative, ou s'il est dans une preparation de base.
 * @param {Recipe} recipe
 * @param {Map<string, Preparation>} preparations
 * @param {AvailabilityOf} availability
 * @param {(id: string) => string[]} substitutesFor
 * @returns {boolean}
 */
export function isFeasibleLocally(recipe, preparations, availability, substitutesFor) {
  return recipeLocalIssues(recipe, preparations, availability, substitutesFor).every((i) => i.level !== 'missing' || (i.substitute !== null && !i.inPreparation));
}

/**
 * Nombre d'ingredients rares (non corriges) de la recette : sert a la classer plus bas.
 * @param {Recipe} recipe
 * @param {Map<string, Preparation>} preparations
 * @param {AvailabilityOf} availability
 * @returns {number}
 */
export function rareCount(recipe, preparations, availability) {
  return allIngredientIds(recipe, preparations).filter((id) => availability(id) === 'rare').length;
}
