/**
 * Mode cuisine pas a pas : quantites pour le nombre de portions voulu, methode adaptee au
 * materiel du foyer, et minuteurs reperes dans le texte des etapes.
 */
import { roundUpQuantity } from '../units/units.js';
import { compatibleMethods } from './recipes.js';
import { normalizeText } from '../ingredients/ingredients.js';

/** @typedef {import('./recipes.js').Recipe} Recipe */
/** @typedef {import('./recipes.js').CookingMethod} CookingMethod */
/** @typedef {import('./recipes.js').IngredientLine} IngredientLine */
/** @typedef {import('./recipes.js').PreparationLine} PreparationLine */

/** Portions possibles dans le mode cuisine (par demi-portion). */
export const MIN_COOK_PORTIONS = 1;
export const MAX_COOK_PORTIONS = 24;

/**
 * Nombre de portions ramene dans les limites, a la demi-portion.
 * @param {number} portions
 * @returns {number}
 */
export function clampPortions(portions) {
  if (!Number.isFinite(portions)) return MIN_COOK_PORTIONS;
  return Math.min(MAX_COOK_PORTIONS, Math.max(MIN_COOK_PORTIONS, Math.round(portions * 2) / 2));
}

/**
 * Ingredients et preparations pour un nombre de portions (regle de trois, arrondi au-dessus).
 * @param {Recipe} recipe
 * @param {number} portions
 * @returns {{ factor: number, ingredients: IngredientLine[], preparations: PreparationLine[] }}
 */
export function scaledLines(recipe, portions) {
  const factor = portions / recipe.servings;
  return {
    factor,
    ingredients: recipe.ingredients.map((l) => ({ ...l, quantity: l.quantity === null ? null : roundUpQuantity(l.quantity * factor, l.unit) })),
    preparations: recipe.preparations.map((l) => ({ ...l, quantity: roundUpQuantity(l.quantity * factor, l.unit) })),
  };
}

/**
 * Methodes proposees : celles que permet le materiel du foyer ; s'il n'y en a aucune, toutes
 * (la personne peut avoir un materiel non declare), signalees comme telles.
 * @param {Recipe} recipe
 * @param {string[]} equipment
 * @returns {{ methods: CookingMethod[], allCompatible: boolean }}
 */
export function cookingMethods(recipe, equipment) {
  const ok = compatibleMethods(recipe, equipment);
  return ok.length ? { methods: ok, allCompatible: true } : { methods: recipe.methods, allCompatible: false };
}

/**
 * @typedef {{ seconds: number, label: string }} StepTimer
 */

/** Au-dela, ce n'est plus un minuteur (marinade, repos d'une nuit). */
const MAX_TIMER_SECONDS = 6 * 3600;

const NUMBER = '(\\d+(?:[.,]\\d+)?)';
const UNIT = '(minutes?|mn|min|heures?|h|secondes?|sec)';
/** « 1 h 30 », « 1h30 » */
const HOURS_MINUTES = /(\d+)\s*h\s*(\d{1,2})\b(?!\s*(?:min|°))/g;
/** « 10 à 12 minutes », « 18-22 min » */
const RANGE = new RegExp(`${NUMBER}\\s*(?:a|-|–|ou)\\s*${NUMBER}\\s*${UNIT}\\b`, 'g');
/** « 25 minutes » */
const SINGLE = new RegExp(`${NUMBER}\\s*${UNIT}\\b`, 'g');
/** Durees en toutes lettres. */
const WORDS = /** @type {[RegExp, number][]} */ ([
  [/\bune? demi-heure\b/g, 1800],
  [/\bun quart d'heure\b/g, 900],
  [/\bune heure\b/g, 3600],
  [/\bune minute\b/g, 60],
]);

/**
 * @param {string} value
 * @param {string} unit
 * @returns {number}
 */
function toSeconds(value, unit) {
  const n = Number(value.replace(',', '.'));
  if (unit.startsWith('h')) return Math.round(n * 3600);
  if (unit.startsWith('s')) return Math.round(n);
  return Math.round(n * 60);
}

/**
 * Minuteurs a proposer pour une etape : chaque duree citee dans le texte. Pour une fourchette
 * (« 10 à 12 minutes »), le minuteur prend la plus courte : on verifie, puis on prolonge si besoin.
 * @param {string} step
 * @returns {StepTimer[]}
 */
export function stepTimers(step) {
  let text = normalizeText(step);
  /** @type {StepTimer[]} */
  const found = [];
  /** @param {number} seconds @param {string} label */
  const add = (seconds, label) => {
    if (seconds > 0 && seconds <= MAX_TIMER_SECONDS && !found.some((t) => t.seconds === seconds)) found.push({ seconds, label });
  };
  text = text.replace(HOURS_MINUTES, (_, h, m) => {
    add(Number(h) * 3600 + Number(m) * 60, `${h} h ${m.padStart(2, '0')}`);
    return ' ';
  });
  text = text.replace(RANGE, (_, a, b, unit) => {
    add(toSeconds(a, unit), `${a} à ${b} ${shortUnit(unit)}`);
    return ' ';
  });
  text = text.replace(SINGLE, (_, a, unit) => {
    add(toSeconds(a, unit), `${a} ${shortUnit(unit)}`);
    return ' ';
  });
  for (const [re, seconds] of WORDS) {
    text = text.replace(re, (match) => {
      add(seconds, match.trim());
      return ' ';
    });
  }
  return found;
}

/**
 * @param {string} unit
 * @returns {string}
 */
function shortUnit(unit) {
  if (unit.startsWith('h')) return 'h';
  if (unit.startsWith('s')) return 's';
  return 'min';
}
