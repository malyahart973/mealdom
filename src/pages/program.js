import { escapeHtml } from '../utils/html.js';
import { formatNumber, formatIsoDayMonth } from '../utils/format.js';
import { toIsoDate } from '../domain/planning/dates.js';
import {
  ACTIVITY_LEVELS,
  WEEKLY_LOSS_OPTIONS,
  MIN_KCAL,
  bmi,
  bmiCategory,
  weightForBmi,
  validateProgram,
  dailyTargets,
  mealTargets,
  goalDate,
} from '../domain/nutrition/program.js';
import { parseKg, sortEntries } from '../domain/nutrition/weight.js';
import { getProgram, saveProgram, setProgramActive, getWeights, programSuggestions } from '../services/programService.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals } from '../services/planningService.js';
import { plannedEntries } from '../domain/planning/planning.js';
import { plannedKcalForDay } from '../domain/nutrition/program.js';
import { nutritionByRecipe } from '../services/catalog.js';
import { calorieRingSvg } from './calorieRing.js';

/** @typedef {import('../domain/nutrition/program.js').Program} Program */
/** @typedef {import('../domain/nutrition/program.js').ProgramSlot} ProgramSlot */

/** @type {{ id: ProgramSlot, label: string }[]} */
const PROGRAM_SLOTS = [
  { id: 'breakfast', label: 'Petit-déjeuner' },
  { id: 'lunch', label: 'Déjeuner' },
  { id: 'snack', label: 'Goûter' },
  { id: 'dinner', label: 'Dîner' },
];

const SUGGESTIONS_PER_SLOT = 4;

/** Decalage des idees affichees, par repas (bouton "Autres idees"). */
/** @type {Record<ProgramSlot, number>} */
const offsets = { breakfast: 0, lunch: 0, snack: 0, dinner: 0 };

/** @param {number} kg */
const kgText = (kg) => `${formatNumber(kg)} kg`;

/**
 * Ecran Programme minceur : informations, besoins, objectifs par repas et idees de repas.
 * @param {HTMLElement} el
 */
export async function renderProgram(el) {
  const today = toIsoDate(new Date());
  const [program, entries, household, meals] = await Promise.all([getProgram(), getWeights(), getHousehold(), getMeals()]);
  const valid = validateProgram(program, today).length === 0;
  const sorted = sortEntries(entries);
  const currentKg = sorted.length ? sorted[sorted.length - 1].kg : program.startWeightKg;
  const targets = valid ? dailyTargets(program, currentKg, today) : null;
  const perMeal = targets ? mealTargets(targets, program.mealSplit) : null;
  const finish = targets ? goalDate(targets, today) : null;
  const currentBmi = valid ? bmi(currentKg, program.heightCm) : null;
  const kcalToday = perMeal ? plannedKcalForDay(plannedEntries(meals), today, program, perMeal, (id) => nutritionByRecipe().get(id)) : null;

  /** @type {Record<string, string>} */
  const suggestionsHtml = {};
  if (perMeal && program.active) {
    await Promise.all(
      PROGRAM_SLOTS.filter((s) => program.mealSplit[s.id] > 0).map(async (s) => {
        const list = await programSuggestions(s.id, perMeal[s.id], program.memberId, SUGGESTIONS_PER_SLOT, offsets[s.id]);
        suggestionsHtml[s.id] = list.length
          ? `<ul class="recipe-list">${list
              .map(
                (x) => `<li><a href="#/recettes/${encodeURIComponent(x.recipe.id)}">
                  <span class="recipe-list__name">${escapeHtml(x.recipe.name)}</span>
                  <span class="recipe-list__meta">Votre portion : ${escapeHtml(formatNumber(x.portions))} × la portion de la recette · ${x.kcal} kcal · ${x.protein} g de protéines</span></a></li>`,
              )
              .join('')}</ul>`
          : '<p class="empty">Plus d’autre idée pour ce repas.</p>';
      }),
    );
  }

  const memberOptions = household.members
    .map((m) => `<option value="${escapeHtml(m.id)}"${program.memberId === m.id ? ' selected' : ''}>${escapeHtml(m.name)}</option>`)
    .join('');
  /** @param {number} v */
  const input = (v) => (v > 0 ? String(v).replace('.', ',') : '');

  el.innerHTML = `
    <section>
      <h1 class="page-title">Programme minceur</h1>
      <p class="hint">Ce programme donne des repères à partir de formules de référence (métabolisme de Mifflin-St Jeor, niveau d’activité). Ce n’est pas un avis médical : en cas de maladie, de traitement, de grossesse, d’allaitement ou de troubles du comportement alimentaire, demandez conseil à un médecin ou à une diététicienne. Il ne descend jamais sous ${MIN_KCAL.female} kcal par jour pour une femme et ${MIN_KCAL.male} kcal pour un homme.</p>
      ${
        targets && perMeal && currentBmi !== null
          ? `<div class="batch-summary">
              <p><strong>${program.active ? 'Programme actif' : 'Programme en pause'}</strong> : ${
                program.active
                  ? 'le planning, l’assistant et les fiches recettes tiennent compte de vos portions.'
                  : 'activez-le pour que le planning, l’assistant et les fiches recettes tiennent compte de vos portions.'
              }</p>
              <button type="button" class="button ${program.active ? 'button--secondary' : ''}" data-action="toggle">${program.active ? 'Mettre en pause' : 'Activer le programme'}</button>
            </div>
            ${
              kcalToday && program.active
                ? `<div class="card ring-card ring-card--row">${calorieRingSvg(kcalToday.kcal, targets.kcal)}
                    <span class="ring-card__text"><strong>Prévues aujourd’hui</strong><span class="hint">${kcalToday.meals ? `${kcalToday.meals} repas du planning, avec vos portions` : 'Aucun repas planifié aujourd’hui'}</span></span></div>`
                : ''
            }
            <dl class="budget-card">
              <div><dt>IMC actuel</dt><dd>${escapeHtml(formatNumber(currentBmi))}</dd></div>
              <div><dt>Objectif par jour</dt><dd>${targets.kcal} kcal</dd></div>
              <div><dt>Perte prévue</dt><dd>${escapeHtml(formatNumber(targets.weeklyLossKg))} kg / semaine</dd></div>
              <div><dt>Objectif atteint vers</dt><dd>${finish ? escapeHtml(`${formatIsoDayMonth(finish)} ${finish.slice(0, 4)}`) : '—'}</dd></div>
            </dl>
            <p>${escapeHtml(bmiCategory(currentBmi))} (IMC ${escapeHtml(formatNumber(currentBmi))}) à ${escapeHtml(kgText(currentKg))}. Objectif : ${escapeHtml(kgText(program.goalWeightKg))}, soit un IMC de ${escapeHtml(formatNumber(bmi(program.goalWeightKg, program.heightCm)))}.
              ${targets.weeksToGoal ? `Environ ${targets.weeksToGoal} semaines au rythme prévu.` : ''}</p>
            <p class="hint">Dépense estimée : ${targets.bmr} kcal au repos, ${targets.tdee} kcal avec votre activité. ${
              targets.floorApplied
                ? `Le rythme choisi demanderait de manger moins que le minimum conseillé : l’objectif est donc fixé à ${targets.kcal} kcal et la perte sera plus lente (${escapeHtml(formatNumber(targets.weeklyLossKg))} kg par semaine). Bouger davantage (marche quotidienne) l’accélère sans manger moins.`
                : `Déficit de ${targets.deficit} kcal par jour.`
            } Les objectifs sont recalculés à chaque nouvelle pesée.</p>

            <h2>Vos repères du jour</h2>
            <dl class="facts">
              <div><dt>Protéines</dt><dd>${targets.proteinG} g</dd></div>
              <div><dt>Glucides</dt><dd>${targets.carbsG} g</dd></div>
              <div><dt>Lipides</dt><dd>${targets.fatG} g</dd></div>
              <div><dt>Fibres</dt><dd>au moins ${targets.fiberG} g</dd></div>
              <div><dt>Eau</dt><dd>1,5 à 2 litres</dd></div>
            </dl>

            <h2>Par repas</h2>
            <dl class="facts">${PROGRAM_SLOTS.filter((s) => program.mealSplit[s.id] > 0)
              .map((s) => `<div><dt>${escapeHtml(s.label)} (${program.mealSplit[s.id]} %)</dt><dd>${perMeal[s.id].kcal} kcal · ${perMeal[s.id].proteinG} g de protéines</dd></div>`)
              .join('')}</dl>
            <p class="hint">Sur chaque fiche recette, « Votre portion » donne les quantités en grammes pour atteindre ces calories. Les légumes non féculents peuvent être ajoutés à volonté.</p>
            <p><a class="button button--secondary" href="#/poids">Suivi du poids</a> <a class="button button--secondary" href="#/assistant">Demander un menu léger à l’assistant</a></p>

            ${
              program.active
                ? `<h2>Idées de repas à votre portion</h2>
                  ${PROGRAM_SLOTS.filter((s) => program.mealSplit[s.id] > 0)
                    .map(
                      (s) => `<h3>${escapeHtml(s.label)} – ${perMeal[s.id].kcal} kcal</h3>${suggestionsHtml[s.id] ?? ''}
                        <button type="button" class="button button--small button--secondary" data-more="${s.id}">Autres idées</button>`,
                    )
                    .join('')}`
                : ''
            }`
          : '<p>Renseignez vos informations : MealDom calcule vos besoins, l’objectif calorique de chaque repas et vous propose des repas à votre portion, avec les quantités en grammes.</p>'
      }

      <h2>${valid ? 'Modifier mes informations' : 'Mes informations'}</h2>
      <div class="alert" role="alert" hidden></div>
      <form class="stock-form" data-form="program" novalidate>
        ${
          household.members.length
            ? `<div class="field"><label for="pg-member">Personne suivie</label>
                <select id="pg-member"><option value="">Non précisée</option>${memberOptions}</select>
                <p class="hint">Ses allergies, son régime et les aliments qu’elle refuse filtrent les idées de repas.</p></div>`
            : ''
        }
        <fieldset class="field"><legend>Sexe (le calcul des besoins en dépend)</legend>
          <label class="check"><input type="radio" name="sex" value="female"${program.sex === 'female' ? ' checked' : ''} /> <span>Femme</span></label>
          <label class="check"><input type="radio" name="sex" value="male"${program.sex === 'male' ? ' checked' : ''} /> <span>Homme</span></label>
        </fieldset>
        <div class="field"><label for="pg-birth">Année de naissance</label><input id="pg-birth" type="text" inputmode="numeric" maxlength="4" autocomplete="off" value="${program.birthYear ?? ''}" placeholder="ex. 1990" /></div>
        <div class="field"><label for="pg-height">Taille (cm)</label><input id="pg-height" type="text" inputmode="numeric" autocomplete="off" value="${input(program.heightCm)}" placeholder="ex. 162" /></div>
        <div class="field"><label for="pg-start">Poids de départ (kg)</label><input id="pg-start" type="text" inputmode="decimal" autocomplete="off" value="${input(program.startWeightKg)}" placeholder="ex. 71,4" /></div>
        <div class="field"><label for="pg-goal">Poids visé (kg)</label><input id="pg-goal" type="text" inputmode="decimal" autocomplete="off" value="${input(program.goalWeightKg)}" placeholder="ex. 61,4" />
          ${program.heightCm >= 120 ? `<p class="hint">Pour ${program.heightCm} cm, la corpulence normale va de ${escapeHtml(kgText(weightForBmi(18.5, program.heightCm)))} à ${escapeHtml(kgText(weightForBmi(24.9, program.heightCm)))}.</p>` : ''}</div>
        <div class="field"><label for="pg-activity">Activité</label>
          <select id="pg-activity">${ACTIVITY_LEVELS.map((a) => `<option value="${a.id}"${program.activity === a.id ? ' selected' : ''}>${escapeHtml(a.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="pg-pace">Rythme visé</label>
          <select id="pg-pace">${WEEKLY_LOSS_OPTIONS.map(
            (v) => `<option value="${v}"${program.weeklyLossKg === v ? ' selected' : ''}>${escapeHtml(formatNumber(v))} kg par semaine${v === 0.5 ? ' (conseillé)' : v === 0.25 ? ' (en douceur)' : ''}</option>`,
          ).join('')}</select></div>
        <fieldset class="field"><legend>Répartition des calories (total 100 %)</legend>
          <div class="split">${PROGRAM_SLOTS.map(
            (s) => `<label>${escapeHtml(s.label)} <input type="text" inputmode="numeric" maxlength="3" name="split-${s.id}" value="${program.mealSplit[s.id]}" /> %</label>`,
          ).join('')}</div>
          <p class="hint">Mettez 0 au goûter si vous n’en prenez pas.</p>
        </fieldset>
        <div class="form-actions"><button type="submit" class="button">Calculer et enregistrer</button></div>
      </form>
    </section>`;

  el.querySelector('[data-action="toggle"]')?.addEventListener('click', async () => {
    await setProgramActive(!program.active);
    await renderProgram(el);
  });
  for (const button of el.querySelectorAll('[data-more]')) {
    button.addEventListener('click', async () => {
      const slot = /** @type {ProgramSlot} */ (button.getAttribute('data-more'));
      offsets[slot] += SUGGESTIONS_PER_SLOT;
      await renderProgram(el);
      el.querySelector(`[data-more="${slot}"]`)?.scrollIntoView({ block: 'center' });
    });
  }

  el.querySelector('[data-form="program"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (event.target);
    /** @param {string} id */
    const val = (id) => /** @type {HTMLInputElement} */ (el.querySelector(id))?.value.trim() ?? '';
    const sex = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="sex"]:checked'))?.value;
    const birth = Number(val('#pg-birth'));
    /** @type {Record<ProgramSlot, number>} */
    const split = { breakfast: 0, lunch: 0, snack: 0, dinner: 0 };
    for (const s of PROGRAM_SLOTS) {
      const raw = /** @type {HTMLInputElement} */ (form.elements.namedItem(`split-${s.id}`)).value.trim();
      split[s.id] = raw === '' ? 0 : Number(raw);
    }
    /** @type {Program} */
    const next = {
      ...program,
      memberId: val('#pg-member') || null,
      sex: sex === 'female' || sex === 'male' ? sex : null,
      birthYear: val('#pg-birth') && Number.isInteger(birth) ? birth : null,
      heightCm: Number(val('#pg-height')) || 0,
      startWeightKg: parseKg(val('#pg-start')) || 0,
      goalWeightKg: parseKg(val('#pg-goal')) || 0,
      activity: /** @type {Program['activity']} */ (val('#pg-activity')),
      weeklyLossKg: Number(val('#pg-pace')),
      startDate: program.startWeightKg === (parseKg(val('#pg-start')) || 0) ? program.startDate : today,
      mealSplit: split,
      active: valid ? program.active : true,
    };
    const errors = await saveProgram(next);
    const alert = /** @type {HTMLElement} */ (el.querySelector('.alert'));
    if (errors.length) {
      alert.hidden = false;
      alert.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
      alert.scrollIntoView({ block: 'center' });
      return;
    }
    await renderProgram(el);
    window.scrollTo({ top: 0 });
  });
}
