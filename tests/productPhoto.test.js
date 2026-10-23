import { test, assertEqual } from './runner.js';
import { readPhotoAnswer, isValidEan, PHOTO_SCHEMA } from '../src/domain/drive/productPhoto.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { buildNameIndex, findIngredientId } from '../src/domain/ingredients/ingredients.js';

const nameIndex = buildNameIndex(INGREDIENTS);
/** @param {string} n */
const find = (n) => findIngredientId(n, nameIndex);

/** @param {Record<string, string>} f */
const answer = (f) => ({ name: 'Riz long grain', brand: 'Prix Mini', quantity: '1', unit: 'kg', price: '1,49', unitPrice: '1,49 €/kg', promotion: '', barcode: '', ingredient: 'riz blanc', notes: '', ...f });

test('Photo : étiquette lue, formulaire rempli sans rien à vérifier', () => {
  const r = readPhotoAnswer(answer({}), find);
  assertEqual([r.name, r.brand, r.packageQuantity, r.packageUnit, r.priceCents, r.ingredientId, r.warnings], ['Riz long grain', 'Prix Mini', 1, 'kg', 149, 'rice_white', []]);
});

test('Photo : prix et contenance illisibles laissés vides et signalés (jamais devinés)', () => {
  const r = readPhotoAnswer(answer({ price: '', quantity: '', unit: '' }), find);
  assertEqual([r.priceCents, r.packageQuantity, r.packageUnit, r.warnings.length], [null, null, null, 2]);
});

test('Photo : ingrédient inconnu = à choisir dans la liste', () => {
  const r = readPhotoAnswer(answer({ ingredient: 'fruit du dragon' }), find);
  assertEqual([r.ingredientId, r.warnings[0].includes('fruit du dragon')], [null, true]);
});

test('Photo : promotion lue signalée pour compléter son type et ses dates', () => {
  const r = readPhotoAnswer(answer({ promotion: '-30 %' }), find);
  assertEqual([r.promotionText, r.warnings.some((w) => w.includes('-30 %'))], ['-30 %', true]);
});

test('Photo : code-barres repris seulement si sa clé de contrôle est juste', () => {
  assertEqual([isValidEan('4006381333931'), isValidEan('96385074'), isValidEan('4006381333932'), isValidEan('12345')], [true, true, false, false]);
  assertEqual(readPhotoAnswer(answer({ barcode: '4006381333932' }), find).barcode, '');
  assertEqual(readPhotoAnswer(answer({ barcode: '4006 3813 3393 1' }), find).barcode, '4006381333931');
});

test('Photo : réponse vide ou malformée sans plantage', () => {
  const r = readPhotoAnswer(null, find);
  assertEqual([r.name, r.priceCents, r.warnings.length >= 3], ['', null, true]);
});

test('Photo : schéma de réponse strict (tous les champs requis, aucun autre)', () => {
  assertEqual([PHOTO_SCHEMA.additionalProperties, PHOTO_SCHEMA.required.length, Object.keys(PHOTO_SCHEMA.properties).length], [false, 10, 10]);
});
