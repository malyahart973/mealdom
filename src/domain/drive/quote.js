/**
 * Chiffrage d'une liste de courses et comparaison avant / apres une modification.
 * Une economie n'est annoncee que si les deux paniers sont chiffres sur des prix
 * COMPARABLES (memes sources, aucun article sans prix).
 */
import { chooseProduct } from './drive.js';
import { purchaseCost } from '../stores/stores.js';

/** @typedef {import('../shopping/shopping.js').ShoppingLine} ShoppingLine */
/** @typedef {import('../stores/stores.js').Price} Price */
/** @typedef {import('./drive.js').DriveProduct} DriveProduct */
/** @typedef {import('./drive.js').ProductPreference} ProductPreference */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */

/**
 * Source d'un prix :
 * - drive_verified : produit du Drive releve il y a moins de 48 h ;
 * - drive_stale : produit du Drive, releve plus ancien (a reverifier) ;
 * - manual : prix releve a la main dans un magasin ;
 * - missing : aucun prix connu.
 * @typedef {'drive_verified' | 'drive_stale' | 'manual' | 'missing'} PriceKind
 */

/**
 * @typedef {Object} QuoteLine
 * @property {string} key
 * @property {string} ingredientId
 * @property {PriceKind} kind
 * @property {number | null} cents
 * @property {number} savingCents
 * @property {string | null} productId
 * @property {string | null} productName
 * @property {number | null} count
 * @property {string | null} promoLabel
 * @property {string | null} promoNote
 * @property {string | null} checkedAt
 */

/**
 * @typedef {Object} Quote
 * @property {QuoteLine[]} lines
 * @property {number} totalCents          Somme des lignes chiffrees
 * @property {number} verifiedCents       Part chiffree avec des prix Drive verifies
 * @property {number} savingCents         Promotions appliquees
 * @property {string[]} missing           Ingredients sans prix
 * @property {boolean} complete
 * @property {boolean} allVerified        Tout est chiffre avec des prix Drive recents
 */

/**
 * @typedef {Object} QuoteContext
 * @property {DriveProduct[]} products       Produits du Drive du magasin choisi
 * @property {Price[]} prices                Prix releves a la main
 * @property {Map<string, Ingredient>} ingredients
 * @property {string} today
 * @property {Date} now
 * @property {boolean} hasLoyaltyCard
 * @property {ProductPreference} preference
 * @property {Map<string, string>} [preferredProducts]  ingredient -> produit choisi par le client
 */

/**
 * Chiffre chaque article a acheter : d'abord le Drive, sinon le prix releve le moins cher.
 * @param {ShoppingLine[]} lines
 * @param {QuoteContext} ctx
 * @returns {Quote}
 */
export function quoteShoppingLines(lines, ctx) {
  /** @type {QuoteLine[]} */
  const out = [];
  for (const line of lines) {
    if (line.covered || line.toBuy === null) continue;
    const ingredient = ctx.ingredients.get(line.ingredientId) ?? null;
    const { choice } = chooseProduct({ ingredientId: line.ingredientId, quantity: line.toBuy, unit: line.unit }, ctx.products, {
      today: ctx.today,
      now: ctx.now,
      hasLoyaltyCard: ctx.hasLoyaltyCard,
      preference: ctx.preference,
      preferredId: ctx.preferredProducts?.get(line.ingredientId) ?? null,
      ingredient,
    });
    if (choice) {
      out.push({
        key: line.key,
        ingredientId: line.ingredientId,
        kind: choice.fresh ? 'drive_verified' : 'drive_stale',
        cents: choice.cost.cents,
        savingCents: choice.cost.savingCents,
        productId: choice.product.id,
        productName: choice.product.name,
        count: choice.count,
        promoLabel: choice.cost.promoApplied && choice.product.promotion ? choice.product.promotion.label : null,
        promoNote: choice.cost.promoNote,
        checkedAt: choice.product.checkedAt,
      });
      continue;
    }
    /** @type {{ cents: number, packages: number | null, date: string } | null} */
    let best = null;
    for (const price of ctx.prices.filter((p) => p.ingredientId === line.ingredientId)) {
      const cost = purchaseCost(line.toBuy, line.unit, price, ingredient);
      if (cost && (!best || cost.cents < best.cents)) best = { ...cost, date: price.date };
    }
    out.push({
      key: line.key,
      ingredientId: line.ingredientId,
      kind: best ? 'manual' : 'missing',
      cents: best ? best.cents : null,
      savingCents: 0,
      productId: null,
      productName: null,
      count: best ? best.packages : null,
      promoLabel: null,
      promoNote: null,
      checkedAt: best ? best.date : null,
    });
  }
  const priced = out.filter((l) => l.cents !== null);
  const missing = out.filter((l) => l.kind === 'missing').map((l) => l.ingredientId);
  return {
    lines: out,
    totalCents: priced.reduce((s, l) => s + /** @type {number} */ (l.cents), 0),
    verifiedCents: out.filter((l) => l.kind === 'drive_verified').reduce((s, l) => s + /** @type {number} */ (l.cents), 0),
    savingCents: out.reduce((s, l) => s + l.savingCents, 0),
    missing,
    complete: missing.length === 0,
    allVerified: out.length > 0 && out.every((l) => l.kind === 'drive_verified'),
  };
}

/**
 * @typedef {Object} QuoteComparison
 * @property {'verified' | 'estimated' | 'not_comparable'} level
 *   verified : deux paniers chiffres entierement avec des prix Drive recents ;
 *   estimated : chiffres complets mais avec des prix anciens ou releves a la main ;
 *   not_comparable : un article n'a pas de prix d'un cote ou de l'autre
 * @property {number | null} deltaCents  apres - avant (negatif = economie), null si non comparable
 * @property {string} explanation
 */

/**
 * Compare deux paniers. N'affirme jamais une economie sur des prix non comparables.
 * @param {Quote} before
 * @param {Quote} after
 * @returns {QuoteComparison}
 */
export function compareQuotes(before, after) {
  if (!before.complete || !after.complete) {
    const n = new Set([...before.missing, ...after.missing]).size;
    return {
      level: 'not_comparable',
      deltaCents: null,
      explanation: `${n} article(s) sans prix connu : impossible de chiffrer l’écart de façon fiable.`,
    };
  }
  const delta = after.totalCents - before.totalCents;
  if (before.allVerified && after.allVerified) {
    return { level: 'verified', deltaCents: delta, explanation: 'Écart calculé avec les prix du Drive vérifiés depuis moins de 48 h.' };
  }
  return {
    level: 'estimated',
    deltaCents: delta,
    explanation: 'Estimation : une partie des prix est ancienne ou relevée à la main. À confirmer avant de commander.',
  };
}
