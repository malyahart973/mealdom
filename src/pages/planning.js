import { escapeHtml } from '../utils/html.js';
import { formatIsoDay, formatIsoDayMonth, formatPortions } from '../utils/format.js';
import { addDays, toIsoDate, weekDays, weekStart, parseIsoDate } from '../domain/planning/dates.js';
import { SLOTS, mealPortionsFor, planningGrid } from '../domain/planning/planning.js';
import { getMeals, getShowBreakfast, setShowBreakfast } from '../services/planningService.js';
import { getHousehold } from '../services/householdService.js';

/** @typedef {import('../domain/planning/planning.js').PlannedEntry} PlannedEntry */
/** @typedef {import('../domain/household/household.js').Household} Household */

const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label]));

/**
 * @param {PlannedEntry} entry
 * @param {Household} household
 * @returns {string}
 */
function entryHtml(entry, household) {
  const href = `#/planning/repas/${encodeURIComponent(entry.meal.id)}`;
  if (entry.kind === 'leftover') {
    return `<a class="slot__meal slot__meal--leftover" href="${href}">
      <span class="slot__name">${escapeHtml(entry.meal.recipeName)}</span>
      <span class="slot__meta">Restes du dîner, ${escapeHtml(formatPortions(mealPortionsFor(entry.meal, household).nextLunch))}</span>
    </a>`;
  }
  const portions = mealPortionsFor(entry.meal, household);
  const extra = entry.meal.nextLunch ? `, à cuisiner ${formatPortions(portions.total)} avec le déjeuner de demain` : '';
  return `<a class="slot__meal" href="${href}">
    <span class="slot__name">${escapeHtml(entry.meal.recipeName)}${entry.meal.locked ? ' <span class="lock">Verrouillé</span>' : ''}</span>
    <span class="slot__meta">${escapeHtml(formatPortions(portions.meal) + extra)}</span>
  </a>`;
}

/**
 * Ecran Planning : une semaine, du lundi au dimanche.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderPlanning(el, params) {
  const today = toIsoDate(new Date());
  const monday = weekStart(params.date && parseIsoDate(params.date) ? params.date : today);
  const [meals, household, showBreakfast] = await Promise.all([getMeals(), getHousehold(), getShowBreakfast()]);

  if (household.members.length === 0) {
    el.innerHTML = `
      <section>
        <h1 class="page-title">Planning</h1>
        <p>Pour calculer les portions, MealDom doit savoir qui mange à la maison.</p>
        <a class="button" href="#/foyer">Présenter mon foyer</a>
      </section>`;
    return;
  }

  const slots = SLOTS.filter((s) => showBreakfast || s.id !== 'breakfast').map((s) => s.id);
  const grid = planningGrid(meals, weekDays(monday), slots);

  el.innerHTML = `
    <section>
      <h1 class="page-title">Planning</h1>
      <nav class="week-nav" aria-label="Changer de semaine">
        <a href="#/planning/semaine/${addDays(monday, -7)}" aria-label="Semaine précédente">‹</a>
        <span>Semaine du ${escapeHtml(formatIsoDayMonth(monday))}</span>
        <a href="#/planning/semaine/${addDays(monday, 7)}" aria-label="Semaine suivante">›</a>
      </nav>
      ${monday !== weekStart(today) ? '<p class="week-today"><a href="#/planning">Revenir à cette semaine</a></p>' : ''}
      <p class="actions"><a class="button button--secondary" href="#/batch/semaine/${monday}">Préparer la semaine en batch cooking</a></p>
      <ol class="week">
        ${grid
          .map(
            (day) => `
          <li class="day${day.date === today ? ' day--today' : ''}">
            <h2 class="day__title">${escapeHtml(formatIsoDay(day.date))}</h2>
            <dl class="day__slots">
              ${day.slots
                .map(
                  ({ slot, entry }) => `
                <div class="slot">
                  <dt>${escapeHtml(slotLabels.get(slot) ?? slot)}</dt>
                  <dd>${
                    entry
                      ? entryHtml(entry, household)
                      : `<a class="slot__add" href="#/planning/ajouter/${day.date}/${slot}">Ajouter un repas</a>`
                  }</dd>
                </div>`,
                )
                .join('')}
            </dl>
          </li>`,
          )
          .join('')}
      </ol>
      <label class="check"><input type="checkbox" data-action="breakfast"${showBreakfast ? ' checked' : ''} /> <span>Planifier aussi le petit-déjeuner</span></label>
    </section>
  `;

  el.querySelector('[data-action="breakfast"]')?.addEventListener('change', async (event) => {
    await setShowBreakfast(/** @type {HTMLInputElement} */ (event.target).checked);
    await renderPlanning(el, params);
  });
}
