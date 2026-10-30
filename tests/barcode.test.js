import { test, assertEqual } from './runner.js';
import { isValidBarcode, parsePackageQuantity, readOpenFoodFacts } from '../src/domain/stores/barcode.js';

test('Code-barres : clé de contrôle EAN-13, EAN-8 et UPC-A', () =>
  assertEqual(
    ['3017620422003', '3017620422004', '96385074', '036000291452', '12345', 'abc'].map(isValidBarcode),
    [true, false, true, true, false, false],
  ));
test('Contenance écrite sur l’emballage', () =>
  assertEqual(
    ['500 g', '1 L', '4 x 125 g', '33 cl', '1,5 kg', 'environ'].map(parsePackageQuantity),
    [{ quantity: 500, unit: 'g' }, { quantity: 1, unit: 'l' }, { quantity: 500, unit: 'g' }, { quantity: 33, unit: 'cl' }, { quantity: 1.5, unit: 'kg' }, null],
  ));
test('Fiche Open Food Facts : nom français, marque, contenance, calories', () =>
  assertEqual(
    readOpenFoodFacts(
      { status: 1, product: { product_name: 'Basmati rice', product_name_fr: 'Riz basmati', brands: 'U, Système U', quantity: '1 kg', product_quantity: '1000', product_quantity_unit: 'g', nutriments: { 'energy-kcal_100g': 351 } } },
      '3256220000000',
    ),
    { code: '3256220000000', name: 'Riz basmati', brand: 'U', packageSize: { quantity: 1000, unit: 'g' }, kcalPer100g: 351 },
  ));
test('Fiche Open Food Facts : produit inconnu', () =>
  assertEqual([readOpenFoodFacts({ status: 0 }, '1'), readOpenFoodFacts({ status: 1, product: { brands: 'X' } }, '1')], [null, null]));
test('Fiche Open Food Facts : contenance lue dans le texte si le nombre manque', () =>
  assertEqual(readOpenFoodFacts({ status: 1, product: { product_name: 'Yaourt nature', quantity: '4 x 125 g' } }, '1')?.packageSize, { quantity: 500, unit: 'g' }));
