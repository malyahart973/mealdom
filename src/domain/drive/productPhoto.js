/**
 * Lecture d'une photo de produit ou d'etiquette de prix par l'IA (vision).
 * L'IA ne fait que LIRE ce qui est visible ; l'application verifie chaque champ et le
 * client relit le formulaire pre-rempli avant d'enregistrer. Rien n'est devine :
 * un champ illisible reste vide.
 */
import { parseAmountToCents } from '../budget/money.js';

/** Unites que l'IA peut renvoyer (contenance du produit). */
export const PHOTO_UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'piece', ''];

/** Consigne donnee a l'IA pour lire la photo. */
export const PHOTO_PROMPT = `Tu lis la photo d'un produit alimentaire, de son emballage ou de son étiquette de prix en rayon, prise par un client d'un supermarché en Guyane française (prix en euros).
Recopie uniquement ce qui est lisible sur la photo. Ne devine jamais : laisse un champ vide ("") si l'information n'est pas visible ou pas sûre.
- name : libellé du produit tel qu'écrit (ex. « Riz long grain »).
- brand : marque visible (ex. « U », « Prix Mini », « Taureau Ailé »).
- quantity et unit : contenance de l'article (ex. 500 et g, 1 et kg, 75 et cl, 6 et piece pour 6 œufs).
- price : prix de vente de l'article affiché, avec une virgule (ex. « 1,89 »). Pas le prix au kilo.
- unitPrice : prix au kilo ou au litre affiché sur l'étiquette, s'il y en a un (ex. « 3,78 €/kg »).
- promotion : texte exact d'une promotion visible (ex. « -30 % », « 2 + 1 offert »), sinon vide.
- barcode : chiffres du code-barres s'ils sont lisibles en entier, sinon vide.
- ingredient : l'aliment de base en français, au singulier et sans marque (ex. « riz blanc », « blanc de poulet », « lait de coco »).
- notes : ce qui est flou, coupé ou incertain.`;

/** Schema de la reponse structuree. */
export const PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    brand: { type: 'string' },
    quantity: { type: 'string' },
    unit: { type: 'string', enum: PHOTO_UNITS },
    price: { type: 'string' },
    unitPrice: { type: 'string' },
    promotion: { type: 'string' },
    barcode: { type: 'string' },
    ingredient: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['name', 'brand', 'quantity', 'unit', 'price', 'unitPrice', 'promotion', 'barcode', 'ingredient', 'notes'],
  additionalProperties: false,
};

/**
 * @typedef {Object} PhotoReading
 * @property {string} name
 * @property {string} brand
 * @property {number | null} packageQuantity
 * @property {string | null} packageUnit
 * @property {number | null} priceCents
 * @property {string} unitPriceText
 * @property {string} promotionText
 * @property {string} barcode          Vide si absent ou invalide
 * @property {string | null} ingredientId
 * @property {string} ingredientText
 * @property {string[]} warnings        Champs a verifier ou a completer
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

/**
 * Code-barres EAN-8 ou EAN-13 dont la cle de controle est juste.
 * @param {string} digits
 * @returns {boolean}
 */
export function isValidEan(digits) {
  if (!/^(\d{8}|\d{13})$/.test(digits)) return false;
  const nums = [...digits].map(Number);
  const check = nums.pop() ?? 0;
  const sum = nums.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Verifie la reponse de l'IA et la traduit en champs du formulaire.
 * @param {unknown} raw   Reponse JSON de l'IA
 * @param {(name: string) => string | null} findIngredient
 * @returns {PhotoReading}
 */
export function readPhotoAnswer(raw, findIngredient) {
  const r = /** @type {Record<string, unknown>} */ (typeof raw === 'object' && raw !== null ? raw : {});
  /** @type {string[]} */
  const warnings = [];
  const name = text(r.name);
  if (!name) warnings.push('Nom du produit illisible : complétez-le.');

  const quantity = Number(text(r.quantity).replace(',', '.'));
  const unit = text(r.unit);
  const hasSize = Number.isFinite(quantity) && quantity > 0 && quantity < 100000 && PHOTO_UNITS.includes(unit) && unit !== '';
  if (!hasSize) warnings.push('Contenance non lue : indiquez-la (ex. 500 g).');

  const priceCents = parseAmountToCents(text(r.price));
  const hasPrice = Number.isInteger(priceCents) && priceCents > 0 && priceCents < 100000;
  if (!hasPrice) warnings.push('Prix non lu : recopiez le prix affiché.');

  const digits = text(r.barcode).replace(/\s/g, '');
  const barcode = isValidEan(digits) ? digits : '';
  if (digits && !barcode) warnings.push('Code-barres incomplet ou mal lu : il n’a pas été repris.');

  const ingredientText = text(r.ingredient);
  const ingredientId = ingredientText ? findIngredient(ingredientText) : null;
  if (!ingredientId) warnings.push(ingredientText ? `« ${ingredientText} » ne correspond à aucun ingrédient connu : choisissez-le dans la liste.` : 'Choisissez l’ingrédient correspondant.');

  const promotionText = text(r.promotion);
  if (promotionText) warnings.push(`Promotion lue : « ${promotionText} ». Indiquez son type et ses dates.`);

  const notes = text(r.notes);
  if (notes) warnings.push(`Remarque de l’IA : ${notes}`);

  return {
    name,
    brand: text(r.brand),
    packageQuantity: hasSize ? quantity : null,
    packageUnit: hasSize ? unit : null,
    priceCents: hasPrice ? priceCents : null,
    unitPriceText: text(r.unitPrice),
    promotionText,
    barcode,
    ingredientId,
    ingredientText,
    warnings,
  };
}
