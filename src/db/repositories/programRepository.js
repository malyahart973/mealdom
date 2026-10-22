import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/nutrition/program.js').Program} Program */
/** @typedef {import('../../domain/nutrition/weight.js').WeightEntry} WeightEntry */

export const programStore = objectStore('program');
export const weightStore = objectStore('weights');

/** @returns {Promise<Program | null>} */
export async function getProgramRecord() {
  return (await programStore.get('main')) ?? null;
}

/** @returns {Promise<WeightEntry[]>} */
export const getWeights = () => weightStore.getAll();
