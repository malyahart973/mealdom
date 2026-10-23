/**
 * Disponibilite des ingredients en Guyane : indications par defaut + corrections de la cliente.
 */
import { GUYANE_HINTS } from '../data/territory.js';
import { makeAvailability, autoSubstitutions } from '../domain/ingredients/territory.js';
import { substitutesFor } from '../domain/assistant/substitutes.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';

/** @typedef {import('../domain/ingredients/territory.js').AvailabilityOverride} AvailabilityOverride */
/** @typedef {import('../domain/ingredients/territory.js').AvailabilityOf} AvailabilityOf */

const KEY = 'territoryOverrides';

/** @returns {Promise<Record<string, AvailabilityOverride>>} */
export async function getAvailabilityOverrides() {
  const value = await getSetting(KEY);
  return value && typeof value === 'object' ? /** @type {Record<string, AvailabilityOverride>} */ (value) : {};
}

/**
 * Correction de la cliente pour un ingredient (null = revenir a l'indication par defaut).
 * @param {string} ingredientId
 * @param {AvailabilityOverride | null} value
 * @returns {Promise<void>}
 */
export async function setAvailabilityOverride(ingredientId, value) {
  const overrides = { ...(await getAvailabilityOverrides()) };
  if (value) overrides[ingredientId] = value;
  else delete overrides[ingredientId];
  await setSetting(KEY, overrides);
}

/** @returns {Promise<AvailabilityOf>} */
export async function loadAvailability() {
  return makeAvailability(GUYANE_HINTS, await getAvailabilityOverrides());
}

/**
 * Alternatives appliquees d'office aux ingredients que la cliente ne trouve pas.
 * @param {AvailabilityOf} availability
 * @returns {(recipe: import('../domain/recipes/recipes.js').Recipe) => import('../domain/planning/planning.js').Substitution[]}
 */
export function autoSubstituter(availability) {
  return (recipe) => autoSubstitutions(recipe, availability, substitutesFor);
}
