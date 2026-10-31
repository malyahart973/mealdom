import { test, assertEqual } from './runner.js';
import { validateMeasurement, parseCm, measurementChanges, checkInReport } from '../src/domain/nutrition/measurements.js';

const day = (/** @type {string} */ iso) => iso;
const list = [
  { date: '2026-10-01', values: { waist: 92, hips: 104 }, note: '' },
  { date: '2026-10-22', values: { waist: 90.5, hips: 103, arm: 31 }, note: '' },
  { date: '2026-11-12', values: { waist: 89, hips: 103 }, note: '' },
];

test('Mesures : centimètres lus, au moins une mesure, valeurs plausibles', () => {
  assertEqual([parseCm('85,5'), parseCm('86 cm'), parseCm(''), Number.isNaN(parseCm('abc'))], [85.5, 86, null, true]);
  assertEqual(validateMeasurement({ date: '2026-11-01', values: { waist: 88 }, note: '' }, '2026-11-02'), []);
  assertEqual(validateMeasurement({ date: '2026-11-05', values: {}, note: '' }, '2026-11-02').length, 2);
  assertEqual(validateMeasurement({ date: '2026-11-01', values: { arm: 5 }, note: '' }, '2026-11-02').length, 1);
});

test('Évolution : depuis la mesure précédente et depuis le début, mesure par mesure', () => {
  assertEqual(
    measurementChanges(list).map((c) => [c.id, c.latest, c.sincePrevious, c.sinceStart]),
    [['waist', 89, -1.5, -3], ['hips', 103, 0, -1], ['arm', 31, null, null]],
  );
});

test('Bilan pour le coach : poids et mensurations avec leur évolution, rien d’inventé', () => {
  const weights = [{ date: '2026-10-01', kg: 75.6 }, { date: '2026-10-22', kg: 74.8 }, { date: '2026-11-12', kg: 74.1 }];
  const text = checkInReport(weights, list, '2026-11-12', day);
  assertEqual(text.split('\n'), [
    'Bilan du 2026-11-12',
    'Poids : 74,1 kg (pesée du 2026-11-12), −0,7 kg depuis le bilan précédent, −1,5 kg depuis le début (2026-10-01)',
    'Mensurations du 2026-11-12 :',
    '- Tour de taille : 89 cm (−1,5 cm depuis le bilan précédent, −3 cm depuis le début)',
    '- Hanches : 103 cm (stable depuis le bilan précédent, −1 cm depuis le début)',
    '- Bras : 31 cm',
  ]);
  assertEqual(checkInReport([], [], '2026-11-12', day).split('\n')[1], 'Aucune pesée ni mensuration enregistrée.');
});
