import { test, assertEqual } from './runner.js';
import { parseIngredientLine, parseRecipeText, parseDuration, matchIngredients, readRecipeAnswer, buildUserRecipe } from '../src/domain/recipes/recipeImport.js';
import { validateRecipe } from '../src/domain/recipes/recipes.js';
import { recipeFamily } from '../src/domain/recipes/families.js';
import { makeIngredientFinder } from '../src/domain/assistant/intent.js';
import { buildNameIndex } from '../src/domain/ingredients/ingredients.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { PREPARATIONS } from '../src/data/preparations.js';
import { CUISINES } from '../src/data/cuisines.js';
import { EQUIPMENT } from '../src/domain/recipes/equipment.js';

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const finder = makeIngredientFinder(buildNameIndex(INGREDIENTS), ingredients);
const find = (/** @type {string} */ name) => finder.findIngredient(name)?.id ?? null;
const refs = { ingredients, preparations: new Map(PREPARATIONS.map((p) => [p.id, p])), cuisines: new Set(CUISINES.map((c) => c.id)), equipment: new Set(EQUIPMENT.map((e) => e.id)) };
/** @param {string} line */
const short = (line) => {
  const l = parseIngredientLine(line);
  return [l.quantity, l.unit, l.name];
};

test('Ligne d’ingrédient : grammes, centilitres, cuillères, fractions, pièces', () =>
  assertEqual(
    ['- 200 g de farine', '20 cl de crème fraîche', '1 c. à soupe d’huile d’olive', '1/2 cuillère à café de muscade', '3 œufs', '1,5 kg de poulet', '2 dl de lait', '½ citron vert', 'deux gousses d’ail'].map(short),
    [[200, 'g', 'farine'], [20, 'cl', 'creme fraiche'], [1, 'tbsp', "huile d'olive"], [0.5, 'tsp', 'muscade'], [3, 'piece', 'oeufs'], [1.5, 'kg', 'poulet'], [200, 'ml', 'lait'], [0.5, 'piece', 'citron vert'], [2, 'clove', "ail"]],
  ));
test('Ligne d’ingrédient sans quantité : « au goût »', () => assertEqual(short('Sel'), [null, 'to_taste', 'sel']));
test('Durées écrites', () => assertEqual(['15 min', '1 h 10', '1h', '45 minutes'].map(parseDuration), [15, 70, 60, 45]));

const MARMITON = `Quiche lorraine
Pour 6 personnes
Préparation : 15 min
Cuisson : 45 min
Ingrédients
- 1 pâte brisée
- 200 g de lardons
- 3 œufs
- 20 cl de crème fraîche
- Sel, poivre
Préparation
1. Préchauffer le four à 180 °C.
2. Faire revenir les lardons
Étape 3 : Battre les œufs avec la crème et verser sur la pâte.`;

test('Recette collée : titre, portions, temps, ingrédients et étapes', () => {
  const d = parseRecipeText(MARMITON);
  assertEqual([d.name, d.servings, d.prepMinutes, d.cookMinutes, d.ingredients.length], ['Quiche lorraine', 6, 15, 45, 6]);
  assertEqual(d.ingredients.map((i) => i.name), ['pate brisee', 'lardons', 'oeufs', 'creme fraiche', 'sel', 'poivre']);
  assertEqual(d.steps, ['Préchauffer le four à 180 °C.', 'Faire revenir les lardons.', 'Battre les œufs avec la crème et verser sur la pâte.']);
});
test('Recette collée : ingrédients reconnus dans le catalogue, les autres restent à choisir', () => {
  const matched = matchIngredients(parseRecipeText(MARMITON).ingredients, find);
  const byName = new Map(matched.map((i) => [i.name, i.ingredientId]));
  assertEqual([byName.get('oeufs'), byName.get('sel'), byName.get('poivre')], ['egg', 'salt', 'black_pepper']);
});
test('Recette Thermomix : les étapes au robot sont séparées', () => {
  const d = parseRecipeText(`Velouté de courgettes
Ingrédients
500 g de courgettes
1 oignon
Préparation
Mettre l’oignon dans le bol et mixer 5 sec/vitesse 5.
Ajouter les courgettes et cuire 20 min/100°C/vitesse 1.
Servir chaud.`);
  assertEqual([d.robotSteps.length, d.steps], [2, ['Servir chaud.']]);
});
test('Recette sans en-têtes : les lignes avec quantité sont des ingrédients', () => {
  const d = parseRecipeText(`Omelette
3 œufs
10 g de beurre
Battre les œufs et les cuire dans le beurre chaud pendant 3 minutes.`);
  assertEqual([d.ingredients.length, d.steps.length], [2, 1]);
});
test('Réponse de l’IA : vérifiée, unités et quantités cohérentes', () => {
  const d = readRecipeAnswer({ found: true, name: 'Colombo', servings: 4, prepMinutes: 20, cookMinutes: 40, ingredients: [{ quantity: 800, unit: 'g', name: 'poulet' }, { quantity: 3, unit: 'to_taste', name: 'sel' }, { quantity: null, unit: 'g', name: 'piment' }], steps: ['Couper le poulet'], robotSteps: [] });
  assertEqual(d?.ingredients.map((i) => [i.quantity, i.unit]), [[800, 'g'], [null, 'to_taste'], [null, 'to_taste']]);
  assertEqual(d?.steps, ['Couper le poulet.']);
  assertEqual(readRecipeAnswer({ found: false }), null);
});
test('Recette personnelle construite : valide, famille choisie, source « Recette personnelle »', () => {
  const recipe = buildUserRecipe(
    {
      id: 'perso_1', name: 'Quiche de mamie', description: '', family: 'tarts', cuisine: 'french', mealTypes: ['lunch', 'dinner'], servings: 6, prepMinutes: 15, cookMinutes: 45, difficulty: 'easy', tags: [],
      ingredients: [{ ingredientId: 'egg', quantity: 3, unit: 'piece' }, { ingredientId: 'salt', quantity: null, unit: 'to_taste' }],
      steps: ['Battre les œufs', 'Cuire 45 minutes.'], robotSteps: ['Mixer 10 sec/vitesse 5'], equipment: ['oven'], otherIngredients: ['1 pâte brisée maison'], sourceUrl: 'https://www.exemple.fr/quiche',
    },
    '2026-10-26',
  );
  assertEqual(validateRecipe(recipe, refs), []);
  assertEqual([recipe.methods.length, recipe.methods[1].equipment, recipe.source.license, recipeFamily(recipe, ingredients)], [2, ['food_processor'], 'Recette personnelle, d’après exemple.fr', 'tarts']);
  assertEqual(recipe.tips.length, 1);
});
