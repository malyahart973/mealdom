import { escapeHtml } from '../utils/html.js';
import { parseDecimal } from '../utils/units-select.js';
import { formatCents, parseAmountToCents, centsToInput } from '../domain/budget/money.js';
import { toIsoDate } from '../domain/planning/dates.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { makeIngredientFinder } from '../domain/assistant/intent.js';
import { receiptPrice, matchStore } from '../domain/stores/receipt.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { getStores, saveStore, savePrice, saveExpense } from '../services/budgetService.js';
import { newId } from '../services/shoppingService.js';
import { readReceipt } from '../services/receiptService.js';

/** @typedef {import('../domain/stores/receipt.js').Receipt} Receipt */

const nameIndex = buildNameIndex(INGREDIENTS);
const finder = makeIngredientFinder(nameIndex, ingredientsById);

/**
 * Ingredient d'un article du ticket (nom en clair, puis libelle imprime). '' si inconnu.
 * @param {string} text
 * @returns {string}
 */
function ingredientFor(text) {
  return findIngredientId(text, nameIndex) ?? finder.findIngredientInText(text)?.id ?? '';
}

const UNIT_LABELS = { g: 'g', kg: 'kg', ml: 'ml', cl: 'cl', l: 'L', piece: 'pièce(s)' };

/**
 * Ecran « Ticket de caisse » : photo, lecture par l'IA, verification, enregistrement des prix et de la depense.
 * Adresse : #/prix/ticket
 * @param {HTMLElement} el
 */
export async function renderReceipt(el) {
  el.innerHTML = `
    <section class="receipt">
      <h1 class="page-title">Ticket de caisse</h1>
      <p>Photographiez votre ticket : MealDom lit les articles et leurs prix, vous vérifiez, puis les prix et la dépense sont enregistrés en une fois.</p>
      <input id="receipt-photo" type="file" accept="image/*" capture="environment" class="visually-hidden" />
      <p><label for="receipt-photo" class="button">Photographier le ticket</label></p>
      <p class="hint">Ticket bien à plat, en entier, avec une bonne lumière. La photo est envoyée à l’IA Claude (votre clé, dans Paramètres) seulement pour être lue.</p>
      <p class="status" data-status aria-live="polite"></p>
      <p class="alert" role="alert" hidden></p>
      <div data-review></div>
    </section>`;
  const status = /** @type {HTMLElement} */ (el.querySelector('[data-status]'));
  const alert = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  el.querySelector('#receipt-photo')?.addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const file = input.files?.[0];
    if (!file) return;
    alert.hidden = true;
    status.textContent = 'Lecture du ticket… (jusqu’à une minute)';
    const { receipt, error } = await readReceipt(file);
    status.textContent = '';
    input.value = '';
    if (!receipt) {
      alert.textContent = error ?? 'Lecture impossible.';
      alert.hidden = false;
      return;
    }
    await renderReview(/** @type {HTMLElement} */ (el.querySelector('[data-review]')), receipt);
  });
}

/**
 * Verification des articles lus.
 * @param {HTMLElement} box
 * @param {Receipt} receipt
 */
async function renderReview(box, receipt) {
  const stores = (await getStores()).sort((a, b) => a.name.localeCompare(b.name));
  const storeId = matchStore(receipt.storeName, stores);
  const today = toIsoDate(new Date());
  const lines = receipt.lines.map((l) => ({ line: l, ingredientId: ingredientFor(l.name) || ingredientFor(l.label), price: receiptPrice(l) }));
  const matched = lines.filter((l) => l.ingredientId && l.price).length;

  box.innerHTML = `
    <h2>Vérifier</h2>
    <form class="stock-form" novalidate>
      <div class="field"><label for="r-store">Magasin</label>
        <select id="r-store">
          ${stores.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === storeId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          <option value="__new"${storeId || !receipt.storeName ? '' : ' selected'}>${receipt.storeName ? `Nouveau magasin : ${escapeHtml(receipt.storeName)}` : 'Nouveau magasin'}</option>
        </select></div>
      <div class="field" data-new-store${storeId || !receipt.storeName ? ' hidden' : ''}><label for="r-store-name">Nom du nouveau magasin</label><input id="r-store-name" type="text" value="${escapeHtml(receipt.storeName)}" maxlength="60" /></div>
      <div class="field"><label for="r-date">Date</label><input id="r-date" type="date" value="${escapeHtml(receipt.date ?? today)}" max="${today}" /></div>
      <p>${lines.length} article(s) lu(s), ${matched} reconnu(s). Décochez ce qui est faux, corrigez le produit ou le contenu si besoin.</p>
      <ul class="receipt__lines">${lines
        .map(
          (l, i) => `<li class="receipt__line" data-line="${i}">
            <label class="check"><input type="checkbox" data-keep${l.ingredientId && l.price ? ' checked' : ''} /> <span><strong>${escapeHtml(l.line.name)}</strong> <span class="hint">${escapeHtml(l.line.label)}</span></span></label>
            <div class="field when">
              <input type="text" list="r-names" data-product value="${escapeHtml(ingredientsById.get(l.ingredientId)?.name ?? '')}" placeholder="Produit de la liste" aria-label="Produit" />
              <span class="receipt__price">${escapeHtml(formatCents(l.line.priceCents))}${l.line.count > 1 ? ` (${l.line.count} ×)` : ''}</span>
            </div>
            <div class="field when">
              <input type="text" inputmode="decimal" data-qty value="${l.line.packageQuantity !== null ? escapeHtml(String(l.line.packageQuantity).replace('.', ',')) : ''}" placeholder="${l.line.soldLoose ? 'Poids acheté' : 'Contenu'}" aria-label="${l.line.soldLoose ? 'Poids acheté' : 'Contenu d’un article'}" />
              <select data-unit aria-label="Unité">${Object.entries(UNIT_LABELS).map(([u, label]) => `<option value="${u}"${l.line.packageUnit === u ? ' selected' : ''}>${label}</option>`).join('')}</select>
            </div>
            <p class="hint">${l.price ? (l.price.soldLoose ? `Vendu au poids : ${escapeHtml(formatCents(l.price.priceCents))} le kilo.` : `${escapeHtml(formatCents(l.price.priceCents))} l’article.`) : 'Contenu inconnu : indiquez-le pour enregistrer le prix.'}</p>
          </li>`,
        )
        .join('')}</ul>
      <datalist id="r-names">${INGREDIENTS.filter((i) => !i.notPurchased).map((i) => `<option value="${escapeHtml(i.name)}"></option>`).join('')}</datalist>
      <label class="check"><input type="checkbox" id="r-expense"${receipt.totalCents ? ' checked' : ''} /> <span>Ajouter la dépense au budget :</span></label>
      <div class="field"><label for="r-total" class="visually-hidden">Total payé (€)</label><input id="r-total" type="text" inputmode="decimal" value="${receipt.totalCents ? escapeHtml(centsToInput(receipt.totalCents)) : ''}" placeholder="Total payé (€)" /></div>
      <p class="alert" role="alert" data-save-alert hidden></p>
      <div class="form-actions"><button type="submit" class="button">Enregistrer</button></div>
      <p class="status" data-saved role="status"></p>
    </form>`;

  const storeSelect = /** @type {HTMLSelectElement} */ (box.querySelector('#r-store'));
  storeSelect.addEventListener('change', () => {
    /** @type {HTMLElement} */ (box.querySelector('[data-new-store]')).hidden = storeSelect.value !== '__new';
  });
  box.querySelector('form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errors = [];
    const date = /** @type {HTMLInputElement} */ (box.querySelector('#r-date')).value;
    let store = stores.find((s) => s.id === storeSelect.value) ?? null;
    if (!store) {
      const name = /** @type {HTMLInputElement} */ (box.querySelector('#r-store-name')).value.trim();
      const created = { id: newId(), name, type: /** @type {const} */ ('supermarket'), commune: '' };
      const storeErrors = await saveStore(created);
      if (storeErrors.length) errors.push(...storeErrors);
      else store = created;
    }
    let saved = 0;
    if (store) {
      for (const li of box.querySelectorAll('[data-line]')) {
        if (!(/** @type {HTMLInputElement} */ (li.querySelector('[data-keep]')).checked)) continue;
        const l = lines[Number(li.getAttribute('data-line'))];
        const product = /** @type {HTMLInputElement} */ (li.querySelector('[data-product]')).value;
        const ingredientId = findIngredientId(product, nameIndex) ?? '';
        const qty = parseDecimal(/** @type {HTMLInputElement} */ (li.querySelector('[data-qty]')).value);
        const unit = /** @type {HTMLSelectElement} */ (li.querySelector('[data-unit]')).value;
        const price = receiptPrice({ ...l.line, packageQuantity: Number.isFinite(qty) && qty > 0 ? qty : null, packageUnit: unit });
        if (!ingredientId || !price) {
          errors.push(`${l.line.name} : ${ingredientId ? 'indiquez le contenu' : 'choisissez un produit de la liste'} (ou décochez-le).`);
          continue;
        }
        const priceErrors = await savePrice({ id: '', storeId: store.id, ingredientId, label: l.line.label, ...price, date, availability: 'available' });
        if (priceErrors.length) errors.push(`${l.line.name} : ${priceErrors.join(' ')}`);
        else saved += 1;
      }
    }
    let expense = false;
    if (/** @type {HTMLInputElement} */ (box.querySelector('#r-expense')).checked) {
      const cents = parseAmountToCents(/** @type {HTMLInputElement} */ (box.querySelector('#r-total')).value);
      const expenseErrors = await saveExpense({ id: newId(), date, storeId: store?.id ?? null, storeName: store?.name ?? receipt.storeName, amountCents: cents, note: 'Ticket de caisse' });
      if (expenseErrors.length) errors.push(...expenseErrors);
      else expense = true;
    }
    const saveAlert = /** @type {HTMLElement} */ (box.querySelector('[data-save-alert]'));
    saveAlert.hidden = errors.length === 0;
    saveAlert.innerHTML = errors.map((e) => escapeHtml(e)).join('<br />');
    /** @type {HTMLElement} */ (box.querySelector('[data-saved]')).innerHTML =
      `${saved} prix enregistré(s)${expense ? ', dépense ajoutée au budget' : ''}. <a href="#/prix">Historique des prix</a>`;
  });
}
