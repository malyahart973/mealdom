/**
 * Codes-barres des produits : verification du code (EAN-13, EAN-8, UPC-A) et
 * lecture de la fiche Open Food Facts (nom, marque, contenance).
 * Un code-barres identifie un produit, jamais son prix : le prix est toujours
 * saisi (ou lu sur l'etiquette) par la cliente, magasin par magasin.
 */
import { normalizeText } from '../ingredients/ingredients.js';

/**
 * Le code a-t-il une cle de controle correcte ?
 * @param {string} code
 * @returns {boolean}
 */
export function isValidBarcode(code) {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = /** @type {number} */ (digits.pop());
  // Poids 3 et 1 en partant de la droite (hors cle) : valable pour EAN-8, UPC-A et EAN-13.
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Contenance ecrite sur l'emballage : « 500 g », « 1 L », « 4 x 125 g », « 33 cl ».
 * @param {string} text
 * @returns {{ quantity: number, unit: string } | null}
 */
export function parsePackageQuantity(text) {
  const t = normalizeText(text).replace(/,/g, '.');
  const m = /(?:(\d+)\s*[x×*]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|mg|l|cl|ml)\b/.exec(t);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const value = Number(m[2]) * count;
  const unit = m[3];
  if (!(value > 0)) return null;
  if (unit === 'mg') return { quantity: value / 1000, unit: 'g' };
  return { quantity: Math.round(value * 1000) / 1000, unit };
}

/**
 * Produit lu sur Open Food Facts.
 * @typedef {Object} BarcodeProduct
 * @property {string} code
 * @property {string} name
 * @property {string} brand
 * @property {{ quantity: number, unit: string } | null} packageSize
 * @property {number | null} kcalPer100g
 */

/**
 * Lit la reponse de l'API Open Food Facts (v2, produit).
 * @param {unknown} json
 * @param {string} code
 * @returns {BarcodeProduct | null}  null si le produit est inconnu
 */
export function readOpenFoodFacts(json, code) {
  if (!json || typeof json !== 'object') return null;
  const data = /** @type {{ status?: number, product?: Record<string, unknown> }} */ (json);
  const p = data.product;
  if (data.status !== 1 || !p) return null;
  const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : '');
  const name = str(p.product_name_fr) || str(p.product_name) || str(p.generic_name_fr) || str(p.generic_name);
  if (!name) return null;
  const qty = Number(p.product_quantity);
  const qtyUnit = str(p.product_quantity_unit).toLowerCase();
  const packageSize =
    Number.isFinite(qty) && qty > 0 && ['g', 'ml', 'kg', 'l', 'cl'].includes(qtyUnit) ? { quantity: qty, unit: qtyUnit } : parsePackageQuantity(str(p.quantity));
  const nutriments = /** @type {Record<string, unknown> | undefined} */ (p.nutriments);
  const kcal = Number(nutriments?.['energy-kcal_100g']);
  return {
    code,
    name,
    brand: str(p.brands).split(',')[0]?.trim() ?? '',
    packageSize,
    kcalPer100g: Number.isFinite(kcal) ? Math.round(kcal) : null,
  };
}

/** Champs demandes a Open Food Facts (reponse legere). */
export const OFF_FIELDS = ['product_name', 'product_name_fr', 'generic_name', 'generic_name_fr', 'brands', 'quantity', 'product_quantity', 'product_quantity_unit', 'nutriments'];

/**
 * Association memorisee entre un code-barres et un ingredient (apres une premiere saisie).
 * @typedef {Object} BarcodeLink
 * @property {string} code
 * @property {string} ingredientId
 * @property {string} label
 * @property {number} packageQuantity
 * @property {string} packageUnit
 * @property {boolean} soldLoose
 * @property {string} updatedAt
 */
