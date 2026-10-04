import { formatDayLong } from '../utils/format.js';
import { escapeHtml } from '../utils/html.js';
import { exportData, isReminderDue } from '../services/backupService.js';
import { getHousehold } from '../services/householdService.js';

/**
 * Ecran Accueil.
 * @param {HTMLElement} el
 */
export async function renderHome(el) {
  const today = formatDayLong(new Date());
  const [reminder, household] = await Promise.all([isReminderDue(), getHousehold()]);

  el.innerHTML = `
    <section class="today">
      <h1 class="today__date">${escapeHtml(today)}</h1>
      <p class="today__empty">Aucun repas prévu aujourd'hui.</p>
      <p class="hint">Le planning de la semaine arrive dans une prochaine version.</p>
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
