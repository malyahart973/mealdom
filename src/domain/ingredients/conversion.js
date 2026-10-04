import { convertUniversal, cleanNumber } from '../units/units.js';

/** @typedef {import('../units/units.js').ConversionResult} ConversionResult */
/** @typedef {import('./ingredients.js').Ingredient} Ingredient */

/**
 * Conversion d'une quantite d'un ingredient (implementation unique).
 * 1. conversion universelle si possible (kg -> g, cl -> ml...) ;
 * 2. sinon conversion propre a l'ingredient (1 cup de riz = 185 g),
 *    combinee si besoin avec une conversion universelle (cup de riz -> kg) ;
 * 3. sinon echec explicite : on n'invente jamais de conversion.
 * @param {number} quantity
 * @param {string} fromUnit
 * @param {string} toUnit
 * @param {Ingredient | null} ingredient
 * @returns {ConversionResult}
 */
export function convertUnit(quantity, fromUnit, toUnit, ingredient) {
  const direct = convertUniversal(quantity, fromUnit, toUnit);
  if (direct.ok || direct.reason !== 'no_conversion' || !ingredient) return direct;

  for (const c of ingredient.conversions) {
    // Sens direct : fromUnit -> c.fromUnit -> (x factor) -> c.toUnit -> toUnit
    const a = convertUniversal(quantity, fromUnit, c.fromUnit);
    if (a.ok) {
      const b = convertUniversal(a.value * c.factor, c.toUnit, toUnit);
      if (b.ok) return { ok: true, value: cleanNumber(b.value) };
    }
    // Sens inverse : fromUnit -> c.toUnit -> (/ factor) -> c.fromUnit -> toUnit
    const r = convertUniversal(quantity, fromUnit, c.toUnit);
    if (r.ok) {
      const s = convertUniversal(r.value / c.factor, c.fromUnit, toUnit);
      if (s.ok) return { ok: true, value: cleanNumber(s.value) };
    }
  }
  return { ok: false, reason: 'no_conversion' };
}
