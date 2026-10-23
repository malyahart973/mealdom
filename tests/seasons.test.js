import { test, assertEqual } from './runner.js';
import { inSeason, favouredNow, seasonalIngredients, validateCalendar } from '../src/domain/ingredients/seasons.js';
import { PEYI_PRODUCE } from '../src/data/seasons.js';
import { parseRequest, makeIngredientFinder } from '../src/domain/assistant/intent.js';
import { buildNameIndex } from '../src/domain/ingredients/ingredients.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { PREPARATIONS } from '../src/data/preparations.js';

/** @typedef {import('../src/domain/recipes/recipes.js').Recipe} Recipe */

const ids = new Set(INGREDIENTS.map((i) => i.id));
const preparations = new Map(PREPARATIONS.map((p) => [p.id, p]));

test('Saisons : les produits péyi sont des ingrédients connus', () => {
  assertEqual(PEYI_PRODUCE.filter((id) => !ids.has(id)), []);
});

test('Saisons : calendrier de la cliente, mois en cours', () => {
  const calendar = { mango: [9, 10, 11, 12, 1], avocado: [6, 7, 8] };
  assertEqual([[...inSeason(calendar, 10)], [...inSeason(calendar, 7)], validateCalendar({ x: [0, 13] }).length], [['mango'], ['avocado'], 1]);
});

test('Saisons : de saison, prix au plus bas et péyi favorisés ; hors saison déclaré exclu', () => {
  const f = favouredNow({ calendar: { mango: [9, 10], avocado: [6, 7] }, month: 10, lowPrice: new Set(['carrot']), peyi: ['avocado', 'banana'] });
  assertEqual([...f].sort(), ['banana', 'carrot', 'mango']);
});

test('Saisons : ingrédients de saison d’une recette', () => {
  const r = /** @type {Recipe} */ (/** @type {unknown} */ ({ id: 'r', ingredients: [{ ingredientId: 'pumpkin' }, { ingredientId: 'coconut_milk' }, { ingredientId: 'christophine' }], preparations: [] }));
  assertEqual(seasonalIngredients(r, preparations, new Set(PEYI_PRODUCE)), ['pumpkin', 'christophine']);
});

test('Assistant : « des produits locaux » et « de saison » demandent le mode saison', () => {
  /** @param {string} t */
  const modes = (t) => parseRequest(t, { today: '2026-10-23', monday: '2026-10-19', ...makeIngredientFinder(buildNameIndex(INGREDIENTS), new Map(INGREDIENTS.map((i) => [i.id, i]))) }).modes;
  assertEqual([modes('Des repas avec des produits locaux'), modes('Cuisine de saison cette semaine'), modes('Des produits bio')], [['seasonal'], ['seasonal'], ['quality']]);
});
