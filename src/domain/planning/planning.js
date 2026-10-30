/**
 * Planning manuel des repas (le MVP ne genere pas de semaine automatiquement).
 * Fonctions pures : chaque modification renvoie une NOUVELLE liste de repas.
 */
import { addDays, parseIsoDate } from './dates.js';
import { mealPortions } from '../portions/portions.js';

/** @typedef {import('../household/household.js').Household} Household */

/** @typedef {'breakfast' | 'morning_snack' | 'lunch' | 'snack' | 'dinner'} Slot */

/** @type {{ id: Slot, label: string }[]} */
export const SLOTS = [
  { id: 'breakfast', label: 'Petit-déjeuner' },
  { id: 'morning_snack', label: 'Collation du matin' },
  { id: 'lunch', label: 'Déjeuner' },
  { id: 'snack', label: 'Goûter' },
  { id: 'dinner', label: 'Dîner' },
];

/**
 * Remplacement d'un ingredient dans la recette d'un repas (ex. creme -> yaourt).
 * La recette du catalogue n'est jamais modifiee.
 * @typedef {{ from: string, to: string }} Substitution
 */

/**
 * @typedef {Object} Meal
 * @property {string} id
 * @property {string} date             AAAA-MM-JJ
 * @property {Slot} slot
 * @property {string} recipeId
 * @property {string} recipeName       Copie du nom : l'historique reste lisible si la recette est archivee
 * @property {string[]} attendees      Membres presents
 * @property {number} guests           Invites, comptes comme adultes
 * @property {{ attendees: string[], guests: number } | null} nextLunch
 *   Diner cuisine en plus grande quantite pour le dejeuner du lendemain
 * @property {boolean} locked
 * @property {Substitution[]} [substitutions]   Ingredients remplaces pour ce repas uniquement
 */

/**
 * Case du planning occupee : un repas, ou les restes d'un diner.
 * @typedef {{ kind: 'meal', meal: Meal } | { kind: 'leftover', meal: Meal }} PlannedEntry
 */

/**
 * @param {string} date
 * @param {Slot} slot
 * @returns {string}
 */
export function slotKey(date, slot) {
  return `${date}|${slot}`;
}

/**
 * Toutes les cases occupees, restes du lendemain compris.
 * @param {Meal[]} meals
 * @returns {Map<string, PlannedEntry>}
 */
export function plannedEntries(meals) {
  /** @type {Map<string, PlannedEntry>} */
  const map = new Map();
  for (const meal of meals) {
    map.set(slotKey(meal.date, meal.slot), { kind: 'meal', meal });
    if (meal.nextLunch) map.set(slotKey(addDays(meal.date, 1), 'lunch'), { kind: 'leftover', meal });
  }
  return map;
}

/**
 * Categories d'age des personnes presentes (membres disparus ignores, invites = adultes).
 * @param {string[]} attendees
 * @param {number} guests
 * @param {Household} household
 * @returns {string[]}
 */
function categoriesOf(attendees, guests, household) {
  const categories = attendees
    .map((id) => household.members.find((m) => m.id === id)?.category)
    .filter((c) => c !== undefined);
  for (let i = 0; i < guests; i++) categories.push('adult');
  return /** @type {string[]} */ (categories);
}

/**
 * Portions du repas, du dejeuner du lendemain, et total a cuisiner (RM-05 a RM-07).
 * @param {Meal} meal
 * @param {Household} household
 * @returns {{ meal: number, nextLunch: number, total: number }}
 */
export function mealPortionsFor(meal, household) {
  const own = mealPortions(categoriesOf(meal.attendees, meal.guests, household), household.portionRules);
  const lunch = meal.nextLunch
    ? mealPortions(categoriesOf(meal.nextLunch.attendees, meal.nextLunch.guests, household), household.portionRules)
    : 0;
  return { meal: own, nextLunch: lunch, total: own + lunch };
}

/**
 * Verifie un repas avant enregistrement.
 * @param {Meal} meal
 * @param {Meal[]} meals              Repas deja planifies
 * @param {Household} household
 * @param {Set<string>} recipeIds     Recettes existantes
 * @returns {string[]} erreurs (vide = valide)
 */
export function validateMeal(meal, meals, household, recipeIds) {
  /** @type {string[]} */
  const errors = [];
  if (!parseIsoDate(meal.date)) errors.push('Date invalide.');
  if (!SLOTS.some((s) => s.id === meal.slot)) errors.push('Choisissez le repas (déjeuner, dîner...).');
  if (!recipeIds.has(meal.recipeId)) errors.push('Choisissez une recette.');
  if (!Number.isInteger(meal.guests) || meal.guests < 0) errors.push("Nombre d'invités invalide.");
  if (meal.attendees.length + meal.guests === 0) errors.push('Indiquez au moins une personne à table.');
  const memberIds = new Set(household.members.map((m) => m.id));
  if (meal.attendees.some((id) => !memberIds.has(id))) errors.push('Une personne choisie ne fait plus partie du foyer.');

  for (const sub of meal.substitutions ?? []) {
    if (!sub.from || !sub.to || sub.from === sub.to) errors.push('Remplacement d’ingrédient invalide.');
  }

  if (meal.nextLunch) {
    if (meal.slot !== 'dinner') errors.push('Seul un dîner peut servir au déjeuner du lendemain.');
    if (!Number.isInteger(meal.nextLunch.guests) || meal.nextLunch.guests < 0) errors.push("Nombre d'invités du lendemain invalide.");
    if (meal.nextLunch.attendees.length + meal.nextLunch.guests === 0) {
      errors.push('Indiquez qui mange les restes le lendemain midi.');
    }
  }

  // Cases deja prises par d'autres repas (le repas lui-meme est ignore : deplacement possible)
  const others = plannedEntries(meals.filter((m) => m.id !== meal.id));
  const taken = parseIsoDate(meal.date) ? others.get(slotKey(meal.date, meal.slot)) : undefined;
  if (taken?.kind === 'leftover') {
    errors.push(`Ce déjeuner est déjà prévu avec les restes du dîner de la veille (${taken.meal.recipeName}).`);
  } else if (taken) {
    errors.push('Ce créneau a déjà un repas. Choisissez un autre jour ou retirez l’autre repas.');
  }
  if (meal.nextLunch && parseIsoDate(meal.date) && others.has(slotKey(addDays(meal.date, 1), 'lunch'))) {
    errors.push('Le déjeuner du lendemain a déjà un repas prévu.');
  }
  return errors;
}

/**
 * Seul le verrou peut changer sur un repas verrouille.
 * @param {Meal} before
 * @param {Meal} after
 * @returns {boolean}
 */
function onlyLockChanged(before, after) {
  return JSON.stringify({ ...before, locked: false }) === JSON.stringify({ ...after, locked: false });
}

/**
 * Ajoute ou remplace un repas. Un repas verrouille ne peut etre que deverrouille.
 * Les autres repas ne sont jamais modifies.
 * @param {Meal[]} meals
 * @param {Meal} meal
 * @returns {{ ok: true, meals: Meal[] } | { ok: false, error: string }}
 */
export function saveMealIn(meals, meal) {
  const existing = meals.find((m) => m.id === meal.id);
  if (existing && existing.locked && !onlyLockChanged(existing, meal)) {
    return { ok: false, error: 'Ce repas est verrouillé : déverrouillez-le avant de le modifier.' };
  }
  const next = existing ? meals.map((m) => (m.id === meal.id ? meal : m)) : [...meals, meal];
  return { ok: true, meals: next };
}

/**
 * Retire un repas (refuse s'il est verrouille).
 * @param {Meal[]} meals
 * @param {string} mealId
 * @returns {{ ok: true, meals: Meal[] } | { ok: false, error: string }}
 */
export function removeMealFrom(meals, mealId) {
  const meal = meals.find((m) => m.id === mealId);
  if (!meal) return { ok: true, meals };
  if (meal.locked) return { ok: false, error: 'Ce repas est verrouillé : déverrouillez-le avant de le retirer.' };
  return { ok: true, meals: meals.filter((m) => m.id !== mealId) };
}

/**
 * Repas a afficher pour une liste de jours, par jour puis par creneau.
 * @param {Meal[]} meals
 * @param {string[]} days
 * @param {Slot[]} slots
 * @returns {{ date: string, slots: { slot: Slot, entry: PlannedEntry | null }[] }[]}
 */
export function planningGrid(meals, days, slots) {
  const entries = plannedEntries(meals);
  return days.map((date) => ({
    date,
    slots: slots.map((slot) => ({ slot, entry: entries.get(slotKey(date, slot)) ?? null })),
  }));
}
