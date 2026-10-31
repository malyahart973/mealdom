/**
 * Mensurations (tour de taille, hanches...) et bilan a envoyer au coach.
 * Le metre ruban dit souvent plus que la balance : la masse musculaire gagnee pese aussi.
 */
import { parseIsoDate } from '../planning/dates.js';

/** @typedef {'waist' | 'hips' | 'chest' | 'arm' | 'thigh'} MeasureId */

/** @type {{ id: MeasureId, label: string, hint: string }[]} */
export const MEASURES = [
  { id: 'waist', label: 'Tour de taille', hint: 'au niveau du nombril, ventre relâché' },
  { id: 'hips', label: 'Hanches', hint: 'au plus large des fesses' },
  { id: 'chest', label: 'Poitrine', hint: 'au plus large, bras le long du corps' },
  { id: 'arm', label: 'Bras', hint: 'au milieu du bras, détendu' },
  { id: 'thigh', label: 'Cuisse', hint: 'au plus large, debout' },
];

/**
 * @typedef {Object} Measurement
 * @property {string} date                       AAAA-MM-JJ
 * @property {Partial<Record<MeasureId, number>>} values   En centimetres
 * @property {string} note
 */

/**
 * @param {Measurement} m
 * @param {string} today
 * @returns {string[]}
 */
export function validateMeasurement(m, today) {
  /** @type {string[]} */
  const errors = [];
  if (!parseIsoDate(m.date)) errors.push('Indiquez la date des mesures.');
  else if (m.date > today) errors.push('La date des mesures ne peut pas être dans le futur.');
  const values = Object.entries(m.values);
  if (values.length === 0) errors.push('Indiquez au moins une mesure.');
  for (const [id, cm] of values) {
    const label = MEASURES.find((x) => x.id === id)?.label ?? id;
    if (!Number.isFinite(cm) || cm < 15 || cm > 250) errors.push(`${label} : indiquez une mesure en centimètres, par exemple 85,5.`);
  }
  if (m.note.length > 80) errors.push('La note est trop longue (80 caractères au plus).');
  return errors;
}

/**
 * Lit une mesure saisie (« 85,5 », « 86 cm »). NaN si illisible, null si vide.
 * @param {string} text
 * @returns {number | null}
 */
export function parseCm(text) {
  const clean = text.replace(/\s|cm/gi, '').replace(',', '.');
  if (!clean) return null;
  return /^\d{2,3}(\.\d)?$/.test(clean) ? Number(clean) : Number.NaN;
}

/**
 * @param {Measurement[]} list
 * @returns {Measurement[]} du plus ancien au plus recent
 */
export function sortMeasurements(list) {
  return [...list].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Evolution de chaque mesure : derniere valeur, ecart avec la mesure precedente et avec la premiere.
 * @param {Measurement[]} list
 * @returns {{ id: MeasureId, label: string, latest: number, sincePrevious: number | null, sinceStart: number | null }[]}
 */
export function measurementChanges(list) {
  const sorted = sortMeasurements(list);
  /** @param {number} n */
  const round = (n) => Math.round(n * 10) / 10;
  return MEASURES.flatMap((m) => {
    const values = sorted.filter((x) => x.values[m.id] !== undefined).map((x) => /** @type {number} */ (x.values[m.id]));
    if (!values.length) return [];
    const latest = values[values.length - 1];
    return [{
      id: m.id,
      label: m.label,
      latest,
      sincePrevious: values.length > 1 ? round(latest - values[values.length - 2]) : null,
      sinceStart: values.length > 1 ? round(latest - values[0]) : null,
    }];
  });
}

/**
 * @param {number} n
 * @param {string} unit
 * @returns {string}
 */
function signed(n, unit) {
  const text = String(Math.abs(n)).replace('.', ',');
  return n === 0 ? `stable` : `${n < 0 ? '−' : '+'}${text} ${unit}`;
}

/**
 * Texte du bilan a envoyer au coach : poids actuel et evolution, mensurations et evolution
 * depuis le bilan precedent et depuis le debut. Rien n'est extrapole : seules les mesures saisies.
 * @param {{ date: string, kg: number }[]} weights
 * @param {Measurement[]} measurements
 * @param {string} today
 * @param {(iso: string) => string} dayLabel
 * @returns {string}
 */
export function checkInReport(weights, measurements, today, dayLabel) {
  const w = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const m = sortMeasurements(measurements);
  /** @type {string[]} */
  const lines = [`Bilan du ${dayLabel(today)}`];
  if (w.length) {
    const last = w[w.length - 1];
    const previousCheck = m.length > 1 ? m[m.length - 2].date : null;
    const before = previousCheck ? [...w].reverse().find((x) => x.date <= previousCheck) ?? null : null;
    const parts = [`Poids : ${String(last.kg).replace('.', ',')} kg (pesée du ${dayLabel(last.date)})`];
    if (before && before.date !== last.date) parts.push(`${signed(Math.round((last.kg - before.kg) * 10) / 10, 'kg')} depuis le bilan précédent`);
    if (w.length > 1) parts.push(`${signed(Math.round((last.kg - w[0].kg) * 10) / 10, 'kg')} depuis le début (${dayLabel(w[0].date)})`);
    lines.push(parts.join(', '));
  }
  if (m.length) {
    const latest = m[m.length - 1];
    lines.push(`Mensurations du ${dayLabel(latest.date)} :`);
    // Seulement les mesures prises ce jour-la.
    for (const c of measurementChanges(m).filter((x) => latest.values[x.id] !== undefined)) {
      const evo = [c.sincePrevious !== null ? `${signed(c.sincePrevious, 'cm')} depuis le bilan précédent` : '', c.sinceStart !== null && m.length > 2 ? `${signed(c.sinceStart, 'cm')} depuis le début` : ''].filter(Boolean);
      lines.push(`- ${c.label} : ${String(c.latest).replace('.', ',')} cm${evo.length ? ` (${evo.join(', ')})` : ''}`);
    }
  }
  if (lines.length === 1) lines.push('Aucune pesée ni mensuration enregistrée.');
  return lines.join('\n');
}
