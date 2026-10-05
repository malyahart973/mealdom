import { escapeHtml } from '../utils/html.js';
import { STORE_TYPES } from '../domain/stores/stores.js';
import { getStores, getPrices, saveStore } from '../services/budgetService.js';
import { newId } from '../services/shoppingService.js';

const typeLabels = new Map(STORE_TYPES.map((t) => [t.id, t.label]));

/**
 * Options de type de magasin.
 * @param {string} selected
 * @returns {string}
 */
export function storeTypeOptions(selected) {
  return STORE_TYPES.map((t) => `<option value="${t.id}"${t.id === selected ? ' selected' : ''}>${escapeHtml(t.label)}</option>`).join('');
}

/**
 * Ecran Magasins : la liste et l'ajout.
 * @param {HTMLElement} el
 */
export async function renderStores(el) {
  const [stores, prices] = await Promise.all([getStores(), getPrices()]);
  stores.sort((a, b) => a.name.localeCompare(b.name));

  el.innerHTML = `
    <section>
      <h1 class="page-title">Magasins</h1>
      <p class="hint">Vos magasins habituels et les prix que vous y relevez. MealDom s’en sert pour estimer le coût des courses.</p>
      ${
        stores.length
          ? `<ul class="link-list">${stores
              .map((s) => {
                const count = prices.filter((p) => p.storeId === s.id).length;
                const meta = [typeLabels.get(s.type), s.commune, `${count} prix`].filter(Boolean).join(', ');
                return `<li><a href="#/magasins/${encodeURIComponent(s.id)}">${escapeHtml(s.name)}<span>${escapeHtml(meta)}</span></a></li>`;
              })
              .join('')}</ul>`
          : '<p class="empty">Aucun magasin pour l’instant.</p>'
      }
      <h2>Ajouter un magasin</h2>
      <div class="alert" role="alert" hidden></div>
      <form class="stock-form" data-form="store" novalidate>
        <div class="field">
          <label for="store-name">Nom</label>
          <input id="store-name" type="text" maxlength="40" autocomplete="off" placeholder="ex. Super U Matoury" />
        </div>
        <div class="field">
          <label for="store-type">Type</label>
          <select id="store-type">${storeTypeOptions('supermarket')}</select>
        </div>
        <div class="field">
          <label for="store-commune">Commune (facultatif)</label>
          <input id="store-commune" type="text" maxlength="40" autocomplete="off" />
        </div>
        <button type="submit" class="button">Ajouter le magasin</button>
      </form>
    </section>
  `;

  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  el.querySelector('[data-form="store"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = (/** @type {string} */ sel) => /** @type {HTMLInputElement} */ (el.querySelector(sel)).value;
    const id = newId();
    const errors = await saveStore({
      id,
      name: value('#store-name'),
      type: /** @type {import('../domain/stores/stores.js').StoreType} */ (value('#store-type')),
      commune: value('#store-commune'),
    });
    if (errors.length) {
      alertBox.hidden = false;
      alertBox.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
      return;
    }
    window.location.hash = `#/magasins/${encodeURIComponent(id)}`;
  });
}
