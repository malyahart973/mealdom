import { escapeHtml } from '../utils/html.js';
import { formatIsoDay, formatIsoDayMonth } from '../utils/format.js';
import { formatCents, parseAmountToCents, centsToInput } from '../domain/budget/money.js';
import { SLOTS } from '../domain/planning/planning.js';
import { toIsoDate, weekStart, addDays, parseIsoDate } from '../domain/planning/dates.js';
import { WISHES, TIME_CHOICES } from '../domain/assistant/guided.js';
import { REGIONS } from '../data/cuisines.js';
import { getHousehold } from '../services/householdService.js';
import { setShowBreakfast, setShowSnack } from '../services/planningService.js';
import {
  guidedDefaults,
  planWeek,
  previewProposal,
  swapProposalMeal,
  dropProposalMeal,
  acceptProposal,
  rejectProposal,
  weekHistory,
  undoChange,
} from '../services/assistantService.js';

/** @typedef {import('../domain/planning/planning.js').Slot} Slot */
/** @typedef {import('../domain/assistant/guided.js').GuidedChoices} GuidedChoices */

/**
 * Parcours guide, etape des choix.
 * Adresses : #/assistant/planifier, #/assistant/planifier/AAAA-MM-JJ
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderPlanWeek(el, params) {
  const today = toIsoDate(new Date());
  const thisMonday = weekStart(today);
  // Le week-end, on prepare plutot la semaine suivante.
  const weekend = new Date().getDay() === 0 || new Date().getDay() === 6;
  const monday = params.date && parseIsoDate(params.date) ? weekStart(params.date) : weekend ? addDays(thisMonday, 7) : thisMonday;
  const household = await getHousehold();
  if (household.members.length === 0) {
    el.innerHTML = `<section><h1 class="page-title">Planifier ma semaine</h1>
      <p>Pour proposer des repas adaptés (allergies, régimes, portions), l’application doit connaître votre foyer.</p>
      <a class="button" href="#/foyer">Présenter mon foyer</a></section>`;
    return;
  }
  const { choices, weeklyBudgetCents, programActive } = await guidedDefaults();
  const weeks = [thisMonday, addDays(thisMonday, 7)];
  if (!weeks.includes(monday)) weeks.push(monday);
  const weekLabel = (/** @type {string} */ m) => (m === thisMonday ? 'Cette semaine (à partir d’aujourd’hui)' : `Semaine du ${formatIsoDayMonth(m)}`);

  el.innerHTML = `
    <section class="guided">
      <h1 class="page-title">Planifier ma semaine</h1>
      <p class="hint">Trois questions, puis vous voyez votre semaine et vous changez ce qui ne vous plaît pas avant de valider.</p>
      <form class="guided__form" novalidate>
        <fieldset class="guided__step">
          <legend><span class="guided__num" aria-hidden="true">1</span> Quels repas ?</legend>
          <div class="radios">
            ${weeks.map((m) => `<label class="check"><input type="radio" name="week" value="${m}"${m === monday ? ' checked' : ''} /> <span>${escapeHtml(weekLabel(m))}</span></label>`).join('')}
          </div>
          <div class="checks guided__slots">
            ${SLOTS.map((s) => `<label class="check"><input type="checkbox" name="slot" value="${s.id}"${choices.slots.includes(s.id) ? ' checked' : ''} /> <span>${escapeHtml(s.label)}</span></label>`).join('')}
          </div>
          <div class="radios">
            <label class="check"><input type="radio" name="keep" value="keep"${choices.keepExisting ? ' checked' : ''} /> <span>Garder les repas déjà prévus</span></label>
            <label class="check"><input type="radio" name="keep" value="redo"${choices.keepExisting ? '' : ' checked'} /> <span>Tout refaire (sauf les repas verrouillés)</span></label>
          </div>
        </fieldset>

        <fieldset class="guided__step">
          <legend><span class="guided__num" aria-hidden="true">2</span> Quel budget ?</legend>
          <div class="field">
            <label for="g-budget">Budget des courses de la semaine (€)</label>
            <input id="g-budget" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 80" value="${weeklyBudgetCents !== null ? escapeHtml(centsToInput(weeklyBudgetCents)) : ''}" />
          </div>
          <p class="hint">Laissez vide si vous n’avez pas de budget. Les prix ne sont jamais inventés : seuls vos prix relevés et ceux du Drive sont comptés.</p>
        </fieldset>

        <fieldset class="guided__step">
          <legend><span class="guided__num" aria-hidden="true">3</span> Combien de temps, quelles envies ?</legend>
          <p class="guided__label">Temps de cuisine par repas</p>
          <div class="chips" role="radiogroup" aria-label="Temps de cuisine par repas">
            ${TIME_CHOICES.map((t) => `<button type="button" class="chip" role="radio" data-time="${t.minutes ?? ''}" aria-checked="${t.minutes === choices.maxMinutes}" aria-pressed="${t.minutes === choices.maxMinutes}">${escapeHtml(t.label)}</button>`).join('')}
          </div>
          <p class="guided__label">Envies (plusieurs possibles)</p>
          <div class="chips">
            ${WISHES.map((w) => `<button type="button" class="chip" data-wish="${w.id}" aria-pressed="${choices.wishes.includes(w.id)}">${escapeHtml(w.label)}</button>`).join('')}
          </div>
          ${programActive ? '<p class="hint">Votre programme minceur est actif : « Léger » tient compte de vos objectifs par repas.</p>' : ''}
          <div class="field">
            <label for="g-region">Cuisine</label>
            <select id="g-region">
              <option value="">Toutes les cuisines (variées)</option>
              ${REGIONS.map((r) => `<option value="${r.id}"${r.id === choices.region ? ' selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}
            </select>
          </div>
        </fieldset>

        <p class="alert" role="alert" hidden></p>
        <p class="status" aria-live="polite"></p>
        <div class="form-actions">
          <button type="submit" class="button">Voir ma semaine</button>
          <a class="button button--secondary" href="#/assistant/semaine/${monday}">Écrire une demande libre</a>
        </div>
      </form>
    </section>`;

  const form = /** @type {HTMLFormElement} */ (el.querySelector('form'));
  const alert = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  const status = /** @type {HTMLElement} */ (el.querySelector('.status'));
  /** @type {number | null} */
  let maxMinutes = choices.maxMinutes;
  el.querySelectorAll('[data-time]').forEach((b) =>
    b.addEventListener('click', () => {
      const value = b.getAttribute('data-time');
      maxMinutes = value ? Number(value) : null;
      el.querySelectorAll('[data-time]').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
        x.setAttribute('aria-checked', String(x === b));
      });
    }),
  );
  el.querySelectorAll('[data-wish]').forEach((b) =>
    b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.hidden = true;
    const data = new FormData(form);
    const slots = /** @type {Slot[]} */ (data.getAll('slot').map(String));
    if (!slots.length) return showAlert('Cochez au moins un repas à planifier.');
    const budgetText = /** @type {HTMLInputElement} */ (el.querySelector('#g-budget')).value.trim();
    let budgetCents = null;
    if (budgetText) {
      const cents = parseAmountToCents(budgetText);
      if (!Number.isFinite(cents) || cents <= 0) return showAlert('Le budget doit être un montant, par exemple 80 ou 75,50.');
      if (cents !== weeklyBudgetCents) budgetCents = cents;
    }
    /** @type {GuidedChoices} */
    const picked = {
      slots,
      keepExisting: data.get('keep') !== 'redo',
      budgetCents,
      maxMinutes,
      wishes: [...el.querySelectorAll('[data-wish][aria-pressed="true"]')].map((b) => b.getAttribute('data-wish') ?? ''),
      region: /** @type {HTMLSelectElement} */ (el.querySelector('#g-region')).value || null,
    };
    const week = String(data.get('week') ?? monday);
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('[type="submit"]'));
    button.disabled = true;
    status.textContent = 'Je compose votre semaine…';
    try {
      const result = await planWeek(week, picked);
      if (result.proposalId) {
        window.location.hash = `#/assistant/apercu/${week}/${result.proposalId}`;
        return;
      }
      showAlert(result.notes.join(' '));
    } finally {
      button.disabled = false;
      status.textContent = '';
    }
  });

  /** @param {string} text */
  function showAlert(text) {
    alert.textContent = text;
    alert.hidden = false;
    alert.scrollIntoView({ block: 'center' });
  }
}

/**
 * Parcours guide, apercu de la semaine proposee.
 * Adresse : #/assistant/apercu/AAAA-MM-JJ/<proposition>
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderWeekPreview(el, params) {
  const monday = weekStart(params.date);
  const data = await previewProposal(monday, params.proposalId);
  if (!data) {
    el.innerHTML = `<section><h1 class="page-title">Votre semaine</h1><p>Cette proposition n’existe plus.</p>
      <a class="button" href="#/assistant/planifier/${monday}">Planifier ma semaine</a></section>`;
    return;
  }
  const { proposal, review, days } = data;

  if (proposal.status === 'accepted') {
    const entry = (await weekHistory(monday)).find((h) => h.proposalId === proposal.id && !h.undone);
    el.innerHTML = `
      <section class="guided">
        <h1 class="page-title">C’est fait !</h1>
        <p class="guided__done">Votre semaine est dans le planning. La liste de courses et le panier Drive sont recalculés.</p>
        <div class="form-actions">
          <a class="button" href="#/planning/semaine/${monday}">Voir le planning</a>
          <a class="button button--secondary" href="#/courses/semaine/${monday}">Liste de courses</a>
          <a class="button button--secondary" href="#/batch/semaine/${monday}">Batch cooking</a>
        </div>
        ${entry ? '<p><button type="button" class="button button--danger" data-undo>Annuler ce changement</button></p>' : ''}
        <p class="status" aria-live="polite"></p>
      </section>`;
    el.querySelector('[data-undo]')?.addEventListener('click', async () => {
      if (!entry) return;
      const result = await undoChange(entry.id);
      /** @type {HTMLElement} */ (el.querySelector('.status')).textContent = result.message;
      /** @type {HTMLElement} */ (el.querySelector('[data-undo]')).hidden = true;
    });
    return;
  }
  if (proposal.status !== 'pending' || !review) {
    el.innerHTML = `<section><h1 class="page-title">Votre semaine</h1>
      <p>Cette proposition n’est plus valable (le planning a changé ou elle a été abandonnée).</p>
      <a class="button" href="#/assistant/planifier/${monday}">Recommencer</a></section>`;
    return;
  }

  const fresh = days.flatMap((d) => d.meals).filter((m) => m.changed && m.recipeId);
  const kcals = fresh.map((m) => m.kcal).filter((k) => k !== null);
  const avgKcal = kcals.length ? Math.round(kcals.reduce((a, b) => a + /** @type {number} */ (b), 0) / kcals.length) : null;
  const c = review.cost;
  const budget = review.budget.afterBudgetCents;

  el.innerHTML = `
    <section class="guided">
      <h1 class="page-title">Votre semaine</h1>
      <p class="guided__summary"><strong>${fresh.length} repas proposé${fresh.length > 1 ? 's' : ''}</strong>${avgKcal !== null ? ` · environ ${avgKcal} kcal par portion` : ''}</p>
      ${costHtml(c.afterCents, c.missingAfter, budget)}
      <p class="hint">Touchez « Changer » pour une autre idée, « Retirer » pour laisser le repas libre. Rien n’est enregistré avant « Valider ».</p>
      <div class="form-actions"><button type="button" class="button" data-validate>Valider ma semaine</button></div>
      <p class="status" aria-live="polite"></p>
      <ol class="week guided__week">
        ${days
          .map(
            (d) => `
          <li class="day">
            <h2 class="day__title">${escapeHtml(formatIsoDay(d.date))}</h2>
            <ul class="gmeals">
              ${d.meals.map((m) => mealHtml(d.date, m)).join('')}
            </ul>
          </li>`,
          )
          .join('')}
      </ol>
      <div class="form-actions">
        <button type="button" class="button" data-validate>Valider ma semaine</button>
        <a class="button button--secondary" href="#/assistant/planifier/${monday}">Modifier mes choix</a>
        <button type="button" class="button button--danger" data-abandon>Abandonner</button>
      </div>
    </section>`;

  const status = /** @type {HTMLElement} */ (el.querySelector('.status'));
  const rerender = () => renderWeekPreview(el, params);
  /** @param {string} text */
  const busy = (text) => {
    status.textContent = text;
    el.querySelectorAll('button').forEach((b) => (/** @type {HTMLButtonElement} */ (b).disabled = true));
  };

  el.querySelectorAll('[data-swap]').forEach((b) =>
    b.addEventListener('click', async () => {
      const [date, slot] = /** @type {[string, Slot]} */ ((b.getAttribute('data-swap') ?? '').split('|'));
      busy('Je cherche une autre idée…');
      const result = await swapProposalMeal(monday, proposal.id, date, slot);
      await rerender();
      /** @type {HTMLElement} */ (el.querySelector('.status')).textContent = result.message;
    }),
  );
  el.querySelectorAll('[data-drop]').forEach((b) =>
    b.addEventListener('click', async () => {
      const [date, slot] = /** @type {[string, Slot]} */ ((b.getAttribute('data-drop') ?? '').split('|'));
      busy('');
      const result = await dropProposalMeal(monday, proposal.id, date, slot);
      await rerender();
      /** @type {HTMLElement} */ (el.querySelector('.status')).textContent = result.message;
    }),
  );
  el.querySelectorAll('[data-validate]').forEach((b) =>
    b.addEventListener('click', async () => {
      busy('Enregistrement de votre semaine…');
      const result = await acceptProposal(monday, proposal.id, { confirmedBigChange: true });
      if (result.ok) {
        const slots = proposal.request?.slots ?? [];
        if (slots.includes('breakfast')) await setShowBreakfast(true);
        if (slots.includes('snack')) await setShowSnack(true);
      }
      await rerender();
      if (!result.ok) /** @type {HTMLElement} */ (el.querySelector('.status')).textContent = result.message;
    }),
  );
  el.querySelector('[data-abandon]')?.addEventListener('click', async () => {
    await rejectProposal(monday, proposal.id);
    window.location.hash = `#/planning/semaine/${monday}`;
  });
}

/**
 * @param {string} date
 * @param {{ slot: Slot, slotLabel: string, recipeId: string | null, recipeName: string | null, minutes: number | null, kcal: number | null, changed: boolean, reason: string | null, locked: boolean }} m
 * @returns {string}
 */
function mealHtml(date, m) {
  const key = `${date}|${m.slot}`;
  if (!m.recipeId) {
    return `<li class="gmeal gmeal--empty"><span class="gmeal__slot">${escapeHtml(m.slotLabel)}</span><span class="gmeal__name">Libre</span></li>`;
  }
  const meta = [m.minutes !== null ? `${m.minutes} min` : '', m.kcal !== null ? `${m.kcal} kcal` : ''].filter(Boolean).join(' · ');
  return `<li class="gmeal${m.changed ? ' gmeal--new' : ''}">
    <span class="gmeal__slot">${escapeHtml(m.slotLabel)}${m.changed ? '' : ` · ${m.locked ? 'verrouillé' : 'déjà prévu'}`}</span>
    <a class="gmeal__name" href="#/recettes/${encodeURIComponent(m.recipeId)}">${escapeHtml(m.recipeName ?? '')}</a>
    ${meta ? `<span class="gmeal__meta">${escapeHtml(meta)}</span>` : ''}
    ${m.changed && why(m.reason) ? `<span class="gmeal__why">${escapeHtml(why(m.reason))}</span>` : ''}
    ${
      m.locked
        ? ''
        : `<span class="gmeal__actions">
            <button type="button" class="button button--small button--secondary" data-swap="${key}">Changer</button>
            ${m.changed ? `<button type="button" class="button button--small button--danger" data-drop="${key}">Retirer</button>` : ''}
          </span>`
    }
  </li>`;
}

/**
 * Raison affichee sous le plat, sans repeter les calories deja indiquees.
 * @param {string | null} reason
 * @returns {string}
 */
function why(reason) {
  if (!reason) return '';
  const parts = reason.replace(/\.$/, '').split(', ').filter((p) => !/^environ \d+ kcal la portion$/.test(p));
  return parts.length ? `${parts.join(', ')}.` : '';
}

/**
 * Cout des courses : seulement ce que les prix connus permettent de dire.
 * @param {number} afterCents
 * @param {number} missing
 * @param {number | null} budgetCents
 * @returns {string}
 */
function costHtml(afterCents, missing, budgetCents) {
  if (afterCents === 0) {
    return `<p class="notice-inline">Aucun prix enregistré pour ces courses : je ne peux pas les chiffrer. <a href="#/magasins">Ajouter des prix</a></p>`;
  }
  const over = budgetCents !== null && afterCents > budgetCents;
  return `<p class="${over ? 'notice-inline' : ''}">Courses estimées : <strong>${escapeHtml(formatCents(afterCents))}</strong>${
    missing ? ` <span class="hint">(${missing} article${missing > 1 ? 's' : ''} sans prix, non compté${missing > 1 ? 's' : ''})</span>` : ''
  }${budgetCents !== null ? ` · budget ${escapeHtml(formatCents(budgetCents))}` : ''}${
    over ? '. Au-dessus du budget : après validation, « Ajuster au budget » dans l’assistant propose des économies.' : ''
  }</p>`;
}
