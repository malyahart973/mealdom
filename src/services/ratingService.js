/**
 * Plats aimes ou pas aimes : le planning propose plus souvent les premiers et jamais les seconds.
 */
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';

/** @typedef {'like' | 'dislike'} Rating */

/** @returns {Promise<Map<string, Rating>>} */
export async function getRatings() {
  const value = await getSetting('recipeRatings');
  const entries = value && typeof value === 'object' ? Object.entries(/** @type {Record<string, unknown>} */ (value)) : [];
  return new Map(/** @type {[string, Rating][]} */ (entries.filter(([, v]) => v === 'like' || v === 'dislike')));
}

/**
 * @param {string} recipeId
 * @param {Rating | null} rating   null : ni l'un ni l'autre
 * @returns {Promise<void>}
 */
export async function setRating(recipeId, rating) {
  const ratings = await getRatings();
  if (rating) ratings.set(recipeId, rating);
  else ratings.delete(recipeId);
  await setSetting('recipeRatings', Object.fromEntries(ratings));
}
