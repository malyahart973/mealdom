import { APP_VERSION, BACKUP_REMINDER_DAYS } from '../config.js';
import { buildExport, exportFileName, isBackupReminderDue, restorePlan, BACKUP_STORES } from '../domain/backup/backup.js';
import { openDatabase, promisify } from '../db/database.js';
import { DB_VERSION } from '../db/migrations.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';

/** @typedef {import('../domain/backup/backup.js').RestorePlan} RestorePlan */

/** Reglages jamais exportes : la cle API de l'assistant reste sur l'appareil. */
const PRIVATE_SETTINGS = new Set(['assistantApiKey']);

const LAST_EXPORT_KEY = 'lastExportAt';

/** Identifiant des magasins a un seul enregistrement (foyer, budget, programme). */
const SINGLE_ID = 'main';

/**
 * Date ISO du dernier export, ou null.
 * @returns {Promise<string | null>}
 */
export async function getLastExportDate() {
  const value = await getSetting(LAST_EXPORT_KEY);
  return typeof value === 'string' ? value : null;
}

/** @returns {Promise<boolean>} */
export async function isReminderDue() {
  return isBackupReminderDue(await getLastExportDate(), new Date(), BACKUP_REMINDER_DAYS);
}

/**
 * Fin d'une transaction IndexedDB (rejetee si elle est annulee : rien n'est alors ecrit).
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function completion(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée'));
  });
}

/**
 * Exporte toutes les donnees locales dans un fichier JSON : chaque magasin de la base (meme
 * liste que la restauration), sauf les reglages prives. Sur telephone, le fichier passe par le
 * menu de partage (Enregistrer dans Fichiers / iCloud Drive, Google Drive...) ; ailleurs, ou si
 * le partage n'est pas possible, il est telecharge.
 * @returns {Promise<'shared' | 'downloaded' | 'cancelled'>}
 */
export async function exportData() {
  const now = new Date();
  const db = await openDatabase();
  const tx = db.transaction(BACKUP_STORES.map((s) => s.store));
  const all = await Promise.all(BACKUP_STORES.map((s) => promisify(tx.objectStore(s.store).getAll())));
  /** @type {Record<string, unknown>} */
  const data = {};
  BACKUP_STORES.forEach(({ store, id, single }, i) => {
    const records = /** @type {Record<string, unknown>[]} */ (all[i]);
    if (single) data[store] = records.find((r) => r[id] === SINGLE_ID) ?? null;
    else data[store] = store === 'settings' ? records.filter((r) => !PRIVATE_SETTINGS.has(String(r.key))) : records;
  });
  const content = JSON.stringify(buildExport({ schemaVersion: DB_VERSION, applicationVersion: APP_VERSION, data, now }), null, 2);
  const name = exportFileName(now);
  const result = (await shareFile(content, name)) ?? downloadFile(content, name);
  if (result !== 'cancelled') await setSetting(LAST_EXPORT_KEY, now.toISOString());
  return result;
}

/**
 * Partage le fichier (telephone). null si le partage n'est pas possible : on telecharge alors.
 * @param {string} content
 * @param {string} name
 * @returns {Promise<'shared' | 'cancelled' | null>}
 */
async function shareFile(content, name) {
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const file = new File([content], name, { type: 'application/json' });
  if (!phone || !navigator.canShare?.({ files: [file] })) return null;
  try {
    await navigator.share({ files: [file], title: 'Sauvegarde MealDom' });
    return 'shared';
  } catch (error) {
    // Fermeture du menu par la personne : rien n'est sauvegarde. Autre refus : telechargement.
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : null;
  }
}

/**
 * @param {string} content
 * @param {string} name
 * @returns {'downloaded'}
 */
function downloadFile(content, name) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

/**
 * Lit et verifie un fichier de sauvegarde, sans rien ecrire.
 * @param {File} file
 * @returns {Promise<{ ok: true, plan: RestorePlan } | { ok: false, error: string }>}
 */
export async function readBackup(file) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: 'Ce fichier n’est pas une sauvegarde MealDom (contenu illisible).' };
  }
  return restorePlan(value, DB_VERSION, PRIVATE_SETTINGS);
}

/**
 * Remplace les donnees de l'appareil par celles de la sauvegarde, en une seule transaction :
 * tout est ecrit, ou rien (fichier abime, place insuffisante). La cle de l'assistant reste.
 * @param {RestorePlan} plan
 * @returns {Promise<void>}
 */
export async function applyBackup(plan) {
  // Reglages prives lus avant : ils sont remis apres le remplacement des reglages.
  const kept = [];
  for (const key of PRIVATE_SETTINGS) {
    const value = await getSetting(key);
    if (value !== null) kept.push({ key, value });
  }
  const db = await openDatabase();
  const tx = db.transaction(plan.writes.map((w) => w.store), 'readwrite');
  const done = completion(tx);
  for (const { store, records } of plan.writes) {
    const target = tx.objectStore(store);
    target.clear();
    for (const r of records) target.put(r);
    if (store !== 'settings') continue;
    for (const record of kept) target.put(record);
    // Les donnees sont celles de la sauvegarde : elle compte comme derniere sauvegarde.
    if (!records.some((r) => r.key === LAST_EXPORT_KEY)) target.put({ key: LAST_EXPORT_KEY, value: plan.exportDate });
  }
  await done;
}
