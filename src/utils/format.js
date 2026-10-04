const dateLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dateShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * "samedi 3 octobre"
 * @param {Date} date
 * @returns {string}
 */
export function formatDayLong(date) {
  return dateLong.format(date);
}

/**
 * "3 octobre 2026", a partir d'une date ISO. Renvoie null si la date est illisible.
 * @param {string} iso
 * @returns {string | null}
 */
export function formatIsoDate(iso) {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : dateShort.format(new Date(time));
}

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/**
 * Nombre a la francaise : 1,5 ; 1 000.
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
  return numberFormat.format(value);
}

/**
 * Duree lisible : "45 min", "1 h 05".
 * @param {number} minutes
 * @returns {string}
 */
export function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}
