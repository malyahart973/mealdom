import { test, assertEqual } from './runner.js';
import { toIsoDate, parseIsoDate, addDays, weekStart, weekDays } from '../src/domain/planning/dates.js';
import {
  mealPortionsFor,
  validateMeal,
  saveMealIn,
  removeMealFrom,
  plannedEntries,
  planningGrid,
  slotKey,
} from '../src/domain/planning/planning.js';
import { createDefaultHousehold, upsertMember } from '../src/domain/household/household.js';
import { DEFAULT_PORTION_RULES } from '../src/data/portionRules.js';

/** @typedef {import('../src/domain/planning/planning.js').Meal} Meal */

// Foyer : 2 adultes (A, B) et 2 enfants (C, D)
let household = createDefaultHousehold(DEFAULT_PORTION_RULES);
for (const [id, category] of [['A', 'adult'], ['B', 'adult'], ['C', 'child'], ['D', 'child']]) {
  household = upsertMember(household, { id, name: id, category, allergens: [], diet: null, dislikes: [] });
}
const recipeIds = new Set(['chili_con_carne', 'chicken_colombo']);

/**
 * @param {Partial<Meal>} fields
 * @returns {Meal}
 */
const meal = (fields) => ({
  id: 'm1',
  date: '2026-10-05',
  slot: 'dinner',
  recipeId: 'chili_con_carne',
  recipeName: 'Chili con carne',
  attendees: ['A', 'B', 'C', 'D'],
  guests: 0,
  nextLunch: null,
  locked: false,
  ...fields,
});

// --- Dates ---
test('Date locale au format AAAA-MM-JJ', () => assertEqual(toIsoDate(new Date(2026, 0, 5)), '2026-01-05'));
test('Date impossible refusée (31 février)', () => assertEqual(parseIsoDate('2026-02-31'), null));
test('Passage au mois suivant', () => assertEqual(addDays('2026-10-31', 1), '2026-11-01'));
test('Passage à l’année suivante', () => assertEqual(addDays('2026-12-31', 1), '2027-01-01'));
test('La semaine commence le lundi (samedi 3 octobre -> lundi 28 septembre)', () =>
  assertEqual(weekStart('2026-10-03'), '2026-09-28'));
test('Un dimanche appartient à la semaine du lundi précédent', () => assertEqual(weekStart('2026-10-04'), '2026-09-28'));
test('Une semaine compte 7 jours du lundi au dimanche', () => {
  const days = weekDays('2026-10-05');
  assertEqual([days.length, days[0], days[6]], [7, '2026-10-05', '2026-10-11']);
});

// --- Portions ---
test('Repas pour 2 adultes + 2 enfants = 3 portions', () => assertEqual(mealPortionsFor(meal({}), household).meal, 3));
test('Un invité compte comme un adulte', () => assertEqual(mealPortionsFor(meal({ guests: 1 }), household).meal, 4));
test('Dîner (4 personnes) + déjeuner du lendemain (1 adulte + 1 enfant) = 3 + 1,5 = 4,5', () =>
  assertEqual(mealPortionsFor(meal({ nextLunch: { attendees: ['A', 'C'], guests: 0 } }), household), {
    meal: 3,
    nextLunch: 1.5,
    total: 4.5,
  }));
test('Une personne retirée du foyer n’est plus comptée', () =>
  assertEqual(mealPortionsFor(meal({ attendees: ['A', 'disparu'] }), household).meal, 1));

// --- Validation ---
test('Repas complet accepté', () => assertEqual(validateMeal(meal({}), [], household, recipeIds), []));
test('Recette obligatoire', () => {
  if (validateMeal(meal({ recipeId: '' }), [], household, recipeIds).length === 0) throw new Error('accepté');
});
test('Au moins une personne à table', () => {
  if (validateMeal(meal({ attendees: [], guests: 0 }), [], household, recipeIds).length === 0) throw new Error('accepté');
});
test('Nombre d’invités invalide refusé', () => {
  if (validateMeal(meal({ guests: -1 }), [], household, recipeIds).length === 0) throw new Error('accepté');
});
test('Créneau déjà occupé refusé', () => {
  const other = meal({ id: 'm2' });
  if (validateMeal(meal({}), [other], household, recipeIds).length === 0) throw new Error('accepté');
});
test('Modifier un repas sur son propre créneau est accepté', () =>
  assertEqual(validateMeal(meal({ guests: 2 }), [meal({})], household, recipeIds), []));
test('Seul un dîner peut prévoir le déjeuner du lendemain', () => {
  const m = meal({ slot: 'lunch', nextLunch: { attendees: ['A'], guests: 0 } });
  if (validateMeal(m, [], household, recipeIds).length === 0) throw new Error('accepté');
});
test('Déjeuner du lendemain déjà pris : refusé', () => {
  const lunch = meal({ id: 'm2', date: '2026-10-06', slot: 'lunch' });
  const dinner = meal({ nextLunch: { attendees: ['A'], guests: 0 } });
  if (validateMeal(dinner, [lunch], household, recipeIds).length === 0) throw new Error('accepté');
});
test('Les restes occupent le déjeuner du lendemain', () => {
  const dinner = meal({ nextLunch: { attendees: ['A'], guests: 0 } });
  const lunch = meal({ id: 'm2', date: '2026-10-06', slot: 'lunch' });
  if (validateMeal(lunch, [dinner], household, recipeIds).length === 0) throw new Error('accepté');
  assertEqual(plannedEntries([dinner]).get(slotKey('2026-10-06', 'lunch'))?.kind, 'leftover');
});

// --- Modifications et verrouillage ---
test('Ajouter un repas ne modifie pas les autres', () => {
  const locked = meal({ id: 'L', date: '2026-10-07', locked: true });
  const result = saveMealIn([locked], meal({ id: 'new', date: '2026-10-08' }));
  if (!result.ok) throw new Error(result.error);
  assertEqual(result.meals[0], locked);
});
test('Un repas verrouillé ne peut pas changer de recette', () => {
  const locked = meal({ locked: true });
  assertEqual(saveMealIn([locked], { ...locked, recipeId: 'chicken_colombo' }).ok, false);
});
test('Un repas verrouillé ne peut pas être déplacé', () => {
  const locked = meal({ locked: true });
  assertEqual(saveMealIn([locked], { ...locked, date: '2026-10-09' }).ok, false);
});
test('Un repas verrouillé peut être déverrouillé', () => {
  const locked = meal({ locked: true });
  assertEqual(saveMealIn([locked], { ...locked, locked: false }).ok, true);
});
test('Un repas verrouillé ne peut pas être retiré', () => assertEqual(removeMealFrom([meal({ locked: true })], 'm1').ok, false));
test('Retirer un repas non verrouillé', () => {
  const r = removeMealFrom([meal({}), meal({ id: 'm2', date: '2026-10-06' })], 'm1');
  if (!r.ok) throw new Error(r.error);
  assertEqual(r.meals.map((m) => m.id), ['m2']);
});
test('Déplacer un repas libère l’ancien créneau', () => {
  const r = saveMealIn([meal({})], meal({ date: '2026-10-07' }));
  if (!r.ok) throw new Error(r.error);
  const grid = planningGrid(r.meals, ['2026-10-05', '2026-10-07'], ['dinner']);
  assertEqual([grid[0].slots[0].entry, grid[1].slots[0].entry?.meal.id], [null, 'm1']);
});
