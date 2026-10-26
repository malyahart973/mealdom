import { toIsoDate, weekStart, parseIsoDate } from '../domain/planning/dates.js';
import { getHousehold } from '../services/householdService.js';
import { mountAssistant } from './assistantPanel.js';
import { fitBudget } from '../services/assistantService.js';
import { ingredientsById } from '../services/catalog.js';

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
    ${
      focus
        ? ''
        : `<div class="assist-actions">
            <a class="assist-card assist-card--main" href="#/assistant/planifier/${monday}">
              <strong>Planifier ma semaine</strong><span>Trois questions, puis vous voyez la semaine et vous validez.</span>
            </a>
            <button type="button" class="assist-card" data-fit>
              <strong>Ajuster au budget</strong><span>Produits moins chers d’abord, puis des plats plus économiques.</span>
            </button>
            <a class="assist-card" href="#/planning/semaine/${monday}">
              <strong>Changer un repas</strong><span>Dans le planning, touchez le repas pour choisir une autre recette.</span>
            </a>
          </div>
          <h2>Demande libre</h2>
          <p class="hint">Écrivez ou dictez ce que vous voulez, par exemple « remplace le poisson de mardi par du poulet ».</p>`
    }
    <div data-assistant></div></section>`;
  const dock = /** @type {HTMLElement} */ (el.querySelector('[data-assistant]'));
  const mount = (/** @type {string} */ initialText) => mountAssistant(dock, { monday, focusIngredientId: focus, initialText });
  await mount(focus ? `Trouve une alternative moins chère à ce produit (${ingredientsById.get(focus)?.name ?? ''})` : '');
  el.querySelector('[data-fit]')?.addEventListener('click', async (event) => {
    const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
    button.disabled = true;
    await fitBudget(monday);
    await mount('');
    button.disabled = false;
    dock.querySelector('.proposal:last-of-type, .chat__msg:last-child')?.scrollIntoView({ block: 'start' });
  });
}
