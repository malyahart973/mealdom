/**
 * Dates "calendrier" au format AAAA-MM-JJ, en heure locale (jamais en UTC,
 * pour qu'un repas du lundi reste le lundi quel que soit le fuseau).
 */

/**
 * @param {Date} date
 * @returns {string}
 */
export function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {string} iso
 * @returns {Date | null} null si la date est invalide
 */
export function parseIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toIsoDate(date) === iso ? date : null;
}

/**
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function addDays(iso, days) {
  const date = parseIsoDate(iso);
  if (!date) throw new Error(`Date invalide : ${iso}`);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/**
 * Lundi de la semaine contenant la date.
 * @param {string} iso
 * @returns {string}
 */
export function weekStart(iso) {
  const date = parseIsoDate(iso);
  if (!date) throw new Error(`Date invalide : ${iso}`);
  const offset = (date.getDay() + 6) % 7; // lundi = 0
  return addDays(iso, -offset);
}

/**
 * Les 7 jours de la semaine commencant au lundi donne.
 * @param {string} monday
 * @returns {string[]}
 */
export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
