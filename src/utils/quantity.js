import { getUnit } from '../domain/units/units.js';
import { formatNumber } from './format.js';

/**
 * Quantite lisible : "800 g", "2 gousses", "1 cuillère à soupe", "au goût".
 * @param {number | null} quantity
 * @param {string} unitId
 * @returns {string}
 */
export function formatQuantity(quantity, unitId) {
  const unit = getUnit(unitId);
  if (!unit) return quantity === null ? '' : formatNumber(quantity);
  if (unit.kind === 'qualitative' || quantity === null) return unit.label;
  const label = quantity >= 2 && unit.plural ? unit.plural : unit.label;
  return `${formatNumber(quantity)} ${label}`;
}
