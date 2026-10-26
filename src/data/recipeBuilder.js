/**
 * Ecriture compacte des recettes du catalogue etendu.
 * Les recettes produites ont exactement le format de src/domain/recipes/recipes.js
 * et passent par la meme validation (tests/catalog.test.js).
 *
 * Ingredients : "id quantite unite | note ; id ..."
 *   - "onion 2"            -> 2 pieces
 *   - "rice_white 300 g"   -> 300 g
 *   - "salt to_taste"      -> quantite qualitative
 *   - "chicken 800 g | cuisses, en morceaux"
 */
import { getUnit } from '../domain/units/units.js';

/** @typedef {import('../domain/recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../domain/recipes/recipes.js').IngredientLine} IngredientLine */
/** @typedef {import('../domain/recipes/recipes.js').PreparationLine} PreparationLine */
/** @typedef {import('../domain/recipes/recipes.js').MealType} MealType */
/** @typedef {import('../domain/recipes/recipes.js').RecipeTag} RecipeTag */
/** @typedef {import('../domain/recipes/recipes.js').Vessel} Vessel */

/** @type {import('../domain/recipes/recipes.js').RecipeSource} */
const SOURCE = { type: 'original', author: 'MealDom', license: 'Recette originale MealDom', addedAt: '2026-10-22' };

/** @type {Record<string, MealType>} */
const MEAL_LETTERS = { B: 'breakfast', L: 'lunch', D: 'dinner', S: 'snack' };

/** @type {Record<string, string>} */
const METHOD_LABELS = {
  stovetop: 'Sur le feu',
  oven: 'Au four',
  'oven stovetop': 'Sur le feu puis au four',
  '': 'Sans cuisson',
  microwave: 'Au micro-ondes',
  blender: 'Au mixeur',
  'blender stovetop': 'Sur le feu et au mixeur',
  air_fryer: 'Au air fryer',
};

/**
 * @param {string} text
 * @returns {IngredientLine[]}
 */
export function parseIngredients(text) {
  return text
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [main, note] = part.split('|').map((x) => x.trim());
      const [ingredientId, a, b] = main.split(/\s+/);
      /** @type {IngredientLine} */
      let line;
      if (a === undefined) throw new Error(`Quantité manquante : ${part}`);
      if (getUnit(a)?.kind === 'qualitative') line = { ingredientId, quantity: null, unit: a };
      else {
        const quantity = Number(a);
        if (!Number.isFinite(quantity)) throw new Error(`Quantité illisible : ${part}`);
        line = { ingredientId, quantity, unit: b ?? 'piece' };
      }
      return note ? { ...line, note } : line;
    });
}

/**
 * @param {string} text  "cooked_rice 600 g; shredded_chicken 300 g"
 * @returns {PreparationLine[]}
 */
function parsePreparations(text) {
  return text
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [preparationId, quantity, unit] = part.split(/\s+/);
      return { preparationId, quantity: Number(quantity), unit: unit ?? 'g' };
    });
}

/**
 * @typedef {Object} RecipeOptions
 * @property {'easy' | 'medium' | 'hard'} [level]
 * @property {Vessel} [vessel]
 * @property {string} [tags]        Etiquettes separees par des espaces
 * @property {string} [preps]       Preparations reutilisables consommees
 * @property {string} [equip]       Equipements separes par des espaces ('' = aucun)
 * @property {string} [label]       Nom de la methode
 * @property {string[]} [tips]
 * @property {string} [family]      Famille de plat imposee (voir families.js)
 * @property {string[]} [tm]        Etapes au robot cuiseur (type Thermomix) : deuxieme methode
 */

/** Libelle de la methode au robot cuiseur. */
const ROBOT_LABEL = 'Au robot cuiseur (type Thermomix)';

/**
 * Construit une recette validee du catalogue.
 * @param {string} id
 * @param {string} name
 * @param {string} description
 * @param {string} cuisine
 * @param {string} meals        Lettres : B petit-dejeuner, L dejeuner, D diner, S gouter
 * @param {number} servings     Portions adultes
 * @param {number} prepMinutes
 * @param {number} cookMinutes
 * @param {string} ingredients
 * @param {string[]} steps
 * @param {RecipeOptions} [opts]
 * @returns {Recipe}
 */
export function r(id, name, description, cuisine, meals, servings, prepMinutes, cookMinutes, ingredients, steps, opts = {}) {
  const equip = opts.equip ?? 'stovetop';
  const equipment = equip.split(/\s+/).filter(Boolean);
  const key = [...equipment].sort().join(' ');
  return {
    id,
    name,
    description,
    cuisine,
    servings,
    prepMinutes,
    cookMinutes,
    difficulty: opts.level ?? 'easy',
    vessel: opts.vessel ?? null,
    ingredients: parseIngredients(ingredients),
    preparations: opts.preps ? parsePreparations(opts.preps) : [],
    methods: [
      { id: equipment[0] ?? 'no_cook', label: opts.label ?? METHOD_LABELS[key] ?? 'Préparation', equipment, steps },
      ...(opts.tm ? [{ id: 'food_processor', label: ROBOT_LABEL, equipment: equipment.includes('oven') ? ['food_processor', 'oven'] : ['food_processor'], steps: opts.tm }] : []),
    ],
    tips: opts.tips ?? [],
    source: SOURCE,
    status: 'validated',
    mealTypes: [...meals].map((l) => {
      const type = MEAL_LETTERS[l];
      if (!type) throw new Error(`Repas inconnu « ${l} » : ${id}`);
      return type;
    }),
    tags: /** @type {RecipeTag[]} */ ((opts.tags ?? '').split(/\s+/).filter(Boolean)),
    ...(opts.family ? { family: opts.family } : {}),
  };
}
