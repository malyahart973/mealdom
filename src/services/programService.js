/**
 * Programme minceur et suivi du poids : relie les ecrans, les regles et la base.
 */
import { createDefaultProgram, validateProgram, dailyTargets, mealTargets, goalDate, programFitScore, personalPortion } from '../domain/nutrition/program.js';
import { recipeMealTypes } from '../domain/recipes/recipes.js';
import { evaluateRecipeForHousehold } from '../domain/household/compatibility.js';
import { recipes, filterContext, nutritionByRecipe } from './catalog.js';
import { getHousehold } from './householdService.js';
import { validateWeightEntry, sortEntries, weightProgress } from '../domain/nutrition/weight.js';
import { getProgramRecord, getWeights, programStore, weightStore } from '../db/repositories/programRepository.js';
import { toIsoDate } from '../domain/planning/dates.js';

/** @typedef {import('../domain/nutrition/program.js').Program} Program */
/** @typedef {import('../domain/nutrition/weight.js').WeightEntry} WeightEntry */

export { getWeights };

/** @returns {Promise<Program>} */
export async function getProgram() {
  return (await getProgramRecord()) ?? createDefaultProgram(toIsoDate(new Date()));
}

/**
 * @param {Program} program
 * @returns {Promise<string[]>}
 */
export async function saveProgram(program) {
  const errors = validateProgram(program, toIsoDate(new Date()));
  if (errors.length === 0) await programStore.put(program);
  return errors;
}

/**
 * @param {boolean} active
 * @returns {Promise<void>}
 */
export async function setProgramActive(active) {
  const program = await getProgram();
  await programStore.put({ ...program, active });
}

/**
 * @param {WeightEntry} entry
 * @returns {Promise<string[]>}
 */
export async function saveWeight(entry) {
  const errors = validateWeightEntry(entry, toIsoDate(new Date()));
  if (errors.length === 0) await weightStore.put({ ...entry, note: entry.note.trim() });
  return errors;
}

/**
 * @param {string} date
 * @returns {Promise<void>}
 */
export function deleteWeight(date) {
  return weightStore.delete(date);
}

/**
 * Programme actif avec ses objectifs du jour, ou null.
 * @returns {Promise<{ program: Program, targets: ReturnType<typeof dailyTargets>, meals: ReturnType<typeof mealTargets>, progress: ReturnType<typeof weightProgress>, goalDate: string | null, entries: WeightEntry[] } | null>}
 */
export async function programSummary() {
  const [program, entries] = await Promise.all([getProgramRecord(), getWeights()]);
  if (!program || !program.active) return null;
  const today = toIsoDate(new Date());
  const sorted = sortEntries(entries);
  const current = sorted.length ? sorted[sorted.length - 1].kg : program.startWeightKg;
  const targets = dailyTargets(program, current, today);
  return {
    program,
    targets,
    meals: mealTargets(targets, program.mealSplit),
    progress: weightProgress(program, entries, today),
    goalDate: goalDate(targets, today),
    entries: sorted,
  };
}

/**
 * @typedef {Object} ProgramSuggestion
 * @property {import('../domain/recipes/recipes.js').Recipe} recipe
 * @property {number} portions        Portion personnelle (1 = une portion adulte)
 * @property {number} kcal
 * @property {number} protein
 */

/**
 * Recettes conseillees pour un repas du programme : du bon type de repas, compatibles
 * avec la personne suivie (allergies, regime, aliments refuses), dont la portion
 * personnelle reste proche d'une portion normale. Classees par adequation.
 * @param {import('../domain/nutrition/program.js').ProgramSlot} slot
 * @param {{ kcal: number, proteinG: number }} target
 * @param {string | null} memberId
 * @param {number} limit
 * @param {number} offset   Pour proposer d'autres idees
 * @returns {Promise<ProgramSuggestion[]>}
 */
export async function programSuggestions(slot, target, memberId, limit, offset) {
  const household = await getHousehold();
  const members = memberId ? household.members.filter((m) => m.id === memberId) : household.members;
  const person = { ...household, members };
  const values = nutritionByRecipe();
  return recipes
    .filter((r) => recipeMealTypes(r).includes(slot))
    .filter((r) => evaluateRecipeForHousehold(r, person, filterContext).status === 'compatible')
    .map((r) => {
      const n = values.get(r.id) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
      return { recipe: r, score: programFitScore(n, target), portion: personalPortion(n, target.kcal) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
    .slice(offset, offset + limit)
    .map((x) => ({ recipe: x.recipe, portions: x.portion.portions, kcal: x.portion.kcal, protein: x.portion.protein }));
}
