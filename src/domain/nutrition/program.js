/**
 * Programme de perte de poids : besoins, objectif calorique, repartition par repas
 * et portions personnelles. Plusieurs facons de faire : compter les calories ou se
 * reequilibrer sans compter, plus de proteines, jeune intermittent, seances de sport
 * et trame de repas (celle d'un coach ou d'une dieteticienne). Regles prudentes :
 * - perte visee de 0,25 a 0,75 kg par semaine (1 kg seulement a partir d'un IMC de 30),
 *   ou stabilisation ;
 * - jamais en dessous de 1 200 kcal (femme) ou 1 500 kcal (homme) par jour ;
 * - objectif de poids refuse s'il donne un IMC inferieur a 18,5 ;
 * - reserve aux adultes ; un avis medical reste recommande.
 */
import { parseIsoDate, addDays } from '../planning/dates.js';

/** @typedef {'female' | 'male'} Sex */
/** @typedef {'sedentary' | 'light' | 'moderate' | 'active'} Activity */
/** @typedef {import('../planning/planning.js').Slot} ProgramSlot */
/** @typedef {import('./nutrition.js').Nutrients} Nutrients */

/** @type {{ id: Activity, label: string, factor: number }[]} */
export const ACTIVITY_LEVELS = [
  { id: 'sedentary', label: 'Sédentaire (peu ou pas d’exercice)', factor: 1.2 },
  { id: 'light', label: 'Légèrement actif (1 à 3 séances par semaine)', factor: 1.375 },
  { id: 'moderate', label: 'Actif (3 à 5 séances par semaine)', factor: 1.55 },
  { id: 'active', label: 'Très actif (sport quotidien)', factor: 1.725 },
];

/** Rythmes proposes (kg perdus par semaine ; 0 = stabiliser son poids). */
export const PACES = [
  { kg: 0, label: 'Stabiliser mon poids' },
  { kg: 0.25, label: 'En douceur' },
  { kg: 0.5, label: 'Conseillé' },
  { kg: 0.75, label: 'Soutenu' },
  { kg: 1, label: 'Rapide (à partir d’un IMC de 30)' },
];
export const WEEKLY_LOSS_OPTIONS = PACES.map((p) => p.kg);

/** IMC minimal pour viser 1 kg par semaine. */
export const RAPID_PACE_MIN_BMI = 30;

/** Repas de la journee, dans l'ordre, avec leur heure habituelle (en heures). */
/** @type {{ id: ProgramSlot, label: string, hour: number }[]} */
export const PROGRAM_SLOTS = [
  { id: 'breakfast', label: 'Petit-déjeuner', hour: 7.5 },
  { id: 'morning_snack', label: 'Collation du matin', hour: 10 },
  { id: 'lunch', label: 'Déjeuner', hour: 12.5 },
  { id: 'snack', label: 'Goûter', hour: 16 },
  { id: 'dinner', label: 'Dîner', hour: 19.5 },
];
export const MIN_MEALS = 3;
export const MAX_MEALS = 5;

/** Facons de suivre le programme. */
/** @type {{ id: 'count' | 'balance', label: string, hint: string }[]} */
export const METHODS = [
  { id: 'count', label: 'Compter les calories', hint: 'Objectif chiffré par jour et par repas, portions en grammes.' },
  { id: 'balance', label: 'Rééquilibrage sans compter', hint: 'Pas de chiffres à suivre : l’assiette équilibrée et des portions repères (paume, poing).' },
];

/** Jeune intermittent : heures de jeune / heures pour manger. */
/** @type {{ id: '12_12' | '14_10' | '16_8', label: string, fastHours: number }[]} */
export const FASTING_PATTERNS = [
  { id: '12_12', label: '12 h de jeûne, 12 h pour manger', fastHours: 12 },
  { id: '14_10', label: '14 h de jeûne, 10 h pour manger', fastHours: 14 },
  { id: '16_8', label: '16 h de jeûne, 8 h pour manger', fastHours: 16 },
];

/** Activites sportives et leur depense (MET, equivalent metabolique). */
/** @type {{ id: string, label: string, met: number }[]} */
export const SPORT_KINDS = [
  { id: 'walk', label: 'Marche rapide', met: 4.3 },
  { id: 'run', label: 'Course à pied', met: 9 },
  { id: 'strength', label: 'Musculation, renforcement', met: 5 },
  { id: 'cardio', label: 'Cardio, fitness, zumba', met: 6.5 },
  { id: 'swim', label: 'Natation, aquagym', met: 6 },
  { id: 'bike', label: 'Vélo', met: 7 },
  { id: 'team', label: 'Sport collectif', met: 7 },
  { id: 'yoga', label: 'Yoga, pilates, étirements', met: 3 },
];
/** @type {{ id: 'easy' | 'moderate' | 'hard', label: string, factor: number }[]} */
export const INTENSITIES = [
  { id: 'easy', label: 'Douce', factor: 0.8 },
  { id: 'moderate', label: 'Modérée', factor: 1 },
  { id: 'hard', label: 'Intense', factor: 1.25 },
];
export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Part des calories du sport « remangee » : on recharge sans effacer la perte. */
export const SPORT_EAT_BACK = 0.5;

/**
 * Seance de sport de la semaine type.
 * @typedef {Object} SportSession
 * @property {number} day                  0 = lundi ... 6 = dimanche
 * @property {string} kind                 Voir SPORT_KINDS
 * @property {number} minutes
 * @property {'easy' | 'moderate' | 'hard'} intensity
 */

/** Calories pour 1 kg de masse grasse (valeur de reference usuelle). */
export const KCAL_PER_KG = 7700;

/** Minimum journalier conseille sans suivi medical. */
export const MIN_KCAL = { female: 1200, male: 1500 };

/** Repartition par defaut des calories de la journee (en %). */
/** @type {Record<ProgramSlot, number>} */
export const DEFAULT_MEAL_SPLIT = { breakfast: 25, morning_snack: 0, lunch: 35, snack: 10, dinner: 30 };

/** Poids relatifs des repas, pour repartir la journee selon les repas choisis. */
/** @type {Record<ProgramSlot, number>} */
const SLOT_WEIGHT = { breakfast: 25, morning_snack: 10, lunch: 35, snack: 10, dinner: 30 };

/** Proteines visees par kg de poids actuel (preserve les muscles pendant la perte). */
export const PROTEIN_PER_KG = 1.3;
/** Option « plus de proteines » : par kg de poids de reference (plafonne a un IMC de 27). */
export const HIGH_PROTEIN_PER_KG = 1.8;

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
 * @property {Record<ProgramSlot, number>} mealSplit   0 % = repas non pris
 * @property {boolean} active
 * @property {'count' | 'balance'} method   Compter les calories ou reequilibrage sans compter
 * @property {boolean} highProtein
 * @property {{ pattern: '12_12' | '14_10' | '16_8', windowStart: number } | null} fasting   windowStart : heure du premier repas
 * @property {SportSession[]} sport        Semaine type de sport
 * @property {Partial<Record<ProgramSlot, string>>} trame   Trame personnelle par repas (une ligne par element) ; vide = reperes conseilles
 * @property {string} sportNote            Trame des jours de sport (avant, apres la seance)
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
    method: 'count',
    highProtein: false,
    fasting: null,
    sport: [],
    trame: {},
    sportNote: '',
  };
}

/**
 * Programme enregistre par une version precedente : champs ajoutes depuis completes.
 * @param {Partial<Program> & { id: 'main' }} stored
 * @param {string} today
 * @returns {Program}
 */
export function normalizeProgram(stored, today) {
  const base = createDefaultProgram(today);
  return { ...base, ...stored, mealSplit: { ...base.mealSplit, morning_snack: 0, ...(stored.mealSplit ?? {}) }, trame: { ...(stored.trame ?? {}) }, sport: [...(stored.sport ?? [])] };
}

/**
 * Repartition des calories pour les repas choisis (total 100 %).
 * @param {ProgramSlot[]} slots
 * @returns {Record<ProgramSlot, number>}
 */
export function splitForMeals(slots) {
  /** @type {Record<ProgramSlot, number>} */
  const split = { breakfast: 0, morning_snack: 0, lunch: 0, snack: 0, dinner: 0 };
  const total = slots.reduce((sum, s) => sum + SLOT_WEIGHT[s], 0);
  if (!total) return split;
  for (const s of slots) split[s] = Math.round((SLOT_WEIGHT[s] * 100) / total);
  // L'arrondi est rattrape sur le repas le plus important.
  const main = [...slots].sort((a, b) => SLOT_WEIGHT[b] - SLOT_WEIGHT[a])[0];
  split[main] += 100 - Object.values(split).reduce((a, b) => a + b, 0);
  return split;
}

/**
 * Repas pris dans la journee (part de calories superieure a 0).
 * @param {{ mealSplit: Record<ProgramSlot, number> }} p
 * @returns {ProgramSlot[]}
 */
export function programMeals(p) {
  return PROGRAM_SLOTS.map((s) => s.id).filter((id) => (p.mealSplit[id] ?? 0) > 0);
}

/**
 * Fenetre de repas du jeune intermittent.
 * @param {NonNullable<Program['fasting']>} fasting
 * @returns {{ start: number, end: number }}  heures (end peut depasser 24)
 */
export function eatingWindow(fasting) {
  const fastHours = FASTING_PATTERNS.find((f) => f.id === fasting.pattern)?.fastHours ?? 16;
  return { start: fasting.windowStart, end: fasting.windowStart + 24 - fastHours };
}

/**
 * Repas dont l'heure habituelle tombe dans la fenetre de repas.
 * @param {NonNullable<Program['fasting']>} fasting
 * @returns {ProgramSlot[]}
 */
export function slotsInWindow(fasting) {
  const { start, end } = eatingWindow(fasting);
  return PROGRAM_SLOTS.filter((s) => s.hour >= start && s.hour <= end).map((s) => s.id);
}

/**
 * Heure lisible : 12 -> « 12 h », 19.5 -> « 19 h 30 ».
 * @param {number} hour
 * @returns {string}
 */
export function hourText(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/**
 * Calories depensees par une seance, au-dela du repos.
 * @param {SportSession} session
 * @param {number} weightKg
 * @returns {number}
 */
export function sessionKcal(session, weightKg) {
  const met = SPORT_KINDS.find((k) => k.id === session.kind)?.met ?? 5;
  const factor = INTENSITIES.find((i) => i.id === session.intensity)?.factor ?? 1;
  return Math.max(0, Math.round((met * factor - 1) * weightKg * (session.minutes / 60)));
}

/**
 * Jour de la semaine d'une date (0 = lundi).
 * @param {string} isoDay
 * @returns {number}
 */
export function weekdayIndex(isoDay) {
  const d = parseIsoDate(isoDay);
  return d ? (d.getDay() + 6) % 7 : 0;
}

/**
 * Seances prevues un jour donne et calories depensees.
 * @param {{ sport: SportSession[] }} p
 * @param {number} weightKg
 * @param {string} isoDay
 * @returns {{ sessions: SportSession[], kcal: number }}
 */
export function sportForDay(p, weightKg, isoDay) {
  const day = weekdayIndex(isoDay);
  const sessions = p.sport.filter((s) => s.day === day);
  return { sessions, kcal: sessions.reduce((sum, s) => sum + sessionKcal(s, weightKg), 0) };
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
  else if (p.weeklyLossKg > 0 && p.goalWeightKg >= p.startWeightKg) errors.push('Le poids visé doit être inférieur au poids de départ (ou choisissez « Stabiliser mon poids »).');
  else if (p.heightCm >= 120 && bmi(p.goalWeightKg, p.heightCm) < 18.5) {
    errors.push(`Ce poids donnerait un IMC inférieur à 18,5. Visez au moins ${String(weightForBmi(18.5, p.heightCm)).replace('.', ',')} kg.`);
  }
  if (!ACTIVITY_LEVELS.some((a) => a.id === p.activity)) errors.push('Choisissez votre niveau d’activité.');
  if (!WEEKLY_LOSS_OPTIONS.includes(p.weeklyLossKg)) errors.push('Choisissez un rythme de perte.');
  else if (p.weeklyLossKg >= 1 && p.heightCm >= 120 && p.startWeightKg > 0 && bmi(p.startWeightKg, p.heightCm) < RAPID_PACE_MIN_BMI) {
    errors.push(`Le rythme rapide (1 kg par semaine) est réservé à un IMC d’au moins ${RAPID_PACE_MIN_BMI} : choisissez 0,75 kg au plus.`);
  }
  if (p.method !== 'count' && p.method !== 'balance') errors.push('Choisissez une méthode.');
  const meals = programMeals(p);
  if (meals.length < MIN_MEALS || meals.length > MAX_MEALS) errors.push(`Choisissez de ${MIN_MEALS} à ${MAX_MEALS} repas par jour (goûters compris).`);
  if (p.fasting) {
    if (!FASTING_PATTERNS.some((f) => f.id === p.fasting?.pattern) || !(p.fasting.windowStart >= 5 && p.fasting.windowStart <= 14)) errors.push('Choisissez le jeûne et l’heure du premier repas.');
    else {
      const allowed = slotsInWindow(p.fasting);
      const outside = meals.filter((m) => !allowed.includes(m));
      if (outside.length) {
        const { start, end } = eatingWindow(p.fasting);
        errors.push(`Avec votre fenêtre de repas (${hourText(start)} – ${hourText(end)}), retirez : ${outside.map((m) => PROGRAM_SLOTS.find((x) => x.id === m)?.label.toLowerCase()).join(', ')}.`);
      }
    }
  }
  for (const session of p.sport) {
    if (!(session.day >= 0 && session.day <= 6) || !SPORT_KINDS.some((k) => k.id === session.kind) || !(session.minutes >= 10 && session.minutes <= 300) || !INTENSITIES.some((i) => i.id === session.intensity)) {
      errors.push('Une séance de sport est incomplète (jour, activité, durée de 10 à 300 minutes, intensité).');
      break;
    }
  }
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
  // Stabilisation : l'arrondi a 10 kcal pres ne cree pas de deficit.
  const deficit = p.weeklyLossKg > 0 ? Math.max(0, tdee - kcal) : 0;
  const weeklyLossKg = Math.round(((deficit * 7) / KCAL_PER_KG) * 100) / 100;
  const proteinG = p.highProtein
    ? Math.round(HIGH_PROTEIN_PER_KG * Math.min(currentWeightKg, weightForBmi(27, p.heightCm)))
    : Math.round(PROTEIN_PER_KG * currentWeightKg);
  const fatG = Math.round((kcal * 0.3) / 9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  const remaining = p.weeklyLossKg > 0 ? currentWeightKg - p.goalWeightKg : 0;
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
 * Objectifs d'un jour donne : un jour de sport, une partie des calories depensees
 * est remangee (glucides), pour recuperer sans effacer la perte.
 * @param {Program} p
 * @param {DailyTargets} base
 * @param {number} weightKg
 * @param {string} isoDay
 * @returns {DailyTargets & { sportKcal: number, sessions: SportSession[] }}
 */
export function dayTargets(p, base, weightKg, isoDay) {
  const sport = sportForDay(p, weightKg, isoDay);
  const extra = Math.round((sport.kcal * SPORT_EAT_BACK) / 10) * 10;
  return { ...base, kcal: base.kcal + extra, carbsG: base.carbsG + Math.round(extra / 4), sportKcal: sport.kcal, sessions: sport.sessions };
}

/**
 * Chaque rythme compare : calories par jour et date d'arrivee.
 * @param {Program} p
 * @param {number} currentWeightKg
 * @param {string} today
 * @returns {{ kg: number, label: string, kcal: number, weeklyLossKg: number, floorApplied: boolean, goalDate: string | null, allowed: boolean }[]}
 */
export function paceComparison(p, currentWeightKg, today) {
  const rapidAllowed = p.heightCm >= 120 && bmi(currentWeightKg, p.heightCm) >= RAPID_PACE_MIN_BMI;
  return PACES.map((pace) => {
    const t = dailyTargets({ ...p, weeklyLossKg: pace.kg }, currentWeightKg, today);
    return { kg: pace.kg, label: pace.label, kcal: t.kcal, weeklyLossKg: t.weeklyLossKg, floorApplied: t.floorApplied, goalDate: pace.kg > 0 ? goalDate(t, today) : null, allowed: pace.kg < 1 || rapidAllowed };
  });
}

/**
 * Reperes conseilles pour chaque repas (la trame par defaut), selon la methode.
 * Compter : grammes indicatifs pour l'objectif du repas. Sans compter : l'assiette
 * equilibree et des portions reperes (paume, poing).
 * @param {Program} p
 * @param {Record<ProgramSlot, { kcal: number, proteinG: number }>} perMeal
 * @returns {Record<ProgramSlot, string[]>}
 */
export function defaultTrame(p, perMeal) {
  const round10 = (/** @type {number} */ x) => Math.max(10, Math.round(x / 10) * 10);
  /** @param {number} kcal */
  const main = (kcal) => {
    if (p.method === 'balance') {
      return [
        'La moitié de l’assiette en légumes (crus ou cuits, à volonté).',
        p.highProtein ? 'Un quart bien rempli en protéines : viande, poisson, œufs ou tofu (la taille de votre main).' : 'Un quart en protéines : viande, poisson, œufs, tofu ou légumineuses (la taille de votre paume).',
        'Un quart en féculents : riz, pâtes, couac, patate douce, pain (la taille de votre poing).',
        'Une cuillère à soupe de matière grasse pour la cuisson ou l’assaisonnement.',
      ];
    }
    const k = kcal / 500;
    return [
      `Protéines : ${round10(120 * k * (p.highProtein ? 1.25 : 1))} g cuits (viande, poisson, œufs, tofu).`,
      `Féculents : ${round10(150 * k * (p.highProtein ? 0.8 : 1))} g cuits (riz, pâtes, patate douce, couac).`,
      'Légumes : au moins 200 g, à volonté.',
      'Matière grasse : 1 cuillère à soupe d’huile.',
    ];
  };
  /** @param {number} kcal */
  const breakfast = (kcal) =>
    p.method === 'balance'
      ? ['Une boisson (eau, thé, café sans sucre).', 'Pain complet ou flocons d’avoine (une poignée).', 'Un laitage : yaourt, skyr ou fromage blanc.', 'Un fruit.']
      : [
          `Pain complet ou flocons d’avoine : ${round10(60 * (kcal / 350))} g.`,
          p.highProtein ? 'Protéines : 1 skyr ou 2 œufs.' : 'Un laitage : yaourt, skyr ou fromage blanc.',
          'Un fruit.',
        ];
  /** @param {number} kcal */
  const snack = (kcal) =>
    p.method === 'balance'
      ? [p.highProtein ? 'Un skyr ou un fromage blanc, et un fruit.' : 'Un fruit, ou un laitage, ou une petite poignée d’amandes.']
      : [p.highProtein ? `Un skyr ou un fromage blanc et un fruit (environ ${kcal} kcal).` : `Un fruit et un laitage, ou une poignée d’amandes (environ ${kcal} kcal).`];
  return {
    breakfast: breakfast(perMeal.breakfast.kcal),
    morning_snack: snack(perMeal.morning_snack.kcal),
    lunch: main(perMeal.lunch.kcal),
    snack: snack(perMeal.snack.kcal),
    dinner: main(perMeal.dinner.kcal),
  };
}

/**
 * Trame du programme : celle de la cliente quand elle en a ecrit une, sinon les reperes.
 * @param {Program} p
 * @param {Record<ProgramSlot, { kcal: number, proteinG: number }>} perMeal
 * @returns {Record<ProgramSlot, { lines: string[], custom: boolean }>}
 */
export function programTrame(p, perMeal) {
  const defaults = defaultTrame(p, perMeal);
  /** @type {Record<ProgramSlot, { lines: string[], custom: boolean }>} */
  const out = /** @type {any} */ ({});
  for (const { id } of PROGRAM_SLOTS) {
    const own = (p.trame[id] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    out[id] = own.length ? { lines: own, custom: true } : { lines: defaults[id], custom: false };
  }
  return out;
}

/** Repere par defaut des jours de sport. */
export const DEFAULT_SPORT_NOTE = 'Avant la séance (1 à 2 h) : un fruit ou une tartine. Après : un laitage ou un repas avec des protéines. Buvez de l’eau pendant et après.';

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
  const part = (pct) => ({ kcal: Math.round((targets.kcal * (pct ?? 0)) / 100), proteinG: Math.round((targets.proteinG * (pct ?? 0)) / 100) });
  return { breakfast: part(split.breakfast), morning_snack: part(split.morning_snack), lunch: part(split.lunch), snack: part(split.snack), dinner: part(split.dinner) };
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
 * @param {{ memberId: string | null, mealSplit: Partial<Record<ProgramSlot, number>> }} program
 * @param {Partial<Record<ProgramSlot, { kcal: number }>>} targets
 * @param {(recipeId: string) => Nutrients | undefined} nutritionOf
 * @returns {{ kcal: number, meals: number }}
 */
export function plannedKcalForDay(entries, day, program, targets, nutritionOf) {
  let kcal = 0;
  let meals = 0;
  for (const slot of /** @type {ProgramSlot[]} */ (['breakfast', 'morning_snack', 'lunch', 'snack', 'dinner'])) {
    const entry = entries.get(`${day}|${slot}`);
    if (!entry) continue;
    const attendees = entry.kind === 'leftover' ? entry.meal.nextLunch?.attendees ?? [] : entry.meal.attendees;
    if (program.memberId && !attendees.includes(program.memberId)) continue;
    const n = nutritionOf(entry.meal.recipeId);
    if (!n) continue;
    kcal += (program.mealSplit[slot] ?? 0) > 0 && targets[slot] ? personalPortion(n, targets[slot].kcal).kcal : Math.round(n.kcal);
    meals++;
  }
  return { kcal, meals };
}
