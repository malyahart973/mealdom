import { APP_VERSION, SCHEMA_VERSION, BACKUP_REMINDER_DAYS } from '../config.js';
import { buildExport, exportFileName, isBackupReminderDue } from '../domain/backup/backup.js';
import { getAllSettings, getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { loadHouseholdRecord } from '../db/repositories/householdRepository.js';
import { getAllMeals } from '../db/repositories/mealRepository.js';
import { getInventory, getPackages, getShoppingLists } from '../db/repositories/shoppingRepository.js';
import { getStores, getPrices, getBudgetRecord, getExpenses } from '../db/repositories/budgetRepository.js';
import { getConversations, getHistory, getPreferences } from '../db/repositories/assistantRepository.js';
import { getDriveProducts, getDriveOrders } from '../db/repositories/driveRepository.js';
import { getProgramRecord, getWeights } from '../db/repositories/programRepository.js';
import { getTrips } from '../db/repositories/tripRepository.js';

/** Reglages jamais exportes : la cle API de l'assistant reste sur l'appareil. */
const PRIVATE_SETTINGS = new Set(['assistantApiKey']);

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
  const [allSettings, household, meals, inventory, packages, shoppingLists, stores, prices, budget, expenses] = await Promise.all([
    getAllSettings(),
    loadHouseholdRecord(),
    getAllMeals(),
    getInventory(),
    getPackages(),
    getShoppingLists(),
    getStores(),
    getPrices(),
    getBudgetRecord(),
    getExpenses(),
  ]);
  const [conversations, changeHistory, preferences, driveProducts, driveOrders, program, weights, shoppingTrips] = await Promise.all([
    getConversations(),
    getHistory(),
    getPreferences(),
    getDriveProducts(),
    getDriveOrders(),
    getProgramRecord(),
    getWeights(),
    getTrips(),
  ]);
  const settings = allSettings.filter((s) => !PRIVATE_SETTINGS.has(s.key));
  const file = buildExport({
    schemaVersion: SCHEMA_VERSION,
    applicationVersion: APP_VERSION,
    data: {
      settings, household, meals, inventory, packages, shoppingLists, stores, prices, budget, expenses,
      conversations, changeHistory, preferences, driveProducts, driveOrders, program, weights, shoppingTrips,
    },
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
