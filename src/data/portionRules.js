/**
 * Coefficients de portions PAR DEFAUT.
 * Ce sont des donnees : le foyer pourra les modifier (phase Foyer).
 * @type {import('../domain/portions/portions.js').PortionRule[]}
 */
export const DEFAULT_PORTION_RULES = [
  { category: 'adult', label: 'Adulte', coefficient: 1 },
  { category: 'child', label: 'Enfant', coefficient: 0.5 },
];
