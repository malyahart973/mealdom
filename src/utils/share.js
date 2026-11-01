/**
 * Partage un texte avec le menu de partage du telephone (WhatsApp, SMS, mail...) ou, a defaut,
 * le copie dans le presse-papiers.
 * - 'shared' : partage (ou annule par la personne) ;
 * - 'copied' : texte copie, a coller ;
 * - 'failed' : ni partage ni copie possibles.
 * @param {string} title
 * @param {string} text
 * @returns {Promise<'shared' | 'copied' | 'failed'>}
 */
export async function shareText(title, text) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'shared' : 'failed';
  }
}
