import { escapeHtml } from '../utils/html.js';
import { formatNumber } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { measurableUnitOptions, parseDecimal } from '../utils/units-select.js';
import { getUnit } from '../domain/units/units.js';
import { LOCATIONS, expiryStatus, itemsToUseFirst } from '../domain/shopping/shopping.js';
import { formatIsoDayMonth } from '../utils/format.js';
import { buildNameIndex, findIngredientId, suggestIngredients, normalizeText as normalizeName } from '../domain/ingredients/ingredients.js';
import { makeIngredientFinder } from '../domain/assistant/intent.js';
import { convertUnit } from '../domain/ingredients/conversion.js';
import { toIsoDate, weekStart } from '../domain/planning/dates.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { getInventory, saveInventoryItem, deleteInventoryItem, weekNeeds, newId } from '../services/shoppingService.js';

/** @typedef {import('../domain/shopping/shopping.js').InventoryItem} InventoryItem */

const nameIndex = buildNameIndex(INGREDIENTS);
const finder = makeIngredientFinder(nameIndex, ingredientsById);

/**
 * Ingredient des recettes pour un nom saisi : nom exact, ou ingredient cite dans un nom plus long
 * (« thon Petit Navire » -> thon en conserve). null si aucun.
 * @param {string} text
 * @returns {{ ingredientId: string, label?: string } | null}
 */
function recognize(text) {
  const exact = findIngredientId(text, nameIndex);
  if (exact) return { ingredientId: exact };
  const inside = finder.findIngredientInText(text);
  return inside ? { ingredientId: inside.id, label: text.trim() } : null;
}

/**
 * Ecran Stock : ce qu'il y a deja a la maison.
 * @param {HTMLElement} el
 */
export async function renderStock(el) {
  const today = toIsoDate(new Date());
  const [inventory, { needs }] = await Promise.all([getInventory(), weekNeeds(weekStart(today))]);
  /** @param {InventoryItem} item */
  const nameOf = (item) => item.label || ingredientsById.get(item.ingredientId)?.name || item.ingredientId;
  /**
   * Precision sous le nom : l'ingredient utilise par les recettes, ou « hors recettes ».
   * @param {InventoryItem} item
   */
  const usedAs = (item) => {
    const ingredient = ingredientsById.get(item.ingredientId);
    if (!ingredient) return '<span class="hint">hors recettes</span>';
    return item.label && normalizeName(item.label) !== normalizeName(ingredient.name) ? `<span class="hint">(${escapeHtml(ingredient.name)} pour les recettes)</span>` : '';
  };
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
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    if (items.length === 0) return '';
    return `<h2>${escapeHtml(loc.label)}</h2>
      <ul class="stock">${items
        .map(
          (i) => `<li>
            <span class="stock__name">${escapeHtml(nameOf(i))} ${usedAs(i)} ${expiryBadge(i)}</span>
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
                  (i) => `<li><span><strong>${escapeHtml(nameOf(i))}</strong> ${expiryBadge(i)}</span>
                    ${expiryStatus(i, today).status === 'expired' || !ingredientsById.has(i.ingredientId) ? '' : `<a class="button button--small button--secondary" href="#/recettes/avec/${encodeURIComponent(i.ingredientId)}">Recettes</a>`}</li>`,
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
          <input id="stock-ingredient" type="text" list="stock-names" autocomplete="off" placeholder="ex. riz blanc, café, thon Petit Navire" />
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
        <div class="stock-suggest" data-suggest hidden></div>
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
    if (errors.length) alertBox.scrollIntoView({ block: 'center' });
  };
  const suggestBox = /** @type {HTMLElement} */ (el.querySelector('[data-suggest]'));
  const nameInput = /** @type {HTMLInputElement} */ (el.querySelector('#stock-ingredient'));

  /**
   * Article du formulaire, pour un ingredient des recettes ou un produit libre (ingredientId vide).
   * @param {string} ingredientId
   * @param {string | undefined} label
   * @returns {InventoryItem}
   */
  const readItem = (ingredientId, label) => ({
    id: newId(),
    ingredientId,
    ...(label ? { label } : {}),
    quantity: parseDecimal(/** @type {HTMLInputElement} */ (el.querySelector('#stock-quantity')).value),
    unit: /** @type {HTMLSelectElement} */ (el.querySelector('#stock-unit')).value,
    location: /** @type {InventoryItem['location']} */ (/** @type {HTMLSelectElement} */ (el.querySelector('#stock-location')).value),
    expiresOn: /** @type {HTMLInputElement} */ (el.querySelector('#stock-expiry')).value || null,
  });

  /** @param {InventoryItem} item */
  const add = async (item) => {
    const errors = await saveInventoryItem(item);
    if (errors.length) return showErrors(errors);
    const what = nameOf(item);
    await renderStock(el);
    const status = el.querySelector('[data-status="stock"]');
    if (status) status.textContent = `${what} ajouté au stock.`;
    el.querySelector(`[data-qty="${CSS.escape(item.id)}"]`)?.closest('li')?.scrollIntoView({ block: 'center' });
  };

  el.querySelector('[data-form="stock"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showErrors([]);
    const text = nameInput.value.trim();
    if (!text) return showErrors(['Indiquez le nom du produit.']);
    const found = recognize(text);
    if (found) {
      suggestBox.hidden = true;
      return add(readItem(found.ingredientId, found.label));
    }
    // Produit inconnu des recettes : noms proches, ou l'ajouter tel quel.
    const close = suggestIngredients(text, INGREDIENTS, 4);
    suggestBox.hidden = false;
    suggestBox.innerHTML = `<p><strong>« ${escapeHtml(text)} »</strong> n’est pas un ingrédient des recettes.${close.length ? ' Vouliez-vous dire :' : ''}</p>
      ${close.length ? `<p class="chips">${close.map((i) => `<button type="button" class="chip" data-pick="${escapeHtml(i.id)}">${escapeHtml(i.name)}</button>`).join('')}</p>` : ''}
      <p><button type="button" class="button button--secondary" data-free>Ajouter « ${escapeHtml(text)} » tel quel</button></p>
      <p class="hint">Un produit ajouté tel quel est suivi dans le stock (emplacement, date limite) mais n’est pas utilisé par les recettes ni déduit des courses.</p>`;
    suggestBox.scrollIntoView({ block: 'center' });
  });

  suggestBox.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const pick = target.getAttribute('data-pick');
    const text = nameInput.value.trim();
    // Nom propose choisi : c'etait une faute de frappe, on garde le nom de l'ingredient.
    if (pick) add(readItem(pick, undefined));
    else if (target.hasAttribute('data-free')) add(readItem('', text));
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
