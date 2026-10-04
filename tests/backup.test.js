import { test, assertEqual } from './runner.js';
import { buildExport, validateExport, exportFileName, isBackupReminderDue } from '../src/domain/backup/backup.js';

const NOW = new Date('2026-10-03T10:00:00.000Z');

test("L'export contient la version, la date et les donnees", () => {
  const file = buildExport({ schemaVersion: 1, applicationVersion: '0.1.0', data: { settings: [] }, now: NOW });
  assertEqual(file, {
    schemaVersion: 1,
    exportDate: '2026-10-03T10:00:00.000Z',
    applicationVersion: '0.1.0',
    data: { settings: [] },
  });
});

test('Un export construit par MealDom est valide', () => {
  const file = buildExport({ schemaVersion: 1, applicationVersion: '0.1.0', data: {}, now: NOW });
  assertEqual(validateExport(file), { ok: true });
});

test("Un fichier sans version de format est refuse", () => {
  assertEqual(validateExport({ exportDate: NOW.toISOString(), applicationVersion: '0.1.0', data: {} }).ok, false);
});

test("Un fichier sans donnees est refuse", () => {
  assertEqual(validateExport({ schemaVersion: 1, exportDate: NOW.toISOString(), applicationVersion: '0.1.0' }).ok, false);
});

test("Un contenu qui n'est pas un objet est refuse", () => {
  assertEqual(validateExport('bonjour').ok, false);
  assertEqual(validateExport(null).ok, false);
});

test("Le nom du fichier contient la date du jour", () => {
  assertEqual(exportFileName(new Date(2026, 9, 3)), 'mealdom-sauvegarde-2026-10-03.json');
});

test('Rappel affiche si aucune sauvegarde', () => {
  assertEqual(isBackupReminderDue(null, NOW, 14), true);
});

test('Pas de rappel 13 jours apres une sauvegarde', () => {
  assertEqual(isBackupReminderDue('2026-09-20T10:00:00.000Z', NOW, 14), false);
});

test('Rappel affiche 14 jours apres une sauvegarde', () => {
  assertEqual(isBackupReminderDue('2026-09-19T10:00:00.000Z', NOW, 14), true);
});

test('Rappel affiche si la date enregistree est illisible', () => {
  assertEqual(isBackupReminderDue('pas une date', NOW, 14), true);
});
