import { escapeHtml } from '../utils/html.js';
import { formatIsoDay, formatMinutes } from '../utils/format.js';
import { parseIsoDate, toIsoDate } from '../domain/planning/dates.js';
import { SLOTS, recentRecipeIds } from '../domain/planning/planning.js';
import { filterRecipes } from '../domain/recipes/recipeFiltering.js';
import { fitsSlot, totalMinutes, FREE_RECIPE_ID } from '../domain/recipes/recipes.js';
import { familyLabel } from '../domain/recipes/families.js';
import { evaluateRecipeForHousehold } from '../domain/household/compatibility.js';
import { parseCoachMeal, coachRecipe, assembledId, optionId, coachFoodLabel } from '../domain/nutrition/coach.js';
import { recipes, recipesById, filterContext, familyOf, registerPlannedRecipe } from '../services/catalog.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals, saveMeal, newMealId } from '../services/planningService.js';
import { getRatings } from '../services/ratingService.js';
import { getCoachPlan } from '../services/coachService.js';
import { loadAvailability, autoSubstituter } from '../services/territoryService.js';

/** @typedef {import('../domain/recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../domain/planning/planning.js').Meal} Meal */
/** @typedef {import('../domain/planning/planning.js').Slot} Slot */

const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label]));

/** Resultats de recherche affiches. */
const MAX_RESULTS = 15;
/** Plats par rubrique (favoris, recents, mes recettes). */
const PER_SECTION = 6;

/**
 * Choix rapide d'un plat pour un creneau : on tape, on touche, c'est ajoute.
 * Adresses : #/planning/ajouter/AAAA-MM-JJ/<repas> (nouveau) et #/planning/repas/<id>/changer (autre plat).
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderMealPicker(el, params) {
  const [meals, household, ratings, coach, availability] = await Promise.all([getMeals(), getHousehold(), getRatings(), getCoachPlan(), loadAvailability()]);
  const autoSubs = autoSubstituter(availability);
  const existing = params.id ? meals.find((m) => m.id === params.id) : undefined;
  if (params.id && !existing) {
    el.innerHTML = '<p>Ce repas a été retiré du planning.</p><p><a href="#/planning">Retour au planning</a></p>';
    return;
  }
  const date = existing?.date ?? params.date;
  const slot = /** @type {Slot} */ (existing?.slot ?? params.slot);
  if (!date || !parseIsoDate(date) || !SLOTS.some((s) => s.id === slot)) {
    el.innerHTML = '<p>Ce créneau n’existe pas.</p><p><a href="#/planning">Retour au planning</a></p>';
    return;
  }
  if (household.members.length === 0) {
    el.innerHTML = '<p>Présentez d’abord votre foyer : MealDom en a besoin pour les portions.</p><p><a class="button" href="#/foyer">Mon foyer</a></p>';
    return;
  }
  if (existing?.locked) {
    el.innerHTML = `<p>Ce repas est verrouillé.</p><p><a class="button" href="#/planning/repas/${encodeURIComponent(existing.id)}">Ouvrir le repas</a></p>`;
    return;
  }

  /** @param {Recipe} r */
  const suits = (r) => fitsSlot(r, slot) && evaluateRecipeForHousehold(r, household, filterContext).status === 'compatible';
  /** @param {string[]} ids */
  const usable = (ids) =>
    ids
      .map((id) => recipesById.get(id))
      .filter(/** @returns {r is Recipe} */ (r) => r !== undefined && r.id !== FREE_RECIPE_ID && suits(r))
      .slice(0, PER_SECTION);
  const favorites = usable([...ratings].filter(([, v]) => v === 'like').map(([id]) => id));
  const recent = usable(recentRecipeIds(meals, toIsoDate(new Date()), 30));
  const mine = usable(recipes.filter((r) => r.source.type === 'personal').map((r) => r.id));
  const coachMeal = coach?.meals.find((m) => m.slot === slot) ?? null;
  const parsed = coachMeal ? parseCoachMeal(coachMeal.text) : null;

  /** @param {Recipe} r */
  const itemHtml = (r) => `<li><button type="button" class="pick-item" data-pick="${escapeHtml(r.id)}">
      <span class="pick-item__name">${escapeHtml(r.name)}</span>
      <span class="pick-item__meta">${escapeHtml([formatMinutes(totalMinutes(r)), familyLabel(familyOf.get(r.id) ?? '')].filter(Boolean).join(' · '))}</span>
    </button></li>`;
  /** @param {string} title @param {Recipe[]} list */
  const sectionHtml = (title, list) => (list.length ? `<h2 class="pick__title">${escapeHtml(title)}</h2><ul class="pick-list">${list.map(itemHtml).join('')}</ul>` : '');

  /** Repas du programme du coach pour ce creneau. */
  const coachHtml = () => {
    if (!coach || !parsed) return '';
    if (parsed.assembled) {
      const a = parsed.assembled;
      const select = (/** @type {string} */ name, /** @type {string[]} */ choices, /** @type {string} */ label) =>
        `<label class="pick-coach__field"><span>${escapeHtml(label)}</span><select data-coach="${name}">${choices.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(coachFoodLabel(c))}</option>`).join('')}</select></label>`;
      return `<section class="pick-coach">
        <h2 class="pick__title">Mon programme</h2>
        <p class="hint">Quantités de votre coach : ${escapeHtml(
          /** @type {[import('../domain/nutrition/coach.js').CoachItem | null, string][]} */ ([[a.protein, 'de protéines'], [a.vegetables, 'de légumes'], [a.starch, a.starch?.cooked ? 'de féculents cuits' : 'de féculents']])
            .filter(([x]) => x?.grams)
            .map(([x, what]) => `${x?.grams}${x?.gramsMax ? ` à ${x.gramsMax}` : ''} g ${what}`)
            .join(', '),
        )}.</p>
        <div class="pick-coach__fields">
          ${select('protein', a.protein.choices, 'Protéine')}
          ${select('vegetable', a.vegetables.choices, 'Légumes')}
          ${a.starch ? select('starch', a.starch.choices, 'Féculent') : ''}
        </div>
        <button type="button" class="button" data-coach-add>Ajouter ce repas</button>
      </section>`;
    }
    const options = parsed.options.map((_, i) => coachRecipe(optionId(slot, i), coach)).filter((r) => r !== null);
    return options.length ? `<section class="pick-coach"><h2 class="pick__title">Mon programme</h2><ul class="pick-list">${options.map((r) => itemHtml(r)).join('')}</ul></section>` : '';
  };

  el.innerHTML = `
    <section class="pick">
      <h1 class="page-title">${existing ? 'Changer de plat' : escapeHtml(slotLabels.get(slot) ?? slot)}</h1>
      <p class="hint">${escapeHtml(formatIsoDay(date))}${existing ? ` · ${escapeHtml(slotLabels.get(slot) ?? slot)}, à la place de « ${escapeHtml(existing.recipeName)} »` : ''}</p>
      <div class="pick__search">
        <label for="pick-q" class="visually-hidden">Chercher un plat ou écrire votre repas</label>
        <input id="pick-q" type="search" autocomplete="off" placeholder="Chercher un plat, ou écrire votre repas" />
      </div>
      <div class="alert" role="alert" hidden></div>
      <div data-results hidden></div>
      <div data-sections>
        ${coachHtml()}
        ${sectionHtml('♥ Mes favoris', favorites)}
        ${sectionHtml('Déjà au menu récemment', recent)}
        ${sectionHtml('Mes recettes', mine)}
        ${!favorites.length && !recent.length && !mine.length && !coachMeal ? '<p class="hint">Tapez le nom d’un plat (« poulet », « quiche ») ou d’un ingrédient. Vous pouvez aussi écrire un repas qui n’est pas une recette : « Restaurant », « Pâtes au thon »…</p>' : ''}
      </div>
      <p class="pick__more">${
        existing
          ? `<a href="#/planning/repas/${encodeURIComponent(existing.id)}">Retour au repas</a>`
          : `<a href="#/planning/ajouter/${date}/${slot}/details">Plus d’options : qui mange, invités, restes…</a>`
      }</p>
    </section>`;

  const input = /** @type {HTMLInputElement} */ (el.querySelector('#pick-q'));
  const results = /** @type {HTMLElement} */ (el.querySelector('[data-results]'));
  const sections = /** @type {HTMLElement} */ (el.querySelector('[data-sections]'));
  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));

  const refresh = () => {
    const text = input.value.trim();
    results.hidden = !text;
    sections.hidden = Boolean(text);
    if (!text) return;
    const found = filterRecipes(recipes, { query: text, household }, filterContext).filter((r) => fitsSlot(r, slot)).slice(0, MAX_RESULTS);
    results.innerHTML = `${found.length ? `<ul class="pick-list">${found.map(itemHtml).join('')}</ul>` : '<p class="hint">Aucune recette ne correspond.</p>'}
      <p><button type="button" class="button button--secondary pick-free" data-free>Ajouter « ${escapeHtml(text.slice(0, 60))} » comme repas libre</button></p>
      <p class="hint">Un repas libre (restaurant, plat improvisé…) apparaît dans le planning, sans recette ni courses.</p>`;
  };
  input.addEventListener('input', refresh);

  /**
   * Enregistre le plat choisi et revient au planning.
   * @param {Recipe} recipe
   * @param {string} name
   */
  const choose = async (recipe, name) => {
    const subs = recipe.id === FREE_RECIPE_ID ? [] : autoSubs(recipe);
    /** @type {Meal} */
    const meal = existing
      ? { ...existing, recipeId: recipe.id, recipeName: name, substitutions: subs }
      : { id: newMealId(), date, slot, recipeId: recipe.id, recipeName: name, attendees: household.members.map((m) => m.id), guests: 0, nextLunch: null, locked: false, ...(subs.length ? { substitutions: subs } : {}) };
    if (!subs.length && existing) delete meal.substitutions;
    const errors = await saveMeal(meal);
    if (errors.length) {
      alertBox.hidden = false;
      alertBox.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
      alertBox.scrollIntoView({ block: 'center' });
      return;
    }
    window.location.replace(`#/planning/semaine/${date}`);
  };

  el.addEventListener('click', async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const pick = target.closest('[data-pick]')?.getAttribute('data-pick');
    if (pick) {
      const recipe = recipesById.get(pick) ?? (coach ? coachRecipe(pick, coach) : null);
      if (recipe) {
        registerPlannedRecipe(recipe);
        await choose(recipe, recipe.name);
      }
      return;
    }
    if (target.closest('[data-free]')) {
      const recipe = recipesById.get(FREE_RECIPE_ID);
      if (recipe) await choose(recipe, input.value.trim().slice(0, 60));
      return;
    }
    if (target.closest('[data-coach-add]') && coach) {
      const value = (/** @type {string} */ name) => /** @type {HTMLSelectElement | null} */ (el.querySelector(`[data-coach="${name}"]`))?.value ?? null;
      const recipe = coachRecipe(assembledId(slot, value('protein') ?? '', value('vegetable') ?? '', value('starch')), coach);
      if (!recipe) return;
      registerPlannedRecipe(recipe);
      await choose(recipe, recipe.name);
    }
  });
}
