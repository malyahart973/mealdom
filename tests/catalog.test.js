/**
 * Verification du catalogue complet (recettes de base + catalogue etendu).
 */
import { test, assertEqual } from './runner.js';
import { validateRecipe, recipeMealTypes } from '../src/domain/recipes/recipes.js';
import { buildNutritionIndex, recipeNutrition } from '../src/domain/nutrition/nutrition.js';
import { parseIngredients } from '../src/data/recipeBuilder.js';
import { EQUIPMENT } from '../src/domain/recipes/equipment.js';
import { ALL_RECIPES } from '../src/data/allRecipes.js';
import { PREPARATIONS } from '../src/data/preparations.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { CUISINES } from '../src/data/cuisines.js';
import { NUTRITION } from '../src/data/nutrition.js';

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const preparations = new Map(PREPARATIONS.map((p) => [p.id, p]));
const refs = { ingredients, preparations, cuisines: new Set(CUISINES.map((c) => c.id)), equipment: new Set(EQUIPMENT.map((e) => e.id)) };
const nutritionCtx = { ingredients, preparations, nutrition: buildNutritionIndex(NUTRITION) };
const asian = new Set(CUISINES.filter((c) => c.region === 'asia').map((c) => c.id));

test('Format compact : « onion 2 », « rice_white 300 g | note », « salt to_taste »', () =>
  assertEqual(parseIngredients('onion 2; rice_white 300 g | rincé; salt to_taste'), [
    { ingredientId: 'onion', quantity: 2, unit: 'piece' },
    { ingredientId: 'rice_white', quantity: 300, unit: 'g', note: 'rincé' },
    { ingredientId: 'salt', quantity: null, unit: 'to_taste' },
  ]));
test('Catalogue complet : toutes les recettes sont valides', () => {
  const errors = ALL_RECIPES.flatMap((r) => validateRecipe(r, refs).map((e) => `${r.id} : ${e}`));
  if (errors.length) throw new Error(errors.slice(0, 15).join(' / '));
});
test('Catalogue complet : identifiants uniques', () => {
  const seen = new Set();
  const dup = ALL_RECIPES.filter((r) => (seen.has(r.id) ? true : (seen.add(r.id), false))).map((r) => r.id);
  assertEqual(dup, []);
});
test('Catalogue complet : noms uniques (pas de doublon déguisé)', () => {
  const seen = new Set();
  const dup = ALL_RECIPES.filter((r) => (seen.has(r.name) ? true : (seen.add(r.name), false))).map((r) => r.name);
  assertEqual(dup, []);
});
test('Catalogue complet : valeurs nutritionnelles calculables pour chaque recette', () => {
  const bad = ALL_RECIPES.filter((r) => !recipeNutrition(r, nutritionCtx).complete).map((r) => r.id);
  assertEqual(bad, []);
});
test('Catalogue complet : calories par portion plausibles (40 à 1 400 kcal)', () => {
  const bad = ALL_RECIPES.map((r) => ({ id: r.id, kcal: Math.round(recipeNutrition(r, nutritionCtx).perPortion.kcal) }))
    .filter((x) => x.kcal < 40 || x.kcal > 1400)
    .map((x) => `${x.id} (${x.kcal})`);
  assertEqual(bad, []);
});
test('Catalogue complet : au moins 580 recettes', () => {
  if (ALL_RECIPES.length < 580) throw new Error(String(ALL_RECIPES.length));
});
test('Catalogue complet : au moins 60 petits-déjeuners et 50 goûters', () => {
  const count = (/** @type {string} */ m) => ALL_RECIPES.filter((r) => recipeMealTypes(r).includes(/** @type {any} */ (m))).length;
  if (count('breakfast') < 60 || count('snack') < 50) throw new Error(`${count('breakfast')} / ${count('snack')}`);
});
test('Catalogue complet : au moins 200 recettes asiatiques', () => {
  const n = ALL_RECIPES.filter((r) => asian.has(r.cuisine)).length;
  if (n < 200) throw new Error(String(n));
});
test('Catalogue complet : chaque étape est une phrase complète', () => {
  const bad = ALL_RECIPES.flatMap((r) => r.methods.flatMap((m) => m.steps.filter((s) => !/[.!?…)]$/.test(s.trim())).map(() => r.id)));
  assertEqual([...new Set(bad)], []);
});
