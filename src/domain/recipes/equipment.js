/** Equipements de cuisine que le foyer peut declarer. */

/** @typedef {{ id: string, label: string }} Equipment */

/** @type {Equipment[]} */
export const EQUIPMENT = [
  { id: 'stovetop', label: 'Plaques de cuisson' },
  { id: 'oven', label: 'Four' },
  { id: 'microwave', label: 'Micro-ondes' },
  { id: 'air_fryer', label: 'Air fryer' },
  { id: 'food_processor', label: 'Robot cuiseur' },
  { id: 'blender', label: 'Mixeur' },
  { id: 'barbecue', label: 'Barbecue' },
  { id: 'pressure_cooker', label: 'Autocuiseur ou multicuiseur' },
];

/** @type {Map<string, string>} */
const LABELS = new Map(EQUIPMENT.map((e) => [e.id, e.label]));

/**
 * @param {string} id
 * @returns {string}
 */
export function equipmentLabel(id) {
  return LABELS.get(id) ?? id;
}
