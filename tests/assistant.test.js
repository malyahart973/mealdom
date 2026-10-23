import { test, assertEqual } from './runner.js';
import { proposeChanges, learnedWeights } from '../src/domain/assistant/engine.js';
import { applyOperations, planDiff, parseOperations } from '../src/domain/assistant/proposal.js';
import { parseRequest, makeIngredientFinder, mergeRequests } from '../src/domain/assistant/intent.js';
import { learnFromRequest, applyPreferences, LEARN_THRESHOLD } from '../src/domain/assistant/preferences.js';
import { recipeContains, scoreRecipe } from '../src/domain/assistant/scoring.js';
import { buildNutritionIndex, recipeNutrition } from '../src/domain/nutrition/nutrition.js';
import { createDefaultHousehold, upsertMember } from '../src/domain/household/household.js';
import { evaluateRecipeForHousehold } from '../src/domain/household/compatibility.js';
import { totalMinutes, recipeMealTypes, hasTag } from '../src/domain/recipes/recipes.js';
import { buildNameIndex } from '../src/domain/ingredients/ingredients.js';
import { DEFAULT_PORTION_RULES } from '../src/data/portionRules.js';
import { ALL_RECIPES } from '../src/data/allRecipes.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { PREPARATIONS } from '../src/data/preparations.js';
import { NUTRITION } from '../src/data/nutrition.js';
import { CUISINES } from '../src/data/cuisines.js';

/** @typedef {import('../src/domain/planning/planning.js').Meal} Meal */
/** @typedef {import('../src/domain/assistant/engine.js').EngineContext} EngineContext */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const preparations = new Map(PREPARATIONS.map((p) => [p.id, p]));
const nutrition = buildNutritionIndex(NUTRITION);
const recipesById = new Map(ALL_RECIPES.map((r) => [r.id, r]));
const nutritionByRecipe = new Map(ALL_RECIPES.map((r) => [r.id, recipeNutrition(r, { ingredients, preparations, nutrition }).perPortion]));
const finder = makeIngredientFinder(buildNameIndex(INGREDIENTS), ingredients);
const cuisineLabels = new Map(CUISINES.map((c) => [c.id, c.label]));

let household = createDefaultHousehold(DEFAULT_PORTION_RULES);
household = upsertMember(household, { id: 'A', name: 'Manoah', category: 'adult', allergens: [], diet: null, dislikes: [] });
household = upsertMember(household, { id: 'B', name: 'Sam', category: 'adult', allergens: [], diet: null, dislikes: [] });

const MONDAY = '2026-10-19';
const DAYS = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
let n = 0;
/** @param {string} date @param {import('../src/domain/planning/planning.js').Slot} slot @param {string} recipeId @param {Partial<Meal>} [f] @returns {Meal} */
const meal = (date, slot, recipeId, f = {}) => ({
  id: `m${++n}`,
  date,
  slot,
  recipeId,
  recipeName: recipesById.get(recipeId)?.name ?? recipeId,
  attendees: ['A', 'B'],
  guests: 0,
  nextLunch: null,
  locked: false,
  ...f,
});

/** @param {Meal[]} meals @param {Partial<EngineContext>} [f] @returns {EngineContext} */
const engineCtx = (meals, f = {}) => ({
  scoring: { household, ingredients, preparations, nutrition, nutritionByRecipe, unitPrices: new Map(), promoIngredients: new Set(), stockIngredients: new Set(), programTargets: null },
  recipes: ALL_RECIPES,
  recipesById,
  meals,
  today: MONDAY,
  days: DAYS,
  activeSlots: ['lunch', 'dinner'],
  weeklyBudgetCents: null,
  learnedWeights: {},
  productsByIngredient: new Map(),
  cuisineRegion: new Map(CUISINES.map((c) => [c.id, c.region])),
  ...f,
});
/** @param {string} t */
const ask = (t) => parseRequest(t, { today: MONDAY, monday: MONDAY, ...finder });
const applyCtx = { household, recipes: recipesById, ingredients, preparations, productsByIngredient: new Map(), newId: () => `new${++n}` };

const week = () => [
  meal('2026-10-19', 'dinner', 'chili_con_carne'),
  meal('2026-10-20', 'lunch', 'steamed_fish_ginger'),
  meal('2026-10-20', 'dinner', 'red_lentil_dal'),
  meal('2026-10-21', 'lunch', 'vegetable_fried_rice', { locked: true }),
  meal('2026-10-22', 'dinner', 'ratatouille'),
  meal('2026-10-25', 'lunch', 'roast_chicken_potatoes'),
];

test('Gourmand : seules des recettes gourmandes, compatibles et adaptées au créneau sont proposées', () => {
  const r = proposeChanges(ask('Rends les repas plus gourmands'), engineCtx(week()));
  const replaced = r.operations.filter((o) => o.type === 'replace_recipe');
  if (!replaced.length) throw new Error('aucune proposition');
  for (const op of replaced) {
    if (op.type !== 'replace_recipe') continue;
    const recipe = recipesById.get(op.recipeId);
    if (!recipe || !hasTag(recipe, 'gourmand')) throw new Error(`${op.recipeId} pas gourmand`);
  }
});
test('Un repas verrouillé n’est jamais modifié et c’est expliqué', () => {
  const meals = week();
  const r = proposeChanges(ask('Refais toute la semaine en plus rapide'), engineCtx(meals));
  const lockedId = meals.find((m) => m.locked)?.id;
  if (r.operations.some((o) => 'mealId' in o && o.mealId === lockedId)) throw new Error('verrou ignoré');
  if (!r.notes.some((x) => x.includes('verrouillés'))) throw new Error('pas d’explication');
});
test('Rapidité « moins de 30 minutes » : recettes de 30 minutes au plus', () => {
  const r = proposeChanges(ask('Des repas en moins de 30 minutes'), engineCtx(week()));
  for (const op of r.operations) if (op.type === 'replace_recipe' && totalMinutes(/** @type {any} */ (recipesById.get(op.recipeId))) > 30) throw new Error(op.recipeId);
});
test('« Remplace le poisson de mardi par du poulet » : le repas de mardi n’a plus de poisson et contient du poulet', () => {
  const meals = week();
  const r = proposeChanges(ask('Remplace le poisson de mardi par du poulet'), engineCtx(meals));
  const op = r.operations.find((o) => o.type === 'replace_recipe' || o.type === 'substitute');
  if (!op || op.type !== 'replace_recipe') throw new Error(JSON.stringify(r));
  const recipe = /** @type {any} */ (recipesById.get(op.recipeId));
  const ctx = engineCtx(meals).scoring;
  assertEqual([op.mealId, recipeContains(recipe, { ingredientId: null, category: 'fish', label: '' }, ctx), recipeContains(recipe, { ingredientId: null, category: 'poultry', label: '' }, ctx) || recipeContains(recipe, { ingredientId: 'chicken', category: null, label: '' }, ctx)], [meals[1].id, false, true]);
});
test('« Remplace la crème par du yaourt » : remplacement d’ingrédient dans la même recette', () => {
  const meals = [meal('2026-10-20', 'dinner', 'creamy_mushroom_chicken')];
  const r = proposeChanges(ask('Remplace la crème légère par du yaourt'), engineCtx(meals));
  assertEqual(r.operations.map((o) => o.type), ['substitute']);
});
test('« Je reçois quatre personnes supplémentaires dimanche » : invités ajoutés au déjeuner de dimanche', () => {
  const meals = week();
  const r = proposeChanges(ask('Je reçois quatre personnes supplémentaires dimanche'), engineCtx(meals));
  assertEqual(r.operations.map((o) => (o.type === 'set_guests' ? [o.mealId, o.guests] : o.type)), [[meals[5].id, 4]]);
});
test('Invités sans jour précisé : une question est posée', () => {
  const r = proposeChanges(ask('Je reçois quatre personnes'), engineCtx(week()));
  assertEqual(r.needsClarification, true);
});
test('« Prévois un repas convivial pour samedi soir » : repas ajouté samedi au dîner', () => {
  const r = proposeChanges(ask('Prévois un repas convivial pour samedi soir'), engineCtx(week()));
  const op = r.operations[0];
  if (!op || op.type !== 'add_meal') throw new Error(JSON.stringify(r));
  const recipe = /** @type {any} */ (recipesById.get(op.recipeId));
  assertEqual([op.date, op.slot, hasTag(recipe, 'convivial') || hasTag(recipe, 'gourmand')], ['2026-10-24', 'dinner', true]);
});
test('« Utilise les restes » : dîner cuisiné pour le lendemain midi', () => {
  const meals = [meal('2026-10-19', 'dinner', 'chili_con_carne'), meal('2026-10-20', 'lunch', 'steamed_fish_ginger')];
  const r = proposeChanges(ask('Mardi midi, utilise les restes du repas précédent'), engineCtx(meals));
  assertEqual(r.operations.map((o) => o.type), ['remove_meal', 'set_next_lunch']);
});
test('Foyer végétarien : aucune viande proposée, demande de poulet refusée avec explication', () => {
  const veggie = upsertMember(household, { id: 'B', name: 'Sam', category: 'adult', allergens: [], diet: 'vegetarian', dislikes: [] });
  const ctx = engineCtx(week(), {});
  ctx.scoring = { ...ctx.scoring, household: veggie };
  const r = proposeChanges(ask('Fais-moi le planning de la semaine avec du poulet'), ctx);
  for (const op of r.operations) {
    if (op.type === 'add_meal' || op.type === 'replace_recipe') {
      const recipe = /** @type {any} */ (recipesById.get(op.recipeId));
      if (evaluateRecipeForHousehold(recipe, veggie, ctx.scoring).status !== 'compatible') throw new Error(op.recipeId);
    }
  }
  if (!r.notes.some((x) => x.includes('ne convient pas'))) throw new Error('conflit non signalé');
});
test('Générer la semaine : cases vides remplies, recettes adaptées au créneau, sans doublon', () => {
  const r = proposeChanges(ask('Fais-moi le planning de la semaine avec plus de recettes asiatiques'), engineCtx([]));
  const added = r.operations.filter((o) => o.type === 'add_meal');
  if (added.length !== 14) throw new Error(String(added.length));
  const ids = added.map((o) => (o.type === 'add_meal' ? o.recipeId : ''));
  if (new Set(ids).size !== ids.length) throw new Error('doublon');
  for (const o of added) if (o.type === 'add_meal' && !recipeMealTypes(/** @type {any} */ (recipesById.get(o.recipeId))).includes(o.slot)) throw new Error(o.recipeId);
  const asian = new Set(CUISINES.filter((c) => c.region === 'asia').map((c) => c.id));
  if (!ids.every((id) => asian.has(/** @type {any} */ (recipesById.get(id)).cuisine))) throw new Error('pas asiatique');
});
test('Budget -15 % sans budget défini : explication, pas d’invention', () => {
  const r = proposeChanges(ask('Réduis mon budget de 15 %'), engineCtx(week()));
  if (r.operations.some((o) => o.type === 'set_weekly_budget')) throw new Error('budget inventé');
  if (!r.notes.some((x) => x.includes('Aucun budget'))) throw new Error('pas expliqué');
});
test('Budget -15 % avec 100 € par semaine : nouveau budget 85 €', () => {
  const r = proposeChanges(ask('Réduis mon budget de 15 %'), engineCtx(week(), { weeklyBudgetCents: 10000 }));
  assertEqual(r.operations.find((o) => o.type === 'set_weekly_budget'), { type: 'set_weekly_budget', cents: 8500, reason: 'Budget de la semaine réduit de 15 %.' });
});
test('Promotions demandées sans données du Drive : limite expliquée', () => {
  const r = proposeChanges(ask('Je veux privilégier les produits en promotion'), engineCtx(week()));
  if (!r.notes.some((x) => x.includes('Aucune promotion vérifiée'))) throw new Error(JSON.stringify(r.notes));
});
test('Contexte conservé : gourmand puis « sans dépasser mon budget » = pas plus cher', () => {
  const merged = mergeRequests(ask('Je veux des repas plus gourmands'), ask('Mais sans dépasser mon budget'));
  const r = proposeChanges(merged, engineCtx(week()));
  assertEqual(r.notes.some((x) => x.startsWith('Gourmand et économique')), true);
});

// --- Application contrôlée ---
test('Application : un repas verrouillé ne peut pas être remplacé', () => {
  const meals = week();
  const r = applyOperations({ meals, weeklyBudgetCents: null, preferredProducts: {} }, [{ type: 'replace_recipe', mealId: meals[3].id, recipeId: 'chili_con_carne', reason: '' }], applyCtx);
  assertEqual([r.applied.length, r.errors.length], [0, 1]);
});
test('Application : recette incompatible avec une allergie refusée', () => {
  const allergic = upsertMember(household, { id: 'B', name: 'Sam', category: 'adult', allergens: ['peanuts'], diet: null, dislikes: [] });
  const meals = week();
  const r = applyOperations({ meals, weeklyBudgetCents: null, preferredProducts: {} }, [{ type: 'replace_recipe', mealId: meals[0].id, recipeId: 'kung_pao_chicken', reason: '' }], { ...applyCtx, household: allergic });
  assertEqual(r.applied.length, 0);
});
test('Application : ajout sur un créneau déjà occupé refusé', () => {
  const r = applyOperations({ meals: week(), weeklyBudgetCents: null, preferredProducts: {} }, [{ type: 'add_meal', date: '2026-10-19', slot: 'dinner', recipeId: 'pad_thai_shrimp', guests: 0, reason: '' }], applyCtx);
  assertEqual(r.applied.length, 0);
});

test('Ingrédient introuvable pour la cliente : alternative appliquée d’office au repas proposé', () => {
  const auto = (/** @type {import('../src/domain/recipes/recipes.js').Recipe} */ r) => (r.ingredients.some((l) => l.ingredientId === 'fish_sauce') ? [{ from: 'fish_sauce', to: 'soy_sauce' }] : []);
  const r = applyOperations({ meals: [], weeklyBudgetCents: null, preferredProducts: {} }, [{ type: 'add_meal', date: '2026-10-21', slot: 'dinner', recipeId: 'pad_thai_shrimp', guests: 0, reason: '' }], { ...applyCtx, autoSubstitutions: auto });
  assertEqual(r.state.meals[0]?.substitutions, [{ from: 'fish_sauce', to: 'soy_sauce' }]);
});
test('Application : les autres repas ne sont pas modifiés', () => {
  const meals = week();
  const r = applyOperations({ meals, weeklyBudgetCents: null, preferredProducts: {} }, [{ type: 'replace_recipe', mealId: meals[0].id, recipeId: 'pad_thai_shrimp', reason: '' }], applyCtx);
  assertEqual(JSON.stringify(r.state.meals.slice(1)), JSON.stringify(meals.slice(1)));
});
test('Opérations venant de l’IA : type inconnu (ex. commander) refusé', () => {
  assertEqual(parseOperations([{ type: 'place_order' }]).ok, false);
});
test('Comparaison : ingrédients ajoutés et retirés', () => {
  const meals = [meal('2026-10-19', 'dinner', 'chili_con_carne')];
  const r = applyOperations({ meals, weeklyBudgetCents: null, preferredProducts: {} }, [{ type: 'replace_recipe', mealId: meals[0].id, recipeId: 'red_lentil_dal', reason: '' }], applyCtx);
  const d = planDiff(meals, r.state.meals, DAYS, applyCtx);
  assertEqual([d.meals.length, d.added.some((a) => a.ingredientId === 'red_lentils'), d.removed.some((a) => a.ingredientId === 'ground_beef')], [1, true, true]);
});

// --- Mémoire des préférences ---
test(`Préférence apprise après ${LEARN_THRESHOLD} demandes acceptées`, () => {
  let prefs = /** @type {import('../src/domain/assistant/preferences.js').Preference[]} */ ([]);
  for (let i = 0; i < LEARN_THRESHOLD; i++) prefs = learnFromRequest(prefs, ask('Des repas gourmands'), '2026-10-22T10:00:00Z', cuisineLabels);
  assertEqual(prefs.find((p) => p.id === 'mode:gourmand')?.active, true);
  assertEqual(learnedWeights(prefs).gourmand, 0.4);
});
test('« Retiens que… » : préférence active tout de suite', () => {
  const prefs = learnFromRequest([], ask('Retiens que je veux peu de vaisselle'), '2026-10-22T10:00:00Z', cuisineLabels);
  assertEqual([prefs[0].id, prefs[0].active, prefs[0].source], ['mode:few_dishes', true, 'explicit']);
});
test('Préférence désactivée par le client : jamais réactivée automatiquement', () => {
  let prefs = learnFromRequest([], ask('Retiens : des repas gourmands'), 'x', cuisineLabels);
  prefs = prefs.map((p) => ({ ...p, active: false, source: /** @type {const} */ ('learned'), count: 5 }));
  prefs = learnFromRequest(prefs, ask('Des repas gourmands'), 'y', cuisineLabels);
  assertEqual(prefs[0].active, false);
});
test('Préférence « éviter le porc » appliquée aux demandes suivantes', () => {
  const prefs = learnFromRequest([], ask('Retiens : pas de porc'), 'x', cuisineLabels);
  assertEqual(applyPreferences(ask('Repas rapides'), prefs).avoid.map((a) => a.category), ['pork']);
});

test('Anti-gaspillage : une recette qui utilise un produit à consommer vite passe devant', () => {
  const recipe = /** @type {import('../src/domain/recipes/recipes.js').Recipe} */ (recipesById.get('chili_con_carne'));
  const env = { slot: null, medianCostIndex: 1, maxMinutes: null, weekCuisines: [], weekRecipeIds: [], weekIngredients: new Set() };
  const base = engineCtx([]).scoring;
  const plain = scoreRecipe(recipe, {}, env, base);
  const boosted = scoreRecipe(recipe, {}, env, { ...base, expiringIngredients: new Set(['ground_beef']) });
  assertEqual([boosted.score > plain.score, boosted.reasons.some((r) => r.includes('à consommer vite'))], [true, true]);
});
