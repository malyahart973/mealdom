/**
 * Regles metier de la sauvegarde (export) des donnees.
 * Fonctions pures : aucune dependance au navigateur, testables partout.
 */

/**
 * @typedef {Object} ExportFile
 * @property {number} schemaVersion
 * @property {string} exportDate        Date ISO de l'export
 * @property {string} applicationVersion
 * @property {Record<string, unknown>} data
 */

/**
 * Construit le contenu d'un fichier d'export.
 * @param {{ schemaVersion: number, applicationVersion: string, data: Record<string, unknown>, now: Date }} params
 * @returns {ExportFile}
 */
export function buildExport({ schemaVersion, applicationVersion, data, now }) {
  return {
    schemaVersion,
    exportDate: now.toISOString(),
    applicationVersion,
    data,
  };
}

/**
 * Verifie qu'un objet a la forme d'un fichier d'export MealDom.
 * @param {unknown} value
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateExport(value) {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: "Le fichier n'est pas une sauvegarde MealDom." };
  }
  const file = /** @type {Record<string, unknown>} */ (value);
  if (!Number.isInteger(file.schemaVersion) || /** @type {number} */ (file.schemaVersion) < 1) {
    return { ok: false, error: 'Version de format absente ou invalide.' };
  }
  if (typeof file.exportDate !== 'string' || Number.isNaN(Date.parse(file.exportDate))) {
    return { ok: false, error: "Date d'export absente ou invalide." };
  }
  if (typeof file.applicationVersion !== 'string') {
    return { ok: false, error: "Version de l'application absente." };
  }
  if (typeof file.data !== 'object' || file.data === null || Array.isArray(file.data)) {
    return { ok: false, error: 'Aucune donnee dans le fichier.' };
  }
  return { ok: true };
}

/**
 * Nom du fichier d'export, ex. "mealdom-sauvegarde-2026-10-03.json".
 * @param {Date} now
 * @returns {string}
 */
export function exportFileName(now) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `mealdom-sauvegarde-${y}-${m}-${d}.json`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Indique si un rappel de sauvegarde doit etre affiche.
 * Jamais sauvegarde = rappel. Date illisible = rappel (prudence).
 * @param {string | null} lastExportIso
 * @param {Date} now
 * @param {number} reminderDays
 * @returns {boolean}
 */
export function isBackupReminderDue(lastExportIso, now, reminderDays) {
  if (!lastExportIso) return true;
  const last = Date.parse(lastExportIso);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= reminderDays * DAY_MS;
}
