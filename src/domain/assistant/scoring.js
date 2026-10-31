/**
 * Evaluation des recettes selon les objectifs du client.
 * Les couts servent UNIQUEMENT a classer les recettes : un prix n'est jamais
 * affiche a partir de ces estimations (voir quote.js pour les prix verifies).
 */
import { getUnit, convertUniversal } from '../units/units.js';
import { convertUnit } from '../ingredients/conversion.js';
import { allIngredientIds, totalMinutes, hasTag, fitsSlot } from '../recipes/recipes.js';
import { evaluateRecipeForHousehold } from '../household/compatibility.js';
import { gramsOf } from '../nutrition/nutrition.js';
import { programFitScore } from '../nutrition/program.js';
import { isFeasibleLocally, rareCount } from '../ingredients/territory.js';
import { substitutesFor } from './substitutes.js';

/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */
/** @typedef {import('../household/household.js').Household} Household */
/** @typedef {import('../nutrition/nutrition.js').Nutrients} Nutrients */
/** @typedef {import('../nutrition/nutrition.js').NutritionFacts} NutritionFacts */
/** @typedef {import('./intent.js').Mode} Mode */
/** @typedef {import('./intent.js').FoodTarget} FoodTarget */
/** @typedef {import('../planning/planning.js').Slot} Slot */

/**
 * Prix unitaire le plus bas connu pour un ingredient (centimes par g, ml ou piece).
 * @typedef {{ centsPerUnit: number, unit: string, verified: boolean }} UnitPrice
 */

/**
 * @typedef {Object} ScoringContext
 * @property {Household} household
 * @property {Map<string, Ingredient>} ingredients
 * @property {Map<string, Preparation>} preparations
 * @property {Map<string, NutritionFacts>} nutrition
 * @property {Map<string, Nutrients>} nutritionByRecipe       Valeurs par portion adulte
 * @property {Map<string, UnitPrice>} unitPrices
 * @property {Set<string>} promoIngredients                  Promotions actives et verifiees
 * @property {Set<string>} stockIngredients
 * @property {Set<string>} [expiringIngredients]           En stock et proches de leur date limite (non perimes)
 * @property {Set<string>} [seasonalIngredients]           De saison, au plus bas ou peyi en ce moment
 * @property {Partial<Record<Slot, { kcal: number, proteinG: number }>> | null} programTargets
 * @property {import('../ingredients/territory.js').AvailabilityOf} [availability]
 *   Disponibilite locale (Guyane) : recettes impossibles exclues, ingredients rares penalises
 * @property {Map<string, import('../batchCooking/keeping.js').Keeping>} [keepingOf]
 *   Conservation des plats, pour le batch cooking
 */

/**
 * Objectifs ponderes : 1 = demande explicite, moins pour une preference apprise.
 * @typedef {Partial<Record<Mode, number>>} Weights
 */

/**
 * Criteres stricts d'une recherche de recette.
 * @typedef {Object} Constraints
 * @property {Slot | null} slot
 * @property {number | null} maxMinutes
 * @property {FoodTarget[]} avoid
 * @property {FoodTarget[]} include
 * @property {string | null} cuisine
 * @property {Set<string> | null} cuisines         Cuisines de la region demandee
 * @property {Set<string>} excludeRecipeIds
 * @property {number | null} maxCostIndex          Ne pas depasser ce cout (contrainte budgetaire)
 * @property {Set<string>} [compatibleIds]         Recettes deja verifiees pour le foyer (calcul fait une fois)
 */

/** Familles « categorie » utilisees dans les cibles d'aliments. */
const BEEF = new Set(['beef_steak', 'beef_stew', 'ground_beef']);
const LAMB = new Set(['lamb']);

/**
 * L'ingredient appartient-il a la cible (ingredient precis ou famille) ?
 * @param {string} ingredientId
 * @param {FoodTarget} target
 * @param {Map<string, Ingredient>} ingredients
 * @returns {boolean}
 */
export function matchesTarget(ingredientId, target, ingredients) {
  if (target.ingredientId) return ingredientId === target.ingredientId;
  const cats = /** @type {string[]} */ (ingredients.get(ingredientId)?.categories ?? []);
  switch (target.category) {
    case 'beef':
      return BEEF.has(ingredientId);
    case 'lamb':
      return LAMB.has(ingredientId);
    case 'meat':
      return cats.includes('meat');
    case 'fish':
      // la sauce poisson n'est pas « du poisson » au sens d'un plat
      return cats.includes('fish') && ingredientId !== 'fish_sauce';
    case 'shellfish':
      return cats.includes('shellfish') && !['oyster_sauce', 'curry_paste_red', 'curry_paste_green', 'curry_paste_yellow', 'massaman_paste', 'kimchi'].includes(ingredientId);
    default:
      return target.category ? cats.includes(target.category) : false;
  }
}

/**
 * La recette contient-elle la cible (preparations comprises) ?
 * @param {Recipe} recipe
 * @param {FoodTarget} target
 * @param {ScoringContext} ctx
 * @returns {boolean}
 */
export function recipeContains(recipe, target, ctx) {
  return allIngredientIds(recipe, ctx.preparations).some((id) => matchesTarget(id, target, ctx.ingredients));
}

/** Rayons sans incidence sur le cout (epices, eau) : ignores dans les estimations. */
const NEGLIGIBLE_AISLES = new Set(['spices']);

/**
 * Indice de cout relatif d'un ingredient (par 100 g), quand aucun prix n'est connu.
 * Sert a classer « plutot cher / plutot economique », jamais a afficher un prix.
 * @param {Ingredient | undefined} ingredient
 * @returns {number}
 */
function costClass(ingredient) {
  if (!ingredient) return 1;
  const premium = ['beef_steak', 'lamb', 'salmon', 'smoked_salmon', 'shrimp', 'cashews', 'almonds', 'walnuts', 'parmesan', 'reblochon', 'goat_cheese', 'feta', 'pesto', 'dark_chocolate'];
  if (premium.includes(ingredient.id)) return 3;
  const cats = ingredient.categories ?? [];
  if (cats.includes('meat') || cats.includes('fish') || cats.includes('shellfish')) return 2;
  if (cats.includes('dairy')) return 1.2;
  if (ingredient.aisle === 'fruits_vegetables' || ingredient.aisle === 'frozen') return 0.6;
  return 0.4;
}

/**
 * Lignes d'ingredients de la recette pour une portion, preparations comprises.
 * @param {Recipe} recipe
 * @param {ScoringContext} ctx
 * @returns {{ ingredientId: string, quantity: number | null, unit: string }[]}
 */
function portionLines(recipe, ctx) {
  const lines = recipe.ingredients.map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity === null ? null : l.quantity / recipe.servings, unit: l.unit }));
  for (const p of recipe.preparations) {
    const prep = ctx.preparations.get(p.preparationId);
    if (!prep) continue;
    const used = convertUniversal(p.quantity, p.unit, prep.yield.unit);
    if (!used.ok) continue;
    const share = used.value / prep.yield.quantity / recipe.servings;
    for (const l of prep.ingredients) lines.push({ ingredientId: l.ingredientId, quantity: l.quantity === null ? null : l.quantity * share, unit: l.unit });
  }
  return lines;
}

/**
 * Cout estime d'une portion :
 * - "real" si chaque ingredient (hors epices) a un prix connu ;
 * - sinon un indice relatif (heuristique), pour classer seulement.
 * @param {Recipe} recipe
 * @param {ScoringContext} ctx
 * @returns {{ real: number | null, index: number }}
 */
export function recipeCost(recipe, ctx) {
  let real = 0;
  let complete = true;
  let index = 0;
  for (const l of portionLines(recipe, ctx)) {
    const ingredient = ctx.ingredients.get(l.ingredientId);
    if (!ingredient || ingredient.notPurchased || l.quantity === null || NEGLIGIBLE_AISLES.has(ingredient.aisle ?? 'other')) continue;
    const grams = gramsOf(l.quantity, l.unit, ingredient, ctx.nutrition.get(l.ingredientId)) ?? 0;
    index += (grams / 100) * costClass(ingredient);
    const price = ctx.unitPrices.get(l.ingredientId);
    const qty = price ? convertUnit(l.quantity, l.unit, price.unit, ingredient) : null;
    if (price && qty && qty.ok) real += qty.value * price.centsPerUnit;
    else complete = false;
  }
  return { real: complete ? Math.round(real) : null, index: Math.round(index * 100) / 100 };
}

/**
 * Part des legumes et fruits dans la recette (en poids).
 * @param {Recipe} recipe
 * @param {ScoringContext} ctx
 * @returns {number}
 */
export function vegetableShare(recipe, ctx) {
  let veg = 0;
  let total = 0;
  for (const l of portionLines(recipe, ctx)) {
    const ingredient = ctx.ingredients.get(l.ingredientId);
    if (!ingredient || ingredient.notPurchased || l.quantity === null) continue;
    const grams = gramsOf(l.quantity, l.unit, ingredient, ctx.nutrition.get(l.ingredientId)) ?? 0;
    total += grams;
    if (ingredient.aisle === 'fruits_vegetables' && !['garlic', 'ginger', 'lime', 'lemon'].includes(ingredient.id)) veg += grams;
  }
  return total > 0 ? veg / total : 0;
}

/** Calories visees par portion en mode « léger » quand aucun programme n'est actif. */
const LIGHT_KCAL = { breakfast: 350, morning_snack: 150, lunch: 500, snack: 150, dinner: 450 };

/**
 * La recette respecte-t-elle les criteres stricts ?
 * @param {Recipe} recipe
 * @param {Constraints} c
 * @param {ScoringContext} ctx
 * @returns {boolean}
 */
export function isEligible(recipe, c, ctx) {
  if (recipe.status !== 'validated' || c.excludeRecipeIds.has(recipe.id)) return false;
  if (c.slot && !fitsSlot(recipe, c.slot)) return false;
  if (c.maxMinutes !== null && totalMinutes(recipe) > c.maxMinutes) return false;
  if (c.cuisine && recipe.cuisine !== c.cuisine) return false;
  if (c.cuisines && !c.cuisines.has(recipe.cuisine)) return false;
  if (c.avoid.some((t) => recipeContains(recipe, t, ctx))) return false;
  if (c.include.length && !c.include.some((t) => recipeContains(recipe, t, ctx))) return false;
  if (c.compatibleIds ? !c.compatibleIds.has(recipe.id) : evaluateRecipeForHousehold(recipe, ctx.household, ctx).status !== 'compatible') return false;
  if (ctx.availability && !isFeasibleLocally(recipe, ctx.preparations, ctx.availability, substitutesFor)) return false;
  if (c.maxCostIndex !== null) {
    const cost = recipeCost(recipe, ctx);
    if (cost.index > c.maxCostIndex * 1.02) return false;
  }
  return true;
}

/**
 * Note d'une recette (plus haut = mieux) et raisons lisibles.
 * @param {Recipe} recipe
 * @param {Weights} weights
 * @param {{ slot: Slot | null, medianCostIndex: number, maxMinutes: number | null, weekCuisines: string[], weekRecipeIds: string[], weekIngredients: Set<string>, batchAge?: number | null }} env
 *   batchAge : jours entre la seance de batch et ce repas (null : pas de seance avant)
 * @param {ScoringContext} ctx
 * @returns {{ score: number, reasons: string[] }}
 */
export function scoreRecipe(recipe, weights, env, ctx) {
  let score = 0;
  /** @type {string[]} */
  const reasons = [];
  /** @param {Mode} m */
  const w = (m) => weights[m] ?? 0;

  // Ingredients souvent introuvables en Guyane : la recette passe apres les autres.
  if (ctx.availability) score -= 5 * rareCount(recipe, ctx.preparations, ctx.availability);

  if (w('gourmand')) {
    const g = hasTag(recipe, 'gourmand') ? 1 : hasTag(recipe, 'convivial') ? 0.5 : 0;
    score += 10 * w('gourmand') * g;
    if (g >= 1) reasons.push('recette gourmande');
  }
  if (w('economy')) {
    const cost = recipeCost(recipe, ctx);
    const rel = env.medianCostIndex > 0 ? 1 - Math.min(2, cost.index / env.medianCostIndex) / 2 : 0.5;
    score += 10 * w('economy') * (rel + (hasTag(recipe, 'budget') ? 0.3 : 0));
    if (rel > 0.55 || hasTag(recipe, 'budget')) reasons.push('ingrédients plutôt économiques');
  }
  if (w('promotions') && ctx.promoIngredients.size) {
    const ids = allIngredientIds(recipe, ctx.preparations);
    const promo = ids.filter((id) => ctx.promoIngredients.has(id));
    score += 10 * w('promotions') * Math.min(1, promo.length / 2);
    if (promo.length) reasons.push(`${promo.length} ingrédient(s) en promotion vérifiée`);
  }
  if (w('vegetables') || w('balance')) {
    const share = vegetableShare(recipe, ctx);
    score += 10 * (w('vegetables') * 1.5 + w('balance')) * share;
    if (share >= 0.35) reasons.push('riche en légumes');
  }
  if (w('balance')) {
    if (!env.weekCuisines.includes(recipe.cuisine)) {
      score += 3 * w('balance');
      reasons.push('apporte de la variété');
    }
  }
  if (w('quick')) {
    const max = env.maxMinutes ?? 30;
    const minutes = totalMinutes(recipe);
    score += 10 * w('quick') * Math.max(0, 1 - minutes / (max * 2));
    if (minutes <= max) reasons.push(`prête en ${minutes} minutes`);
  }
  // Produits du stock a consommer vite : toujours un petit bonus, plus fort en mode anti-gaspillage.
  if (ctx.expiringIngredients?.size) {
    const used = allIngredientIds(recipe, ctx.preparations).filter((id) => ctx.expiringIngredients?.has(id));
    if (used.length) {
      score += Math.min(2, used.length) * (3 + 5 * w('antiwaste'));
      reasons.push(`utilise ${used.map((id) => ctx.ingredients.get(id)?.name ?? id).join(', ')} à consommer vite`);
    }
  }
  // Produits de saison et locaux : petit bonus permanent, fort quand la cliente le demande.
  if (ctx.seasonalIngredients?.size) {
    const local = allIngredientIds(recipe, ctx.preparations).filter((id) => ctx.seasonalIngredients?.has(id));
    score += Math.min(3, local.length) * (1 + 4 * w('seasonal'));
    if (local.length >= 2 && (w('seasonal') || local.length >= 3)) reasons.push('produits de saison ou péyi');
  }
  if (w('antiwaste')) {
    const ids = allIngredientIds(recipe, ctx.preparations).filter((id) => !ctx.ingredients.get(id)?.notPurchased);
    const reuse = ids.filter((id) => ctx.stockIngredients.has(id) || env.weekIngredients.has(id));
    score += 10 * w('antiwaste') * (ids.length ? reuse.length / ids.length : 0);
    if (reuse.length >= 3) reasons.push('réutilise des ingrédients déjà prévus ou en stock');
  }
  if (w('light')) {
    const n = ctx.nutritionByRecipe.get(recipe.id);
    const target = env.slot ? ctx.programTargets?.[env.slot] : undefined;
    if (n && target) {
      const fit = programFitScore(n, target);
      score += 10 * w('light') * Math.max(0, fit) / 80;
      if (fit > 40) reasons.push('adaptée à votre programme (portions et protéines)');
    } else if (n) {
      // Sans programme : une portion raisonnable pour le repas, ni trop riche ni trop maigre.
      const aim = LIGHT_KCAL[/** @type {Slot} */ (env.slot ?? 'lunch')];
      score += 10 * w('light') * Math.max(0, 1 - Math.abs(n.kcal - aim) / aim);
      if (Math.abs(n.kcal - aim) <= aim * 0.25) reasons.push(`environ ${Math.round(n.kcal)} kcal la portion`);
    }
    if (hasTag(recipe, 'light')) score += 3 * w('light');
  }
  if (w('protein')) {
    const n = ctx.nutritionByRecipe.get(recipe.id);
    const share = n && n.kcal > 0 ? (n.protein * 4) / n.kcal : 0;
    score += 10 * w('protein') * Math.min(share, 0.35) / 0.35;
    if (share >= 0.25) reasons.push('riche en protéines');
  }
  if (w('few_dishes') && recipe.vessel) {
    score += 8 * w('few_dishes');
    reasons.push('un seul récipient');
  }
  // Batch cooking : le plat doit se garder jusqu'au jour du repas (refrigerateur ou congelateur).
  let batchReady = false;
  const keeping = ctx.keepingOf?.get(recipe.id);
  const age = env.batchAge ?? null;
  if (w('batch') && keeping && age !== null && env.slot !== 'breakfast') {
    if (!keeping.batch) score -= 15 * w('batch');
    else if (age <= keeping.fridgeDays) {
      batchReady = true;
      score += 8 * w('batch');
      reasons.push(`se garde ${keeping.fridgeDays} jours au réfrigérateur`);
    } else if (keeping.freezes) {
      batchReady = true;
      score += 5 * w('batch');
      reasons.push('se congèle : à sortir du congélateur la veille');
    } else score -= 12 * w('batch');
  }
  // Variete : chaque repetition dans la semaine coute de plus en plus cher.
  // En batch cooking, cuisiner un plat en double (deux repas) est le principe : la premiere repetition est offerte.
  const repeats = env.weekRecipeIds.filter((id) => id === recipe.id).length;
  const counted = batchReady ? Math.max(0, repeats - 1) : repeats;
  score -= 8 * counted * (counted + 1) / 2;
  return { score: Math.round(score * 100) / 100, reasons };
}

/**
 * Petite valeur stable (0 a 0,5) pour departager deux recettes sans hasard.
 * @param {string} text
 * @returns {number}
 */
export function tieBreak(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 2000;
}
