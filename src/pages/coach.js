import { escapeHtml } from '../utils/html.js';
import { formatNumber } from '../utils/format.js';
import { SLOTS } from '../domain/planning/planning.js';
import { parseCoachMeal, coachFoodLabel, COACH_SLOT_ORDER } from '../domain/nutrition/coach.js';
import { getCoachPlan, saveCoachPlan, deleteCoachPlan, planFromText, planFromFile, coachEstimates } from '../services/coachService.js';
import { guidedDefaults, planWeek } from '../services/assistantService.js';
import { toIsoDate, weekToPlan } from '../domain/planning/dates.js';

/** @typedef {import('../domain/nutrition/coach.js').CoachPlan} CoachPlan */
/** @typedef {import('../domain/nutrition/coach.js').CoachMeal} CoachMeal */
/** @typedef {import('../domain/nutrition/program.js').ProgramSlot} ProgramSlot */

const slotLabels = new Map(SLOTS.map((s) => [s.id, s.id === 'snack' ? 'Collation de l’après-midi' : s.label]));

/** Programme lu (document ou texte), en attente de verification. */
/** @type {CoachPlan | null} */
let draft = null;

/**
 * Ce que l'application a compris d'un repas.
 * @param {string} text
 * @returns {string}
 */
function understoodHtml(text) {
  const p = parseCoachMeal(text);
  if (p.assembled) {
    const a = p.assembled;
    const part = (/** @type {import('../domain/nutrition/coach.js').CoachItem | null} */ item, /** @type {string} */ label) =>
      item ? `<li><strong>${item.grams !== null ? `${item.grams}${item.gramsMax ? ` à ${item.gramsMax}` : ''} g` : ''}</strong> ${label}${item.cooked ? ' (pesés cuits)' : ''} : ${escapeHtml(item.choices.map(coachFoodLabel).join(', '))}</li>` : '';
    return `<p>Repas composé, varié chaque jour :</p><ul>${part(a.protein, 'de protéines')}${part(a.vegetables, 'de légumes')}${part(a.starch, 'de féculents')}${a.fat ? `<li>${escapeHtml(a.fat.text)}</li>` : ''}</ul>`;
  }
  if (!p.options.length) return '<p>Rien de reconnu : écrivez une ligne par aliment.</p>';
  return `<p>${p.options.length > 1 ? `${p.options.length} possibilités, en alternance :` : 'Menu :'}</p>
    <ol>${p.options.map((o) => `<li>${escapeHtml(o.lines.join(' '))}</li>`).join('')}</ol>`;
}

/**
 * Import et verification du programme du coach (le programme suivi s'affiche dans « Mon programme »).
 * Adresses : #/programme/coach (redirige), #/programme/coach/importer, #/programme/coach/verifier
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderCoach(el, params) {
  const plan = await getCoachPlan();
  if (params.step === 'verifier') return renderReview(el, draft ?? plan);
  if (params.step === 'importer' || !plan) return renderImport(el, plan !== null);
  // Le programme suivi s'affiche dans l'ecran unique « Mon programme ».
  window.location.replace('#/programme');
}

/**
 * Bloc « Programme de mon coach » de l'ecran Mon programme : repas, consignes, actions.
 * @param {CoachPlan} plan
 * @param {import('../domain/nutrition/program.js').Program} program
 * @returns {string}
 */
export function coachBlockHtml(plan, program) {
  const est = coachEstimates(plan);
  const sportMeal = plan.meals.find((m) => m.sportDaysOnly);
  return `
    <section class="coach card-block">
      <h2>Mes repas : programme de mon coach</h2>
      <p><button type="button" class="button" data-action="adapt">Adapter ma semaine à ce programme</button></p>
      <p class="hint" data-adapt-status aria-live="polite">Les repas aux heures du programme sont composés avec ses quantités ; les repas verrouillés et les repas libres restent. Vous vérifiez avant de valider.</p>
      ${
        sportMeal && program.sport.length === 0
          ? `<p class="notice-inline">La ${escapeHtml((slotLabels.get(sportMeal.slot) ?? '').toLowerCase())} ne se prend que les jours de sport : indiquez-les dans « Mes réglages », rubrique « Mon sport », pour qu’elle soit planifiée.</p>`
          : ''
      }
      <ul class="coach-meals">${plan.meals
        .map(
          (m) => `<li><details class="coach-meal">
            <summary><strong>${escapeHtml(slotLabels.get(m.slot) ?? m.slot)}</strong>${m.time ? ` <span class="hint">${escapeHtml(m.time)}</span>` : ''}${m.sportDaysOnly ? ' <span class="badge">Jours de sport</span>' : ''}</summary>
            <div class="coach__understood">${understoodHtml(m.text)}</div>
            ${parseCoachMeal(m.text).extras.map((x) => `<p class="hint">+ ${escapeHtml(x)}</p>`).join('')}</details></li>`,
        )
        .join('')}</ul>
      <dl class="facts">
        <div><dt>Journée type</dt><dd>environ ${formatNumber(est.rest.kcal)} kcal, ${formatNumber(est.rest.protein)} g de protéines</dd></div>
        ${est.sport ? `<div><dt>Jour de sport</dt><dd>environ ${formatNumber(est.sport.kcal)} kcal, ${formatNumber(est.sport.protein)} g de protéines</dd></div>` : ''}
        ${plan.waterLiters ? `<div><dt>Eau</dt><dd>${formatNumber(plan.waterLiters)} L par jour, sans compter l’eau du sport</dd></div>` : ''}
      </dl>
      ${plan.rules.length ? `<details class="proposal__ingredients"><summary>Consignes du coach (${plan.rules.length})</summary><ul>${plan.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul></details>` : ''}
      <p class="form-actions">
        <a class="button button--small button--secondary" href="#/programme/coach/verifier">Modifier</a>
        <a class="button button--small button--secondary" href="#/programme/coach/importer">Nouveau programme</a>
        <button type="button" class="button button--small button--danger" data-action="stop-coach">Ne plus suivre</button>
      </p>
    </section>`;
}

/**
 * Actions du bloc : adapter la semaine, ne plus suivre le programme.
 * @param {HTMLElement} el
 * @param {CoachPlan} plan
 * @param {() => Promise<void>} rerender
 */
export function bindCoachBlock(el, plan, rerender) {
  el.querySelector('[data-action="adapt"]')?.addEventListener('click', async (event) => {
    const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
    const status = /** @type {HTMLElement} */ (el.querySelector('[data-adapt-status]'));
    button.disabled = true;
    status.textContent = 'Je compose votre semaine…';
    // Le week-end, on prepare la semaine suivante (comme « Planifier ma semaine »).
    const week = weekToPlan(toIsoDate(new Date()));
    const { choices } = await guidedDefaults();
    const result = await planWeek(week, { ...choices, slots: plan.meals.map((m) => m.slot), followCoach: true, leftovers: false });
    if (result.proposalId) {
      window.location.hash = `#/assistant/apercu/${week}/${result.proposalId}`;
      return;
    }
    button.disabled = false;
    status.textContent = result.notes.join(' ');
  });
  el.querySelector('[data-action="stop-coach"]')?.addEventListener('click', async () => {
    if (!window.confirm('Ne plus suivre ce programme ? Les repas déjà planifiés restent dans le planning.')) return;
    await deleteCoachPlan();
    await rerender();
  });
}

/**
 * Import : document (lu par l'IA) ou texte colle (lu sur le telephone).
 * @param {HTMLElement} el
 * @param {boolean} replacing
 */
function renderImport(el, replacing) {
  el.innerHTML = `
    <section class="coach">
      <h1 class="page-title">${replacing ? 'Nouveau programme du coach' : 'Programme de mon coach'}</h1>
      <p>Transmettez le programme alimentaire de votre coach ou de votre diététicienne : MealDom le lit, vous vérifiez, puis vos semaines sont composées avec ses repas, ses quantités et ses alternatives.</p>
      <h2>Le document</h2>
      <p class="hint">PDF, photo de la feuille ou capture d’écran. Le document est envoyé à l’IA Claude (votre clé, dans Paramètres) seulement pour être lu ; le programme reste ensuite sur ce téléphone.</p>
      <input id="coach-file" type="file" accept="application/pdf,image/*" class="visually-hidden" />
      <p><label for="coach-file" class="button">Choisir le PDF ou la photo</label></p>
      <p class="status" data-file-status aria-live="polite"></p>
      <h2>Ou le texte</h2>
      <p class="hint">Ouvrez le PDF ou le message, copiez tout le texte et collez-le ici. Lu sur le téléphone, sans IA.</p>
      <div class="field"><label for="coach-text" class="visually-hidden">Texte du programme</label>
        <textarea id="coach-text" rows="8" placeholder="PETIT DÉJEUNER 7H&#10;60 g de flocons d’avoine…&#10;Ou&#10;3 œufs + 2 tranches de pain complet&#10;DÉJEUNER 13H&#10;170 g de protéines (poulet, dinde, poisson…)"></textarea></div>
      <p><button type="button" class="button button--secondary" data-action="text">Lire le texte</button></p>
      <p class="alert" role="alert" hidden></p>
      <p><a href="#/programme">${replacing ? 'Garder le programme actuel' : 'Retour à mon programme'}</a></p>
    </section>`;
  const alert = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  /** @param {string} text */
  const fail = (text) => {
    alert.textContent = text;
    alert.hidden = false;
    alert.scrollIntoView({ block: 'center' });
  };
  el.querySelector('#coach-file')?.addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const file = input.files?.[0];
    if (!file) return;
    const status = /** @type {HTMLElement} */ (el.querySelector('[data-file-status]'));
    alert.hidden = true;
    status.textContent = `Lecture de « ${file.name} »… (jusqu’à une minute)`;
    const { plan, error } = await planFromFile(file);
    status.textContent = '';
    input.value = '';
    if (!plan) return fail(error ?? 'Lecture impossible.');
    draft = plan;
    window.location.hash = '#/programme/coach/verifier';
  });
  el.querySelector('[data-action="text"]')?.addEventListener('click', () => {
    const text = /** @type {HTMLTextAreaElement} */ (el.querySelector('#coach-text')).value;
    if (text.trim().length < 20) return fail('Collez le texte complet du programme.');
    const plan = planFromText(text);
    if (!plan.meals.length) return fail('Aucun repas trouvé : vérifiez que le texte contient les titres des repas (Petit-déjeuner, Collation, Déjeuner, Dîner).');
    draft = plan;
    window.location.hash = '#/programme/coach/verifier';
  });
}

/**
 * Verification et correction avant d'enregistrer.
 * @param {HTMLElement} el
 * @param {CoachPlan | null} plan
 */
function renderReview(el, plan) {
  if (!plan) {
    window.location.hash = '#/programme/coach/importer';
    return;
  }
  /** @type {CoachMeal[]} */
  let meals = plan.meals.map((m) => ({ ...m }));
  const slotOptions = (/** @type {ProgramSlot} */ current) =>
    COACH_SLOT_ORDER.map((s) => `<option value="${s}"${s === current ? ' selected' : ''}>${escapeHtml(slotLabels.get(s) ?? s)}</option>`).join('');
  const mealHtml = (/** @type {CoachMeal} */ m, /** @type {number} */ i) => `
    <fieldset class="field coach__meal" data-meal="${i}">
      <legend>Repas ${i + 1}</legend>
      <div class="field when">
        <select data-slot aria-label="Moment de la journée">${slotOptions(m.slot)}</select>
        <input type="text" data-time value="${escapeHtml(m.time)}" placeholder="Horaire, ex. 13 h" aria-label="Horaire" />
      </div>
      <label class="check"><input type="checkbox" data-sport${m.sportDaysOnly ? ' checked' : ''} /> <span>Seulement les jours de sport</span></label>
      <textarea data-text rows="${Math.min(14, Math.max(4, m.text.split('\n').length + 1))}" aria-label="Contenu du repas">${escapeHtml(m.text)}</textarea>
      <div class="coach__understood" data-understood>${understoodHtml(m.text)}</div>
      <button type="button" class="button button--small button--danger" data-remove>Retirer ce repas</button>
    </fieldset>`;

  el.innerHTML = `
    <section class="coach">
      <h1 class="page-title">Vérifier le programme</h1>
      <p>Comparez avec le document de votre coach et corrigez si besoin. Une ligne par aliment, la quantité en tête ; « Ou » seul sur une ligne entre deux possibilités ; « + » devant un complément commun (« + un thé vert »).</p>
      <form novalidate>
        <div data-meals>${meals.map(mealHtml).join('')}</div>
        <p><button type="button" class="button button--small button--secondary" data-add>Ajouter un repas</button></p>
        <div class="field"><label for="coach-rules">Consignes (une par ligne)</label>
          <textarea id="coach-rules" rows="5">${escapeHtml(plan.rules.join('\n'))}</textarea></div>
        <div class="field when">
          <div><label for="coach-water">Eau par jour (L)</label><input id="coach-water" type="text" inputmode="decimal" value="${plan.waterLiters ?? ''}" /></div>
          <div><label for="coach-check">Bilan toutes les (semaines)</label><input id="coach-check" type="text" inputmode="numeric" value="${plan.checkInWeeks ?? ''}" /></div>
        </div>
        <p class="alert" role="alert" hidden></p>
        <div class="form-actions"><button type="submit" class="button">Enregistrer et suivre ce programme</button></div>
      </form>
    </section>`;

  const list = /** @type {HTMLElement} */ (el.querySelector('[data-meals]'));
  /** Relit les repas du formulaire. */
  const read = () =>
    [...list.querySelectorAll('[data-meal]')].map((f) => ({
      slot: /** @type {ProgramSlot} */ (/** @type {HTMLSelectElement} */ (f.querySelector('[data-slot]')).value),
      time: /** @type {HTMLInputElement} */ (f.querySelector('[data-time]')).value.trim(),
      sportDaysOnly: /** @type {HTMLInputElement} */ (f.querySelector('[data-sport]')).checked,
      text: /** @type {HTMLTextAreaElement} */ (f.querySelector('[data-text]')).value.trim(),
    }));
  list.addEventListener('input', (event) => {
    const area = /** @type {HTMLElement} */ (event.target);
    if (!area.hasAttribute('data-text')) return;
    const box = area.closest('[data-meal]')?.querySelector('[data-understood]');
    if (box) box.innerHTML = understoodHtml(/** @type {HTMLTextAreaElement} */ (area).value);
  });
  list.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target);
    if (!button.hasAttribute('data-remove')) return;
    meals = read().filter((_, i) => i !== Number(button.closest('[data-meal]')?.getAttribute('data-meal')));
    list.innerHTML = meals.map(mealHtml).join('');
  });
  el.querySelector('[data-add]')?.addEventListener('click', () => {
    meals = read();
    const free = COACH_SLOT_ORDER.find((s) => !meals.some((m) => m.slot === s)) ?? 'snack';
    meals.push({ slot: free, time: '', sportDaysOnly: false, text: '' });
    list.innerHTML = meals.map(mealHtml).join('');
  });
  el.querySelector('form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const waterText = /** @type {HTMLInputElement} */ (el.querySelector('#coach-water')).value.trim().replace(',', '.');
    const checkText = /** @type {HTMLInputElement} */ (el.querySelector('#coach-check')).value.trim();
    /** @type {CoachPlan} */
    const next = {
      ...plan,
      meals: read()
        .map((m) => ({ ...m, sportDaysOnly: m.sportDaysOnly && m.slot === 'snack' }))
        .sort((a, b) => COACH_SLOT_ORDER.indexOf(a.slot) - COACH_SLOT_ORDER.indexOf(b.slot)),
      rules: /** @type {HTMLTextAreaElement} */ (el.querySelector('#coach-rules')).value.split('\n').map((r) => r.trim()).filter(Boolean),
      waterLiters: waterText ? Number(waterText) : null,
      checkInWeeks: checkText ? Number(checkText) : null,
    };
    const errors = await saveCoachPlan(next);
    const alert = /** @type {HTMLElement} */ (el.querySelector('.alert'));
    if (errors.length) {
      alert.innerHTML = errors.map((e) => escapeHtml(e)).join('<br />');
      alert.hidden = false;
      alert.scrollIntoView({ block: 'center' });
      return;
    }
    draft = null;
    window.location.hash = '#/programme';
  });
}
