import { escapeHtml } from './html.js';
import { UNITS } from '../domain/units/units.js';

/**
 * Options d'une liste d'unites mesurables (masse, volume, pieces), sans "au goût" ni contenants.
 * @param {string} selected
 * @returns {string}
 */
export function measurableUnitOptions(selected) {
  return UNITS.filter((u) => u.kind === 'mass' || u.kind === 'volume' || u.kind === 'count')
    .map((u) => `<option value="${u.id}"${u.id === selected ? ' selected' : ''}>${escapeHtml(u.label)}</option>`)
    .join('');
}

/**
 * Nombre decimal saisi a la francaise ("0,5"). NaN si invalide.
 * @param {string} text
 * @returns {number}
 */
export function parseDecimal(text) {
  const clean = text.trim().replace(',', '.');
  return clean === '' || !/^\d+(\.\d+)?$/.test(clean) ? Number.NaN : Number(clean);
}
