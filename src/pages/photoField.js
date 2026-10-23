import { escapeHtml } from '../utils/html.js';
import { readProductPhoto } from '../services/photoService.js';

/** @typedef {import('../domain/drive/productPhoto.js').PhotoReading} PhotoReading */

/**
 * Bouton « Photographier » d'un formulaire de produit, avec apercu et messages.
 * @param {string} id
 * @returns {string}
 */
export function photoFieldHtml(id) {
  return `<div class="field photo-field" data-photo="${id}">
    <input id="${id}" type="file" accept="image/*" capture="environment" class="visually-hidden" />
    <label for="${id}" class="button button--secondary photo-field__button">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>
      Photographier le produit ou son étiquette
    </label>
    <p class="hint">Avec la clé IA, la photo remplit le formulaire : vérifiez chaque champ avant d’enregistrer. La photo est envoyée à Anthropic pour être lue, puis n’est pas conservée.</p>
    <div class="photo-field__result" hidden>
      <img class="photo-field__preview" alt="Photo du produit" />
      <div><p class="photo-field__status" role="status"></p><ul class="photo-field__warnings"></ul></div>
    </div>
  </div>`;
}

/**
 * Branche le champ photo : apercu, lecture par l'IA, puis remplissage par le formulaire.
 * @param {HTMLElement} root
 * @param {string} id
 * @param {(reading: PhotoReading) => void} fill
 */
export function mountPhotoField(root, id, fill) {
  const box = /** @type {HTMLElement} */ (root.querySelector(`[data-photo="${id}"]`));
  const input = /** @type {HTMLInputElement} */ (box.querySelector('input[type="file"]'));
  const result = /** @type {HTMLElement} */ (box.querySelector('.photo-field__result'));
  const preview = /** @type {HTMLImageElement} */ (box.querySelector('.photo-field__preview'));
  const status = /** @type {HTMLElement} */ (box.querySelector('.photo-field__status'));
  const warnings = /** @type {HTMLElement} */ (box.querySelector('.photo-field__warnings'));
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    result.hidden = false;
    warnings.innerHTML = '';
    status.textContent = 'Lecture de la photo…';
    const { reading, error } = await readProductPhoto(file);
    input.value = '';
    if (!reading) {
      status.textContent = error ?? '';
      return;
    }
    fill(reading);
    status.textContent = reading.warnings.length ? 'Formulaire pré-rempli. À vérifier :' : 'Formulaire pré-rempli : vérifiez puis enregistrez.';
    warnings.innerHTML = reading.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  });
}
