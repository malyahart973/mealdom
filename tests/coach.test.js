import { test, assertEqual } from './runner.js';
import {
  parseCoachText,
  parseCoachMeal,
  optionIngredients,
  coachRecipe,
  assembledId,
  optionId,
  planCoachWeek,
  readCoachAnswer,
  validateCoachPlan,
  nextCheckIn,
  typicalDay,
} from '../src/domain/nutrition/coach.js';

// Programme type (anonyme), tel qu'on le copie depuis un PDF : quantites seules sur leur ligne.
const TEXT = `PLAN ALIMENTAIRE
(Bilans : poids et mensurations toutes les 3 semaines)
Hydratation journalière : 2 L sans compter l'eau du sport.
PETIT DÉJEUNER
7H - 7H30
A jeun : un verre d'eau avec un citron pressé
60 gr de flocons d'avoine avec du lait végétal + 30gr de whey iso (une cuillère à café de miel) topping: fruits, 10 amandes, graines de chia
Ou
3 oeufs + 2 tranches de pain complet
Deux gélules d'oméga 3
COLLATION
10H
2 œufs durs et une pomme
Ou
150gr de yaourt grecque ou fromage blanc avec une pomme
+ 10 amandes ou noix
DÉJEUNER
13H
170gr
De protéines végétales ou animales (poulet, dinde, bœuf, poissons, saumon, oeuf)
200gr
de légumes verts (haricots verts, brocolis, courgettes) ou salade composée
100gr
de riz thaï ou complet, patate douce, quinoa, lentilles (à peser cuit)
1 cuillère à soupe
d'huile de colza sur le repas après cuisson
+ un thé vert
COLLATION
Après le sport ou 16h les jours de sport
2 œufs durs et une pomme
DÎNER
20H30
170gr
De protéines (poulet, dinde, poissons, oeuf)
50gr
de riz thaï, quinoa (à peser cuit)
150 à 200gr
de légumes verts ou salade composée
Pas de sauces (ketchup, mayo). Pas de soda. Pas de grignotage !!!
L'avocat est autorisé.
Bon courage !`;

const plan = parseCoachText(TEXT, '2026-11-01');

test('Programme collé : repas, horaires, collation des jours de sport, eau, bilans, consignes', () => {
  assertEqual(plan.meals.map((m) => `${m.slot}@${m.time}${m.sportDaysOnly ? '*' : ''}`), ['breakfast@7 h - 7 h 30', 'morning_snack@10 h', 'lunch@13 h', 'snack@16 h*', 'dinner@20 h 30']);
  assertEqual([plan.waterLiters, plan.checkInWeeks, plan.rules], [2, 3, ['Pas de sauces (ketchup, mayo).', 'Pas de soda.', 'Pas de grignotage', 'L\'avocat est autorisé.']]);
});

test('Déjeuner : repas composé avec les grammages du coach (féculents pesés cuits)', () => {
  const a = parseCoachMeal(/** @type {string} */ (plan.meals.find((m) => m.slot === 'lunch')?.text)).assembled;
  assertEqual(
    [a?.protein.grams, a?.protein.choices, a?.vegetables.grams, a?.vegetables.choices, a?.starch?.grams, a?.starch?.cooked, a?.starch?.choices, a?.fat?.choices],
    [170, ['chicken', 'turkey', 'beef_steak', 'white_fish', 'salmon', 'egg', 'tofu'], 200, ['green_beans', 'broccoli', 'zucchini', 'lettuce+tomato+cucumber'], 100, true, ['rice_jasmine', 'rice_brown', 'sweet_potato', 'quinoa', 'lentils_green'], ['rapeseed_oil']],
  );
});

test('Dîner : « légumes verts » sans précision = légumes verts courants, fourchette gardée', () => {
  const a = parseCoachMeal(/** @type {string} */ (plan.meals.find((m) => m.slot === 'dinner')?.text)).assembled;
  assertEqual([a?.vegetables.grams, a?.vegetables.gramsMax, a?.vegetables.choices[0], a?.starch?.grams, a?.fat], [150, 200, 'green_beans', 50, null]);
});

test('Petit-déjeuner : possibilités séparées par « Ou », compléments communs à part', () => {
  const p = parseCoachMeal(/** @type {string} */ (plan.meals[0].text));
  assertEqual([p.options.length, p.assembled, p.extras.length], [2, null, 2]);
});

test('Aliments d’un menu : grammes, pièces, cuillères, « 10 amandes » en grammes', () => {
  const lines = optionIngredients(["60 gr de flocons d'avoine avec du lait végétal + 30gr de whey iso (une cuillère à café de miel) topping: 10 amandes", '2 œufs durs et une pomme']);
  assertEqual(lines.map((l) => `${l.ingredientId}:${l.quantity}${l.unit}`), ['rolled_oats:60g', 'oat_drink:150ml', 'whey_isolate:30g', 'honey:1tsp', 'almonds:12g', 'egg:2piece', 'apple:1piece']);
});

test('Recette composée : féculent acheté cru, œufs à la pièce, huile après cuisson', () => {
  const r = coachRecipe(assembledId('lunch', 'egg', 'broccoli', 'quinoa'), plan);
  assertEqual(
    [r?.name, r?.servings, r?.ingredients.map((l) => `${l.ingredientId}:${l.quantity}${l.unit}`), r?.keeping, r?.mealTypes],
    ['Œufs, brocolis et quinoa', 1, ['egg:3piece', 'broccoli:200g', 'quinoa:35g', 'rapeseed_oil:1tbsp'], { fridgeDays: 3, freezes: false }, ['lunch']],
  );
  assertEqual([coachRecipe(assembledId('lunch', 'salmon', 'broccoli', 'quinoa'), plan)?.keeping?.fridgeDays, coachRecipe(assembledId('lunch', 'pork', 'broccoli', 'quinoa'), plan)], [2, null]);
});

test('Menu fixe : nom lisible, étapes du coach', () => {
  const r = coachRecipe(optionId('breakfast', 1), plan);
  assertEqual([r?.name, r?.methods[0].steps[0], coachRecipe(optionId('breakfast', 5), plan)], ['Œufs et pain complet', '3 oeufs + 2 tranches de pain complet', null]);
});

const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const allSlots = /** @type {import('../src/domain/nutrition/program.js').ProgramSlot[]} */ (['breakfast', 'morning_snack', 'lunch', 'snack', 'dinner']);

test('Semaine du programme : collation seulement les jours de sport, protéines qui tournent', () => {
  const { picks, notes } = planCoachWeek(plan, { days, slots: allSlots, meals: [], redo: false, sportDays: new Set([1, 3]), allowed: () => true });
  const snacks = picks.filter((p) => p.slot === 'snack').map((p) => p.date);
  const mains = picks.filter((p) => p.slot === 'lunch' || p.slot === 'dinner').map((p) => p.recipe.ingredients[0].ingredientId);
  assertEqual([snacks, picks.length, mains.every((id, i) => i === 0 || id !== mains[i - 1]), new Set(mains).size >= 5, notes], [['2026-11-03', '2026-11-05'], 30, true, true, []]);
});

test('Semaine du programme : repas incompatibles avec le foyer écartés, repas existants gardés', () => {
  const noFish = (/** @type {import('../src/domain/recipes/recipes.js').Recipe} */ r) => !r.ingredients.some((l) => ['white_fish', 'salmon'].includes(l.ingredientId));
  const kept = { id: 'k', date: '2026-11-02', slot: /** @type {const} */ ('lunch'), recipeId: 'x', recipeName: 'X', attendees: [], guests: 0, nextLunch: null, locked: false };
  const { picks } = planCoachWeek(plan, { days, slots: ['lunch', 'dinner'], meals: [kept], redo: false, sportDays: new Set(), allowed: noFish });
  assertEqual([picks.every((p) => noFish(p.recipe)), picks.some((p) => p.date === '2026-11-02' && p.slot === 'lunch'), picks.length], [true, false, 13]);
});

test('Sans jours de sport déclarés : la collation d’après sport est signalée', () => {
  assertEqual(planCoachWeek(plan, { days, slots: allSlots, meals: [], redo: false, sportDays: new Set(), allowed: () => true }).notes.length, 1);
});

test('Réponse de l’IA vérifiée : doublons écartés, valeurs aberrantes ignorées', () => {
  const r = readCoachAnswer({ found: true, meals: [{ slot: 'lunch', time: '13 h', sportDaysOnly: true, text: '170 g de poulet' }, { slot: 'lunch', time: '', sportDaysOnly: false, text: 'doublon' }, { slot: 'tea', time: '', sportDaysOnly: false, text: 'x' }], rules: ['Pas de soda', 3], waterLiters: 40, checkInWeeks: 3, notes: 'Objectif' }, '2026-11-01');
  assertEqual([r?.meals.length, r?.meals[0].sportDaysOnly, r?.rules, r?.waterLiters, r?.checkInWeeks], [1, false, ['Pas de soda'], null, 3]);
  assertEqual([readCoachAnswer({ found: false, meals: [] }, '2026-11-01'), readCoachAnswer(null, '2026-11-01')], [null, null]);
});

test('Vérifications avant d’enregistrer, prochain bilan et journée type', () => {
  assertEqual(validateCoachPlan({ ...plan, meals: [plan.meals[2], plan.meals[2]] }).length, 1);
  assertEqual([validateCoachPlan(plan), nextCheckIn(plan, '2026-11-10'), typicalDay(plan, false).length, typicalDay(plan, true).length], [[], '2026-11-22', 4, 5]);
});
