/**
 * Le foyer : membres, contraintes alimentaires, equipement, portions, objectifs.
 * Fonctions pures : chaque modification renvoie un NOUVEAU foyer.
 */
import { isKnownAllergen } from '../ingredients/allergens.js';

/** @typedef {import('../portions/portions.js').PortionRule} PortionRule */
/** @typedef {import('../ingredients/ingredients.js').DietCategory} DietCategory */

/** @typedef {'vegetarian' | 'vegan' | 'no_pork'} Diet */

/**
 * @typedef {Object} Member
 * @property {string} id
 * @property {string} name          Prenom ou pseudonyme
 * @property {string} category      Categorie d'age (cle de portionRules)
 * @property {string[]} allergens   Allergies et intolerances : contraintes ABSOLUES
 * @property {Diet | null} diet     Regime obligatoire
 * @property {string[]} dislikes    Aliments refuses (preference forte)
 */

/**
 * @typedef {Object} Household
 * @property {'main'} id
 * @property {Member[]} members
 * @property {string[]} equipment
 * @property {PortionRule[]} portionRules
 * @property {string[]} goals
 */

/** @type {{ id: Diet, label: string, excludes: DietCategory[] }[]} */
export const DIETS = [
  {
    id: 'vegetarian',
    label: 'Végétarien',
    excludes: ['meat', 'poultry', 'pork', 'fish', 'shellfish', 'gelatin', 'animal_rennet'],
  },
  {
    id: 'vegan',
    label: 'Végétalien',
    excludes: ['meat', 'poultry', 'pork', 'fish', 'shellfish', 'gelatin', 'animal_rennet', 'dairy', 'egg', 'honey'],
  },
  { id: 'no_pork', label: 'Sans porc', excludes: ['pork', 'gelatin'] },
];

/** Objectifs proposes (ils guideront les suggestions des prochaines versions). */
export const GOALS = [
  { id: 'budget', label: 'Réduire le budget' },
  { id: 'vegetables', label: 'Manger plus de légumes' },
  { id: 'less_meat', label: 'Manger moins de viande' },
  { id: 'homemade', label: 'Cuisiner davantage maison' },
  { id: 'less_waste', label: 'Réduire le gaspillage' },
  { id: 'save_time', label: 'Gagner du temps' },
  { id: 'variety', label: 'Varier davantage' },
  { id: 'use_stock', label: 'Utiliser ce que j’ai déjà' },
  { id: 'batch_cooking', label: 'Privilégier le batch cooking' },
  { id: 'fewer_trips', label: 'Limiter les trajets et les magasins' },
];

/** Equipement coche par defaut a la creation du foyer. */
export const DEFAULT_EQUIPMENT = ['stovetop', 'oven', 'microwave'];

/** Bornes du coefficient de portion modifiable. */
export const COEFFICIENT_MIN = 0.1;
export const COEFFICIENT_MAX = 1.5;

/**
 * @param {PortionRule[]} portionRules
 * @returns {Household}
 */
export function createDefaultHousehold(portionRules) {
  return {
    id: 'main',
    members: [],
    equipment: [...DEFAULT_EQUIPMENT],
    portionRules: portionRules.map((r) => ({ ...r })),
    goals: [],
  };
}

/**
 * @param {Member} member
 * @param {Household} household
 * @returns {string[]} erreurs (vide = valide)
 */
export function validateMember(member, household) {
  /** @type {string[]} */
  const errors = [];
  if (!member.name.trim()) errors.push('Indiquez un prénom ou un surnom.');
  if (member.name.trim().length > 40) errors.push('Le prénom est trop long (40 caractères au plus).');
  if (!household.portionRules.some((r) => r.category === member.category)) errors.push("Choisissez une catégorie d'âge.");
  if (member.diet !== null && !DIETS.some((d) => d.id === member.diet)) errors.push('Régime inconnu.');
  for (const a of member.allergens) if (!isKnownAllergen(a)) errors.push(`Allergène inconnu : ${a}`);
  return errors;
}

/**
 * Ajoute ou remplace un membre (meme id).
 * @param {Household} household
 * @param {Member} member
 * @returns {Household}
 */
export function upsertMember(household, member) {
  const clean = { ...member, name: member.name.trim(), allergens: [...new Set(member.allergens)], dislikes: [...new Set(member.dislikes)] };
  const exists = household.members.some((m) => m.id === member.id);
  const members = exists ? household.members.map((m) => (m.id === member.id ? clean : m)) : [...household.members, clean];
  return { ...household, members };
}

/**
 * @param {Household} household
 * @param {string} memberId
 * @returns {Household}
 */
export function removeMember(household, memberId) {
  return { ...household, members: household.members.filter((m) => m.id !== memberId) };
}

/**
 * Modifie le coefficient d'une categorie. L'adulte reste la reference (1).
 * @param {Household} household
 * @param {string} category
 * @param {number} coefficient
 * @returns {{ ok: true, household: Household } | { ok: false, error: string }}
 */
export function setCoefficient(household, category, coefficient) {
  if (category === 'adult') return { ok: false, error: 'La portion adulte sert de référence et vaut toujours 1.' };
  if (!household.portionRules.some((r) => r.category === category)) return { ok: false, error: 'Catégorie inconnue.' };
  if (!Number.isFinite(coefficient) || coefficient < COEFFICIENT_MIN || coefficient > COEFFICIENT_MAX) {
    const fr = (/** @type {number} */ n) => String(n).replace('.', ',');
    return { ok: false, error: `Indiquez une valeur entre ${fr(COEFFICIENT_MIN)} et ${fr(COEFFICIENT_MAX)}.` };
  }
  const portionRules = household.portionRules.map((r) => (r.category === category ? { ...r, coefficient } : r));
  return { ok: true, household: { ...household, portionRules } };
}
