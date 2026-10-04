import { escapeHtml } from '../utils/html.js';
import { formatIsoDay, formatIsoDayMonth, formatMinutes } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { addDays, parseIsoDate, toIsoDate, weekDays, weekStart } from '../domain/planning/dates.js';
import { SLOTS } from '../domain/planning/planning.js';
import { buildCookingSession, preparationRequirements } from '../domain/batchCooking/batchCooking.js';
import { equipmentLabel } from '../domain/recipes/equipment.js';
import { recipesById, preparationsById, ingredientsById } from '../services/catalog.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals } from '../services/planningService.js';

const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label.toLowerCase()]));

/**
 * Ecran Batch cooking : les preparations a faire a l'avance pour une semaine.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderBatch(el, params) {
  const today = toIsoDate(new Date());
  const monday = weekStart(params.date && parseIsoDate(params.date) ? params.date : today);
  const days = new Set(weekDays(monday));
  const [allMeals, household] = await Promise.all([getMeals(), getHousehold()]);
  const meals = allMeals.filter((m) => days.has(m.date));

  const { requirements, problems } = preparationRequirements(meals, household, recipesById, preparationsById);
  const session = buildCookingSession(requirements, preparationsById, household.equipment);
  const names = new Map(session.tasks.map((t) => [t.preparationId, t.name.toLowerCase()]));
  const mealCount = new Set(requirements.flatMap((r) => r.uses.map((u) => u.mealId))).size;

  const tasksHtml = session.tasks
    .map((task) => {
      const req = requirements.find((r) => r.preparationId === task.preparationId);
      const uses = (req?.uses ?? [])
        .map(
          (u) =>
            `<li>${escapeHtml(formatIsoDay(u.date))}, ${escapeHtml(slotLabels.get(u.slot) ?? u.slot)} : ${escapeHtml(
              u.recipeName,
            )} <span class="hint">(${escapeHtml(formatQuantity(u.quantity, task.unit))})</span></li>`,
        )
        .join('');
      return `
      <li class="task">
        <h2 class="task__title">${escapeHtml(task.name)} <span class="task__qty">${escapeHtml(formatQuantity(task.quantity, task.unit))}</span></h2>
        ${task.uses > 1 ? `<span class="tag">Sert pour ${task.uses} repas</span>` : ''}
        <ul class="task__uses">${uses}</ul>
        ${
          task.method
            ? `<p class="hint">${escapeHtml(task.method.label)}, matériel : ${escapeHtml(
                task.method.equipment.length ? task.method.equipment.map(equipmentLabel).join(', ') : 'aucun',
              )}. Préparation ${escapeHtml(formatMinutes(task.prepMinutes))}, cuisson ${escapeHtml(formatMinutes(task.cookMinutes))}.</p>
            <details class="prep">
              <summary>Ingrédients et étapes</summary>
              <ul class="ingredients">${task.ingredients
                .map(
                  (l) => `<li><span class="ingredients__qty">${escapeHtml(formatQuantity(l.quantity, l.unit))}</span>
                    <span>${escapeHtml(ingredientsById.get(l.ingredientId)?.name ?? l.ingredientId)}</span></li>`,
                )
                .join('')}</ul>
              <ol class="steps">${task.method.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
            </details>`
            : '<p class="error">Aucun matériel coché dans votre foyer ne permet de faire cette préparation.</p>'
        }
      </li>`;
    })
    .join('');

  el.innerHTML = `
    <section>
      <h1 class="page-title">Batch cooking</h1>
      <nav class="week-nav" aria-label="Changer de semaine">
        <a href="#/batch/semaine/${addDays(monday, -7)}" aria-label="Semaine précédente">‹</a>
        <span>Semaine du ${escapeHtml(formatIsoDayMonth(monday))}</span>
        <a href="#/batch/semaine/${addDays(monday, 7)}" aria-label="Semaine suivante">›</a>
      </nav>
      ${problems.map((p) => `<p class="error">${escapeHtml(p)}</p>`).join('')}
      ${
        session.tasks.length === 0
          ? `<p class="empty">Aucun repas de cette semaine n’utilise de préparation à faire à l’avance.</p>
             <p>Planifiez par exemple un colombo, un chili ou des tacos au poulet effiloché : le riz cuit et le poulet effiloché pourront être préparés en une fois.</p>
             <p><a class="button" href="#/planning/semaine/${monday}">Ouvrir le planning</a></p>`
          : `<div class="batch-summary">
              <p><strong>${session.tasks.length} préparation${session.tasks.length > 1 ? 's' : ''} pour ${mealCount} repas.</strong></p>
              <p>Environ ${escapeHtml(formatMinutes(session.estimatedMinutes))} en lançant les cuissons en même temps${
                session.estimatedMinutes < session.sequentialMinutes
                  ? `, au lieu de ${escapeHtml(formatMinutes(session.sequentialMinutes))} en les enchaînant`
                  : ''
              }.</p>
              ${session.parallelGroups
                .map((g) => `<p>En même temps : ${escapeHtml(g.map((id) => names.get(id) ?? id).join(' et '))}.</p>`)
                .join('')}
            </div>
            <p class="hint">Commencez par ce qui cuit le plus longtemps : l’ordre ci-dessous le respecte.</p>
            <ol class="tasks">${tasksHtml}</ol>
            <div class="notice-inline">
              <p><strong>Conservation</strong></p>
              <p>MealDom ne calcule pas encore les durées de conservation. Pour les repas de fin de semaine, congelez la part correspondante dès qu’elle a refroidi, ou faites une deuxième session en milieu de semaine.</p>
            </div>`
      }
    </section>
  `;
}
