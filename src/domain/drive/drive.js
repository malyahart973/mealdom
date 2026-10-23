/**
 * Drive (commande en ligne et retrait en magasin) : produits, promotions et commande.
 *
 * MealDom n'invente jamais un prix, une promotion ou une disponibilite :
 * chaque produit vient d'un import ou d'un releve sur le site du Drive, avec sa date.
 * Un prix plus ancien que DRIVE_FRESH_HOURS est affiche "a reverifier".
 * Aucune commande n'est transmise sans validation explicite du client.
 */
import { getUnit, cleanNumber } from '../units/units.js';
import { convertUnit } from '../ingredients/conversion.js';
import { parseIsoDate } from '../planning/dates.js';

/** @typedef {import('../stores/stores.js').Availability} Availability */
/** @typedef {import('../stores/stores.js').Store} Store */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */

/** Duree de validite d'un prix releve sur le Drive. */
export const DRIVE_FRESH_HOURS = 48;

/** Ecart de total au-dela duquel une nouvelle confirmation est demandee. */
export const RECONFIRM_RATIO = 0.1;

/**
 * Seul Drive alimentaire disponible en Guyane a ce jour : Hyper U de Cayenne.
 * Le lien ouvre le site de commande de l'enseigne ; le magasin se choisit sur le site.
 * @type {Store}
 */
export const HYPER_U_CAYENNE = {
  id: 'hyper-u-cayenne',
  name: 'Hyper U Cayenne',
  type: 'hypermarket',
  commune: 'Cayenne',
  drive: { url: 'https://www.coursesu.com/', label: 'Courses U – Drive' },
};

/** @typedef {'organic' | 'label_rouge' | 'local' | 'aop' | 'premium'} Quality */

/** @type {{ id: Quality, label: string }[]} */
export const QUALITIES = [
  { id: 'organic', label: 'Bio' },
  { id: 'label_rouge', label: 'Label Rouge' },
  { id: 'local', label: 'Produit local (péyi)' },
  { id: 'aop', label: 'AOP / IGP' },
  { id: 'premium', label: 'Gamme supérieure' },
];

/** @typedef {'percent' | 'amount' | 'price' | 'second_half' | 'n_for_m'} PromoType */

/**
 * Promotion telle qu'affichee par le Drive.
 * @typedef {Object} Promotion
 * @property {PromoType} type
 * @property {number} value       percent : % de remise ; amount : centimes de remise par article ;
 *                                price : prix promo par article en centimes ; second_half : % de remise sur le 2e
 * @property {number} [buy]       n_for_m : nombre achete (ex. 3 pour « 3 pour 2 »)
 * @property {number} [pay]       n_for_m : nombre paye (ex. 2)
 * @property {string} label       Texte de l'offre
 * @property {string} startDate   AAAA-MM-JJ
 * @property {string} endDate     AAAA-MM-JJ (inclus)
 * @property {string} conditions  ex. « avec la carte U », « dans la limite des stocks »
 * @property {boolean} requiresCard
 */

/**
 * @typedef {Object} DriveProduct
 * @property {string} id                Reference du produit sur le Drive (EAN ou code)
 * @property {string} storeId
 * @property {string} name
 * @property {string} brand
 * @property {string | null} ingredientId  Ingredient correspondant (null = pas encore relie)
 * @property {number} packageQuantity
 * @property {string} packageUnit
 * @property {number} priceCents        Prix d'un article, en centimes
 * @property {Availability} availability
 * @property {Quality[]} quality
 * @property {Promotion | null} promotion
 * @property {'drive_import' | 'drive_manual'} source
 * @property {string} checkedAt         Date et heure ISO du releve
 */

/**
 * @param {DriveProduct} p
 * @param {Map<string, Ingredient>} ingredients
 * @returns {string[]}
 */
export function validateDriveProduct(p, ingredients) {
  /** @type {string[]} */
  const errors = [];
  if (!p.id.trim()) errors.push('Référence du produit manquante.');
  if (!p.name.trim()) errors.push('Nom du produit manquant.');
  if (p.ingredientId !== null && !ingredients.has(p.ingredientId)) errors.push(`Ingrédient inconnu : ${p.ingredientId}`);
  const unit = getUnit(p.packageUnit);
  if (!unit || unit.kind === 'qualitative' || unit.kind === 'package') errors.push('Contenance invalide (g, kg, ml, L, pièce...).');
  if (!(p.packageQuantity > 0)) errors.push('Contenance manquante.');
  if (!Number.isInteger(p.priceCents) || p.priceCents < 0) errors.push('Prix invalide.');
  if (Number.isNaN(Date.parse(p.checkedAt))) errors.push('Date du relevé manquante : un prix sans date ne peut pas être utilisé.');
  if (p.promotion) errors.push(...validatePromotion(p.promotion));
  return errors;
}

/**
 * @param {Promotion} promo
 * @returns {string[]}
 */
export function validatePromotion(promo) {
  /** @type {string[]} */
  const errors = [];
  if (!parseIsoDate(promo.startDate) || !parseIsoDate(promo.endDate)) errors.push('Dates de la promotion invalides.');
  else if (promo.endDate < promo.startDate) errors.push('La promotion se termine avant de commencer.');
  if (promo.type === 'percent' || promo.type === 'second_half') {
    if (!(promo.value > 0 && promo.value <= 100)) errors.push('Pourcentage de remise invalide.');
  } else if (promo.type === 'amount' || promo.type === 'price') {
    if (!Number.isInteger(promo.value) || promo.value < 0) errors.push('Montant de la promotion invalide.');
  } else if (promo.type === 'n_for_m') {
    if (!(Number.isInteger(promo.buy) && Number.isInteger(promo.pay) && /** @type {number} */ (promo.pay) < /** @type {number} */ (promo.buy) && /** @type {number} */ (promo.pay) > 0)) {
      errors.push('Offre « X pour Y » invalide.');
    }
  } else errors.push('Type de promotion inconnu.');
  return errors;
}

/**
 * Le prix a-t-il ete verifie recemment ?
 * @param {DriveProduct} p
 * @param {Date} now
 * @returns {boolean}
 */
export function isFresh(p, now) {
  const t = Date.parse(p.checkedAt);
  return !Number.isNaN(t) && now.getTime() - t <= DRIVE_FRESH_HOURS * 3600 * 1000 && t <= now.getTime() + 60_000;
}

/**
 * Etat d'une promotion a une date.
 * @param {Promotion | null} promo
 * @param {string} today
 * @returns {'active' | 'upcoming' | 'expired' | 'none'}
 */
export function promotionStatus(promo, today) {
  if (!promo) return 'none';
  if (today < promo.startDate) return 'upcoming';
  if (today > promo.endDate) return 'expired';
  return 'active';
}

/**
 * Cout d'achat de N articles, promotion comprise si elle s'applique.
 * - promotion hors dates : ignoree ;
 * - promotion reservee a la carte de fidelite : appliquee seulement si le client a la carte ;
 * - « X pour Y » et « 2e a -N % » : la remise ne porte que sur les lots complets.
 * @param {DriveProduct} p
 * @param {number} count
 * @param {{ today: string, hasLoyaltyCard: boolean }} ctx
 * @returns {{ cents: number, regularCents: number, savingCents: number, promoApplied: boolean, promoNote: string | null }}
 */
export function productCost(p, count, ctx) {
  const regularCents = p.priceCents * count;
  const promo = p.promotion;
  /** @param {string | null} note */
  const regular = (note) => ({ cents: regularCents, regularCents, savingCents: 0, promoApplied: false, promoNote: note });
  if (!promo || count <= 0) return regular(null);
  const status = promotionStatus(promo, ctx.today);
  if (status !== 'active') return regular(status === 'upcoming' ? `Offre à partir du ${promo.startDate}` : null);
  if (promo.requiresCard && !ctx.hasLoyaltyCard) return regular(`Offre réservée aux porteurs de la carte : ${promo.label}`);

  let cents = regularCents;
  if (promo.type === 'percent') cents = Math.round(regularCents * (1 - promo.value / 100));
  else if (promo.type === 'amount') cents = Math.max(0, regularCents - promo.value * count);
  else if (promo.type === 'price') cents = promo.value * count;
  else if (promo.type === 'second_half') cents = regularCents - Math.floor(count / 2) * Math.round((p.priceCents * promo.value) / 100);
  else if (promo.type === 'n_for_m' && promo.buy && promo.pay) {
    const free = Math.floor(count / promo.buy) * (promo.buy - promo.pay);
    cents = (count - free) * p.priceCents;
  }
  const applied = cents < regularCents;
  let note = null;
  if (!applied && (promo.type === 'second_half' || promo.type === 'n_for_m')) {
    const need = promo.type === 'second_half' ? 2 : promo.buy;
    note = `Offre « ${promo.label} » valable dès ${need} articles : il vous en faut ${count}.`;
  }
  return { cents, regularCents, savingCents: regularCents - cents, promoApplied: applied, promoNote: note };
}

/**
 * Nombre d'articles a acheter pour couvrir une quantite (null si unites incompatibles).
 * @param {number} quantity
 * @param {string} unit
 * @param {DriveProduct} p
 * @param {Ingredient | null} ingredient
 * @returns {number | null}
 */
export function packagesNeeded(quantity, unit, p, ingredient) {
  const size = convertUnit(p.packageQuantity, p.packageUnit, unit, ingredient);
  if (!size.ok || size.value <= 0) return null;
  return Math.max(1, Math.ceil(cleanNumber(quantity / size.value)));
}

/** @typedef {'cheapest' | 'quality' | 'promotions' | 'store_brand'} ProductPreference */

/**
 * Produit des marques du magasin U (U, U Bio, U Saveurs... et Prix Mini, premier prix).
 * @param {DriveProduct} product
 * @returns {boolean}
 */
export function isStoreBrand(product) {
  const brand = product.brand.trim().toLowerCase();
  return brand === 'u' || brand.startsWith('u ') || /prix mini/i.test(product.brand) || /prix mini/i.test(product.name);
}

/**
 * @typedef {Object} ProductChoice
 * @property {DriveProduct} product
 * @property {number} count
 * @property {ReturnType<typeof productCost>} cost
 * @property {boolean} fresh
 */

/**
 * Choisit l'article du Drive pour un besoin.
 * - seuls les produits relies a l'ingredient, disponibles et de contenance compatible ;
 * - un produit choisi par le client (preferredId) passe en premier s'il convient ;
 * - "quality" : produits avec label d'abord ; "promotions" : promotions actives d'abord ;
 *   "store_brand" : marques U et Prix Mini, ou produits en promotion, d'abord ;
 * - puis le moins cher pour la quantite reellement achetee ; a prix egal, la marque U.
 * @param {{ ingredientId: string, quantity: number, unit: string }} need
 * @param {DriveProduct[]} products
 * @param {{ today: string, now: Date, hasLoyaltyCard: boolean, preference: ProductPreference, preferredId?: string | null, ingredient: Ingredient | null }} ctx
 * @returns {{ choice: ProductChoice | null, alternatives: ProductChoice[] }}
 */
export function chooseProduct(need, products, ctx) {
  /** @type {ProductChoice[]} */
  const options = [];
  for (const p of products) {
    if (p.ingredientId !== need.ingredientId || p.availability !== 'available') continue;
    const count = packagesNeeded(need.quantity, need.unit, p, ctx.ingredient);
    if (count === null) continue;
    options.push({ product: p, count, cost: productCost(p, count, ctx), fresh: isFresh(p, ctx.now) });
  }
  /** @param {ProductChoice} o */
  const rank = (o) => {
    if (ctx.preferredId && o.product.id === ctx.preferredId) return 0;
    if (ctx.preference === 'quality' && o.product.quality.length > 0) return 1;
    if (ctx.preference === 'promotions' && o.cost.promoApplied) return 1;
    if (ctx.preference === 'store_brand' && (isStoreBrand(o.product) || o.cost.promoApplied)) return 1;
    return 2;
  };
  options.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.cost.cents - b.cost.cents ||
      Number(isStoreBrand(b.product)) - Number(isStoreBrand(a.product)) ||
      Number(b.fresh) - Number(a.fresh),
  );
  return { choice: options[0] ?? null, alternatives: options.slice(1) };
}

/**
 * Produits du Drive en promotion aujourd'hui (pour l'assistant et l'ecran Drive).
 * @param {DriveProduct[]} products
 * @param {string} today
 * @returns {DriveProduct[]}
 */
export function activePromotions(products, today) {
  return products.filter((p) => p.availability === 'available' && promotionStatus(p.promotion, today) === 'active');
}

// ---------------------------------------------------------------------------
// Import des produits (fichier CSV exporte ou saisi a partir du site du Drive)
// ---------------------------------------------------------------------------

/** Colonnes attendues, dans cet ordre, separees par des points-virgules. */
export const IMPORT_COLUMNS = [
  'reference',
  'nom',
  'marque',
  'contenance',
  'unite',
  'prix',
  'disponible',
  'ingredient',
  'qualite',
  'promo_type',
  'promo_valeur',
  'promo_libelle',
  'promo_debut',
  'promo_fin',
  'promo_carte',
];

/**
 * Modele de fichier d'import, a ouvrir avec un tableur. Les lignes d'exemple (reference "EXEMPLE...")
 * montrent le format et ne sont jamais importees : leurs prix ne sont pas de vrais releves.
 * Le marqueur UTF-8 en tete permet a Excel d'afficher correctement les accents.
 * @returns {string}
 */
export function importTemplate() {
  const rows = [
    IMPORT_COLUMNS.join(';'),
    'EXEMPLE-1;Riz long grain 1 kg;U;1;kg;1,89;oui;riz blanc;;;;;;;',
    'EXEMPLE-2;Filets de poulet 500 g;U;500;g;6,49;oui;blanc de poulet;label_rouge;percent;20;-20 % immédiatement;2026-10-20;2026-10-26;non',
    'EXEMPLE-3;Lait de coco 400 ml;;400;ml;1,35;oui;lait de coco;;n_for_m;3 pour 2;3 achetés pour 2 payés;2026-10-20;2026-11-02;oui',
  ];
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

/**
 * Montant "3,20" ou "3.20" en centimes (NaN si illisible).
 * @param {string} text
 * @returns {number}
 */
function cents(text) {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim().replace(/\s|€/g, ''));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : Number.NaN;
}

/**
 * Lit un fichier CSV de produits du Drive. Chaque ligne est verifiee ; une ligne
 * invalide est rejetee avec son numero (jamais corrigee en devinant).
 * La colonne "ingredient" accepte un nom d'ingredient ; s'il n'est pas reconnu
 * exactement, le produit est importe SANS lien (a relier a la main).
 * @param {string} text
 * @param {{ storeId: string, checkedAt: string, findIngredient: (name: string) => string | null, ingredients: Map<string, Ingredient> }} ctx
 * @returns {{ products: DriveProduct[], errors: string[], unlinked: number }}
 */
export function parseDriveCsv(text, ctx) {
  /** @type {DriveProduct[]} */
  const products = [];
  /** @type {string[]} */
  const errors = [];
  let unlinked = 0;
  // Le marqueur d'encodage UTF-8 ajoute par Excel ne fait pas partie de la premiere colonne.
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  rows.forEach((row, i) => {
    const cols = row.split(';').map((c) => c.trim());
    if (i === 0 && cols[0].toLowerCase() === 'reference') return; // en-tete
    if (/^exemple/i.test(cols[0])) return; // lignes d'exemple du modele : jamais importees comme de vrais prix
    const get = (/** @type {string} */ name) => cols[IMPORT_COLUMNS.indexOf(name)] ?? '';
    const ingredientName = get('ingredient');
    const ingredientId = ingredientName ? ctx.findIngredient(ingredientName) : null;
    if (ingredientId === null) unlinked++;
    const promoType = /** @type {PromoType} */ (get('promo_type'));
    /** @type {Promotion | null} */
    let promotion = null;
    if (promoType) {
      const raw = get('promo_valeur');
      const nForM = /^(\d+)\s*pour\s*(\d+)$/i.exec(raw);
      promotion = {
        type: promoType,
        value: promoType === 'amount' || promoType === 'price' ? cents(raw) : Number(raw.replace(',', '.')),
        ...(nForM ? { buy: Number(nForM[1]), pay: Number(nForM[2]), value: 0 } : {}),
        label: get('promo_libelle') || raw,
        startDate: get('promo_debut'),
        endDate: get('promo_fin'),
        conditions: get('promo_carte') === 'oui' ? 'Avec la carte de fidélité' : '',
        requiresCard: get('promo_carte') === 'oui',
      };
    }
    /** @type {DriveProduct} */
    const product = {
      id: get('reference'),
      storeId: ctx.storeId,
      name: get('nom'),
      brand: get('marque'),
      ingredientId,
      packageQuantity: Number(get('contenance').replace(',', '.')),
      packageUnit: get('unite'),
      priceCents: cents(get('prix')),
      availability: get('disponible') === 'non' ? 'unavailable' : get('disponible') === 'oui' ? 'available' : 'unknown',
      quality: /** @type {Quality[]} */ (get('qualite').split(',').map((q) => q.trim()).filter((q) => QUALITIES.some((x) => x.id === q))),
      promotion,
      source: 'drive_import',
      checkedAt: ctx.checkedAt,
    };
    const rowErrors = validateDriveProduct(product, ctx.ingredients);
    if (rowErrors.length) errors.push(`Ligne ${i + 1} : ${rowErrors.join(' ')}`);
    else products.push(product);
  });
  return { products, errors, unlinked };
}

// ---------------------------------------------------------------------------
// Commande
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} OrderItem
 * @property {string} productId
 * @property {string} name
 * @property {string} ingredientId
 * @property {number} count
 * @property {number} cents
 * @property {number} savingCents
 * @property {string | null} promoLabel
 * @property {boolean} fresh
 * @property {Availability} availability
 */

/**
 * @typedef {Object} DriveOrder
 * @property {string} id
 * @property {string} week               Semaine du planning (lundi)
 * @property {string} storeId
 * @property {OrderItem[]} items
 * @property {string[]} notInDrive       Ingredients sans produit Drive (a acheter ailleurs)
 * @property {number} totalCents
 * @property {'draft' | 'confirmed' | 'sent'} status
 * @property {string} createdAt
 * @property {string | null} confirmedAt
 * @property {number | null} confirmedTotalCents
 */

/**
 * Controles avant la transmission d'une commande.
 * Bloquant : magasin sans Drive, prix non verifies recemment, article indisponible,
 * quantite nulle, total different de plus de 10 % du total confirme.
 * @param {DriveOrder} order
 * @param {{ store: Store | null, now: Date, products: Map<string, DriveProduct> }} ctx
 * @returns {{ ok: boolean, blocking: string[], warnings: string[] }}
 */
export function checkOrder(order, ctx) {
  /** @type {string[]} */
  const blocking = [];
  /** @type {string[]} */
  const warnings = [];
  if (!ctx.store) blocking.push('Aucun magasin sélectionné.');
  else if (!ctx.store.drive) blocking.push(`${ctx.store.name} ne propose pas de Drive dans MealDom.`);
  else if (ctx.store.id !== order.storeId) blocking.push('La commande a été préparée pour un autre magasin.');
  if (order.items.length === 0) blocking.push('La commande est vide.');
  for (const item of order.items) {
    const p = ctx.products.get(item.productId);
    if (!p) blocking.push(`${item.name} : produit introuvable dans le catalogue du Drive.`);
    else {
      if (!isFresh(p, ctx.now)) blocking.push(`${item.name} : prix relevé il y a plus de ${DRIVE_FRESH_HOURS} h, à revérifier.`);
      if (p.availability !== 'available') blocking.push(`${item.name} : disponibilité non confirmée.`);
      if (p.priceCents * item.count !== item.cents + item.savingCents) warnings.push(`${item.name} : le prix a changé depuis la préparation.`);
    }
    if (!(item.count > 0)) blocking.push(`${item.name} : quantité invalide.`);
  }
  if (order.notInDrive.length) warnings.push(`${order.notInDrive.length} article(s) sans produit Drive : à acheter ailleurs ou à ajouter vous-même.`);
  if (order.confirmedTotalCents !== null && order.confirmedTotalCents > 0) {
    const ratio = Math.abs(order.totalCents - order.confirmedTotalCents) / order.confirmedTotalCents;
    if (ratio > RECONFIRM_RATIO) blocking.push('Le total a changé de plus de 10 % depuis votre confirmation : confirmez de nouveau.');
  }
  return { ok: blocking.length === 0, blocking, warnings };
}

/**
 * Liste texte a recopier ou a partager pour passer la commande sur le site du Drive.
 * @param {DriveOrder} order
 * @param {(cents: number) => string} money
 * @returns {string}
 */
export function orderText(order, money) {
  const lines = order.items.map((i) => `- ${i.count} × ${i.name} (réf. ${i.productId}) : ${money(i.cents)}${i.promoLabel ? ` [${i.promoLabel}]` : ''}`);
  return [`Commande Drive – total estimé ${money(order.totalCents)}`, ...lines].join('\n');
}
