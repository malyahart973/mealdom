/**
 * Unites de mesure et conversions UNIVERSELLES.
 * Une conversion universelle ne depend pas de l'aliment (1 kg = 1 000 g).
 * Les conversions qui dependent de l'aliment (1 tasse de riz en grammes)
 * sont dans src/domain/ingredients/conversion.js.
 */

/**
 * Famille d'unites. Seules les unites d'une meme famille "mass" ou "volume"
 * se convertissent entre elles sans connaitre l'aliment.
 * @typedef {'mass' | 'volume' | 'count' | 'package' | 'qualitative'} UnitKind
 */

/**
 * @typedef {Object} Unit
 * @property {string} id
 * @property {string} label           Libelle affiche
 * @property {UnitKind} kind
 * @property {string} [plural]        Libelle au pluriel quand il differe
 * @property {number} [toBase]        Pour mass (base g) et volume (base ml) uniquement
 */

/** @type {Unit[]} */
export const UNITS = [
  // Masse (base : gramme)
  { id: 'mg', label: 'mg', kind: 'mass', toBase: 0.001 },
  { id: 'g', label: 'g', kind: 'mass', toBase: 1 },
  { id: 'kg', label: 'kg', kind: 'mass', toBase: 1000 },
  // Volume (base : millilitre)
  { id: 'ml', label: 'ml', kind: 'volume', toBase: 1 },
  { id: 'cl', label: 'cl', kind: 'volume', toBase: 10 },
  { id: 'l', label: 'L', kind: 'volume', toBase: 1000 },
  { id: 'tsp', label: 'c. à café', kind: 'volume', toBase: 5 },
  { id: 'tbsp', label: 'c. à soupe', kind: 'volume', toBase: 15 },
  { id: 'cup', label: 'cup (237 ml)', kind: 'volume', toBase: 236.59 },
  // Quantites comptees : convertibles en grammes seulement si l'aliment le precise
  { id: 'piece', label: 'pièce', plural: 'pièces', kind: 'count' },
  { id: 'clove', label: 'gousse', plural: 'gousses', kind: 'count' },
  { id: 'slice', label: 'tranche', plural: 'tranches', kind: 'count' },
  { id: 'handful', label: 'poignée', plural: 'poignées', kind: 'count' },
  // Contenants : leur contenu depend du produit
  { id: 'sachet', label: 'sachet', plural: 'sachets', kind: 'package' },
  { id: 'can', label: 'boîte', plural: 'boîtes', kind: 'package' },
  { id: 'pack', label: 'paquet', plural: 'paquets', kind: 'package' },
  { id: 'bottle', label: 'bouteille', plural: 'bouteilles', kind: 'package' },
  // Quantites qualitatives : jamais converties
  { id: 'to_taste', label: 'au goût', kind: 'qualitative' },
  { id: 'pinch', label: 'une pincée', kind: 'qualitative' },
  { id: 'drizzle', label: 'un filet', kind: 'qualitative' },
  { id: 'as_needed', label: 'selon besoin', kind: 'qualitative' },
  { id: 'enough', label: 'suffisamment', kind: 'qualitative' },
];

/** @type {Map<string, Unit>} */
const UNITS_BY_ID = new Map(UNITS.map((u) => [u.id, u]));

/**
 * @param {string} id
 * @returns {Unit | undefined}
 */
export function getUnit(id) {
  return UNITS_BY_ID.get(id);
}

/**
 * Vrai pour "au goût", "une pincée", etc.
 * @param {string} unitId
 * @returns {boolean}
 */
export function isQualitative(unitId) {
  return getUnit(unitId)?.kind === 'qualitative';
}

/**
 * Supprime les imprecisions de calcul (ex. 0.30000000000000004 -> 0.3).
 * @param {number} value
 * @returns {number}
 */
export function cleanNumber(value) {
  return Math.round(value * 1e9) / 1e9;
}

/**
 * Resultat d'une conversion : la valeur, ou la raison de l'echec.
 * @typedef {{ ok: true, value: number } | { ok: false, reason: 'unknown_unit' | 'qualitative' | 'no_conversion' }} ConversionResult
 */

/**
 * Conversion universelle (sans connaitre l'aliment).
 * @param {number} quantity
 * @param {string} fromId
 * @param {string} toId
 * @returns {ConversionResult}
 */
export function convertUniversal(quantity, fromId, toId) {
  const from = getUnit(fromId);
  const to = getUnit(toId);
  if (!from || !to) return { ok: false, reason: 'unknown_unit' };
  if (from.kind === 'qualitative' || to.kind === 'qualitative') return { ok: false, reason: 'qualitative' };
  if (fromId === toId) return { ok: true, value: quantity };
  if (from.kind === to.kind && from.toBase !== undefined && to.toBase !== undefined) {
    return { ok: true, value: cleanNumber((quantity * from.toBase) / to.toBase) };
  }
  return { ok: false, reason: 'no_conversion' };
}

/**
 * Arrondi au-dessus, a une precision utile en cuisine (on n'achete pas 437,25 g).
 * - g, ml : 5 pres ; mg : 1 pres ; kg, L : 0,05 pres ; cl : 1 pres
 * - pieces, gousses, cuilleres... : demi-unite
 * - quantites qualitatives : inchangees
 * @param {number} quantity
 * @param {string} unitId
 * @returns {number}
 */
export function roundUpQuantity(quantity, unitId) {
  /** @type {Record<string, number>} */
  const steps = { g: 5, ml: 5, mg: 1, cl: 1, kg: 0.05, l: 0.05 };
  const unit = getUnit(unitId);
  if (!unit || unit.kind === 'qualitative') return quantity;
  const step = steps[unitId] ?? 0.5;
  const clean = cleanNumber(quantity / step);
  return cleanNumber(Math.ceil(clean) * step);
}
