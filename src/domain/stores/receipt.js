/**
 * Ticket de caisse : lecture par l'IA (photo), puis prix et depense a verifier avant d'enregistrer.
 * Rien n'est enregistre sans validation ; un article non reconnu reste de cote.
 */
import { normalizeText } from '../ingredients/ingredients.js';

/**
 * @typedef {Object} ReceiptLine
 * @property {string} label            Tel qu'imprime sur le ticket
 * @property {string} name             Produit en clair (sans marque)
 * @property {number} count            Nombre d'articles
 * @property {number | null} packageQuantity   Contenu d'un article (ou poids achete si vendu au poids)
 * @property {string} packageUnit
 * @property {number} priceCents       Total paye pour la ligne
 * @property {boolean} soldLoose       Vendu au poids
 */

/**
 * @typedef {Object} Receipt
 * @property {string} storeName
 * @property {string | null} date
 * @property {number | null} totalCents
 * @property {ReceiptLine[]} lines
 */

const UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'piece'];

/** Consignes de lecture d'un ticket par l'IA. */
export const RECEIPT_PROMPT = `Tu lis la photo d'un ticket de caisse de supermarché (en France ou en Guyane).
Recopie fidèlement, sans rien inventer :
- storeName : l'enseigne et la ville si elles sont écrites ;
- date : la date d'achat au format AAAA-MM-JJ (vide si illisible) ;
- totalEuros : le total payé (null si illisible) ;
- lines : un élément par article alimentaire ou d'épicerie (pas les remises globales, ni les sacs, ni les consignes) :
  label (tel qu'imprimé), name (le produit en clair, en français, sans marque ni format, par exemple « lait demi-écrémé », « riz basmati », « tomates »),
  count (nombre d'articles, 1 par défaut), packageQuantity (contenu d'UN article d'après le libellé, par exemple 1 pour « 1L », 500 pour « 500G » ; pour un article pesé, le poids acheté ; null si inconnu),
  packageUnit (g, kg, ml, cl, l ou piece), priceEuros (le prix total payé pour la ligne, remise de la ligne déduite),
  weighed (vrai si l'article est vendu au poids, avec un prix au kilo sur le ticket).
Si la photo n'est pas un ticket de caisse lisible, found = false.`;

/** Format de la reponse de l'IA. */
export const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean' },
    storeName: { type: 'string' },
    date: { type: 'string' },
    totalEuros: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          name: { type: 'string' },
          count: { type: 'integer' },
          packageQuantity: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          packageUnit: { type: 'string', enum: UNITS },
          priceEuros: { type: 'number' },
          weighed: { type: 'boolean' },
        },
        required: ['label', 'name', 'count', 'packageQuantity', 'packageUnit', 'priceEuros', 'weighed'],
      },
    },
  },
  required: ['found', 'storeName', 'date', 'totalEuros', 'lines'],
};

/** @param {unknown} v */
const euros = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null);

/**
 * Reponse de l'IA verifiee. null si aucun ticket lisible.
 * @param {unknown} raw
 * @returns {Receipt | null}
 */
export function readReceiptAnswer(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw ?? {});
  if (r.found === false || !Array.isArray(r.lines)) return null;
  /** @type {ReceiptLine[]} */
  const lines = [];
  for (const item of r.lines) {
    const x = /** @type {Record<string, unknown>} */ (item ?? {});
    const priceCents = euros(x.priceEuros);
    const name = typeof x.name === 'string' ? x.name.trim().slice(0, 60) : '';
    if (priceCents === null || priceCents === 0 || !name) continue;
    const unit = UNITS.includes(String(x.packageUnit)) ? String(x.packageUnit) : 'piece';
    const qty = typeof x.packageQuantity === 'number' && x.packageQuantity > 0 ? x.packageQuantity : null;
    lines.push({
      label: typeof x.label === 'string' ? x.label.trim().slice(0, 60) : name,
      name,
      count: typeof x.count === 'number' && Number.isInteger(x.count) && x.count >= 1 && x.count <= 50 ? x.count : 1,
      packageQuantity: qty,
      packageUnit: unit,
      priceCents,
      soldLoose: x.weighed === true,
    });
  }
  if (!lines.length) return null;
  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  return { storeName: typeof r.storeName === 'string' ? r.storeName.trim().slice(0, 60) : '', date, totalCents: euros(r.totalEuros), lines };
}

/**
 * Prix d'un article du ticket au format des prix releves : prix d'un conditionnement, ou prix
 * au kilo / au litre pour un article pese. null si le contenu est inconnu.
 * @param {ReceiptLine} line
 * @returns {{ packageQuantity: number, packageUnit: string, priceCents: number, soldLoose: boolean } | null}
 */
export function receiptPrice(line) {
  if (line.packageQuantity === null) return null;
  if (line.soldLoose && (line.packageUnit === 'kg' || line.packageUnit === 'g')) {
    const kg = line.packageUnit === 'kg' ? line.packageQuantity : line.packageQuantity / 1000;
    return kg > 0 ? { packageQuantity: 1, packageUnit: 'kg', priceCents: Math.round(line.priceCents / kg), soldLoose: true } : null;
  }
  return { packageQuantity: line.packageQuantity, packageUnit: line.packageUnit, priceCents: Math.round(line.priceCents / line.count), soldLoose: line.soldLoose };
}

/**
 * Magasin du ticket parmi les magasins enregistres (nom contenu dans l'enseigne lue, ou l'inverse).
 * @param {string} storeName
 * @param {{ id: string, name: string }[]} stores
 * @returns {string | null}
 */
export function matchStore(storeName, stores) {
  const read = normalizeText(storeName);
  if (!read) return null;
  const words = (/** @type {string} */ s) => normalizeText(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const readWords = new Set(words(read));
  let best = null;
  let bestScore = 0;
  for (const s of stores) {
    const w = words(s.name);
    const score = w.filter((x) => readWords.has(x)).length / Math.max(1, w.length);
    if (score > bestScore) {
      best = s.id;
      bestScore = score;
    }
  }
  // Plus de la moitie des mots du magasin : « Carrefour Matoury » n'est pas « Carrefour Market Cayenne ».
  return bestScore > 0.5 ? best : null;
}
