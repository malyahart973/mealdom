import { escapeHtml } from '../utils/html.js';
import { formatIsoDate, formatNumber } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { measurableUnitOptions, parseDecimal } from '../utils/units-select.js';
import { AVAILABILITY } from '../domain/stores/stores.js';
import { formatCents, parseAmountToCents, centsToInput } from '../domain/budget/money.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { toIsoDate } from '../domain/planning/dates.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { getStores, getPrices, saveStore, deleteStore, savePrice, deletePrice } from '../services/budgetService.js';
import { storeTypeOptions } from './stores.js';
import { photoFieldHtml, mountPhotoField } from './photoField.js';

/** @typedef {import('../domain/stores/stores.js').Price} Price */
/** @typedef {import('../domain/stores/stores.js').Availability} Availability */

const nameIndex = buildNameIndex(INGREDIENTS);
const availabilityLabels = new Map(AVAILABILITY.map((a) => [a.id, a.label]));

/**
 * Ecran d'un magasin : ses informations et ses prix.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderStore(el, params) {
  const [stores, allPrices] = await Promise.all([getStores(), getPrices()]);
  const store = stores.find((s) => s.id === params.id);
  if (!store) {
    el.innerHTML = '<p>Ce magasin a été supprimé.</p><p><a href="#/magasins">Voir les magasins</a></p>';
    return;
  }
  const prices = allPrices
    .filter((p) => p.storeId === store.id)
    .sort((a, b) => (ingredientsById.get(a.ingredientId)?.name ?? '').localeCompare(ingredientsById.get(b.ingredientId)?.name ?? ''));
  /** @type {Price | null} */
  let editing = null;
  const today = toIsoDate(new Date());

  el.innerHTML = `
    <section>
      <h1 class="page-title">${escapeHtml(store.name)}</h1>
      <div class="alert" role="alert" hidden></div>

      <h2>Prix relevés</h2>
      ${
        prices.length
          ? `<ul class="shop">${prices
              .map(
                (p) => `<li>
            <span class="shop__item"><span><strong>${escapeHtml(ingredientsById.get(p.ingredientId)?.name ?? p.ingredientId)}</strong>
              ${p.label ? `<span class="hint">${escapeHtml(p.label)}</span>` : ''}
              <span class="shop__qty">${escapeHtml(formatCents(p.priceCents))} ${p.soldLoose ? 'pour' : 'le paquet de'} ${escapeHtml(formatQuantity(p.packageQuantity, p.packageUnit))}${p.soldLoose ? ', au détail' : ''}</span>
              <span class="hint">${escapeHtml(availabilityLabels.get(p.availability) ?? '')}, relevé le ${escapeHtml(formatIsoDate(`${p.date}T12:00:00`) ?? p.date)}</span></span></span>
            <span class="row-actions">
              <a class="button button--small button--secondary" href="#/prix/${encodeURIComponent(p.ingredientId)}">Historique</a>
              <button type="button" class="button button--small button--secondary" data-edit="${escapeHtml(p.id)}">Modifier</button>
              <button type="button" class="icon-button" data-remove="${escapeHtml(p.id)}" aria-label="Supprimer ce prix">×</button>
            </span>
          </li>`,
              )
              .join('')}</ul>`
          : '<p class="empty">Aucun prix pour l’instant.</p>'
      }

      <h2 data-heading="price">Ajouter un prix</h2>
      <form class="stock-form" data-form="price" novalidate>
        ${photoFieldHtml('price-photo')}
        <div class="field">
          <label for="price-ingredient">Produit</label>
          <input id="price-ingredient" type="text" list="price-names" autocomplete="off" placeholder="ex. riz blanc" />
          <datalist id="price-names">${INGREDIENTS.filter((i) => !i.notPurchased)
            .map((i) => `<option value="${escapeHtml(i.name)}"></option>`)
            .join('')}</datalist>
        </div>
        <div class="field">
          <label for="price-label">Marque ou précision (facultatif)</label>
          <input id="price-label" type="text" maxlength="40" autocomplete="off" placeholder="ex. basmati, marque distributeur" />
        </div>
        <div class="field">
          <label for="price-quantity">Contenu du produit vendu</label>
          <div class="when">
            <input id="price-quantity" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 1" />
            <select id="price-unit" aria-label="Unité">${measurableUnitOptions('kg')}</select>
          </div>
        </div>
        <label class="check"><input type="checkbox" id="price-loose" />
          <span>Vendu au poids ou à l’unité (prix au kilo, au litre ou à la pièce)</span></label>
        <div class="field when">
          <div>
            <label for="price-amount">Prix (€)</label>
            <input id="price-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 3,20" />
          </div>
          <div>
            <label for="price-date">Relevé le</label>
            <input id="price-date" type="date" value="${today}" />
          </div>
        </div>
        <div class="field">
          <label for="price-availability">Disponibilité</label>
          <select id="price-availability">${AVAILABILITY.map((a) => `<option value="${a.id}">${escapeHtml(a.label)}</option>`).join('')}</select>
          <p class="hint">Un produit dont la disponibilité est inconnue n’est jamais compté comme disponible.</p>
        </div>
        <button type="submit" class="button" data-submit="price">Enregistrer le prix</button>
      </form>

      <h2>Informations</h2>
      <form class="stock-form" data-form="store" novalidate>
        <div class="field">
          <label for="store-name">Nom</label>
          <input id="store-name" type="text" maxlength="40" autocomplete="off" value="${escapeHtml(store.name)}" />
        </div>
        <div class="field">
          <label for="store-type">Type</label>
          <select id="store-type">${storeTypeOptions(store.type)}</select>
        </div>
        <div class="field">
          <label for="store-commune">Commune</label>
          <input id="store-commune" type="text" maxlength="40" autocomplete="off" value="${escapeHtml(store.commune)}" />
        </div>
        <div class="form-actions">
          <button type="submit" class="button">Enregistrer</button>
          <button type="button" class="button button--danger" data-action="delete-store">Supprimer le magasin</button>
        </div>
      </form>
      <p class="status" aria-live="polite"></p>
    </section>
  `;

  const section = /** @type {HTMLElement} */ (el.querySelector('section'));
  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  const status = /** @type {HTMLElement} */ (el.querySelector('.status'));
  /** @param {string} sel */
  const input = (sel) => /** @type {HTMLInputElement} */ (el.querySelector(sel));
  /** @param {string[]} errors */
  const showErrors = (errors) => {
    alertBox.hidden = errors.length === 0;
    alertBox.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
    if (errors.length) alertBox.scrollIntoView({ block: 'center' });
  };

  mountPhotoField(el, 'price-photo', (r) => {
    /** @param {string} sel @param {string} value */
    const set = (sel, value) => {
      if (value) input(sel).value = value;
    };
    set('#price-ingredient', r.ingredientId ? ingredientsById.get(r.ingredientId)?.name ?? '' : '');
    set('#price-label', [r.brand, r.name].filter(Boolean).join(' ').slice(0, 40));
    set('#price-quantity', r.packageQuantity === null ? '' : String(r.packageQuantity).replace('.', ','));
    set('#price-unit', r.packageUnit ?? '');
    set('#price-amount', r.priceCents === null ? '' : centsToInput(r.priceCents));
    set('#price-date', today);
    set('#price-availability', 'available');
  });

  section.addEventListener('click', async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const removeId = target.getAttribute('data-remove');
    const editId = target.getAttribute('data-edit');
    if (removeId) {
      await deletePrice(removeId);
      await renderStore(el, params);
    } else if (editId) {
      editing = prices.find((p) => p.id === editId) ?? null;
      if (!editing) return;
      input('#price-ingredient').value = ingredientsById.get(editing.ingredientId)?.name ?? '';
      input('#price-label').value = editing.label;
      input('#price-quantity').value = formatNumber(editing.packageQuantity);
      input('#price-unit').value = editing.packageUnit;
      input('#price-amount').value = centsToInput(editing.priceCents);
      input('#price-date').value = today;
      input('#price-availability').value = editing.availability;
      input('#price-loose').checked = editing.soldLoose;
      const heading = el.querySelector('[data-heading="price"]');
      if (heading) heading.textContent = 'Modifier le prix';
      heading?.scrollIntoView({ block: 'start' });
    }
  });

  el.querySelector('[data-form="price"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errors = await savePrice({
      id: '',
      storeId: store.id,
      ingredientId: findIngredientId(input('#price-ingredient').value, nameIndex) ?? '',
      label: input('#price-label').value,
      packageQuantity: parseDecimal(input('#price-quantity').value),
      packageUnit: input('#price-unit').value,
      priceCents: parseAmountToCents(input('#price-amount').value),
      date: input('#price-date').value || today,
      availability: /** @type {Availability} */ (input('#price-availability').value),
      soldLoose: input('#price-loose').checked,
    });
    if (errors.length) return showErrors(errors);
    await renderStore(el, params);
  });

  el.querySelector('[data-form="store"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errors = await saveStore({
      ...store,
      name: input('#store-name').value,
      type: /** @type {import('../domain/stores/stores.js').StoreType} */ (input('#store-type').value),
      commune: input('#store-commune').value,
    });
    if (errors.length) return showErrors(errors);
    showErrors([]);
    status.textContent = 'Magasin enregistré.';
  });

  el.querySelector('[data-action="delete-store"]')?.addEventListener('click', async () => {
    if (!window.confirm(`Supprimer ${store.name} et ses ${prices.length} prix ?`)) return;
    await deleteStore(store.id);
    window.location.replace('#/magasins');
  });
}
