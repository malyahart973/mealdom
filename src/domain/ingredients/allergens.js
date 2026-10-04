/**
 * Les 14 allergenes a declaration obligatoire dans l'Union europeenne
 * (reglement (UE) n° 1169/2011, annexe II).
 */

/** @typedef {{ id: string, label: string }} Allergen */

/** @type {Allergen[]} */
export const ALLERGENS = [
  { id: 'gluten', label: 'Céréales contenant du gluten' },
  { id: 'crustaceans', label: 'Crustacés' },
  { id: 'eggs', label: 'Œufs' },
  { id: 'fish', label: 'Poissons' },
  { id: 'peanuts', label: 'Arachides' },
  { id: 'soy', label: 'Soja' },
  { id: 'milk', label: 'Lait' },
  { id: 'nuts', label: 'Fruits à coque' },
  { id: 'celery', label: 'Céleri' },
  { id: 'mustard', label: 'Moutarde' },
  { id: 'sesame', label: 'Graines de sésame' },
  { id: 'sulphites', label: 'Anhydride sulfureux et sulfites' },
  { id: 'lupin', label: 'Lupin' },
  { id: 'molluscs', label: 'Mollusques' },
];

/** Message a afficher partout ou l'on parle d'allergies. */
export const PRODUCT_LABEL_WARNING =
  "MealDom vérifie les ingrédients des recettes, pas les produits que vous achetez. Lisez toujours l'étiquette : un produit peut contenir des traces d'allergènes.";

/** @type {Set<string>} */
const ALLERGEN_IDS = new Set(ALLERGENS.map((a) => a.id));

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isKnownAllergen(id) {
  return ALLERGEN_IDS.has(id);
}
