import { escapeHtml } from '../utils/html.js';
import { formatMinutes } from '../utils/format.js';
import { filterRecipes } from '../domain/recipes/recipeFiltering.js';
import { totalMinutes, recipeMealTypes, hasTag, MEAL_TYPES, RECIPE_TAGS, QUICK_MINUTES, VESSEL_LABELS } from '../domain/recipes/recipes.js';
import { recipes, cuisineLabels, familyOf, filterContext, nutritionByRecipe, preparationsById, ingredientsById } from '../services/catalog.js';
import { FAMILIES, familyLabel } from '../domain/recipes/families.js';
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
const state = { query: '', family: '', robotOnly: false, vesselOnly: false, householdOnly: true, quickOnly: false, localOnly: false, seasonOnly: false, mealType: '', region: '', cuisine: '', tag: '', shown: PAGE_SIZE };



/**
 * @param {Recipe[]} list
 * @param {Set<string>} hard   Recettes avec un ingredient difficile a trouver en Guyane
 * @param {boolean} [showFamily]  Afficher la famille (resultats de recherche toutes familles)
 * @returns {string}
 */
function listHtml(list, hard, showFamily = false) {
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
          <span class="recipe-list__meta">${showFamily ? `${escapeHtml(familyLabel(familyOf.get(r.id) ?? ''))} · ` : ''}${escapeHtml(cuisineLabels.get(r.cuisine) ?? '')}, ${escapeHtml(formatMinutes(totalMinutes(r)))}, environ ${Math.round(kcal.get(r.id)?.kcal ?? 0)} kcal par portion</span>
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

  const moreFilters = [state.mealType, state.region, state.cuisine, state.tag].filter(Boolean).length + [state.quickOnly, state.robotOnly, state.vesselOnly, state.localOnly, state.seasonOnly].filter(Boolean).length;

  el.innerHTML = `
    <section>
      <h1 class="page-title">Recettes</h1>
      <p class="actions"><a class="button" href="#/recettes/nouvelle">+ Ajouter une recette</a></p>
      <div class="search">
        <label for="recipe-search">Rechercher une recette, une cuisine ou un ingrédient</label>
        <input id="recipe-search" type="search" autocomplete="off" placeholder="ex. quiche, poulet, coco" value="${escapeHtml(state.query)}" />
      </div>
      <details class="more-filters"${moreFilters ? ' open' : ''}>
        <summary>Plus de filtres${moreFilters ? ` (${moreFilters})` : ''}</summary>
        <div class="filters">
          ${selectHtml('mealType', 'Moment du repas', MEAL_TYPES, state.mealType, 'Tous les moments')}
          ${selectHtml('region', 'Région', REGIONS, state.region, 'Toutes les régions')}
          <div data-cuisine-field>${selectHtml('cuisine', 'Cuisine', cuisineOptions(), state.cuisine, 'Toutes les cuisines')}</div>
          ${selectHtml('tag', 'Style', RECIPE_TAGS, state.tag, 'Tous les styles')}
        </div>
        <div class="chips">
          <button type="button" class="chip" data-action="quick" aria-pressed="${state.quickOnly}">${QUICK_MINUTES} min maximum</button>
          <button type="button" class="chip" data-action="robot" aria-pressed="${state.robotOnly}">Au robot cuiseur (Thermomix)</button>
          <button type="button" class="chip" data-action="vessel" aria-pressed="${state.vesselOnly}">Un seul récipient</button>
          <button type="button" class="chip" data-action="local" aria-pressed="${state.localOnly}">Faciles à trouver en Guyane</button>
          <button type="button" class="chip" data-action="season" aria-pressed="${state.seasonOnly}">De saison et péyi</button>
        </div>
      </details>
      <label class="check"><input type="checkbox" data-action="household"${state.householdOnly ? ' checked' : ''} /> <span>Seulement les recettes adaptées à mon foyer</span></label>
      <p class="hint" id="recipe-count" aria-live="polite"></p>
      <div id="recipe-results"></div>
      <button type="button" class="button button--secondary" data-action="more" hidden>Afficher plus</button>
    </section>
  `;

  const input = /** @type {HTMLInputElement} */ (el.querySelector('#recipe-search'));
  const results = /** @type {HTMLElement} */ (el.querySelector('#recipe-results'));
  const count = /** @type {HTMLElement} */ (el.querySelector('#recipe-count'));
  const more = /** @type {HTMLButtonElement} */ (el.querySelector('[data-action="more"]'));

  /** Recettes qui passent la recherche et les filtres (hors famille). */
  const filtered = () =>
    filterRecipes(recipes, { query: state.query, vesselOnly: state.vesselOnly, household: state.householdOnly ? household : null }, filterContext).filter(
      (r) =>
        (!state.mealType || recipeMealTypes(r).includes(/** @type {any} */ (state.mealType))) &&
        (!state.region || cuisineRegion.get(r.cuisine) === state.region) &&
        (!state.cuisine || r.cuisine === state.cuisine) &&
        (!state.tag || hasTag(r, /** @type {any} */ (state.tag))) &&
        (!state.quickOnly || totalMinutes(r) <= QUICK_MINUTES) &&
        (!state.robotOnly || r.methods.some((m) => m.equipment.includes('food_processor'))) &&
        (!state.localOnly || !hard.has(r.id)) &&
        (!state.seasonOnly || seasonal.has(r.id)),
    );

  const refresh = () => {
    const all = filtered();
    // Accueil : une tuile par famille, chaque plat dans une seule famille.
    if (!state.family && !state.query.trim()) {
      count.textContent = all.length === 1 ? '1 recette' : `${all.length} recettes, rangées en ${FAMILIES.length} familles`;
      const mine = all.filter((r) => r.source.type === 'personal').length;
      results.innerHTML = `<div class="family-grid">
        <button type="button" class="family-tile family-tile--mine" data-open-family="mine"><strong>Mes recettes</strong><span>${mine ? `${mine} recette${mine > 1 ? 's' : ''}` : 'Ajoutez les vôtres'}</span></button>${FAMILIES.map((f) => {
        const n = all.filter((r) => familyOf.get(r.id) === f.id).length;
        return `<button type="button" class="family-tile" data-open-family="${f.id}"${n ? '' : ' disabled'}><strong>${escapeHtml(f.label)}</strong><span>${n} recette${n > 1 ? 's' : ''}</span></button>`;
      }).join('')}</div>`;
      more.hidden = true;
    } else {
      const list = state.family === 'mine' ? all.filter((r) => r.source.type === 'personal') : state.family ? all.filter((r) => familyOf.get(r.id) === state.family) : all;
      count.textContent = list.length === 1 ? '1 recette' : `${list.length} recettes`;
      results.innerHTML = `${
        state.family
          ? `<div class="family-head"><button type="button" class="button button--small button--secondary" data-open-family="">‹ Toutes les familles</button>
              <h2 class="family__title">${escapeHtml(state.family === 'mine' ? 'Mes recettes' : familyLabel(state.family))}</h2>
              ${state.family === 'mine' && !list.length ? '<p>Aucune recette personnelle pour l’instant. Saisissez-en une, ou importez-la depuis un texte, un lien ou une photo.</p><p><a class="button" href="#/recettes/nouvelle">+ Ajouter une recette</a></p>' : ''}</div>`
          : ''
      }${list.length || state.family !== 'mine' ? listHtml(list.slice(0, state.shown), hard, !state.family) : ''}`;
      more.hidden = list.length <= state.shown;
      more.textContent = `Afficher plus (${Math.min(PAGE_SIZE, list.length - state.shown)} sur ${list.length - state.shown} restantes)`;
    }
    results.querySelectorAll('[data-open-family]').forEach((b) => b.addEventListener('click', () => selectFamily(b.getAttribute('data-open-family') ?? '')));
  };

  /** @param {string} family */
  const selectFamily = (family) => {
    state.family = family;
    state.shown = PAGE_SIZE;
    refresh();
    count.scrollIntoView({ block: 'start' });
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
  el.querySelector('[data-action="household"]')?.addEventListener('change', (event) => {
    state.householdOnly = /** @type {HTMLInputElement} */ (event.target).checked;
    state.shown = PAGE_SIZE;
    refresh();
  });
  for (const [action, key] of /** @type {const} */ ([
    ['quick', 'quickOnly'],
    ['robot', 'robotOnly'],
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
