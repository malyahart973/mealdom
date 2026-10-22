/**
 * Suivi du poids : pesees, tendance, progression vers l'objectif.
 */
import { parseIsoDate } from '../planning/dates.js';

/** @typedef {{ date: string, kg: number, note: string }} WeightEntry */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {WeightEntry} entry
 * @param {string} today
 * @returns {string[]}
 */
export function validateWeightEntry(entry, today) {
  /** @type {string[]} */
  const errors = [];
  if (!parseIsoDate(entry.date)) errors.push('Indiquez la date de la pesée.');
  else if (entry.date > today) errors.push('La date de la pesée ne peut pas être dans le futur.');
  if (!Number.isFinite(entry.kg) || entry.kg < 30 || entry.kg > 300) errors.push('Indiquez un poids en kilos, par exemple 71,4.');
  if (entry.note.length > 80) errors.push('La note est trop longue (80 caractères au plus).');
  return errors;
}

/**
 * Lit un poids saisi ("71,4", "71.4 kg"). NaN si illisible.
 * @param {string} text
 * @returns {number}
 */
export function parseKg(text) {
  const clean = text.replace(/\s|kg/gi, '').replace(',', '.');
  return /^\d{2,3}(\.\d{1,2})?$/.test(clean) ? Number(clean) : Number.NaN;
}

/**
 * @param {WeightEntry[]} entries
 * @returns {WeightEntry[]} du plus ancien au plus recent
 */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * @param {string} iso
 * @returns {number}
 */
function dayNumber(iso) {
  const d = parseIsoDate(iso);
  return d ? Math.round(d.getTime() / DAY_MS) : 0;
}

/**
 * Moyenne des pesees des 7 jours precedant chaque pesee (lisse les variations d'eau).
 * @param {WeightEntry[]} entries
 * @returns {{ date: string, kg: number }[]}
 */
export function smoothedTrend(entries) {
  const sorted = sortEntries(entries);
  return sorted.map((e) => {
    const end = dayNumber(e.date);
    const window = sorted.filter((x) => dayNumber(x.date) <= end && dayNumber(x.date) > end - 7);
    const avg = window.reduce((s, x) => s + x.kg, 0) / window.length;
    return { date: e.date, kg: Math.round(avg * 10) / 10 };
  });
}

/**
 * Pente (kg par semaine) des pesees des 28 derniers jours, par moindres carres.
 * null s'il faut plus de donnees (au moins 3 pesees sur 10 jours).
 * @param {WeightEntry[]} entries
 * @param {string} today
 * @returns {number | null}
 */
export function weeklyRate(entries, today) {
  const end = dayNumber(today);
  const recent = sortEntries(entries).filter((e) => dayNumber(e.date) > end - 28);
  if (recent.length < 3) return null;
  const xs = recent.map((e) => dayNumber(e.date));
  if (Math.max(...xs) - Math.min(...xs) < 10) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = recent.reduce((a, e) => a + e.kg, 0) / n;
  let num = 0;
  let den = 0;
  recent.forEach((e, i) => {
    num += (xs[i] - mx) * (e.kg - my);
    den += (xs[i] - mx) ** 2;
  });
  return den === 0 ? null : Math.round((num / den) * 7 * 100) / 100;
}

/**
 * @typedef {Object} WeightProgress
 * @property {number} startKg
 * @property {number} currentKg
 * @property {number} goalKg
 * @property {number} lostKg
 * @property {number} remainingKg
 * @property {number} percent            0 a 100
 * @property {number | null} rateKgPerWeek negatif = perte
 * @property {'too_fast' | 'gaining' | 'stalled' | 'on_track' | 'not_enough_data' | 'reached'} status
 */

/**
 * Progression vers l'objectif.
 * - perte de plus de 1 kg par semaine : trop rapide, a signaler ;
 * - prise de plus de 0,2 kg par semaine : reprise ;
 * - variation de moins de 0,1 kg par semaine : plateau.
 * @param {{ startWeightKg: number, goalWeightKg: number }} program
 * @param {WeightEntry[]} entries
 * @param {string} today
 * @returns {WeightProgress}
 */
export function weightProgress(program, entries, today) {
  const sorted = sortEntries(entries);
  const currentKg = sorted.length ? sorted[sorted.length - 1].kg : program.startWeightKg;
  const total = program.startWeightKg - program.goalWeightKg;
  const lostKg = Math.round((program.startWeightKg - currentKg) * 10) / 10;
  const remainingKg = Math.max(0, Math.round((currentKg - program.goalWeightKg) * 10) / 10);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((lostKg / total) * 100))) : 0;
  const rate = weeklyRate(entries, today);
  /** @type {WeightProgress['status']} */
  let status = 'not_enough_data';
  if (remainingKg === 0 && sorted.length > 0) status = 'reached';
  else if (rate !== null) {
    if (rate < -1) status = 'too_fast';
    else if (rate > 0.2) status = 'gaining';
    else if (rate > -0.1) status = 'stalled';
    else status = 'on_track';
  }
  return { startKg: program.startWeightKg, currentKg, goalKg: program.goalWeightKg, lostKg, remainingKg, percent, rateKgPerWeek: rate, status };
}
