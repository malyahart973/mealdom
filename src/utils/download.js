/**
 * Fait telecharger un fichier texte par le navigateur (agenda, modele CSV...).
 * @param {string} text
 * @param {string} filename
 * @param {string} type   Type MIME, ex. text/calendar;charset=utf-8
 */
export function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Horodatage d'un fichier agenda (AAAAMMJJTHHMMSSZ). */
export function calendarStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}
