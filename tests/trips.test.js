import { test, assertEqual } from './runner.js';
import {
  tripCostCents,
  storeLineCosts,
  groupShopping,
  validateTrip,
  validateCar,
  mealsBeforeTrip,
  tripCalendar,
  upcomingTrip,
} from '../src/domain/trips/trips.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { validateStore } from '../src/domain/stores/stores.js';

/** @typedef {import('../src/domain/stores/stores.js').Store} Store */
/** @typedef {import('../src/domain/stores/stores.js').Price} Price */
/** @typedef {import('../src/domain/shopping/shopping.js').ShoppingLine} ShoppingLine */
/** @typedef {import('../src/domain/trips/trips.js').ShoppingTrip} ShoppingTrip */
/** @typedef {import('../src/domain/planning/planning.js').Meal} Meal */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const NOW = new Date('2026-10-22T10:00:00');

/** @type {Store[]} */
const stores = [
  { id: 'A', name: 'Hyper U Cayenne', type: 'hypermarket', commune: 'Cayenne', distanceKm: 6, travelMinutes: 15 },
  { id: 'B', name: 'Marché', type: 'market', commune: 'Cayenne', distanceKm: 3, travelMinutes: 10 },
  { id: 'C', name: 'Discount', type: 'discount', commune: 'Matoury', distanceKm: 12, travelMinutes: 20 },
];

/** @param {string} storeId @param {string} ingredientId @param {number} cents @param {boolean} [loose] @returns {Price} */
const price = (storeId, ingredientId, cents, loose = false) => ({
  id: `${storeId}|${ingredientId}`,
  storeId,
  ingredientId,
  label: '',
  packageQuantity: 1,
  packageUnit: 'kg',
  priceCents: cents,
  soldLoose: loose,
  date: '2026-10-20',
  availability: 'available',
});

const prices = [
  price('A', 'rice_white', 200),
  price('A', 'tomato', 400),
  price('A', 'chicken', 900),
  price('B', 'tomato', 250, true),
  price('C', 'rice_white', 150),
  price('C', 'chicken', 850),
];

/** @param {string} ingredientId @param {number} toBuy @returns {ShoppingLine} */
const line = (ingredientId, toBuy) => ({ key: `${ingredientId}|g`, ingredientId, need: toBuy, unit: 'g', inStock: 0, toBuy, packages: null, buyQuantity: toBuy, covered: false, aisle: 'grocery' });
const lines = [line('rice_white', 1000), line('tomato', 1000), line('chicken', 1000)];
const costs = storeLineCosts(lines, stores, {
  products: [],
  prices,
  ingredients,
  today: '2026-10-22',
  now: NOW,
  hasLoyaltyCard: false,
  preference: 'cheapest',
});
const car = { consumptionL100: 6, fuelCentsPerLiter: 190 };

test('Trajet : aller-retour 6 km à 6 L/100 et 1,90 €/L = 1,37 €', () => {
  assertEqual(tripCostCents(stores[0], car), 137);
});

test('Trajet : à pied ou à vélo (consommation 0) = gratuit ; distance inconnue = non chiffré', () => {
  assertEqual(tripCostCents(stores[0], { consumptionL100: 0, fuelCentsPerLiter: null }), 0);
  assertEqual(tripCostCents({ ...stores[0], distanceKm: null }, car), null);
  assertEqual(tripCostCents(stores[0], { consumptionL100: 6, fuelCentsPerLiter: null }), null);
});

test('Coût par magasin : seuls les magasins où le prix est connu', () => {
  assertEqual([...(costs.get('tomato|g') ?? new Map()).keys()].sort(), ['A', 'B']);
  assertEqual(costs.get('chicken|g')?.get('C'), { cents: 850, kind: 'manual' });
});

test('Regroupement : un seul magasin si un deuxième fait économiser moins que le trajet', () => {
  const g = groupShopping(lines, costs, stores, car, { fewerTrips: false });
  assertEqual([g.recommended?.storeIds, g.recommended?.totalCents, g.recommended?.covered], [['A'], 1637, 3]);
});

test('Regroupement : deux magasins conseillés si l’économie dépasse le seuil', () => {
  const noCar = { consumptionL100: null, fuelCentsPerLiter: null };
  const g = groupShopping(lines, costs, stores, noCar, { fewerTrips: false });
  assertEqual([g.recommended?.storeIds.slice().sort(), g.recommended?.itemsCents, g.recommended?.unknownTrips.length], [['B', 'C'], 1250, 2]);
  assertEqual(g.reason.includes('trajets non comptés'), true);
});

test('Regroupement : objectif « limiter les trajets » relève le seuil', () => {
  const noCar = { consumptionL100: null, fuelCentsPerLiter: null };
  const g = groupShopping(lines, costs, stores, noCar, { fewerTrips: true });
  assertEqual(g.recommended?.storeIds, ['A']);
});

test('Regroupement : un plan complet passe avant un plan moins cher mais incomplet', () => {
  const g = groupShopping(lines, costs, stores, car, { fewerTrips: false });
  assertEqual([g.plans[0].covered, g.plans.find((p) => p.storeIds.length === 1 && p.storeIds[0] === 'C')?.missingKeys], [3, ['tomato|g']]);
});

test('Regroupement : article sans prix nulle part listé à part, jamais inventé', () => {
  const more = [...lines, line('pasta', 500)];
  const g = groupShopping(more, storeLineCosts(more, stores, { products: [], prices, ingredients, today: '2026-10-22', now: NOW, hasLoyaltyCard: false, preference: 'cheapest' }), stores, car, { fewerTrips: false });
  assertEqual([g.unpricedKeys, g.recommended?.covered, g.toBuyCount], [['pasta|g'], 3, 4]);
});

test('Regroupement : sans aucun prix, aucune recommandation', () => {
  const g = groupShopping(lines, new Map(), stores, car, { fewerTrips: false });
  assertEqual([g.recommended, g.plans.length], [null, 0]);
});

test('Validation : trajet, voiture et sortie courses', () => {
  assertEqual(validateStore(stores[0]), []);
  assertEqual(validateStore({ ...stores[0], distanceKm: -1, travelMinutes: 2.5 }).length, 2);
  assertEqual(validateCar({ consumptionL100: 6.5, fuelCentsPerLiter: 185 }), []);
  assertEqual(validateCar({ consumptionL100: 50, fuelCentsPerLiter: 185 }).length, 1);
  /** @type {ShoppingTrip} */
  const trip = { week: '2026-10-19', date: '2026-10-24', time: '9:30', storeIds: [], driveSlot: { date: '2026-10-24', start: '11:00', end: '10:30' }, note: '', updatedAt: '' };
  assertEqual(validateTrip(trip).length, 3);
});

/** @param {string} date @param {Meal['slot']} slot @returns {Meal} */
const meal = (date, slot) => ({ id: `${date}-${slot}`, date, slot, recipeId: 'r', recipeName: 'R', attendees: [], guests: 0, nextLunch: null, locked: false });

test('Repas prévus avant les courses : jours précédents et repas du jour déjà passés', () => {
  /** @type {ShoppingTrip} */
  const trip = { week: '2026-10-19', date: '2026-10-21', time: '10:00', storeIds: ['A'], driveSlot: null, note: '', updatedAt: '' };
  const meals = [meal('2026-10-19', 'dinner'), meal('2026-10-21', 'breakfast'), meal('2026-10-21', 'lunch'), meal('2026-10-25', 'dinner'), meal('2026-10-27', 'lunch')];
  assertEqual(mealsBeforeTrip(meals, trip, '2026-10-19').map((m) => m.id), ['2026-10-19-dinner', '2026-10-21-breakfast']);
});

test('Agenda : sortie courses et retrait Drive avec rappels, texte échappé', () => {
  /** @type {ShoppingTrip} */
  const trip = { week: '2026-10-19', date: '2026-10-24', time: '09:30', storeIds: ['A', 'B'], driveSlot: { date: '2026-10-24', start: '10:00', end: '10:30' }, note: 'Sacs, glacière', updatedAt: '' };
  const ics = tripCalendar(trip, new Map(stores.map((s) => [s.id, s.name])), 50, ['2 magasins'], '20261022T100000Z');
  assertEqual(
    [
      ics.includes('DTSTART:20261024T093000\r\n'),
      ics.includes('DTEND:20261024T102000\r\n'),
      ics.includes('SUMMARY:Courses : Hyper U Cayenne\\, Marché'),
      ics.includes('Sacs\\, glacière'),
      ics.includes('SUMMARY:Retrait Drive'),
      ics.split('BEGIN:VALARM').length - 1,
      ics.endsWith('END:VCALENDAR\r\n'),
    ],
    [true, true, true, true, true, 2, true],
  );
});

test('Rappel : sortie courses dans les 2 jours', () => {
  /** @type {ShoppingTrip} */
  const t = { week: '2026-10-19', date: '2026-10-24', time: '09:30', storeIds: ['A'], driveSlot: null, note: '', updatedAt: '' };
  assertEqual([upcomingTrip([t], '2026-10-22')?.date, upcomingTrip([t], '2026-10-21'), upcomingTrip([t], '2026-10-25')], ['2026-10-24', null, null]);
});
