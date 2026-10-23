import { escapeHtml } from '../utils/html.js';
import { formatNumber } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { measurableUnitOptions, parseDecimal } from '../utils/units-select.js';
import { getUnit } from '../domain/units/units.js';
import { LOCATIONS, expiryStatus, itemsToUseFirst } from '../domain/shopping/shopping.js';
import { formatIsoDayMonth } from '../utils/format.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { convertUnit } from '../domain/ingredients/conversion.js';
import { toIsoDate, weekStart } from '../domain/planning/dates.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { getInventory, saveInventoryItem, deleteInventoryItem, weekNeeds, newId } from '../services/shoppingService.js';

/** @typedef {import('../domain/shopping/shopping.js').InventoryItem} InventoryItem */

const nameIndex = buildNameIndex(INGREDIENTS);

/**
 * Ecran Stock : ce qu'il y a deja a la maison.
 * @param {HTMLElement} el
 */
export async function renderStock(el) {
  const today = toIsoDate(new Date());
  const [inventory, { needs }] = await Promise.all([getInventory(), weekNeeds(weekStart(today))]);
  /** @param {string} id */
  const nameOf = (id) => ingredientsById.get(id)?.name ?? id;
  /**
   * Badge de date limite.
   * @param {InventoryItem} item
   * @returns {string}
   */
  const expiryBadge = (item) => {
    const { status, days } = expiryStatus(item, today);
    if (!status || !item.expiresOn) return '';
    const text =
      status === 'expired'
        ? `Date dépassée depuis ${-(days ?? 0)} j`
        : status === 'today'
          ? 'À consommer aujourd’hui'
          : status === 'soon'
            ? `À consommer d’ici ${days} j`
            : `Jusqu’au ${formatIsoDayMonth(item.expiresOn)}`;
    return `<span class="expiry expiry--${status}">${escapeHtml(text)}</span>`;
  };
  const first = itemsToUseFirst(inventory, today);

  /**
   * Quantite prevue cette semaine pour cet article, dans son unite.
   * @param {InventoryItem} item
   * @returns {string}
   */
  const planned = (item) => {
    const ingredient = ingredientsById.get(item.ingredientId) ?? null;
    let total = 0;
    for (const need of needs.filter((n) => n.ingredientId === item.ingredientId && n.quantity !== null)) {
      const c = convertUnit(/** @type {number} */ (need.quantity), need.unit, item.unit, ingredient);
      if (c.ok) total += c.value;
    }
    if (total === 0) return '';
    const left = item.quantity - total;
    return left >= 0
      ? `Prévu cette semaine : ${formatQuantity(total, item.unit)}, il en restera ${formatQuantity(left, item.unit)}.`
      : `Prévu cette semaine : ${formatQuantity(total, item.unit)}, il en manquera (voir les courses).`;
  };

  const groups = LOCATIONS.map((loc) => {
    const items = inventory
      .filter((i) => i.location === loc.id)
      .sort((a, b) => (ingredientsById.get(a.ingredientId)?.name ?? '').localeCompare(ingredientsById.get(b.ingredientId)?.name ?? ''));
    if (items.length === 0) return '';
    return `<h2>${escapeHtml(loc.label)}</h2>
      <ul class="stock">${items
        .map(
          (i) => `<li>
            <span class="stock__name">${escapeHtml(ingredientsById.get(i.ingredientId)?.name ?? i.ingredientId)} ${expiryBadge(i)}</span>
            <span class="stock__qty">
              <input type="text" inputmode="decimal" data-qty="${escapeHtml(i.id)}" value="${escapeHtml(formatNumber(i.quantity))}" aria-label="Quantité" />
              <span>${escapeHtml(getUnit(i.unit)?.label ?? i.unit)}</span>
              <button type="button" class="icon-button" data-remove="${escapeHtml(i.id)}" aria-label="Retirer du stock">×</button>
            </span>
            ${planned(i) ? `<span class="hint stock__plan">${escapeHtml(planned(i))}</span>` : ''}
            <label class="stock__date">À consommer avant <input type="date" data-exp="${escapeHtml(i.id)}" value="${escapeHtml(i.expiresOn ?? '')}" /></label>
          </li>`,
        )
        .join('')}</ul>`;
  }).join('');

  el.innerHTML = `
    <section>
      <h1 class="page-title">Stock</h1>
      <p class="hint">Ce que vous avez déjà à la maison. MealDom le déduit de la liste de courses.</p>
      ${
        first.length
          ? `<section class="use-first" aria-labelledby="use-first-title">
              <h2 id="use-first-title">À consommer en priorité</h2>
              <ul class="local-list">${first
                .map(
                  (i) => `<li><span><strong>${escapeHtml(nameOf(i.ingredientId))}</strong> ${expiryBadge(i)}</span>
                    ${expiryStatus(i, today).status === 'expired' ? '' : `<a class="button button--small button--secondary" href="#/recettes/avec/${encodeURIComponent(i.ingredientId)}">Recettes</a>`}</li>`,
                )
                .join('')}</ul>
              <p class="hint">L’assistant privilégie ces produits dans ses propositions. Date dépassée : si c’est une date limite de consommation (« à consommer jusqu’au »), ne consommez pas le produit ; si c’est « à consommer de préférence avant », vérifiez son aspect et son odeur.</p>
            </section>`
          : ''
      }
      <div class="alert" role="alert" hidden></div>
      <form class="stock-form" data-form="stock" novalidate>
        <div class="field">
          <label for="stock-ingredient">Produit</label>
          <input id="stock-ingredient" type="text" list="stock-names" autocomplete="off" placeholder="ex. riz blanc" />
          <datalist id="stock-names">${INGREDIENTS.filter((i) => !i.notPurchased)
            .map((i) => `<option value="${escapeHtml(i.name)}"></option>`)
            .join('')}</datalist>
        </div>
        <div class="field when">
          <input id="stock-quantity" type="text" inputmode="decimal" autocomplete="off" placeholder="Quantité" aria-label="Quantité" />
          <select id="stock-unit" aria-label="Unité">${measurableUnitOptions('g')}</select>
        </div>
        <div class="field">
          <label for="stock-expiry">À consommer avant (facultatif)</label>
          <input id="stock-expiry" type="date" min="${today}" />
        </div>
        <div class="field">
          <select id="stock-location" aria-label="Emplacement">${LOCATIONS.map((l) => `<option value="${l.id}">${escapeHtml(l.label)}</option>`).join('')}</select>
        </div>
        <button type="submit" class="button">Ajouter au stock</button>
      </form>
      ${inventory.length ? groups : '<p class="empty">Votre stock est vide.</p>'}
      <p class="status" data-status="stock" aria-live="polite"></p>
    </section>
  `;

  const section = /** @type {HTMLElement} */ (el.querySelector('section'));
  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  /** @param {string[]} errors */
  const showErrors = (errors) => {
    alertBox.hidden = errors.length === 0;
    alertBox.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
  };

  el.querySelector('[data-form="stock"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = /** @type {HTMLInputElement} */ (el.querySelector('#stock-ingredient')).value;
    const ingredientId = findIngredientId(text, nameIndex) ?? '';
    /** @type {InventoryItem} */
    const item = {
      id: newId(),
      ingredientId,
      quantity: parseDecimal(/** @type {HTMLInputElement} */ (el.querySelector('#stock-quantity')).value),
      unit: /** @type {HTMLSelectElement} */ (el.querySelector('#stock-unit')).value,
      location: /** @type {InventoryItem['location']} */ (/** @type {HTMLSelectElement} */ (el.querySelector('#stock-location')).value),
      expiresOn: /** @type {HTMLInputElement} */ (el.querySelector('#stock-expiry')).value || null,
    };
    const errors = await saveInventoryItem(item);
    if (errors.length) return showErrors(errors);
    await renderStock(el);
  });

  section.addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const expId = input.getAttribute('data-exp');
    if (expId) {
      const item = inventory.find((i) => i.id === expId);
      if (!item) return;
      const errors = await saveInventoryItem({ ...item, expiresOn: input.value || null });
      if (errors.length) return showErrors(errors);
      await renderStock(el);
      return;
    }
    const id = input.getAttribute('data-qty');
    if (!id) return;
    const item = inventory.find((i) => i.id === id);
    if (!item) return;
    const errors = await saveInventoryItem({ ...item, quantity: parseDecimal(input.value) });
    if (errors.length) return showErrors(errors);
    await renderStock(el);
    const status = el.querySelector('[data-status="stock"]');
    if (status) status.textContent = 'Quantité enregistrée.';
  });

  section.addEventListener('click', async (event) => {
    const id = /** @type {HTMLElement} */ (event.target).getAttribute('data-remove');
    if (!id) return;
    await deleteInventoryItem(id);
    await renderStock(el);
  });
}
