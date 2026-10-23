import { escapeHtml } from '../utils/html.js';
import { formatMinutes } from '../utils/format.js';
import { filterRecipes } from '../domain/recipes/recipeFiltering.js';
import { totalMinutes, recipeMealTypes, hasTag, MEAL_TYPES, RECIPE_TAGS, QUICK_MINUTES, VESSEL_LABELS } from '../domain/recipes/recipes.js';
import { recipes, cuisineLabels, filterContext, nutritionByRecipe, preparationsById, ingredientsById } from '../services/catalog.js';
import { CUISINES, REGIONS } from '../data/cuisines.js';
import { getHousehold } from '../services/householdService.js';
import { loadAvailability } from '../services/territoryService.js';
import { seasonNow } from '../services/seasonService.js';
import { seasonalIngredients, SEASONAL_MIN_INGREDIENTS } from '../domain/ingredients/seasons.js';
import { recipeLocalIssues } from '../domain/ingredients/territory.js';
import { substitutesFor } from '../domain/assistant/substitutes.js';

/** @typedef {import('../domain/recipes/recipes.js').Recipe} Recipe */

/** Nombre de recettes affichees par page ("Afficher plus" ajoute la suite). */
const PAGE_SIZE = 30;

const cuisineRegion = new Map(CUISINES.map((c) => [c.id, c.region]));

/** Filtres conserves pendant la navigation. */
const state = { query: '', vesselOnly: false, householdOnly: true, quickOnly: false, localOnly: false, seasonOnly: false, mealType: '', region: '', cuisine: '', tag: '', shown: PAGE_SIZE };

/**
 * @param {Recipe[]} list
 * @param {Set<string>} hard   Recettes avec un ingredient difficile a trouver en Guyane
 * @returns {string}
 */
function listHtml(list, hard) {
  if (list.length === 0) {
    return '<p class="empty">Aucune recette ne correspond. Essayez un autre mot ou retirez un filtre.</p>';
  }
  const kcal = nutritionByRecipe();
  return `<ul class="recipe-list">${list
    .map(
      (r) => `
      <li>
        <a href="#/recettes/${encodeURIComponent(r.id)}">
          <span class="recipe-list__name">${escapeHtml(r.name)}</span>
          <span class="recipe-list__meta">${escapeHtml(cuisineLabels.get(r.cuisine) ?? '')}, ${escapeHtml(formatMinutes(totalMinutes(r)))}, environ ${Math.round(kcal.get(r.id)?.kcal ?? 0)} kcal par portion</span>
          ${r.vessel ? `<span class="tag">${escapeHtml(VESSEL_LABELS[r.vessel])}</span>` : ''}
          ${(r.tags ?? []).includes('light') ? '<span class="tag">Léger</span>' : ''}
          ${hard.has(r.id) ? '<span class="tag tag--warn">Ingrédient difficile à trouver</span>' : ''}
        </a>
      </li>`,
    )
    .join('')}</ul>`;
}

/**
 * @param {string} name
 * @param {string} label
 * @param {{ id: string, label: string }[]} options
 * @param {string} selected
 * @param {string} all
 * @returns {string}
 */
function selectHtml(name, label, options, selected, all) {
  return `<div class="field field--inline"><label for="rf-${name}">${escapeHtml(label)}</label>
    <select id="rf-${name}" data-filter="${name}"><option value="">${escapeHtml(all)}</option>${options
      .map((o) => `<option value="${escapeHtml(o.id)}"${o.id === selected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
      .join('')}</select></div>`;
}

/**
 * Ecran Recettes : recherche et filtres (repas, region, cuisine, style, foyer, recipient, rapidite).
 * Adresse #/recettes/avec/<ingredient> : recettes qui utilisent cet ingredient.
 * @param {HTMLElement} el
 * @param {Record<string, string>} [params]
 */
export async function renderRecipes(el, params = {}) {
  const focus = params.ingredientId ? ingredientsById.get(params.ingredientId) : undefined;
  if (focus) {
    state.query = focus.name;
    state.shown = PAGE_SIZE;
  }
  const [household, availability, season] = await Promise.all([getHousehold(), loadAvailability(), seasonNow()]);
  /** Recettes qui utilisent au moins deux produits de saison ou peyi. */
  const seasonal = new Set(recipes.filter((r) => seasonalIngredients(r, preparationsById, season.favoured).length >= SEASONAL_MIN_INGREDIENTS).map((r) => r.id));
  /** Recettes avec un ingredient rare ou introuvable (alternative possible ou non). */
  const hard = new Set(
    recipes.filter((r) => recipeLocalIssues(r, preparationsById, availability, substitutesFor).some((i) => i.level === 'rare' || i.level === 'missing')).map((r) => r.id),
  );
  const cuisineOptions = () =>
    CUISINES.filter((c) => !state.region || c.region === state.region)
      .filter((c) => recipes.some((r) => r.cuisine === c.id))
      .map((c) => ({ id: c.id, label: c.label }))
      .sort((a, b) => a.label.localeCompare(b.label));

  el.innerHTML = `
    <section>
      <h1 class="page-title">Recettes</h1>
      <div class="search">
        <label for="recipe-search">Rechercher une recette, une cuisine ou un ingrédient</label>
        <input id="recipe-search" type="search" autocomplete="off" placeholder="ex. poulet, japonaise, coco" value="${escapeHtml(state.query)}" />
      </div>
      <div class="filters">
        ${selectHtml('mealType', 'Repas', MEAL_TYPES, state.mealType, 'Tous les repas')}
        ${selectHtml('region', 'Région', REGIONS, state.region, 'Toutes les régions')}
        <div data-cuisine-field>${selectHtml('cuisine', 'Cuisine', cuisineOptions(), state.cuisine, 'Toutes les cuisines')}</div>
        ${selectHtml('tag', 'Style', RECIPE_TAGS, state.tag, 'Tous les styles')}
      </div>
      <div class="chips">
        <button type="button" class="chip" data-action="household" aria-pressed="${state.householdOnly}">Adaptées à mon foyer</button>
        <button type="button" class="chip" data-action="quick" aria-pressed="${state.quickOnly}">${QUICK_MINUTES} min maximum</button>
        <button type="button" class="chip" data-action="vessel" aria-pressed="${state.vesselOnly}">Un seul récipient</button>
        <button type="button" class="chip" data-action="local" aria-pressed="${state.localOnly}">Faciles à trouver en Guyane</button>
        <button type="button" class="chip" data-action="season" aria-pressed="${state.seasonOnly}">De saison et péyi</button>
      </div>
      <p class="hint" id="recipe-count" aria-live="polite"></p>
      <div id="recipe-results"></div>
      <button type="button" class="button button--secondary" data-action="more" hidden>Afficher plus</button>
    </section>
  `;

  const input = /** @type {HTMLInputElement} */ (el.querySelector('#recipe-search'));
  const results = /** @type {HTMLElement} */ (el.querySelector('#recipe-results'));
  const count = /** @type {HTMLElement} */ (el.querySelector('#recipe-count'));
  const more = /** @type {HTMLButtonElement} */ (el.querySelector('[data-action="more"]'));

  const refresh = () => {
    const list = filterRecipes(
      recipes,
      { query: state.query, vesselOnly: state.vesselOnly, household: state.householdOnly ? household : null },
      filterContext,
    ).filter(
      (r) =>
        (!state.mealType || recipeMealTypes(r).includes(/** @type {any} */ (state.mealType))) &&
        (!state.region || cuisineRegion.get(r.cuisine) === state.region) &&
        (!state.cuisine || r.cuisine === state.cuisine) &&
        (!state.tag || hasTag(r, /** @type {any} */ (state.tag))) &&
        (!state.quickOnly || totalMinutes(r) <= QUICK_MINUTES) &&
        (!state.localOnly || !hard.has(r.id)) &&
        (!state.seasonOnly || seasonal.has(r.id)),
    );
    count.textContent = list.length === 1 ? '1 recette' : `${list.length} recettes`;
    results.innerHTML = listHtml(list.slice(0, state.shown), hard);
    more.hidden = list.length <= state.shown;
    more.textContent = `Afficher plus (${Math.min(PAGE_SIZE, list.length - state.shown)} sur ${list.length - state.shown} restantes)`;
  };

  input.addEventListener('input', () => {
    state.query = input.value;
    state.shown = PAGE_SIZE;
    refresh();
  });
  el.querySelector('.filters')?.addEventListener('change', (event) => {
    const select = /** @type {HTMLSelectElement} */ (event.target);
    const name = /** @type {'mealType' | 'region' | 'cuisine' | 'tag'} */ (select.getAttribute('data-filter'));
    state[name] = select.value;
    if (name === 'region') {
      if (state.cuisine && cuisineRegion.get(state.cuisine) !== state.region && state.region) state.cuisine = '';
      /** @type {HTMLElement} */ (el.querySelector('[data-cuisine-field]')).innerHTML = selectHtml('cuisine', 'Cuisine', cuisineOptions(), state.cuisine, 'Toutes les cuisines');
    }
    state.shown = PAGE_SIZE;
    refresh();
  });
  for (const [action, key] of /** @type {const} */ ([
    ['household', 'householdOnly'],
    ['quick', 'quickOnly'],
    ['vessel', 'vesselOnly'],
    ['local', 'localOnly'],
    ['season', 'seasonOnly'],
  ])) {
    const chip = /** @type {HTMLButtonElement} */ (el.querySelector(`[data-action="${action}"]`));
    chip.addEventListener('click', () => {
      state[key] = !state[key];
      chip.setAttribute('aria-pressed', String(state[key]));
      state.shown = PAGE_SIZE;
      refresh();
    });
  }
  more.addEventListener('click', () => {
    state.shown += PAGE_SIZE;
    refresh();
  });
  refresh();
}
