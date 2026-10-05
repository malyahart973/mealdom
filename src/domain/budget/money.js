/**
 * Montants en CENTIMES ENTIERS (RM monnaie) : aucun calcul en euros a virgule.
 * L'arrondi n'intervient qu'a l'affichage.
 */

/** Devise par defaut (France metropolitaine et DROM). */
export const DEFAULT_CURRENCY = 'EUR';

/**
 * Lit un montant saisi ("42,50", "42.5", "1 234,56", "42 €") et le renvoie en centimes.
 * Renvoie NaN si la saisie n'est pas un montant positif valide (3 decimales refusees).
 * @param {string} text
 * @returns {number}
 */
export function parseAmountToCents(text) {
  const clean = text.replace(/[\s\u00a0\u202f€]/g, '').replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) return Number.NaN;
  const cents = (match[2] ?? '').padEnd(2, '0');
  return Number(match[1]) * 100 + Number(cents);
}

/**
 * "42,50 €" a partir de centimes.
 * @param {number} cents
 * @param {string} [currency]
 * @returns {string}
 */
export function formatCents(cents, currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

/**
 * Centimes en texte de saisie : 4250 -> "42,50".
 * @param {number} cents
 * @returns {string}
 */
export function centsToInput(cents) {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}
