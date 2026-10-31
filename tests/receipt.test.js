import { test, assertEqual } from './runner.js';
import { readReceiptAnswer, receiptPrice, matchStore } from '../src/domain/stores/receipt.js';

test('Ticket lu par l’IA : articles vérifiés, lignes sans prix ou sans nom écartées', () => {
  const r = readReceiptAnswer({
    found: true, storeName: 'Hyper U Cayenne', date: '2026-10-30', totalEuros: 12.35,
    lines: [
      { label: 'LAIT 1L', name: 'lait', count: 2, packageQuantity: 1, packageUnit: 'l', priceEuros: 2.3, weighed: false },
      { label: 'REMISE', name: '', count: 1, packageQuantity: null, packageUnit: 'piece', priceEuros: 1, weighed: false },
      { label: 'SAC', name: 'sac', count: 1, packageQuantity: 1, packageUnit: 'piece', priceEuros: 0, weighed: false },
      { label: 'TOMATE', name: 'tomates', count: 99, packageQuantity: 0.85, packageUnit: 'kg', priceEuros: 3.4, weighed: true },
    ],
  });
  assertEqual([r?.storeName, r?.date, r?.totalCents, r?.lines.length, r?.lines[1].count], ['Hyper U Cayenne', '2026-10-30', 1235, 2, 1]);
  assertEqual([readReceiptAnswer({ found: false, lines: [] }), readReceiptAnswer({ found: true, storeName: '', date: '30/10', totalEuros: null, lines: [] })], [null, null]);
});

test('Prix d’un article : par conditionnement, ou au kilo pour un article pesé', () => {
  const base = { label: '', name: '', count: 2, packageQuantity: 1, packageUnit: 'l', priceCents: 230, soldLoose: false };
  assertEqual(receiptPrice(base), { packageQuantity: 1, packageUnit: 'l', priceCents: 115, soldLoose: false });
  assertEqual(receiptPrice({ ...base, count: 1, packageQuantity: 850, packageUnit: 'g', priceCents: 340, soldLoose: true }), { packageQuantity: 1, packageUnit: 'kg', priceCents: 400, soldLoose: true });
  assertEqual(receiptPrice({ ...base, packageQuantity: null }), null);
});

test('Magasin du ticket retrouvé parmi les magasins enregistrés', () => {
  const stores = [{ id: 'hu', name: 'Hyper U' }, { id: 'ca', name: 'Carrefour Matoury' }];
  assertEqual([matchStore('HYPER U CAYENNE', stores), matchStore('Carrefour Market Cayenne', stores), matchStore('Leader Price', stores), matchStore('', stores)], ['hu', null, null, null]);
});
