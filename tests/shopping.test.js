import { test, assertEqual } from './runner.js';
import { aggregateNeeds, buildShoppingLines, mealNeedLines, validateInventoryItem, validatePackage, shoppingListText, expiryStatus, itemsToUseFirst } from '../src/domain/shopping/shopping.js';
import { createDefaultHousehold, upsertMember } from '../src/domain/household/household.js';
import { DEFAULT_PORTION_RULES } from '../src/data/portionRules.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { RECIPES } from '../src/data/recipes.js';
import { PREPARATIONS } from '../src/data/preparations.js';
import { AISLES } from '../src/domain/ingredients/ingredients.js';

/** @typedef {import('../src/domain/shopping/shopping.js').InventoryItem} InventoryItem */
/** @typedef {import('../src/domain/shopping/shopping.js').NeedLine} NeedLine */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const recipes = new Map(RECIPES.map((r) => [r.id, r]));
const preparations = new Map(PREPARATIONS.map((p) => [p.id, p]));

/**
 * @param {string} ingredientId
 * @param {number | null} quantity
 * @param {string} unit
 * @returns {NeedLine}
 */
const line = (ingredientId, quantity, unit) => ({ ingredientId, quantity, unit });

/**
 * @param {string} ingredientId
 * @param {number} quantity
 * @param {string} unit
 * @returns {InventoryItem}
 */
const stock = (ingredientId, quantity, unit) => ({ id: `${ingredientId}-${quantity}${unit}`, ingredientId, quantity, unit, location: 'pantry' });

/**
 * Raccourci : besoins -> lignes de courses.
 * @param {NeedLine[]} lines
 * @param {InventoryItem[]} [inventory]
 * @param {import('../src/domain/shopping/shopping.js').Package[]} [packages]
 */
const shop = (lines, inventory = [], packages = []) =>
  buildShoppingLines(aggregateNeeds(lines, ingredients), inventory, packages, ingredients);

// --- Agrégation ---
test('300 g + 400 g de riz = 700 g', () =>
  assertEqual(aggregateNeeds([line('rice_white', 300, 'g'), line('rice_white', 400, 'g')], ingredients).map((n) => [n.quantity, n.unit]), [[700, 'g']]));
test('0,5 kg + 250 g = 750 g (unités converties)', () =>
  assertEqual(aggregateNeeds([line('rice_white', 0.5, 'kg'), line('rice_white', 250, 'g')], ingredients)[0].quantity, 750));
test('Ingrédients différents jamais additionnés', () =>
  assertEqual(aggregateNeeds([line('rice_white', 300, 'g'), line('pasta', 400, 'g')], ingredients).length, 2));
test('Pièces et grammes de tomate fusionnés grâce à la conversion connue (1 tomate = 123 g)', () =>
  assertEqual(aggregateNeeds([line('tomato', 200, 'g'), line('tomato', 2, 'piece')], ingredients).map((n) => [n.quantity, n.unit]), [[446, 'g']]));
test('Pièces et grammes sans conversion connue : deux lignes séparées', () =>
  assertEqual(aggregateNeeds([line('zucchini', 200, 'g'), line('zucchini', 1, 'piece')], ingredients).length, 2));
test('L’eau n’est jamais sur la liste de courses', () => assertEqual(aggregateNeeds([line('water', 1, 'l')], ingredients), []));
test('« Au goût » reste qualitatif, une seule fois', () =>
  assertEqual(aggregateNeeds([line('salt', null, 'to_taste'), line('salt', null, 'pinch')], ingredients).map((n) => n.quantity), [null]));
test('Cuillères additionnées en cuillères à café : 2 c. à soupe + 1 c. à café = 7 c. à café', () =>
  assertEqual(aggregateNeeds([line('cumin', 2, 'tbsp'), line('cumin', 1, 'tsp')], ingredients).map((n) => [n.quantity, n.unit]), [[7, 'tsp']]));

// --- Stock ---
test('Besoin 1 000 g, stock 400 g : 600 g à acheter', () => assertEqual(shop([line('rice_white', 1000, 'g')], [stock('rice_white', 400, 'g')])[0].toBuy, 600));
test('Stock en kg déduit d’un besoin en g', () => assertEqual(shop([line('rice_white', 1000, 'g')], [stock('rice_white', 0.25, 'kg')])[0].toBuy, 750));
test('Stock suffisant : rien à acheter', () => {
  const l = shop([line('rice_white', 300, 'g')], [stock('rice_white', 1, 'kg')])[0];
  assertEqual([l.covered, l.toBuy, l.inStock], [true, 0, 300]);
});
test('Stock en pièces déduit d’un besoin en grammes (conversion connue)', () =>
  assertEqual(shop([line('onion', 330, 'g')], [stock('onion', 2, 'piece')])[0].toBuy, 110));
test('Stock d’un autre ingrédient sans effet', () => assertEqual(shop([line('rice_white', 300, 'g')], [stock('pasta', 1, 'kg')])[0].toBuy, 300));
test('Un même stock n’est pas utilisé deux fois', () => {
  const lines = shop([line('tomato', 2, 'piece'), line('tomato', 200, 'g')], [stock('tomato', 500, 'g')]);
  assertEqual(lines.map((l) => l.toBuy), [0]);
});
test('« Au goût » couvert si l’ingrédient est en stock', () => assertEqual(shop([line('salt', null, 'to_taste')], [stock('salt', 500, 'g')])[0].covered, true));
test('« Au goût » à vérifier s’il n’est pas en stock', () => assertEqual(shop([line('salt', null, 'to_taste')])[0].covered, false));

// --- Conditionnements ---
const riceBag = { ingredientId: 'rice_white', label: 'sac', quantity: 700, unit: 'g' };
test('Besoin 625 g, sac de 700 g : 1 sac', () => assertEqual(shop([line('rice_white', 625, 'g')], [], [riceBag])[0].packages?.count, 1));
test('Besoin 1 200 g, sac de 700 g : 2 sacs', () => assertEqual(shop([line('rice_white', 1200, 'g')], [], [riceBag])[0].packages?.count, 2));
test('Sac de 1 kg pour un besoin de 1 500 g : 2 sacs', () =>
  assertEqual(shop([line('rice_white', 1500, 'g')], [], [{ ...riceBag, quantity: 1, unit: 'kg' }])[0].packages?.count, 2));
test('Le conditionnement s’applique après le stock', () =>
  assertEqual(shop([line('rice_white', 1000, 'g')], [stock('rice_white', 400, 'g')], [riceBag])[0].packages?.count, 1));
test('Sans conditionnement : 2,5 oignons -> 3 oignons', () => assertEqual(shop([line('onion', 2.5, 'piece')])[0].buyQuantity, 3));
test('Sans conditionnement : 437 g -> 440 g', () => assertEqual(shop([line('rice_white', 437, 'g')])[0].buyQuantity, 440));

// --- Depuis les repas ---
let household = createDefaultHousehold(DEFAULT_PORTION_RULES);
household = upsertMember(household, { id: 'A', name: 'A', category: 'adult', allergens: [], diet: null, dislikes: [] });
household = upsertMember(household, { id: 'B', name: 'B', category: 'adult', allergens: [], diet: null, dislikes: [] });
/** @type {import('../src/domain/planning/planning.js').Meal[]} */
const meals = [
  { id: 'm1', date: '2026-10-05', slot: 'dinner', recipeId: 'chicken_colombo', recipeName: '', attendees: ['A', 'B'], guests: 0, nextLunch: null, locked: false },
  { id: 'm2', date: '2026-10-06', slot: 'dinner', recipeId: 'red_lentil_dal', recipeName: '', attendees: ['A', 'B'], guests: 0, nextLunch: null, locked: false },
];
const weekNeeds = aggregateNeeds(mealNeedLines(meals, household, recipes, preparations), ingredients);

test('Repas de la semaine : le riz des préparations est compté (2 repas x 300 g cuits -> 225 g cru)', () =>
  assertEqual(weekNeeds.find((n) => n.ingredientId === 'rice_white')?.quantity, 225));
test('Repas de la semaine : poulet du colombo pour 2 portions = 400 g', () =>
  assertEqual(weekNeeds.find((n) => n.ingredientId === 'chicken')?.quantity, 400));
test('Repas de la semaine : oignons des deux recettes additionnés (0,5 + 0,5 = 1)', () =>
  assertEqual(weekNeeds.find((n) => n.ingredientId === 'onion')?.quantity, 1));
test('Repas de la semaine : pas d’eau dans la liste', () => assertEqual(weekNeeds.some((n) => n.ingredientId === 'water'), false));

// --- Données et validation ---
test('Chaque ingrédient acheté a un rayon connu', () => {
  const ids = new Set(AISLES.map((a) => a.id));
  for (const i of INGREDIENTS) if (!i.notPurchased && (!i.aisle || !ids.has(i.aisle))) throw new Error(i.id);
});
test('Stock : quantité négative refusée', () => {
  if (validateInventoryItem({ ...stock('rice_white', -1, 'g') }, ingredients).length === 0) throw new Error('acceptée');
});
test('Stock : ingrédient inconnu refusé', () => {
  if (validateInventoryItem({ ...stock('licorne', 1, 'g') }, ingredients).length === 0) throw new Error('accepté');
});
test('Conditionnement : contenu nul refusé', () => {
  if (validatePackage({ ...riceBag, quantity: 0 }, ingredients).length === 0) throw new Error('accepté');
});
test('Conditionnement : unité « au goût » refusée', () => {
  if (validatePackage({ ...riceBag, unit: 'to_taste' }, ingredients).length === 0) throw new Error('accepté');
});

test('Partage : liste par rayon, articles déjà pris exclus, ajouts à la main en fin', () => {
  /** @param {string} id @param {string} aisle @returns {import('../src/domain/shopping/shopping.js').ShoppingLine} */
  const l = (id, aisle) => ({ key: id, ingredientId: id, need: 1, unit: 'kg', inStock: 0, toBuy: 1, packages: null, buyQuantity: 1, covered: false, aisle: /** @type {any} */ (aisle) });
  const { text, count } = shoppingListText([l('tomato', 'fruits_vegetables'), l('rice_white', 'grocery'), l('onion', 'fruits_vegetables')], { week: 'w', checked: ['onion'], extras: [{ id: 'x', label: 'Papier toilette', checked: false }] }, {
    title: 'Liste de courses',
    aisles: [{ id: 'fruits_vegetables', label: 'Fruits et légumes' }, { id: 'grocery', label: 'Épicerie' }],
    name: (id) => ({ tomato: 'Tomate', rice_white: 'Riz blanc', onion: 'Oignon' })[id] ?? id,
    describe: () => '1 kg',
  });
  assertEqual([count, text], [3, 'Liste de courses\n\nFRUITS ET LÉGUMES\n- Tomate : 1 kg\n\nÉPICERIE\n- Riz blanc : 1 kg\n\nEN PLUS\n- Papier toilette']);
});

test('Péremption : périmé, aujourd’hui, bientôt (3 jours), plus tard, sans date', () => {
  /** @param {string | null} d @returns {InventoryItem} */
  const item = (d) => ({ id: d ?? 'x', ingredientId: 'milk', quantity: 1, unit: 'l', location: 'fridge', expiresOn: d });
  assertEqual(
    ['2026-10-20', '2026-10-23', '2026-10-26', '2026-10-27', null].map((d) => expiryStatus(item(d), '2026-10-23')),
    [{ status: 'expired', days: -3 }, { status: 'today', days: 0 }, { status: 'soon', days: 3 }, { status: 'ok', days: 4 }, { status: null, days: null }],
  );
});

test('Péremption : produits à consommer en priorité, les plus urgents d’abord, stock vide exclu', () => {
  /** @type {InventoryItem[]} */
  const items = [
    { id: 'a', ingredientId: 'milk', quantity: 1, unit: 'l', location: 'fridge', expiresOn: '2026-10-25' },
    { id: 'b', ingredientId: 'yogurt', quantity: 4, unit: 'piece', location: 'fridge', expiresOn: '2026-10-22' },
    { id: 'c', ingredientId: 'cream', quantity: 0, unit: 'ml', location: 'fridge', expiresOn: '2026-10-23' },
    { id: 'd', ingredientId: 'rice_white', quantity: 1, unit: 'kg', location: 'pantry', expiresOn: '2027-05-01' },
  ];
  assertEqual(itemsToUseFirst(items, '2026-10-23').map((i) => i.id), ['b', 'a']);
});

test('Péremption : date limite invalide refusée', () => {
  assertEqual(validateInventoryItem({ id: 'x', ingredientId: 'milk', quantity: 1, unit: 'l', location: 'fridge', expiresOn: '23/10/2026' }, ingredients).length, 1);
});
