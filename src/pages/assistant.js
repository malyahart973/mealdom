import { toIsoDate, weekStart, parseIsoDate } from '../domain/planning/dates.js';
import { getHousehold } from '../services/householdService.js';
import { mountAssistant } from './assistantPanel.js';
import { ingredientsById } from '../services/catalog.js';
import { escapeHtml } from '../utils/html.js';

/**
 * Ecran Assistant en plein ecran.
 * Adresses : #/assistant, #/assistant/semaine/AAAA-MM-JJ, #/assistant/produit/<ingredient>
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderAssistant(el, params) {
  const today = toIsoDate(new Date());
  const monday = weekStart(params.date && parseIsoDate(params.date) ? params.date : today);
  const household = await getHousehold();
  if (household.members.length === 0) {
    el.innerHTML = `<section><h1 class="page-title">Assistant</h1>
      <p>Pour proposer des repas adaptés (allergies, régimes, portions), l’assistant doit connaître votre foyer.</p>
      <a class="button" href="#/foyer">Présenter mon foyer</a></section>`;
    return;
  }
  const focus = params.ingredientId && ingredientsById.has(params.ingredientId) ? params.ingredientId : null;
  el.innerHTML = `<section><h1 class="page-title">Assistant</h1>
    <p><a href="#/planning/semaine/${monday}">Voir le planning de la semaine</a></p>
    <div data-assistant></div></section>`;
  await mountAssistant(/** @type {HTMLElement} */ (el.querySelector('[data-assistant]')), {
    monday,
    focusIngredientId: focus,
    initialText: focus ? `Trouve une alternative moins chère à ce produit (${escapeHtml(ingredientsById.get(focus)?.name ?? '')})` : '',
  });
}
