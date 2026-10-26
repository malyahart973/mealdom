/**
 * Recettes personnelles : lecture d'une recette collee en texte (sans IA), lecture
 * de la reponse de l'IA (lien ou photo) et construction d'une recette au format
 * du catalogue. Rien n'est devine : un ingredient non reconnu reste a choisir.
 */
import { normalizeText } from '../ingredients/ingredients.js';
import { getUnit } from '../units/units.js';

/** @typedef {import('./recipes.js').Recipe} Recipe */
/** @typedef {import('./recipes.js').IngredientLine} IngredientLine */
/** @typedef {import('./recipes.js').MealType} MealType */
/** @typedef {import('./recipes.js').RecipeTag} RecipeTag */

/**
 * Ligne d'ingredient lue dans un texte.
 * @typedef {Object} DraftIngredient
 * @property {string} raw                 Ligne d'origine
 * @property {number | null} quantity
 * @property {string} unit                Unite MealDom (g, ml, tbsp, piece, to_taste...)
 * @property {string} name                Nom de l'ingredient tel qu'ecrit
 * @property {string | null} [ingredientId]  Ingredient du catalogue reconnu (null : a choisir)
 */

/**
 * Recette lue, a verifier par la cliente avant enregistrement.
 * @typedef {Object} RecipeDraft
 * @property {string} name
 * @property {number | null} servings
 * @property {number | null} prepMinutes
 * @property {number | null} cookMinutes
 * @property {DraftIngredient[]} ingredients
 * @property {string[]} steps
 * @property {string[]} robotSteps        Etapes au robot cuiseur (type Thermomix)
 * @property {string} [sourceUrl]
 */

/** Unites ecrites en francais, en debut de texte (sans accents). Facteur applique a la quantite. */
/** @type {[RegExp, string, number][]} */
const UNIT_PREFIXES = [
  [/^(?:kilogrammes?|kilos?|kg)\b\.?/, 'kg', 1],
  [/^(?:grammes?|grs?|g)\b\.?/, 'g', 1],
  [/^(?:millilitres?|ml)\b/, 'ml', 1],
  [/^(?:centilitres?|cl)\b/, 'cl', 1],
  [/^(?:decilitres?|dl)\b/, 'ml', 100],
  [/^(?:litres?|l)\b/, 'l', 1],
  [/^(?:cuilleres?|cuillerees?|cuil\.?|c\.)\s*(?:a|de)?\s*(?:soupe|s\.)/, 'tbsp', 1],
  [/^(?:cuilleres?|cuillerees?|cuil\.?|c\.)\s*(?:a|de)?\s*(?:cafe|the|c\.)/, 'tsp', 1],
  [/^(?:c\.a\.s\.?|c\.s\.?|cas|cs)(?=\s|$)/, 'tbsp', 1],
  [/^(?:c\.a\.c\.?|c\.c\.?|cac|cc)(?=\s|$)/, 'tsp', 1],
  [/^pincees?\b/, 'pinch', 1],
  [/^gousses?\b/, 'clove', 1],
  [/^tranches?\b/, 'slice', 1],
  [/^sachets?\b/, 'sachet', 1],
  [/^(?:boites?|conserves?)\b/, 'can', 1],
  [/^poignees?\b/, 'handful', 1],
];

/** @type {Record<string, number>} */
const NUMBER_WORDS = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, huit: 8, dix: 10, douze: 12 };
/** @type {Record<string, number>} */
const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

/**
 * Quantite en debut de texte : « 200 », « 1,5 », « 1/2 », « 1 1/2 », « ½ », « deux ».
 * @param {string} text  Texte normalise
 * @returns {{ quantity: number | null, rest: string }}
 */
function readQuantity(text) {
  let m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)\b/.exec(text);
  if (m) return { quantity: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: text.slice(m[0].length) };
  m = /^(\d+)\s*\/\s*(\d+)\b/.exec(text);
  if (m) return { quantity: Number(m[1]) / Number(m[2]), rest: text.slice(m[0].length) };
  m = /^(\d+(?:[.,]\d+)?)\s*([½¼¾⅓⅔])?(?:\s*(?:a|-|à)\s*\d+(?:[.,]\d+)?)?/.exec(text);
  if (m) return { quantity: Number(m[1].replace(',', '.')) + (m[2] ? FRACTIONS[m[2]] : 0), rest: text.slice(m[0].length) };
  m = /^([½¼¾⅓⅔])/.exec(text);
  if (m) return { quantity: FRACTIONS[m[1]], rest: text.slice(m[0].length) };
  m = /^([a-z]+)\s/.exec(text);
  if (m && NUMBER_WORDS[m[1]] !== undefined) return { quantity: NUMBER_WORDS[m[1]], rest: text.slice(m[0].length) };
  return { quantity: null, rest: text };
}

/**
 * Lit une ligne d'ingredient : « 200 g de farine », « 3 œufs », « 1 c. à soupe d’huile », « sel ».
 * @param {string} line
 * @returns {DraftIngredient}
 */
export function parseIngredientLine(line) {
  const raw = line.replace(/^[\s\-•*–▢·◦]+/, '').trim();
  // On garde les fractions unicode : normalizeText ne les touche pas.
  const text = normalizeText(raw).replace(/^\(?env(?:iron|\.)\)?\s*/, '');
  const { quantity, rest } = readQuantity(text);
  let unit = quantity === null ? 'to_taste' : 'piece';
  let factor = 1;
  let after = rest.trim();
  if (quantity !== null) {
    for (const [re, id, f] of UNIT_PREFIXES) {
      const m = re.exec(after);
      if (m) {
        unit = id;
        factor = f;
        after = after.slice(m[0].length).trim();
        break;
      }
    }
  }
  const name = after
    .replace(/^(?:de |d'|du |des |de la |de l')/, '')
    .replace(/\s*[(,].*$/, '')
    .trim();
  return { raw, quantity: quantity === null ? null : Math.round(quantity * factor * 100) / 100, unit, name };
}

/** En-tetes de sections (texte normalise, sans les deux-points). */
const INGREDIENT_HEADER = /^(?:les )?ingredients?(?: pour .*)?$/;
const STEP_HEADER = /^(?:la )?(?:preparation|etapes?|instructions?|deroulement|methode|recette|realisation)$/;

/**
 * Duree ecrite : « 15 min », « 1 h 10 », « 1h », « 45 minutes ».
 * @param {string} text  Texte normalise
 * @returns {number | null}
 */
export function parseDuration(text) {
  const h = /(\d+)\s*h(?:eures?)?\s*(\d+)?/.exec(text);
  if (h) return Number(h[1]) * 60 + (h[2] ? Number(h[2]) : 0);
  const m = /(\d+)\s*(?:min|mn)/.exec(text);
  return m ? Number(m[1]) : null;
}

/** Etape au robot cuiseur : vitesse, sens inverse, temperature/vitesse, Varoma... */
const ROBOT_STEP = /\bvitesse\b|\bvit\.?\s*\d|sens inverse|varoma|mode petrin|\bturbo\b|\d+\s*(?:sec|s)\s*\/|°c\s*\/|\/\s*vit/;

/**
 * Lit une recette collee (copiee d'un site, d'un message ou d'une application).
 * @param {string} text
 * @returns {RecipeDraft}
 */
export function parseRecipeText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  /** @type {RecipeDraft} */
  const draft = { name: '', servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [], robotSteps: [] };
  /** @type {'start' | 'ingredients' | 'steps'} */
  let section = 'start';
  /** @type {string[]} */
  const loose = [];
  for (const line of lines) {
    const n = normalizeText(line).replace(/\s*:\s*$/, '');
    if (INGREDIENT_HEADER.test(n)) {
      section = 'ingredients';
      continue;
    }
    if (STEP_HEADER.test(n)) {
      section = 'steps';
      continue;
    }
    const meta = /^(?:temps de )?(preparation|cuisson|repos|temps total)\s*:?\s*(.+)$/.exec(n);
    if (meta && parseDuration(meta[2]) !== null) {
      if (meta[1] === 'preparation') draft.prepMinutes = parseDuration(meta[2]);
      if (meta[1] === 'cuisson') draft.cookMinutes = parseDuration(meta[2]);
      continue;
    }
    const people = /(?:pour|portions?|parts?|personnes?|nombre de personnes)\D{0,12}(\d+)|(\d+)\s*(?:personnes|portions|parts|pers\.)/.exec(n);
    if (people && n.length < 40 && section !== 'steps') {
      draft.servings = Number(people[1] ?? people[2]);
      continue;
    }
    if (!draft.name && section === 'start' && line.length <= 80 && !/^\d/.test(n)) {
      draft.name = line.replace(/^#+\s*/, '');
      continue;
    }
    if (section === 'ingredients') draft.ingredients.push(...splitSeasoning(line).map(parseIngredientLine));
    else if (section === 'steps') draft.steps.push(cleanStep(line));
    else loose.push(line);
  }
  // Sans en-tetes : les lignes courtes qui commencent par une quantite sont des ingredients.
  for (const line of loose) {
    const looksLikeIngredient = line.length <= 70 && (readQuantity(normalizeText(line.replace(/^[\s\-•*–▢·◦]+/, ''))).quantity !== null || /^[\-•*–▢·◦]/.test(line));
    if (looksLikeIngredient && !draft.steps.length) draft.ingredients.push(parseIngredientLine(line));
    else draft.steps.push(cleanStep(line));
  }
  const robot = draft.steps.filter((s) => ROBOT_STEP.test(normalizeText(s)));
  if (robot.length && (robot.length * 2 >= draft.steps.length || /thermomix|robot/i.test(text))) {
    draft.robotSteps = robot;
    draft.steps = draft.steps.filter((s) => !robot.includes(s));
  }
  draft.steps = draft.steps.filter(Boolean);
  return draft;
}

/**
 * « Sel, poivre » ou « sel et poivre » sans quantite : une ligne par ingredient.
 * @param {string} line
 * @returns {string[]}
 */
function splitSeasoning(line) {
  const clean = line.replace(/^[\s\-•*–▢·◦]+/, '').trim();
  if (readQuantity(normalizeText(clean)).quantity !== null) return [line];
  const parts = clean.split(/\s*,\s*|\s+et\s+/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => p.split(/\s+/).length <= 3) ? parts : [line];
}

/**
 * Retire la numerotation d'une etape et termine la phrase.
 * @param {string} line
 * @returns {string}
 */
function cleanStep(line) {
  const s = line.replace(/^(?:etape|étape)\s*\d+\s*[:.)-]?\s*/i, '').replace(/^\d+\s*[.)/-]\s*/, '').replace(/^[\-•*–▢·◦]\s*/, '').trim();
  return s && !/[.!?…)]$/.test(s) ? `${s}.` : s;
}

/**
 * Associe chaque ligne a un ingredient du catalogue (null si inconnu : a choisir).
 * @param {DraftIngredient[]} lines
 * @param {(name: string) => string | null} find
 * @returns {DraftIngredient[]}
 */
export function matchIngredients(lines, find) {
  return lines.map((l) => ({ ...l, ingredientId: l.name ? find(l.name) : null }));
}

/** Unites proposees par l'IA (schema) et dans le formulaire. */
export const DRAFT_UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'tsp', 'tbsp', 'piece', 'clove', 'slice', 'pinch', 'to_taste', 'sachet', 'can', 'handful'];

/** Schema de la reponse de l'IA (lien ou photo d'une recette). */
export const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean', description: 'false si la page ou l’image ne contient pas de recette lisible' },
    name: { type: 'string' },
    servings: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    prepMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    cookMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          quantity: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          unit: { type: 'string', enum: DRAFT_UNITS },
          name: { type: 'string', description: 'nom de l’ingrédient en français, sans la quantité' },
        },
        required: ['quantity', 'unit', 'name'],
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    robotSteps: { type: 'array', items: { type: 'string' }, description: 'étapes au robot cuiseur (Thermomix) avec temps, température et vitesse' },
  },
  required: ['found', 'name', 'servings', 'prepMinutes', 'cookMinutes', 'ingredients', 'steps', 'robotSteps'],
};

/** Consignes de l'IA pour lire une recette. */
export const RECIPE_PROMPT = `Tu lis une recette de cuisine pour l'application MealDom (Guyane française) et tu la recopies fidèlement en JSON.
- N'invente rien : une information absente vaut null ou une liste vide. Si aucune recette n'est lisible, found = false.
- Ingrédients : quantité et unité telles qu'écrites (g, kg, ml, cl, l, tsp = cuillère à café, tbsp = cuillère à soupe, piece = pièce, clove = gousse, slice = tranche, pinch = pincée, to_taste = sans quantité). Nom en français, au singulier si possible, sans la quantité.
- Étapes : une phrase complète par étape, en français, dans l'ordre.
- Étapes au robot cuiseur (Thermomix ou autre) : mets-les dans robotSteps, avec temps, température et vitesse ; ne les duplique pas dans steps.`;

/**
 * Lit la reponse de l'IA (deja conforme au schema, mais verifiee ici).
 * @param {unknown} value
 * @returns {RecipeDraft | null}
 */
export function readRecipeAnswer(value) {
  if (!value || typeof value !== 'object') return null;
  const v = /** @type {Record<string, unknown>} */ (value);
  if (v.found === false) return null;
  const int = (/** @type {unknown} */ x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
  const strings = (/** @type {unknown} */ x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()).map((s) => cleanStep(String(s))) : []);
  const ingredients = Array.isArray(v.ingredients)
    ? v.ingredients
        .filter((i) => i && typeof i === 'object' && typeof i.name === 'string' && i.name.trim())
        .map((i) => {
          const unit = DRAFT_UNITS.includes(i.unit) ? i.unit : 'piece';
          const qualitative = getUnit(unit)?.kind === 'qualitative';
          const quantity = !qualitative && typeof i.quantity === 'number' && i.quantity > 0 ? i.quantity : null;
          return { raw: `${quantity ?? ''} ${unit} ${i.name}`.trim(), quantity, unit: quantity === null && !qualitative ? 'to_taste' : unit, name: String(i.name).trim() };
        })
    : [];
  const draft = {
    name: typeof v.name === 'string' ? v.name.trim() : '',
    servings: int(v.servings),
    prepMinutes: int(v.prepMinutes),
    cookMinutes: int(v.cookMinutes),
    ingredients,
    steps: strings(v.steps),
    robotSteps: strings(v.robotSteps),
  };
  return draft.ingredients.length || draft.steps.length || draft.robotSteps.length ? draft : null;
}

/**
 * Saisie du formulaire « Ma recette ».
 * @typedef {Object} UserRecipeForm
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} family
 * @property {string} cuisine
 * @property {MealType[]} mealTypes
 * @property {number} servings
 * @property {number} prepMinutes
 * @property {number} cookMinutes
 * @property {'easy' | 'medium' | 'hard'} difficulty
 * @property {RecipeTag[]} tags
 * @property {IngredientLine[]} ingredients
 * @property {string[]} steps
 * @property {string[]} robotSteps
 * @property {string[]} equipment          Materiel de la methode principale
 * @property {string[]} otherIngredients   Lignes non reconnues (gardees dans les conseils)
 * @property {string} [sourceUrl]
 * @property {string} [addedAt]
 */

/**
 * Recette personnelle au format du catalogue (a valider avec validateRecipe).
 * @param {UserRecipeForm} form
 * @param {string} todayIso
 * @returns {Recipe}
 */
export function buildUserRecipe(form, todayIso) {
  const finish = (/** @type {string} */ s) => {
    const t = s.trim();
    return t && !/[.!?…)]$/.test(t) ? `${t}.` : t;
  };
  const steps = form.steps.map(finish).filter(Boolean);
  const robotSteps = form.robotSteps.map(finish).filter(Boolean);
  /** @type {import('./recipes.js').CookingMethod[]} */
  const methods = [];
  if (steps.length) methods.push({ id: 'perso', label: 'Préparation', equipment: form.equipment, steps });
  if (robotSteps.length) methods.push({ id: 'food_processor', label: 'Au robot cuiseur (type Thermomix)', equipment: ['food_processor'], steps: robotSteps });
  let host = '';
  try {
    host = form.sourceUrl ? new URL(form.sourceUrl).hostname.replace(/^www\./, '') : '';
  } catch {
    host = '';
  }
  return {
    id: form.id,
    name: form.name.trim(),
    description: form.description.trim(),
    cuisine: form.cuisine,
    servings: form.servings,
    prepMinutes: form.prepMinutes,
    cookMinutes: form.cookMinutes,
    difficulty: form.difficulty,
    vessel: null,
    ingredients: form.ingredients,
    preparations: [],
    methods,
    tips: form.otherIngredients.length ? [`Autres ingrédients (non comptés dans les courses ni les calories) : ${form.otherIngredients.join(', ')}.`] : [],
    source: { type: 'personal', author: 'Moi', license: host ? `Recette personnelle, d’après ${host}` : 'Recette personnelle', addedAt: form.addedAt ?? todayIso },
    status: 'validated',
    mealTypes: form.mealTypes,
    tags: form.tags,
    family: form.family,
  };
}
