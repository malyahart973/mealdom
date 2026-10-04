import { formatDayLong } from '../utils/format.js';
import { escapeHtml } from '../utils/html.js';
import { exportData, isReminderDue } from '../services/backupService.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals } from '../services/planningService.js';
import { SLOTS, plannedEntries, slotKey, mealPortionsFor } from '../domain/planning/planning.js';
import { toIsoDate } from '../domain/planning/dates.js';
import { formatPortions } from '../utils/format.js';

/**
 * Ecran Accueil.
 * @param {HTMLElement} el
 */
export async function renderHome(el) {
  const today = formatDayLong(new Date());
  const [reminder, household, meals] = await Promise.all([isReminderDue(), getHousehold(), getMeals()]);
  const todayIso = toIsoDate(new Date());
  const entries = plannedEntries(meals);
  const todayMeals = SLOTS.map((s) => ({ slot: s, entry: entries.get(slotKey(todayIso, s.id)) })).filter((x) => x.entry);

  el.innerHTML = `
    <section class="today">
      <h1 class="today__date">${escapeHtml(today)}</h1>
      ${
        todayMeals.length
          ? `<ul class="today__meals">${todayMeals
              .map(({ slot, entry }) => {
                if (!entry) return '';
                const portions = mealPortionsFor(entry.meal, household);
                const detail =
                  entry.kind === 'leftover'
                    ? `restes du dîner d’hier, ${formatPortions(portions.nextLunch)}`
                    : formatPortions(entry.meal.nextLunch ? portions.total : portions.meal) +
                      (entry.meal.nextLunch ? ' à cuisiner, dont le déjeuner de demain' : '');
                return `<li><span class="today__slot">${escapeHtml(slot.label)}</span>
                  <a href="#/recettes/${encodeURIComponent(entry.meal.recipeId)}">${escapeHtml(entry.meal.recipeName)}</a>
                  <span class="hint">${escapeHtml(detail)}</span></li>`;
              })
              .join('')}</ul>
            <p><a href="#/planning">Voir la semaine</a></p>`
          : `<p class="today__empty">Aucun repas prévu aujourd'hui.</p>
             <p><a href="#/planning">Planifier la semaine</a></p>`
      }
    </section>
    ${
      household.members.length === 0
        ? `<section class="notice" aria-labelledby="household-title">
            <h2 id="household-title">Présentez votre foyer</h2>
            <p>Indiquez qui mange à la maison, les allergies et les régimes : MealDom ne proposera que des recettes qui conviennent à tout le monde.</p>
            <a class="button" href="#/foyer">Présenter mon foyer</a>
          </section>`
        : ''
    }
    ${
      reminder
        ? `<section class="notice" aria-labelledby="backup-title">
            <h2 id="backup-title">Sauvegardez vos données</h2>
            <p>Vos données sont enregistrées uniquement sur cet appareil. Un export régulier vous évite de les perdre.</p>
            <button type="button" class="button" data-action="export">Exporter mes données</button>
          </section>`
        : ''
    }
  `;

  const button = el.querySelector('[data-action="export"]');
  button?.addEventListener('click', async () => {
    await exportData();
    await renderHome(el);
  });
}
