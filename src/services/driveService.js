/**
 * Drive : magasin choisi, produits releves, devis et commande.
 * Aucune commande n'est envoyee automatiquement : MealDom prepare la liste,
 * le client la valide explicitement puis la passe sur le site du Drive.
 */
import {
  HYPER_U_CAYENNE,
  validateDriveProduct,
  parseDriveCsv,
  checkOrder,
  isFresh,
  activePromotions,
} from '../domain/drive/drive.js';
import { quoteShoppingLines } from '../domain/drive/quote.js';
import { aggregateNeeds, buildShoppingLines, mealNeedLines } from '../domain/shopping/shopping.js';
import { convertUniversal, getUnit } from '../domain/units/units.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { weekDays, toIsoDate } from '../domain/planning/dates.js';
import { getDriveProducts, getDriveOrders, driveProductStore, driveOrderStore, driveProductKey } from '../db/repositories/driveRepository.js';
import { getStores, getPrices, storeStore } from '../db/repositories/budgetRepository.js';
import { getInventory, getPackages } from '../db/repositories/shoppingRepository.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { getMeals } from './planningService.js';
import { recordDriveProducts } from './priceHistoryService.js';
import { getHousehold } from './householdService.js';
import { ingredientsById, recipesById, preparationsById } from './catalog.js';
import { INGREDIENTS } from '../data/ingredients.js';

/** @typedef {import('../domain/drive/drive.js').DriveProduct} DriveProduct */
/** @typedef {import('../domain/drive/drive.js').DriveOrder} DriveOrder */
/** @typedef {import('../domain/drive/drive.js').ProductPreference} ProductPreference */
/** @typedef {import('../domain/stores/stores.js').Store} Store */
/** @typedef {import('../domain/planning/planning.js').Meal} Meal */
/** @typedef {import('../domain/assistant/scoring.js').UnitPrice} UnitPrice */

const nameIndex = buildNameIndex(INGREDIENTS);

/**
 * @typedef {Object} DriveSettings
 * @property {string | null} storeId
 * @property {boolean} hasLoyaltyCard
 * @property {ProductPreference} preference
 * @property {Record<string, string>} preferredProducts   ingredient -> reference
 */

/** @returns {Promise<DriveSettings>} */
export async function getDriveSettings() {
  const [storeId, card, preference, preferred] = await Promise.all([
    getSetting('driveStoreId'),
    getSetting('driveLoyaltyCard'),
    getSetting('driveProductPreference'),
    getSetting('drivePreferredProducts'),
  ]);
  return {
    storeId: typeof storeId === 'string' ? storeId : null,
    hasLoyaltyCard: card === true,
    preference: preference === 'quality' || preference === 'promotions' || preference === 'store_brand' ? preference : 'cheapest',
    preferredProducts: preferred && typeof preferred === 'object' ? /** @type {Record<string, string>} */ (preferred) : {},
  };
}

/**
 * @param {Partial<DriveSettings>} changes
 * @returns {Promise<void>}
 */
export async function saveDriveSettings(changes) {
  if ('storeId' in changes) await setSetting('driveStoreId', changes.storeId);
  if ('hasLoyaltyCard' in changes) await setSetting('driveLoyaltyCard', changes.hasLoyaltyCard);
  if ('preference' in changes) await setSetting('driveProductPreference', changes.preference);
  if ('preferredProducts' in changes) await setSetting('drivePreferredProducts', changes.preferredProducts);
}

/**
 * Ajoute Hyper U Cayenne aux magasins (s'il n'y est pas) et le choisit pour le Drive.
 * @returns {Promise<Store>}
 */
export async function setupHyperUCayenne() {
  const stores = await getStores();
  const existing = stores.find((s) => s.id === HYPER_U_CAYENNE.id);
  const store = existing ? { ...existing, drive: existing.drive ?? HYPER_U_CAYENNE.drive } : HYPER_U_CAYENNE;
  await storeStore.put(store);
  await saveDriveSettings({ storeId: store.id });
  return store;
}

/** @returns {Promise<Store | null>} */
export async function getDriveStore() {
  const { storeId } = await getDriveSettings();
  if (!storeId) return null;
  return (await getStores()).find((s) => s.id === storeId) ?? null;
}

/**
 * Produits du magasin Drive choisi.
 * @returns {Promise<DriveProduct[]>}
 */
export async function getStoreProducts() {
  const store = await getDriveStore();
  if (!store) return [];
  return (await getDriveProducts()).filter((p) => p.storeId === store.id);
}

/**
 * @param {DriveProduct} product
 * @returns {Promise<string[]>}
 */
export async function saveDriveProduct(product) {
  const errors = validateDriveProduct(product, ingredientsById);
  if (errors.length === 0) {
    const record = { ...product, key: driveProductKey(product), name: product.name.trim(), brand: product.brand.trim() };
    await driveProductStore.put(record);
    await recordDriveProducts([record]);
  }
  return errors;
}

/**
 * @param {DriveProduct} product
 * @returns {Promise<void>}
 */
export function deleteDriveProduct(product) {
  return driveProductStore.delete(driveProductKey(product));
}

/**
 * Importe un fichier CSV de produits releves sur le site du Drive.
 * @param {string} text
 * @returns {Promise<{ imported: number, errors: string[], unlinked: number }>}
 */
export async function importDriveCsv(text) {
  const store = await getDriveStore();
  if (!store) return { imported: 0, errors: ['Choisissez d’abord le magasin Drive.'], unlinked: 0 };
  const { products, errors, unlinked } = parseDriveCsv(text, {
    storeId: store.id,
    checkedAt: new Date().toISOString(),
    findIngredient: (name) => findIngredientId(name, nameIndex),
    ingredients: ingredientsById,
  });
  for (const p of products) await driveProductStore.put({ ...p, key: driveProductKey(p) });
  await recordDriveProducts(products);
  return { imported: products.length, errors, unlinked };
}

/**
 * Produits du Drive par ingredient (pour l'assistant).
 * @param {DriveProduct[]} products
 * @returns {Map<string, DriveProduct[]>}
 */
export function productsByIngredient(products) {
  /** @type {Map<string, DriveProduct[]>} */
  const map = new Map();
  for (const p of products) {
    if (!p.ingredientId) continue;
    map.set(p.ingredientId, [...(map.get(p.ingredientId) ?? []), p]);
  }
  return map;
}

/**
 * Unite de base pour comparer des prix : g, ml ou l'unite elle-meme.
 * @param {string} unitId
 * @returns {string}
 */
function baseUnit(unitId) {
  const kind = getUnit(unitId)?.kind;
  return kind === 'mass' ? 'g' : kind === 'volume' ? 'ml' : unitId;
}

/**
 * Prix unitaire le plus bas connu par ingredient (Drive puis releves a la main).
 * @param {DriveProduct[]} products
 * @param {import('../domain/stores/stores.js').Price[]} prices
 * @param {Date} now
 * @returns {Map<string, UnitPrice>}
 */
export function unitPrices(products, prices, now) {
  /** @type {Map<string, UnitPrice>} */
  const map = new Map();
  /** @param {string} ingredientId @param {number} cents @param {number} qty @param {string} unit @param {boolean} verified */
  const add = (ingredientId, cents, qty, unit, verified) => {
    const base = baseUnit(unit);
    const q = convertUniversal(qty, unit, base);
    if (!q.ok || q.value <= 0) return;
    const centsPerUnit = cents / q.value;
    const current = map.get(ingredientId);
    if (!current || (current.unit === base && centsPerUnit < current.centsPerUnit)) map.set(ingredientId, { centsPerUnit, unit: base, verified });
  };
  for (const p of products) if (p.ingredientId && p.availability === 'available') add(p.ingredientId, p.priceCents, p.packageQuantity, p.packageUnit, isFresh(p, now));
  for (const p of prices) if (p.availability === 'available') add(p.ingredientId, p.priceCents, p.packageQuantity, p.packageUnit, false);
  return map;
}

/**
 * Donnees de prix chargees une fois pour plusieurs devis.
 * @returns {Promise<{ products: DriveProduct[], prices: import('../domain/stores/stores.js').Price[], settings: DriveSettings, store: Store | null }>}
 */
export async function loadPriceData() {
  const [products, prices, settings, store] = await Promise.all([getStoreProducts(), getPrices(), getDriveSettings(), getDriveStore()]);
  return { products, prices, settings, store };
}

/**
 * Chiffreur de la semaine : foyer, stock et conditionnements sont lus une fois, puis
 * n'importe quelle version du planning est chiffree sans relire la base
 * (sert a comparer des variantes, par exemple pour tenir un budget).
 * @param {string} monday
 * @param {{ products: DriveProduct[], prices: import('../domain/stores/stores.js').Price[], settings: DriveSettings }} data
 */
export async function weekQuoter(monday, data) {
  const days = new Set(weekDays(monday));
  const [household, inventory, packages] = await Promise.all([getHousehold(), getInventory(), getPackages()]);
  const now = new Date();
  const today = toIsoDate(now);
  /**
   * @param {Meal[]} meals
   * @param {Map<string, string>} preferred
   * @param {ProductPreference} preference
   */
  return (meals, preferred, preference) => {
    const weekMeals = meals.filter((m) => days.has(m.date));
    const needs = aggregateNeeds(mealNeedLines(weekMeals, household, recipesById, preparationsById), ingredientsById);
    const lines = buildShoppingLines(needs, inventory, packages, ingredientsById);
    const quote = quoteShoppingLines(lines, {
      products: data.products,
      prices: data.prices,
      ingredients: ingredientsById,
      today,
      now,
      hasLoyaltyCard: data.settings.hasLoyaltyCard,
      preference,
      preferredProducts: preferred,
    });
    return { lines, quote };
  };
}

/**
 * Devis des courses d'une liste de repas pour une semaine (stock et conditionnements deduits).
 * @param {Meal[]} meals
 * @param {string} monday
 * @param {{ products: DriveProduct[], prices: import('../domain/stores/stores.js').Price[], settings: DriveSettings }} data
 * @param {Record<string, string>} [preferredProducts]
 */
export async function quoteForMeals(meals, monday, data, preferredProducts) {
  const quoter = await weekQuoter(monday, data);
  return quoter(meals, new Map(Object.entries(preferredProducts ?? data.settings.preferredProducts)), data.settings.preference);
}

/**
 * Devis de la semaine telle qu'elle est planifiee.
 * @param {string} monday
 */
export async function weekQuote(monday) {
  const [meals, data] = await Promise.all([getMeals(), loadPriceData()]);
  return { ...(await quoteForMeals(meals, monday, data)), store: data.store, settings: data.settings };
}

/** @returns {Promise<DriveOrder[]>} */
export { getDriveOrders };

/**
 * Prepare (ou met a jour) la commande Drive de la semaine a partir du devis.
 * @param {string} monday
 * @returns {Promise<DriveOrder | null>}
 */
export async function prepareOrder(monday) {
  const { quote, store } = await weekQuote(monday);
  if (!store) return null;
  const existing = (await getDriveOrders()).find((o) => o.id === `order-${monday}`);
  const products = new Map((await getStoreProducts()).map((p) => [p.id, p]));
  /** @type {DriveOrder} */
  const order = {
    id: `order-${monday}`,
    week: monday,
    storeId: store.id,
    items: quote.lines
      .filter((l) => l.productId && l.cents !== null && l.count !== null)
      .map((l) => {
        const p = /** @type {DriveProduct} */ (products.get(/** @type {string} */ (l.productId)));
        return {
          productId: /** @type {string} */ (l.productId),
          name: p.name,
          ingredientId: l.ingredientId,
          count: /** @type {number} */ (l.count),
          cents: /** @type {number} */ (l.cents),
          savingCents: l.savingCents,
          promoLabel: l.promoLabel,
          fresh: l.kind === 'drive_verified',
          availability: p.availability,
        };
      }),
    notInDrive: quote.lines.filter((l) => !l.productId).map((l) => l.ingredientId),
    totalCents: quote.lines.filter((l) => l.productId).reduce((s, l) => s + (l.cents ?? 0), 0),
    status: existing?.status === 'sent' ? 'sent' : 'draft',
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    confirmedAt: existing?.confirmedAt ?? null,
    confirmedTotalCents: existing?.confirmedTotalCents ?? null,
  };
  // Une commande deja confirmee mais modifiee repasse en brouillon.
  if (existing && existing.status === 'confirmed' && JSON.stringify(existing.items) !== JSON.stringify(order.items)) order.status = 'draft';
  else if (existing?.status === 'confirmed') order.status = 'confirmed';
  await driveOrderStore.put(order);
  return order;
}

/**
 * Controles de la commande (magasin, prix recents, disponibilite, variation du total).
 * @param {DriveOrder} order
 */
export async function verifyOrder(order) {
  const [store, products] = await Promise.all([getDriveStore(), getStoreProducts()]);
  return checkOrder(order, { store, now: new Date(), products: new Map(products.map((p) => [p.id, p])) });
}

/**
 * Validation EXPLICITE du client. Refusee si un controle bloque.
 * @param {string} orderId
 * @returns {Promise<{ ok: boolean, blocking: string[], warnings: string[] }>}
 */
export async function confirmOrder(orderId) {
  const order = (await getDriveOrders()).find((o) => o.id === orderId);
  if (!order) return { ok: false, blocking: ['Commande introuvable.'], warnings: [] };
  const check = await verifyOrder({ ...order, confirmedTotalCents: null });
  if (!check.ok) return check;
  await driveOrderStore.put({ ...order, status: 'confirmed', confirmedAt: new Date().toISOString(), confirmedTotalCents: order.totalCents });
  return check;
}

/**
 * Le client a passe la commande sur le site du Drive (apres confirmation).
 * @param {string} orderId
 * @returns {Promise<{ ok: boolean, blocking: string[], warnings: string[] }>}
 */
export async function markOrderSent(orderId) {
  const order = (await getDriveOrders()).find((o) => o.id === orderId);
  if (!order || order.status !== 'confirmed') return { ok: false, blocking: ['Confirmez d’abord la commande.'], warnings: [] };
  const check = await verifyOrder(order);
  if (!check.ok) {
    await driveOrderStore.put({ ...order, status: 'draft' });
    return check;
  }
  await driveOrderStore.put({ ...order, status: 'sent' });
  return check;
}

/**
 * Promotions actives du Drive (verifiees ou non, avec leur fraicheur).
 * @returns {Promise<{ product: DriveProduct, fresh: boolean }[]>}
 */
export async function currentPromotions() {
  const now = new Date();
  return activePromotions(await getStoreProducts(), toIsoDate(now)).map((product) => ({ product, fresh: isFresh(product, now) }));
}
