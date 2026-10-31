/**
 * Programme du coach : enregistrement, lecture d'un document (IA) ou d'un texte colle (sans IA),
 * recettes des repas composes d'apres le programme, et apports d'une journee type.
 */
import { parseCoachText, readCoachAnswer, validateCoachPlan, coachRecipe, typicalDay, nextCheckIn, COACH_PROMPT, COACH_SCHEMA } from '../domain/nutrition/coach.js';
import { recipeNutrition, roundNutrients } from '../domain/nutrition/nutrition.js';
import { toIsoDate } from '../domain/planning/dates.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { readImage, readPdf, LlmError, DEFAULT_MODEL } from './llmService.js';
import { prepareImage } from './photoService.js';
import { registerPlannedRecipe, nutritionContext } from './catalog.js';
import { getMeals } from './planningService.js';

/** @typedef {import('../domain/nutrition/coach.js').CoachPlan} CoachPlan */

/** Taille maximale d'un PDF envoye a l'IA. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** @returns {Promise<CoachPlan | null>} */
export async function getCoachPlan() {
  const value = /** @type {CoachPlan | null} */ (await getSetting('coachPlan'));
  return value && typeof value === 'object' && Array.isArray(value.meals) ? value : null;
}

/**
 * @param {CoachPlan} plan
 * @returns {Promise<string[]>}
 */
export async function saveCoachPlan(plan) {
  const errors = validateCoachPlan(plan);
  if (errors.length === 0) {
    await setSetting('coachPlan', plan);
    await loadCoachRecipes();
  }
  return errors;
}

/** @returns {Promise<void>} */
export function deleteCoachPlan() {
  return setSetting('coachPlan', null);
}

/**
 * Programme colle en texte (sans IA, hors ligne).
 * @param {string} text
 * @returns {CoachPlan}
 */
export function planFromText(text) {
  return parseCoachText(text, toIsoDate(new Date()));
}

/**
 * Programme en PDF, photo ou capture d'ecran, lu par l'IA.
 * @param {File} file
 * @returns {Promise<{ plan: CoachPlan | null, error: string | null }>}
 */
export async function planFromFile(file) {
  const [key, model, useAi] = await Promise.all([getSetting('assistantApiKey'), getSetting('assistantModel'), getSetting('assistantUseAi')]);
  if (typeof key !== 'string' || !key || useAi === false) {
    return { plan: null, error: 'La lecture d’un PDF ou d’une photo utilise l’IA : enregistrez votre clé dans Paramètres. Sans IA, ouvrez le PDF, copiez tout le texte et collez-le ci-dessous.' };
  }
  const ai = { apiKey: key, model: typeof model === 'string' && model ? model : DEFAULT_MODEL, system: COACH_PROMPT, schema: COACH_SCHEMA, instruction: 'Recopie le programme alimentaire de ce document.' };
  try {
    let raw;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (file.size > MAX_PDF_BYTES) return { plan: null, error: 'Ce PDF est trop lourd (10 Mo au plus). Envoyez plutôt des captures d’écran des pages.' };
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      raw = await readPdf({ ...ai, pdfBase64: btoa(binary) });
    } else {
      let image;
      try {
        image = await prepareImage(file);
      } catch {
        return { plan: null, error: 'Ce fichier ne peut pas être lu. Choisissez un PDF, une photo ou une capture d’écran.' };
      }
      raw = await readImage({ ...ai, imageBase64: image.base64, mediaType: image.mediaType });
    }
    const plan = readCoachAnswer(raw, toIsoDate(new Date()));
    return plan ? { plan, error: null } : { plan: null, error: 'Aucun programme alimentaire lisible dans ce document. Essayez une photo plus nette ou collez le texte.' };
  } catch (error) {
    if (error instanceof LlmError) return { plan: null, error: `${error.message} Vous pouvez aussi coller le texte du programme.` };
    throw error;
  }
}

/**
 * Recettes des repas deja planifies d'apres le programme (au demarrage et apres un changement
 * de programme) : les repas, les courses et le batch cooking les retrouvent.
 * @returns {Promise<void>}
 */
export async function loadCoachRecipes() {
  const plan = await getCoachPlan();
  if (!plan) return;
  const ids = new Set((await getMeals()).map((m) => m.recipeId).filter((id) => id.startsWith('coach-')));
  for (const id of ids) {
    const recipe = coachRecipe(id, plan);
    if (recipe) registerPlannedRecipe(recipe);
  }
}

/**
 * Apports estimes d'une journee type (premieres possibilites du programme), jour de repos et jour de sport.
 * @param {CoachPlan} plan
 */
export function coachEstimates(plan) {
  /** @param {boolean} sport */
  const day = (sport) => {
    const total = typicalDay(plan, sport)
      .map((r) => recipeNutrition(r, nutritionContext).perPortion)
      .reduce((a, n) => ({ kcal: a.kcal + n.kcal, protein: a.protein + n.protein, carbs: a.carbs + n.carbs, fat: a.fat + n.fat, fiber: a.fiber + n.fiber }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
    return roundNutrients(total);
  };
  const hasSportMeal = plan.meals.some((m) => m.sportDaysOnly);
  return { rest: day(false), sport: hasSportMeal ? day(true) : null, nextCheckIn: nextCheckIn(plan, toIsoDate(new Date())) };
}
