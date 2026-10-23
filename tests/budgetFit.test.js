import { test, assertEqual } from './runner.js';
import { fitToBudget, rankThrifty } from '../src/domain/assistant/budgetFit.js';

/** @typedef {import('../src/domain/planning/planning.js').Meal} Meal */
/** @typedef {import('../src/domain/recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../src/domain/drive/quote.js').Quote} Quote */
/** @typedef {import('../src/domain/drive/quote.js').QuoteLine} QuoteLine */

/** @param {string} id @param {string[]} [ingredientIds] @returns {Recipe} */
const recipe = (id, ingredientIds = []) => /** @type {Recipe} */ (/** @type {unknown} */ ({ id, name: id, ingredients: ingredientIds.map((i) => ({ ingredientId: i, quantity: 100, unit: 'g', note: '' })) }));
/** @param {string} id @param {string} date @param {string} recipeId @param {boolean} [locked] @returns {Meal} */
const meal = (id, date, recipeId, locked = false) => ({ id, date, slot: 'dinner', recipeId, recipeName: recipeId, attendees: [], guests: 0, nextLunch: null, locked });

/** Prix d'un repas (en centimes) ; les recettes "inconnu" ont un ingredient sans prix. */
const PRICES = { boeuf: 1500, saumon: 1400, poulet: 900, lentilles: 300, omelette: 350, inconnu: 100, pates: 500 };
/** Repas a plusieurs lignes : "mixte" a un ingredient sans prix (safran), "mystere" un autre (truffe). */
/** @type {Record<string, [string, number | null][]>} */
const SPLIT = { mixte: [['viande', 1200], ['safran', null]], mystere: [['truffe', null]] };
const recipes = Object.keys(PRICES).map((id) => recipe(id, id === 'lentilles' ? ['red_lentils'] : id === 'omelette' ? ['egg'] : []));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

/**
 * Chiffrage factice : chaque repas = une ligne ; plus le riz du Drive (3 € en marque nationale,
 * 1,50 € en Prix Mini si choisi ou si l'on demande le moins cher).
 * @param {Meal[]} meals
 * @param {Map<string, string>} preferred
 * @param {string} preference
 * @returns {Quote}
 */
const quote = (meals, preferred, preference) => {
  const week = meals.filter((m) => m.date >= '2026-10-26' && m.date <= '2026-11-01');
  /** @type {QuoteLine[]} */
  /** @type {[string, number | null][]} */
  const parts = week.flatMap((m) => SPLIT[m.recipeId]
    ?? /** @type {[string, number | null][]} */ ([[m.recipeId, m.recipeId === 'inconnu' ? null : PRICES[/** @type {keyof typeof PRICES} */ (m.recipeId)]]]));
  /** @type {QuoteLine[]} */
  const lines = parts.map(([ingredientId, cents], i) => ({
    key: `${ingredientId}-${i}`, ingredientId, kind: cents === null ? 'missing' : 'manual',
    cents, savingCents: 0, productId: null, productName: null, count: 1, promoLabel: null, promoNote: null, checkedAt: null,
  }));
  const mini = preferred.get('rice_white') === 'mini' || (preference === 'cheapest' && !preferred.has('rice_white'));
  lines.push({ key: 'rice', ingredientId: 'rice_white', kind: 'drive_verified', cents: mini ? 150 : 300, savingCents: 0, productId: mini ? 'mini' : 'national', productName: mini ? 'Riz Prix Mini' : 'Riz Taureau', count: 1, promoLabel: null, promoNote: null, checkedAt: null });
  const priced = lines.filter((l) => l.cents !== null);
  return {
    lines,
    totalCents: priced.reduce((s, l) => s + /** @type {number} */ (l.cents), 0),
    verifiedCents: 0,
    savingCents: 0,
    missing: lines.filter((l) => l.cents === null).map((l) => l.ingredientId),
    complete: priced.length === lines.length,
    allVerified: false,
  };
};

const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
const meals = [meal('m1', '2026-10-26', 'boeuf'), meal('m2', '2026-10-27', 'saumon'), meal('m3', '2026-10-28', 'poulet')];
/** Candidats : toutes les recettes absentes de la semaine, les moins cheres d'abord. */
const candidates = (/** @type {Meal} */ _m, /** @type {Set<string>} */ exclude) =>
  rankThrifty(recipes.filter((r) => !exclude.has(r.id)), (r) => PRICES[/** @type {keyof typeof PRICES} */ (r.id)]);
/** @param {Partial<import('../src/domain/assistant/budgetFit.js').FitInput>} f */
const input = (f) => ({ meals, days, today: '2026-10-23', budgetCents: 10000, preferred: new Map(), preference: /** @type {const} */ ('quality'), quote, candidates, recipesById, ...f });

test('Budget : déjà respecté, rien à changer', () => {
  const r = fitToBudget(input({}));
  assertEqual([r.operations.length, r.reached, r.after.totalCents], [0, true, 4100]);
});

test('Budget : un produit moins cher suffit (riz Prix Mini), aucun repas changé', () => {
  const r = fitToBudget(input({ budgetCents: 3950 }));
  assertEqual([r.operations.map((o) => o.type), r.after.totalCents, r.reached], [['choose_product'], 3950, true]);
});

test('Budget : le repas le plus cher est remplacé par un plat économique (lentilles)', () => {
  const r = fitToBudget(input({ budgetCents: 3000 }));
  const replaced = r.operations.filter((o) => o.type === 'replace_recipe');
  assertEqual([replaced.length, replaced[0]?.type === 'replace_recipe' && replaced[0].mealId, replaced[0]?.type === 'replace_recipe' && replaced[0].recipeId, r.after.totalCents, r.reached], [1, 'm1', 'lentilles', 2750, true]);
});

test('Budget : une recette sans prix connu n’est jamais choisie pour « faire baisser » le total', () => {
  const r = fitToBudget(input({ budgetCents: 1000 }));
  assertEqual(r.operations.some((o) => o.type === 'replace_recipe' && o.recipeId === 'inconnu'), false);
});

test('Budget : remplacer un article sans prix par un autre article sans prix est refusé', () => {
  const mysteryOnly = (/** @type {Meal} */ _m, /** @type {Set<string>} */ exclude) => [recipe('mystere')].filter((r) => !exclude.has(r.id));
  const byId = new Map([...recipesById, ['mixte', recipe('mixte')], ['mystere', recipe('mystere')]]);
  const r = fitToBudget(input({ budgetCents: 500, meals: [meal('m1', '2026-10-26', 'mixte')], candidates: mysteryOnly, recipesById: byId }));
  assertEqual([r.operations.filter((o) => o.type === 'replace_recipe').length, r.notes.some((n) => n.includes('truffe'))], [0, true]);
});

test('Budget : repas verrouillés et jours passés jamais modifiés', () => {
  const r = fitToBudget(input({ budgetCents: 1000, meals: [meal('m1', '2026-10-26', 'boeuf', true), ...meals.slice(1)], today: '2026-10-28' }));
  const touched = r.operations.flatMap((o) => (o.type === 'replace_recipe' ? [o.mealId] : []));
  assertEqual(touched, ['m3']);
});

test('Budget : objectif inatteignable, meilleur total proposé et signalé', () => {
  const r = fitToBudget(input({ budgetCents: 500 }));
  assertEqual([r.reached, r.notes[0].startsWith('Au mieux'), r.after.totalCents < r.before.totalCents], [false, true, true]);
});

test('Recettes économiques : à coût proche, légumineuses et œufs d’abord', () => {
  const list = rankThrifty([recipe('pates'), recipe('omelette', ['egg'])], (r) => (r.id === 'pates' ? 320 : 350));
  assertEqual(list.map((r) => r.id), ['omelette', 'pates']);
});
