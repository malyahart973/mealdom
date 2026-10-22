/**
 * Valeurs nutritionnelles des recettes et portions en grammes.
 * Les valeurs de base sont des moyennes (src/data/nutrition.js) : les resultats
 * sont des ESTIMATIONS, arrondies a l'affichage.
 */
import { getUnit, convertUniversal, cleanNumber } from '../units/units.js';
import { convertUnit } from '../ingredients/conversion.js';

/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */
/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {import('../recipes/recipes.js').IngredientLine} IngredientLine */
/** @typedef {import('../../data/nutrition.js').NutritionRow} NutritionRow */

/** @typedef {{ kcal: number, protein: number, carbs: number, fat: number, fiber: number }} Nutrients */

/**
 * Pour 100 g, avec le poids d'une piece et la densite si connus.
 * @typedef {Nutrients & { gramsPerPiece: number | null, gramsPerMl: number | null }} NutritionFacts
 */

/** @type {Nutrients} */
export const ZERO_NUTRIENTS = Object.freeze({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

/**
 * @param {Record<string, NutritionRow>} table
 * @returns {Map<string, NutritionFacts>}
 */
export function buildNutritionIndex(table) {
  /** @type {Map<string, NutritionFacts>} */
  const index = new Map();
  for (const [id, row] of Object.entries(table)) {
    const [kcal, protein, carbs, fat, fiber, piece, perMl] = row;
    index.set(id, { kcal, protein, carbs, fat, fiber, gramsPerPiece: piece ?? null, gramsPerMl: perMl ?? null });
  }
  return index;
}

/**
 * @param {Nutrients} a
 * @param {Nutrients} b
 * @returns {Nutrients}
 */
export function addNutrients(a, b) {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat, fiber: a.fiber + b.fiber };
}

/**
 * @param {Nutrients} n
 * @param {number} factor
 * @returns {Nutrients}
 */
export function scaleNutrients(n, factor) {
  return { kcal: n.kcal * factor, protein: n.protein * factor, carbs: n.carbs * factor, fat: n.fat * factor, fiber: n.fiber * factor };
}

/**
 * Arrondi d'affichage : kcal a l'unite, le reste au gramme.
 * @param {Nutrients} n
 * @returns {Nutrients}
 */
export function roundNutrients(n) {
  return {
    kcal: Math.round(n.kcal),
    protein: Math.round(n.protein),
    carbs: Math.round(n.carbs),
    fat: Math.round(n.fat),
    fiber: Math.round(n.fiber),
  };
}

/**
 * Poids en grammes d'une quantite d'ingredient.
 * 1. conversion connue de l'ingredient (kg, piece d'oignon...) ;
 * 2. volume (cuilleres, ml) x densite de l'aliment (1 si inconnue) ;
 * 3. piece, gousse, poignee x poids moyen de l'aliment.
 * Quantite qualitative ("au goût") : 0 g (negligeable). Null si impossible.
 * @param {number | null} quantity
 * @param {string} unitId
 * @param {Ingredient | null} ingredient
 * @param {NutritionFacts | undefined} facts
 * @returns {number | null}
 */
export function gramsOf(quantity, unitId, ingredient, facts) {
  const unit = getUnit(unitId);
  if (!unit) return null;
  if (unit.kind === 'qualitative' || quantity === null) return 0;
  const direct = convertUnit(quantity, unitId, 'g', ingredient);
  if (direct.ok) return direct.value;
  if (unit.kind === 'volume') {
    const ml = convertUniversal(quantity, unitId, 'ml');
    return ml.ok ? cleanNumber(ml.value * (facts?.gramsPerMl ?? 1)) : null;
  }
  if (unit.kind === 'count' && facts?.gramsPerPiece) return cleanNumber(quantity * facts.gramsPerPiece);
  return null;
}

/**
 * @typedef {Object} NutritionContext
 * @property {Map<string, Ingredient>} ingredients
 * @property {Map<string, Preparation>} preparations
 * @property {Map<string, NutritionFacts>} nutrition
 */

/**
 * Apports d'une liste de lignes d'ingredients.
 * @param {IngredientLine[]} lines
 * @param {number} factor
 * @param {NutritionContext} ctx
 * @param {Set<string>} missing   Ingredients impossibles a chiffrer (complete)
 * @returns {Nutrients}
 */
function linesNutrients(lines, factor, ctx, missing) {
  let total = { ...ZERO_NUTRIENTS };
  for (const line of lines) {
    const facts = ctx.nutrition.get(line.ingredientId);
    const grams = gramsOf(line.quantity, line.unit, ctx.ingredients.get(line.ingredientId) ?? null, facts);
    if (!facts || grams === null) {
      missing.add(line.ingredientId);
      continue;
    }
    total = addNutrients(total, scaleNutrients(facts, (grams * factor) / 100));
  }
  return total;
}

/**
 * Part d'une preparation consommee par une recette (quantite / rendement).
 * @param {import('../recipes/recipes.js').PreparationLine} line
 * @param {Preparation} prep
 * @returns {number | null}
 */
function preparationShare(line, prep) {
  const used = convertUniversal(line.quantity, line.unit, prep.yield.unit);
  return used.ok ? used.value / prep.yield.quantity : null;
}

/**
 * Valeurs nutritionnelles d'UNE portion adulte de la recette, preparations comprises.
 * complete = faux si un ingredient n'a pas pu etre chiffre (l'estimation est alors basse).
 * @param {Recipe} recipe
 * @param {NutritionContext} ctx
 * @returns {{ perPortion: Nutrients, complete: boolean, missing: string[] }}
 */
export function recipeNutrition(recipe, ctx) {
  /** @type {Set<string>} */
  const missing = new Set();
  let total = linesNutrients(recipe.ingredients, 1, ctx, missing);
  for (const line of recipe.preparations) {
    const prep = ctx.preparations.get(line.preparationId);
    const share = prep ? preparationShare(line, prep) : null;
    if (!prep || share === null) {
      missing.add(`preparation:${line.preparationId}`);
      continue;
    }
    total = addNutrients(total, linesNutrients(prep.ingredients, share, ctx, missing));
  }
  return { perPortion: scaleNutrients(total, 1 / recipe.servings), complete: missing.size === 0, missing: [...missing] };
}

/**
 * @typedef {Object} PortionLine
 * @property {'ingredient' | 'preparation'} kind
 * @property {string} id
 * @property {number | null} grams        null = quantite non convertible (affichee telle quelle)
 * @property {number | null} quantity     Quantite d'origine mise a l'echelle
 * @property {string} unit
 */

/**
 * Quantites en GRAMMES pour un nombre de portions donne (ex. 0,8 portion pour un
 * programme minceur). Les preparations restent groupees (ex. riz cuit 150 g).
 * Arrondi au gramme ; les quantites qualitatives restent qualitatives.
 * @param {Recipe} recipe
 * @param {number} portions
 * @param {NutritionContext} ctx
 * @returns {PortionLine[]}
 */
export function portionLines(recipe, portions, ctx) {
  const factor = portions / recipe.servings;
  /** @type {PortionLine[]} */
  const lines = [];
  for (const l of recipe.ingredients) {
    const unit = getUnit(l.unit);
    const quantity = l.quantity === null ? null : cleanNumber(l.quantity * factor);
    const qualitative = !unit || unit.kind === 'qualitative' || quantity === null;
    const grams = qualitative ? null : gramsOf(quantity, l.unit, ctx.ingredients.get(l.ingredientId) ?? null, ctx.nutrition.get(l.ingredientId));
    lines.push({ kind: 'ingredient', id: l.ingredientId, grams: grams === null ? null : Math.round(grams), quantity, unit: l.unit });
  }
  for (const l of recipe.preparations) {
    const quantity = cleanNumber(l.quantity * factor);
    const grams = convertUniversal(quantity, l.unit, 'g');
    lines.push({ kind: 'preparation', id: l.preparationId, grams: grams.ok ? Math.round(grams.value) : null, quantity, unit: l.unit });
  }
  return lines;
}
