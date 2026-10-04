import { escapeHtml } from '../utils/html.js';
import { formatIsoDayMonth } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { roundUpQuantity } from '../domain/units/units.js';
import { addDays, parseIsoDate, toIsoDate, weekStart } from '../domain/planning/dates.js';
import { AISLES } from '../domain/ingredients/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { getHousehold } from '../services/householdService.js';
import { weekShoppingList, saveShoppingList, newId } from '../services/shoppingService.js';

/** @typedef {import('../domain/shopping/shopping.js').ShoppingLine} ShoppingLine */

/**
 * Ce qu'il faut acheter, en clair.
 * @param {ShoppingLine} line
 * @returns {string}
 */
function buyText(line) {
  if (line.packages) {
    const { count, package: pkg } = line.packages;
    return `${count} × ${pkg.label} de ${formatQuantity(pkg.quantity, pkg.unit)}`;
  }
  if (line.buyQuantity !== null) return formatQuantity(line.buyQuantity, line.unit);
  return 'à vérifier dans vos placards';
}

/**
 * Detail du calcul : besoin et stock utilise.
 * @param {ShoppingLine} line
 * @returns {string}
 */
function detailText(line) {
  if (line.need === null) return 'Quantité selon votre goût';
  const parts = [`Besoin ${formatQuantity(roundUpQuantity(line.need, line.unit), line.unit)}`];
  if (line.inStock > 0) parts.push(`${formatQuantity(roundUpQuantity(line.inStock, line.unit), line.unit)} déjà en stock`);
  return parts.join(', ');
}

/**
 * Ecran Courses : liste de la semaine, utilisable sans Internet.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderShopping(el, params) {
  const today = toIsoDate(new Date());
  const monday = weekStart(params.date && parseIsoDate(params.date) ? params.date : today);
  const household = await getHousehold();

  if (household.members.length === 0) {
    el.innerHTML = `<section><h1 class="page-title">Courses</h1>
      <p>La liste de courses se calcule à partir des repas planifiés pour votre foyer.</p>
      <a class="button" href="#/foyer">Présenter mon foyer</a></section>`;
    return;
  }

  const { mealCount, lines, state } = await weekShoppingList(monday);
  const toBuy = lines.filter((l) => !l.covered);
  const covered = lines.filter((l) => l.covered);
  const name = (/** @type {string} */ id) => ingredientsById.get(id)?.name ?? id;

  const aislesHtml = AISLES.map((aisle) => {
    const items = toBuy.filter((l) => l.aisle === aisle.id);
    if (items.length === 0) return '';
    return `<h2>${escapeHtml(aisle.label)}</h2>
      <ul class="shop">${items
        .map(
          (l) => `<li>
          <label class="check shop__item">
            <input type="checkbox" data-key="${escapeHtml(l.key)}"${state.checked.includes(l.key) ? ' checked' : ''} />
            <span><strong>${escapeHtml(name(l.ingredientId))}</strong>
              <span class="shop__qty">${escapeHtml(buyText(l))}</span>
              <span class="hint">${escapeHtml(detailText(l))}</span></span>
          </label>
          ${
            l.need !== null
              ? `<a class="shop__pkg" href="#/courses/conditionnement/${encodeURIComponent(l.ingredientId)}/${monday}">${l.packages ? 'Modifier le conditionnement' : 'Conditionnement'}</a>`
              : ''
          }
        </li>`,
        )
        .join('')}</ul>`;
  }).join('');

  const extrasHtml = state.extras
    .map(
      (x) => `<li>
        <label class="check shop__item"><input type="checkbox" data-extra="${escapeHtml(x.id)}"${x.checked ? ' checked' : ''} />
          <span><strong>${escapeHtml(x.label)}</strong></span></label>
        <button type="button" class="icon-button" data-remove-extra="${escapeHtml(x.id)}" aria-label="Retirer ${escapeHtml(x.label)}">×</button>
      </li>`,
    )
    .join('');

  const checkedCount = toBuy.filter((l) => state.checked.includes(l.key)).length + state.extras.filter((x) => x.checked).length;
  const total = toBuy.length + state.extras.length;

  el.innerHTML = `
    <section>
      <h1 class="page-title">Courses</h1>
      <nav class="week-nav" aria-label="Changer de semaine">
        <a href="#/courses/semaine/${addDays(monday, -7)}" aria-label="Semaine précédente">‹</a>
        <span>Semaine du ${escapeHtml(formatIsoDayMonth(monday))}</span>
        <a href="#/courses/semaine/${addDays(monday, 7)}" aria-label="Semaine suivante">›</a>
      </nav>
      ${
        mealCount === 0
          ? `<p class="empty">Aucun repas planifié cette semaine.</p>
             <p>La liste se remplit toute seule à partir du planning, en tenant compte de votre stock.</p>
             <p><a class="button button--secondary" href="#/planning/semaine/${monday}">Ouvrir le planning</a></p>`
          : `<p class="batch-summary"><strong>${checkedCount} sur ${total} article${total > 1 ? 's' : ''} dans le panier.</strong>
              Liste calculée pour ${mealCount} repas, stock déduit.</p>`
      }
      ${aislesHtml}

      <h2>Ajouté à la main</h2>
      <ul class="shop" data-list="extras">${extrasHtml}</ul>
      <form class="inline-form" data-form="extra" novalidate>
        <label for="extra-input" class="visually-hidden">Ajouter un article</label>
        <div class="inline-form__row">
          <input id="extra-input" type="text" maxlength="60" autocomplete="off" placeholder="ex. papier toilette, pain" />
          <button type="submit" class="button button--small button--secondary">Ajouter</button>
        </div>
      </form>

      ${
        covered.length
          ? `<details class="prep covered">
              <summary>Déjà à la maison (${covered.length})</summary>
              <ul class="ingredients">${covered
                .map(
                  (l) => `<li><span class="ingredients__qty">${escapeHtml(
                    l.need === null ? 'en stock' : formatQuantity(roundUpQuantity(l.need, l.unit), l.unit),
                  )}</span><span>${escapeHtml(name(l.ingredientId))}</span></li>`,
                )
                .join('')}</ul>
            </details>`
          : ''
      }
      <p class="hint">La liste fonctionne sans Internet : cochez au fur et à mesure en magasin. Pour ne plus voir un produit que vous avez déjà, ajoutez-le dans <a href="#/stock">Stock</a>.</p>
    </section>
  `;

  const save = async () => {
    await saveShoppingList(state);
    await renderShopping(el, params);
  };

  // Ecouteurs poses sur la section : ils disparaissent avec elle a chaque nouvel affichage.
  const section = /** @type {HTMLElement} */ (el.querySelector('section'));
  section.addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const key = input.getAttribute('data-key');
    const extraId = input.getAttribute('data-extra');
    if (key) {
      state.checked = input.checked ? [...new Set([...state.checked, key])] : state.checked.filter((k) => k !== key);
      await save();
    } else if (extraId) {
      state.extras = state.extras.map((x) => (x.id === extraId ? { ...x, checked: input.checked } : x));
      await save();
    }
  });

  el.querySelector('[data-list="extras"]')?.addEventListener('click', async (event) => {
    const id = /** @type {HTMLElement} */ (event.target).getAttribute('data-remove-extra');
    if (!id) return;
    state.extras = state.extras.filter((x) => x.id !== id);
    await save();
  });

  el.querySelector('[data-form="extra"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement} */ (el.querySelector('#extra-input'));
    const label = input.value.trim();
    if (!label) return;
    state.extras = [...state.extras, { id: newId(), label, checked: false }];
    await save();
    /** @type {HTMLInputElement | null} */ (el.querySelector('#extra-input'))?.focus();
  });
}
