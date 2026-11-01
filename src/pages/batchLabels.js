import { escapeHtml } from '../utils/html.js';
import { formatIsoDay, formatIsoDayMonth, formatPortions } from '../utils/format.js';
import { parseIsoDate, toIsoDate, weekDays, weekStart } from '../domain/planning/dates.js';
import { SLOT_NAMES } from '../domain/planning/planning.js';
import { planBatchWeek, batchLabels } from '../domain/batchCooking/batchCooking.js';
import { recipesById, preparationsById, keepingOf } from '../services/catalog.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals } from '../services/planningService.js';
import { batchSessions } from '../services/batchService.js';


/**
 * Etiquettes des boites du batch cooking, a recopier ou a imprimer.
 * Adresse : #/batch/etiquettes/AAAA-MM-JJ
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderBatchLabels(el, params) {
  const today = toIsoDate(new Date());
  const monday = weekStart(params.date && parseIsoDate(params.date) ? params.date : today);
  const days = new Set(weekDays(monday));
  const [allMeals, household, sessions] = await Promise.all([getMeals(), getHousehold(), batchSessions(monday)]);
  const week = planBatchWeek(allMeals.filter((m) => days.has(m.date)), sessions, household, { recipes: recipesById, preparations: preparationsById, keepingOf });
  const labels = batchLabels(week);
  el.innerHTML = `
    <section>
      <h1 class="page-title no-print">Étiquettes des boîtes</h1>
      <p class="hint no-print">Une étiquette par boîte : collez-la ou recopiez-la au marqueur. Semaine du ${escapeHtml(formatIsoDayMonth(monday))}.</p>
      ${
        labels.length
          ? `<p class="no-print"><button type="button" class="button" data-action="print">Imprimer</button> <a class="button button--secondary" href="#/batch/semaine/${monday}">Retour au batch cooking</a></p>
             <div class="labels">${labels
               .map(
                 (l) => `<div class="label label--${l.storage}">
                   <strong class="label__name">${escapeHtml(l.name)}</strong>
                   <span>${escapeHtml(formatPortions(l.portions))} · pour ${escapeHtml(formatIsoDay(l.meal.date))}, ${escapeHtml(SLOT_NAMES.get(l.meal.slot) ?? l.meal.slot)}</span>
                   <span>Cuisiné le ${escapeHtml(formatIsoDay(l.cookedOn))}</span>
                   ${
                     l.storage === 'freezer'
                       ? `<span><strong>Congélateur</strong>, jusqu’au ${escapeHtml(formatIsoDay(l.useBy))} au plus tard</span>
                          <span>Sortir le ${escapeHtml(formatIsoDay(/** @type {string} */ (l.thawOn)))} au soir, décongeler au réfrigérateur</span>`
                       : `<span><strong>Réfrigérateur</strong>, à consommer avant le ${escapeHtml(formatIsoDay(l.useBy))}</span>`
                   }
                 </div>`,
               )
               .join('')}</div>`
          : `<p class="empty">Aucun plat cuisiné à l’avance cette semaine.</p><p><a class="button" href="#/batch/semaine/${monday}">Batch cooking</a></p>`
      }
    </section>`;
  el.querySelector('[data-action="print"]')?.addEventListener('click', () => window.print());
}
