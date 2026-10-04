import { test, assertEqual } from './runner.js';
import { ALLERGENS, isKnownAllergen } from '../src/domain/ingredients/allergens.js';
import { buildNameIndex, findIngredientId, checkAllergens, normalizeText } from '../src/domain/ingredients/ingredients.js';
import { convertUnit } from '../src/domain/ingredients/conversion.js';
import { INGREDIENTS } from '../src/data/ingredients.js';

const catalog = new Map(INGREDIENTS.map((i) => [i.id, i]));
const index = buildNameIndex(INGREDIENTS);
/** @param {string} id */
const ing = (id) => catalog.get(id) ?? null;

// --- Allergènes ---
test('Les 14 allergènes réglementaires sont présents', () => {
  assertEqual(ALLERGENS.length, 14);
  for (const id of ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']) {
    if (!isKnownAllergen(id)) throw new Error(`Allergène manquant : ${id}`);
  }
});

test('Recette sans allergène interdit : compatible', () =>
  assertEqual(checkAllergens(['rice_white', 'chicken', 'onion'], ['peanuts'], catalog), { status: 'compatible' }));

test('Recette avec arachides et allergie aux arachides : incompatible', () =>
  assertEqual(checkAllergens(['chicken', 'peanut'], ['peanuts'], catalog), { status: 'incompatible', found: ['peanuts'] }));

test('La sauce soja est détectée pour le soja ET le gluten', () =>
  assertEqual(checkAllergens(['soy_sauce'], ['gluten', 'soy'], catalog), { status: 'incompatible', found: ['gluten', 'soy'] }));

test('Ingrédient inconnu : jamais déclaré compatible', () =>
  assertEqual(checkAllergens(['chicken', 'mystere'], ['peanuts'], catalog), { status: 'unknown', unknownIngredients: ['mystere'] }));

test('Allergène trouvé : incompatible même si un ingrédient est inconnu', () =>
  assertEqual(checkAllergens(['mystere', 'shrimp'], ['crustaceans'], catalog).status, 'incompatible'));

// --- Reconnaissance des noms ---
test('« Tomates », « tomato » et « TOMATE » désignent la tomate', () => {
  assertEqual(findIngredientId('Tomates', index), 'tomato');
  assertEqual(findIngredientId('tomato', index), 'tomato');
  assertEqual(findIngredientId('  TOMATE ', index), 'tomato');
});

test('Accents et œ ignorés : « OEUFS » = œuf', () => assertEqual(findIngredientId('OEUFS', index), 'egg'));

test('Nom inconnu : aucun ingrédient deviné', () => assertEqual(findIngredientId('fruit du dragon', index), null));

test('Deux ingrédients ne peuvent pas partager un même nom', () => {
  let refused = false;
  try {
    buildNameIndex([
      { id: 'a', name: 'poulet', aliases: [], allergens: [], conversions: [] },
      { id: 'b', name: 'Poulet', aliases: [], allergens: [], conversions: [] },
    ]);
  } catch {
    refused = true;
  }
  assertEqual(refused, true);
});

test('normalizeText simplifie la casse, les accents, les apostrophes et les espaces', () =>
  assertEqual(normalizeText('  Huile   d’Olive ÉPICÉE '), "huile d'olive epicee"));

test('Apostrophe typographique reconnue : « huile d’olive »', () =>
  assertEqual(findIngredientId('huile d’olive', index), 'olive_oil'));

// --- Conversions spécifiques (au moins 5) ---
test('1 cup de riz = 185 g', () => assertEqual(convertUnit(1, 'cup', 'g', ing('rice_white')), { ok: true, value: 185 }));
test('1 cup de farine = 125 g (différent du riz)', () => assertEqual(convertUnit(1, 'cup', 'g', ing('wheat_flour')), { ok: true, value: 125 }));
test('2 cuillères à soupe de beurre = 28,4 g', () => assertEqual(convertUnit(2, 'tbsp', 'g', ing('butter')), { ok: true, value: 28.4 }));
test('3 oignons = 330 g', () => assertEqual(convertUnit(3, 'piece', 'g', ing('onion')), { ok: true, value: 330 }));
test('6 œufs = 0,3 kg (conversion combinée)', () => assertEqual(convertUnit(6, 'piece', 'kg', ing('egg')), { ok: true, value: 0.3 }));
test('246 g de tomate = 2 tomates (sens inverse)', () => assertEqual(convertUnit(246, 'g', 'piece', ing('tomato')), { ok: true, value: 2 }));
test('1 cup de sucre = 200 g', () => assertEqual(convertUnit(1, 'cup', 'g', ing('sugar_white')), { ok: true, value: 200 }));
test('Conversion universelle prioritaire : 1 kg de riz = 1 000 g', () => assertEqual(convertUnit(1, 'kg', 'g', ing('rice_white')), { ok: true, value: 1000 }));
test('Pas de conversion connue pour une pièce de poulet : échec explicite', () =>
  assertEqual(convertUnit(1, 'piece', 'g', ing('chicken')), { ok: false, reason: 'no_conversion' }));
test('« Une pincée » de sel n’est jamais convertie', () =>
  assertEqual(convertUnit(1, 'pinch', 'g', ing('salt')), { ok: false, reason: 'qualitative' }));

// --- Cohérence des données ---
test('Chaque allergène des ingrédients fait partie des 14', () => {
  for (const i of INGREDIENTS) for (const a of i.allergens) if (!isKnownAllergen(a)) throw new Error(`${i.id} : ${a}`);
});
test('Chaque conversion spécifique a une source et un niveau de confiance', () => {
  for (const i of INGREDIENTS)
    for (const c of i.conversions) if (!c.source || !c.confidence || !(c.factor > 0)) throw new Error(i.id);
});
test('Au moins 5 ingrédients ont une conversion spécifique', () => {
  const count = INGREDIENTS.filter((i) => i.conversions.length > 0).length;
  if (count < 5) throw new Error(`Seulement ${count}`);
});
