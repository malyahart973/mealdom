import { escapeHtml } from '../utils/html.js';
import { formatIsoDay, formatIsoDayMonth, formatPortions } from '../utils/format.js';
import { addDays, toIsoDate, weekDays, weekStart, parseIsoDate } from '../domain/planning/dates.js';
import { SLOTS, mealPortionsFor, planningGrid } from '../domain/planning/planning.js';
import { getMeals, getShowBreakfast, setShowBreakfast, getShowSnack, setShowSnack } from '../services/planningService.js';
import { mountAssistant } from './assistantPanel.js';
import { getHousehold } from '../services/householdService.js';

/** @typedef {import('../domain/planning/planning.js').PlannedEntry} PlannedEntry */
/** @typedef {import('../domain/household/household.js').Household} Household */

const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label]));

/** L'assistant reste ouvert pendant la navigation dans le planning. */
let assistantOpen = false;

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
    <span class="slot__name">${escapeHtml(entry.meal.recipeName)}${entry.meal.locked ? ' <span class="lock">Verrouillé</span>' : ''}${entry.meal.substitutions?.length ? ' <span class="tag">Ingrédient remplacé</span>' : ''}</span>
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
  const [meals, household, showBreakfast, showSnack] = await Promise.all([getMeals(), getHousehold(), getShowBreakfast(), getShowSnack()]);

  if (household.members.length === 0) {
    el.innerHTML = `
      <section>
        <h1 class="page-title">Planning</h1>
        <p>Pour calculer les portions, MealDom doit savoir qui mange à la maison.</p>
        <a class="button" href="#/foyer">Présenter mon foyer</a>
      </section>`;
    return;
  }

  const slots = SLOTS.filter((s) => (showBreakfast || s.id !== 'breakfast') && (showSnack || s.id !== 'snack')).map((s) => s.id);
  const grid = planningGrid(meals, weekDays(monday), slots);

  el.innerHTML = `
    <div class="planning-layout${assistantOpen ? ' planning-layout--assistant' : ''}">
    <section class="planning-layout__main">
      <h1 class="page-title">Planning</h1>
      <p class="actions"><button type="button" class="button" data-action="assistant" aria-expanded="${assistantOpen}">${assistantOpen ? 'Fermer l’assistant' : 'Parler à l’assistant'}</button></p>
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
      <label class="check"><input type="checkbox" data-action="snack"${showSnack ? ' checked' : ''} /> <span>Planifier aussi le goûter</span></label>
    </section>
    <aside class="planning-layout__assistant" data-assistant${assistantOpen ? '' : ' hidden'} aria-label="Assistant"></aside>
    </div>
  `;

  el.querySelector('[data-action="breakfast"]')?.addEventListener('change', async (event) => {
    await setShowBreakfast(/** @type {HTMLInputElement} */ (event.target).checked);
    await renderPlanning(el, params);
  });
  el.querySelector('[data-action="snack"]')?.addEventListener('change', async (event) => {
    await setShowSnack(/** @type {HTMLInputElement} */ (event.target).checked);
    await renderPlanning(el, params);
  });

  const dock = /** @type {HTMLElement} */ (el.querySelector('[data-assistant]'));
  const openAssistant = () => mountAssistant(dock, { monday, onPlanChange: () => refreshGrid(el, params) });
  el.querySelector('[data-action="assistant"]')?.addEventListener('click', async () => {
    assistantOpen = !assistantOpen;
    await renderPlanning(el, params);
    if (assistantOpen) dock.scrollIntoView({ block: 'start' });
  });
  if (assistantOpen) await openAssistant();
}

/**
 * Apres un changement accepte : seule la grille de la semaine est redessinee,
 * la conversation reste a l'ecran.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
async function refreshGrid(el, params) {
  const holder = document.createElement('div');
  const keep = assistantOpen;
  assistantOpen = false;
  await renderPlanning(holder, params);
  assistantOpen = keep;
  const fresh = holder.querySelector('.week');
  const current = el.querySelector('.week');
  if (fresh && current) current.replaceWith(fresh);
}
