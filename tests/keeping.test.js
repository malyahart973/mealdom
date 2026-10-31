import { test, assertEqual } from './runner.js';
import { recipeKeeping, preparationKeeping, batchSessionDates, storagePlan, sessionFor, daysBetween } from '../src/domain/batchCooking/keeping.js';
import { planBatchWeek, batchCalendarEvents } from '../src/domain/batchCooking/batchCooking.js';
import { scoreRecipe } from '../src/domain/assistant/scoring.js';
import { proposeChanges } from '../src/domain/assistant/engine.js';
import { applyOperations, parseOperations } from '../src/domain/assistant/proposal.js';
import { buildNutritionIndex } from '../src/domain/nutrition/nutrition.js';
import { CUISINES } from '../src/data/cuisines.js';
import { NUTRITION } from '../src/data/nutrition.js';
import { parseRequest, makeIngredientFinder } from '../src/domain/assistant/intent.js';
import { guidedRequest } from '../src/domain/assistant/guided.js';
import { recipeFamily } from '../src/domain/recipes/families.js';
import { buildNameIndex } from '../src/domain/ingredients/ingredients.js';
import { createDefaultHousehold, upsertMember } from '../src/domain/household/household.js';
import { DEFAULT_PORTION_RULES } from '../src/data/portionRules.js';
import { ALL_RECIPES } from '../src/data/allRecipes.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { PREPARATIONS } from '../src/data/preparations.js';

/** @typedef {import('../src/domain/planning/planning.js').Meal} Meal */
/** @typedef {import('../src/domain/recipes/recipes.js').Recipe} Recipe */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const recipes = new Map(ALL_RECIPES.map((r) => [r.id, r]));
const preparations = new Map(PREPARATIONS.map((p) => [p.id, p]));
const keepingOf = new Map(ALL_RECIPES.map((r) => [r.id, recipeKeeping(r, recipeFamily(r, ingredients), ingredients)]));
/** @param {string} id @returns {Recipe} */
const recipe = (id) => {
  const r = recipes.get(id);
  if (!r) throw new Error(id);
  return r;
};
/** @param {string} id */
const keepingFor = (id) => keepingOf.get(id) ?? (() => { throw new Error(id); })();

let household = createDefaultHousehold(DEFAULT_PORTION_RULES);
for (const id of ['A', 'B']) household = upsertMember(household, { id, name: id, category: 'adult', allergens: [], diet: null, dislikes: [] });
household = { ...household, equipment: ['stovetop', 'oven', 'pressure_cooker'] };

/** @param {string} id @param {string} date @param {string} recipeId @returns {Meal} */
const meal = (id, date, recipeId) => ({ id, date, slot: 'dinner', recipeId, recipeName: recipe(recipeId).name, attendees: ['A', 'B'], guests: 0, nextLunch: null, locked: false });

// --- Conservation ---
test('Conservation : colombo et chili se gardent 3 jours et se congèlent', () => {
  assertEqual([keepingFor('chicken_colombo'), keepingFor('chili_con_carne')].map((k) => [k.batch, k.fridgeDays, k.freezes]), [[true, 3, true], [true, 3, true]]);
});

test('Conservation : tacos à assembler le jour même ; pâtes 2 jours sans congélation', () => {
  assertEqual([keepingFor('shredded_chicken_tacos').batch, keepingFor('one_pot_pasta_tomato_basil').fridgeDays, keepingFor('one_pot_pasta_tomato_basil').freezes], [false, 2, false]);
});

test('Conservation : poisson et fruits de mer, jamais plus de 2 jours', () => {
  const seafood = ALL_RECIPES.filter((r) => r.ingredients.some((l) => (ingredients.get(l.ingredientId)?.categories ?? []).some((c) => c === 'fish' || c === 'shellfish')));
  assertEqual(seafood.length > 20 && seafood.every((r) => keepingFor(r.id).fridgeDays <= 2), true);
});

test('Conservation : une recette peut imposer la sienne', () => {
  const k = recipeKeeping({ ...recipe('shredded_chicken_tacos'), keeping: { fridgeDays: 2, freezes: true } }, 'street', ingredients);
  assertEqual([k.batch, k.fridgeDays, k.freezes], [true, 2, true]);
});

test('Conservation : riz cuit 2 jours, se congèle', () => {
  const k = preparationKeeping(/** @type {import('../src/domain/recipes/recipes.js').Preparation} */ (preparations.get('cooked_rice')));
  assertEqual([k.fridgeDays, k.freezes], [2, true]);
});

// --- Seances ---
test('Séances : dimanche avant la semaine, et mercredi en option', () => {
  assertEqual(batchSessionDates('2026-11-02', { day: 'sunday', midweek: false }, '2026-10-31'), ['2026-11-01']);
  assertEqual(batchSessionDates('2026-11-02', { day: 'sunday', midweek: true }, '2026-10-31'), ['2026-11-01', '2026-11-04']);
  assertEqual(batchSessionDates('2026-11-02', { day: 'saturday', midweek: false }, '2026-10-31'), ['2026-10-31']);
});

test('Séances : séance passée ramenée à aujourd’hui ; après mercredi, une seule', () => {
  assertEqual(batchSessionDates('2026-11-02', { day: 'sunday', midweek: false }, '2026-11-03'), ['2026-11-03']);
  assertEqual(batchSessionDates('2026-11-02', { day: 'sunday', midweek: true }, '2026-11-03'), ['2026-11-03', '2026-11-04']);
  assertEqual(batchSessionDates('2026-11-02', { day: 'sunday', midweek: true }, '2026-11-05'), ['2026-11-05']);
  assertEqual(batchSessionDates('2026-11-02', { day: 'sunday', midweek: false }, '2026-11-09'), []);
});

test('Séance d’un repas : la plus récente avant le jour du repas', () => {
  assertEqual(
    [sessionFor('2026-11-05', ['2026-11-01', '2026-11-04']), sessionFor('2026-11-04', ['2026-11-01', '2026-11-04']), sessionFor('2026-11-01', ['2026-11-01']), daysBetween('2026-10-30', '2026-11-02')],
    ['2026-11-04', '2026-11-01', null, 3],
  );
});

test('Conserver : réfrigérateur, congélateur (sortir la veille) ou jour même', () => {
  const colombo = keepingFor('chicken_colombo');
  assertEqual(storagePlan(colombo, '2026-11-01', '2026-11-04'), { storage: 'fridge', thawOn: null });
  assertEqual(storagePlan(colombo, '2026-11-01', '2026-11-06'), { storage: 'freezer', thawOn: '2026-11-05' });
  assertEqual(storagePlan(keepingFor('one_pot_pasta_tomato_basil'), '2026-11-01', '2026-11-04').storage, 'same_day');
  assertEqual(storagePlan(keepingFor('shredded_chicken_tacos'), '2026-11-01', '2026-11-01').storage, 'same_day');
});

// --- Semaine de batch ---
const week = [
  meal('m0', '2026-10-30', 'chicken_colombo'),
  meal('m1', '2026-11-02', 'chicken_colombo'),
  meal('m2', '2026-11-03', 'shredded_chicken_tacos'),
  meal('m3', '2026-11-05', 'one_pot_pasta_tomato_basil'),
  meal('m4', '2026-11-06', 'chili_con_carne'),
];
const ctx = { recipes, preparations, keepingOf };

test('Semaine de batch : plats cuisinés à la séance, congélation pour la fin de semaine', () => {
  const w = planBatchWeek(week, ['2026-11-01'], household, ctx);
  const s = w.sessions[0];
  assertEqual(
    [w.sessions.length, s.dishes.flatMap((d) => d.servings.map((sv) => [sv.meal.id, sv.storage, sv.thawOn, sv.portions])), w.sameDay.map((x) => x.meal.id)],
    [1, [['m1', 'fridge', null, 2], ['m4', 'freezer', '2026-11-05', 2]], ['m2', 'm3']],
  );
});

test('Semaine de batch : les bases servent aussi aux plats du jour même (poulet effiloché des tacos)', () => {
  const s = planBatchWeek(week, ['2026-11-01'], household, ctx).sessions[0];
  assertEqual(
    [s.requirements.map((r) => r.preparationId).sort(), s.session.tasks.filter((t) => t.kind === 'dish').length, s.session.tasks.some((t) => t.kind === 'preparation')],
    [['cooked_rice', 'shredded_chicken'], 2, true],
  );
});

test('Semaine de batch : avec la séance du mercredi, la fin de semaine reste au frais', () => {
  const w = planBatchWeek(week, ['2026-11-01', '2026-11-04'], household, ctx);
  assertEqual(
    w.sessions.map((s) => [s.date, s.dishes.flatMap((d) => d.servings.map((sv) => `${sv.meal.id}:${sv.storage}`))]),
    [['2026-11-01', ['m1:fridge']], ['2026-11-04', ['m3:fridge', 'm4:fridge']]],
  );
});

test('Semaine de batch : le même plat pour deux repas est cuisiné une seule fois', () => {
  const twice = [meal('a', '2026-11-02', 'chili_con_carne'), meal('b', '2026-11-03', 'chili_con_carne'), meal('c', '2026-11-06', 'chili_con_carne')];
  const s = planBatchWeek(twice, ['2026-11-01'], household, ctx).sessions[0];
  assertEqual(
    [s.dishes.length, s.dishes[0].portions, s.dishes[0].servings.map((sv) => sv.storage), s.session.tasks.filter((t) => t.kind === 'dish').map((t) => [t.quantity, t.uses])],
    [1, 6, ['fridge', 'fridge', 'freezer'], [[6, 3]]],
  );
});

test('Semaine de batch : chili sur l’autocuiseur pendant que le colombo cuit sur les plaques', () => {
  const s = planBatchWeek(week, ['2026-11-01'], household, ctx).sessions[0];
  const equipment = s.session.tasks.filter((t) => t.kind === 'dish').map((t) => t.method?.equipment[0]).sort();
  assertEqual(equipment, ['pressure_cooker', 'stovetop']);
});

test('Agenda : la séance, et un rappel la veille au soir pour décongeler', () => {
  const events = batchCalendarEvents(planBatchWeek(week, ['2026-11-01'], household, ctx), (m) => m.date);
  assertEqual(
    events.map((e) => [e.date, e.start, e.summary.split(' :')[0]]),
    [['2026-11-01', '09:30', 'Batch cooking'], ['2026-11-05', '19:00', 'Sortir du congélateur']],
  );
});

// --- Assistant ---
test('Demande « batch cooking » comprise ; le parcours guidé ne limite plus le temps par repas', () => {
  const finder = makeIngredientFinder(buildNameIndex(INGREDIENTS), ingredients);
  const r = parseRequest('Je veux faire du batch cooking le dimanche', { today: '2026-10-31', monday: '2026-11-02', ...finder });
  const g = guidedRequest({ slots: ['dinner'], keepExisting: true, budgetCents: null, maxMinutes: 30, wishes: ['batch'], region: null });
  assertEqual([r.modes.includes('batch'), g.modes.includes('batch'), g.maxMinutes], [true, true, null]);
});

test('Note batch : un plat qui se congèle passe devant un plat à assembler le jour même', () => {
  const scoring = { household, ingredients, preparations, nutrition: new Map(), nutritionByRecipe: new Map(), unitPrices: new Map(), promoIngredients: new Set(), stockIngredients: new Set(), programTargets: null, keepingOf };
  const env = { slot: /** @type {const} */ ('dinner'), medianCostIndex: 1, maxMinutes: null, weekCuisines: [], weekRecipeIds: [], weekIngredients: new Set(), batchAge: 4 };
  const chili = scoreRecipe(recipe('chili_con_carne'), { batch: 1 }, env, scoring);
  const tacos = scoreRecipe(recipe('shredded_chicken_tacos'), { batch: 1 }, env, scoring);
  const plain = scoreRecipe(recipe('chili_con_carne'), {}, env, scoring);
  assertEqual([chili.score - plain.score, tacos.score - plain.score <= -15, chili.reasons.some((r) => r.includes('congèle'))], [5, true, true]);
});

test('Note batch : un plat cuisiné en double ne coûte rien de plus', () => {
  const scoring = { household, ingredients, preparations, nutrition: new Map(), nutritionByRecipe: new Map(), unitPrices: new Map(), promoIngredients: new Set(), stockIngredients: new Set(), programTargets: null, keepingOf };
  const env = { slot: /** @type {const} */ ('dinner'), medianCostIndex: 1, maxMinutes: null, weekCuisines: [], weekRecipeIds: ['chili_con_carne'], weekIngredients: new Set(), batchAge: 1 };
  const batch = scoreRecipe(recipe('chili_con_carne'), { batch: 1 }, env, scoring);
  const normal = scoreRecipe(recipe('chili_con_carne'), {}, env, scoring);
  assertEqual(batch.score - normal.score, 16);
});

test('Planifier en batch cooking : plats qui se gardent, cuisinés en double, jamais deux fois le même jour', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  const sessions = ['2026-11-01'];
  const scoring = { household, ingredients, preparations, nutrition: buildNutritionIndex(NUTRITION), nutritionByRecipe: new Map(), unitPrices: new Map(), promoIngredients: new Set(), stockIngredients: new Set(), programTargets: null, keepingOf };
  const engine = {
    scoring, recipes: ALL_RECIPES, recipesById: recipes, meals: [], today: '2026-10-31', days, activeSlots: /** @type {const} */ (['lunch', 'dinner']).slice(),
    weeklyBudgetCents: null, learnedWeights: {}, productsByIngredient: new Map(), cuisineRegion: new Map(CUISINES.map((c) => [c.id, c.region])),
    familyOf: new Map(ALL_RECIPES.map((r) => [r.id, recipeFamily(r, ingredients)])), batchSessions: sessions,
  };
  const ops = proposeChanges(guidedRequest({ slots: ['lunch', 'dinner'], keepExisting: true, budgetCents: null, maxMinutes: null, wishes: ['batch'], region: null }), engine).operations
    .flatMap((o) => (o.type === 'add_meal' ? [o] : []));
  const sameDayTwice = days.some((d) => {
    const ids = ops.filter((o) => o.date === d).map((o) => o.recipeId);
    return new Set(ids).size < ids.length;
  });
  const keeps = ops.every((o) => storagePlan(keepingFor(o.recipeId), '2026-11-01', o.date).storage !== 'same_day');
  assertEqual([ops.length, new Set(ops.map((o) => o.recipeId)).size <= 9, sameDayTwice, keeps], [14, true, false, true]);
});

// --- Restes du diner pour le dejeuner du lendemain, choix par repas ---
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
/** @param {Meal[]} meals @param {string[]} sessions */
const engineFor = (meals, sessions) => ({
  scoring: { household, ingredients, preparations, nutrition: buildNutritionIndex(NUTRITION), nutritionByRecipe: new Map(), unitPrices: new Map(), promoIngredients: new Set(), stockIngredients: new Set(), programTargets: null, keepingOf },
  recipes: ALL_RECIPES, recipesById: recipes, meals, today: '2026-10-31', days: DAYS, activeSlots: /** @type {import('../src/domain/planning/planning.js').Slot[]} */ (['lunch', 'dinner']),
  weeklyBudgetCents: null, learnedWeights: {}, productsByIngredient: new Map(), cuisineRegion: new Map(CUISINES.map((c) => [c.id, c.region])),
  familyOf: new Map(ALL_RECIPES.map((r) => [r.id, recipeFamily(r, ingredients)])), batchSessions: sessions,
});
let idCounter = 0;
const applyCtx = { household, recipes, ingredients, preparations, productsByIngredient: new Map(), newId: () => `n${++idCounter}` };

test('Demande « les restes du soir pour le lendemain midi » comprise, distincte de « utilise les restes »', () => {
  const finder = makeIngredientFinder(buildNameIndex(INGREDIENTS), ingredients);
  const c = { today: '2026-10-31', monday: '2026-11-02', ...finder };
  const a = parseRequest('Quand je cuisine le soir, les restes servent pour le lendemain midi', c);
  const b = parseRequest('Utilise les restes du repas précédent', c);
  assertEqual([a.nextLunchLeftovers, a.understood, b.nextLunchLeftovers, b.leftovers], [true, true, false, true]);
});

test('Planifier avec les restes : chaque dîner sert le déjeuner du lendemain', () => {
  const req = guidedRequest({ slots: ['lunch', 'dinner'], keepExisting: true, budgetCents: null, maxMinutes: null, wishes: [], region: null, leftovers: true });
  const ops = proposeChanges(req, engineFor([], [])).operations.flatMap((o) => (o.type === 'add_meal' ? [o] : []));
  const lunches = ops.filter((o) => o.slot === 'lunch').map((o) => o.date);
  const withLeftovers = ops.filter((o) => o.nextLunch).map((o) => o.date);
  // Lundi midi cuisiné ; mardi -> dimanche midi : restes de la veille ; le dîner de dimanche n'a pas de lendemain dans la semaine.
  assertEqual([lunches, withLeftovers, ops.filter((o) => o.nextLunch).every((o) => keepingFor(o.recipeId).batch)], [['2026-11-02'], DAYS.slice(0, 6), true]);
  const result = applyOperations({ meals: [], weeklyBudgetCents: null, preferredProducts: {} }, ops, applyCtx);
  assertEqual([result.errors, result.state.meals.filter((m) => m.nextLunch).length], [[], 6]);
});

test('Tout refaire avec les restes : le déjeuner du lendemain laisse la place aux restes', () => {
  const dinner = { ...meal('d1', '2026-11-02', 'chicken_colombo'), attendees: ['A', 'B'] };
  const lunch = { ...meal('l1', '2026-11-03', 'one_pot_pasta_tomato_basil'), slot: /** @type {const} */ ('lunch') };
  const req = { ...guidedRequest({ slots: ['lunch', 'dinner'], keepExisting: false, budgetCents: null, maxMinutes: null, wishes: [], region: null, leftovers: true }), generate: false };
  const ops = proposeChanges(req, engineFor([dinner, lunch], [])).operations;
  assertEqual([ops.some((o) => o.type === 'remove_meal' && o.mealId === 'l1'), ops.some((o) => o.type === 'set_next_lunch' && o.mealId === 'd1'), ops.some((o) => o.type === 'replace_recipe' && o.mealId === 'l1')], [true, true, false]);
  const result = applyOperations({ meals: [dinner, lunch], weeklyBudgetCents: null, preferredProducts: {} }, ops, applyCtx);
  assertEqual([result.errors, result.state.meals.find((m) => m.id === 'd1')?.nextLunch !== null, result.state.meals.some((m) => m.id === 'l1')], [[], true, false]);
});

test('Opération de l’IA : un nouveau dîner peut servir au déjeuner du lendemain', () => {
  const r = parseOperations([{ type: 'add_meal', date: '2026-11-02', slot: 'dinner', recipeId: 'chicken_colombo', guests: 0, nextLunch: true }]);
  assertEqual(r.ok && r.operations[0].type === 'add_meal' ? r.operations[0].nextLunch : null, true);
});

test('Batch : un repas qu’on préfère cuisiner le jour même sort de la séance', () => {
  const w = planBatchWeek([{ ...meal('x', '2026-11-03', 'chicken_colombo'), cookSameDay: true }], ['2026-11-01'], household, ctx);
  assertEqual([w.sessions.flatMap((s) => s.dishes).length, w.sameDay.map((x) => x.note)], [0, ['Vous avez choisi de le cuisiner le jour même.']]);
});

test('Batch : un dîner avec restes doit tenir jusqu’au lendemain midi', () => {
  const plain = planBatchWeek([meal('y', '2026-11-04', 'chicken_colombo')], ['2026-11-01'], household, ctx).sessions[0].dishes[0].servings[0];
  const withLunch = planBatchWeek([{ ...meal('z', '2026-11-04', 'chicken_colombo'), nextLunch: { attendees: ['A', 'B'], guests: 0 } }], ['2026-11-01'], household, ctx).sessions[0].dishes[0].servings[0];
  assertEqual([plain.storage, withLunch.storage, withLunch.thawOn, withLunch.portions], ['fridge', 'freezer', '2026-11-03', 4]);
});
