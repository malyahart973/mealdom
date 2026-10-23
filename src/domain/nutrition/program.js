/**
 * Programme de perte de poids : besoins, objectif calorique, repartition par repas
 * et portions personnelles. Regles prudentes :
 * - perte visee de 0,25 a 0,75 kg par semaine ;
 * - jamais en dessous de 1 200 kcal (femme) ou 1 500 kcal (homme) par jour ;
 * - objectif de poids refuse s'il donne un IMC inferieur a 18,5 ;
 * - reserve aux adultes ; un avis medical reste recommande.
 */
import { parseIsoDate, addDays } from '../planning/dates.js';

/** @typedef {'female' | 'male'} Sex */
/** @typedef {'sedentary' | 'light' | 'moderate' | 'active'} Activity */
/** @typedef {'breakfast' | 'lunch' | 'snack' | 'dinner'} ProgramSlot */
/** @typedef {import('./nutrition.js').Nutrients} Nutrients */

/** @type {{ id: Activity, label: string, factor: number }[]} */
export const ACTIVITY_LEVELS = [
  { id: 'sedentary', label: 'Sédentaire (peu ou pas d’exercice)', factor: 1.2 },
  { id: 'light', label: 'Légèrement actif (1 à 3 séances par semaine)', factor: 1.375 },
  { id: 'moderate', label: 'Actif (3 à 5 séances par semaine)', factor: 1.55 },
  { id: 'active', label: 'Très actif (sport quotidien)', factor: 1.725 },
];

/** Rythmes de perte proposes (kg par semaine). */
export const WEEKLY_LOSS_OPTIONS = [0.25, 0.5, 0.75];

/** Calories pour 1 kg de masse grasse (valeur de reference usuelle). */
export const KCAL_PER_KG = 7700;

/** Minimum journalier conseille sans suivi medical. */
export const MIN_KCAL = { female: 1200, male: 1500 };

/** Repartition par defaut des calories de la journee (en %). */
export const DEFAULT_MEAL_SPLIT = { breakfast: 25, lunch: 35, snack: 10, dinner: 30 };

/** Proteines visees par kg de poids actuel (preserve les muscles pendant la perte). */
export const PROTEIN_PER_KG = 1.3;

/**
 * @typedef {Object} Program
 * @property {'main'} id
 * @property {string | null} memberId      Personne du foyer concernee
 * @property {Sex | null} sex
 * @property {number | null} birthYear
 * @property {number} heightCm
 * @property {number} startWeightKg
 * @property {number} goalWeightKg
 * @property {Activity} activity
 * @property {number} weeklyLossKg
 * @property {string} startDate             AAAA-MM-JJ
 * @property {Record<ProgramSlot, number>} mealSplit
 * @property {boolean} active
 */

/**
 * @param {string} today
 * @returns {Program}
 */
export function createDefaultProgram(today) {
  return {
    id: 'main',
    memberId: null,
    sex: null,
    birthYear: null,
    heightCm: 0,
    startWeightKg: 0,
    goalWeightKg: 0,
    activity: 'sedentary',
    weeklyLossKg: 0.5,
    startDate: today,
    mealSplit: { ...DEFAULT_MEAL_SPLIT },
    active: false,
  };
}

/**
 * @param {number} weightKg
 * @param {number} heightCm
 * @returns {number}
 */
export function bmi(weightKg, heightCm) {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/**
 * Categorie de l'IMC (OMS).
 * @param {number} value
 * @returns {string}
 */
export function bmiCategory(value) {
  if (value < 18.5) return 'Insuffisance pondérale';
  if (value < 25) return 'Corpulence normale';
  if (value < 30) return 'Surpoids';
  return 'Obésité';
}

/**
 * Poids correspondant a un IMC donne.
 * @param {number} bmiValue
 * @param {number} heightCm
 * @returns {number}
 */
export function weightForBmi(bmiValue, heightCm) {
  const m = heightCm / 100;
  return Math.round(bmiValue * m * m * 10) / 10;
}

/**
 * @param {number} birthYear
 * @param {string} today
 * @returns {number}
 */
export function ageIn(birthYear, today) {
  return Number(today.slice(0, 4)) - birthYear;
}

/**
 * Metabolisme de base (formule de Mifflin-St Jeor), en kcal par jour.
 * @param {Sex} sex
 * @param {number} weightKg
 * @param {number} heightCm
 * @param {number} age
 * @returns {number}
 */
export function basalMetabolicRate(sex, weightKg, heightCm, age) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(sex === 'male' ? base + 5 : base - 161);
}

/**
 * Verifie le programme avant enregistrement.
 * @param {Program} p
 * @param {string} today
 * @returns {string[]}
 */
export function validateProgram(p, today) {
  /** @type {string[]} */
  const errors = [];
  if (p.sex !== 'female' && p.sex !== 'male') errors.push('Indiquez votre sexe : il change le calcul des besoins.');
  if (p.birthYear === null || !Number.isInteger(p.birthYear)) errors.push('Indiquez votre année de naissance.');
  else {
    const age = ageIn(p.birthYear, today);
    if (age < 18) errors.push('Ce programme est réservé aux adultes. Pour un enfant ou un adolescent, demandez conseil à un médecin.');
    if (age > 100) errors.push('Année de naissance invalide.');
  }
  if (!(p.heightCm >= 120 && p.heightCm <= 230)) errors.push('Indiquez votre taille en centimètres, par exemple 162.');
  if (!(p.startWeightKg >= 30 && p.startWeightKg <= 300)) errors.push('Indiquez votre poids actuel en kilos, par exemple 71,4.');
  if (!(p.goalWeightKg >= 30 && p.goalWeightKg <= 300)) errors.push('Indiquez le poids visé en kilos.');
  else if (p.goalWeightKg >= p.startWeightKg) errors.push('Le poids visé doit être inférieur au poids de départ.');
  else if (p.heightCm >= 120 && bmi(p.goalWeightKg, p.heightCm) < 18.5) {
    errors.push(`Ce poids donnerait un IMC inférieur à 18,5. Visez au moins ${String(weightForBmi(18.5, p.heightCm)).replace('.', ',')} kg.`);
  }
  if (!ACTIVITY_LEVELS.some((a) => a.id === p.activity)) errors.push('Choisissez votre niveau d’activité.');
  if (!WEEKLY_LOSS_OPTIONS.includes(p.weeklyLossKg)) errors.push('Choisissez un rythme de perte.');
  if (!parseIsoDate(p.startDate)) errors.push('Date de début invalide.');
  const split = Object.values(p.mealSplit);
  if (split.some((v) => !Number.isFinite(v) || v < 0) || split.reduce((a, b) => a + b, 0) !== 100) {
    errors.push('La répartition des repas doit faire 100 %.');
  }
  return errors;
}

/**
 * @typedef {Object} DailyTargets
 * @property {number} bmr
 * @property {number} tdee              Depense du jour (metabolisme x activite)
 * @property {number} kcal              Objectif calorique du jour
 * @property {number} deficit
 * @property {boolean} floorApplied     Vrai si le minimum de securite a limite le deficit
 * @property {number} weeklyLossKg      Perte attendue avec cet objectif
 * @property {number} proteinG
 * @property {number} fatG
 * @property {number} carbsG
 * @property {number} fiberG
 * @property {number | null} weeksToGoal
 */

/**
 * Objectifs du jour, recalcules avec le poids actuel.
 * @param {Program} p
 * @param {number} currentWeightKg
 * @param {string} today
 * @returns {DailyTargets}
 */
export function dailyTargets(p, currentWeightKg, today) {
  const sex = p.sex ?? 'female';
  const age = p.birthYear === null ? 40 : ageIn(p.birthYear, today);
  const bmrValue = basalMetabolicRate(sex, currentWeightKg, p.heightCm, age);
  const factor = ACTIVITY_LEVELS.find((a) => a.id === p.activity)?.factor ?? 1.2;
  const tdee = Math.round(bmrValue * factor);
  const wanted = Math.round((p.weeklyLossKg * KCAL_PER_KG) / 7);
  const floor = MIN_KCAL[sex];
  const raw = Math.round((tdee - wanted) / 10) * 10;
  const kcal = Math.max(raw, floor);
  const deficit = Math.max(0, tdee - kcal);
  const weeklyLossKg = Math.round(((deficit * 7) / KCAL_PER_KG) * 100) / 100;
  const proteinG = Math.round(PROTEIN_PER_KG * currentWeightKg);
  const fatG = Math.round((kcal * 0.3) / 9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  const remaining = currentWeightKg - p.goalWeightKg;
  return {
    bmr: bmrValue,
    tdee,
    kcal,
    deficit,
    floorApplied: raw < floor,
    weeklyLossKg,
    proteinG,
    fatG,
    carbsG,
    fiberG: 25,
    weeksToGoal: remaining <= 0 ? 0 : weeklyLossKg > 0 ? Math.ceil(remaining / weeklyLossKg) : null,
  };
}

/**
 * Date estimee d'arrivee a l'objectif.
 * @param {DailyTargets} targets
 * @param {string} today
 * @returns {string | null}
 */
export function goalDate(targets, today) {
  return targets.weeksToGoal === null ? null : addDays(today, targets.weeksToGoal * 7);
}

/**
 * Calories et proteines visees pour chaque repas.
 * @param {DailyTargets} targets
 * @param {Record<ProgramSlot, number>} split
 * @returns {Record<ProgramSlot, { kcal: number, proteinG: number }>}
 */
export function mealTargets(targets, split) {
  /** @param {number} pct */
  const part = (pct) => ({ kcal: Math.round((targets.kcal * pct) / 100), proteinG: Math.round((targets.proteinG * pct) / 100) });
  return { breakfast: part(split.breakfast), lunch: part(split.lunch), snack: part(split.snack), dinner: part(split.dinner) };
}

/** Bornes d'une portion personnelle : on ne propose ni une demi-assiette, ni une double. */
export const PORTION_MIN = 0.5;
export const PORTION_MAX = 1.6;

/**
 * Portion personnelle d'une recette pour atteindre les calories du repas,
 * arrondie a 0,05 portion pres et bornee.
 * @param {Nutrients} perPortion
 * @param {number} targetKcal
 * @returns {{ portions: number, kcal: number, protein: number, fits: boolean }}
 *   fits = faux si la borne a ete atteinte (recette trop riche ou trop legere pour ce repas)
 */
export function personalPortion(perPortion, targetKcal) {
  if (!(perPortion.kcal > 0)) return { portions: 1, kcal: 0, protein: 0, fits: false };
  const ideal = targetKcal / perPortion.kcal;
  const portions = Math.min(PORTION_MAX, Math.max(PORTION_MIN, Math.round(ideal * 20) / 20));
  return {
    portions,
    kcal: Math.round(perPortion.kcal * portions),
    protein: Math.round(perPortion.protein * portions),
    fits: ideal >= PORTION_MIN && ideal <= PORTION_MAX,
  };
}

/**
 * Note d'une recette pour un repas du programme (plus haut = mieux) :
 * portion proche d'une portion normale, riche en proteines et en fibres.
 * @param {Nutrients} perPortion
 * @param {{ kcal: number, proteinG: number }} target
 * @returns {number}
 */
export function programFitScore(perPortion, target) {
  const portion = personalPortion(perPortion, target.kcal);
  if (!portion.fits) return -100;
  const closeness = 1 - Math.min(1, Math.abs(portion.portions - 1));
  const proteinShare = perPortion.kcal > 0 ? (perPortion.protein * 4) / perPortion.kcal : 0;
  const fiberPer100 = perPortion.kcal > 0 ? (perPortion.fiber * 100) / perPortion.kcal : 0;
  return Math.round((closeness * 40 + Math.min(proteinShare, 0.4) * 100 + Math.min(fiberPer100, 3) * 5) * 10) / 10;
}

/**
 * Calories prevues un jour donne pour la personne suivie, avec ses portions personnelles.
 * Les repas ou elle n'est pas a table ne comptent pas ; les restes du diner comptent au dejeuner.
 * @param {Map<string, { kind: 'meal' | 'leftover', meal: import('../planning/planning.js').Meal }>} entries  Planning (plannedEntries)
 * @param {string} day
 * @param {{ memberId: string | null, mealSplit: Record<ProgramSlot, number> }} program
 * @param {Record<ProgramSlot, { kcal: number }>} targets
 * @param {(recipeId: string) => Nutrients | undefined} nutritionOf
 * @returns {{ kcal: number, meals: number }}
 */
export function plannedKcalForDay(entries, day, program, targets, nutritionOf) {
  let kcal = 0;
  let meals = 0;
  for (const slot of /** @type {ProgramSlot[]} */ (['breakfast', 'lunch', 'snack', 'dinner'])) {
    const entry = entries.get(`${day}|${slot}`);
    if (!entry) continue;
    const attendees = entry.kind === 'leftover' ? entry.meal.nextLunch?.attendees ?? [] : entry.meal.attendees;
    if (program.memberId && !attendees.includes(program.memberId)) continue;
    const n = nutritionOf(entry.meal.recipeId);
    if (!n) continue;
    kcal += program.mealSplit[slot] > 0 ? personalPortion(n, targets[slot].kcal).kcal : Math.round(n.kcal);
    meals++;
  }
  return { kcal, meals };
}
