import { escapeHtml } from '../utils/html.js';
import { formatIsoDay, formatMinutes, formatPortions, formatNumber } from '../utils/format.js';
import { addDays, parseIsoDate } from '../domain/planning/dates.js';
import { SLOTS, mealPortionsFor } from '../domain/planning/planning.js';
import { filterRecipes } from '../domain/recipes/recipeFiltering.js';
import { totalMinutes, fitsSlot } from '../domain/recipes/recipes.js';
import { personalPortion } from '../domain/nutrition/program.js';
import { recipes, recipesById, filterContext, ingredientsById, preparationsById, nutritionByRecipe } from '../services/catalog.js';
import { programSummary } from '../services/programService.js';
import { loadAvailability, autoSubstituter } from '../services/territoryService.js';
import { recipeLocalIssues } from '../domain/ingredients/territory.js';
import { substitutesFor } from '../domain/assistant/substitutes.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals, saveMeal, deleteMeal, newMealId } from '../services/planningService.js';

/** @typedef {import('../domain/planning/planning.js').Meal} Meal */
/** @typedef {import('../domain/planning/planning.js').Slot} Slot */
/** @typedef {import('../domain/household/household.js').Household} Household */

/**
 * Cases "qui mange ?" pour un groupe.
 * @param {string} name
 * @param {Household} household
 * @param {string[]} checked
 * @returns {string}
 */
function attendeesHtml(name, household, checked) {
  return household.members
    .map(
      (m) => `<label class="check"><input type="checkbox" name="${name}" value="${escapeHtml(m.id)}"${
        checked.includes(m.id) ? ' checked' : ''
      } /> <span>${escapeHtml(m.name)}</span></label>`,
    )
    .join('');
}

/** Nombre de recettes affichees dans le choix avant de devoir preciser la recherche. */
const MAX_CHOICES = 40;

/**
 * Nombre entier saisi (vide = 0, invalide = -1 pour etre refuse par la validation).
 * @param {HTMLInputElement | null} input
 * @returns {number}
 */
function readCount(input) {
  const text = (input?.value ?? '').trim();
  if (text === '') return 0;
  return /^\d+$/.test(text) ? Number(text) : -1;
}

/**
 * Ecran d'ajout ou de modification d'un repas.
 * Adresses : #/planning/ajouter/AAAA-MM-JJ/dinner ou #/planning/repas/<id>
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderMeal(el, params) {
  const [meals, household, program, availability] = await Promise.all([getMeals(), getHousehold(), programSummary(), loadAvailability()]);
  const autoSubs = autoSubstituter(availability);
  const existing = params.id ? meals.find((m) => m.id === params.id) : undefined;

  if (params.id && !existing) {
    el.innerHTML = '<p>Ce repas a été retiré du planning.</p><p><a href="#/planning">Retour au planning</a></p>';
    return;
  }
  if (!existing && (!params.date || !parseIsoDate(params.date) || !SLOTS.some((s) => s.id === params.slot))) {
    el.innerHTML = '<p>Ce créneau n’existe pas.</p><p><a href="#/planning">Retour au planning</a></p>';
    return;
  }

  const allIds = household.members.map((m) => m.id);
  /** @type {Meal} */
  const meal = existing
    ? structuredClone(existing)
    : {
        id: newMealId(),
        date: params.date,
        slot: /** @type {Slot} */ (params.slot),
        recipeId: '',
        recipeName: '',
        attendees: allIds,
        guests: 0,
        nextLunch: null,
        locked: false,
      };
  const locked = Boolean(existing?.locked);
  const disabled = locked ? ' disabled' : '';
  let query = '';
  let selectedRecipeId = meal.recipeId;

  el.innerHTML = `
    <section>
      <h1 class="page-title">${existing ? 'Modifier le repas' : 'Ajouter un repas'}</h1>
      ${locked ? '<p class="notice-inline">Ce repas est verrouillé. Décochez « Verrouiller ce repas » et enregistrez pour pouvoir le modifier.</p>' : ''}
      <div class="alert" role="alert" hidden></div>
      <form data-form="meal" novalidate>
        <fieldset class="field"${disabled}>
          <legend>Quand ?</legend>
          <div class="when">
            <input type="date" name="date" value="${escapeHtml(meal.date)}" aria-label="Date" />
            <select name="slot" aria-label="Repas">
              ${SLOTS.map((s) => `<option value="${s.id}"${s.id === meal.slot ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
            </select>
          </div>
        </fieldset>

        <fieldset class="field"${disabled}>
          <legend>Recette</legend>
          <p class="hint">Seules les recettes adaptées à votre foyer sont proposées.</p>
          <input type="search" data-input="recipe-search" placeholder="Rechercher une recette" aria-label="Rechercher une recette" autocomplete="off" />
          <div class="recipe-choices" data-list="recipes"></div>
        </fieldset>

        <fieldset class="field checks"${disabled}>
          <legend>Qui mange ?</legend>
          ${attendeesHtml('attendees', household, meal.attendees)}
          <label class="guests">Invités (comptés comme adultes)
            <input type="text" inputmode="numeric" name="guests" value="${meal.guests}" autocomplete="off" />
          </label>
        </fieldset>

        <fieldset class="field" data-group="next-lunch"${disabled}>
          <legend>Restes</legend>
          <label class="check"><input type="checkbox" name="nextLunch"${meal.nextLunch ? ' checked' : ''} />
            <span>Cuisiner aussi pour le déjeuner du lendemain</span></label>
          <div class="checks nested" data-block="next-lunch"${meal.nextLunch ? '' : ' hidden'}>
            <p class="hint">Qui mangera les restes le lendemain midi ?</p>
            ${attendeesHtml('lunchAttendees', household, meal.nextLunch?.attendees ?? allIds)}
            <label class="guests">Invités
              <input type="text" inputmode="numeric" name="lunchGuests" value="${meal.nextLunch?.guests ?? 0}" autocomplete="off" />
            </label>
          </div>
        </fieldset>

        <fieldset class="field" data-block="subs"${disabled}></fieldset>

        <p class="portions" data-output="portions" aria-live="polite"></p>
        <p class="hint" data-output="personal" aria-live="polite"></p>

        <label class="check"><input type="checkbox" name="locked"${meal.locked ? ' checked' : ''} />
          <span>Verrouiller ce repas (il ne pourra plus être modifié par erreur)</span></label>

        <div class="form-actions">
          <button type="submit" class="button">Enregistrer</button>
          ${existing && !locked ? '<button type="button" class="button button--danger" data-action="delete">Retirer du planning</button>' : ''}
        </div>
        ${existing ? `<p><a href="#/recettes/${encodeURIComponent(meal.recipeId)}">Voir la recette</a></p>` : ''}
      </form>
    </section>
  `;

  const form = /** @type {HTMLFormElement} */ (el.querySelector('[data-form="meal"]'));
  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  const list = /** @type {HTMLElement} */ (el.querySelector('[data-list="recipes"]'));
  const search = /** @type {HTMLInputElement} */ (el.querySelector('[data-input="recipe-search"]'));
  const nextLunchBlock = /** @type {HTMLElement} */ (el.querySelector('[data-block="next-lunch"]'));
  const nextLunchGroup = /** @type {HTMLElement} */ (el.querySelector('[data-group="next-lunch"]'));
  const portionsOut = /** @type {HTMLElement} */ (el.querySelector('[data-output="portions"]'));
  const personalOut = /** @type {HTMLElement} */ (el.querySelector('[data-output="personal"]'));
  const subsBlock = /** @type {HTMLElement} */ (el.querySelector('[data-block="subs"]'));
  /** @param {string} id */
  const nameOf = (id) => ingredientsById.get(id)?.name ?? id;
  /** Ingredients remplaces du repas : ceux enregistres, ou les alternatives d'office pour une nouvelle recette. */
  /** @type {import('../domain/planning/planning.js').Substitution[]} */
  let subs = meal.substitutions ?? [];
  if (!existing && recipesById.get(meal.recipeId)) subs = autoSubs(/** @type {import('../domain/recipes/recipes.js').Recipe} */ (recipesById.get(meal.recipeId)));

  const renderSubs = () => {
    const recipe = recipesById.get(selectedRecipeId);
    if (!recipe) {
      subsBlock.innerHTML = '';
      return;
    }
    const replaced = new Set(subs.map((s) => s.from));
    const pairs = [...new Set(recipe.ingredients.map((l) => l.ingredientId))]
      .filter((id) => !replaced.has(id))
      .flatMap((id) => substitutesFor(id).map((to) => ({ from: id, to })));
    const issues = recipeLocalIssues(recipe, preparationsById, availability, substitutesFor);
    subsBlock.innerHTML = `<legend>Ingrédients remplacés</legend>
      ${subs.length ? `<ul class="local-list">${subs.map((s) => `<li><span>${escapeHtml(nameOf(s.from))} → <strong>${escapeHtml(nameOf(s.to))}</strong></span>
          <button type="button" class="button button--small button--secondary" data-unsub="${escapeHtml(s.from)}"${disabled}>Revenir à l’original</button></li>`).join('')}</ul>` : '<p class="hint">Aucun.</p>'}
      ${issues.length ? `<p class="hint">À trouver : ${issues.map((i) => `${escapeHtml(nameOf(i.ingredientId))} (${i.level === 'missing' ? 'introuvable pour vous' : i.level === 'rare' ? 'souvent introuvable en Guyane' : 'magasin spécialisé'})`).join(', ')}.</p>` : ''}
      ${pairs.length ? `<div class="inline-form__row"><select data-sub-choice aria-label="Ingrédient à remplacer"${disabled}>${pairs.map((p) => `<option value="${escapeHtml(p.from)}|${escapeHtml(p.to)}">${escapeHtml(nameOf(p.from))} → ${escapeHtml(nameOf(p.to))}</option>`).join('')}</select>
        <button type="button" class="button button--small button--secondary" data-add-sub${disabled}>Remplacer</button></div>` : ''}
      <p class="hint">La liste de courses suit les remplacements. Le goût change un peu.</p>`;
  };
  subsBlock.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const from = target.getAttribute('data-unsub');
    if (from) subs = subs.filter((s) => s.from !== from);
    else if (target.hasAttribute('data-add-sub')) {
      const [f, t] = (/** @type {HTMLSelectElement} */ (subsBlock.querySelector('[data-sub-choice]')).value || '|').split('|');
      if (f && t) subs = [...subs.filter((s) => s.from !== f), { from: f, to: t }];
    } else return;
    renderSubs();
  });

  /** @param {string} name */
  const field = (name) => /** @type {HTMLInputElement | null} */ (form.elements.namedItem(name));
  /** @param {string} name */
  const checked = (name) =>
    [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => /** @type {HTMLInputElement} */ (i).value);

  /** @returns {Meal} */
  const readDraft = () => {
    const recipeId = selectedRecipeId;
    const slot = /** @type {Slot} */ (field('slot')?.value ?? meal.slot);
    const wantsLunch = slot === 'dinner' && Boolean(field('nextLunch')?.checked);
    return {
      ...meal,
      date: field('date')?.value ?? meal.date,
      slot,
      recipeId,
      recipeName: recipesById.get(recipeId)?.name ?? meal.recipeName,
      attendees: checked('attendees'),
      guests: readCount(field('guests')),
      nextLunch: wantsLunch ? { attendees: checked('lunchAttendees'), guests: readCount(field('lunchGuests')) } : null,
      locked: Boolean(field('locked')?.checked),
      ...(subs.length || meal.substitutions ? { substitutions: subs } : {}),
    };
  };

  const renderRecipeChoices = () => {
    const current = selectedRecipeId;
    const slot = /** @type {Slot} */ (field('slot')?.value ?? meal.slot);
    const matching = filterRecipes(recipes, { query, household }, filterContext).filter((r) => fitsSlot(r, slot));
    let options = matching.slice(0, MAX_CHOICES);
    const currentRecipe = recipesById.get(current);
    if (currentRecipe && !options.includes(currentRecipe)) options = [currentRecipe, ...options];
    const more = matching.length - options.filter((r) => matching.includes(r)).length;
    list.innerHTML = options.length
      ? `${options
          .map(
            (r) => `<label class="check choice"><input type="radio" name="recipe" value="${escapeHtml(r.id)}"${
              r.id === current ? ' checked' : ''
            }${disabled} /> <span>${escapeHtml(r.name)} <span class="hint">${escapeHtml(formatMinutes(totalMinutes(r)))}</span></span></label>`,
          )
          .join('')}${more > 0 ? `<p class="hint">Et ${more} autres recettes : précisez la recherche (nom, ingrédient, cuisine).</p>` : ''}`
      : '<p class="hint">Aucune recette adaptée à ce repas ne correspond à cette recherche.</p>';
  };

  const refresh = () => {
    const draft = readDraft();
    const target = program ? program.meals[draft.slot] : null;
    const values = draft.recipeId ? nutritionByRecipe().get(draft.recipeId) : undefined;
    const followed = program && (program.program.memberId === null || draft.attendees.includes(program.program.memberId));
    if (target && values && followed && program && program.program.method === 'count' && program.program.mealSplit[draft.slot] > 0) {
      const portion = personalPortion(values, target.kcal);
      personalOut.textContent = `Programme minceur : votre portion est de ${formatNumber(portion.portions)} portion (environ ${portion.kcal} kcal pour un objectif de ${target.kcal} kcal). Les grammes sont sur la fiche recette.`;
    } else personalOut.textContent = '';
    nextLunchGroup.hidden = draft.slot !== 'dinner';
    nextLunchBlock.hidden = !draft.nextLunch;
    if (draft.guests < 0 || (draft.nextLunch && draft.nextLunch.guests < 0)) {
      portionsOut.textContent = 'Nombre d’invités invalide.';
      return;
    }
    const p = mealPortionsFor(draft, household);
    portionsOut.textContent = draft.nextLunch
      ? `À cuisiner : ${formatPortions(p.total)} (${formatPortions(p.meal)} ce soir et ${formatPortions(p.nextLunch)} pour le déjeuner du ${formatIsoDay(addDays(draft.date, 1))}).`
      : `À cuisiner : ${formatPortions(p.meal)}.`;
  };

  list.addEventListener('change', (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.name === 'recipe') {
      selectedRecipeId = input.value;
      const recipe = recipesById.get(selectedRecipeId);
      subs = recipe ? (selectedRecipeId === meal.recipeId && existing ? meal.substitutions ?? [] : autoSubs(recipe)) : [];
      renderSubs();
    }
    refresh();
  });
  field('slot')?.addEventListener('change', renderRecipeChoices);
  search.addEventListener('input', () => {
    query = search.value;
    renderRecipeChoices();
  });
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const draft = readDraft();
    const errors = await saveMeal(draft);
    if (errors.length > 0) {
      alertBox.hidden = false;
      alertBox.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
      alertBox.scrollIntoView({ block: 'center' });
      return;
    }
    window.location.replace(`#/planning/semaine/${draft.date}`);
  });

  el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!window.confirm(`Retirer « ${meal.recipeName} » du planning ?`)) return;
    const error = await deleteMeal(meal.id);
    if (error) {
      alertBox.hidden = false;
      alertBox.textContent = error;
      return;
    }
    window.location.replace(`#/planning/semaine/${meal.date}`);
  });

  renderRecipeChoices();
  renderSubs();
  refresh();
}
