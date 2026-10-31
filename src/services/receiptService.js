/**
 * Ticket de caisse : lecture de la photo par l'IA, puis enregistrement des prix et de la depense
 * apres verification par la personne.
 */
import { readReceiptAnswer, RECEIPT_PROMPT, RECEIPT_SCHEMA } from '../domain/stores/receipt.js';
import { getSetting } from '../db/repositories/settingsRepository.js';
import { readImage, LlmError, DEFAULT_MODEL } from './llmService.js';
import { prepareImage } from './photoService.js';

/** @typedef {import('../domain/stores/receipt.js').Receipt} Receipt */

/**
 * @param {File} file
 * @returns {Promise<{ receipt: Receipt | null, error: string | null }>}
 */
export async function readReceipt(file) {
  const [key, model, useAi] = await Promise.all([getSetting('assistantApiKey'), getSetting('assistantModel'), getSetting('assistantUseAi')]);
  if (typeof key !== 'string' || !key || useAi === false) {
    return { receipt: null, error: 'La lecture du ticket utilise l’IA : enregistrez votre clé dans Paramètres. Sans IA, ajoutez les prix un par un.' };
  }
  let image;
  try {
    image = await prepareImage(file);
  } catch {
    return { receipt: null, error: 'Cette image ne peut pas être lue. Reprenez la photo.' };
  }
  try {
    const raw = await readImage({
      apiKey: key,
      model: typeof model === 'string' && model ? model : DEFAULT_MODEL,
      system: RECEIPT_PROMPT,
      schema: RECEIPT_SCHEMA,
      imageBase64: image.base64,
      mediaType: image.mediaType,
      instruction: 'Lis ce ticket de caisse.',
    });
    const receipt = readReceiptAnswer(raw);
    return receipt ? { receipt, error: null } : { receipt: null, error: 'Ticket illisible : reprenez la photo bien à plat, tout le ticket dans l’image, avec une bonne lumière.' };
  } catch (error) {
    if (error instanceof LlmError) return { receipt: null, error: error.message };
    throw error;
  }
}
