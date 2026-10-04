import { escapeHtml } from '../utils/html.js';
import { formatMinutes } from '../utils/format.js';
import { filterRecipes } from '../domain/recipes/recipeFiltering.js';
import { totalMinutes, VESSEL_LABELS } from '../domain/recipes/recipes.js';
import { recipes, cuisineLabels, filterContext } from '../services/catalog.js';

/** Filtres conserves pendant la navigation. */
const state = { query: '', vesselOnly: false };

/**
 * @param {import('../domain/recipes/recipes.js').Recipe[]} list
 * @returns {string}
 */
function listHtml(list) {
  if (list.length === 0) {
    return '<p class="empty">Aucune recette ne correspond. Essayez un autre mot ou retirez le filtre.</p>';
  }
  return `<ul class="recipe-list">${list
    .map(
      (r) => `
      <li>
        <a href="#/recettes/${encodeURIComponent(r.id)}">
          <span class="recipe-list__name">${escapeHtml(r.name)}</span>
          <span class="recipe-list__meta">${escapeHtml(cuisineLabels.get(r.cuisine) ?? '')}, ${escapeHtml(formatMinutes(totalMinutes(r)))}</span>
          ${r.vessel ? `<span class="tag">${escapeHtml(VESSEL_LABELS[r.vessel])}</span>` : ''}
        </a>
      </li>`,
    )
    .join('')}</ul>`;
}

/**
 * Ecran Recettes : recherche et filtre "un seul recipient".
 * @param {HTMLElement} el
 */
export function renderRecipes(el) {
  el.innerHTML = `
    <section>
      <h1 class="page-title">Recettes</h1>
      <div class="search">
        <label for="recipe-search">Rechercher une recette, une cuisine ou un ingrédient</label>
        <input id="recipe-search" type="search" autocomplete="off" placeholder="ex. poulet, indienne, riz" value="${escapeHtml(state.query)}" />
      </div>
      <button type="button" class="chip" data-action="vessel" aria-pressed="${state.vesselOnly}">Un seul récipient</button>
      <p class="hint" id="recipe-count" aria-live="polite"></p>
      <div id="recipe-results"></div>
    </section>
  `;

  const input = /** @type {HTMLInputElement} */ (el.querySelector('#recipe-search'));
  const chip = /** @type {HTMLButtonElement} */ (el.querySelector('[data-action="vessel"]'));
  const results = /** @type {HTMLElement} */ (el.querySelector('#recipe-results'));
  const count = /** @type {HTMLElement} */ (el.querySelector('#recipe-count'));

  const refresh = () => {
    const list = filterRecipes(recipes, { query: state.query, vesselOnly: state.vesselOnly }, filterContext);
    count.textContent = list.length === 1 ? '1 recette' : `${list.length} recettes`;
    results.innerHTML = listHtml(list);
  };

  input.addEventListener('input', () => {
    state.query = input.value;
    refresh();
  });
  chip.addEventListener('click', () => {
    state.vesselOnly = !state.vesselOnly;
    chip.setAttribute('aria-pressed', String(state.vesselOnly));
    refresh();
  });
  refresh();
}
