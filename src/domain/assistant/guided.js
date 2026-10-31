/**
 * Parcours guide « Planifier ma semaine » : quelques choix simples (repas, budget,
 * temps, envies) traduits en une demande comprise par le moteur, sans phrase a ecrire.
 */
import { emptyRequest } from './intent.js';

/** @typedef {import('./intent.js').Request} Request */
/** @typedef {import('./intent.js').Mode} Mode */
/** @typedef {import('../planning/planning.js').Slot} Slot */

/**
 * Envies proposees en boutons (plusieurs possibles).
 * @type {{ id: string, label: string, modes: Mode[] }[]}
 */
export const WISHES = [
  { id: 'light', label: 'Léger', modes: ['light'] },
  { id: 'protein', label: 'Riche en protéines', modes: ['protein'] },
  { id: 'economy', label: 'Économique', modes: ['economy'] },
  { id: 'gourmand', label: 'Gourmand', modes: ['gourmand'] },
  { id: 'vegetables', label: 'Plus de légumes', modes: ['vegetables'] },
  { id: 'seasonal', label: 'De saison et péyi', modes: ['seasonal'] },
  { id: 'promotions', label: 'Promotions du Drive', modes: ['promotions'] },
  { id: 'few_dishes', label: 'Peu de vaisselle', modes: ['few_dishes'] },
  { id: 'antiwaste', label: 'Finir le frigo', modes: ['antiwaste'] },
  { id: 'batch', label: 'Batch cooking', modes: ['batch'] },
];

/**
 * Temps de cuisine maximal par repas.
 * @type {{ minutes: number | null, label: string }[]}
 */
export const TIME_CHOICES = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: null, label: 'Peu importe' },
];

/**
 * Choix faits dans le parcours guide.
 * @typedef {Object} GuidedChoices
 * @property {Slot[]} slots                Repas a planifier
 * @property {boolean} keepExisting        Garder les repas deja prevus (sinon tout refaire, sauf verrouilles)
 * @property {number | null} budgetCents   Budget de la semaine (null : inchange)
 * @property {number | null} maxMinutes
 * @property {string[]} wishes             Identifiants de WISHES
 * @property {string | null} region        Region culinaire privilegiee (null : toutes)
 * @property {boolean} [leftovers]          Les diners servent aussi au dejeuner du lendemain
 */

/**
 * Demande equivalente pour le moteur. L'equilibre et la variete sont toujours recherches.
 * En batch cooking, tout cuit pendant la seance : le temps par repas ne limite pas le choix.
 * @param {GuidedChoices} choices
 * @returns {Request}
 */
export function guidedRequest(choices) {
  /** @type {Set<Mode>} */
  const modes = new Set(['balance']);
  for (const id of choices.wishes) for (const m of WISHES.find((w) => w.id === id)?.modes ?? []) modes.add(m);
  return {
    ...emptyRequest(),
    modes: [...modes],
    budgetCents: choices.budgetCents,
    maxMinutes: modes.has('batch') ? null : choices.maxMinutes,
    slots: [...choices.slots],
    region: choices.region,
    generate: true,
    redo: !choices.keepExisting,
    nextLunchLeftovers: choices.leftovers === true,
    understood: true,
  };
}

/**
 * Resume lisible des choix (affiche dans l'historique de l'assistant).
 * @param {GuidedChoices} choices
 * @param {Map<string, string>} slotLabels
 * @param {Map<string, string>} regionLabels
 * @returns {string}
 */
export function describeChoices(choices, slotLabels, regionLabels) {
  const parts = [choices.slots.map((s) => (slotLabels.get(s) ?? s).toLowerCase()).join(', ')];
  parts.push(choices.keepExisting ? 'en gardant les repas déjà prévus' : 'en refaisant les repas non verrouillés');
  if (choices.leftovers) parts.push('les restes du dîner pour le déjeuner du lendemain');
  if (choices.maxMinutes !== null && !choices.wishes.includes('batch')) parts.push(`${choices.maxMinutes} min maximum`);
  const wishes = choices.wishes.map((id) => WISHES.find((w) => w.id === id)?.label.toLowerCase()).filter(Boolean);
  if (wishes.length) parts.push(wishes.join(', '));
  if (choices.region) parts.push(`cuisine : ${regionLabels.get(choices.region) ?? choices.region}`);
  if (choices.budgetCents !== null) parts.push(`budget ${(choices.budgetCents / 100).toFixed(2).replace('.', ',')} €`);
  return `Planifier ma semaine : ${parts.join(' ; ')}.`;
}

/**
 * Operation de la proposition qui concerne un creneau (ajout ou remplacement).
 * @param {import('./proposal.js').Operation[]} operations
 * @param {{ date: string, slot: Slot }} where
 * @param {string | null} existingMealId   Repas deja prevu a ce creneau (avant la proposition)
 * @returns {number}  Index, ou -1
 */
export function operationIndexFor(operations, where, existingMealId) {
  return operations.findIndex(
    (o) =>
      (o.type === 'add_meal' && o.date === where.date && o.slot === where.slot) ||
      (existingMealId !== null && o.type === 'replace_recipe' && o.mealId === existingMealId),
  );
}
