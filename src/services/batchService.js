/**
 * Batch cooking : jour des seances (reglage du foyer) et seances de la semaine.
 */
import { DEFAULT_BATCH_PLAN, BATCH_DAYS, batchSessionDates } from '../domain/batchCooking/keeping.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { toIsoDate } from '../domain/planning/dates.js';

/** @typedef {import('../domain/batchCooking/keeping.js').BatchPlan} BatchPlan */

/** @returns {Promise<BatchPlan>} */
export async function getBatchPlan() {
  const value = /** @type {Partial<BatchPlan> | null} */ (await getSetting('batchPlan'));
  const day = BATCH_DAYS.some((d) => d.id === value?.day) ? /** @type {BatchPlan['day']} */ (value?.day) : DEFAULT_BATCH_PLAN.day;
  return { day, midweek: value?.midweek === true };
}

/**
 * @param {BatchPlan} plan
 * @returns {Promise<void>}
 */
export function saveBatchPlan(plan) {
  return setSetting('batchPlan', { day: plan.day, midweek: plan.midweek });
}

/**
 * Dates des seances de batch d'une semaine.
 * @param {string} monday
 * @returns {Promise<string[]>}
 */
export async function batchSessions(monday) {
  return batchSessionDates(monday, await getBatchPlan(), toIsoDate(new Date()));
}
