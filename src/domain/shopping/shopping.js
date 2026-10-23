/**
 * Stock et liste de courses (regles des sections 20 a 25 du cahier des charges).
 * Ordre de calcul : besoins des repas -> agregation -> deduction du stock -> conditionnements.
 * Fonctions pures, testees.
 */
import { getUnit, roundUpQuantity, cleanNumber } from '../units/units.js';
import { convertUnit } from '../ingredients/conversion.js';
import { mealPortionsFor } from '../planning/planning.js';
import { preparationRequirements, scalePreparation } from '../batchCooking/batchCooking.js';
import { applySubstitutions } from '../recipes/recipes.js';

/** @typedef {import('../planning/planning.js').Meal} Meal */
/** @typedef {import('../household/household.js').Household} Household */
/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */
/** @typedef {import('../ingredients/ingredients.js').Aisle} Aisle */

/**
 * Article en stock.
 * @typedef {Object} InventoryItem
 * @property {string} id
 * @property {string} ingredientId
 * @property {number} quantity
 * @property {string} unit
 * @property {'pantry' | 'fridge' | 'freezer'} location
 * @property {string | null} [expiresOn]   Date limite (AAAA-MM-JJ), facultative
 */

/** @type {{ id: InventoryItem['location'], label: string }[]} */
export const LOCATIONS = [
  { id: 'pantry', label: 'Placards' },
  { id: 'fridge', label: 'Réfrigérateur' },
  { id: 'freezer', label: 'Congélateur' },
];

/**
 * Conditionnement habituel d'un ingredient (ex. riz : sac de 1 kg).
 * @typedef {{ ingredientId: string, label: string, quantity: number, unit: string }} Package
 */

/**
 * Etat d'une liste de courses (une par semaine) : articles coches et articles ajoutes a la main.
 * @typedef {{ week: string, checked: string[], extras: { id: string, label: string, checked: boolean }[] }} ShoppingListState
 */

/** @typedef {{ ingredientId: string, quantity: number | null, unit: string }} NeedLine */

/**
 * Besoin agrege pour un ingredient.
 * @typedef {Object} Need
 * @property {string} key             Identifiant stable de la ligne (pour la cocher)
 * @property {string} ingredientId
 * @property {number | null} quantity null = quantite qualitative ("au goût")
 * @property {string} unit
 */

/**
 * Unite de reference pour additionner : g pour les masses, ml pour les volumes,
 * cuilleres a cafe pour les cuilleres (plus parlant que des ml d'epices),
 * l'unite elle-meme pour les pieces, gousses, sachets...
 * @param {string} unitId
 * @returns {string}
 */
function baseUnit(unitId) {
  if (unitId === 'tsp' || unitId === 'tbsp') return 'tsp';
  const kind = getUnit(unitId)?.kind;
  if (kind === 'mass') return 'g';
  if (kind === 'volume') return 'ml';
  return unitId;
}

/**
 * Toutes les lignes d'ingredients des repas : ingredients des recettes (mis a l'echelle,
 * remplacements du repas compris) et ingredients des preparations (via le batch cooking).
 * @param {Meal[]} meals
 * @param {Household} household
 * @param {Map<string, Recipe>} recipes
 * @param {Map<string, Preparation>} preparations
 * @returns {NeedLine[]}
 */
export function mealNeedLines(meals, household, recipes, preparations) {
  /** @type {NeedLine[]} */
  const lines = [];
  for (const meal of meals) {
    const original = recipes.get(meal.recipeId);
    if (!original) continue;
    const recipe = applySubstitutions(original, meal.substitutions ?? []);
    const factor = mealPortionsFor(meal, household).total / recipe.servings;
    for (const l of recipe.ingredients) {
      lines.push({ ingredientId: l.ingredientId, quantity: l.quantity === null ? null : l.quantity * factor, unit: l.unit });
    }
  }
  for (const req of preparationRequirements(meals, household, recipes, preparations).requirements) {
    const prep = preparations.get(req.preparationId);
    if (!prep) continue;
    for (const l of scalePreparation(prep, req.quantity).ingredients) lines.push({ ...l });
  }
  return lines;
}

/**
 * Additionne les besoins identiques. On n'additionne que ce qui est vraiment equivalent :
 * - meme ingredient et meme famille d'unites (g/kg ensemble, ml/cl/L ensemble) ;
 * - pieces et grammes du meme ingredient : additionnes seulement si l'ingredient
 *   a une conversion connue (1 oignon = 110 g), sinon deux lignes separees ;
 * - les quantites qualitatives ("au goût") restent qualitatives.
 * @param {NeedLine[]} lines
 * @param {Map<string, Ingredient>} ingredients
 * @returns {Need[]}
 */
export function aggregateNeeds(lines, ingredients) {
  /** @type {Map<string, { ingredientId: string, quantity: number | null, unit: string }[]>} */
  const byIngredient = new Map();

  for (const line of lines) {
    const ingredient = ingredients.get(line.ingredientId);
    if (ingredient?.notPurchased) continue;
    const groups = byIngredient.get(line.ingredientId) ?? [];
    byIngredient.set(line.ingredientId, groups);

    if (line.quantity === null || getUnit(line.unit)?.kind === 'qualitative') {
      if (!groups.some((g) => g.quantity === null)) groups.push({ ingredientId: line.ingredientId, quantity: null, unit: line.unit });
      continue;
    }
    const unit = baseUnit(line.unit);
    const value = convertUnit(line.quantity, line.unit, unit, null);
    const amount = value.ok ? value.value : line.quantity;
    const sameUnit = groups.find((g) => g.quantity !== null && g.unit === unit);
    if (sameUnit && sameUnit.quantity !== null) sameUnit.quantity += amount;
    else groups.push({ ingredientId: line.ingredientId, quantity: amount, unit });
  }

  /** @type {Need[]} */
  const needs = [];
  for (const [ingredientId, groups] of byIngredient) {
    const ingredient = ingredients.get(ingredientId) ?? null;
    const quantified = groups.filter((g) => g.quantity !== null);
    // Regrouper les familles convertibles grace a l'ingredient (pieces -> g).
    const target = quantified.find((g) => g.unit === 'g') ?? quantified.find((g) => g.unit === 'ml') ?? quantified[0];
    for (const g of quantified) {
      if (g === target || target === undefined || target.quantity === null || g.quantity === null) continue;
      const converted = convertUnit(g.quantity, g.unit, target.unit, ingredient);
      if (converted.ok) {
        target.quantity += converted.value;
        g.quantity = null;
        g.unit = '__merged__';
      }
    }
    for (const g of groups) {
      if (g.unit === '__merged__') continue;
      if (g.quantity === null && quantified.length > 0) continue; // "au goût" inutile si une quantite existe deja
      needs.push({
        key: `${ingredientId}|${g.quantity === null ? 'qualitative' : g.unit}`,
        ingredientId,
        quantity: g.quantity === null ? null : cleanNumber(g.quantity),
        unit: g.unit,
      });
    }
  }
  return needs;
}

/**
 * @typedef {Object} ShoppingLine
 * @property {string} key
 * @property {string} ingredientId
 * @property {number | null} need          Besoin total (null = qualitatif)
 * @property {string} unit
 * @property {number} inStock              Quantite de stock utilisee (dans l'unite du besoin)
 * @property {number | null} toBuy         Reste a acheter avant conditionnement (null = qualitatif)
 * @property {{ count: number, package: Package } | null} packages
 * @property {number | null} buyQuantity   Quantite a acheter si pas de conditionnement connu
 * @property {boolean} covered             Rien a acheter
 * @property {Aisle} aisle
 */

/**
 * Deduit le stock et applique les conditionnements.
 * - besoin - stock utilisable = reste ; reste <= 0 : rien a acheter ;
 * - avec un conditionnement : nombre de paquets = arrondi superieur (reste / taille) ;
 * - sans conditionnement : pieces arrondies a l'unite superieure, grammes a 5 g pres ;
 * - qualitatif ("au goût") : couvert si l'ingredient est en stock, sinon a verifier.
 * @param {Need[]} needs
 * @param {InventoryItem[]} inventory
 * @param {Package[]} packages
 * @param {Map<string, Ingredient>} ingredients
 * @returns {ShoppingLine[]}
 */
export function buildShoppingLines(needs, inventory, packages, ingredients) {
  /** @type {Map<string, number>} reste de stock disponible par article */
  const remainingStock = new Map(inventory.map((i) => [i.id, i.quantity]));
  const packageByIngredient = new Map(packages.map((p) => [p.ingredientId, p]));

  return needs.map((need) => {
    const ingredient = ingredients.get(need.ingredientId) ?? null;
    const aisle = ingredient?.aisle ?? 'other';
    const stockItems = inventory.filter((i) => i.ingredientId === need.ingredientId && i.quantity > 0);

    if (need.quantity === null) {
      const covered = stockItems.length > 0;
      return { key: need.key, ingredientId: need.ingredientId, need: null, unit: need.unit, inStock: 0, toBuy: null, packages: null, buyQuantity: null, covered, aisle };
    }

    let missing = need.quantity;
    let used = 0;
    for (const item of stockItems) {
      if (missing <= 0) break;
      const available = remainingStock.get(item.id) ?? 0;
      if (available <= 0) continue;
      const inNeedUnit = convertUnit(available, item.unit, need.unit, ingredient);
      if (!inNeedUnit.ok) continue;
      const take = Math.min(missing, inNeedUnit.value);
      missing -= take;
      used += take;
      const back = convertUnit(take, need.unit, item.unit, ingredient);
      remainingStock.set(item.id, back.ok ? cleanNumber(available - back.value) : 0);
    }
    const toBuy = Math.max(0, cleanNumber(missing));
    const covered = toBuy === 0;

    let packageResult = null;
    let buyQuantity = null;
    const pkg = packageByIngredient.get(need.ingredientId);
    if (!covered && pkg) {
      const size = convertUnit(pkg.quantity, pkg.unit, need.unit, ingredient);
      if (size.ok && size.value > 0) packageResult = { count: Math.ceil(cleanNumber(toBuy / size.value)), package: pkg };
    }
    if (!covered && !packageResult) {
      const kind = getUnit(need.unit)?.kind;
      buyQuantity = kind === 'mass' || kind === 'volume' ? roundUpQuantity(toBuy, need.unit) : Math.ceil(cleanNumber(toBuy));
    }

    return {
      key: need.key,
      ingredientId: need.ingredientId,
      need: cleanNumber(need.quantity),
      unit: need.unit,
      inStock: cleanNumber(used),
      toBuy,
      packages: packageResult,
      buyQuantity,
      covered,
      aisle,
    };
  });
}

/**
 * Valide un article de stock.
 * @param {InventoryItem} item
 * @param {Map<string, Ingredient>} ingredients
 * @returns {string[]}
 */
export function validateInventoryItem(item, ingredients) {
  /** @type {string[]} */
  const errors = [];
  if (!ingredients.has(item.ingredientId)) errors.push('Choisissez un ingrédient de la liste.');
  const unit = getUnit(item.unit);
  if (!unit || unit.kind === 'qualitative') errors.push('Choisissez une unité.');
  if (!Number.isFinite(item.quantity) || item.quantity < 0) errors.push('Indiquez une quantité positive.');
  if (!LOCATIONS.some((l) => l.id === item.location)) errors.push('Choisissez un emplacement.');
  if (item.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(item.expiresOn)) errors.push('Date limite invalide.');
  return errors;
}

/**
 * Valide un conditionnement.
 * @param {Package} pkg
 * @param {Map<string, Ingredient>} ingredients
 * @returns {string[]}
 */
export function validatePackage(pkg, ingredients) {
  /** @type {string[]} */
  const errors = [];
  if (!ingredients.has(pkg.ingredientId)) errors.push('Ingrédient inconnu.');
  if (!pkg.label.trim()) errors.push('Indiquez le nom du conditionnement (ex. sac, boîte, filet).');
  const unit = getUnit(pkg.unit);
  if (!unit || unit.kind === 'qualitative' || unit.kind === 'package') errors.push('Choisissez une unité de contenu (g, kg, ml, L, pièce...).');
  if (!Number.isFinite(pkg.quantity) || pkg.quantity <= 0) errors.push('Indiquez la quantité contenue.');
  return errors;
}

/**
 * Texte de la liste de courses a partager (messagerie, SMS, notes), classe par rayon.
 * Les articles deja coches (dans le panier) ne sont pas repris.
 * @param {ShoppingLine[]} lines
 * @param {ShoppingListState} state
 * @param {{ title: string, aisles: { id: string, label: string }[], name: (ingredientId: string) => string, describe: (line: ShoppingLine) => string }} ctx
 * @returns {{ text: string, count: number }}
 */
export function shoppingListText(lines, state, ctx) {
  const toBuy = lines.filter((l) => !l.covered && !state.checked.includes(l.key));
  /** @type {string[]} */
  const parts = [ctx.title];
  for (const aisle of ctx.aisles) {
    const items = toBuy.filter((l) => l.aisle === aisle.id);
    if (!items.length) continue;
    parts.push('', aisle.label.toUpperCase(), ...items.map((l) => `- ${ctx.name(l.ingredientId)} : ${ctx.describe(l)}`));
  }
  const extras = state.extras.filter((x) => !x.checked);
  if (extras.length) parts.push('', 'EN PLUS', ...extras.map((x) => `- ${x.label}`));
  const count = toBuy.length + extras.length;
  if (count === 0) parts.push('', 'Tout est déjà dans le panier.');
  return { text: parts.join('\n'), count };
}

/** Un produit est « a consommer vite » dans les 3 jours qui precedent sa date limite. */
export const EXPIRY_SOON_DAYS = 3;

/**
 * Etat d'un article du stock par rapport a sa date limite.
 * @param {InventoryItem} item
 * @param {string} today
 * @returns {{ status: 'expired' | 'today' | 'soon' | 'ok' | null, days: number | null }}
 */
export function expiryStatus(item, today) {
  if (!item.expiresOn) return { status: null, days: null };
  const days = Math.round((Date.parse(`${item.expiresOn}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86400000);
  if (Number.isNaN(days)) return { status: null, days: null };
  if (days < 0) return { status: 'expired', days };
  if (days === 0) return { status: 'today', days };
  return { status: days <= EXPIRY_SOON_DAYS ? 'soon' : 'ok', days };
}

/**
 * Articles a consommer en priorite (perimes ou proches de leur date limite), les plus urgents d'abord.
 * Seuls les articles encore en stock comptent.
 * @param {InventoryItem[]} items
 * @param {string} today
 * @returns {InventoryItem[]}
 */
export function itemsToUseFirst(items, today) {
  return items
    .filter((i) => i.quantity > 0 && ['expired', 'today', 'soon'].includes(expiryStatus(i, today).status ?? ''))
    .sort((a, b) => String(a.expiresOn).localeCompare(String(b.expiresOn)));
}
