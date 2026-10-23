/**
 * Magasins, prix saisis a la main et disponibilite (sections 24, 28 et 29).
 * Le MVP ne depend d'aucune API de prix.
 */
import { getUnit, cleanNumber } from '../units/units.js';
import { convertUnit } from '../ingredients/conversion.js';

/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */
/** @typedef {import('../shopping/shopping.js').ShoppingLine} ShoppingLine */

/** @typedef {'supermarket' | 'hypermarket' | 'discount' | 'market' | 'producer' | 'butcher' | 'fishmonger' | 'specialty' | 'other'} StoreType */

/** @type {{ id: StoreType, label: string }[]} */
export const STORE_TYPES = [
  { id: 'supermarket', label: 'Supermarché' },
  { id: 'hypermarket', label: 'Hypermarché' },
  { id: 'discount', label: 'Magasin discount' },
  { id: 'market', label: 'Marché' },
  { id: 'producer', label: 'Producteur' },
  { id: 'butcher', label: 'Boucherie' },
  { id: 'fishmonger', label: 'Poissonnerie' },
  { id: 'specialty', label: 'Épicerie spécialisée' },
  { id: 'other', label: 'Autre' },
];

/**
 * @typedef {Object} Store
 * @property {string} id
 * @property {string} name
 * @property {StoreType} type
 * @property {string} commune
 * @property {{ url: string, label: string } | null} [drive]  Commande en ligne (Drive) proposee par le magasin
 * @property {number | null} [distanceKm]     Distance depuis le domicile, aller simple
 * @property {number | null} [travelMinutes]  Temps de trajet, aller simple
 * @property {import('../trips/geo.js').GeoPlace | null} [location]   Position du magasin
 * @property {import('../trips/geo.js').DistanceSource} [distanceSource]  Origine de la distance
 */

/** @typedef {'available' | 'unavailable' | 'unknown'} Availability */

/** @type {{ id: Availability, label: string }[]} */
export const AVAILABILITY = [
  { id: 'available', label: 'Disponible' },
  { id: 'unavailable', label: 'Indisponible' },
  { id: 'unknown', label: 'Disponibilité inconnue' },
];

/**
 * Prix d'un produit dans un magasin, pour un conditionnement donne.
 * Un seul prix par magasin et par ingredient (le plus recent).
 * @typedef {Object} Price
 * @property {string} id                 "magasin|ingredient"
 * @property {string} storeId
 * @property {string} ingredientId
 * @property {string} label              Produit ou marque (facultatif)
 * @property {number} packageQuantity    Contenu du conditionnement vendu
 * @property {string} packageUnit
 * @property {number} priceCents         Prix d'un conditionnement (ou du kilo, litre, piece si vendu au detail), en centimes
 * @property {boolean} soldLoose         Vendu au poids ou a l'unite : on paie exactement la quantite prise
 * @property {string} date               Date du releve (AAAA-MM-JJ)
 * @property {Availability} availability
 */

/**
 * @param {string} storeId
 * @param {string} ingredientId
 * @returns {string}
 */
export function priceId(storeId, ingredientId) {
  return `${storeId}|${ingredientId}`;
}

/**
 * @param {Store} store
 * @returns {string[]}
 */
export function validateStore(store) {
  /** @type {string[]} */
  const errors = [];
  if (!store.name.trim()) errors.push('Indiquez le nom du magasin.');
  if (store.name.trim().length > 40) errors.push('Le nom est trop long (40 caractères au plus).');
  if (!STORE_TYPES.some((t) => t.id === store.type)) errors.push('Choisissez un type de magasin.');
  const km = store.distanceKm ?? null;
  const minutes = store.travelMinutes ?? null;
  if (km !== null && !(km >= 0 && km <= 300)) errors.push('Indiquez une distance en kilomètres (aller simple), par exemple 6,5.');
  if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 0 && minutes <= 300)) errors.push('Indiquez un temps de trajet en minutes (aller simple), par exemple 15.');
  const loc = store.location ?? null;
  if (loc !== null && !(typeof loc.lat === 'number' && typeof loc.lon === 'number' && Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180)) errors.push('Position du magasin invalide.');
  return errors;
}

/**
 * @param {Price} price
 * @param {Map<string, Ingredient>} ingredients
 * @returns {string[]}
 */
export function validatePrice(price, ingredients) {
  /** @type {string[]} */
  const errors = [];
  if (!ingredients.has(price.ingredientId)) errors.push('Choisissez un produit de la liste.');
  const unit = getUnit(price.packageUnit);
  if (!unit || unit.kind === 'qualitative' || unit.kind === 'package') errors.push('Choisissez une unité de contenu.');
  if (!Number.isFinite(price.packageQuantity) || price.packageQuantity <= 0) errors.push('Indiquez le contenu du produit vendu.');
  if (!Number.isInteger(price.priceCents) || price.priceCents < 0) errors.push('Indiquez un prix valide, par exemple 3,20.');
  if (!AVAILABILITY.some((a) => a.id === price.availability)) errors.push('Indiquez la disponibilité.');
  return errors;
}

/**
 * Cout d'achat d'une quantite chez un magasin, a partir de son prix.
 * - produit emballe : nombre de conditionnements = arrondi superieur (quantite / contenu),
 *   cout = nombre x prix ;
 * - vendu au poids ou a l'unite : cout = prix x quantite / contenu, arrondi au centime.
 * Renvoie null si le produit n'y est pas achetable : prix absent, disponibilite
 * "indisponible" OU "inconnue" (jamais consideree comme disponible), unites incompatibles.
 * @param {number} quantity
 * @param {string} unit
 * @param {Price | undefined} price
 * @param {Ingredient | null} ingredient
 * @returns {{ packages: number | null, cents: number } | null}   packages = null si vendu au detail
 */
export function purchaseCost(quantity, unit, price, ingredient) {
  if (!price || price.availability !== 'available') return null;
  const size = convertUnit(price.packageQuantity, price.packageUnit, unit, ingredient);
  if (!size.ok || size.value <= 0) return null;
  if (price.soldLoose) return { packages: null, cents: Math.round(cleanNumber((price.priceCents * quantity) / size.value)) };
  const packages = Math.ceil(cleanNumber(quantity / size.value));
  return { packages, cents: packages * price.priceCents };
}

/**
 * @typedef {Object} LineEstimate
 * @property {string} key
 * @property {string} ingredientId
 * @property {{ storeId: string, packages: number | null, cents: number } | null} best   Moins cher connu
 */

/**
 * Cout estime d'une liste de courses : pour chaque article a acheter, le moins cher
 * des prix connus et disponibles. Les articles sans prix sont listes a part :
 * l'estimation est alors INCOMPLETE et ne doit pas etre presentee comme le cout reel.
 * @param {ShoppingLine[]} lines
 * @param {Price[]} prices
 * @param {Map<string, Ingredient>} ingredients
 * @returns {{ totalCents: number, lines: LineEstimate[], missing: string[], complete: boolean }}
 */
export function estimateShoppingCost(lines, prices, ingredients) {
  let totalCents = 0;
  /** @type {LineEstimate[]} */
  const estimates = [];
  /** @type {string[]} */
  const missing = [];

  for (const line of lines) {
    if (line.covered || line.toBuy === null) continue;
    const ingredient = ingredients.get(line.ingredientId) ?? null;
    /** @type {LineEstimate['best']} */
    let best = null;
    for (const price of prices.filter((p) => p.ingredientId === line.ingredientId)) {
      const cost = purchaseCost(line.toBuy, line.unit, price, ingredient);
      if (cost && (!best || cost.cents < best.cents)) best = { storeId: price.storeId, ...cost };
    }
    if (best) totalCents += best.cents;
    else missing.push(line.ingredientId);
    estimates.push({ key: line.key, ingredientId: line.ingredientId, best });
  }
  return { totalCents, lines: estimates, missing, complete: missing.length === 0 };
}
