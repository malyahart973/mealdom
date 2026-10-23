import { test, assertEqual } from './runner.js';
import { normalizeUnitPrice, pointFromPrice, pointFromDriveProduct, seriesByStore, serieTrend, priceChanges, isLowPriceNow } from '../src/domain/stores/priceHistory.js';
import { INGREDIENTS } from '../src/data/ingredients.js';

/** @typedef {import('../src/domain/stores/priceHistory.js').PricePoint} PricePoint */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const rice = ingredients.get('rice_white') ?? null;

/** @param {string} storeId @param {string} date @param {number} unitCents @param {string} [ingredientId] @returns {PricePoint} */
const pt = (storeId, date, unitCents, ingredientId = 'rice_white') => ({
  id: `${storeId}|${ingredientId}|${date}`, ingredientId, storeId, label: '', date, priceCents: unitCents, promoCents: null,
  packageQuantity: 1, packageUnit: 'kg', unitCents, per: 'kg', source: 'manual',
});

test('Prix ramené au kilo, au litre ou à la pièce', () => {
  assertEqual(
    [normalizeUnitPrice(149, 500, 'g', rice), normalizeUnitPrice(135, 40, 'cl', null), normalizeUnitPrice(390, 12, 'piece', ingredients.get('egg') ?? null), normalizeUnitPrice(100, 1, 'pack', null)],
    [{ unitCents: 298, per: 'kg' }, { unitCents: 338, per: 'l' }, { unitCents: 33, per: 'piece' }, { unitCents: null, per: null }],
  );
});

test('Relevé en magasin et produit Drive en promotion deviennent des points d’historique', () => {
  const p = pointFromPrice({ id: 'm|rice_white', storeId: 'm', ingredientId: 'rice_white', label: 'U', packageQuantity: 1, packageUnit: 'kg', priceCents: 189, soldLoose: false, date: '2026-10-20', availability: 'available' }, rice);
  assertEqual([p.unitCents, p.per, p.source, p.date], [189, 'kg', 'manual', '2026-10-20']);
  const d = pointFromDriveProduct(
    { id: 'R1', storeId: 'hu', name: 'Riz', brand: 'U', ingredientId: 'rice_white', packageQuantity: 1, packageUnit: 'kg', priceCents: 200, availability: 'available', quality: [], source: 'drive_manual', checkedAt: '2026-10-22T08:00:00',
      promotion: { type: 'percent', value: 20, label: '-20 %', startDate: '2026-10-20', endDate: '2026-10-26', conditions: '', requiresCard: false } },
    rice,
    { today: '2026-10-22', hasLoyaltyCard: false },
  );
  assertEqual([d?.priceCents, d?.promoCents, d?.unitCents, d?.source], [200, 160, 160, 'drive']);
});

test('Courbes par magasin : un point par jour (le moins cher), triés par date', () => {
  const { per, series } = seriesByStore([pt('a', '2026-10-10', 200), pt('a', '2026-10-01', 180), pt('a', '2026-10-10', 190), pt('b', '2026-10-05', 210)]);
  assertEqual([per, series.get('a'), series.get('b')?.length], ['kg', [{ date: '2026-10-01', unitCents: 180 }, { date: '2026-10-10', unitCents: 190 }], 1]);
});

test('Évolution et plus fortes hausses', () => {
  const trend = serieTrend([{ date: '2026-09-01', unitCents: 200 }, { date: '2026-10-01', unitCents: 150 }, { date: '2026-10-20', unitCents: 230 }]);
  assertEqual([trend?.changePct, trend?.minCents, trend?.maxCents], [15, 150, 230]);
  const changes = priceChanges([pt('a', '2026-09-01', 100, 'tomato'), pt('a', '2026-10-01', 150, 'tomato'), pt('a', '2026-09-01', 200), pt('a', '2026-10-01', 190), pt('b', '2026-10-01', 300)]);
  assertEqual(changes.map((c) => [c.ingredientId, c.trend.changePct]), [['tomato', 50], ['rice_white', -5]]);
});

test('Prix au plus bas en ce moment (au moins 3 relevés sur 4 mois)', () => {
  const low = [pt('a', '2026-08-01', 300, 'mango'), pt('a', '2026-09-01', 250, 'mango'), pt('a', '2026-10-15', 180, 'mango')];
  const high = [pt('a', '2026-08-01', 180, 'mango'), pt('a', '2026-09-01', 250, 'mango'), pt('a', '2026-10-15', 300, 'mango')];
  assertEqual([isLowPriceNow(low, '2026-10-23'), isLowPriceNow(high, '2026-10-23'), isLowPriceNow(low.slice(1), '2026-10-23')], [true, false, false]);
});
