/**
 * Historique des prix releves : chaque releve (magasin, Drive, import) est conserve,
 * ramene au kilo, au litre ou a la piece pour comparer des formats differents.
 */
import { getUnit, convertUniversal } from '../units/units.js';
import { convertUnit } from '../ingredients/conversion.js';
import { productCost } from '../drive/drive.js';

/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */
/** @typedef {import('./stores.js').Price} Price */
/** @typedef {import('../drive/drive.js').DriveProduct} DriveProduct */

/**
 * @typedef {Object} PricePoint
 * @property {string} id                 magasin|ingredient|produit|date : un point par produit et par jour
 * @property {string} ingredientId
 * @property {string} storeId
 * @property {string} label              Produit, marque
 * @property {string} date               AAAA-MM-JJ
 * @property {number} priceCents         Prix affiche de l'article (hors promotion)
 * @property {number | null} promoCents  Prix avec la promotion du moment, s'il y en a une
 * @property {number} packageQuantity
 * @property {string} packageUnit
 * @property {number | null} unitCents   Prix au kilo, au litre ou a la piece (promotion comprise)
 * @property {'kg' | 'l' | 'piece' | null} per
 * @property {'manual' | 'drive' | 'import'} source
 */

/** @type {Record<'kg' | 'l' | 'piece', string>} */
export const PER_LABELS = { kg: 'le kilo', l: 'le litre', piece: 'la pièce' };

/**
 * Prix ramene au kilo, au litre ou a la piece (null si l'unite ne le permet pas).
 * @param {number} cents
 * @param {number} quantity
 * @param {string} unit
 * @param {Ingredient | null} ingredient
 * @returns {{ unitCents: number | null, per: 'kg' | 'l' | 'piece' | null }}
 */
export function normalizeUnitPrice(cents, quantity, unit, ingredient) {
  const kind = getUnit(unit)?.kind;
  /** @type {[string, 'kg' | 'l' | 'piece'] | null} */
  const target = kind === 'mass' ? ['kg', 'kg'] : kind === 'volume' ? ['l', 'l'] : kind === 'count' ? ['piece', 'piece'] : null;
  if (!target || !(quantity > 0)) return { unitCents: null, per: null };
  const converted = kind === 'count' ? convertUnit(quantity, unit, 'piece', ingredient) : convertUniversal(quantity, unit, target[0]);
  if (!converted.ok || converted.value <= 0) return { unitCents: null, per: null };
  return { unitCents: Math.round(cents / converted.value), per: target[1] };
}

/**
 * Point d'historique d'un prix releve en magasin.
 * @param {Price} price
 * @param {Ingredient | null} ingredient
 * @returns {PricePoint}
 */
export function pointFromPrice(price, ingredient) {
  const { unitCents, per } = normalizeUnitPrice(price.priceCents, price.packageQuantity, price.packageUnit, ingredient);
  return {
    id: `${price.storeId}|${price.ingredientId}|${price.label}|${price.date}`,
    ingredientId: price.ingredientId,
    storeId: price.storeId,
    label: price.label,
    date: price.date,
    priceCents: price.priceCents,
    promoCents: null,
    packageQuantity: price.packageQuantity,
    packageUnit: price.packageUnit,
    unitCents,
    per,
    source: 'manual',
  };
}

/**
 * Point d'historique d'un produit du Drive (promotion du jour comprise dans le prix ramene).
 * @param {DriveProduct} product
 * @param {Ingredient | null} ingredient
 * @param {{ today: string, hasLoyaltyCard: boolean }} ctx
 * @returns {PricePoint | null}  null si le produit n'est relie a aucun ingredient
 */
export function pointFromDriveProduct(product, ingredient, ctx) {
  if (!product.ingredientId) return null;
  const cost = productCost(product, 1, ctx);
  const effective = cost.promoApplied ? cost.cents : product.priceCents;
  const { unitCents, per } = normalizeUnitPrice(effective, product.packageQuantity, product.packageUnit, ingredient);
  const date = product.checkedAt.slice(0, 10);
  return {
    id: `${product.storeId}|${product.ingredientId}|${product.id}|${date}`,
    ingredientId: product.ingredientId,
    storeId: product.storeId,
    label: [product.brand, product.name].filter(Boolean).join(' '),
    date,
    priceCents: product.priceCents,
    promoCents: cost.promoApplied ? cost.cents : null,
    packageQuantity: product.packageQuantity,
    packageUnit: product.packageUnit,
    unitCents,
    per,
    source: product.source === 'drive_import' ? 'import' : 'drive',
  };
}

/**
 * Courbes par magasin pour un ingredient : points dates, un par jour (le moins cher du jour).
 * Seuls les prix ramenes dans la meme unite que la majorite des points sont gardes.
 * @param {PricePoint[]} points
 * @returns {{ per: 'kg' | 'l' | 'piece' | null, series: Map<string, { date: string, unitCents: number }[]> }}
 */
export function seriesByStore(points) {
  const usable = points.filter((p) => p.unitCents !== null && p.per !== null);
  /** @type {Map<string, number>} */
  const perCount = new Map();
  for (const p of usable) perCount.set(String(p.per), (perCount.get(String(p.per)) ?? 0) + 1);
  const per = /** @type {'kg' | 'l' | 'piece' | null} */ ([...perCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  /** @type {Map<string, Map<string, number>>} */
  const byStore = new Map();
  for (const p of usable.filter((x) => x.per === per)) {
    const days = byStore.get(p.storeId) ?? new Map();
    const current = days.get(p.date);
    days.set(p.date, current === undefined ? /** @type {number} */ (p.unitCents) : Math.min(current, /** @type {number} */ (p.unitCents)));
    byStore.set(p.storeId, days);
  }
  /** @type {Map<string, { date: string, unitCents: number }[]>} */
  const series = new Map();
  for (const [storeId, days] of byStore) {
    series.set(storeId, [...days].map(([date, unitCents]) => ({ date, unitCents })).sort((a, b) => a.date.localeCompare(b.date)));
  }
  return { per, series };
}

/**
 * Evolution d'une serie : premier et dernier prix, minimum, variation en %.
 * @param {{ date: string, unitCents: number }[]} serie
 * @returns {{ first: { date: string, unitCents: number }, last: { date: string, unitCents: number }, minCents: number, maxCents: number, changePct: number } | null}
 */
export function serieTrend(serie) {
  if (!serie.length) return null;
  const first = serie[0];
  const last = serie[serie.length - 1];
  const values = serie.map((p) => p.unitCents);
  return {
    first,
    last,
    minCents: Math.min(...values),
    maxCents: Math.max(...values),
    changePct: first.unitCents > 0 ? Math.round(((last.unitCents - first.unitCents) / first.unitCents) * 1000) / 10 : 0,
  };
}

/**
 * Plus fortes variations (hausses d'abord) parmi les series d'au moins deux releves.
 * @param {PricePoint[]} points
 * @returns {{ ingredientId: string, storeId: string, per: 'kg' | 'l' | 'piece', trend: NonNullable<ReturnType<typeof serieTrend>> }[]}
 */
export function priceChanges(points) {
  /** @type {Map<string, PricePoint[]>} */
  const byIngredient = new Map();
  for (const p of points) byIngredient.set(p.ingredientId, [...(byIngredient.get(p.ingredientId) ?? []), p]);
  /** @type {{ ingredientId: string, storeId: string, per: 'kg' | 'l' | 'piece', trend: NonNullable<ReturnType<typeof serieTrend>> }[]} */
  const out = [];
  for (const [ingredientId, list] of byIngredient) {
    const { per, series } = seriesByStore(list);
    if (!per) continue;
    for (const [storeId, serie] of series) {
      const trend = serieTrend(serie);
      if (trend && serie.length >= 2) out.push({ ingredientId, storeId, per, trend });
    }
  }
  return out.sort((a, b) => b.trend.changePct - a.trend.changePct);
}

/**
 * Le prix est-il au plus bas en ce moment ? (dernier releve <= minimum des 4 derniers mois,
 * avec au moins 3 releves) : souvent le signe d'un produit de saison ou d'une bonne affaire.
 * @param {PricePoint[]} points  Points d'un meme ingredient
 * @param {string} today
 * @returns {boolean}
 */
export function isLowPriceNow(points, today) {
  const { series } = seriesByStore(points);
  const since = new Date(Date.parse(`${today}T12:00:00`) - 120 * 86400000).toISOString().slice(0, 10);
  for (const serie of series.values()) {
    const recent = serie.filter((p) => p.date >= since);
    if (recent.length < 3) continue;
    const last = recent[recent.length - 1];
    const before = recent.slice(0, -1).map((p) => p.unitCents);
    if (last.unitCents <= Math.min(...before) && last.unitCents < Math.max(...before)) return true;
  }
  return false;
}
