/**
 * Recettes personnelles : enregistrement, archivage et import (texte colle, lien, photo).
 * Les recettes importees sont toujours verifiees par la cliente avant d'etre enregistrees.
 */
import { validateRecipe } from '../domain/recipes/recipes.js';
import { EQUIPMENT } from '../domain/recipes/equipment.js';
import { parseRecipeText, matchIngredients, readRecipeAnswer, RECIPE_PROMPT, RECIPE_SCHEMA } from '../domain/recipes/recipeImport.js';
import { makeIngredientFinder } from '../domain/assistant/intent.js';
import { buildNameIndex } from '../domain/ingredients/ingredients.js';
import { userRecipeStore, getUserRecipes } from '../db/repositories/recipeRepository.js';
import { getSetting } from '../db/repositories/settingsRepository.js';
import { readImage, readRecipeFromUrl, LlmError, DEFAULT_MODEL } from './llmService.js';
import { prepareImage } from './photoService.js';
import { registerRecipe, recipesById, ingredientsById, preparationsById } from './catalog.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { CUISINES } from '../data/cuisines.js';

/** @typedef {import('../domain/recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../domain/recipes/recipeImport.js').RecipeDraft} RecipeDraft */

const finder = makeIngredientFinder(buildNameIndex(INGREDIENTS), ingredientsById);
const refs = { ingredients: ingredientsById, preparations: preparationsById, cuisines: new Set(CUISINES.map((c) => c.id)), equipment: new Set(EQUIPMENT.map((e) => e.id)) };

/**
 * Ingredient du catalogue correspondant a un nom ecrit (null : a choisir).
 * @param {string} name
 * @returns {string | null}
 */
export function findIngredient(name) {
  return finder.findIngredient(name)?.id ?? null;
}

/**
 * Charge les recettes personnelles dans le catalogue (au demarrage).
 * @returns {Promise<void>}
 */
export async function loadUserRecipes() {
  for (const recipe of await getUserRecipes()) registerRecipe(recipe);
}

/** @returns {Promise<Recipe[]>} */
export async function listUserRecipes() {
  return (await getUserRecipes()).filter((r) => r.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {Recipe} recipe
 * @returns {Promise<{ ok: true } | { ok: false, errors: string[] }>}
 */
export async function saveUserRecipe(recipe) {
  const errors = validateRecipe(recipe, refs);
  const sameName = [...recipesById.values()].find((r) => r.id !== recipe.id && r.status !== 'archived' && r.name.trim().toLowerCase() === recipe.name.trim().toLowerCase());
  if (sameName) errors.push(`Une recette s’appelle déjà « ${sameName.name} » : choisissez un autre nom.`);
  if (errors.length) return { ok: false, errors };
  await userRecipeStore.put(recipe);
  registerRecipe(recipe);
  return { ok: true };
}

/**
 * Supprime une recette personnelle : elle est archivee pour que les repas deja
 * planifies gardent leurs ingredients, mais n'est plus proposee.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function archiveUserRecipe(id) {
  const recipe = /** @type {Recipe | undefined} */ (await userRecipeStore.get(id));
  if (!recipe) return;
  const archived = { ...recipe, status: /** @type {const} */ ('archived') };
  await userRecipeStore.put(archived);
  registerRecipe(archived);
}

/**
 * Recette collee en texte (sans IA, fonctionne hors ligne).
 * @param {string} text
 * @returns {RecipeDraft}
 */
export function draftFromText(text) {
  const draft = parseRecipeText(text);
  return { ...draft, ingredients: matchIngredients(draft.ingredients, findIngredient) };
}

/** @returns {Promise<{ key: string, model: string } | null>} */
async function aiSettings() {
  const [key, model, useAi] = await Promise.all([getSetting('assistantApiKey'), getSetting('assistantModel'), getSetting('assistantUseAi')]);
  if (typeof key !== 'string' || !key || useAi === false) return null;
  return { key, model: typeof model === 'string' && model ? model : DEFAULT_MODEL };
}

/** @returns {Promise<boolean>} */
export async function canImportWithAi() {
  return (await aiSettings()) !== null;
}

/**
 * @param {unknown} raw
 * @returns {{ draft: RecipeDraft | null, error: string | null }}
 */
function toDraft(raw) {
  const draft = readRecipeAnswer(raw);
  if (!draft) return { draft: null, error: 'Aucune recette lisible n’a été trouvée. Essayez de coller le texte de la recette.' };
  return { draft: { ...draft, ingredients: matchIngredients(draft.ingredients, findIngredient) }, error: null };
}

/**
 * Recette d'un site web, lue par l'IA.
 * @param {string} url
 * @returns {Promise<{ draft: RecipeDraft | null, error: string | null }>}
 */
export async function draftFromUrl(url) {
  const ai = await aiSettings();
  if (!ai) return { draft: null, error: 'L’import par lien utilise l’IA : enregistrez votre clé dans Paramètres. Sans IA, copiez le texte de la recette et collez-le.' };
  try {
    const result = toDraft(await readRecipeFromUrl({ apiKey: ai.key, model: ai.model, system: RECIPE_PROMPT, schema: RECIPE_SCHEMA, url }));
    return result.draft ? { draft: { ...result.draft, sourceUrl: url }, error: null } : result;
  } catch (error) {
    if (error instanceof LlmError) return { draft: null, error: `${error.message} Vous pouvez aussi coller le texte de la recette.` };
    throw error;
  }
}

/**
 * Recette en photo (livre, fiche, capture d'ecran d'une application), lue par l'IA.
 * @param {File} file
 * @returns {Promise<{ draft: RecipeDraft | null, error: string | null }>}
 */
export async function draftFromPhoto(file) {
  const ai = await aiSettings();
  if (!ai) return { draft: null, error: 'La lecture des photos utilise l’IA : enregistrez votre clé dans Paramètres. Sans IA, saisissez la recette ou collez son texte.' };
  let image;
  try {
    image = await prepareImage(file);
  } catch {
    return { draft: null, error: 'Cette image ne peut pas être lue. Reprenez la photo.' };
  }
  try {
    return toDraft(
      await readImage({ apiKey: ai.key, model: ai.model, system: RECIPE_PROMPT, schema: RECIPE_SCHEMA, imageBase64: image.base64, mediaType: image.mediaType, instruction: 'Recopie la recette de cette image.' }),
    );
  } catch (error) {
    if (error instanceof LlmError) return { draft: null, error: error.message };
    throw error;
  }
}
