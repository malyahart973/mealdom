import { test, assertEqual } from './runner.js';
import {
  productCost,
  promotionStatus,
  isFresh,
  chooseProduct,
  packagesNeeded,
  parseDriveCsv,
  checkOrder,
  validatePromotion,
  activePromotions,
  HYPER_U_CAYENNE,
  importTemplate,
  isStoreBrand,
} from '../src/domain/drive/drive.js';
import { quoteShoppingLines, compareQuotes } from '../src/domain/drive/quote.js';
import { INGREDIENTS } from '../src/data/ingredients.js';
import { buildNameIndex, findIngredientId } from '../src/domain/ingredients/ingredients.js';

/** @typedef {import('../src/domain/drive/drive.js').DriveProduct} DriveProduct */
/** @typedef {import('../src/domain/shopping/shopping.js').ShoppingLine} ShoppingLine */

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const nameIndex = buildNameIndex(INGREDIENTS);
const NOW = new Date('2026-10-22T10:00:00');
const TODAY = '2026-10-22';

/** @param {Partial<DriveProduct>} f @returns {DriveProduct} */
const product = (f) => ({
  id: 'p1',
  storeId: HYPER_U_CAYENNE.id,
  name: 'Riz long 1 kg',
  brand: 'U',
  ingredientId: 'rice_white',
  packageQuantity: 1,
  packageUnit: 'kg',
  priceCents: 250,
  availability: 'available',
  quality: [],
  promotion: null,
  source: 'drive_import',
  checkedAt: '2026-10-22T08:00:00',
  ...f,
});
/** @param {Partial<import('../src/domain/drive/drive.js').Promotion>} f */
const promo = (f) => ({ type: /** @type {const} */ ('percent'), value: 20, label: '-20 %', startDate: '2026-10-20', endDate: '2026-10-26', conditions: '', requiresCard: false, ...f });
const ctx = { today: TODAY, hasLoyaltyCard: false };

// --- Promotions ---
test('Promotion -20 % appliquée pendant ses dates', () => assertEqual(productCost(product({ promotion: promo({}) }), 2, ctx).cents, 400));
test('Promotion terminée : jamais appliquée', () =>
  assertEqual(productCost(product({ promotion: promo({ endDate: '2026-10-21' }) }), 2, ctx), { cents: 500, regularCents: 500, savingCents: 0, promoApplied: false, promoNote: null }));
test('Promotion à venir : signalée mais pas appliquée', () => {
  const c = productCost(product({ promotion: promo({ startDate: '2026-10-25' }) }), 1, ctx);
  assertEqual([c.cents, c.promoApplied, c.promoNote], [250, false, 'Offre à partir du 2026-10-25']);
});
test('Offre carte de fidélité : non appliquée sans la carte', () => assertEqual(productCost(product({ promotion: promo({ requiresCard: true }) }), 1, ctx).cents, 250));
test('Offre carte de fidélité : appliquée avec la carte', () =>
  assertEqual(productCost(product({ promotion: promo({ requiresCard: true }) }), 1, { ...ctx, hasLoyaltyCard: true }).cents, 200));
test('« 2e à -50 % » : 3 articles = 2 plein tarif + 1 à moitié prix', () =>
  assertEqual(productCost(product({ promotion: promo({ type: 'second_half', value: 50 }) }), 3, ctx).cents, 625));
test('« 3 pour 2 » : la remise ne porte que sur les lots complets', () => {
  const p = product({ promotion: promo({ type: 'n_for_m', value: 0, buy: 3, pay: 2, label: '3 pour 2' }) });
  assertEqual([productCost(p, 3, ctx).cents, productCost(p, 4, ctx).cents], [500, 750]);
});
test('« 3 pour 2 » avec 2 articles : rien d’appliqué, explication donnée', () => {
  const c = productCost(product({ promotion: promo({ type: 'n_for_m', value: 0, buy: 3, pay: 2, label: '3 pour 2' }) }), 2, ctx);
  assertEqual([c.cents, c.promoNote], [500, 'Offre « 3 pour 2 » valable dès 3 articles : il vous en faut 2.']);
});
test('Prix promo fixe', () => assertEqual(productCost(product({ promotion: promo({ type: 'price', value: 199 }) }), 2, ctx).cents, 398));
test('Promotion invalide refusée (fin avant début)', () => {
  if (validatePromotion(promo({ startDate: '2026-10-26', endDate: '2026-10-20' })).length === 0) throw new Error('acceptée');
});
test('Statut d’une promotion', () =>
  assertEqual([promotionStatus(promo({}), TODAY), promotionStatus(null, TODAY), promotionStatus(promo({ endDate: '2026-10-01' }), TODAY)], ['active', 'none', 'expired']));
test('Promotions actives : produit indisponible exclu', () =>
  assertEqual(activePromotions([product({ promotion: promo({}) }), product({ id: 'p2', promotion: promo({}), availability: 'unavailable' })], TODAY).map((p) => p.id), ['p1']));

// --- Fraîcheur et conditionnement ---
test('Prix relevé il y a 2 h : vérifié', () => assertEqual(isFresh(product({}), NOW), true));
test('Prix relevé il y a 3 jours : à revérifier', () => assertEqual(isFresh(product({ checkedAt: '2026-10-19T08:00:00' }), NOW), false));
test('1,3 kg de riz en paquets de 1 kg = 2 paquets', () => assertEqual(packagesNeeded(1300, 'g', product({}), ingredients.get('rice_white') ?? null), 2));

// --- Choix du produit ---
const choiceCtx = { today: TODAY, now: NOW, hasLoyaltyCard: false, preference: /** @type {const} */ ('cheapest'), ingredient: ingredients.get('rice_white') ?? null };
const products = [
  product({ id: 'cheap', priceCents: 199 }),
  product({ id: 'bio', priceCents: 349, quality: ['organic'] }),
  product({ id: 'promo', priceCents: 260, promotion: promo({ value: 30 }) }),
  product({ id: 'out', priceCents: 99, availability: 'unavailable' }),
];
const need = { ingredientId: 'rice_white', quantity: 900, unit: 'g' };
test('Choix « moins cher » : la promo à 1,82 € bat le riz à 1,99 €', () => assertEqual(chooseProduct(need, products, choiceCtx).choice?.product.id, 'promo'));
test('Produit indisponible jamais choisi', () => {
  if (chooseProduct(need, products, choiceCtx).alternatives.some((a) => a.product.id === 'out')) throw new Error('proposé');
});
test('Choix « qualité » : le produit bio passe devant', () => assertEqual(chooseProduct(need, products, { ...choiceCtx, preference: 'quality' }).choice?.product.id, 'bio'));
test('Produit choisi par le client respecté', () => assertEqual(chooseProduct(need, products, { ...choiceCtx, preferredId: 'cheap' }).choice?.product.id, 'cheap'));
test('Marques du magasin : U, U Bio, Prix Mini ; pas les autres marques', () =>
  assertEqual(
    [product({ brand: 'U' }), product({ brand: 'U Bio' }), product({ brand: 'Prix Mini' }), product({ brand: '', name: 'Riz Prix Mini 1 kg' }), product({ brand: 'Uncle Ben’s' }), product({ brand: 'Taureau Ailé' })].map(isStoreBrand),
    [true, true, true, true, false, false],
  ));
const brands = [
  product({ id: 'national', brand: 'Taureau Ailé', priceCents: 189 }),
  product({ id: 'u', brand: 'U', priceCents: 215 }),
  product({ id: 'mini', brand: 'Prix Mini', priceCents: 189 }),
];
test('Choix « marques U et Prix Mini » : la marque U passe devant une marque nationale', () =>
  assertEqual(chooseProduct(need, brands.slice(0, 2), { ...choiceCtx, preference: 'store_brand' }).choice?.product.id, 'u'));
test('À prix égal, la marque du magasin est choisie (même en « moins cher »)', () =>
  assertEqual(chooseProduct(need, brands, choiceCtx).choice?.product.id, 'mini'));

// --- Devis et comparaison ---
/** @param {string} ingredientId @param {number} toBuy @returns {ShoppingLine} */
const line = (ingredientId, toBuy) => ({ key: `${ingredientId}|g`, ingredientId, need: toBuy, unit: 'g', inStock: 0, toBuy, packages: null, buyQuantity: toBuy, covered: false, aisle: 'grocery' });
const quoteCtx = { products: [product({})], prices: [], ingredients, today: TODAY, now: NOW, hasLoyaltyCard: false, preference: /** @type {const} */ ('cheapest') };
test('Devis : article sans prix listé à part, total incomplet', () => {
  const q = quoteShoppingLines([line('rice_white', 500), line('pasta', 500)], quoteCtx);
  assertEqual([q.totalCents, q.missing, q.complete], [250, ['pasta'], false]);
});
test('Comparaison impossible si un article n’a pas de prix', () => {
  const a = quoteShoppingLines([line('rice_white', 500)], quoteCtx);
  const b = quoteShoppingLines([line('pasta', 500)], quoteCtx);
  assertEqual(compareQuotes(a, b).deltaCents, null);
});
test('Comparaison vérifiée : deux paniers chiffrés au Drive', () => {
  const a = quoteShoppingLines([line('rice_white', 1500)], quoteCtx);
  const b = quoteShoppingLines([line('rice_white', 500)], quoteCtx);
  assertEqual([compareQuotes(a, b).level, compareQuotes(a, b).deltaCents], ['verified', -250]);
});
test('Comparaison « estimation » si un prix est ancien', () => {
  const old = { ...quoteCtx, products: [product({ checkedAt: '2026-10-01T08:00:00' })] };
  const a = quoteShoppingLines([line('rice_white', 1500)], old);
  const b = quoteShoppingLines([line('rice_white', 500)], old);
  assertEqual(compareQuotes(a, b).level, 'estimated');
});

// --- Import ---
test('Import CSV : produit relié par son nom, promotion lue', () => {
  const csv = 'reference;nom;marque;contenance;unite;prix;disponible;ingredient;qualite;promo_type;promo_valeur;promo_libelle;promo_debut;promo_fin;promo_carte\n'
    + '3256;Riz long grain 1 kg;U;1;kg;2,49;oui;riz;;percent;20;-20 %;2026-10-20;2026-10-26;non';
  const r = parseDriveCsv(csv, { storeId: 'hu', checkedAt: NOW.toISOString(), findIngredient: (n) => findIngredientId(n, nameIndex), ingredients });
  assertEqual([r.errors, r.products[0].ingredientId, r.products[0].priceCents, r.products[0].promotion?.value], [[], 'rice_white', 249, 20]);
});
test('Import CSV : nom inconnu = produit non relié (jamais deviné)', () => {
  const r = parseDriveCsv('X1;Truc bizarre;;1;kg;1,00;oui;fruit du dragon;;;;;;;', { storeId: 'hu', checkedAt: NOW.toISOString(), findIngredient: (n) => findIngredientId(n, nameIndex), ingredients });
  assertEqual([r.products[0].ingredientId, r.unlinked], [null, 1]);
});
test('Import CSV : ligne sans prix rejetée avec son numéro', () => {
  const r = parseDriveCsv('X1;Riz;;1;kg;;oui;riz;;;;;;;', { storeId: 'hu', checkedAt: NOW.toISOString(), findIngredient: (n) => findIngredientId(n, nameIndex), ingredients });
  if (r.products.length !== 0 || !r.errors[0].startsWith('Ligne 1')) throw new Error(JSON.stringify(r));
});
test('Modèle CSV : les lignes d’exemple ne sont jamais importées comme de vrais prix', () => {
  const r = parseDriveCsv(importTemplate(), { storeId: 'hu', checkedAt: NOW.toISOString(), findIngredient: (n) => findIngredientId(n, nameIndex), ingredients });
  assertEqual([r.products.length, r.errors], [0, []]);
});
test('Modèle CSV rempli (avec le marqueur UTF-8 d’Excel) : en-tête ignoré, lignes lues', () => {
  const filled = importTemplate().replace('EXEMPLE-1', '3256').replace('EXEMPLE-3', '3257');
  const r = parseDriveCsv(filled, { storeId: 'hu', checkedAt: NOW.toISOString(), findIngredient: (n) => findIngredientId(n, nameIndex), ingredients });
  assertEqual([r.errors, r.products.map((p) => p.ingredientId), r.products[1].promotion?.buy, r.products[1].promotion?.requiresCard], [[], ['rice_white', 'coconut_milk'], 3, true]);
});

// --- Commande ---
/** @param {Partial<import('../src/domain/drive/drive.js').DriveOrder>} f @returns {import('../src/domain/drive/drive.js').DriveOrder} */
const order = (f) => ({
  id: 'o1',
  week: '2026-10-19',
  storeId: HYPER_U_CAYENNE.id,
  items: [{ productId: 'p1', name: 'Riz', ingredientId: 'rice_white', count: 2, cents: 500, savingCents: 0, promoLabel: null, fresh: true, availability: 'available' }],
  notInDrive: [],
  totalCents: 500,
  status: 'draft',
  createdAt: NOW.toISOString(),
  confirmedAt: null,
  confirmedTotalCents: null,
  ...f,
});
const productMap = new Map([['p1', product({})]]);
test('Commande prête : magasin Drive, prix récents, articles disponibles', () =>
  assertEqual(checkOrder(order({}), { store: HYPER_U_CAYENNE, now: NOW, products: productMap }).ok, true));
test('Commande bloquée sans magasin Drive', () => {
  const r = checkOrder(order({}), { store: { ...HYPER_U_CAYENNE, drive: null }, now: NOW, products: productMap });
  assertEqual(r.ok, false);
});
test('Commande bloquée si un prix n’a pas été vérifié depuis 48 h', () =>
  assertEqual(checkOrder(order({}), { store: HYPER_U_CAYENNE, now: new Date('2026-10-25T10:00:00'), products: productMap }).ok, false));
test('Nouvelle confirmation exigée si le total varie de plus de 10 %', () =>
  assertEqual(checkOrder(order({ confirmedTotalCents: 400 }), { store: HYPER_U_CAYENNE, now: NOW, products: productMap }).ok, false));
