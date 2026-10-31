import { escapeHtml } from '../utils/html.js';
import { formatPortions, formatClock, formatIsoDay } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { SLOTS, mealPortionsFor } from '../domain/planning/planning.js';
import { applySubstitutions } from '../domain/recipes/recipes.js';
import { equipmentLabel } from '../domain/recipes/equipment.js';
import { scaledLines, cookingMethods, stepTimers, clampPortions } from '../domain/recipes/cooking.js';
import { recipesById, ingredientsById, preparationsById } from '../services/catalog.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals } from '../services/planningService.js';
import { getTimers, remaining, onTimersChange, startTimer, togglePause, addTime, removeTimer, keepScreenOn, releaseScreen } from '../services/cookService.js';

/** @typedef {import('../domain/recipes/recipes.js').Recipe} Recipe */

const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label.toLowerCase()]));

/**
 * Mode cuisine pas a pas.
 * Adresses : #/recettes/<id>/cuisiner[/<portions>] et #/planning/repas/<id>/cuisiner (portions du repas).
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderCook(el, params) {
  const household = await getHousehold();
  /** @type {Recipe | undefined} */
  let recipe;
  let portions = 0;
  let backHref = '';
  let context = '';
  if (params.mealId) {
    const meal = (await getMeals()).find((m) => m.id === params.mealId);
    const base = meal ? recipesById.get(meal.recipeId) : undefined;
    if (meal && base) {
      recipe = applySubstitutions(base, meal.substitutions ?? []);
      portions = mealPortionsFor(meal, household).total;
      backHref = `#/planning/repas/${encodeURIComponent(meal.id)}`;
      context = `${formatIsoDay(meal.date)}, ${slotLabels.get(meal.slot) ?? meal.slot}${meal.nextLunch ? ' (avec le déjeuner du lendemain)' : ''}`;
    }
  } else {
    recipe = recipesById.get(params.id ?? '');
    portions = params.portions ? Number(params.portions.replace(',', '.')) : recipe?.servings ?? 0;
    backHref = `#/recettes/${encodeURIComponent(params.id ?? '')}`;
  }
  if (!recipe) {
    el.innerHTML = `<section><h1 class="page-title">Recette introuvable</h1><p><a class="button" href="#/recettes">Voir les recettes</a></p></section>`;
    return;
  }
  const current = recipe;
  portions = clampPortions(portions);
  const { methods, allCompatible } = cookingMethods(current, household.equipment);
  let methodIndex = 0;
  // Etape 0 : ingredients (mise en place) ; puis une etape par ecran ; puis « c'est pret ».
  let step = 0;
  /** @type {Set<string>} */
  const checked = new Set();

  el.innerHTML = `
    <section class="cook">
      <h1 class="page-title cook__title">${escapeHtml(current.name)}</h1>
      ${context ? `<p class="hint">${escapeHtml(context)}</p>` : ''}
      <div class="cook__bar">
        <div class="cook__portions" role="group" aria-label="Nombre de portions">
          <button type="button" class="button button--small button--secondary" data-portions="-0.5" aria-label="Une demi-portion de moins">−</button>
          <span data-portions-out aria-live="polite"></span>
          <button type="button" class="button button--small button--secondary" data-portions="0.5" aria-label="Une demi-portion de plus">+</button>
        </div>
        ${
          methods.length > 1
            ? `<label class="cook__method"><span class="visually-hidden">Méthode</span><select data-method>${methods.map((m, i) => `<option value="${i}">${escapeHtml(m.label)}</option>`).join('')}</select></label>`
            : ''
        }
      </div>
      ${allCompatible ? '' : '<p class="notice-inline">Aucune méthode ne correspond au matériel coché dans votre foyer : toutes sont proposées.</p>'}
      <p class="hint" data-wake></p>
      <div class="cook__progress" aria-hidden="true"><div data-progress></div></div>
      <p class="cook__count" data-count></p>
      <div class="cook__step" data-step aria-live="polite"></div>
      <div class="cook__nav">
        <button type="button" class="button button--secondary" data-prev>Précédent</button>
        <button type="button" class="button" data-next>Suivant</button>
      </div>
      <div class="cook__timers" data-timers></div>
    </section>`;

  const stepBox = /** @type {HTMLElement} */ (el.querySelector('[data-step]'));
  const prev = /** @type {HTMLButtonElement} */ (el.querySelector('[data-prev]'));
  const next = /** @type {HTMLButtonElement} */ (el.querySelector('[data-next]'));
  const timersBox = /** @type {HTMLElement} */ (el.querySelector('[data-timers]'));

  const method = () => methods[methodIndex];
  const lastStep = () => method().steps.length + 1;

  const ingredientsHtml = () => {
    const lines = scaledLines(current, portions);
    const items = [
      ...lines.preparations.map((l) => ({ key: `p:${l.preparationId}`, qty: formatQuantity(l.quantity, l.unit), name: `${(preparationsById.get(l.preparationId)?.name ?? l.preparationId).toLowerCase()} (préparé à l’avance)`, note: '' })),
      ...lines.ingredients.map((l) => ({ key: `i:${l.ingredientId}`, qty: formatQuantity(l.quantity, l.unit), name: ingredientsById.get(l.ingredientId)?.name ?? l.ingredientId, note: l.note ?? '' })),
    ];
    return `<h2>Ingrédients pour ${escapeHtml(formatPortions(portions))}</h2>
      <p class="hint">Sortez tout avant de commencer. Touchez un ingrédient pour le cocher.</p>
      <ul class="cook__checklist">${items
        .map(
          (it) => `<li><label class="check"><input type="checkbox" data-check="${escapeHtml(it.key)}"${checked.has(it.key) ? ' checked' : ''} />
            <span><strong>${escapeHtml(it.qty)}</strong> ${escapeHtml(it.name)}${it.note ? ` <span class="hint">(${escapeHtml(it.note)})</span>` : ''}</span></label></li>`,
        )
        .join('')}</ul>
      <p class="hint">Matériel : ${escapeHtml(method().equipment.length ? method().equipment.map(equipmentLabel).join(', ') : 'aucun')}.</p>
      ${Math.abs(portions - current.servings) > 0.01 ? `<p class="hint">Les quantités citées dans les étapes sont prévues pour ${escapeHtml(formatPortions(current.servings))} : suivez plutôt cette liste.</p>` : ''}`;
  };

  const render = () => {
    const total = lastStep();
    /** @type {HTMLElement} */ (el.querySelector('[data-portions-out]')).textContent = formatPortions(portions);
    /** @type {HTMLElement} */ (el.querySelector('[data-progress]')).style.width = `${Math.round((step / total) * 100)}%`;
    /** @type {HTMLElement} */ (el.querySelector('[data-count]')).textContent =
      step === 0 ? 'Mise en place' : step === total ? 'Terminé' : `Étape ${step} sur ${total - 1}`;
    if (step === 0) stepBox.innerHTML = ingredientsHtml();
    else if (step === total) {
      stepBox.innerHTML = `<p class="cook__text">C’est prêt. Bon appétit !</p>
        <p><a class="button" href="${backHref}">Terminer</a></p>`;
    } else {
      const text = method().steps[step - 1];
      const timers = stepTimers(text);
      stepBox.innerHTML = `<p class="cook__text">${escapeHtml(text)}</p>
        ${timers.map((t) => `<button type="button" class="button cook__timer-start" data-start="${t.seconds}" data-label="${escapeHtml(t.label)}">Minuteur ${escapeHtml(t.label)}</button>`).join(' ')}`;
    }
    prev.disabled = step === 0;
    next.hidden = step === total;
    next.textContent = step === 0 ? 'Commencer' : step === total - 1 ? 'Terminer' : 'Suivant';
  };

  const renderTimers = () => {
    const list = getTimers();
    timersBox.hidden = list.length === 0;
    timersBox.innerHTML = list
      .map(
        (t) => `<div class="cook__timer${t.done ? ' cook__timer--done' : ''}" role="${t.done ? 'alert' : 'timer'}">
          <span class="cook__timer-label">${escapeHtml(t.label)}</span>
          <span class="cook__timer-time">${t.done ? 'Terminé' : escapeHtml(formatClock(remaining(t)))}</span>
          <span class="cook__timer-actions">
            ${t.done ? '' : `<button type="button" class="button button--small button--secondary" data-pause="${t.id}">${t.pausedLeft === null ? 'Pause' : 'Reprendre'}</button>`}
            <button type="button" class="button button--small button--secondary" data-plus="${t.id}">+1 min</button>
            <button type="button" class="button button--small button--secondary" data-stop="${t.id}" aria-label="Arrêter le minuteur ${escapeHtml(t.label)}">✕</button>
          </span>
        </div>`,
      )
      .join('');
  };

  el.querySelectorAll('[data-portions]').forEach((b) =>
    b.addEventListener('click', () => {
      portions = clampPortions(portions + Number(b.getAttribute('data-portions')));
      render();
    }),
  );
  el.querySelector('[data-method]')?.addEventListener('change', (event) => {
    methodIndex = Number(/** @type {HTMLSelectElement} */ (event.target).value);
    step = Math.min(step, lastStep());
    render();
  });
  prev.addEventListener('click', () => {
    step = Math.max(0, step - 1);
    render();
  });
  next.addEventListener('click', () => {
    step = Math.min(lastStep(), step + 1);
    render();
    window.scrollTo({ top: 0 });
  });
  stepBox.addEventListener('change', (event) => {
    const key = /** @type {HTMLElement} */ (event.target).getAttribute('data-check');
    if (!key) return;
    if (/** @type {HTMLInputElement} */ (event.target).checked) checked.add(key);
    else checked.delete(key);
  });
  stepBox.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-start]');
    if (!button) return;
    startTimer(`${current.name.length > 28 ? `${current.name.slice(0, 27)}…` : current.name} · ${button.getAttribute('data-label') ?? ''}`, Number(button.getAttribute('data-start')));
  });
  timersBox.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const pause = target.getAttribute('data-pause');
    const plus = target.getAttribute('data-plus');
    const stop = target.getAttribute('data-stop');
    if (pause) togglePause(pause);
    if (plus) addTime(plus, 60);
    if (stop) removeTimer(stop);
  });
  // Fleches du clavier (tablette, ordinateur).
  const onKey = (/** @type {KeyboardEvent} */ event) => {
    if (/** @type {HTMLElement} */ (event.target).closest('input, select, textarea')) return;
    if (event.key === 'ArrowRight' && !next.hidden) next.click();
    if (event.key === 'ArrowLeft' && !prev.disabled) prev.click();
  };
  document.addEventListener('keydown', onKey);

  const unsubscribe = onTimersChange(renderTimers);
  const wake = /** @type {HTMLElement} */ (el.querySelector('[data-wake]'));
  keepScreenOn().then((ok) => {
    wake.textContent = ok ? 'L’écran reste allumé pendant que vous cuisinez.' : 'Votre téléphone peut éteindre l’écran : touchez-le de temps en temps.';
  });
  // En quittant le mode cuisine : l'ecran peut de nouveau s'eteindre, les minuteurs continuent.
  window.addEventListener(
    'hashchange',
    () => {
      unsubscribe();
      document.removeEventListener('keydown', onKey);
      releaseScreen();
    },
    { once: true },
  );

  render();
  renderTimers();
}
