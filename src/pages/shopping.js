import { escapeHtml } from '../utils/html.js';
import { formatIsoDayMonth } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { roundUpQuantity } from '../domain/units/units.js';
import { addDays, parseIsoDate, toIsoDate, weekStart } from '../domain/planning/dates.js';
import { AISLES } from '../domain/ingredients/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { getHousehold } from '../services/householdService.js';
import { saveShoppingList, newId } from '../services/shoppingService.js';
import { shoppingListText } from '../domain/shopping/shopping.js';
import { weekShoppingEstimate, getStores } from '../services/budgetService.js';
import { formatCents } from '../domain/budget/money.js';
import { loadAvailability } from '../services/territoryService.js';
import { usableSubstitute } from '../domain/ingredients/territory.js';
import { substitutesFor } from '../domain/assistant/substitutes.js';
import { GUYANE_HINTS, WHERE_LABELS } from '../data/territory.js';

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

  const [{ mealCount, lines, state, estimate }, stores, availability] = await Promise.all([weekShoppingEstimate(monday), getStores(), loadAvailability()]);
  /** @param {string} id */
  const localText = (id) => {
    const level = availability(id);
    if (level === 'common') return '';
    const alt = usableSubstitute(id, availability, substitutesFor);
    const where = GUYANE_HINTS[id]?.where;
    const status = level === 'missing' ? 'Introuvable pour vous' : level === 'rare' ? 'Souvent introuvable en Guyane' : where ? `À chercher ${WHERE_LABELS[where].replace(/^plutôt /, '')}` : 'Magasin spécialisé';
    return `${status}${alt && level !== 'specialty' ? ` ; alternative : ${ingredientsById.get(alt)?.name ?? alt}` : ''}`;
  };
  const storeNames = new Map(stores.map((st) => [st.id, st.name]));
  const bestByKey = new Map(estimate.lines.map((e) => [e.key, e.best]));
  /** @param {string} key */
  const priceText = (key) => {
    const best = bestByKey.get(key);
    return best ? `Environ ${formatCents(best.cents)} chez ${storeNames.get(best.storeId) ?? 'un magasin'}` : '';
  };
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
              <span class="hint">${escapeHtml(detailText(l))}</span>
              ${localText(l.ingredientId) ? `<span class="hint local-hint">${escapeHtml(localText(l.ingredientId))}</span>` : ''}
              ${priceText(l.key) ? `<span class="shop__price">${escapeHtml(priceText(l.key))}</span>` : ''}</span>
          </label>
          ${
            l.need !== null
              ? `<a class="shop__pkg" href="#/courses/conditionnement/${encodeURIComponent(l.ingredientId)}/${monday}">${l.packages ? 'Modifier le conditionnement' : 'Conditionnement'}</a>`
              : ''
          }
          <a class="shop__pkg" href="#/assistant/produit/${encodeURIComponent(l.ingredientId)}">Moins cher ?</a>
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
        mealCount > 0 || state.extras.length
          ? `<p class="share-row"><button type="button" class="button" data-action="share">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>
              Partager la liste</button></p>
            <div class="alert alert--ok" role="status" data-alert="share" hidden></div>`
          : ''
      }
      ${
        mealCount === 0
          ? `<p class="empty">Aucun repas planifié cette semaine.</p>
             <p>La liste se remplit toute seule à partir du planning, en tenant compte de votre stock.</p>
             <p><a class="button button--secondary" href="#/planning/semaine/${monday}">Ouvrir le planning</a></p>`
          : `<div class="batch-summary"><p><strong>${checkedCount} sur ${total} article${total > 1 ? 's' : ''} dans le panier.</strong>
              Liste calculée pour ${mealCount} repas, stock déduit.</p>
              <p>${
                estimate.lines.length === 0
                  ? ''
                  : estimate.complete
                    ? `Coût estimé : environ ${escapeHtml(formatCents(estimate.totalCents))}.`
                    : `Coût estimé : au moins ${escapeHtml(formatCents(estimate.totalCents))} (prix inconnu pour ${estimate.missing.length} article${estimate.missing.length > 1 ? 's' : ''}). <a href="#/magasins">Ajouter des prix</a>`
              }</p>
              <p><a class="button button--secondary" href="#/courses/organisation/semaine/${monday}">Organiser les courses (magasins, trajets, jour)</a></p>
              <p><a href="#/drive/semaine/${monday}">Préparer le panier Drive</a> · <a href="#/assistant/semaine/${monday}">Réduire le coût avec l’assistant</a> · <a href="#/budget">Enregistrer le montant payé</a></p></div>`
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

  el.querySelector('[data-action="share"]')?.addEventListener('click', async () => {
    const { text } = shoppingListText(lines, state, {
      title: `Liste de courses – semaine du ${formatIsoDayMonth(monday)}`,
      aisles: AISLES,
      name,
      describe: buyText,
    });
    const box = /** @type {HTMLElement} */ (el.querySelector('[data-alert="share"]'));
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Liste de courses', text });
        return;
      }
      await navigator.clipboard.writeText(text);
      box.textContent = 'Liste copiée : collez-la dans WhatsApp, un SMS ou vos notes.';
      box.hidden = false;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return; // partage annule par l'utilisateur
      box.textContent = 'Le partage n’est pas disponible sur ce navigateur.';
      box.hidden = false;
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
