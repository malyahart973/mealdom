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
