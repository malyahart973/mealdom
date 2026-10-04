import { escapeHtml } from '../utils/html.js';

/**
 * Ecran d'une section pas encore construite.
 * @param {HTMLElement} el
 * @param {{ title: string, text: string }} content
 */
export function renderPlaceholder(el, { title, text }) {
  el.innerHTML = `
    <section>
      <h1 class="page-title">${escapeHtml(title)}</h1>
      <p>${escapeHtml(text)}</p>
      <p class="hint">Disponible dans une prochaine version.</p>
    </section>
  `;
}
