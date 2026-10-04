import { test, assertEqual } from './runner.js';
import { convertUniversal, isQualitative, UNITS } from '../src/domain/units/units.js';

test('1 kg = 1 000 g', () => assertEqual(convertUniversal(1, 'kg', 'g'), { ok: true, value: 1000 }));
test('1 500 g = 1,5 kg', () => assertEqual(convertUniversal(1500, 'g', 'kg'), { ok: true, value: 1.5 }));
test('250 mg = 0,25 g', () => assertEqual(convertUniversal(250, 'mg', 'g'), { ok: true, value: 0.25 }));
test('1 L = 1 000 ml', () => assertEqual(convertUniversal(1, 'l', 'ml'), { ok: true, value: 1000 }));
test('75 cl = 750 ml', () => assertEqual(convertUniversal(75, 'cl', 'ml'), { ok: true, value: 750 }));
test('330 ml = 33 cl', () => assertEqual(convertUniversal(330, 'ml', 'cl'), { ok: true, value: 33 }));
test('20 cl = 0,2 L', () => assertEqual(convertUniversal(20, 'cl', 'l'), { ok: true, value: 0.2 }));
test('3 cuillères à café = 1 cuillère à soupe', () => assertEqual(convertUniversal(3, 'tsp', 'tbsp'), { ok: true, value: 1 }));

test('Pas de conversion universelle entre masse et volume', () =>
  assertEqual(convertUniversal(1, 'cup', 'g'), { ok: false, reason: 'no_conversion' }));
test('Pas de conversion universelle pour une pièce', () =>
  assertEqual(convertUniversal(2, 'piece', 'g'), { ok: false, reason: 'no_conversion' }));
test('« Au goût » ne se convertit jamais', () =>
  assertEqual(convertUniversal(1, 'to_taste', 'g'), { ok: false, reason: 'qualitative' }));
test('« Une pincée » est qualitative', () => assertEqual(isQualitative('pinch'), true));
test('Unité inconnue signalée', () =>
  assertEqual(convertUniversal(1, 'boisseau', 'g'), { ok: false, reason: 'unknown_unit' }));
test('Toutes les unités du cahier des charges existent', () => {
  const ids = UNITS.map((u) => u.id);
  for (const id of ['mg', 'g', 'kg', 'ml', 'cl', 'l', 'piece', 'slice', 'tsp', 'tbsp', 'cup', 'handful', 'sachet', 'can', 'pack', 'bottle']) {
    if (!ids.includes(id)) throw new Error(`Unité manquante : ${id}`);
  }
});
