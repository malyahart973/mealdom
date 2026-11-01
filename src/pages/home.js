import { formatDayLong, formatPortions, formatNumber, formatIsoDay, formatTime, formatMinutes } from '../utils/format.js';
import { escapeHtml } from '../utils/html.js';
import { exportData, isReminderDue } from '../services/backupService.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals } from '../services/planningService.js';
import { SLOTS, plannedEntries, slotKey, mealPortionsFor } from '../domain/planning/planning.js';
import { toIsoDate, addDays } from '../domain/planning/dates.js';
import { programSummary, getWeights, getMeasurements, saveWeight, saveMeasurement } from '../services/programService.js';
import { parseKg, sortEntries } from '../domain/nutrition/weight.js';
import { parseCm, checkInReport } from '../domain/nutrition/measurements.js';
import { shareText } from '../utils/share.js';
import { REPORT_SHARE_STATUS } from './weight.js';
import { plannedKcalForDay, hourText } from '../domain/nutrition/program.js';
import { calorieRingSvg } from './calorieRing.js';
import { totalMinutes } from '../domain/recipes/recipes.js';
import { nextTrip } from '../services/tripService.js';
import { seasonNow } from '../services/seasonService.js';
import { MONTH_LABELS } from '../data/seasons.js';
import { getInventory } from '../services/shoppingService.js';
import { itemsToUseFirst, expiryStatus } from '../domain/shopping/shopping.js';
import { ingredientsById, recipesById, nutritionByRecipe } from '../services/catalog.js';
import { getStores } from '../services/budgetService.js';
import { getCoachPlan } from '../services/coachService.js';
import { nextCheckIn } from '../domain/nutrition/coach.js';

/**
 * Ecran Accueil.
 * @param {HTMLElement} el
 */
export async function renderHome(el) {
  const today = formatDayLong(new Date());
  const [reminder, household, meals, program, trip, stores, inventory, season, coach, weights, measurements] = await Promise.all([
    isReminderDue(),
    getHousehold(),
    getMeals(),
    programSummary(),
    nextTrip(),
    getStores(),
    getInventory(),
    seasonNow(),
    getCoachPlan(),
    getWeights(),
    getMeasurements(),
  ]);
  const storeNames = new Map(stores.map((s) => [s.id, s.name]));
  const todayIso = toIsoDate(new Date());
  const entries = plannedEntries(meals);
  const todayMeals = SLOTS.map((s) => ({ slot: s, entry: entries.get(slotKey(todayIso, s.id)) })).filter((x) => x.entry);
  // Le repas mis en avant : le prochain de la journee selon l'heure, sinon le dernier.
  const hour = new Date().getHours();
  const currentSlot = hour < 9 ? 0 : hour < 11 ? 1 : hour < 14 ? 2 : hour < 17 ? 3 : 4;
  const featured = todayMeals.find((x) => SLOTS.findIndex((s) => s.id === x.slot.id) >= currentSlot) ?? todayMeals[todayMeals.length - 1];
  const featuredRecipe = featured?.entry ? recipesById.get(featured.entry.meal.recipeId) : undefined;
  /** @type {Record<string, string>} */
  const momentLabels = { breakfast: 'Ce matin', morning_snack: 'À 10 heures', lunch: 'À midi', snack: 'Au goûter', dinner: 'Ce soir' };
  const others = todayMeals.filter((x) => x !== featured);
  const kcalToday = program
    ? plannedKcalForDay(entries, todayIso, program.program, program.todayMeals, (id) => nutritionByRecipe().get(id))
    : null;
  /** @param {{ slot: { id: string, label: string }, entry: ReturnType<typeof entries.get> }} x */
  const detailOf = (x) => {
    if (!x.entry) return '';
    const portions = mealPortionsFor(x.entry.meal, household);
    return x.entry.kind === 'leftover'
      ? `restes du dîner d’hier, ${formatPortions(portions.nextLunch)}`
      : formatPortions(x.entry.meal.nextLunch ? portions.total : portions.meal) + (x.entry.meal.nextLunch ? ' à cuisiner, dont le déjeuner de demain' : '');
  };

  el.innerHTML = `
    <section class="hero">
      <p class="hero__date">${escapeHtml(today)}</p>
      ${
        featured?.entry
          ? `<h1 class="hero__title">${escapeHtml(momentLabels[featured.slot.id] ?? featured.slot.label)} : ${escapeHtml(featured.entry.meal.recipeName)}</h1>
            <p class="hero__chips">
              ${featuredRecipe ? `<span class="hero__chip hero__chip--accent">${escapeHtml(formatMinutes(totalMinutes(featuredRecipe)))}</span>` : ''}
              <span class="hero__chip">${escapeHtml(detailOf(featured))}</span>
            </p>
            <p><a class="button button--light" href="#/recettes/${encodeURIComponent(featured.entry.meal.recipeId)}">Voir la recette</a></p>`
          : `<h1 class="hero__title">Rien de prévu aujourd’hui</h1>
            <p><a class="button button--light" href="#/planning">Planifier la semaine</a></p>`
      }
    </section>
    ${
      others.length
        ? `<section class="card" aria-label="Autres repas du jour">
            <ul class="today__meals">${others
              .map(
                (x) => `<li><span class="today__slot">${escapeHtml(x.slot.label)}</span>
                  <a href="#/recettes/${encodeURIComponent(x.entry?.meal.recipeId ?? '')}">${escapeHtml(x.entry?.meal.recipeName ?? '')}</a>
                  <span class="hint">${escapeHtml(detailOf(x))}</span></li>`,
              )
              .join('')}</ul>
            <p><a href="#/planning">Voir la semaine</a></p>
          </section>`
        : ''
    }
    ${
      program && kcalToday
        ? `<section class="duo" aria-label="Mon programme">
            <a class="card ring-card" href="#/programme">
              ${
                program.program.method === 'count'
                  ? `${calorieRingSvg(kcalToday.kcal, program.today.kcal)}
                    <span class="ring-card__text"><strong>Prévues aujourd’hui</strong>
                      <span class="hint">${kcalToday.meals ? `${kcalToday.meals} repas, avec vos portions` : 'Aucun repas planifié'}</span>`
                  : `<span class="plate-icon" aria-hidden="true"></span>
                    <span class="ring-card__text"><strong>Assiette équilibrée</strong>
                      <span class="hint">½ légumes, ¼ protéines, ¼ féculents</span>`
              }
                ${program.window ? `<span class="hint">Repas : ${hourText(program.window.start)} – ${hourText(program.window.end)}</span>` : ''}
                ${program.today.sessions.length ? `<span class="hint">Jour de sport</span>` : ''}</span>
            </a>
            <a class="card weight-card" href="#/poids">
              <span class="hint">Poids</span>
              <strong class="weight-card__value">${program.entries.length ? `${escapeHtml(formatNumber(program.progress.currentKg))} kg` : '—'}</strong>
              <span class="hint">${program.entries.length ? `${escapeHtml(formatNumber(Math.max(0, program.progress.lostKg)))} kg perdus` : 'Noter mon poids'}</span>
            </a>
          </section>`
        : coach
        ? `<a class="card ring-card ring-card--row" href="#/programme">
            <span class="plate-icon" aria-hidden="true"></span>
            <span class="ring-card__text"><strong>Mon programme</strong>
              <span class="hint">Les repas de votre coach${coach.waterLiters ? `, ${escapeHtml(formatNumber(coach.waterLiters))} L d’eau par jour` : ''}</span>
              <span class="hint">Pesée et mensurations</span></span>
          </a>`
        : ''
    }
    <p><a class="assistant-link" href="#/assistant">Demander à l’assistant…
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-7-3a7 7 0 0 0 14 0M12 19v3"/></svg></a></p>
    ${(() => {
      const highlight = [...season.lowPrice, ...season.season].filter((id, i, all) => all.indexOf(id) === i).slice(0, 6);
      if (!highlight.length) return '';
      return `<section class="notice" aria-labelledby="season-title">
          <h2 id="season-title">De saison en ${escapeHtml(MONTH_LABELS[season.month - 1])}</h2>
          <p>${highlight.map((id) => `<a href="#/recettes/avec/${encodeURIComponent(id)}">${escapeHtml(ingredientsById.get(id)?.name ?? id)}</a>`).join(', ')}</p>
          <p><a href="#/saison">Produits de saison</a></p>
        </section>`;
    })()}
    ${(() => {
      const first = itemsToUseFirst(inventory, todayIso);
      if (!first.length) return '';
      const expired = first.filter((i) => expiryStatus(i, todayIso).status === 'expired').length;
      const names = first.slice(0, 4).map((i) => ingredientsById.get(i.ingredientId)?.name ?? i.ingredientId);
      return `<section class="notice" aria-labelledby="expiry-title">
          <h2 id="expiry-title">À consommer vite</h2>
          <p>${escapeHtml(names.join(', '))}${first.length > 4 ? '…' : ''}${expired ? ` (dont ${expired} date dépassée)` : ''}.</p>
          <p><a class="button" href="#/stock">Voir le stock</a></p>
        </section>`;
    })()}
    ${(() => {
      // Bilan du coach (poids, mensurations) aujourd'hui ou dans les 2 jours.
      const check = coach ? nextCheckIn(coach, addDays(todayIso, -1)) : null;
      if (!check || check > addDays(todayIso, 2)) return '';
      const title = `<h2 id="checkin-title">Bilan pour votre coach ${check === todayIso ? 'aujourd’hui' : escapeHtml(formatIsoDay(check))}</h2>`;
      if (check > todayIso) {
        return `<section class="notice" aria-labelledby="checkin-title">${title}
            <p>Ce jour-là, pesez-vous le matin à jeun et mesurez votre tour de taille : vous pourrez le noter ici, puis envoyer le bilan.</p>
          </section>`;
      }
      // Le jour du bilan (ou le lendemain) : pesee et tour de taille notes ici, puis bilan envoye.
      const kg = weights.find((w) => w.date === todayIso)?.kg;
      const waist = measurements.find((m) => m.date === todayIso)?.values.waist;
      return `<section class="notice" aria-labelledby="checkin-title">${title}
          <form class="checkin" data-form="checkin" novalidate>
            <p>Pesez-vous le matin à jeun et mesurez votre tour de taille (au nombril, ventre relâché).</p>
            <div class="when">
              <div class="field"><label for="ci-kg">Poids (kg)</label><input id="ci-kg" type="text" inputmode="decimal" autocomplete="off" value="${kg ? escapeHtml(formatNumber(kg)) : ''}" placeholder="ex. 84,6" /></div>
              <div class="field"><label for="ci-waist">Tour de taille (cm)</label><input id="ci-waist" type="text" inputmode="decimal" autocomplete="off" value="${waist ? escapeHtml(formatNumber(waist)) : ''}" placeholder="ex. 92" /></div>
            </div>
            <p class="alert" role="alert" hidden></p>
            <p class="form-actions">
              <button type="submit" class="button${kg ? ' button--secondary' : ''}">${kg ? 'Corriger' : 'Enregistrer'}</button>
              ${kg ? '<button type="button" class="button" data-action="share-checkin">Envoyer mon bilan</button>' : ''}
            </p>
            <p class="status" role="status" data-checkin-status></p>
            <p><a href="#/poids">Autres mensurations et courbe</a></p>
          </form>
        </section>`;
    })()}
    ${
      trip
        ? `<section class="notice" aria-labelledby="trip-title">
            <h2 id="trip-title">Courses ${trip.date === todayIso ? 'aujourd’hui' : escapeHtml(formatIsoDay(trip.date))} à ${escapeHtml(formatTime(trip.time))}</h2>
            <p>${trip.storeIds.map((id, i) => `${i ? 'puis ' : ''}${escapeHtml(storeNames.get(id) ?? 'magasin')}`).join(', ')}${trip.driveSlot ? `. Retrait Drive de ${escapeHtml(formatTime(trip.driveSlot.start))} à ${escapeHtml(formatTime(trip.driveSlot.end))}` : ''}.</p>
            <p><a class="button" href="#/courses/semaine/${escapeHtml(trip.week)}">Ma liste de courses</a> <a href="#/courses/organisation/semaine/${escapeHtml(trip.week)}">Détails</a></p>
          </section>`
        : ''
    }

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

  const checkin = /** @type {HTMLFormElement | null} */ (el.querySelector('[data-form="checkin"]'));
  checkin?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const alertBox = /** @type {HTMLElement} */ (checkin.querySelector('.alert'));
    const kgText = /** @type {HTMLInputElement} */ (checkin.querySelector('#ci-kg')).value.trim();
    const waistText = /** @type {HTMLInputElement} */ (checkin.querySelector('#ci-waist')).value.trim();
    /** @type {string[]} */
    const errors = [];
    if (!kgText && !waistText) errors.push('Indiquez votre poids, votre tour de taille, ou les deux.');
    if (kgText) {
      const previous = weights.find((w) => w.date === todayIso);
      errors.push(...(await saveWeight({ date: todayIso, kg: parseKg(kgText), note: previous?.note ?? '' })));
    }
    if (waistText) {
      const cm = parseCm(waistText);
      const previous = measurements.find((m) => m.date === todayIso);
      if (cm === null) errors.push('Le tour de taille doit être un nombre de centimètres, par exemple 92.');
      else errors.push(...(await saveMeasurement({ date: todayIso, values: { ...(previous?.values ?? {}), waist: cm }, note: previous?.note ?? '' })));
    }
    if (errors.length) {
      alertBox.hidden = false;
      alertBox.innerHTML = errors.map((e) => escapeHtml(e)).join('<br />');
      return;
    }
    await renderHome(el);
    const status = el.querySelector('[data-checkin-status]');
    if (status) status.textContent = 'Enregistré. Envoyez maintenant le bilan à votre coach.';
    el.querySelector('[data-form="checkin"]')?.scrollIntoView({ block: 'center' });
  });
  el.querySelector('[data-action="share-checkin"]')?.addEventListener('click', async () => {
    const [w, m] = await Promise.all([getWeights(), getMeasurements()]);
    const result = await shareText('Mon bilan', checkInReport(sortEntries(w), m, todayIso, formatIsoDay));
    const status = /** @type {HTMLElement} */ (el.querySelector('[data-checkin-status]'));
    status.textContent = REPORT_SHARE_STATUS[result];
  });

  const button = el.querySelector('[data-action="export"]');
  button?.addEventListener('click', async () => {
    await exportData();
    await renderHome(el);
  });
}
