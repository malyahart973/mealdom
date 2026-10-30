/**
 * Codes-barres : produit deja connu sur ce telephone, sinon fiche Open Food Facts
 * (base libre et collaborative). Aucun prix ne vient d'une base publique.
 */
import { readOpenFoodFacts, OFF_FIELDS } from '../domain/stores/barcode.js';
import { makeIngredientFinder } from '../domain/assistant/intent.js';
import { buildNameIndex } from '../domain/ingredients/ingredients.js';
import { barcodeStore } from '../db/repositories/barcodeRepository.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { ingredientsById } from './catalog.js';
import { INGREDIENTS } from '../data/ingredients.js';

/** @typedef {import('../domain/stores/barcode.js').BarcodeLink} BarcodeLink */
/** @typedef {import('../domain/stores/barcode.js').BarcodeProduct} BarcodeProduct */

const finder = makeIngredientFinder(buildNameIndex(INGREDIENTS), ingredientsById);
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';

/**
 * @typedef {Object} BarcodeLookup
 * @property {BarcodeLink | null} link          Deja enregistre sur ce telephone
 * @property {BarcodeProduct | null} product    Fiche Open Food Facts
 * @property {string | null} suggestedIngredientId
 * @property {string | null} error
 */

/**
 * @param {string} code
 * @returns {Promise<BarcodeLookup>}
 */
export async function lookupBarcode(code) {
  const link = /** @type {BarcodeLink | undefined} */ (await barcodeStore.get(code)) ?? null;
  if (link) return { link, product: null, suggestedIngredientId: link.ingredientId, error: null };
  if (!navigator.onLine) return { link: null, product: null, suggestedIngredientId: null, error: 'Pas de connexion : produit inconnu sur ce téléphone. Remplissez le formulaire, il sera reconnu la prochaine fois.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${OFF_URL}${encodeURIComponent(code)}.json?fields=${OFF_FIELDS.join(',')}`, { signal: controller.signal });
    if (response.status === 404) return { link: null, product: null, suggestedIngredientId: null, error: 'Produit absent d’Open Food Facts. Remplissez le formulaire : il sera reconnu au prochain scan.' };
    if (!response.ok) throw new Error(String(response.status));
    const product = readOpenFoodFacts(await response.json(), code);
    if (!product) return { link: null, product: null, suggestedIngredientId: null, error: 'Produit absent d’Open Food Facts. Remplissez le formulaire : il sera reconnu au prochain scan.' };
    const suggestion = finder.findIngredientInText(product.name);
    return { link: null, product, suggestedIngredientId: suggestion?.id ?? null, error: null };
  } catch {
    return { link: null, product: null, suggestedIngredientId: null, error: 'Open Food Facts ne répond pas. Remplissez le formulaire : le code sera retenu.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retient le produit d'un code-barres pour les prochains scans.
 * @param {BarcodeLink} link
 * @returns {Promise<void>}
 */
export function rememberBarcode(link) {
  return barcodeStore.put(link);
}

/** @returns {Promise<string | null>} */
export async function lastPriceStore() {
  const id = await getSetting('lastPriceStore');
  return typeof id === 'string' ? id : null;
}

/**
 * @param {string} storeId
 * @returns {Promise<void>}
 */
export function setLastPriceStore(storeId) {
  return setSetting('lastPriceStore', storeId);
}
