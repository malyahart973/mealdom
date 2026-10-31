/**
 * Fichier agenda (.ics) : evenements avec rappel, lus par le calendrier du telephone.
 * Les heures sont « flottantes » : le telephone les lit dans son propre fuseau horaire.
 */

/**
 * @typedef {Object} CalendarEvent
 * @property {string} uid            Identifiant stable (le meme evenement remplace l'ancien)
 * @property {string} date           AAAA-MM-JJ
 * @property {string} start          HH:MM
 * @property {string} end            HH:MM (meme jour)
 * @property {string} summary
 * @property {string} description
 * @property {number} alarmMinutes   Rappel avant le debut
 */

/**
 * Texte echappe pour un fichier agenda.
 * @param {string} text
 * @returns {string}
 */
function icsText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
}

/**
 * @param {string} date AAAA-MM-JJ
 * @param {string} time HH:MM
 * @returns {string} AAAAMMJJTHHMM00 (heure locale de l'appareil)
 */
function icsDateTime(date, time) {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

/**
 * Ajoute des minutes a une heure HH:MM (sans changer de jour au-dela de 23:59).
 * @param {string} time
 * @param {number} minutes
 * @returns {string}
 */
export function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * @param {string} product   Nom du produit pour PRODID (ex. Courses)
 * @param {CalendarEvent[]} events
 * @param {string} stamp     Horodatage de creation (AAAAMMJJTHHMMSSZ)
 * @returns {string}
 */
export function calendarFile(product, events, stamp) {
  /** @type {string[]} */
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//MealDom//${product}//FR`, 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@mealdom`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(e.date, e.start)}`,
      `DTEND:${icsDateTime(e.date, e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
      `DESCRIPTION:${icsText(e.description)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(e.summary)}`,
      `TRIGGER:-PT${e.alarmMinutes}M`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
