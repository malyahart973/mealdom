/**
 * Lecture et modification du foyer : relie les ecrans, les regles du domaine et la base.
 */
import { DEFAULT_PORTION_RULES } from '../data/portionRules.js';
import {
  createDefaultHousehold,
  removeMember,
  setCoefficient,
  upsertMember,
  validateMember,
} from '../domain/household/household.js';
import { loadHouseholdRecord, saveHouseholdRecord } from '../db/repositories/householdRepository.js';

/** @typedef {import('../domain/household/household.js').Household} Household */
/** @typedef {import('../domain/household/household.js').Member} Member */

/**
 * Le foyer, ou un foyer vide par defaut.
 * @returns {Promise<Household>}
 */
export async function getHousehold() {
  return (await loadHouseholdRecord()) ?? createDefaultHousehold(DEFAULT_PORTION_RULES);
}

/** @returns {string} */
export function newMemberId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {Member} member
 * @returns {Promise<string[]>} erreurs (vide = enregistre)
 */
export async function saveMember(member) {
  const household = await getHousehold();
  const errors = validateMember(member, household);
  if (errors.length > 0) return errors;
  await saveHouseholdRecord(upsertMember(household, member));
  return [];
}

/**
 * @param {string} memberId
 * @returns {Promise<void>}
 */
export async function deleteMember(memberId) {
  await saveHouseholdRecord(removeMember(await getHousehold(), memberId));
}

/**
 * @param {string[]} equipment
 * @returns {Promise<void>}
 */
export async function saveEquipment(equipment) {
  await saveHouseholdRecord({ ...(await getHousehold()), equipment: [...new Set(equipment)] });
}

/**
 * @param {string[]} goals
 * @returns {Promise<void>}
 */
export async function saveGoals(goals) {
  await saveHouseholdRecord({ ...(await getHousehold()), goals: [...new Set(goals)] });
}

/**
 * @param {string} category
 * @param {number} coefficient
 * @returns {Promise<string | null>} message d'erreur, ou null si enregistre
 */
export async function saveCoefficient(category, coefficient) {
  const result = setCoefficient(await getHousehold(), category, coefficient);
  if (!result.ok) return result.error;
  await saveHouseholdRecord(result.household);
  return null;
}
