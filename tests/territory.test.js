import { test, assertEqual } from './runner.js';
import { makeAvailability, usableSubstitute, recipeLocalIssues, autoSubstitutions, isFeasibleLocally, rareCount } from '../src/domain/ingredients/territory.js';
import { GUYANE_HINTS } from '../src/data/territory.js';
import { SUBSTITUTES, substitutesFor } from '../src/domain/assistant/substitutes.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { PREPARATIONS } from '../src/data/preparations.js';
import { ALL_RECIPES } from '../src/data/allRecipes.js';

/** @typedef {import('../src/domain/recipes/recipes.js').Recipe} Recipe */

const preparations = new Map(PREPARATIONS.map((p) => [p.id, p]));
const ids = new Set(INGREDIENTS.map((i) => i.id));
/** @param {string} id @param {string[]} ingredientIds @param {{ preparationId: string, quantity: number, unit: string }[]} [preps] @returns {Recipe} */
const recipe = (id, ingredientIds, preps = []) =>
  /** @type {Recipe} */ (/** @type {unknown} */ ({ id, name: id, ingredients: ingredientIds.map((i) => ({ ingredientId: i, quantity: 100, unit: 'g', note: '' })), preparations: preps }));

test('Guyane : indications et alternatives ne citent que des ingrédients connus', () => {
  const unknown = [...Object.keys(GUYANE_HINTS), ...Object.entries(SUBSTITUTES).flatMap(([k, v]) => [k, ...v])].filter((id) => !ids.has(id));
  assertEqual(unknown, []);
});

test('Guyane : la réponse de la cliente prime sur l’indication par défaut', () => {
  const a = makeAvailability(GUYANE_HINTS, { gochujang: 'found', tomato: 'missing' });
  assertEqual([a('gochujang'), a('tomato'), a('doenjang'), a('miso'), a('rice_white')], ['common', 'missing', 'rare', 'specialty', 'common']);
});

test('Guyane : alternative trouvable seulement (jamais une autre rareté ou un introuvable)', () => {
  const a = makeAvailability(GUYANE_HINTS, { doubanjiang: 'missing' });
  assertEqual([usableSubstitute('gochujang', a, substitutesFor), usableSubstitute('doenjang', makeAvailability(GUYANE_HINTS, {}), substitutesFor)], ['sriracha', 'miso']);
});

test('Guyane : ingrédient introuvable remplacé d’office par son alternative', () => {
  const a = makeAvailability(GUYANE_HINTS, { gochujang: 'missing' });
  assertEqual(autoSubstitutions(recipe('r', ['gochujang', 'rice_white']), a, substitutesFor), [{ from: 'gochujang', to: 'doubanjiang' }]);
});

test('Guyane : recette impossible si l’introuvable n’a pas d’alternative', () => {
  const a = makeAvailability(GUYANE_HINTS, { nori: 'missing' });
  assertEqual([isFeasibleLocally(recipe('r', ['nori', 'rice_sushi']), preparations, a, substitutesFor), isFeasibleLocally(recipe('r', ['rice_sushi']), preparations, a, substitutesFor)], [false, true]);
});

test('Guyane : ingrédients rares comptés pour classer la recette plus bas', () => {
  const a = makeAvailability(GUYANE_HINTS, {});
  const r = recipe('r', ['gochujang', 'gochugaru', 'tofu', 'onion']);
  assertEqual([rareCount(r, preparations, a), recipeLocalIssues(r, preparations, a, substitutesFor).map((i) => i.level)], [2, ['rare', 'rare', 'specialty']]);
});

test('Guyane : le catalogue garde de nombreuses recettes sans ingrédient rare', () => {
  const a = makeAvailability(GUYANE_HINTS, {});
  const easy = ALL_RECIPES.filter((r) => rareCount(r, preparations, a) === 0).length;
  if (easy < 500) throw new Error(`seulement ${easy} recettes faciles`);
});
