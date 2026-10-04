import { test, assertEqual } from './runner.js';
import {
  validateRecipe,
  validatePreparation,
  findSharedPreparations,
  compatibleMethods,
  isFeasibleWithEquipment,
  recipeAllergens,
  allIngredientIds,
} from '../src/domain/recipes/recipes.js';
import { filterRecipes } from '../src/domain/recipes/recipeFiltering.js';
import { EQUIPMENT } from '../src/domain/recipes/equipment.js';
import { RECIPES } from '../src/data/recipes.js';
import { PREPARATIONS } from '../src/data/preparations.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { CUISINES } from '../src/data/cuisines.js';

/** @typedef {import('../src/domain/recipes/recipes.js').Recipe} Recipe */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const preparations = new Map(PREPARATIONS.map((p) => [p.id, p]));
const refs = {
  ingredients,
  preparations,
  cuisines: new Set(CUISINES.map((c) => c.id)),
  equipment: new Set(EQUIPMENT.map((e) => e.id)),
};
const ctx = { ingredients, preparations, cuisineLabels: new Map(CUISINES.map((c) => [c.id, c.label])) };
const byId = new Map(RECIPES.map((r) => [r.id, r]));
/** @param {string} id @returns {Recipe} */
const recipe = (id) => {
  const r = byId.get(id);
  if (!r) throw new Error(`Recette absente : ${id}`);
  return r;
};

/**
 * Copie d'une recette avec des champs modifies.
 * @param {Partial<Recipe>} changes
 * @returns {Recipe}
 */
const variant = (changes) => ({ ...structuredClone(recipe('chili_con_carne')), ...changes });

// --- Données du catalogue ---
test('Toutes les recettes validées du catalogue sont complètes', () => {
  for (const r of RECIPES.filter((x) => x.status === 'validated')) {
    const errors = validateRecipe(r, refs);
    if (errors.length) throw new Error(`${r.id} : ${errors.join(' / ')}`);
  }
});
test('Toutes les préparations du catalogue sont complètes', () => {
  for (const p of PREPARATIONS) {
    const errors = validatePreparation(p, refs);
    if (errors.length) throw new Error(`${p.id} : ${errors.join(' / ')}`);
  }
});
test('Identifiants de recettes uniques', () => assertEqual(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length));
test('Le catalogue contient des recettes à un seul récipient', () => {
  if (!RECIPES.some((r) => r.vessel !== null)) throw new Error('Aucune');
});

// --- Validation ---
test('Recette sans provenance refusée', () => {
  const r = variant({ source: { type: 'original', author: '', license: '', addedAt: '' } });
  if (validateRecipe(r, refs).length === 0) throw new Error('acceptée à tort');
});
test('Recette avec ingrédient inconnu refusée', () => {
  const r = variant({ ingredients: [{ ingredientId: 'licorne', quantity: 1, unit: 'g' }] });
  if (validateRecipe(r, refs).length === 0) throw new Error('acceptée à tort');
});
test('Recette avec unité inconnue refusée', () => {
  const r = variant({ ingredients: [{ ingredientId: 'onion', quantity: 1, unit: 'brouette' }] });
  if (validateRecipe(r, refs).length === 0) throw new Error('acceptée à tort');
});
test('Quantité manquante refusée (sauf « au goût »)', () => {
  const bad = variant({ ingredients: [{ ingredientId: 'onion', quantity: null, unit: 'piece' }] });
  const ok = variant({ ingredients: [{ ingredientId: 'salt', quantity: null, unit: 'to_taste' }] });
  if (validateRecipe(bad, refs).length === 0) throw new Error('quantité manquante acceptée');
  assertEqual(validateRecipe(ok, refs), []);
});
test('Recette sans méthode de cuisson refusée', () => {
  if (validateRecipe(variant({ methods: [] }), refs).length === 0) throw new Error('acceptée à tort');
});

// --- Préparations partagées (batch cooking) ---
test('Le riz cuit est identifié comme partagé entre plusieurs recettes', () => {
  const users = findSharedPreparations(RECIPES).get('cooked_rice') ?? [];
  for (const id of ['chicken_colombo', 'vegetable_fried_rice', 'chili_con_carne']) {
    if (!users.includes(id)) throw new Error(`${id} absent`);
  }
});
test('Un ingrédient brut commun (oignon) ne crée pas de préparation partagée', () => {
  const a = variant({ id: 'a', preparations: [] });
  const b = variant({ id: 'b', preparations: [] });
  assertEqual(findSharedPreparations([a, b]).size, 0);
});
test('Une préparation utilisée par une seule recette n’est pas « partagée »', () => {
  assertEqual(findSharedPreparations([recipe('chicken_colombo')]).size, 0);
});

// --- Allergènes d'une recette ---
test('Les allergènes des préparations sont pris en compte', () => {
  const ids = allIngredientIds(recipe('chili_con_carne'), preparations);
  if (!ids.includes('rice_white')) throw new Error('riz de la préparation absent');
});
test('Riz sauté : œufs, soja et gluten détectés', () =>
  assertEqual(recipeAllergens(recipe('vegetable_fried_rice'), preparations, ingredients), { allergens: ['eggs', 'gluten', 'soy'], complete: true }));
test('Colombo : moutarde détectée (poudre à colombo)', () => {
  if (!recipeAllergens(recipe('chicken_colombo'), preparations, ingredients).allergens.includes('mustard')) throw new Error('absente');
});
test('Préparation inconnue : liste des allergènes déclarée incomplète', () => {
  const r = variant({ preparations: [{ preparationId: 'inconnue', quantity: 1, unit: 'g' }] });
  assertEqual(recipeAllergens(r, preparations, ingredients).complete, false);
});

// --- Équipement ---
test('Chili réalisable avec seulement un autocuiseur', () =>
  assertEqual(compatibleMethods(recipe('chili_con_carne'), ['pressure_cooker']).map((m) => m.id), ['pressure_cooker']));
test('Colombo non réalisable sans plaques de cuisson', () =>
  assertEqual(compatibleMethods(recipe('chicken_colombo'), ['oven', 'microwave']).length, 0));

// --- Filtrage ---
test('Recherche par ingrédient : « lentilles »', () =>
  assertEqual(filterRecipes(RECIPES, { query: 'lentilles' }, ctx).map((r) => r.id), ['red_lentil_dal']));
test('Recherche par cuisine sans accents : « italienne »', () =>
  assertEqual(filterRecipes(RECIPES, { query: 'ITALIENNE' }, ctx).map((r) => r.id), ['one_pot_pasta_tomato_basil']));
test('Filtre « un seul récipient » : toutes les recettes affichées en ont un', () => {
  for (const r of filterRecipes(RECIPES, { vesselOnly: true }, ctx)) if (!r.vessel) throw new Error(r.id);
});
test('Chili + riz avec seulement un autocuiseur : irréalisable (le riz demande des plaques)', () =>
  assertEqual(isFeasibleWithEquipment(recipe('chili_con_carne'), ['pressure_cooker'], preparations), false));
test('Recette non validée jamais proposée', () => {
  const draft = variant({ id: 'brouillon', status: 'draft' });
  assertEqual(filterRecipes([draft], {}, ctx).length, 0);
});
