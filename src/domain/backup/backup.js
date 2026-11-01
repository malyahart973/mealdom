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
 * Contenu d'une sauvegarde : chaque cle de « data » est un magasin de la base, avec la cle de
 * ses enregistrements ; « single » : un seul enregistrement (ou null) au lieu d'une liste.
 * @type {{ store: string, id: string, single?: boolean }[]}
 */
export const BACKUP_STORES = [
  { store: 'settings', id: 'key' },
  { store: 'household', id: 'id', single: true },
  { store: 'meals', id: 'id' },
  { store: 'inventory', id: 'id' },
  { store: 'packages', id: 'ingredientId' },
  { store: 'shoppingLists', id: 'week' },
  { store: 'stores', id: 'id' },
  { store: 'prices', id: 'id' },
  { store: 'budget', id: 'id', single: true },
  { store: 'expenses', id: 'id' },
  { store: 'conversations', id: 'week' },
  { store: 'changeHistory', id: 'id' },
  { store: 'preferences', id: 'id' },
  { store: 'driveProducts', id: 'key' },
  { store: 'driveOrders', id: 'id' },
  { store: 'program', id: 'id', single: true },
  { store: 'weights', id: 'date' },
  { store: 'shoppingTrips', id: 'week' },
  { store: 'priceHistory', id: 'id' },
  { store: 'userRecipes', id: 'id' },
  { store: 'barcodes', id: 'code' },
];

/**
 * @typedef {Object} RestorePlan
 * @property {{ store: string, records: Record<string, unknown>[] }[]} writes   Magasins remplaces
 * @property {string} exportDate
 * @property {string} applicationVersion
 * @property {{ meals: number, weights: number, recipes: number, prices: number }} counts
 */

/**
 * Prepare la restauration d'une sauvegarde : verifie le fichier, sa version et chaque
 * enregistrement, sans rien ecrire. Les magasins absents du fichier (sauvegarde ancienne) ne
 * sont pas touches ; les reglages prives (cle de l'assistant) ne sont jamais repris du fichier.
 * @param {unknown} value             Contenu du fichier (JSON lu)
 * @param {number} schemaVersion      Version actuelle de la base
 * @param {Set<string>} privateSettings
 * @returns {{ ok: true, plan: RestorePlan } | { ok: false, error: string }}
 */
export function restorePlan(value, schemaVersion, privateSettings) {
  const valid = validateExport(value);
  if (!valid.ok) return valid;
  const file = /** @type {ExportFile} */ (value);
  if (file.schemaVersion > schemaVersion) {
    return { ok: false, error: `Cette sauvegarde vient d'une version plus récente de MealDom (${file.applicationVersion}) : mettez d'abord l'application à jour.` };
  }
  /** @type {RestorePlan['writes']} */
  const writes = [];
  for (const { store, id, single } of BACKUP_STORES) {
    if (!(store in file.data)) continue;
    const raw = file.data[store];
    const list = single ? (raw === null || raw === undefined ? [] : [raw]) : raw;
    if (!Array.isArray(list)) return { ok: false, error: `Sauvegarde abîmée (${store}) : rien n'a été modifié.` };
    /** @type {Record<string, unknown>[]} */
    const records = [];
    for (const r of list) {
      const key = typeof r === 'object' && r !== null ? /** @type {Record<string, unknown>} */ (r)[id] : undefined;
      if ((typeof key !== 'string' || !key) && typeof key !== 'number') return { ok: false, error: `Sauvegarde abîmée (${store}) : rien n'a été modifié.` };
      if (store === 'settings' && privateSettings.has(String(key))) continue;
      records.push(/** @type {Record<string, unknown>} */ (r));
    }
    writes.push({ store, records });
  }
  if (!writes.length) return { ok: false, error: 'Aucune donnée MealDom dans ce fichier.' };
  const count = (/** @type {string} */ store) => writes.find((w) => w.store === store)?.records.length ?? 0;
  return {
    ok: true,
    plan: {
      writes,
      exportDate: file.exportDate,
      applicationVersion: file.applicationVersion,
      counts: { meals: count('meals'), weights: count('weights'), recipes: count('userRecipes'), prices: count('priceHistory') },
    },
  };
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
