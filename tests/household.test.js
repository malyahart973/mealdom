import { test, assertEqual } from './runner.js';
import {
  createDefaultHousehold,
  upsertMember,
  removeMember,
  validateMember,
  setCoefficient,
  DEFAULT_EQUIPMENT,
} from '../src/domain/household/household.js';
import { evaluateRecipeForHousehold } from '../src/domain/household/compatibility.js';
import { filterRecipes } from '../src/domain/recipes/recipeFiltering.js';
import { sumPortions } from '../src/domain/portions/portions.js';
import { DEFAULT_PORTION_RULES } from '../src/data/portionRules.js';
import { RECIPES } from '../src/data/recipes.js';
import { PREPARATIONS } from '../src/data/preparations.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { CUISINES } from '../src/data/cuisines.js';

/** @typedef {import('../src/domain/household/household.js').Member} Member */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const preparations = new Map(PREPARATIONS.map((p) => [p.id, p]));
const ctx = { ingredients, preparations, cuisineLabels: new Map(CUISINES.map((c) => [c.id, c.label])) };
const recipe = (/** @type {string} */ id) => {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};

/**
 * @param {Partial<Member>} fields
 * @returns {Member}
 */
const member = (fields) => ({ id: 'x', name: 'Léa', category: 'adult', allergens: [], diet: null, dislikes: [], ...fields });

const empty = createDefaultHousehold(DEFAULT_PORTION_RULES);
/** @param {Member[]} members */
const withMembers = (...members) => members.reduce((h, m) => upsertMember(h, m), empty);

// --- Foyer ---
test('Foyer par défaut : aucun membre, plaques/four/micro-ondes, portions par défaut', () => {
  assertEqual(empty.members, []);
  assertEqual(empty.equipment, DEFAULT_EQUIPMENT);
  assertEqual(empty.portionRules, DEFAULT_PORTION_RULES);
});
test('Ajouter puis modifier un membre (même identifiant)', () => {
  const h1 = upsertMember(empty, member({ id: 'a', name: ' Léa ' }));
  const h2 = upsertMember(h1, member({ id: 'a', name: 'Léa B.' }));
  assertEqual(h2.members.map((m) => m.name), ['Léa B.']);
  assertEqual(h1.members.map((m) => m.name), ['Léa']);
});
test('Retirer un membre', () => assertEqual(removeMember(withMembers(member({ id: 'a' }), member({ id: 'b' })), 'a').members.map((m) => m.id), ['b']));
test('Prénom obligatoire', () => {
  if (validateMember(member({ name: '  ' }), empty).length === 0) throw new Error('accepté');
});
test('Catégorie d’âge obligatoire', () => {
  if (validateMember(member({ category: '' }), empty).length === 0) throw new Error('accepté');
});
test('Allergène inconnu refusé', () => {
  if (validateMember(member({ allergens: ['poussière'] }), empty).length === 0) throw new Error('accepté');
});
test('Membre complet accepté', () => assertEqual(validateMember(member({ allergens: ['milk'], diet: 'vegetarian' }), empty), []));
test('Coefficient enfant modifiable et utilisé par le calcul des portions', () => {
  const r = setCoefficient(empty, 'child', 0.75);
  if (!r.ok) throw new Error(r.error);
  assertEqual(sumPortions(['adult', 'child'], r.household.portionRules), 1.75);
});
test('La portion adulte reste la référence (1)', () => assertEqual(setCoefficient(empty, 'adult', 2).ok, false));
test('Coefficient hors limites refusé', () => {
  assertEqual(setCoefficient(empty, 'child', 0).ok, false);
  assertEqual(setCoefficient(empty, 'child', 3).ok, false);
  assertEqual(setCoefficient(empty, 'child', Number.NaN).ok, false);
});

// --- Compatibilité recette / foyer ---
test('Foyer sans contrainte : toutes les recettes conviennent', () =>
  assertEqual(filterRecipes(RECIPES, { household: empty }, ctx).length, RECIPES.length));

test('Allergie au lait : pâtes au parmesan exclues, avec la raison et le prénom', () => {
  const h = withMembers(member({ name: 'Léa', allergens: ['milk'] }));
  assertEqual(evaluateRecipeForHousehold(recipe('one_pot_pasta_tomato_basil'), h, ctx), {
    status: 'incompatible',
    reasons: [{ type: 'allergen', allergen: 'milk', members: ['Léa'] }],
  });
});

test('Allergie au gluten : riz sauté exclu (gluten caché dans la sauce soja)', () => {
  const h = withMembers(member({ allergens: ['gluten'] }));
  const ids = filterRecipes(RECIPES, { household: h }, ctx).map((r) => r.id);
  if (ids.includes('vegetable_fried_rice') || ids.includes('one_pot_pasta_tomato_basil')) throw new Error(ids.join(','));
  if (!ids.includes('red_lentil_dal')) throw new Error('dal exclu à tort');
});

test('Végétarien : ni poulet, ni bœuf, ni parmesan (présure animale)', () => {
  const h = withMembers(member({ diet: 'vegetarian' }));
  assertEqual(filterRecipes(RECIPES, { household: h }, ctx).map((r) => r.id).sort(), ['red_lentil_dal', 'vegetable_fried_rice']);
});

test('Végétalien : les œufs du riz sauté l’excluent', () => {
  const h = withMembers(member({ diet: 'vegan' }));
  assertEqual(filterRecipes(RECIPES, { household: h }, ctx).map((r) => r.id), ['red_lentil_dal']);
});

test('Sans porc : aucune recette actuelle exclue', () => {
  const h = withMembers(member({ diet: 'no_pork' }));
  assertEqual(filterRecipes(RECIPES, { household: h }, ctx).length, RECIPES.length);
});

test('Aliment refusé : la courgette exclut le colombo', () => {
  const h = withMembers(member({ name: 'Sam', dislikes: ['zucchini'] }));
  assertEqual(evaluateRecipeForHousehold(recipe('chicken_colombo'), h, ctx).reasons, [
    { type: 'dislike', ingredientId: 'zucchini', members: ['Sam'] },
  ]);
});

test('Plusieurs membres concernés par la même allergie : tous nommés', () => {
  const h = withMembers(member({ id: 'a', name: 'Léa', allergens: ['eggs'] }), member({ id: 'b', name: 'Sam', allergens: ['eggs'] }));
  assertEqual(evaluateRecipeForHousehold(recipe('vegetable_fried_rice'), h, ctx).reasons[0], {
    type: 'allergen',
    allergen: 'eggs',
    members: ['Léa', 'Sam'],
  });
});

test('Sans plaques de cuisson : aucune recette proposée', () => {
  const h = { ...empty, equipment: ['oven', 'microwave'] };
  assertEqual(filterRecipes(RECIPES, { household: h }, ctx).length, 0);
});

test('Ingrédient inconnu : recette jamais proposée au foyer', () => {
  const r = { ...recipe('red_lentil_dal'), id: 'test', ingredients: [{ ingredientId: 'mystere', quantity: 1, unit: 'g' }] };
  assertEqual(evaluateRecipeForHousehold(r, empty, ctx).status, 'unknown');
  assertEqual(filterRecipes([r], { household: empty }, ctx).length, 0);
});

test('Sans filtre foyer, toutes les recettes validées restent consultables', () => {
  const h = withMembers(member({ diet: 'vegan' }));
  assertEqual(filterRecipes(RECIPES, { household: null }, ctx).length, RECIPES.length);
  assertEqual(filterRecipes(RECIPES, { household: h }, ctx).length, 1);
});
