import { toIsoDate, weekStart } from '../domain/planning/dates.js';
import { escapeHtml } from '../utils/html.js';
import { mountAssistant } from './assistantPanel.js';
import { ingredientsById } from '../services/catalog.js';

/**
 * Alternative moins chere a un produit de la liste de courses, avec l'assistant.
 * (Les autres demandes se font dans « Planifier ma semaine », rubrique « Ou demandez-le simplement ».)
 * Adresse : #/assistant/produit/<ingredient>
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderAssistant(el, params) {
  const monday = weekStart(toIsoDate(new Date()));
  const ingredient = ingredientsById.get(params.ingredientId ?? '');
  if (!ingredient) {
    window.location.replace('#/assistant');
    return;
  }
  el.innerHTML = `<section><h1 class="page-title">Moins cher que : ${escapeHtml(ingredient.name)}</h1><div data-assistant></div></section>`;
  await mountAssistant(/** @type {HTMLElement} */ (el.querySelector('[data-assistant]')), {
    monday,
    focusIngredientId: ingredient.id,
    initialText: `Trouve une alternative moins chère à ce produit (${ingredient.name})`,
  });
}
