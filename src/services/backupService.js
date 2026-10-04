import { APP_VERSION, SCHEMA_VERSION, BACKUP_REMINDER_DAYS } from '../config.js';
import { buildExport, exportFileName, isBackupReminderDue } from '../domain/backup/backup.js';
import { getAllSettings, getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { loadHouseholdRecord } from '../db/repositories/householdRepository.js';
import { getAllMeals } from '../db/repositories/mealRepository.js';

const LAST_EXPORT_KEY = 'lastExportAt';

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
 * Exporte toutes les donnees locales dans un fichier JSON telecharge.
 * @returns {Promise<void>}
 */
export async function exportData() {
  const now = new Date();
  const [settings, household, meals] = await Promise.all([getAllSettings(), loadHouseholdRecord(), getAllMeals()]);
  const file = buildExport({
    schemaVersion: SCHEMA_VERSION,
    applicationVersion: APP_VERSION,
    data: { settings, household, meals },
    now,
  });
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
