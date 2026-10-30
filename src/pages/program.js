import { escapeHtml } from '../utils/html.js';
import { formatNumber, formatIsoDayMonth } from '../utils/format.js';
import { toIsoDate } from '../domain/planning/dates.js';
import {
  ACTIVITY_LEVELS,
  MIN_KCAL,
  METHODS,
  FASTING_PATTERNS,
  SPORT_KINDS,
  INTENSITIES,
  WEEKDAYS,
  PROGRAM_SLOTS,
  MIN_MEALS,
  MAX_MEALS,
  DEFAULT_SPORT_NOTE,
  SPORT_EAT_BACK,
  bmi,
  bmiCategory,
  weightForBmi,
  validateProgram,
  dailyTargets,
  dayTargets,
  mealTargets,
  goalDate,
  paceComparison,
  programMeals,
  programTrame,
  splitForMeals,
  eatingWindow,
  slotsInWindow,
  hourText,
  sessionKcal,
  plannedKcalForDay,
} from '../domain/nutrition/program.js';
import { parseKg, sortEntries } from '../domain/nutrition/weight.js';
import { getProgram, saveProgram, setProgramActive, getWeights, programSuggestions } from '../services/programService.js';
import { getHousehold } from '../services/householdService.js';
import { getMeals } from '../services/planningService.js';
import { plannedEntries } from '../domain/planning/planning.js';
import { nutritionByRecipe } from '../services/catalog.js';
import { calorieRingSvg } from './calorieRing.js';

/** @typedef {import('../domain/nutrition/program.js').Program} Program */
/** @typedef {import('../domain/nutrition/program.js').ProgramSlot} ProgramSlot */
/** @typedef {import('../domain/nutrition/program.js').SportSession} SportSession */

const SUGGESTIONS_PER_SLOT = 4;

/** Decalage des idees affichees, par repas (bouton "Autres idees"). */
/** @type {Record<ProgramSlot, number>} */
const offsets = { breakfast: 0, morning_snack: 0, lunch: 0, snack: 0, dinner: 0 };

/** @param {number} kg */
const kgText = (kg) => `${formatNumber(kg)} kg`;
/** @param {ProgramSlot} id */
const slotLabel = (id) => PROGRAM_SLOTS.find((s) => s.id === id)?.label ?? id;

/**
 * @param {number} index
 * @param {SportSession} s
 * @returns {string}
 */
function sportRowHtml(index, s) {
  return `<li class="sport-row">
    <label class="visually-hidden" for="sp-day-${index}">Jour</label>
    <select id="sp-day-${index}" data-sp="day">${WEEKDAYS.map((d, i) => `<option value="${i}"${i === s.day ? ' selected' : ''}>${d}</option>`).join('')}</select>
    <label class="visually-hidden" for="sp-kind-${index}">Activité</label>
    <select id="sp-kind-${index}" data-sp="kind">${SPORT_KINDS.map((k) => `<option value="${k.id}"${k.id === s.kind ? ' selected' : ''}>${escapeHtml(k.label)}</option>`).join('')}</select>
    <label class="visually-hidden" for="sp-min-${index}">Durée en minutes</label>
    <span class="sport-row__min"><input id="sp-min-${index}" data-sp="minutes" type="text" inputmode="numeric" maxlength="3" value="${s.minutes}" /> min</span>
    <label class="visually-hidden" for="sp-int-${index}">Intensité</label>
    <select id="sp-int-${index}" data-sp="intensity">${INTENSITIES.map((x) => `<option value="${x.id}"${x.id === s.intensity ? ' selected' : ''}>${x.label}</option>`).join('')}</select>
    <button type="button" class="ing-row__remove" data-sp-remove aria-label="Retirer cette séance">✕</button>
  </li>`;
}

/**
 * Ecran Programme minceur : methode, repas, rythme, sport, trame et idees de repas.
 * @param {HTMLElement} el
 */
export async function renderProgram(el) {
  const today = toIsoDate(new Date());
  const [program, entries, household, meals] = await Promise.all([getProgram(), getWeights(), getHousehold(), getMeals()]);
  const valid = validateProgram(program, today).length === 0;
  const sorted = sortEntries(entries);
  const currentKg = sorted.length ? sorted[sorted.length - 1].kg : program.startWeightKg;
  const base = valid ? dailyTargets(program, currentKg, today) : null;
  const day = base ? dayTargets(program, base, currentKg, today) : null;
  const perMeal = base ? mealTargets(base, program.mealSplit) : null;
  const perMealToday = day ? mealTargets(day, program.mealSplit) : null;
  const finish = base ? goalDate(base, today) : null;
  const currentBmi = valid ? bmi(currentKg, program.heightCm) : null;
  const kcalToday = perMealToday ? plannedKcalForDay(plannedEntries(meals), today, program, perMealToday, (id) => nutritionByRecipe().get(id)) : null;
  const chosen = programMeals(program);
  const counting = program.method === 'count';
  const trame = perMeal ? programTrame(program, perMeal) : null;
  const eatWindow = program.fasting ? eatingWindow(program.fasting) : null;
  const basicsOk = program.sex !== null && program.birthYear !== null && program.heightCm >= 120 && program.startWeightKg >= 30;
  const paces = basicsOk ? paceComparison(program, currentKg, today) : null;

  /** @type {Record<string, string>} */
  const suggestionsHtml = {};
  if (perMeal && program.active) {
    await Promise.all(
      chosen.map(async (slot) => {
        const list = await programSuggestions(slot, perMeal[slot], program.memberId, SUGGESTIONS_PER_SLOT, offsets[slot]);
        suggestionsHtml[slot] = list.length
          ? `<ul class="recipe-list">${list
              .map(
                (x) => `<li><a href="#/recettes/${encodeURIComponent(x.recipe.id)}">
                  <span class="recipe-list__name">${escapeHtml(x.recipe.name)}</span>
                  <span class="recipe-list__meta">${counting ? `Votre portion : ${escapeHtml(formatNumber(x.portions))} × la portion de la recette · ${x.kcal} kcal · ${x.protein} g de protéines` : 'Repas équilibré pour ce moment de la journée'}</span></a></li>`,
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
  const sportToday = day && day.sessions.length
    ? `Jour de sport : ${day.sessions.map((s) => `${SPORT_KINDS.find((k) => k.id === s.kind)?.label.toLowerCase()} ${s.minutes} min`).join(', ')}${counting ? ` (+${day.kcal - (base?.kcal ?? 0)} kcal à manger aujourd’hui)` : ''}.`
    : '';

  el.innerHTML = `
    <section class="program">
      <h1 class="page-title">Programme minceur</h1>
      <p class="hint">Des repères calculés avec des formules de référence (métabolisme de Mifflin-St Jeor, activité, sport). Ce n’est pas un avis médical : en cas de maladie, de traitement, de diabète, de grossesse, d’allaitement ou de troubles du comportement alimentaire, demandez conseil à un médecin ou à une diététicienne${program.fasting ? ', surtout pour le jeûne intermittent' : ''}. Jamais moins de ${MIN_KCAL.female} kcal par jour pour une femme et ${MIN_KCAL.male} kcal pour un homme.</p>
      ${
        base && day && perMeal && perMealToday && trame && currentBmi !== null
          ? `<div class="batch-summary">
              <p><strong>${program.active ? 'Programme actif' : 'Programme en pause'}</strong> : ${
                program.active ? 'le planning, l’assistant et les fiches recettes en tiennent compte.' : 'activez-le pour que le planning, l’assistant et les fiches recettes en tiennent compte.'
              }</p>
              <button type="button" class="button ${program.active ? 'button--secondary' : ''}" data-action="toggle">${program.active ? 'Mettre en pause' : 'Activer le programme'}</button>
            </div>
            ${
              program.active
                ? `<div class="card ring-card ring-card--row">
                    ${counting && kcalToday ? calorieRingSvg(kcalToday.kcal, day.kcal) : '<span class="plate-icon" aria-hidden="true"></span>'}
                    <span class="ring-card__text"><strong>Aujourd’hui</strong>
                      <span class="hint">${
                        counting
                          ? kcalToday && kcalToday.meals ? `${kcalToday.meals} repas planifiés, avec vos portions` : 'Aucun repas planifié aujourd’hui'
                          : 'Assiette équilibrée à chaque repas, sans compter'
                      }</span>
                      ${eatWindow ? `<span class="hint">Fenêtre de repas : ${hourText(eatWindow.start)} – ${hourText(eatWindow.end)}</span>` : ''}
                      ${sportToday ? `<span class="hint">${escapeHtml(sportToday)}</span>` : ''}
                    </span></div>`
                : ''
            }
            <dl class="budget-card">
              <div><dt>IMC actuel</dt><dd>${escapeHtml(formatNumber(currentBmi))}</dd></div>
              ${counting ? `<div><dt>Objectif par jour</dt><dd>${base.kcal} kcal</dd></div>` : `<div><dt>Méthode</dt><dd>Sans compter</dd></div>`}
              <div><dt>${program.weeklyLossKg > 0 ? 'Perte prévue' : 'Objectif'}</dt><dd>${program.weeklyLossKg > 0 ? `${escapeHtml(formatNumber(base.weeklyLossKg))} kg / semaine` : 'Stabiliser'}</dd></div>
              <div><dt>Objectif atteint vers</dt><dd>${finish && program.weeklyLossKg > 0 ? escapeHtml(`${formatIsoDayMonth(finish)} ${finish.slice(0, 4)}`) : '—'}</dd></div>
            </dl>
            <p>${escapeHtml(bmiCategory(currentBmi))} (IMC ${escapeHtml(formatNumber(currentBmi))}) à ${escapeHtml(kgText(currentKg))}.${
              program.weeklyLossKg > 0
                ? ` Objectif : ${escapeHtml(kgText(program.goalWeightKg))}, soit un IMC de ${escapeHtml(formatNumber(bmi(program.goalWeightKg, program.heightCm)))}.${base.weeksToGoal ? ` Environ ${base.weeksToGoal} semaines au rythme prévu.` : ''}`
                : ' Vous stabilisez votre poids : les repères visent l’équilibre, sans déficit.'
            }</p>
            ${
              counting
                ? `<p class="hint">Dépense estimée : ${base.bmr} kcal au repos, ${base.tdee} kcal avec votre activité${program.sport.length ? `, plus vos séances de sport (la moitié de leurs calories est remangée ces jours-là)` : ''}. ${
                    base.floorApplied
                      ? `Le rythme choisi demanderait de manger moins que le minimum conseillé : l’objectif est fixé à ${base.kcal} kcal et la perte sera plus lente (${escapeHtml(formatNumber(base.weeklyLossKg))} kg par semaine). Bouger davantage l’accélère sans manger moins.`
                      : program.weeklyLossKg > 0 ? `Déficit de ${base.deficit} kcal par jour.` : ''
                  } Les objectifs sont recalculés à chaque nouvelle pesée.</p>`
                : ''
            }

            <h2>Ma trame de repas</h2>
            <p class="hint">${chosen.length} repas par jour${program.highProtein ? ', riches en protéines' : ''}${eatWindow ? `, entre ${hourText(eatWindow.start)} et ${hourText(eatWindow.end)}` : ''}. ${
              chosen.some((s) => trame[s].custom) ? 'Votre trame personnelle est utilisée là où vous l’avez écrite.' : 'Repères conseillés : écrivez votre propre trame (coach, diététicienne) dans les réglages ci-dessous.'
            }</p>
            <ul class="trame">${chosen
              .map(
                (s) => `<li class="trame__meal"><strong>${escapeHtml(slotLabel(s))}${counting ? ` · ${perMealToday[s].kcal} kcal` : ''}</strong>${trame[s].custom ? ' <span class="badge">Ma trame</span>' : ''}
                  <ul>${trame[s].lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul></li>`,
              )
              .join('')}
              ${program.sport.length ? `<li class="trame__meal"><strong>Jours de sport</strong><ul><li>${escapeHtml(program.sportNote || DEFAULT_SPORT_NOTE)}</li></ul></li>` : ''}
            </ul>

            ${
              counting
                ? `<h2>Vos repères du jour</h2>
                  <dl class="facts">
                    <div><dt>Protéines</dt><dd>${day.proteinG} g</dd></div>
                    <div><dt>Glucides</dt><dd>${day.carbsG} g</dd></div>
                    <div><dt>Lipides</dt><dd>${day.fatG} g</dd></div>
                    <div><dt>Fibres</dt><dd>au moins ${day.fiberG} g</dd></div>
                    <div><dt>Eau</dt><dd>1,5 à 2 litres${day.sessions.length ? ' (plus les jours de sport)' : ''}</dd></div>
                  </dl>
                  <p class="hint">Sur chaque fiche recette, « Votre portion » donne les quantités en grammes. Les légumes non féculents peuvent être ajoutés à volonté.</p>`
                : '<p class="hint">Sans compter : servez-vous selon l’assiette équilibrée, mangez lentement et arrêtez-vous à la satiété. Eau : 1,5 à 2 litres par jour.</p>'
            }
            <p class="form-actions"><a class="button" href="#/assistant/planifier">Planifier ma semaine</a> <a class="button button--secondary" href="#/poids">Suivi du poids</a></p>

            ${
              program.active
                ? `<h2>Idées de repas${counting ? ' à votre portion' : ' équilibrés'}</h2>
                  ${chosen
                    .map(
                      (s) => `<h3>${escapeHtml(slotLabel(s))}${counting ? ` – ${perMeal[s].kcal} kcal` : ''}</h3>${suggestionsHtml[s] ?? ''}
                        <button type="button" class="button button--small button--secondary" data-more="${s}">Autres idées</button>`,
                    )
                    .join('')}`
                : ''
            }`
          : '<p>Renseignez vos réglages : MealDom calcule vos repères, propose une trame pour chaque repas et des idées de repas adaptées. Vous choisissez de compter les calories ou de vous rééquilibrer sans compter.</p>'
      }

      <h2>${valid ? 'Mes réglages' : 'Mes réglages'}</h2>
      <div class="alert" role="alert" hidden></div>
      <form class="stock-form program-form" data-form="program" novalidate>
        <fieldset class="guided__step"><legend><span class="guided__num" aria-hidden="true">1</span> Mes informations</legend>
          ${
            household.members.length
              ? `<div class="field"><label for="pg-member">Personne suivie</label>
                  <select id="pg-member"><option value="">Non précisée</option>${memberOptions}</select>
                  <p class="hint">Ses allergies, son régime et les aliments qu’elle refuse filtrent les idées de repas.</p></div>`
              : ''
          }
          <fieldset class="field radios"><legend>Sexe (le calcul des besoins en dépend)</legend>
            <label class="check"><input type="radio" name="sex" value="female"${program.sex === 'female' ? ' checked' : ''} /> <span>Femme</span></label>
            <label class="check"><input type="radio" name="sex" value="male"${program.sex === 'male' ? ' checked' : ''} /> <span>Homme</span></label>
          </fieldset>
          <div class="when">
            <div class="field"><label for="pg-birth">Année de naissance</label><input id="pg-birth" type="text" inputmode="numeric" maxlength="4" autocomplete="off" value="${program.birthYear ?? ''}" placeholder="ex. 1990" /></div>
            <div class="field"><label for="pg-height">Taille (cm)</label><input id="pg-height" type="text" inputmode="numeric" autocomplete="off" value="${input(program.heightCm)}" placeholder="ex. 162" /></div>
          </div>
          <div class="when">
            <div class="field"><label for="pg-start">Poids de départ (kg)</label><input id="pg-start" type="text" inputmode="decimal" autocomplete="off" value="${input(program.startWeightKg)}" placeholder="ex. 71,4" /></div>
            <div class="field"><label for="pg-goal">Poids visé (kg)</label><input id="pg-goal" type="text" inputmode="decimal" autocomplete="off" value="${input(program.goalWeightKg)}" placeholder="ex. 61,4" /></div>
          </div>
          ${program.heightCm >= 120 ? `<p class="hint">Pour ${program.heightCm} cm, la corpulence normale va de ${escapeHtml(kgText(weightForBmi(18.5, program.heightCm)))} à ${escapeHtml(kgText(weightForBmi(24.9, program.heightCm)))}.</p>` : ''}
          <div class="field"><label for="pg-activity">Activité au quotidien, hors séances de sport</label>
            <select id="pg-activity">${ACTIVITY_LEVELS.map((a) => `<option value="${a.id}"${program.activity === a.id ? ' selected' : ''}>${escapeHtml(a.label)}</option>`).join('')}</select>
            <p class="hint">Si vous notez vos séances de sport plus bas, choisissez ici votre activité sans le sport (souvent « sédentaire »).</p></div>
        </fieldset>

        <fieldset class="guided__step"><legend><span class="guided__num" aria-hidden="true">2</span> Ma méthode</legend>
          ${METHODS.map((m) => `<label class="check check--block"><input type="radio" name="method" value="${m.id}"${program.method === m.id ? ' checked' : ''} /> <span><strong>${escapeHtml(m.label)}</strong><span class="hint">${escapeHtml(m.hint)}</span></span></label>`).join('')}
          <label class="check check--block"><input type="checkbox" id="pg-protein"${program.highProtein ? ' checked' : ''} /> <span><strong>Plus de protéines</strong><span class="hint">Environ 1,8 g par kilo : rassasie et préserve les muscles, surtout avec du sport.</span></span></label>
          <label class="check check--block"><input type="checkbox" id="pg-fasting"${program.fasting ? ' checked' : ''} /> <span><strong>Jeûne intermittent</strong><span class="hint">Manger dans une fenêtre horaire. Déconseillé en cas de diabète traité, de grossesse ou de troubles alimentaires.</span></span></label>
          <div class="nested" data-fasting${program.fasting ? '' : ' hidden'}>
            <div class="field"><label for="pg-fast-pattern">Rythme du jeûne</label>
              <select id="pg-fast-pattern">${FASTING_PATTERNS.map((f) => `<option value="${f.id}"${(program.fasting?.pattern ?? '16_8') === f.id ? ' selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}</select></div>
            <div class="field"><label for="pg-fast-start">Premier repas vers</label>
              <select id="pg-fast-start">${[7, 8, 9, 10, 11, 12, 13].map((h) => `<option value="${h}"${(program.fasting?.windowStart ?? 12) === h ? ' selected' : ''}>${h} h</option>`).join('')}</select></div>
            <p class="hint" data-window></p>
          </div>
        </fieldset>

        <fieldset class="guided__step"><legend><span class="guided__num" aria-hidden="true">3</span> Mes repas de la journée</legend>
          <p class="hint">De ${MIN_MEALS} à ${MAX_MEALS} repas, goûters compris.</p>
          <div class="checks guided__slots">
            ${PROGRAM_SLOTS.map((s) => `<label class="check"><input type="checkbox" name="meal" value="${s.id}"${chosen.includes(s.id) ? ' checked' : ''} /> <span>${escapeHtml(s.label)}</span></label>`).join('')}
          </div>
          <details class="more-filters" data-count-only${counting ? '' : ' hidden'}>
            <summary>Répartition des calories (total 100 %)</summary>
            <div class="split">${PROGRAM_SLOTS.map(
              (s) => `<label>${escapeHtml(s.label)} <input type="text" inputmode="numeric" maxlength="3" name="split-${s.id}" value="${program.mealSplit[s.id] ?? 0}" /> %</label>`,
            ).join('')}</div>
            <p class="hint">Calculée d’après les repas cochés ; vous pouvez l’ajuster.</p>
          </details>
        </fieldset>

        <fieldset class="guided__step"><legend><span class="guided__num" aria-hidden="true">4</span> Mon rythme</legend>
          ${
            paces
              ? `<table class="pace-table"><thead><tr><th scope="col">Rythme</th><th scope="col">Par semaine</th>${counting ? '<th scope="col">Par jour</th>' : ''}<th scope="col">Objectif vers</th></tr></thead><tbody>
                  ${paces
                    .map(
                      (p) => `<tr${p.allowed ? '' : ' class="pace-table__off"'}>
                        <td><label class="check"><input type="radio" name="pace" value="${p.kg}"${program.weeklyLossKg === p.kg ? ' checked' : ''}${p.allowed ? '' : ' disabled'} /> <span>${escapeHtml(p.label)}</span></label></td>
                        <td>${p.kg > 0 ? `${escapeHtml(formatNumber(p.weeklyLossKg))} kg${p.floorApplied ? ' *' : ''}` : '0 kg'}</td>
                        ${counting ? `<td>${p.kcal} kcal</td>` : ''}
                        <td>${p.goalDate ? escapeHtml(`${formatIsoDayMonth(p.goalDate)} ${p.goalDate.slice(0, 4)}`) : '—'}</td></tr>`,
                    )
                    .join('')}</tbody></table>
                ${paces.some((p) => p.floorApplied && p.kg > 0) ? `<p class="hint">* Limité par le minimum de ${program.sex === 'male' ? MIN_KCAL.male : MIN_KCAL.female} kcal par jour : la perte réelle est plus lente que le rythme demandé.</p>` : ''}`
              : `<p class="hint">Renseignez d’abord vos informations (sexe, année de naissance, taille, poids) pour comparer les rythmes.</p>
                ${[0.25, 0.5, 0.75].map((kg) => `<label class="check"><input type="radio" name="pace" value="${kg}"${program.weeklyLossKg === kg ? ' checked' : ''} /> <span>${escapeHtml(formatNumber(kg))} kg par semaine</span></label>`).join('')}`
          }
        </fieldset>

        <fieldset class="guided__step"><legend><span class="guided__num" aria-hidden="true">5</span> Mon sport</legend>
          <p class="hint">Votre semaine type. Les jours de séance, ${Math.round(SPORT_EAT_BACK * 100)} % des calories dépensées sont ajoutées à vos repères.</p>
          <ol class="sport-rows">${program.sport.map((s, i) => sportRowHtml(i, s)).join('')}</ol>
          <p><button type="button" class="button button--secondary button--small" data-sp-add>+ Ajouter une séance</button></p>
          ${program.sport.length && program.startWeightKg ? `<p class="hint">${program.sport.map((s) => `${WEEKDAYS[s.day]} : environ ${sessionKcal(s, currentKg)} kcal`).join(' · ')}</p>` : ''}
        </fieldset>

        <fieldset class="guided__step"><legend><span class="guided__num" aria-hidden="true">6</span> Ma trame de repas (facultatif)</legend>
          <p class="hint">Recopiez la trame de votre coach ou de votre diététicienne, une ligne par élément (ex. « 120 g de poulet », « 150 g de riz cuit »). Laissez vide pour garder les repères conseillés.</p>
          ${PROGRAM_SLOTS.map(
            (s) => `<div class="field" data-trame="${s.id}"${chosen.includes(s.id) ? '' : ' hidden'}><label for="pg-trame-${s.id}">${escapeHtml(s.label)}</label>
              <textarea id="pg-trame-${s.id}" rows="3" placeholder="${escapeHtml(trame ? trame[s.id].lines.join(' / ') : '')}">${escapeHtml(program.trame[s.id] ?? '')}</textarea></div>`,
          ).join('')}
          <div class="field"><label for="pg-sport-note">Jours de sport (avant, après la séance)</label>
            <textarea id="pg-sport-note" rows="2" placeholder="${escapeHtml(DEFAULT_SPORT_NOTE)}">${escapeHtml(program.sportNote)}</textarea></div>
        </fieldset>

        <div class="form-actions"><button type="submit" class="button">Calculer et enregistrer</button></div>
      </form>
    </section>`;

  const form = /** @type {HTMLFormElement} */ (el.querySelector('[data-form="program"]'));
  /** @param {string} sel */
  const val = (sel) => /** @type {HTMLInputElement | null} */ (el.querySelector(sel))?.value.trim() ?? '';
  /** @param {string} sel */
  const checked = (sel) => Boolean(/** @type {HTMLInputElement | null} */ (el.querySelector(sel))?.checked);

  // --- Interactions du formulaire ---
  const mealBoxes = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('input[name="meal"]')]);
  const fastingBox = /** @type {HTMLElement} */ (form.querySelector('[data-fasting]'));
  const windowHint = /** @type {HTMLElement} */ (form.querySelector('[data-window]'));
  /** Fenetre du jeune : repas hors fenetre decoches et grises. */
  const applyWindow = () => {
    const on = checked('#pg-fasting');
    fastingBox.hidden = !on;
    const fasting = on ? { pattern: /** @type {'12_12' | '14_10' | '16_8'} */ (val('#pg-fast-pattern')), windowStart: Number(val('#pg-fast-start')) } : null;
    const allowed = fasting ? slotsInWindow(fasting) : PROGRAM_SLOTS.map((s) => s.id);
    for (const box of mealBoxes) {
      const ok = allowed.includes(/** @type {ProgramSlot} */ (box.value));
      box.disabled = !ok;
      if (!ok) box.checked = false;
    }
    if (fasting) {
      const w = eatingWindow(fasting);
      windowHint.textContent = `Fenêtre de repas : ${hourText(w.start)} – ${hourText(w.end)}. Repas possibles : ${allowed.map((s) => slotLabel(s).toLowerCase()).join(', ')}.`;
    }
    applyMeals();
  };
  /** Repas coches : repartition recalculee et trames affichees. */
  const applyMeals = () => {
    const slots = /** @type {ProgramSlot[]} */ (mealBoxes.filter((b) => b.checked).map((b) => b.value));
    const split = splitForMeals(slots);
    for (const s of PROGRAM_SLOTS) {
      /** @type {HTMLInputElement} */ (form.elements.namedItem(`split-${s.id}`)).value = String(split[s.id]);
      /** @type {HTMLElement} */ (form.querySelector(`[data-trame="${s.id}"]`)).hidden = !slots.includes(s.id);
    }
  };
  form.querySelector('#pg-fasting')?.addEventListener('change', applyWindow);
  form.querySelector('#pg-fast-pattern')?.addEventListener('change', applyWindow);
  form.querySelector('#pg-fast-start')?.addEventListener('change', applyWindow);
  for (const box of mealBoxes) box.addEventListener('change', applyMeals);
  if (program.fasting) applyWindow();
  for (const radio of form.querySelectorAll('input[name="method"]')) {
    radio.addEventListener('change', () => {
      /** @type {HTMLElement} */ (form.querySelector('[data-count-only]')).hidden = val('input[name="method"]:checked') !== 'count';
    });
  }

  const sportList = /** @type {HTMLElement} */ (form.querySelector('.sport-rows'));
  /** @returns {SportSession[]} */
  const readSport = () =>
    [...sportList.querySelectorAll('.sport-row')].map((row) => ({
      day: Number(/** @type {HTMLSelectElement} */ (row.querySelector('[data-sp="day"]')).value),
      kind: /** @type {HTMLSelectElement} */ (row.querySelector('[data-sp="kind"]')).value,
      minutes: Number(/** @type {HTMLInputElement} */ (row.querySelector('[data-sp="minutes"]')).value.trim()) || 0,
      intensity: /** @type {SportSession['intensity']} */ (/** @type {HTMLSelectElement} */ (row.querySelector('[data-sp="intensity"]')).value),
    }));
  /** @param {SportSession[]} list */
  const drawSport = (list) => {
    sportList.innerHTML = list.map((s, i) => sportRowHtml(i, s)).join('');
    sportList.querySelectorAll('[data-sp-remove]').forEach((b, i) =>
      b.addEventListener('click', () => {
        const next = readSport();
        next.splice(i, 1);
        drawSport(next);
      }),
    );
  };
  drawSport(program.sport);
  form.querySelector('[data-sp-add]')?.addEventListener('click', () => {
    const list = readSport();
    const used = new Set(list.map((s) => s.day));
    list.push({ day: [0, 2, 4, 1, 3, 5, 6].find((d) => !used.has(d)) ?? 0, kind: 'walk', minutes: 45, intensity: 'moderate' });
    drawSport(list);
  });

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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const sex = val('input[name="sex"]:checked');
    const birth = Number(val('#pg-birth'));
    /** @type {Record<ProgramSlot, number>} */
    const split = { breakfast: 0, morning_snack: 0, lunch: 0, snack: 0, dinner: 0 };
    const slots = mealBoxes.filter((b) => b.checked).map((b) => b.value);
    for (const s of PROGRAM_SLOTS) {
      const raw = /** @type {HTMLInputElement} */ (form.elements.namedItem(`split-${s.id}`)).value.trim();
      split[s.id] = slots.includes(s.id) ? (raw === '' ? 0 : Number(raw)) : 0;
    }
    // Sans compter, la repartition n'est pas affichee : elle suit les repas coches.
    const method = val('input[name="method"]:checked') === 'balance' ? 'balance' : 'count';
    const finalSplit = method === 'balance' ? splitForMeals(/** @type {ProgramSlot[]} */ (slots)) : split;
    /** @type {Partial<Record<ProgramSlot, string>>} */
    const trameText = {};
    for (const s of PROGRAM_SLOTS) {
      const text = /** @type {HTMLTextAreaElement} */ (form.querySelector(`#pg-trame-${s.id}`)).value.trim();
      if (text) trameText[s.id] = text;
    }
    const startKg = parseKg(val('#pg-start')) || 0;
    /** @type {Program} */
    const next = {
      ...program,
      memberId: val('#pg-member') || null,
      sex: sex === 'female' || sex === 'male' ? sex : null,
      birthYear: val('#pg-birth') && Number.isInteger(birth) ? birth : null,
      heightCm: Number(val('#pg-height')) || 0,
      startWeightKg: startKg,
      goalWeightKg: parseKg(val('#pg-goal')) || 0,
      activity: /** @type {Program['activity']} */ (val('#pg-activity')),
      weeklyLossKg: Number(val('input[name="pace"]:checked') || program.weeklyLossKg),
      startDate: program.startWeightKg === startKg ? program.startDate : today,
      mealSplit: finalSplit,
      method,
      highProtein: checked('#pg-protein'),
      fasting: checked('#pg-fasting') ? { pattern: /** @type {'12_12' | '14_10' | '16_8'} */ (val('#pg-fast-pattern')), windowStart: Number(val('#pg-fast-start')) } : null,
      sport: readSport(),
      trame: trameText,
      sportNote: val('#pg-sport-note'),
      active: valid ? program.active : true,
    };
    // Stabilisation : le poids vise est le poids actuel.
    if (next.weeklyLossKg === 0 && !(next.goalWeightKg > 0)) next.goalWeightKg = startKg;
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
