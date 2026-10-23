/**
 * Photo d'un produit : reduction de l'image sur le telephone, puis lecture par l'IA
 * (uniquement si une cle API est enregistree). La photo n'est pas conservee.
 */
import { PHOTO_PROMPT, PHOTO_SCHEMA, readPhotoAnswer } from '../domain/drive/productPhoto.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { getSetting } from '../db/repositories/settingsRepository.js';
import { readImage, LlmError, DEFAULT_MODEL } from './llmService.js';
import { INGREDIENTS } from '../data/ingredients.js';

/** @typedef {import('../domain/drive/productPhoto.js').PhotoReading} PhotoReading */

const nameIndex = buildNameIndex(INGREDIENTS);

/** Plus grand cote de l'image envoyee : assez pour lire une etiquette, leger a envoyer. */
const MAX_SIDE = 1568;

/**
 * Reduit la photo et la convertit en JPEG (base64).
 * @param {File} file
 * @returns {Promise<{ base64: string, mediaType: string }>}
 */
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
}

/**
 * @returns {Promise<boolean>}
 */
export async function canReadPhotos() {
  const [key, useAi] = await Promise.all([getSetting('assistantApiKey'), getSetting('assistantUseAi')]);
  return typeof key === 'string' && key.length > 0 && useAi !== false;
}

/**
 * Lit la photo d'un produit ou d'une etiquette.
 * @param {File} file
 * @returns {Promise<{ reading: PhotoReading | null, error: string | null }>}
 */
export async function readProductPhoto(file) {
  const [key, model, useAi] = await Promise.all([getSetting('assistantApiKey'), getSetting('assistantModel'), getSetting('assistantUseAi')]);
  if (typeof key !== 'string' || !key || useAi === false) {
    return { reading: null, error: 'La lecture automatique des photos utilise l’IA : enregistrez votre clé dans Paramètres. En attendant, remplissez le formulaire en regardant la photo.' };
  }
  let image;
  try {
    image = await prepareImage(file);
  } catch {
    return { reading: null, error: 'Cette image ne peut pas être lue. Reprenez la photo.' };
  }
  try {
    const raw = await readImage({
      apiKey: key,
      model: typeof model === 'string' && model ? model : DEFAULT_MODEL,
      system: PHOTO_PROMPT,
      schema: PHOTO_SCHEMA,
      imageBase64: image.base64,
      mediaType: image.mediaType,
      instruction: 'Lis ce produit et son prix.',
    });
    return { reading: readPhotoAnswer(raw, (name) => findIngredientId(name, nameIndex)), error: null };
  } catch (error) {
    if (error instanceof LlmError) return { reading: null, error: error.message };
    throw error;
  }
}
