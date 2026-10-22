/**
 * Programme minceur et suivi du poids : relie les ecrans, les regles et la base.
 */
import { createDefaultProgram, validateProgram, dailyTargets, mealTargets, goalDate } from '../domain/nutrition/program.js';
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
