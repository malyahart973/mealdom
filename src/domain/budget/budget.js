/**
 * Budget alimentaire : budget prevu, depenses reelles, reste, prevision.
 * Tout est en centimes entiers.
 */
import { parseIsoDate } from '../planning/dates.js';

/**
 * @typedef {Object} Budget
 * @property {'main'} id
 * @property {number | null} monthlyCents
 * @property {number | null} weeklyCents
 * @property {{ month: string, label: string, amountCents: number }[]} exceptional  Budgets exceptionnels (AAAA-MM)
 */

/**
 * Depense reellement payee (montant du ticket), saisie a la main.
 * @typedef {Object} Expense
 * @property {string} id
 * @property {string} date          AAAA-MM-JJ
 * @property {string | null} storeId
 * @property {string} storeName     Copie du nom : l'historique reste lisible si le magasin est supprime
 * @property {number} amountCents
 * @property {string} note
 */

/** @returns {Budget} */
export function createDefaultBudget() {
  return { id: 'main', monthlyCents: null, weeklyCents: null, exceptional: [] };
}

/**
 * @param {Expense} expense
 * @returns {string[]}
 */
export function validateExpense(expense) {
  /** @type {string[]} */
  const errors = [];
  if (!parseIsoDate(expense.date)) errors.push('Indiquez la date des courses.');
  if (!Number.isInteger(expense.amountCents) || expense.amountCents <= 0) errors.push('Indiquez le montant payé, par exemple 42,50.');
  if (expense.note.length > 80) errors.push('La note est trop longue (80 caractères au plus).');
  return errors;
}

/**
 * Nombre de jours d'un mois "AAAA-MM".
 * @param {string} month
 * @returns {number}
 */
function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Bilan du mois.
 * - budget = budget mensuel + budgets exceptionnels du mois ;
 * - depense = somme des depenses reelles du mois ;
 * - reste = budget - depense (peut etre negatif) ;
 * - prevision = depense / jours ecoules x jours du mois (au rythme actuel).
 * @param {Budget} budget
 * @param {Expense[]} expenses
 * @param {string} month          AAAA-MM
 * @param {string} today          AAAA-MM-JJ
 * @returns {{ budgetCents: number | null, spentCents: number, remainingCents: number | null, forecastCents: number | null, exceptionalCents: number }}
 */
export function monthSummary(budget, expenses, month, today) {
  const spentCents = expenses.filter((e) => e.date.startsWith(month)).reduce((sum, e) => sum + e.amountCents, 0);
  const exceptionalCents = budget.exceptional.filter((x) => x.month === month).reduce((sum, x) => sum + x.amountCents, 0);
  const budgetCents = budget.monthlyCents === null ? (exceptionalCents > 0 ? exceptionalCents : null) : budget.monthlyCents + exceptionalCents;

  let forecastCents = null;
  if (today.startsWith(month) && spentCents > 0) {
    const elapsed = Number(today.slice(8, 10));
    forecastCents = Math.round((spentCents / elapsed) * daysInMonth(month));
  }
  return {
    budgetCents,
    spentCents,
    remainingCents: budgetCents === null ? null : budgetCents - spentCents,
    forecastCents,
    exceptionalCents,
  };
}

/**
 * Bilan d'une semaine (lundi a dimanche).
 * @param {Budget} budget
 * @param {Expense[]} expenses
 * @param {string[]} days        Les 7 jours de la semaine
 * @returns {{ budgetCents: number | null, spentCents: number, remainingCents: number | null }}
 */
export function weekSummary(budget, expenses, days) {
  const set = new Set(days);
  const spentCents = expenses.filter((e) => set.has(e.date)).reduce((sum, e) => sum + e.amountCents, 0);
  return {
    budgetCents: budget.weeklyCents,
    spentCents,
    remainingCents: budget.weeklyCents === null ? null : budget.weeklyCents - spentCents,
  };
}
