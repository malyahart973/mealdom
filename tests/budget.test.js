import { test, assertEqual } from './runner.js';
import { parseAmountToCents, formatCents, centsToInput } from '../src/domain/budget/money.js';
import { monthSummary, weekSummary, validateExpense, createDefaultBudget } from '../src/domain/budget/budget.js';
import { purchaseCost, estimateShoppingCost, validatePrice, validateStore } from '../src/domain/stores/stores.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { weekDays } from '../src/domain/planning/dates.js';

/** @typedef {import('../src/domain/stores/stores.js').Price} Price */
/** @typedef {import('../src/domain/budget/budget.js').Expense} Expense */
/** @typedef {import('../src/domain/shopping/shopping.js').ShoppingLine} ShoppingLine */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
/** @param {string} id */
const ing = (id) => ingredients.get(id) ?? null;

/**
 * @param {Partial<Price>} fields
 * @returns {Price}
 */
const price = (fields) => ({
  id: 'p',
  storeId: 'A',
  ingredientId: 'rice_white',
  label: '',
  packageQuantity: 1,
  packageUnit: 'kg',
  priceCents: 320,
  date: '2026-10-05',
  availability: 'available',
  soldLoose: false,
  ...fields,
});

/**
 * @param {Partial<ShoppingLine>} fields
 * @returns {ShoppingLine}
 */
const line = (fields) => ({
  key: 'k',
  ingredientId: 'rice_white',
  need: 1200,
  unit: 'g',
  inStock: 0,
  toBuy: 1200,
  packages: null,
  buyQuantity: 1200,
  covered: false,
  aisle: 'grocery',
  ...fields,
});

/**
 * @param {string} date
 * @param {number} amountCents
 * @returns {Expense}
 */
const expense = (date, amountCents) => ({ id: date + amountCents, date, storeId: null, storeName: '', amountCents, note: '' });

// --- Montants ---
test('« 42,50 » = 4 250 centimes', () => assertEqual(parseAmountToCents('42,50'), 4250));
test('« 42.5 » = 4 250 centimes', () => assertEqual(parseAmountToCents('42.5'), 4250));
test('« 42 » = 4 200 centimes', () => assertEqual(parseAmountToCents('42'), 4200));
test('« 0,05 » = 5 centimes', () => assertEqual(parseAmountToCents('0,05'), 5));
test('« 1 234,56 € » = 123 456 centimes', () => assertEqual(parseAmountToCents('1 234,56 €'), 123456));
test('Montants invalides refusés (texte, négatif, 3 décimales)', () => {
  for (const t of ['abc', '-3', '1,234', '', '4,5,6']) if (!Number.isNaN(parseAmountToCents(t))) throw new Error(t);
});
test('Pas d’erreur d’arrondi : 0,10 + 0,20 = 30 centimes exactement', () =>
  assertEqual(parseAmountToCents('0,10') + parseAmountToCents('0,20'), 30));
test('Affichage : 4 250 centimes -> 42,50 €', () => assertEqual(formatCents(4250).replace(/\s/g, ' '), '42,50 €'));
test('Saisie : 4 205 centimes -> « 42,05 »', () => assertEqual(centsToInput(4205), '42,05'));

// --- Coût d'achat chez un magasin ---
test('1 200 g de riz, sac de 1 kg à 3,20 € : 2 sacs, 6,40 €', () =>
  assertEqual(purchaseCost(1200, 'g', price({}), ing('rice_white')), { packages: 2, cents: 640 }));
test('1 200 g, paquet de 700 g à 3 € : 2 paquets, 6 €', () =>
  assertEqual(purchaseCost(1200, 'g', price({ packageQuantity: 700, packageUnit: 'g', priceCents: 300 }), ing('rice_white')), { packages: 2, cents: 600 }));
test('Poulet au poids, 8,90 € le kilo, 200 g : 1,78 €', () =>
  assertEqual(purchaseCost(200, 'g', price({ ingredientId: 'chicken', priceCents: 890, soldLoose: true }), ing('chicken')), { packages: null, cents: 178 }));
test('Avocats à la pièce, 0,80 € pièce, 2 avocats : 1,60 €', () =>
  assertEqual(purchaseCost(2, 'piece', price({ ingredientId: 'avocado', packageQuantity: 1, packageUnit: 'piece', priceCents: 80, soldLoose: true }), ing('avocado')), { packages: null, cents: 160 }));
test('Au détail, l’arrondi se fait au centime le plus proche', () =>
  assertEqual(purchaseCost(333, 'g', price({ priceCents: 100, soldLoose: true }), ing('rice_white'))?.cents, 33));
test('Disponibilité inconnue : jamais comptée comme disponible', () =>
  assertEqual(purchaseCost(500, 'g', price({ availability: 'unknown' }), ing('rice_white')), null));
test('Produit indisponible : pas de coût', () => assertEqual(purchaseCost(500, 'g', price({ availability: 'unavailable' }), ing('rice_white')), null));
test('Oignons au kilo pour un besoin en pièces : conversion connue (3 oignons = 330 g -> 1 kg)', () =>
  assertEqual(purchaseCost(3, 'piece', price({ ingredientId: 'onion', priceCents: 250 }), ing('onion')), { packages: 1, cents: 250 }));
test('Courgettes au kilo pour un besoin en pièces : pas de conversion connue, pas de prix', () =>
  assertEqual(purchaseCost(2, 'piece', price({ ingredientId: 'zucchini' }), ing('zucchini')), null));

// --- Estimation de la liste ---
test('Le prix le moins cher connu est retenu', () => {
  const e = estimateShoppingCost([line({})], [price({ id: 'a', storeId: 'A' }), price({ id: 'b', storeId: 'B', priceCents: 290 })], ingredients);
  assertEqual([e.totalCents, e.lines[0].best?.storeId, e.complete], [580, 'B', true]);
});
test('Prix manquant : estimation marquée incomplète, l’article est listé', () => {
  const e = estimateShoppingCost([line({}), line({ key: 'p', ingredientId: 'pasta' })], [price({})], ingredients);
  assertEqual([e.totalCents, e.complete, e.missing], [640, false, ['pasta']]);
});
test('Articles couverts par le stock : ni coût, ni prix manquant', () => {
  const e = estimateShoppingCost([line({ covered: true, toBuy: 0 })], [], ingredients);
  assertEqual([e.totalCents, e.complete], [0, true]);
});
test('Quantités « au goût » : ni coût, ni prix manquant', () => {
  const e = estimateShoppingCost([line({ need: null, toBuy: null, unit: 'to_taste' })], [], ingredients);
  assertEqual(e.missing, []);
});

// --- Budget ---
const budget = { ...createDefaultBudget(), monthlyCents: 45000, weeklyCents: 11000 };
test('Une dépense de 42,50 € ajoute 4 250 centimes au dépensé', () =>
  assertEqual(monthSummary(budget, [expense('2026-10-03', 4250)], '2026-10', '2026-10-05').spentCents, 4250));
test('Reste du mois = budget - dépenses du mois seulement', () => {
  const s = monthSummary(budget, [expense('2026-10-03', 10000), expense('2026-09-28', 9999)], '2026-10', '2026-10-05');
  assertEqual([s.spentCents, s.remainingCents], [10000, 35000]);
});
test('Budget exceptionnel ajouté au budget du mois concerné', () => {
  const b = { ...budget, exceptional: [{ month: '2026-10', label: 'anniversaire', amountCents: 5000 }, { month: '2026-11', label: 'x', amountCents: 999 }] };
  assertEqual(monthSummary(b, [], '2026-10', '2026-10-05').budgetCents, 50000);
});
test('Dépassement : reste négatif', () => assertEqual(monthSummary(budget, [expense('2026-10-03', 50000)], '2026-10', '2026-10-05').remainingCents, -5000));
test('Prévision au rythme actuel : 100 € en 10 jours -> 310 € sur 31 jours', () =>
  assertEqual(monthSummary(budget, [expense('2026-10-02', 10000)], '2026-10', '2026-10-10').forecastCents, 31000));
test('Pas de budget défini : reste non calculé', () =>
  assertEqual(monthSummary(createDefaultBudget(), [expense('2026-10-02', 100)], '2026-10', '2026-10-10').remainingCents, null));
test('Semaine : seules les dépenses du lundi au dimanche comptent', () => {
  const s = weekSummary(budget, [expense('2026-10-05', 3000), expense('2026-10-11', 2000), expense('2026-10-12', 999)], weekDays('2026-10-05'));
  assertEqual([s.spentCents, s.remainingCents], [5000, 6000]);
});

// --- Validation ---
test('Dépense sans montant refusée', () => {
  if (validateExpense(expense('2026-10-05', 0)).length === 0) throw new Error('acceptée');
});
test('Dépense avec montant non entier refusée', () => {
  if (validateExpense(expense('2026-10-05', Number.NaN)).length === 0) throw new Error('acceptée');
});
test('Magasin sans nom refusé', () => {
  if (validateStore({ id: 'x', name: ' ', type: 'market', commune: '' }).length === 0) throw new Error('accepté');
});
test('Prix sans contenu refusé', () => {
  if (validatePrice(price({ packageQuantity: 0 }), ingredients).length === 0) throw new Error('accepté');
});
test('Prix complet accepté', () => assertEqual(validatePrice(price({}), ingredients), []));
