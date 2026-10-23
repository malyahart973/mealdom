import { test, assertEqual } from './runner.js';
import { buildNutritionIndex, gramsOf, recipeNutrition, portionLines, roundNutrients } from '../src/domain/nutrition/nutrition.js';
import {
  bmi,
  bmiCategory,
  basalMetabolicRate,
  dailyTargets,
  mealTargets,
  personalPortion,
  programFitScore,
  validateProgram,
  createDefaultProgram,
  weightForBmi,
} from '../src/domain/nutrition/program.js';
import { validateWeightEntry, parseKg, smoothedTrend, weeklyRate, weightProgress } from '../src/domain/nutrition/weight.js';
import { NUTRITION } from '../src/data/nutrition.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { PREPARATIONS } from '../src/data/preparations.js';
import { RECIPES } from '../src/data/recipes.js';

/** @typedef {import('../src/domain/nutrition/program.js').Program} Program */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const nutrition = buildNutritionIndex(NUTRITION);
const ctx = { ingredients, preparations: new Map(PREPARATIONS.map((p) => [p.id, p])), nutrition };
/** @param {string} id */
const ing = (id) => ingredients.get(id) ?? null;
/** @param {string} id */
const recipe = (id) => {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};

// --- Données ---
test('Chaque ingrédient du catalogue a des valeurs nutritionnelles', () => {
  const missing = INGREDIENTS.filter((i) => !(i.id in NUTRITION)).map((i) => i.id);
  assertEqual(missing, []);
});
test('Valeurs nutritionnelles cohérentes (macros <= 100 g, kcal ~ 4/4/9 + 2 par g de fibres)', () => {
  // L'alcool (7 kcal/g) n'est pas dans les macros : vins, mirin, extrait de vanille exclus.
  const alcohol = new Set(['red_wine', 'white_wine', 'mirin', 'vanilla']);
  for (const [id, f] of nutrition) {
    if (alcohol.has(id)) continue;
    if (f.protein + f.carbs + f.fat > 100.5) throw new Error(`${id} : plus de 100 g de macros`);
    const computed = f.protein * 4 + f.carbs * 4 + f.fat * 9 + f.fiber * 2;
    if (f.kcal > 0 && Math.abs(computed - f.kcal) > Math.max(60, f.kcal * 0.3)) throw new Error(`${id} : ${f.kcal} kcal pour ${Math.round(computed)} calculées`);
  }
});

// --- Grammes ---
test('Grammes : 2 oignons = 220 g (conversion de l’ingrédient)', () => assertEqual(gramsOf(2, 'piece', ing('onion'), nutrition.get('onion')), 220));
test('Grammes : 1 c. à soupe d’huile = 13,8 g (densité)', () => assertEqual(gramsOf(1, 'tbsp', ing('vegetable_oil'), nutrition.get('vegetable_oil')), 13.8));
test('Grammes : 3 gousses d’ail = 15 g', () => assertEqual(gramsOf(3, 'clove', ing('garlic'), nutrition.get('garlic')), 15));
test('Grammes : « au goût » compte pour 0 g', () => assertEqual(gramsOf(null, 'to_taste', ing('salt'), nutrition.get('salt')), 0));
test('Grammes : 1 boîte sans poids connu -> impossible (null)', () => assertEqual(gramsOf(1, 'can', ing('corn'), nutrition.get('corn')), null));

// --- Recettes ---
test('Dal de lentilles et riz : estimation complète et plausible (400 à 800 kcal la portion)', () => {
  const n = recipeNutrition(recipe('red_lentil_dal'), ctx);
  if (!n.complete) throw new Error(n.missing.join(','));
  if (n.perPortion.kcal < 400 || n.perPortion.kcal > 800) throw new Error(String(n.perPortion.kcal));
});
test('Le riz cuit (préparation) est compté dans le colombo', () => {
  const r = recipe('chicken_colombo');
  const withRice = recipeNutrition(r, ctx).perPortion.kcal;
  const without = recipeNutrition({ ...r, preparations: [] }, ctx).perPortion.kcal;
  // 600 g de riz cuit sur 800 g = 225 g de riz cru pour 4 = ~200 kcal par portion
  if (Math.round(withRice - without) < 180 || Math.round(withRice - without) > 220) throw new Error(String(withRice - without));
});
test('Ingrédient sans valeur : estimation déclarée incomplète', () => {
  const r = { ...recipe('chili_con_carne'), ingredients: [{ ingredientId: 'licorne', quantity: 100, unit: 'g' }] };
  assertEqual(recipeNutrition(r, ctx).complete, false);
});
test('Portion personnelle en grammes : 0,5 portion de chili = 63 g de bœuf haché', () => {
  const lines = portionLines(recipe('chili_con_carne'), 0.5, ctx);
  assertEqual(lines.find((l) => l.id === 'ground_beef')?.grams, 63);
  assertEqual(lines.find((l) => l.id === 'cooked_rice')?.grams, 75);
});
test('Arrondi d’affichage des valeurs', () =>
  assertEqual(roundNutrients({ kcal: 412.6, protein: 20.4, carbs: 50.5, fat: 9.49, fiber: 3 }), { kcal: 413, protein: 20, carbs: 51, fat: 9, fiber: 3 }));

// --- Programme ---
/** @param {Partial<Program>} fields @returns {Program} */
const program = (fields = {}) => ({
  ...createDefaultProgram('2026-10-22'),
  sex: 'female',
  birthYear: 1990,
  heightCm: 162,
  startWeightKg: 71.4,
  goalWeightKg: 61.4,
  active: true,
  ...fields,
});

test('IMC : 71,4 kg pour 1,62 m = 27,2 (surpoids)', () => {
  assertEqual(bmi(71.4, 162), 27.2);
  assertEqual(bmiCategory(27.2), 'Surpoids');
});
test('IMC visé : 61,4 kg pour 1,62 m = 23,4 (corpulence normale)', () => assertEqual(bmiCategory(bmi(61.4, 162)), 'Corpulence normale'));
test('Métabolisme de base (Mifflin-St Jeor), femme de 36 ans, 71,4 kg, 162 cm = 1 386 kcal', () =>
  assertEqual(basalMetabolicRate('female', 71.4, 162, 36), 1386));
test('Sédentaire : le minimum de 1 200 kcal limite le déficit (perte ~0,42 kg/semaine)', () => {
  const t = dailyTargets(program(), 71.4, '2026-10-22');
  assertEqual([t.tdee, t.kcal, t.floorApplied, t.weeklyLossKg], [1663, 1200, true, 0.42]);
});
test('Homme actif : objectif = dépense - 550 kcal pour 0,5 kg/semaine', () => {
  const t = dailyTargets(program({ sex: 'male', activity: 'moderate', startWeightKg: 90, goalWeightKg: 80, heightCm: 180 }), 90, '2026-10-22');
  assertEqual([t.deficit >= 545 && t.deficit <= 555, t.floorApplied, t.weeklyLossKg], [true, false, 0.5]);
});
test('Protéines : 1,3 g par kg (71,4 kg -> 93 g)', () => assertEqual(dailyTargets(program(), 71.4, '2026-10-22').proteinG, 93));
test('Durée estimée : 10 kg à 0,42 kg/semaine = 24 semaines', () => assertEqual(dailyTargets(program(), 71.4, '2026-10-22').weeksToGoal, 24));
test('Répartition des repas : 25/35/10/30 % de 1 200 kcal', () => {
  const m = mealTargets(dailyTargets(program(), 71.4, '2026-10-22'), program().mealSplit);
  assertEqual([m.breakfast.kcal, m.lunch.kcal, m.snack.kcal, m.dinner.kcal], [300, 420, 120, 360]);
});
test('Programme valide accepté', () => assertEqual(validateProgram(program(), '2026-10-22'), []));
test('Programme refusé pour un mineur', () => {
  if (validateProgram(program({ birthYear: 2012 }), '2026-10-22').length === 0) throw new Error('accepté');
});
test('Objectif sous un IMC de 18,5 refusé', () => {
  const errors = validateProgram(program({ goalWeightKg: 45 }), '2026-10-22');
  if (!errors.some((e) => e.includes('18,5'))) throw new Error(errors.join());
  assertEqual(weightForBmi(18.5, 162), 48.6);
});
test('Répartition qui ne fait pas 100 % refusée', () => {
  if (validateProgram(program({ mealSplit: { breakfast: 30, lunch: 30, snack: 10, dinner: 20 } }), '2026-10-22').length === 0) throw new Error('acceptée');
});
test('Portion personnelle : 420 kcal visées pour une recette à 600 kcal = 0,7 portion', () =>
  assertEqual(personalPortion({ kcal: 600, protein: 30, carbs: 60, fat: 20, fiber: 5 }, 420), { portions: 0.7, kcal: 420, protein: 21, fits: true }));
test('Portion personnelle bornée : recette trop riche signalée', () =>
  assertEqual(personalPortion({ kcal: 1200, protein: 30, carbs: 60, fat: 80, fiber: 2 }, 300).fits, false));
test('Recette riche en protéines mieux notée pour le programme', () => {
  const target = { kcal: 420, proteinG: 33 };
  const lean = programFitScore({ kcal: 420, protein: 35, carbs: 35, fat: 12, fiber: 6 }, target);
  const sweet = programFitScore({ kcal: 420, protein: 6, carbs: 80, fat: 8, fiber: 1 }, target);
  if (!(lean > sweet)) throw new Error(`${lean} <= ${sweet}`);
});

// --- Poids ---
test('Saisie du poids : « 71,4 » et « 71.4 kg » acceptés', () => assertEqual([parseKg('71,4'), parseKg('71.4 kg')], [71.4, 71.4]));
test('Pesée dans le futur refusée', () => {
  if (validateWeightEntry({ date: '2026-10-30', kg: 70, note: '' }, '2026-10-22').length === 0) throw new Error('acceptée');
});
test('Tendance lissée sur 7 jours', () =>
  assertEqual(
    smoothedTrend([
      { date: '2026-10-01', kg: 72 },
      { date: '2026-10-03', kg: 71 },
      { date: '2026-10-09', kg: 70 },
    ].map((e) => ({ ...e, note: '' }))).map((p) => p.kg),
    [72, 71.5, 70.5],
  ));
/** @param {[string, number][]} rows */
const entries = (rows) => rows.map(([date, kg]) => ({ date, kg, note: '' }));
test('Rythme : -0,5 kg par semaine sur 3 semaines', () =>
  assertEqual(weeklyRate(entries([['2026-10-01', 71.4], ['2026-10-08', 70.9], ['2026-10-15', 70.4], ['2026-10-22', 69.9]]), '2026-10-22'), -0.5));
test('Rythme non calculé avec trop peu de pesées', () => assertEqual(weeklyRate(entries([['2026-10-20', 71], ['2026-10-22', 70.8]]), '2026-10-22'), null));
test('Perte trop rapide signalée (> 1 kg/semaine)', () =>
  assertEqual(weightProgress({ startWeightKg: 71.4, goalWeightKg: 61.4 }, entries([['2026-10-01', 71.4], ['2026-10-08', 70], ['2026-10-15', 68.6]]), '2026-10-15').status, 'too_fast'));
test('Progression : 2 kg perdus sur 10 = 20 %', () => {
  const p = weightProgress({ startWeightKg: 71.4, goalWeightKg: 61.4 }, entries([['2026-10-01', 71.4], ['2026-10-22', 69.4]]), '2026-10-22');
  assertEqual([p.lostKg, p.remainingKg, p.percent], [2, 8, 20]);
});

test('Calories prévues du jour : portions personnelles, absences et restes du dîner', async () => {
  const { plannedKcalForDay } = await import('../src/domain/nutrition/program.js');
  /** @param {string} recipeId @param {string[]} attendees */
  const meal = (recipeId, attendees) => ({ id: recipeId, date: '2026-10-23', slot: /** @type {'dinner'} */ ('dinner'), recipeId, recipeName: recipeId, attendees, guests: 0, nextLunch: null, locked: false });
  const entries = new Map([
    ['2026-10-23|lunch', { kind: /** @type {const} */ ('leftover'), meal: { ...meal('a', ['m1']), nextLunch: { attendees: ['m1'], guests: 0 } } }],
    ['2026-10-23|dinner', { kind: /** @type {const} */ ('meal'), meal: meal('b', ['m1']) }],
    ['2026-10-23|snack', { kind: /** @type {const} */ ('meal'), meal: meal('c', ['m2']) }],
  ]);
  const n = { kcal: 400, protein: 20, carbs: 40, fat: 10, fiber: 5 };
  const r = plannedKcalForDay(entries, '2026-10-23', { memberId: 'm1', mealSplit: { breakfast: 25, lunch: 35, snack: 10, dinner: 30 } }, { breakfast: { kcal: 300 }, lunch: { kcal: 420 }, snack: { kcal: 120 }, dinner: { kcal: 360 } }, () => n);
  assertEqual(r, { kcal: 420 + 360, meals: 2 });
});
