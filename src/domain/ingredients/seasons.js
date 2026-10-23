/**
 * Produits de saison et produits locaux (Guyane).
 * Sources, par ordre de priorite : le calendrier de la cliente (mois de saison par produit),
 * les prix au plus bas releves, et la liste des produits peyi (cultives localement).
 */
import { allIngredientIds } from '../recipes/recipes.js';

/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {Record<string, number[]>} SeasonCalendar   ingredient -> mois (1 a 12) */

/**
 * @param {SeasonCalendar} calendar
 * @returns {string[]}
 */
export function validateCalendar(calendar) {
  /** @type {string[]} */
  const errors = [];
  for (const [id, months] of Object.entries(calendar)) {
    if (!Array.isArray(months) || months.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) errors.push(`Mois invalides pour ${id}.`);
  }
  return errors;
}

/**
 * Produits de saison ce mois-ci d'apres le calendrier de la cliente.
 * @param {SeasonCalendar} calendar
 * @param {number} month   1 a 12
 * @returns {Set<string>}
 */
export function inSeason(calendar, month) {
  return new Set(Object.entries(calendar).filter(([, months]) => months.includes(month)).map(([id]) => id));
}

/**
 * Ingredients favorises en ce moment : de saison (calendrier), au plus bas (prix) ou peyi.
 * Un produit explicitement hors saison dans le calendrier n'est pas favorise, meme s'il est peyi.
 * @param {{ calendar: SeasonCalendar, month: number, lowPrice: Set<string>, peyi: string[] }} ctx
 * @returns {Set<string>}
 */
export function favouredNow(ctx) {
  const season = inSeason(ctx.calendar, ctx.month);
  const outOfSeason = new Set(Object.entries(ctx.calendar).filter(([, m]) => m.length > 0 && !m.includes(ctx.month)).map(([id]) => id));
  return new Set([...season, ...ctx.lowPrice, ...ctx.peyi.filter((id) => !outOfSeason.has(id))]);
}

/**
 * Ingredients de la recette qui sont de saison ou locaux.
 * @param {Recipe} recipe
 * @param {Map<string, Preparation>} preparations
 * @param {Set<string>} favoured
 * @returns {string[]}
 */
export function seasonalIngredients(recipe, preparations, favoured) {
  return allIngredientIds(recipe, preparations).filter((id) => favoured.has(id));
}

/** Une recette « de saison » utilise au moins deux produits de saison ou locaux. */
export const SEASONAL_MIN_INGREDIENTS = 2;
