/**
 * Propositions de modification du planning : operations autorisees, application
 * controlee (memes regles que la saisie a la main) et comparaison avant / apres.
 * Le modele IA ne peut agir QUE par ces operations ; rien n'est enregistre sans
 * l'accord du client.
 */
import { validateMeal, plannedEntries, slotKey, mealPortionsFor, SLOTS } from '../planning/planning.js';
import { addDays } from '../planning/dates.js';
import { applySubstitutions, recipeMealTypes } from '../recipes/recipes.js';
import { evaluateRecipeForHousehold } from '../household/compatibility.js';
import { aggregateNeeds, mealNeedLines } from '../shopping/shopping.js';

/** @typedef {import('../planning/planning.js').Meal} Meal */
/** @typedef {import('../planning/planning.js').Slot} Slot */
/** @typedef {import('../household/household.js').Household} Household */
/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */
/** @typedef {import('../drive/drive.js').DriveProduct} DriveProduct */
/** @typedef {import('../shopping/shopping.js').Need} Need */

/**
 * Operations que l'assistant peut proposer.
 * @typedef {{ type: 'replace_recipe', mealId: string, recipeId: string, reason: string }
 *   | { type: 'add_meal', date: string, slot: Slot, recipeId: string, guests: number, reason: string }
 *   | { type: 'remove_meal', mealId: string, reason: string }
 *   | { type: 'set_guests', mealId: string, guests: number, reason: string }
 *   | { type: 'substitute', mealId: string, from: string, to: string, reason: string }
 *   | { type: 'set_next_lunch', mealId: string, reason: string }
 *   | { type: 'set_weekly_budget', cents: number, reason: string }
 *   | { type: 'choose_product', ingredientId: string, productId: string, reason: string }} Operation
 */

/** @type {Operation['type'][]} */
export const OPERATION_TYPES = ['replace_recipe', 'add_meal', 'remove_meal', 'set_guests', 'substitute', 'set_next_lunch', 'set_weekly_budget', 'choose_product'];

/**
 * Etat modifiable par une proposition.
 * @typedef {Object} PlanState
 * @property {Meal[]} meals
 * @property {number | null} weeklyBudgetCents
 * @property {Record<string, string>} preferredProducts   ingredient -> reference Drive
 */

/**
 * @typedef {Object} ApplyContext
 * @property {Household} household
 * @property {Map<string, Recipe>} recipes
 * @property {Map<string, Ingredient>} ingredients
 * @property {Map<string, Preparation>} preparations
 * @property {Map<string, DriveProduct[]>} productsByIngredient
 * @property {() => string} newId
 */

/**
 * @typedef {Object} Proposal
 * @property {string} id
 * @property {string} week
 * @property {string} summary
 * @property {Operation[]} operations
 * @property {string[]} notes          Limites, compromis, conflits a expliquer
 * @property {'ai' | 'engine'} author  Qui a compose la proposition
 * @property {'pending' | 'accepted' | 'rejected' | 'expired'} status
 * @property {string} createdAt
 */

/**
 * Applique les operations a une copie de l'etat, une par une, avec les memes
 * controles que la saisie manuelle. Une operation refusee est expliquee ; les
 * autres restent applicables.
 * @param {PlanState} state
 * @param {Operation[]} operations
 * @param {ApplyContext} ctx
 * @returns {{ state: PlanState, applied: Operation[], errors: string[] }}
 */
export function applyOperations(state, operations, ctx) {
  let meals = state.meals.map((m) => structuredClone(m));
  let weeklyBudgetCents = state.weeklyBudgetCents;
  const preferredProducts = { ...state.preferredProducts };
  /** @type {Operation[]} */
  const applied = [];
  /** @type {string[]} */
  const errors = [];
  const recipeIds = new Set(ctx.recipes.keys());

  /** @param {Recipe} recipe @param {string} label */
  const compatible = (recipe, label) => {
    const fit = evaluateRecipeForHousehold(recipe, ctx.household, ctx);
    if (fit.status !== 'compatible') errors.push(`${label} : « ${recipe.name} » ne convient pas à tout le foyer (allergie, régime ou matériel).`);
    return fit.status === 'compatible';
  };
  /** @param {string} id */
  const findMeal = (id) => meals.find((m) => m.id === id);
  /** @param {Meal} meal */
  const label = (meal) => `${meal.recipeName} (${meal.date}, ${SLOTS.find((s) => s.id === meal.slot)?.label.toLowerCase() ?? meal.slot})`;
  /** @param {Meal} next @param {string} what */
  const commit = (next, what) => {
    const problems = validateMeal(next, meals, ctx.household, recipeIds);
    if (problems.length) {
      errors.push(`${what} : ${problems.join(' ')}`);
      return false;
    }
    meals = meals.some((m) => m.id === next.id) ? meals.map((m) => (m.id === next.id ? next : m)) : [...meals, next];
    return true;
  };

  for (const op of operations) {
    switch (op.type) {
      case 'replace_recipe': {
        const meal = findMeal(op.mealId);
        const recipe = ctx.recipes.get(op.recipeId);
        if (!meal) errors.push('Remplacement : repas introuvable.');
        else if (meal.locked) errors.push(`${label(meal)} est verrouillé : il n’est pas modifié.`);
        else if (!recipe) errors.push(`Recette inconnue : ${op.recipeId}.`);
        else if (compatible(recipe, label(meal)) && commit({ ...meal, recipeId: recipe.id, recipeName: recipe.name, substitutions: [] }, label(meal))) applied.push(op);
        break;
      }
      case 'add_meal': {
        const recipe = ctx.recipes.get(op.recipeId);
        if (!recipe) errors.push(`Recette inconnue : ${op.recipeId}.`);
        else if (!Number.isInteger(op.guests) || op.guests < 0) errors.push('Nombre d’invités invalide.');
        else if (compatible(recipe, `Nouveau repas du ${op.date}`)) {
          /** @type {Meal} */
          const meal = {
            id: ctx.newId(),
            date: op.date,
            slot: op.slot,
            recipeId: recipe.id,
            recipeName: recipe.name,
            attendees: ctx.household.members.map((m) => m.id),
            guests: op.guests,
            nextLunch: null,
            locked: false,
          };
          if (commit(meal, `Nouveau repas du ${op.date}`)) applied.push(op);
        }
        break;
      }
      case 'remove_meal': {
        const meal = findMeal(op.mealId);
        if (!meal) errors.push('Retrait : repas introuvable.');
        else if (meal.locked) errors.push(`${label(meal)} est verrouillé : il n’est pas retiré.`);
        else {
          meals = meals.filter((m) => m.id !== op.mealId);
          applied.push(op);
        }
        break;
      }
      case 'set_guests': {
        const meal = findMeal(op.mealId);
        if (!meal) errors.push('Invités : repas introuvable.');
        else if (meal.locked) errors.push(`${label(meal)} est verrouillé : le nombre d’invités n’est pas modifié.`);
        else if (!Number.isInteger(op.guests) || op.guests < 0 || op.guests > 30) errors.push('Nombre d’invités invalide (0 à 30).');
        else if (commit({ ...meal, guests: op.guests }, label(meal))) applied.push(op);
        break;
      }
      case 'substitute': {
        const meal = findMeal(op.mealId);
        const recipe = meal ? ctx.recipes.get(meal.recipeId) : undefined;
        if (!meal || !recipe) errors.push('Remplacement d’ingrédient : repas introuvable.');
        else if (meal.locked) errors.push(`${label(meal)} est verrouillé : il n’est pas modifié.`);
        else if (!ctx.ingredients.has(op.to)) errors.push(`Ingrédient inconnu : ${op.to}.`);
        else if (!recipe.ingredients.some((l) => l.ingredientId === op.from)) errors.push(`« ${recipe.name} » ne contient pas cet ingrédient.`);
        else {
          const substitutions = [...(meal.substitutions ?? []).filter((s) => s.from !== op.from), { from: op.from, to: op.to }];
          if (compatible(applySubstitutions(recipe, substitutions), label(meal)) && commit({ ...meal, substitutions }, label(meal))) applied.push(op);
        }
        break;
      }
      case 'set_next_lunch': {
        const meal = findMeal(op.mealId);
        if (!meal) errors.push('Restes : repas introuvable.');
        else if (meal.locked) errors.push(`${label(meal)} est verrouillé : il n’est pas modifié.`);
        else if (meal.slot !== 'dinner') errors.push('Seul un dîner peut servir au déjeuner du lendemain.');
        else if (commit({ ...meal, nextLunch: { attendees: ctx.household.members.map((m) => m.id), guests: 0 } }, label(meal))) applied.push(op);
        break;
      }
      case 'set_weekly_budget':
        if (!Number.isInteger(op.cents) || op.cents < 0) errors.push('Budget invalide.');
        else {
          weeklyBudgetCents = op.cents;
          applied.push(op);
        }
        break;
      case 'choose_product': {
        const product = (ctx.productsByIngredient.get(op.ingredientId) ?? []).find((p) => p.id === op.productId);
        if (!product) errors.push('Produit du Drive introuvable pour cet ingrédient.');
        else if (product.availability !== 'available') errors.push(`${product.name} n’est pas disponible.`);
        else {
          preferredProducts[op.ingredientId] = op.productId;
          applied.push(op);
        }
        break;
      }
      default:
        errors.push('Opération non autorisée.');
    }
  }
  return { state: { meals, weeklyBudgetCents, preferredProducts }, applied, errors };
}

/**
 * Verifie la forme d'operations venant du modele IA (avant toute application).
 * @param {unknown} value
 * @returns {{ ok: true, operations: Operation[] } | { ok: false, error: string }}
 */
export function parseOperations(value) {
  if (!Array.isArray(value)) return { ok: false, error: 'operations doit être une liste.' };
  /** @type {Operation[]} */
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Opération illisible.' };
    const o = /** @type {Record<string, unknown>} */ (raw);
    const str = (/** @type {string} */ k) => (typeof o[k] === 'string' ? /** @type {string} */ (o[k]) : '');
    const num = (/** @type {string} */ k) => (typeof o[k] === 'number' ? /** @type {number} */ (o[k]) : Number.NaN);
    const reason = str('reason') || 'Proposé par l’assistant.';
    switch (o.type) {
      case 'replace_recipe':
        out.push({ type: 'replace_recipe', mealId: str('mealId'), recipeId: str('recipeId'), reason });
        break;
      case 'add_meal': {
        const slot = str('slot');
        if (!SLOTS.some((s) => s.id === slot)) return { ok: false, error: `Créneau inconnu : ${slot}` };
        out.push({ type: 'add_meal', date: str('date'), slot: /** @type {Slot} */ (slot), recipeId: str('recipeId'), guests: Number.isNaN(num('guests')) ? 0 : num('guests'), reason });
        break;
      }
      case 'remove_meal':
        out.push({ type: 'remove_meal', mealId: str('mealId'), reason });
        break;
      case 'set_guests':
        out.push({ type: 'set_guests', mealId: str('mealId'), guests: num('guests'), reason });
        break;
      case 'substitute':
        out.push({ type: 'substitute', mealId: str('mealId'), from: str('fromIngredientId') || str('from'), to: str('toIngredientId') || str('to'), reason });
        break;
      case 'set_next_lunch':
        out.push({ type: 'set_next_lunch', mealId: str('mealId'), reason });
        break;
      case 'set_weekly_budget': {
        const euros = num('weeklyBudgetEuros');
        out.push({ type: 'set_weekly_budget', cents: Number.isNaN(euros) ? num('cents') : Math.round(euros * 100), reason });
        break;
      }
      case 'choose_product':
        out.push({ type: 'choose_product', ingredientId: str('ingredientId'), productId: str('productId'), reason });
        break;
      default:
        return { ok: false, error: `Type d’opération non autorisé : ${String(o.type)}` };
    }
  }
  return { ok: true, operations: out };
}

/**
 * @typedef {Object} PlanDiff
 * @property {{ date: string, slot: Slot, before: string | null, after: string | null, detail: string }[]} meals
 * @property {{ ingredientId: string, unit: string, before: number | null, after: number | null }[]} added
 * @property {{ ingredientId: string, unit: string, before: number | null, after: number | null }[]} removed
 * @property {{ ingredientId: string, unit: string, before: number | null, after: number | null }[]} changed
 * @property {{ before: number, after: number }} portions
 */

/**
 * Ce qui change entre deux plannings d'une semaine : repas, ingredients, portions.
 * @param {Meal[]} before
 * @param {Meal[]} after
 * @param {string[]} days
 * @param {ApplyContext} ctx
 * @returns {PlanDiff}
 */
export function planDiff(before, after, days, ctx) {
  const inWeek = new Set(days);
  const b = before.filter((m) => inWeek.has(m.date));
  const a = after.filter((m) => inWeek.has(m.date));
  /** @type {PlanDiff['meals']} */
  const meals = [];
  const keys = new Set([...b, ...a].map((m) => slotKey(m.date, m.slot)));
  const byKey = (/** @type {Meal[]} */ list) => new Map(list.map((m) => [slotKey(m.date, m.slot), m]));
  const bk = byKey(b);
  const ak = byKey(a);
  for (const key of [...keys].sort()) {
    const x = bk.get(key);
    const y = ak.get(key);
    if (x && y && JSON.stringify(x) === JSON.stringify(y)) continue;
    const [date, slot] = /** @type {[string, Slot]} */ (key.split('|'));
    /** @type {string[]} */
    const detail = [];
    if (x && y && x.recipeId === y.recipeId) {
      if (x.guests !== y.guests) detail.push(`invités : ${x.guests} → ${y.guests}`);
      if (JSON.stringify(x.substitutions ?? []) !== JSON.stringify(y.substitutions ?? [])) {
        for (const s of y.substitutions ?? []) detail.push(`${ctx.ingredients.get(s.from)?.name ?? s.from} → ${ctx.ingredients.get(s.to)?.name ?? s.to}`);
      }
      if (Boolean(x.nextLunch) !== Boolean(y.nextLunch)) detail.push(y.nextLunch ? `cuisiné aussi pour le déjeuner du ${addDays(date, 1)}` : 'plus de restes pour le lendemain');
    }
    meals.push({ date, slot, before: x?.recipeName ?? null, after: y?.recipeName ?? null, detail: detail.join(', ') });
  }
  const needs = (/** @type {Meal[]} */ list) => aggregateNeeds(mealNeedLines(list, ctx.household, ctx.recipes, ctx.preparations), ctx.ingredients);
  const nb = new Map(needs(b).map((n) => [n.key, n]));
  const na = new Map(needs(a).map((n) => [n.key, n]));
  /** @type {PlanDiff['added']} */ const added = [];
  /** @type {PlanDiff['removed']} */ const removed = [];
  /** @type {PlanDiff['changed']} */ const changed = [];
  for (const [key, n] of na) {
    const old = nb.get(key);
    if (!old) added.push({ ingredientId: n.ingredientId, unit: n.unit, before: null, after: n.quantity });
    else if (old.quantity !== n.quantity && old.quantity !== null && n.quantity !== null && Math.abs(old.quantity - n.quantity) / old.quantity > 0.02) {
      changed.push({ ingredientId: n.ingredientId, unit: n.unit, before: old.quantity, after: n.quantity });
    }
  }
  for (const [key, n] of nb) if (!na.has(key)) removed.push({ ingredientId: n.ingredientId, unit: n.unit, before: n.quantity, after: null });
  const portions = (/** @type {Meal[]} */ list) => list.reduce((s, m) => s + mealPortionsFor(m, ctx.household).total, 0);
  return { meals, added, removed, changed, portions: { before: portions(b), after: portions(a) } };
}

/**
 * Repas du planning qui ne correspondent plus a leur creneau (ex. une recette de gouter au diner).
 * @param {Meal[]} meals
 * @param {Map<string, Recipe>} recipes
 * @returns {Meal[]}
 */
export function mismatchedSlots(meals, recipes) {
  return meals.filter((m) => {
    const r = recipes.get(m.recipeId);
    return r ? !recipeMealTypes(r).includes(m.slot) : false;
  });
}

/**
 * Cases libres d'une semaine pour des creneaux donnes (restes du lendemain compris).
 * @param {Meal[]} meals
 * @param {string[]} days
 * @param {Slot[]} slots
 * @returns {{ date: string, slot: Slot }[]}
 */
export function freeSlots(meals, days, slots) {
  const entries = plannedEntries(meals);
  /** @type {{ date: string, slot: Slot }[]} */
  const out = [];
  for (const date of days) for (const slot of slots) if (!entries.has(slotKey(date, slot))) out.push({ date, slot });
  return out;
}
