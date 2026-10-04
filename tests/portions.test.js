import { test, assertEqual } from './runner.js';
import { sumPortions, roundUpToHalf, mealPortions, dinnerWithNextLunch } from '../src/domain/portions/portions.js';
import { DEFAULT_PORTION_RULES } from '../src/data/portionRules.js';

const rules = DEFAULT_PORTION_RULES;

test('Un adulte vaut 1 par défaut', () => assertEqual(sumPortions(['adult'], rules), 1));
test('Un enfant vaut 0,5 par défaut', () => assertEqual(sumPortions(['child'], rules), 0.5));
test('2 adultes + 2 enfants = 3 portions', () => assertEqual(sumPortions(['adult', 'adult', 'child', 'child'], rules), 3));
test('Le coefficient enfant est modifiable', () =>
  assertEqual(sumPortions(['adult', 'child'], [{ category: 'adult', label: 'Adulte', coefficient: 1 }, { category: 'child', label: 'Enfant', coefficient: 0.75 }]), 1.75));
test('Arrondi : 2,1 -> 2,5', () => assertEqual(roundUpToHalf(2.1), 2.5));
test('Arrondi : 2,5 -> 2,5', () => assertEqual(roundUpToHalf(2.5), 2.5));
test('Arrondi : 2,6 -> 3', () => assertEqual(roundUpToHalf(2.6), 3));
test('Arrondi : 3 -> 3', () => assertEqual(roundUpToHalf(3), 3));
test('Arrondi sans erreur de calcul : 0,1 + 0,2 -> 0,5', () => assertEqual(roundUpToHalf(0.1 + 0.2), 0.5));
test('Repas avec 1 adulte et 1 enfant = 1,5 portion', () => assertEqual(mealPortions(['adult', 'child'], rules), 1.5));
test('Personne au repas = 0 portion', () => assertEqual(mealPortions([], rules), 0));
test('Catégorie inconnue refusée', () => {
  let refused = false;
  try {
    sumPortions(['ado'], rules);
  } catch {
    refused = true;
  }
  assertEqual(refused, true);
});
test('Dîner (2 adultes + 1 enfant) + déjeuner du lendemain (1 adulte + 1 enfant)', () =>
  assertEqual(dinnerWithNextLunch(['adult', 'adult', 'child'], ['adult', 'child'], rules), { dinner: 2.5, lunch: 1.5, total: 4 }));
