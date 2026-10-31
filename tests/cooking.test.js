import { test, assertEqual } from './runner.js';
import { stepTimers, scaledLines, cookingMethods, clampPortions } from '../src/domain/recipes/cooking.js';
import { ALL_RECIPES } from '../src/data/allRecipes.js';

const recipes = new Map(ALL_RECIPES.map((r) => [r.id, r]));
/** @param {string} id */
const recipe = (id) => {
  const r = recipes.get(id);
  if (!r) throw new Error(id);
  return r;
};

test('Minuteurs : une fourchette prend la durée la plus courte', () => {
  assertEqual(stepTimers('Cuire à petits bouillons, en général 10 à 12 minutes.'), [{ seconds: 600, label: '10 à 12 min' }]);
  assertEqual(stepTimers('Cuire à 190 °C pendant 18 à 22 minutes en deux fournées.'), [{ seconds: 1080, label: '18 à 22 min' }]);
});

test('Minuteurs : heures et minutes, secondes, plusieurs durées', () => {
  assertEqual(stepTimers('Cuire 1 h 30 à feu doux.'), [{ seconds: 5400, label: '1 h 30' }]);
  assertEqual(stepTimers('Mixer 30 sec / vitesse 5.'), [{ seconds: 30, label: '30 s' }]);
  assertEqual(stepTimers('Mijoter 2 heures, puis 45 min à découvert.').map((t) => t.seconds), [7200, 2700]);
});

test('Minuteurs : en toutes lettres ; pas de minuteur pour une température ou une nuit', () => {
  assertEqual(stepTimers('Laisser reposer une demi-heure.'), [{ seconds: 1800, label: 'une demi-heure' }]);
  assertEqual([stepTimers('Préchauffer le four à 200 °C.'), stepTimers('Laisser mariner une nuit.'), stepTimers('Ajouter 2 c. à soupe d’huile.')], [[], [], []]);
});

test('Minuteurs : la plupart des recettes en proposent au moins un', () => {
  const withTimer = ALL_RECIPES.filter((r) => r.methods.some((m) => m.steps.some((s) => stepTimers(s).length > 0)));
  assertEqual(withTimer.length / ALL_RECIPES.length > 0.7, true);
});

test('Quantités pour un autre nombre de portions (arrondi au-dessus)', () => {
  const colombo = recipe('chicken_colombo');
  const double = scaledLines(colombo, colombo.servings * 2);
  const first = colombo.ingredients.find((l) => l.quantity !== null);
  const scaledFirst = double.ingredients.find((l) => l.ingredientId === first?.ingredientId);
  assertEqual([double.factor, (scaledFirst?.quantity ?? 0) >= (first?.quantity ?? 0) * 2, double.preparations.length], [2, true, colombo.preparations.length]);
});

test('Portions : de 1 à 24, par demi-portion', () => {
  assertEqual([clampPortions(0), clampPortions(2.3), clampPortions(40), clampPortions(Number.NaN)], [1, 2.5, 24, 1]);
});

test('Méthodes : celles du matériel du foyer, sinon toutes', () => {
  const chili = recipe('chili_con_carne');
  assertEqual(cookingMethods(chili, ['pressure_cooker']).methods.map((m) => m.id), ['pressure_cooker']);
  const none = cookingMethods(chili, []);
  assertEqual([none.allCompatible, none.methods.length], [false, chili.methods.length]);
});
