import { escapeHtml } from '../utils/html.js';
import { formatIsoDay } from '../utils/format.js';
import { formatCents, parseAmountToCents, centsToInput } from '../domain/budget/money.js';
import { monthSummary, weekSummary } from '../domain/budget/budget.js';
import { toIsoDate, weekDays, weekStart } from '../domain/planning/dates.js';
import { getBudget, saveBudget, getExpenses, saveExpense, deleteExpense, getStores, weekShoppingEstimate } from '../services/budgetService.js';
import { newId } from '../services/shoppingService.js';

const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

/**
 * "octobre 2026" a partir de "2026-10".
 * @param {string} month
 * @returns {string}
 */
function formatMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return monthLabel.format(new Date(y, m - 1, 1));
}

/**
 * @param {string} month AAAA-MM
 * @param {number} delta
 * @returns {string}
 */
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Montant facultatif saisi : vide = aucun, sinon centimes (NaN si invalide).
 * @param {string} text
 * @returns {number | null}
 */
function optionalAmount(text) {
  return text.trim() === '' ? null : parseAmountToCents(text);
}

/**
 * Ecran Budget : budget du mois, depenses reelles, estimation des courses.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderBudget(el, params) {
  const today = toIsoDate(new Date());
  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : today.slice(0, 7);
  const monday = weekStart(today);
  const [budget, expenses, stores, week] = await Promise.all([getBudget(), getExpenses(), getStores(), weekShoppingEstimate(monday)]);
  const summary = monthSummary(budget, expenses, month, today);
  const thisWeek = weekSummary(budget, expenses, weekDays(monday));
  const monthExpenses = expenses.filter((e) => e.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  const exceptional = budget.exceptional.filter((x) => x.month === month);
  const { estimate } = week;
  const toBuyCount = week.lines.filter((l) => !l.covered && l.toBuy !== null).length;

  /** @param {number | null} cents */
  const money = (cents) => (cents === null ? 'non défini' : formatCents(cents));

  el.innerHTML = `
    <section>
      <h1 class="page-title">Budget</h1>
      <nav class="week-nav" aria-label="Changer de mois">
        <a href="#/budget/mois/${shiftMonth(month, -1)}" aria-label="Mois précédent">‹</a>
        <span>${escapeHtml(formatMonth(month))}</span>
        <a href="#/budget/mois/${shiftMonth(month, 1)}" aria-label="Mois suivant">›</a>
      </nav>

      <dl class="budget-card">
        <div><dt>Budget du mois</dt><dd>${escapeHtml(money(summary.budgetCents))}</dd></div>
        <div><dt>Dépensé</dt><dd>${escapeHtml(formatCents(summary.spentCents))}</dd></div>
        <div class="${summary.remainingCents !== null && summary.remainingCents < 0 ? 'over' : ''}"><dt>Reste</dt><dd>${escapeHtml(money(summary.remainingCents))}</dd></div>
        ${summary.forecastCents !== null ? `<div><dt>À ce rythme, fin du mois</dt><dd>${escapeHtml(formatCents(summary.forecastCents))}</dd></div>` : ''}
      </dl>

      ${
        month === today.slice(0, 7)
          ? `<h2>Cette semaine</h2>
      <p>${
        week.mealCount === 0
          ? 'Aucun repas planifié : pas d’estimation des courses.'
          : toBuyCount === 0
            ? 'Tout est déjà à la maison pour les repas planifiés.'
            : estimate.complete
              ? `Courses prévues : environ <strong>${escapeHtml(formatCents(estimate.totalCents))}</strong> avec les prix connus les moins chers.`
              : `Courses prévues : au moins <strong>${escapeHtml(formatCents(estimate.totalCents))}</strong>. Prix inconnu pour ${estimate.missing.length} article${estimate.missing.length > 1 ? 's' : ''} sur ${toBuyCount} : l’estimation est incomplète.`
      }</p>
      ${
        thisWeek.budgetCents !== null
          ? `<p>Budget de la semaine : ${escapeHtml(formatCents(thisWeek.budgetCents))}, déjà dépensé ${escapeHtml(formatCents(thisWeek.spentCents))}, reste ${escapeHtml(formatCents(/** @type {number} */ (thisWeek.remainingCents)))}.</p>`
          : ''
      }
      <p><a href="#/magasins">Saisir des prix dans mes magasins</a></p>`
          : ''
      }

      <h2>Dépenses réelles</h2>
      <div class="alert" role="alert" hidden></div>
      <form class="stock-form" data-form="expense" novalidate>
        <div class="field when">
          <div>
            <label for="expense-amount">Montant du ticket (€)</label>
            <input id="expense-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 42,50" />
          </div>
          <div>
            <label for="expense-date">Date</label>
            <input id="expense-date" type="date" value="${month === today.slice(0, 7) ? today : `${month}-01`}" />
          </div>
        </div>
        <div class="field">
          <label for="expense-store">Magasin</label>
          <select id="expense-store">
            <option value="">Non précisé</option>
            ${stores.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="expense-note">Note (facultatif)</label>
          <input id="expense-note" type="text" maxlength="80" autocomplete="off" />
        </div>
        <button type="submit" class="button">Ajouter la dépense</button>
      </form>
      ${
        monthExpenses.length
          ? `<ul class="shop">${monthExpenses
              .map(
                (e) => `<li>
            <span class="shop__item"><span><strong>${escapeHtml(formatCents(e.amountCents))}</strong>
              <span class="hint">${escapeHtml(formatIsoDay(e.date))}${e.storeName ? `, ${escapeHtml(e.storeName)}` : ''}${e.note ? `, ${escapeHtml(e.note)}` : ''}</span></span></span>
            <button type="button" class="icon-button" data-remove-expense="${escapeHtml(e.id)}" aria-label="Supprimer cette dépense">×</button>
          </li>`,
              )
              .join('')}</ul>`
          : '<p class="empty">Aucune dépense enregistrée ce mois-ci.</p>'
      }

      <h2>Mon budget</h2>
      <form class="stock-form" data-form="budget" novalidate>
        <div class="field when">
          <div>
            <label for="budget-monthly">Par mois (€)</label>
            <input id="budget-monthly" type="text" inputmode="decimal" autocomplete="off" value="${budget.monthlyCents === null ? '' : centsToInput(budget.monthlyCents)}" />
          </div>
          <div>
            <label for="budget-weekly">Par semaine (€)</label>
            <input id="budget-weekly" type="text" inputmode="decimal" autocomplete="off" value="${budget.weeklyCents === null ? '' : centsToInput(budget.weeklyCents)}" />
          </div>
        </div>
        <p class="hint">Laissez vide si vous n’en avez pas.</p>
        <button type="submit" class="button">Enregistrer</button>
      </form>

      <h3>Budget exceptionnel en ${escapeHtml(formatMonth(month))}</h3>
      <p class="hint">Un anniversaire, des invités : une somme en plus pour ce mois seulement.</p>
      ${
        exceptional.length
          ? `<ul class="shop">${exceptional
              .map(
                (x, i) => `<li><span class="shop__item"><span><strong>${escapeHtml(formatCents(x.amountCents))}</strong>
              <span class="hint">${escapeHtml(x.label)}</span></span></span>
              <button type="button" class="icon-button" data-remove-exceptional="${i}" aria-label="Retirer">×</button></li>`,
              )
              .join('')}</ul>`
          : ''
      }
      <form class="stock-form" data-form="exceptional" novalidate>
        <div class="field when">
          <div>
            <label for="exc-label">Pour quoi ?</label>
            <input id="exc-label" type="text" maxlength="40" autocomplete="off" placeholder="ex. anniversaire" />
          </div>
          <div>
            <label for="exc-amount">Montant (€)</label>
            <input id="exc-amount" type="text" inputmode="decimal" autocomplete="off" />
          </div>
        </div>
        <button type="submit" class="button button--secondary">Ajouter</button>
      </form>
      <p class="status" aria-live="polite"></p>
    </section>
  `;

  const section = /** @type {HTMLElement} */ (el.querySelector('section'));
  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  /** @param {string} sel */
  const value = (sel) => /** @type {HTMLInputElement} */ (el.querySelector(sel)).value;
  /** @param {string[]} errors */
  const showErrors = (errors) => {
    alertBox.hidden = errors.length === 0;
    alertBox.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
    if (errors.length) alertBox.scrollIntoView({ block: 'center' });
  };

  el.querySelector('[data-form="expense"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const storeId = value('#expense-store') || null;
    const errors = await saveExpense({
      id: newId(),
      date: value('#expense-date'),
      storeId,
      storeName: stores.find((s) => s.id === storeId)?.name ?? '',
      amountCents: parseAmountToCents(value('#expense-amount')),
      note: value('#expense-note'),
    });
    if (errors.length) return showErrors(errors);
    await renderBudget(el, params);
  });

  el.querySelector('[data-form="budget"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const monthlyCents = optionalAmount(value('#budget-monthly'));
    const weeklyCents = optionalAmount(value('#budget-weekly'));
    if (Number.isNaN(monthlyCents) || Number.isNaN(weeklyCents)) return showErrors(['Montant invalide : écrivez par exemple 450 ou 450,50.']);
    await saveBudget({ ...budget, monthlyCents, weeklyCents });
    await renderBudget(el, params);
  });

  el.querySelector('[data-form="exceptional"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amountCents = parseAmountToCents(value('#exc-amount'));
    const label = value('#exc-label').trim();
    if (!label || !Number.isInteger(amountCents) || amountCents <= 0) {
      return showErrors(['Indiquez à quoi sert ce budget et son montant.']);
    }
    await saveBudget({ ...budget, exceptional: [...budget.exceptional, { month, label, amountCents }] });
    await renderBudget(el, params);
  });

  section.addEventListener('click', async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const expenseId = target.getAttribute('data-remove-expense');
    const excIndex = target.getAttribute('data-remove-exceptional');
    if (expenseId) {
      if (!window.confirm('Supprimer cette dépense ?')) return;
      await deleteExpense(expenseId);
      await renderBudget(el, params);
    } else if (excIndex !== null) {
      const removed = exceptional[Number(excIndex)];
      await saveBudget({ ...budget, exceptional: budget.exceptional.filter((x) => x !== removed) });
      await renderBudget(el, params);
    }
  });
}
