/**
 * Ajuster les courses de la semaine au budget, avec les prix reels (conditionnements, promotions, stock) :
 * 1. passer aux produits les moins chers pour la quantite achetee (a prix egal, marques U et Prix Mini) ;
 * 2. si cela ne suffit pas, remplacer les repas qui coutent le plus par des recettes economiques
 *    (legumineuses, oeufs...), un par un, jusqu'a passer sous le budget.
 * Un remplacement n'est retenu que s'il ne fait pas apparaitre d'article sans prix :
 * une recette ne doit jamais sembler moins chere parce qu'on ignore le prix de ses ingredients.
 * Le resultat est une PROPOSITION : rien n'est applique sans validation.
 */
import { formatCents } from '../budget/money.js';

/** @typedef {import('../planning/planning.js').Meal} Meal */
/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../drive/quote.js').Quote} Quote */
/** @typedef {import('../drive/drive.js').ProductPreference} ProductPreference */
/** @typedef {import('./proposal.js').Operation} Operation */

/** Ingredients des plats economiques : legumineuses, oeufs, tofu. */
export const THRIFTY_PROTEINS = new Set([
  'lentils_green',
  'red_lentils',
  'chickpeas_cooked',
  'black_beans_cooked',
  'red_beans_cooked',
  'white_beans_cooked',
  'edamame',
  'tofu',
  'silken_tofu',
  'egg',
]);

/** Nombre maximal de repas remplaces en une proposition. */
export const MAX_REPLACEMENTS = 7;
/** Repas les plus chers examines a chaque etape, et recettes essayees pour chacun. */
const MEALS_PER_ROUND = 4;
const CANDIDATES_PER_MEAL = 8;

/**
 * @typedef {Object} FitInput
 * @property {Meal[]} meals                      Tout le planning
 * @property {string[]} days                     Jours de la semaine
 * @property {string} today
 * @property {number} budgetCents
 * @property {Map<string, string>} preferred     Produits deja choisis par le client (ingredient -> reference)
 * @property {ProductPreference} preference      Reglage de choix des produits
 * @property {(meals: Meal[], preferred: Map<string, string>, preference: ProductPreference) => Quote} quote
 *   Chiffrage reel de la semaine
 * @property {(meal: Meal, excludeRecipeIds: Set<string>) => Recipe[]} candidates
 *   Recettes de remplacement possibles pour ce repas (foyer, type de repas...), les plus economiques d'abord
 * @property {Map<string, Recipe>} recipesById
 * @property {(ingredientId: string) => string} [nameOf]   Nom d'un ingredient, pour les explications
 * @property {(recipe: Recipe) => import('../planning/planning.js').Substitution[]} [autoSubstitutions]
 *   Alternatives appliquees aux ingredients introuvables (comme lors de l'application)
 */

/**
 * @typedef {Object} FitResult
 * @property {Operation[]} operations
 * @property {Quote} before
 * @property {Quote} after
 * @property {boolean} reached
 * @property {string[]} notes
 */

/**
 * @param {Meal[]} meals
 * @param {string} mealId
 * @param {Recipe} recipe
 * @param {FitInput['autoSubstitutions']} autoSubs
 * @returns {Meal[]}
 */
function withRecipe(meals, mealId, recipe, autoSubs) {
  return meals.map((m) => (m.id === mealId ? { ...m, recipeId: recipe.id, recipeName: recipe.name, substitutions: autoSubs?.(recipe) ?? [] } : m));
}

/**
 * Propose les changements qui font passer les courses sous le budget.
 * @param {FitInput} input
 * @returns {FitResult}
 */
export function fitToBudget(input) {
  const { budgetCents } = input;
  const before = input.quote(input.meals, input.preferred, input.preference);
  /** @type {string[]} */
  const notes = [];
  if (before.missing.length) {
    notes.push(`${before.missing.length} article(s) sans prix connu ne sont pas comptés : le total réel sera plus élevé. Relevez leur prix pour un calcul complet.`);
  }
  if (before.totalCents <= budgetCents) {
    notes.unshift(`Les courses de la semaine (${formatCents(before.totalCents)}) tiennent déjà dans le budget de ${formatCents(budgetCents)}.`);
    return { operations: [], before, after: before, reached: true, notes };
  }

  // 1. Produits moins chers pour la meme quantite
  /** @type {Operation[]} */
  const operations = [];
  const preferred = new Map(input.preferred);
  const cheapest = input.quote(input.meals, new Map(), 'cheapest');
  for (const line of cheapest.lines) {
    const current = before.lines.find((l) => l.key === line.key);
    if (!current || !line.productId || line.cents === null || current.cents === null) continue;
    if (line.productId === current.productId || line.cents >= current.cents) continue;
    preferred.set(line.ingredientId, line.productId);
    operations.push({
      type: 'choose_product',
      ingredientId: line.ingredientId,
      productId: line.productId,
      reason: `${line.productName} : ${formatCents(line.cents)} au lieu de ${formatCents(current.cents)}${current.productName ? ` (${current.productName})` : ''}.`,
    });
  }
  let meals = input.meals;
  let quote = input.quote(meals, preferred, input.preference);

  // 2. Repas remplaces, les plus couteux d'abord
  const days = new Set(input.days);
  const nameOf = input.nameOf ?? ((/** @type {string} */ id) => id);
  /** @type {Set<string>} */
  const replaced = new Set();
  /** Ingredients sans prix qui ont empeche de comparer des recettes moins cheres. */
  /** @type {Set<string>} */
  const blockedBy = new Set();
  while (quote.totalCents > budgetCents && replaced.size < MAX_REPLACEMENTS) {
    const movable = meals.filter((m) => days.has(m.date) && m.date >= input.today && !m.locked && !replaced.has(m.id) && input.recipesById.has(m.recipeId));
    const marginal = movable
      .map((m) => ({ meal: m, cents: quote.totalCents - input.quote(meals.filter((x) => x.id !== m.id), preferred, input.preference).totalCents }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => b.cents - a.cents)
      .slice(0, MEALS_PER_ROUND);
    const weekRecipeIds = new Set(meals.filter((m) => days.has(m.date)).map((m) => m.recipeId));
    /** @type {{ meal: Meal, recipe: Recipe, quote: Quote } | null} */
    let best = null;
    for (const { meal } of marginal) {
      for (const recipe of input.candidates(meal, weekRecipeIds).slice(0, CANDIDATES_PER_MEAL)) {
        const q = input.quote(withRecipe(meals, meal.id, recipe, input.autoSubstitutions), preferred, input.preference);
        // Aucun nouvel article sans prix : sinon la baisse viendrait d'un prix ignore.
        const unpriced = q.missing.filter((id) => !quote.missing.includes(id));
        if (unpriced.length) {
          for (const id of unpriced) blockedBy.add(id);
          continue;
        }
        if (q.totalCents < quote.totalCents && (!best || q.totalCents < best.quote.totalCents)) best = { meal, recipe, quote: q };
      }
    }
    if (!best) break;
    const saving = quote.totalCents - best.quote.totalCents;
    const thrifty = best.recipe.ingredients.some((l) => THRIFTY_PROTEINS.has(l.ingredientId));
    operations.push({
      type: 'replace_recipe',
      mealId: best.meal.id,
      recipeId: best.recipe.id,
      reason: `${best.recipe.name} à la place de ${best.meal.recipeName}${thrifty ? ' (plat à base de légumineuses ou d’œufs)' : ''} : ${formatCents(saving)} de moins sur les courses.`,
    });
    meals = withRecipe(meals, best.meal.id, best.recipe, input.autoSubstitutions);
    quote = best.quote;
    replaced.add(best.meal.id);
  }

  const reached = quote.totalCents <= budgetCents;
  if (!reached && blockedBy.size) {
    const names = [...blockedBy].slice(0, 6).map(nameOf);
    notes.push(`Des recettes moins chères n’ont pas pu être comparées car il manque le prix de certains de leurs ingrédients (${names.join(', ')}${blockedBy.size > 6 ? '…' : ''}). Relevez ces prix pour que je puisse les proposer.`);
  }
  notes.unshift(
    reached
      ? `Courses ramenées de ${formatCents(before.totalCents)} à ${formatCents(quote.totalCents)} pour un budget de ${formatCents(budgetCents)}.`
      : `Au mieux ${formatCents(quote.totalCents)}, soit ${formatCents(quote.totalCents - budgetCents)} au-dessus du budget de ${formatCents(budgetCents)}. Pistes : relever des prix moins chers ailleurs, utiliser le stock, réduire les invités ou ajuster le budget.`,
  );
  return { operations, before, after: quote, reached, notes };
}

/**
 * Classe les recettes de remplacement : les moins cheres d'abord, a cout proche les plats
 * a base de legumineuses ou d'oeufs.
 * @param {Recipe[]} recipes
 * @param {(recipe: Recipe) => number} costIndex
 * @returns {Recipe[]}
 */
export function rankThrifty(recipes, costIndex) {
  /** @param {Recipe} r */
  const score = (r) => costIndex(r) * (r.ingredients.some((l) => THRIFTY_PROTEINS.has(l.ingredientId)) ? 0.85 : 1);
  return [...recipes].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}
