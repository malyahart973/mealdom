import { escapeHtml } from '../utils/html.js';
import { formatIsoDay, formatIsoDayMonth, formatMinutes, formatTime } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { downloadText, calendarStamp } from '../utils/download.js';
import { addDays, parseIsoDate, toIsoDate, weekDays, weekStart } from '../domain/planning/dates.js';
import { SLOTS } from '../domain/planning/planning.js';
import { planBatchWeek, batchCalendarEvents, sessionStart } from '../domain/batchCooking/batchCooking.js';
import { BATCH_DAYS, FREEZER_MONTHS, preparationKeeping, storagePlan } from '../domain/batchCooking/keeping.js';
import { calendarFile } from '../domain/planning/calendar.js';
import { equipmentLabel } from '../domain/recipes/equipment.js';
import { recipesById, preparationsById, ingredientsById, keepingOf } from '../services/catalog.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals, saveMeal } from '../services/planningService.js';
import { getBatchPlan, saveBatchPlan, batchSessions } from '../services/batchService.js';

/** @typedef {import('../domain/batchCooking/batchCooking.js').CookingTask} CookingTask */
/** @typedef {import('../domain/batchCooking/batchCooking.js').BatchDish} BatchDish */
/** @typedef {import('../domain/batchCooking/batchCooking.js').BatchSessionPlan} BatchSessionPlan */
/** @typedef {import('../domain/planning/planning.js').Meal} Meal */

const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label.toLowerCase()]));

/** @param {{ date: string, slot: import('../domain/planning/planning.js').Slot }} m */
const mealWhen = (m) => `${formatIsoDay(m.date)}, ${slotLabels.get(m.slot) ?? m.slot}`;

/**
 * Ecran Batch cooking : les seances de la semaine (plats entiers et preparations de base),
 * comment garder chaque plat jusqu'au repas, et ce qui se cuisine le jour meme.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderBatch(el, params) {
  const today = toIsoDate(new Date());
  const monday = weekStart(params.date && parseIsoDate(params.date) ? params.date : today);
  const days = new Set(weekDays(monday));
  const [allMeals, household, plan, sessions] = await Promise.all([getMeals(), getHousehold(), getBatchPlan(), batchSessions(monday)]);
  const meals = allMeals.filter((m) => days.has(m.date));
  const week = planBatchWeek(meals, sessions, household, { recipes: recipesById, preparations: preparationsById, keepingOf });

  /**
   * Comment garder chaque part jusqu'a son repas.
   * @param {BatchDish} d
   */
  const storageHtml = (d) =>
    d.servings
      .map((sv) => {
        const who = `<strong>${escapeHtml(mealWhen(sv.meal))}</strong>${sv.meal.nextLunch ? ' et restes du lendemain midi' : ''} (${sv.portions} portion${sv.portions > 1 ? 's' : ''})`;
        const how =
          sv.storage === 'freezer'
            ? `congélateur dès que le plat a refroidi, à sortir ${escapeHtml(formatIsoDay(/** @type {string} */ (sv.thawOn)))} soir.`
            : 'réfrigérateur jusqu’au repas.';
        return `<div class="keep keep--${sv.storage}"><p>${who} : ${how}</p>
          <button type="button" class="button button--small button--secondary" data-same-day="${escapeHtml(sv.meal.id)}">Le cuisiner plutôt le jour même</button></div>`;
      })
      .join('');

  /**
   * @param {CookingTask} task
   * @param {BatchSessionPlan} s
   */
  const taskHtml = (task, s) => {
    const dish = s.dishes.find((d) => `plat:${d.recipe.id}` === task.preparationId);
    const methodHtml = task.method
      ? `<p class="hint">${escapeHtml(task.method.label)}, matériel : ${escapeHtml(task.method.equipment.length ? task.method.equipment.map(equipmentLabel).join(', ') : 'aucun')}. Préparation ${escapeHtml(formatMinutes(task.prepMinutes))}, cuisson ${escapeHtml(formatMinutes(task.cookMinutes))}.</p>`
      : '<p class="error">Aucun matériel coché dans votre foyer ne permet de faire cette recette.</p>';
    const details = task.method
      ? `<details class="prep">
          <summary>Ingrédients et étapes</summary>
          <ul class="ingredients">${task.ingredients
            .map((l) => `<li><span class="ingredients__qty">${escapeHtml(formatQuantity(l.quantity, l.unit))}</span> <span>${escapeHtml(ingredientsById.get(l.ingredientId)?.name ?? l.ingredientId)}</span></li>`)
            .join('')}</ul>
          <ol class="steps">${task.method.steps.map((st) => `<li>${escapeHtml(st)}</li>`).join('')}</ol>
          ${dish ? `<p><a href="#/recettes/${encodeURIComponent(dish.recipe.id)}">Voir la recette complète</a></p>` : ''}
        </details>`
      : '';
    if (dish) {
      return `<li class="task">
        <h3 class="task__title">${escapeHtml(task.name)} <span class="task__qty">${task.quantity} portion${task.quantity > 1 ? 's' : ''}</span></h3>
        ${dish.servings.length > 1 ? `<span class="tag">Cuisiné une fois pour ${dish.servings.length} repas</span>` : ''}
        ${storageHtml(dish)}
        ${methodHtml}
        <p><a class="button button--small button--secondary" href="#/recettes/${encodeURIComponent(dish.recipe.id)}/cuisiner/${dish.portions}">Cuisiner pas à pas</a></p>
        ${details}
      </li>`;
    }
    const req = s.requirements.find((r) => r.preparationId === task.preparationId);
    const prep = preparationsById.get(task.preparationId);
    const keeping = prep ? preparationKeeping(prep) : null;
    const uses = (req?.uses ?? [])
      .map((u) => {
        const frozen = keeping ? storagePlan(keeping, s.date, u.date).storage === 'freezer' : false;
        return `<li>${escapeHtml(mealWhen(u))} : ${escapeHtml(u.recipeName)} <span class="hint">(${escapeHtml(formatQuantity(u.quantity, task.unit))}${frozen ? ', à congeler' : ''})</span></li>`;
      })
      .join('');
    return `<li class="task">
      <h3 class="task__title">${escapeHtml(task.name)} <span class="task__qty">${escapeHtml(formatQuantity(task.quantity, task.unit))}</span></h3>
      <span class="tag">Base${task.uses > 1 ? ` pour ${task.uses} repas` : ''}</span>
      <ul class="task__uses">${uses}</ul>
      ${keeping ? `<p class="hint">${escapeHtml(keeping.note)} Se garde ${keeping.fridgeDays} jours au frais${keeping.freezes ? ', se congèle' : ''}.</p>` : ''}
      ${methodHtml}${details}
    </li>`;
  };

  /** @param {BatchSessionPlan} s */
  const sessionHtml = (s) => {
    const names = new Map(s.session.tasks.map((t) => [t.preparationId, t.name.toLowerCase()]));
    const mealCount = new Set([...s.dishes.flatMap((d) => d.servings.map((sv) => sv.meal.id)), ...s.requirements.flatMap((r) => r.uses.map((u) => u.mealId))]).size;
    const parts = [
      s.dishes.length ? `${s.dishes.length} plat${s.dishes.length > 1 ? 's' : ''}` : '',
      s.requirements.length ? `${s.requirements.length} base${s.requirements.length > 1 ? 's' : ''}` : '',
    ].filter(Boolean);
    return `<section class="batch-session">
      <h2>Séance du ${escapeHtml(formatIsoDay(s.date))} <span class="hint">vers ${escapeHtml(formatTime(sessionStart(s.date)))}</span></h2>
      <div class="batch-summary">
        <p><strong>${escapeHtml(parts.join(' et '))} pour ${mealCount} repas.</strong></p>
        <p>Environ ${escapeHtml(formatMinutes(s.session.estimatedMinutes))} en lançant les cuissons en même temps${
          s.session.estimatedMinutes < s.session.sequentialMinutes ? `, au lieu de ${escapeHtml(formatMinutes(s.session.sequentialMinutes))} en les enchaînant` : ''
        }.</p>
        ${s.session.parallelGroups.map((g) => `<p>En même temps : ${escapeHtml(g.map((id) => names.get(id) ?? id).join(' et '))}.</p>`).join('')}
      </div>
      <p class="hint">Commencez par ce qui cuit le plus longtemps : l’ordre ci-dessous le respecte.</p>
      <ol class="tasks">${s.session.tasks.map((t) => taskHtml(t, s)).join('')}</ol>
    </section>`;
  };

  const planForm = `<form class="batch-plan" data-form="plan">
      <fieldset class="field"><legend>Jour de la séance</legend>
        <div class="radios">${BATCH_DAYS.map((d) => `<label class="check"><input type="radio" name="batch-day" value="${d.id}"${d.id === plan.day ? ' checked' : ''} /> <span>${escapeHtml(d.label)}</span></label>`).join('')}</div>
        <label class="check"><input type="checkbox" name="midweek"${plan.midweek ? ' checked' : ''} /> <span>Deuxième séance le mercredi soir</span></label>
      </fieldset>
    </form>`;

  const thawCount = week.sessions.reduce((n, s) => n + s.dishes.flatMap((d) => d.servings).filter((sv) => sv.thawOn).length, 0);
  const hasWork = week.sessions.length > 0;

  el.innerHTML = `
    <section>
      <h1 class="page-title">Batch cooking</h1>
      <nav class="week-nav" aria-label="Changer de semaine">
        <a href="#/batch/semaine/${addDays(monday, -7)}" aria-label="Semaine précédente">‹</a>
        <span>Semaine du ${escapeHtml(formatIsoDayMonth(monday))}</span>
        <a href="#/batch/semaine/${addDays(monday, 7)}" aria-label="Semaine suivante">›</a>
      </nav>
      ${planForm}
      ${week.problems.map((p) => `<p class="error">${escapeHtml(p)}</p>`).join('')}
      ${
        meals.length === 0
          ? `<p class="empty">Aucun repas planifié cette semaine.</p>
             <p><a class="button" href="#/assistant/planifier/${monday}">Planifier ma semaine</a></p>
             <p class="hint">Choisissez l’envie « Batch cooking » : je proposerai des plats qui se gardent jusqu’au jour du repas.</p>`
          : !hasWork
            ? `<p class="empty">Aucun repas de cette semaine ne se prépare à l’avance.</p>
               <p><a class="button" href="#/assistant/planifier/${monday}">Planifier ma semaine en batch cooking</a></p>
               <p class="hint">Dans « Planifier ma semaine », choisissez l’envie « Batch cooking » et « Tout refaire ».</p>`
            : `${week.sessions.map(sessionHtml).join('')}
               <div class="form-actions">
                 <button type="button" class="button" data-action="calendar">Ajouter à mon agenda</button>
               </div>
               <p class="hint">${thawCount ? `La séance et ${thawCount} rappel${thawCount > 1 ? 's' : ''} pour sortir un plat du congélateur la veille au soir.` : 'La séance, avec un rappel une heure avant.'}</p>`
      }
      ${
        week.sameDay.length
          ? `<h2>À cuisiner le jour même</h2>
             <ul class="task__uses">${week.sameDay
               .map(
                 (x) => `<li><strong>${escapeHtml(mealWhen(x.meal))}</strong> : ${escapeHtml(x.meal.recipeName)}<br /><span class="hint">${escapeHtml(x.note)}</span>
                   ${x.meal.cookSameDay ? `<br /><button type="button" class="button button--small button--secondary" data-to-batch="${escapeHtml(x.meal.id)}">Le préparer pendant la séance</button>` : ''}</li>`,
               )
               .join('')}</ul>`
          : ''
      }
      ${
        hasWork
          ? `<div class="notice-inline">
              <p><strong>Bien conserver</strong></p>
              <ul>
                <li>Laissez refroidir moins de 2 heures, couvrez, puis rangez au réfrigérateur (4 °C au plus) ou au congélateur.</li>
                <li>Au congélateur : ${FREEZER_MONTHS} mois au plus, avec la date sur la boîte. Décongelez au réfrigérateur, la veille.</li>
                <li>Réchauffez à cœur, une seule fois. Ne recongelez pas un plat décongelé.</li>
                <li>Les durées sont des repères prudents : en cas de doute, congelez.</li>
              </ul>
            </div>`
          : ''
      }
    </section>
  `;

  el.querySelector('[data-form="plan"]')?.addEventListener('change', async () => {
    const form = /** @type {HTMLFormElement} */ (el.querySelector('[data-form="plan"]'));
    const data = new FormData(form);
    const day = BATCH_DAYS.find((d) => d.id === data.get('batch-day'))?.id ?? plan.day;
    await saveBatchPlan({ day, midweek: data.get('midweek') === 'on' });
    await renderBatch(el, params);
  });

  // Choix par repas : seance de batch ou jour meme.
  el.querySelectorAll('[data-same-day], [data-to-batch]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.getAttribute('data-same-day') ?? b.getAttribute('data-to-batch');
      const target = meals.find((m) => m.id === id);
      if (!target) return;
      const errors = await saveMeal({ ...target, cookSameDay: b.hasAttribute('data-same-day') });
      if (errors.length) window.alert(errors.join('\n'));
      await renderBatch(el, params);
    }),
  );

  el.querySelector('[data-action="calendar"]')?.addEventListener('click', () => {
    const text = calendarFile('Batch', batchCalendarEvents(week, (/** @type {Meal} */ m) => mealWhen(m)), calendarStamp());
    downloadText(text, `batch-${monday}.ics`, 'text/calendar;charset=utf-8');
  });
}
