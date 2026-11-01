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
 * Exporte toutes les donnees locales dans un fichier JSON telecharge : chaque magasin de la
 * base (meme liste que la restauration), sauf les reglages prives.
 * @returns {Promise<void>}
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
  const file = buildExport({ schemaVersion: DB_VERSION, applicationVersion: APP_VERSION, data, now });
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName(now);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await setSetting(LAST_EXPORT_KEY, now.toISOString());
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
