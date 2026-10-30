import { objectStore } from './storeHelpers.js';
import { normalizeProgram } from '../../domain/nutrition/program.js';
import { toIsoDate } from '../../domain/planning/dates.js';

/** @typedef {import('../../domain/nutrition/program.js').Program} Program */
/** @typedef {import('../../domain/nutrition/weight.js').WeightEntry} WeightEntry */

export const programStore = objectStore('program');
export const weightStore = objectStore('weights');

/**
 * Programme enregistre, complete des champs ajoutes depuis (collation du matin, methode, sport...).
 * @returns {Promise<Program | null>}
 */
export async function getProgramRecord() {
  const stored = await programStore.get('main');
  return stored ? normalizeProgram(stored, toIsoDate(new Date())) : null;
}

/** @returns {Promise<WeightEntry[]>} */
export const getWeights = () => weightStore.getAll();
