import { test, assertEqual } from './runner.js';
import { buildExport, validateExport, exportFileName, isBackupReminderDue, restorePlan, BACKUP_STORES } from '../src/domain/backup/backup.js';
import { migrations } from '../src/db/migrations.js';

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

const PRIVATE = new Set(['assistantApiKey']);
/** @param {Record<string, unknown>} data @param {number} [schemaVersion] */
const backup = (data, schemaVersion = 9) => buildExport({ schemaVersion, applicationVersion: '0.17.0', data, now: NOW });

test('Restauration : chaque magasin du fichier est remplacé, les enregistrements uniques deviennent des listes', () => {
  const r = restorePlan(backup({
    settings: [{ key: 'recipeRatings', value: {} }],
    household: { id: 'main', members: [] },
    meals: [{ id: 'm1', date: '2026-10-05' }, { id: 'm2', date: '2026-10-06' }],
    program: null,
    weights: [{ date: '2026-10-01', kg: 80 }],
  }), 9, PRIVATE);
  assertEqual(r.ok && r.plan.writes.map((w) => `${w.store}:${w.records.length}`), ['settings:1', 'household:1', 'meals:2', 'program:0', 'weights:1']);
  assertEqual(r.ok && r.plan.counts, { meals: 2, weights: 1, recipes: 0, prices: 0 });
});

test('Restauration : les magasins absents du fichier (ancienne sauvegarde) ne sont pas touchés', () => {
  const r = restorePlan(backup({ meals: [] }, 3), 9, PRIVATE);
  assertEqual(r.ok && r.plan.writes.map((w) => w.store), ['meals']);
});

test('Restauration : la clé de l’assistant n’est jamais reprise du fichier', () => {
  const r = restorePlan(backup({ settings: [{ key: 'assistantApiKey', value: 'sk-ant-x' }, { key: 'guidedChoices', value: {} }] }), 9, PRIVATE);
  assertEqual(r.ok && r.plan.writes[0].records.map((x) => x.key), ['guidedChoices']);
});

test('Restauration refusée : version plus récente, fichier abîmé, aucune donnée', () => {
  const newer = restorePlan(backup({ meals: [] }, 10), 9, PRIVATE);
  assertEqual([newer.ok, !newer.ok && newer.error.includes('plus récente')], [false, true]);
  assertEqual(restorePlan(backup({ meals: [{ date: '2026-10-05' }] }), 9, PRIVATE).ok, false);
  assertEqual(restorePlan(backup({ meals: 'non' }), 9, PRIVATE).ok, false);
  assertEqual(restorePlan(backup({ autre: [] }), 9, PRIVATE).ok, false);
  assertEqual(restorePlan('pas une sauvegarde', 9, PRIVATE).ok, false);
});

test('La sauvegarde couvre tous les magasins de la base', () => {
  /** @type {string[]} */
  const created = [];
  const fake = { createObjectStore: (/** @type {string} */ name) => { created.push(name); return { createIndex() {} }; } };
  for (const m of migrations) m(/** @type {any} */ (fake), /** @type {any} */ (null));
  assertEqual(BACKUP_STORES.map((s) => s.store).sort(), created.sort());
});
