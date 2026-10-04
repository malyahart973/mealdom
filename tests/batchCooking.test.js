import { test, assertEqual } from './runner.js';
import { roundUpQuantity, convertUniversal } from '../src/domain/units/units.js';
import { preparationRequirements, scalePreparation, buildCookingSession } from '../src/domain/batchCooking/batchCooking.js';
import { createDefaultHousehold, upsertMember } from '../src/domain/household/household.js';
import { DEFAULT_PORTION_RULES } from '../src/data/portionRules.js';
import { RECIPES } from '../src/data/recipes.js';
import { PREPARATIONS } from '../src/data/preparations.js';

/** @typedef {import('../src/domain/planning/planning.js').Meal} Meal */

const recipes = new Map(RECIPES.map((r) => [r.id, r]));
const preparations = new Map(PREPARATIONS.map((p) => [p.id, p]));
/** @param {string} id */
const prep = (id) => {
  const p = preparations.get(id);
  if (!p) throw new Error(id);
  return p;
};

// Foyer : 2 adultes (A, B) + 2 enfants (C, D) = 3 portions par repas
let household = createDefaultHousehold(DEFAULT_PORTION_RULES);
for (const [id, category] of [['A', 'adult'], ['B', 'adult'], ['C', 'child'], ['D', 'child']]) {
  household = upsertMember(household, { id, name: id, category, allergens: [], diet: null, dislikes: [] });
}

/**
 * @param {string} id
 * @param {string} date
 * @param {string} recipeId
 * @param {Partial<Meal>} [extra]
 * @returns {Meal}
 */
const meal = (id, date, recipeId, extra = {}) => ({
  id,
  date,
  slot: 'dinner',
  recipeId,
  recipeName: recipes.get(recipeId)?.name ?? recipeId,
  attendees: ['A', 'B', 'C', 'D'],
  guests: 0,
  nextLunch: null,
  locked: false,
  ...extra,
});

// --- Arrondis ---
test('437,25 g -> 440 g', () => assertEqual(roundUpQuantity(437.25, 'g'), 440));
test('450 g reste 450 g', () => assertEqual(roundUpQuantity(450, 'g'), 450));
test('2,109 L -> 2,15 L', () => assertEqual(roundUpQuantity(2.109, 'l'), 2.15));
test('1,3 pièce -> 1,5 pièce', () => assertEqual(roundUpQuantity(1.3, 'piece'), 1.5));
test('« Au goût » n’est pas arrondi', () => assertEqual(roundUpQuantity(1, 'to_taste'), 1));

// --- Cohérence du catalogue ---
test('Chaque préparation utilisée par une recette est dans une unité convertible', () => {
  for (const r of RECIPES)
    for (const line of r.preparations) {
      const p = prep(line.preparationId);
      if (!convertUniversal(line.quantity, line.unit, p.yield.unit).ok) throw new Error(`${r.id} / ${p.id}`);
    }
});

// --- Besoins en préparations ---
test('Colombo pour 3 portions (recette pour 4) : 450 g de riz cuit', () => {
  const { requirements } = preparationRequirements([meal('m1', '2026-10-05', 'chicken_colombo')], household, recipes, preparations);
  assertEqual(requirements.map((r) => [r.preparationId, r.quantity]), [['cooked_rice', 450]]);
});

test('Le déjeuner du lendemain est compté : chili 3 + 1,5 portions = 675 g de riz', () => {
  const m = meal('m1', '2026-10-05', 'chili_con_carne', { nextLunch: { attendees: ['A', 'C'], guests: 0 } });
  assertEqual(preparationRequirements([m], household, recipes, preparations).requirements[0].quantity, 675);
});

test('Riz de plusieurs repas additionné, avec le détail par repas', () => {
  const meals = [meal('m1', '2026-10-05', 'chicken_colombo'), meal('m2', '2026-10-07', 'red_lentil_dal')];
  const req = preparationRequirements(meals, household, recipes, preparations).requirements[0];
  assertEqual([req.quantity, req.uses.map((u) => [u.mealId, u.quantity])], [900, [['m1', 450], ['m2', 450]]]);
});

test('Recette sans préparation : aucun besoin', () =>
  assertEqual(preparationRequirements([meal('m1', '2026-10-05', 'one_pot_pasta_tomato_basil')], household, recipes, preparations).requirements, []));

test('Recette disparue : signalée, sans bloquer le reste', () => {
  const r = preparationRequirements([meal('x', '2026-10-05', 'supprimee'), meal('m1', '2026-10-06', 'chicken_colombo')], household, recipes, preparations);
  assertEqual([r.problems.length, r.requirements.length], [1, 1]);
});

test('Salade de riz : trois préparations différentes', () => {
  const req = preparationRequirements([meal('m1', '2026-10-05', 'rice_salad_chicken_vegetables')], household, recipes, preparations).requirements;
  assertEqual(req.map((r) => [r.preparationId, r.quantity]).sort(), [
    ['cooked_rice', 300],
    ['roasted_vegetables', 300],
    ['shredded_chicken', 225],
  ]);
});

// --- Quantités d'une préparation ---
test('Riz pour 1 125 g cuits : 425 g de riz cru et 2,15 L d’eau', () => {
  const { ingredients } = scalePreparation(prep('cooked_rice'), 1125);
  assertEqual(ingredients.slice(0, 2).map((l) => l.quantity), [425, 2.15]);
});
test('Une pincée de sel reste une pincée', () => {
  const salt = scalePreparation(prep('cooked_rice'), 1600).ingredients.find((l) => l.ingredientId === 'salt');
  assertEqual([salt?.quantity, salt?.unit], [null, 'pinch']);
});

// --- Session de cuisine ---
const weekMeals = [
  meal('m1', '2026-10-05', 'chicken_colombo'),
  meal('m2', '2026-10-06', 'shredded_chicken_tacos'),
  meal('m3', '2026-10-07', 'rice_salad_chicken_vegetables'),
];
const weekReq = preparationRequirements(weekMeals, household, recipes, preparations).requirements;

test('On commence par ce qui cuit le plus longtemps (légumes rôtis, puis poulet, puis riz)', () => {
  const session = buildCookingSession(weekReq, preparations, ['stovetop', 'oven']);
  assertEqual(session.tasks.map((t) => t.preparationId), ['roasted_vegetables', 'shredded_chicken', 'cooked_rice']);
});

test('Four et plaques en même temps : la session est plus courte qu’en enchaînant', () => {
  const session = buildCookingSession(weekReq, preparations, ['stovetop', 'oven']);
  if (!(session.estimatedMinutes < session.sequentialMinutes)) throw new Error(`${session.estimatedMinutes} / ${session.sequentialMinutes}`);
  assertEqual(session.parallelGroups[0].sort(), ['roasted_vegetables', 'shredded_chicken']);
});

test('Le poulet effiloché sert pour 2 repas', () => {
  const session = buildCookingSession(weekReq, preparations, ['stovetop', 'oven']);
  assertEqual(session.tasks.find((t) => t.preparationId === 'shredded_chicken')?.uses, 2);
});

test('Sans four mais avec un air fryer : méthode air fryer choisie', () => {
  const session = buildCookingSession(weekReq, preparations, ['stovetop', 'air_fryer']);
  assertEqual(session.tasks.find((t) => t.preparationId === 'roasted_vegetables')?.method?.id, 'air_fryer');
});

test('Sans matériel adapté : la tâche est signalée (méthode absente)', () => {
  const session = buildCookingSession(weekReq, preparations, ['stovetop']);
  assertEqual(session.tasks.find((t) => t.preparationId === 'roasted_vegetables')?.method, null);
});

test('Semaine sans préparation : session vide', () => {
  const session = buildCookingSession([], preparations, ['stovetop']);
  assertEqual([session.tasks.length, session.estimatedMinutes], [0, 0]);
});
