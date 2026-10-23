/**
 * Produits de saison : calendrier de la cliente, prix au plus bas, produits peyi.
 */
import { PEYI_PRODUCE } from '../data/seasons.js';
import { favouredNow, inSeason, validateCalendar } from '../domain/ingredients/seasons.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { lowPriceIngredients } from './priceHistoryService.js';

/** @typedef {import('../domain/ingredients/seasons.js').SeasonCalendar} SeasonCalendar */

const KEY = 'seasonCalendar';

/** @returns {Promise<SeasonCalendar>} */
export async function getCalendar() {
  const value = await getSetting(KEY);
  return value && typeof value === 'object' ? /** @type {SeasonCalendar} */ (value) : {};
}

/**
 * Mois de saison d'un produit (liste vide = retirer du calendrier).
 * @param {string} ingredientId
 * @param {number[]} months
 * @returns {Promise<string[]>}
 */
export async function saveSeason(ingredientId, months) {
  const calendar = { ...(await getCalendar()) };
  if (months.length) calendar[ingredientId] = [...new Set(months)].sort((a, b) => a - b);
  else delete calendar[ingredientId];
  const errors = validateCalendar(calendar);
  if (errors.length === 0) await setSetting(KEY, calendar);
  return errors;
}

/**
 * Ce qui est favorise ce mois-ci, avec le detail des sources.
 * @param {Date} [now]
 */
export async function seasonNow(now = new Date()) {
  const month = now.getMonth() + 1;
  const [calendar, lowPrice] = await Promise.all([getCalendar(), lowPriceIngredients()]);
  return {
    month,
    calendar,
    season: inSeason(calendar, month),
    lowPrice,
    peyi: PEYI_PRODUCE,
    favoured: favouredNow({ calendar, month, lowPrice, peyi: PEYI_PRODUCE }),
  };
}
