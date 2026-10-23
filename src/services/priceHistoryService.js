/**
 * Historique des prix : enregistre chaque releve et le restitue par produit.
 * Ne depend que des depots (pas des autres services) pour eviter les dependances circulaires.
 */
import { pointFromPrice, pointFromDriveProduct, seriesByStore, serieTrend, priceChanges, isLowPriceNow } from '../domain/stores/priceHistory.js';
import { toIsoDate } from '../domain/planning/dates.js';
import { priceHistoryStore, getPriceHistory, getIngredientHistory } from '../db/repositories/priceHistoryRepository.js';
import { getPrices, getStores } from '../db/repositories/budgetRepository.js';
import { getDriveProducts } from '../db/repositories/driveRepository.js';
import { getSetting } from '../db/repositories/settingsRepository.js';
import { ingredientsById } from './catalog.js';

/** @typedef {import('../domain/stores/priceHistory.js').PricePoint} PricePoint */
/** @typedef {import('../domain/stores/stores.js').Price} Price */
/** @typedef {import('../domain/drive/drive.js').DriveProduct} DriveProduct */

/**
 * @param {Price} price
 * @returns {Promise<void>}
 */
export async function recordPrice(price) {
  await priceHistoryStore.put(pointFromPrice(price, ingredientsById.get(price.ingredientId) ?? null));
}

/**
 * @param {DriveProduct[]} products
 * @returns {Promise<void>}
 */
export async function recordDriveProducts(products) {
  const ctx = { today: toIsoDate(new Date()), hasLoyaltyCard: (await getSetting('driveLoyaltyCard')) === true };
  for (const p of products) {
    const point = pointFromDriveProduct(p, p.ingredientId ? ingredientsById.get(p.ingredientId) ?? null : null, ctx);
    if (point) await priceHistoryStore.put(point);
  }
}

/**
 * Premier passage : l'historique demarre avec les prix deja enregistres.
 * @returns {Promise<PricePoint[]>}
 */
async function historyWithBackfill() {
  const points = await getPriceHistory();
  if (points.length) return points;
  const [prices, products] = await Promise.all([getPrices(), getDriveProducts()]);
  for (const p of prices) await recordPrice(p);
  await recordDriveProducts(products);
  return getPriceHistory();
}

/**
 * Historique d'un produit : courbes par magasin, evolution, releves.
 * @param {string} ingredientId
 */
export async function ingredientPriceHistory(ingredientId) {
  await historyWithBackfill();
  const [points, stores] = await Promise.all([getIngredientHistory(ingredientId), getStores()]);
  const { per, series } = seriesByStore(points);
  return {
    points: [...points].sort((a, b) => b.date.localeCompare(a.date)),
    per,
    series,
    trends: new Map([...series].map(([storeId, serie]) => [storeId, serieTrend(serie)])),
    storeNames: new Map(stores.map((s) => [s.id, s.name])),
  };
}

/** Vue d'ensemble : plus fortes variations et produits suivis. */
export async function priceOverview() {
  const [points, stores] = await Promise.all([historyWithBackfill(), getStores()]);
  const tracked = new Set(points.map((p) => p.ingredientId));
  return { changes: priceChanges(points), tracked, count: points.length, storeNames: new Map(stores.map((s) => [s.id, s.name])) };
}

/**
 * Produits dont le prix est au plus bas en ce moment.
 * @returns {Promise<Set<string>>}
 */
export async function lowPriceIngredients() {
  const points = await getPriceHistory();
  const today = toIsoDate(new Date());
  /** @type {Map<string, PricePoint[]>} */
  const byIngredient = new Map();
  for (const p of points) byIngredient.set(p.ingredientId, [...(byIngredient.get(p.ingredientId) ?? []), p]);
  return new Set([...byIngredient].filter(([, list]) => isLowPriceNow(list, today)).map(([id]) => id));
}
