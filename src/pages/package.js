import { escapeHtml } from '../utils/html.js';
import { formatNumber } from '../utils/format.js';
import { measurableUnitOptions, parseDecimal } from '../utils/units-select.js';
import { ingredientsById } from '../services/catalog.js';
import { getPackages, savePackage, deletePackage } from '../services/shoppingService.js';

/**
 * Ecran du conditionnement habituel d'un ingredient (ex. riz : sac de 1 kg).
 * @param {HTMLElement} el
 * @param {Record<string, string>} params   ingredientId, week
 */
export async function renderPackage(el, params) {
  const ingredient = ingredientsById.get(params.ingredientId ?? '');
  const back = `#/courses/semaine/${params.week}`;
  if (!ingredient) {
    el.innerHTML = `<p>Ingrédient inconnu.</p><p><a href="${back}">Retour aux courses</a></p>`;
    return;
  }
  const existing = (await getPackages()).find((p) => p.ingredientId === ingredient.id);

  el.innerHTML = `
    <section>
      <h1 class="page-title">${escapeHtml(ingredient.name)}</h1>
      <p>Comment l’achetez-vous d’habitude ? MealDom calculera le nombre de paquets nécessaires, arrondi au-dessus.</p>
      <div class="alert" role="alert" hidden></div>
      <form data-form="package" novalidate>
        <div class="field">
          <label for="pkg-label">Conditionnement</label>
          <input id="pkg-label" type="text" maxlength="30" autocomplete="off" placeholder="ex. sac, boîte, filet, barquette" value="${escapeHtml(existing?.label ?? '')}" />
        </div>
        <div class="field">
          <label for="pkg-quantity">Contenu d’un conditionnement</label>
          <div class="when">
            <input id="pkg-quantity" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 1" value="${existing ? escapeHtml(formatNumber(existing.quantity)) : ''}" />
            <select id="pkg-unit" aria-label="Unité">${measurableUnitOptions(existing?.unit ?? 'g')}</select>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="button">Enregistrer</button>
          ${existing ? '<button type="button" class="button button--danger" data-action="delete">Supprimer</button>' : ''}
        </div>
      </form>
    </section>
  `;

  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  el.querySelector('[data-form="package"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const label = /** @type {HTMLInputElement} */ (el.querySelector('#pkg-label')).value;
    const quantity = parseDecimal(/** @type {HTMLInputElement} */ (el.querySelector('#pkg-quantity')).value);
    const unit = /** @type {HTMLSelectElement} */ (el.querySelector('#pkg-unit')).value;
    const errors = await savePackage({ ingredientId: ingredient.id, label, quantity, unit });
    if (errors.length) {
      alertBox.hidden = false;
      alertBox.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
      return;
    }
    window.location.replace(back);
  });
  el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    await deletePackage(ingredient.id);
    window.location.replace(back);
  });
}
