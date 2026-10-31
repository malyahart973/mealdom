/**
 * Programme alimentaire d'un coach (ou d'une dieteticienne) :
 * - lecture du texte du programme : repas, horaires, alternatives (« Ou »), complements (« + »),
 *   grammages, regles (« Pas de sauces... ») ;
 * - repas « assembles » conformes aux grammages (proteine + legumes + feculent + huile) et menus
 *   fixes (petit-dejeuner, collations), transformes en recettes pour le planning, les courses,
 *   le batch cooking et le mode cuisine ;
 * - semaine composee en variant les choix du coach, collation des jours de sport comprise.
 * Rien n'est invente : seuls les aliments et les quantites du programme sont utilises.
 */
import { normalizeText } from '../ingredients/ingredients.js';
import { addDays, parseIsoDate } from '../planning/dates.js';

/** @typedef {import('./program.js').ProgramSlot} ProgramSlot */
/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').IngredientLine} IngredientLine */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */
/** @typedef {import('../planning/planning.js').Meal} Meal */

/**
 * @typedef {Object} CoachMeal
 * @property {ProgramSlot} slot
 * @property {string} time            ex. « 7 h - 7 h 30 »
 * @property {boolean} sportDaysOnly  Seulement les jours de sport (collation d'apres seance)
 * @property {string} text            Une ligne par element ; « Ou » entre deux possibilites ; « + » pour un complement commun
 */

/**
 * @typedef {Object} CoachPlan
 * @property {string} title
 * @property {CoachMeal[]} meals
 * @property {string[]} rules           ex. « Pas de sauces (ketchup, mayo) »
 * @property {number | null} waterLiters
 * @property {number | null} checkInWeeks   Bilan (poids, mensurations) toutes les N semaines
 * @property {string} notes
 * @property {string} importedAt        AAAA-MM-JJ
 */

/** @typedef {'protein' | 'vegetables' | 'starch' | 'fat'} FoodGroup */

/**
 * @typedef {Object} CoachItem
 * @property {string} text
 * @property {number | null} grams      Quantite (le bas d'une fourchette)
 * @property {number | null} gramsMax
 * @property {FoodGroup | null} group
 * @property {string[]} choices         Aliments possibles, dans l'ordre du coach (« a+b+c » : melange)
 * @property {boolean} cooked           Poids cuit
 */

/** @typedef {{ lines: string[], items: CoachItem[] }} CoachOption */

/**
 * @typedef {Object} ParsedMeal
 * @property {CoachOption[]} options
 * @property {string[]} extras          Complements communs (« 10 amandes ou noix », « un thé vert », gelules...)
 * @property {{ protein: CoachItem, vegetables: CoachItem, starch: CoachItem | null, fat: CoachItem | null } | null} assembled
 */

/** Ordre des repas dans la journee. */
export const COACH_SLOT_ORDER = /** @type {ProgramSlot[]} */ (['breakfast', 'morning_snack', 'lunch', 'snack', 'dinner']);

/**
 * Aliments reconnus dans un programme (texte sans accents), du plus precis au plus general.
 * « salade composee » est un melange.
 * @type {{ re: RegExp, id: string, group: FoodGroup | null, label: string }[]}
 */
const FOODS = [
  { re: /\briz (thai|jasmin)\b/, id: 'rice_jasmine', group: 'starch', label: 'riz thaï' },
  { re: /\briz complet\b/, id: 'rice_brown', group: 'starch', label: 'riz complet' },
  { re: /\briz\b/, id: 'rice_white', group: 'starch', label: 'riz' },
  { re: /\bpatates? douces?\b/, id: 'sweet_potato', group: 'starch', label: 'patate douce' },
  { re: /\bpommes? de terre\b/, id: 'potato', group: 'starch', label: 'pommes de terre' },
  { re: /\bquinoa\b/, id: 'quinoa', group: 'starch', label: 'quinoa' },
  { re: /\b(boulgour|bulgur)\b/, id: 'bulgur', group: 'starch', label: 'boulgour' },
  { re: /\bpates completes\b/, id: 'wholewheat_pasta', group: 'starch', label: 'pâtes complètes' },
  { re: /\bpates\b/, id: 'pasta', group: 'starch', label: 'pâtes' },
  { re: /\blentilles\b/, id: 'lentils_green', group: 'starch', label: 'lentilles' },
  { re: /\bpoulet\b/, id: 'chicken', group: 'protein', label: 'poulet' },
  { re: /\bdinde\b/, id: 'turkey', group: 'protein', label: 'dinde' },
  { re: /\bboeuf\b/, id: 'beef_steak', group: 'protein', label: 'bœuf' },
  { re: /\bsaumon\b/, id: 'salmon', group: 'protein', label: 'saumon' },
  { re: /\bthon\b/, id: 'tuna_canned', group: 'protein', label: 'thon' },
  { re: /\b(fruits de mer|crevettes?)\b/, id: 'shrimp', group: 'protein', label: 'crevettes' },
  { re: /\bpoissons?\b/, id: 'white_fish', group: 'protein', label: 'poisson blanc' },
  { re: /\b(tofu|proteines vegetales)\b/, id: 'tofu', group: 'protein', label: 'tofu' },
  { re: /\boeufs? durs?\b/, id: 'egg', group: 'protein', label: 'œufs durs' },
  { re: /\boeufs?\b/, id: 'egg', group: 'protein', label: 'œufs' },
  { re: /\bharicots verts\b/, id: 'green_beans', group: 'vegetables', label: 'haricots verts' },
  { re: /\bbrocolis?\b/, id: 'broccoli', group: 'vegetables', label: 'brocolis' },
  { re: /\basperges?\b/, id: 'asparagus', group: 'vegetables', label: 'asperges' },
  { re: /\bcourgettes?\b/, id: 'zucchini', group: 'vegetables', label: 'courgettes' },
  { re: /\bepinards\b/, id: 'spinach', group: 'vegetables', label: 'épinards' },
  { re: /\bsalade( composee)?\b/, id: 'lettuce+tomato+cucumber', group: 'vegetables', label: 'salade composée' },
  { re: /\b(huile de )?colza\b/, id: 'rapeseed_oil', group: 'fat', label: 'huile de colza' },
  { re: /\bhuile d'olive\b/, id: 'olive_oil', group: 'fat', label: 'huile d’olive' },
  { re: /\bhuile de coco\b/, id: 'coconut_oil', group: 'fat', label: 'huile de coco' },
  { re: /\bfarine d'avoine\b/, id: 'oat_flour', group: null, label: 'farine d’avoine' },
  { re: /\bflocons? d'avoine\b/, id: 'rolled_oats', group: null, label: 'flocons d’avoine' },
  { re: /\bwhey\b/, id: 'whey_isolate', group: null, label: 'whey' },
  { re: /\b(lait vegetal|boisson (a|vegetale)( l'avoine)?|lait d'avoine)\b/, id: 'oat_drink', group: null, label: 'boisson végétale' },
  { re: /\bmiel\b/, id: 'honey', group: null, label: 'miel' },
  { re: /\bamandes?\b/, id: 'almonds', group: null, label: 'amandes' },
  { re: /\bnoix\b/, id: 'walnuts', group: null, label: 'noix' },
  { re: /\b(graines de )?chia\b/, id: 'chia_seeds', group: null, label: 'graines de chia' },
  { re: /\bfruits rouges\b/, id: 'berries', group: null, label: 'fruits rouges' },
  { re: /\bbananes?\b/, id: 'banana', group: null, label: 'banane' },
  { re: /\bpommes?\b/, id: 'apple', group: null, label: 'pomme' },
  { re: /\byaourts?( grecs?| a la grecque| grecque)?\b/, id: 'greek_yogurt', group: null, label: 'yaourt grec' },
  { re: /\bfromage blanc\b/, id: 'fromage_blanc', group: null, label: 'fromage blanc' },
  { re: /\bpain( complet| aux cereales)?\b/, id: 'wholemeal_bread', group: null, label: 'pain complet' },
  { re: /\bcannelle\b/, id: 'cinnamon', group: null, label: 'cannelle' },
  { re: /\bcitron\b/, id: 'lemon', group: null, label: 'citron' },
  { re: /\bavocat\b/, id: 'avocado', group: null, label: 'avocat' },
];

/** Libelle court d'un aliment du programme. */
const LABELS = new Map(FOODS.map((f) => [f.id, f.label]));

/**
 * @param {string} id
 * @returns {string}
 */
export function coachFoodLabel(id) {
  return LABELS.get(id) ?? id;
}

/** Feculents pesés cuits : part de produit cru a acheter et a cuire. */
const RAW_PER_COOKED = { rice_jasmine: 0.37, rice_brown: 0.37, rice_white: 0.37, quinoa: 0.37, bulgur: 0.4, wholewheat_pasta: 0.42, pasta: 0.42, lentils_green: 0.4, sweet_potato: 1, potato: 1 };

/** Quantite par defaut quand le programme n'en donne pas (aliments d'accompagnement). */
const DEFAULT_QTY = /** @type {Record<string, { quantity: number | null, unit: string }>} */ ({
  oat_drink: { quantity: 150, unit: 'ml' },
  honey: { quantity: 1, unit: 'tsp' },
  almonds: { quantity: 12, unit: 'g' },
  walnuts: { quantity: 15, unit: 'g' },
  chia_seeds: { quantity: 10, unit: 'g' },
  berries: { quantity: 80, unit: 'g' },
  banana: { quantity: 1, unit: 'piece' },
  apple: { quantity: 1, unit: 'piece' },
  cinnamon: { quantity: null, unit: 'to_taste' },
  lemon: { quantity: 0.5, unit: 'piece' },
  avocado: { quantity: 0.5, unit: 'piece' },
  egg: { quantity: 2, unit: 'piece' },
  wholemeal_bread: { quantity: 2, unit: 'slice' },
  greek_yogurt: { quantity: 150, unit: 'g' },
  fromage_blanc: { quantity: 150, unit: 'g' },
  rolled_oats: { quantity: 40, unit: 'g' },
  oat_flour: { quantity: 40, unit: 'g' },
  whey_isolate: { quantity: 30, unit: 'g' },
});

/** Poids moyen d'une amande et d'un cerneau de noix (g), pour « 10 amandes ». */
const PIECE_GRAMS = { almonds: 1.2, walnuts: 2 };

// ---------------------------------------------------------------------------
// Lecture du texte
// ---------------------------------------------------------------------------

/**
 * Aliments cites dans un texte, dans l'ordre ou ils apparaissent.
 * @param {string} text  Texte deja normalise (sans accents)
 * @returns {{ id: string, group: FoodGroup | null, index: number }[]}
 */
function foodsIn(text) {
  // « riz thai ou complet » : le second est aussi du riz.
  let rest = text.replace(/\briz (thai|jasmin) ou complet\b/g, 'riz $1, riz complet');
  /** @type {{ id: string, group: FoodGroup | null, index: number }[]} */
  const found = [];
  for (const f of FOODS) {
    const re = new RegExp(f.re.source, 'g');
    rest = rest.replace(re, (match, ...args) => {
      const index = /** @type {number} */ (args[args.length - 2]);
      // « pomme » dans « pomme de terre » est deja pris par la regle des feculents.
      if (!found.some((x) => x.id === f.id)) found.push({ id: f.id, group: f.group, index });
      return ' '.repeat(match.length);
    });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Grammes cites : « 170gr », « 150 à 200gr », « 60 g de ».
 * @param {string} text
 * @returns {{ grams: number | null, gramsMax: number | null }}
 */
function gramsIn(text) {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:(?:a|-)\s*(\d+(?:[.,]\d+)?)\s*)?(?:gr|g|grammes?)\b/.exec(text);
  if (!m) return { grams: null, gramsMax: null };
  const a = Number(m[1].replace(',', '.'));
  const b = m[2] ? Number(m[2].replace(',', '.')) : null;
  return { grams: a, gramsMax: b };
}

/**
 * Une ligne du programme.
 * @param {string} line
 * @returns {CoachItem}
 */
export function parseCoachItem(line) {
  const text = normalizeText(line);
  const foods = foodsIn(text);
  const { grams, gramsMax } = gramsIn(text);
  /** @type {FoodGroup | null} */
  let group = null;
  if (/\bproteines?\b/.test(text)) group = 'protein';
  else if (/\blegumes\b|\bsalade\b/.test(text)) group = 'vegetables';
  else if (/\bfeculents?\b/.test(text) || foods[0]?.group === 'starch') group = 'starch';
  else if (/\bhuile\b/.test(text)) group = 'fat';
  else if (foods[0]?.group && grams !== null) group = foods[0].group;
  const choices = group ? foods.filter((f) => f.group === group).map((f) => f.id) : foods.map((f) => f.id);
  // « Proteines vegetales ou animales (poulet, dinde...) » : la liste du coach d'abord, le tofu ensuite.
  if (group === 'protein' && choices.length > 1 && choices[0] === 'tofu') choices.push(/** @type {string} */ (choices.shift()));
  // « Legumes verts » sans precision : les legumes verts courants, avant la salade.
  if (group === 'vegetables' && /\blegumes\b/.test(text) && choices.every((c) => c.includes('+'))) choices.unshift('green_beans', 'broccoli', 'zucchini');
  if (group === 'fat' && choices.length === 0) choices.push('rapeseed_oil');
  return { text: line.trim(), grams, gramsMax, group, choices, cooked: /\bcuit/.test(text) };
}

/** Complements communs a toutes les possibilites d'un repas. */
const EXTRA_LINE = /^(\+|a jeun|au reveil)|gelules?|complement|magnesium|omega|\bthe vert\b|\btisane\b/;

/**
 * Repas : possibilites, complements, et repas « assemble » (proteine + legumes + feculent).
 * @param {string} text
 * @returns {ParsedMeal}
 */
export function parseCoachMeal(text) {
  /** @type {CoachOption[]} */
  const options = [];
  /** @type {string[]} */
  const extras = [];
  /** @type {CoachOption} */
  let current = { lines: [], items: [] };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const norm = normalizeText(line);
    if (/^ou\b[\s.:]*$/.test(norm)) {
      if (current.lines.length) options.push(current);
      current = { lines: [], items: [] };
    } else if (EXTRA_LINE.test(norm)) {
      extras.push(line.replace(/^\+\s*/, ''));
    } else {
      current.lines.push(line);
      current.items.push(parseCoachItem(line));
    }
  }
  if (current.lines.length) options.push(current);
  // Une seule possibilite avec proteines + legumes pesés : repas assemble.
  /** @type {ParsedMeal['assembled']} */
  let assembled = null;
  if (options.length === 1) {
    const items = options[0].items;
    const pick = (/** @type {FoodGroup} */ g) => items.find((i) => i.group === g && i.choices.length > 0) ?? null;
    const protein = pick('protein');
    const vegetables = pick('vegetables');
    if (protein?.grams && vegetables?.grams) assembled = { protein, vegetables, starch: pick('starch'), fat: pick('fat') };
  }
  return { options, extras, assembled };
}

/**
 * Titre de repas reconnu dans une ligne : creneau et horaire.
 * @param {string} line
 * @returns {{ kind: 'breakfast' | 'snack' | 'lunch' | 'dinner', time: string, sport: boolean } | null}
 */
function mealHeading(line) {
  const norm = normalizeText(line);
  if (norm.length > 70) return null;
  /** @type {'breakfast' | 'snack' | 'lunch' | 'dinner' | null} */
  let kind = null;
  if (/^petit[- ]?dejeuner\b/.test(norm)) kind = 'breakfast';
  else if (/^(collation|gouter|en-cas|encas|snack)\b/.test(norm)) kind = 'snack';
  else if (/^dejeuner\b/.test(norm)) kind = 'lunch';
  else if (/^(diner|souper)\b/.test(norm)) kind = 'dinner';
  if (!kind) return null;
  return { kind, time: timeIn(norm), sport: /\bsport\b/.test(norm) };
}

/**
 * Horaire lisible : « 7 h - 7 h 30 », « 10 h ».
 * @param {string} norm
 * @returns {string}
 */
function timeIn(norm) {
  const t = /(\d{1,2})\s*h\s*(\d{2})?(?:\s*(?:-|a)\s*(\d{1,2})\s*h\s*(\d{2})?)?/.exec(norm);
  if (!t) return '';
  const one = (/** @type {string} */ h, /** @type {string | undefined} */ m) => `${Number(h)} h${m ? ` ${m}` : ''}`;
  return t[3] ? `${one(t[1], t[2])} - ${one(t[3], t[4])}` : one(t[1], t[2]);
}

/**
 * Heure d'un horaire (pour placer une collation avant ou apres le dejeuner).
 * @param {string} time
 * @returns {number | null}
 */
function hourOf(time) {
  const m = /(\d{1,2}) h/.exec(time);
  return m ? Number(m[1]) : null;
}

/** Regles du programme (apres les repas). */
const RULE_LINE = /\bpas d(e\b|')|\bautorise|\binterdit|\beviter?\b|\ba volonte\b|\bsans\b.*\b(sucre|sauce|friture)/;

/**
 * Lecture d'un programme colle en texte (copie depuis un PDF ou un message).
 * Les repas sont reperes par leurs titres (Petit-dejeuner, Collation, Dejeuner, Diner) ; une
 * quantite seule sur sa ligne (« 170gr ») est rattachee a la ligne suivante.
 * @param {string} raw
 * @param {string} today
 * @returns {CoachPlan}
 */
export function parseCoachText(raw, today) {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  /** @type {CoachMeal[]} */
  const meals = [];
  /** @type {string[]} */
  const rules = [];
  /** @type {string[]} */
  const header = [];
  /** @type {{ kind: string, time: string, sport: boolean, lines: string[] } | null} */
  let current = null;
  let inRules = false;
  /** @type {{ kind: string, time: string, sport: boolean, lines: string[] }[]} */
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = mealHeading(line);
    if (heading) {
      // L'horaire peut etre sur la ligne suivante.
      let { time, sport } = heading;
      const next = lines[i + 1] ? normalizeText(lines[i + 1]) : '';
      if (!time && next && /^(\d{1,2}\s*h|apres|avant|vers)/.test(next) && next.length < 60) {
        time = timeIn(next);
        sport = sport || /\bsport\b/.test(next);
        i += 1;
      }
      current = { kind: heading.kind, time, sport, lines: [] };
      blocks.push(current);
      inRules = false;
      continue;
    }
    const norm = normalizeText(line);
    if (!current) {
      header.push(line);
      continue;
    }
    if (inRules || (current.kind === 'dinner' || blocks.length >= 3) && RULE_LINE.test(norm) && !/^\d/.test(norm) && !gramsIn(norm).grams) {
      inRules = true;
      for (const sentence of line.split(/(?<=[.!])\s+/)) {
        if (RULE_LINE.test(normalizeText(sentence))) rules.push(sentence.replace(/!+$/, '').trim().replace(/^\((.*)\)\.?$/, '$1.'));
      }
      continue;
    }
    current.lines.push(line);
  }

  for (const b of blocks) {
    // Quantite seule (« 170gr », « 1 cuillère à soupe ») : rattachee a la ligne suivante.
    /** @type {string[]} */
    const merged = [];
    for (let i = 0; i < b.lines.length; i += 1) {
      const norm = normalizeText(b.lines[i]);
      const lone = /^(\d+(?:[.,]\d+)?\s*(?:(?:a|-)\s*\d+\s*)?(?:gr|g|grammes?)|\d+\s*cuilleres? a (soupe|cafe))$/.test(norm);
      if (lone && b.lines[i + 1]) {
        merged.push(`${b.lines[i]} ${b.lines[i + 1].replace(/^de\b/i, 'de')}`);
        i += 1;
      } else merged.push(b.lines[i]);
    }
    b.lines = merged;
  }

  // Collations : avant le dejeuner = collation du matin, apres = gouter.
  const lunchIndex = blocks.findIndex((b) => b.kind === 'lunch');
  for (const [index, b] of blocks.entries()) {
    /** @type {ProgramSlot} */
    let slot;
    if (b.kind === 'snack') {
      const hour = hourOf(b.time);
      const beforeLunch = hour !== null ? hour < 12 : lunchIndex >= 0 && index < lunchIndex;
      slot = beforeLunch ? 'morning_snack' : 'snack';
    } else slot = /** @type {ProgramSlot} */ (b.kind);
    if (meals.some((m) => m.slot === slot)) continue;
    meals.push({ slot, time: b.time, sportDaysOnly: b.sport && slot === 'snack', text: b.lines.join('\n') });
  }
  meals.sort((a, b) => COACH_SLOT_ORDER.indexOf(a.slot) - COACH_SLOT_ORDER.indexOf(b.slot));

  const headerText = normalizeText(header.join(' '));
  const water = /(?:hydri|eau)[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*l\b/.exec(headerText) ?? /(\d+(?:[.,]\d+)?)\s*l\b[^.]{0,30}\beau\b/.exec(headerText);
  const check = /toutes les (\d+) semaines/.exec(headerText);
  return {
    title: 'Programme de mon coach',
    meals,
    rules,
    waterLiters: water ? Number(water[1].replace(',', '.')) : null,
    checkInWeeks: check ? Number(check[1]) : null,
    notes: '',
    importedAt: today,
  };
}

/**
 * Verifications avant d'enregistrer un programme.
 * @param {CoachPlan} plan
 * @returns {string[]}
 */
export function validateCoachPlan(plan) {
  /** @type {string[]} */
  const errors = [];
  if (plan.meals.length === 0) errors.push('Aucun repas trouvé : ajoutez au moins un repas.');
  const slots = plan.meals.map((m) => m.slot);
  if (new Set(slots).size !== slots.length) errors.push('Deux repas ont le même moment de la journée : changez l’un des deux.');
  for (const m of plan.meals) if (!m.text.trim()) errors.push('Un repas est vide : écrivez son contenu ou retirez-le.');
  if (plan.waterLiters !== null && !(plan.waterLiters > 0 && plan.waterLiters <= 6)) errors.push('Quantité d’eau invalide (en litres, par exemple 2).');
  if (plan.checkInWeeks !== null && !(Number.isInteger(plan.checkInWeeks) && plan.checkInWeeks >= 1 && plan.checkInWeeks <= 12)) errors.push('Fréquence des bilans invalide (de 1 à 12 semaines).');
  return errors;
}

// ---------------------------------------------------------------------------
// Recettes du programme
// ---------------------------------------------------------------------------

/** Cuisson de chaque aliment d'un repas assemble : minutes et etape. */
const PROTEIN_STEPS = /** @type {Record<string, { minutes: number, step: (q: string) => string }>} */ ({
  chicken: { minutes: 15, step: (q) => `Cuire ${q} de poulet sans matière grasse : poêle antiadhésive 12 à 15 minutes, ou four à 200 °C pendant 20 minutes.` },
  turkey: { minutes: 15, step: (q) => `Cuire ${q} de dinde sans matière grasse : poêle antiadhésive 10 à 12 minutes, ou four à 200 °C pendant 20 minutes.` },
  beef_steak: { minutes: 8, step: (q) => `Saisir ${q} de bœuf dans une poêle bien chaude, 2 à 4 minutes de chaque côté selon la cuisson voulue.` },
  white_fish: { minutes: 15, step: (q) => `Cuire ${q} de poisson blanc en papillote au four (200 °C, 12 à 15 minutes) ou à la vapeur, 8 à 10 minutes.` },
  salmon: { minutes: 15, step: (q) => `Cuire ${q} de saumon en papillote au four (200 °C, 12 à 15 minutes) ou à la poêle sans matière grasse, côté peau.` },
  tuna_canned: { minutes: 0, step: (q) => `Égoutter ${q} de thon au naturel.` },
  shrimp: { minutes: 5, step: (q) => `Cuire ${q} de crevettes décortiquées à la poêle, 3 à 4 minutes, sans matière grasse.` },
  tofu: { minutes: 8, step: (q) => `Couper ${q} de tofu en dés et les dorer à la poêle antiadhésive, 8 minutes.` },
  egg: { minutes: 10, step: (q) => `Cuire ${q} : durs (10 minutes dans l’eau bouillante) ou en omelette dans une poêle antiadhésive.` },
});

const VEGETABLE_STEPS = /** @type {Record<string, { minutes: number, step: (q: string) => string }>} */ ({
  green_beans: { minutes: 12, step: (q) => `Cuire ${q} de haricots verts à la vapeur, 10 à 12 minutes.` },
  broccoli: { minutes: 8, step: (q) => `Cuire ${q} de brocolis en bouquets à la vapeur, 6 à 8 minutes.` },
  asparagus: { minutes: 10, step: (q) => `Cuire ${q} d’asperges à la vapeur, 8 à 10 minutes.` },
  zucchini: { minutes: 8, step: (q) => `Cuire ${q} de courgettes en rondelles à la vapeur, 6 à 8 minutes.` },
  spinach: { minutes: 3, step: (q) => `Faire tomber ${q} d’épinards à la poêle, 3 minutes.` },
  'lettuce+tomato+cucumber': { minutes: 0, step: (q) => `Préparer ${q} de salade composée : laitue, tomates et concombre.` },
});

const STARCH_STEPS = /** @type {Record<string, { minutes: number, step: (raw: string, cooked: string) => string }>} */ ({
  rice_jasmine: { minutes: 15, step: (raw, cooked) => `Cuire ${raw} de riz thaï à l’eau, 12 à 15 minutes, puis peser ${cooked} cuit.` },
  rice_white: { minutes: 15, step: (raw, cooked) => `Cuire ${raw} de riz à l’eau, 12 à 15 minutes, puis peser ${cooked} cuit.` },
  rice_brown: { minutes: 30, step: (raw, cooked) => `Cuire ${raw} de riz complet à l’eau, 25 à 30 minutes, puis peser ${cooked} cuit.` },
  quinoa: { minutes: 15, step: (raw, cooked) => `Cuire ${raw} de quinoa dans deux fois son volume d’eau, 12 à 15 minutes, puis peser ${cooked} cuit.` },
  bulgur: { minutes: 12, step: (raw, cooked) => `Cuire ${raw} de boulgour dans deux fois son volume d’eau, 10 à 12 minutes, puis peser ${cooked} cuit.` },
  pasta: { minutes: 12, step: (raw, cooked) => `Cuire ${raw} de pâtes à l’eau bouillante, 10 à 12 minutes, puis peser ${cooked} cuites.` },
  wholewheat_pasta: { minutes: 12, step: (raw, cooked) => `Cuire ${raw} de pâtes complètes à l’eau bouillante, 10 à 12 minutes, puis peser ${cooked} cuites.` },
  lentils_green: { minutes: 25, step: (raw, cooked) => `Cuire ${raw} de lentilles vertes à l’eau, 20 à 25 minutes, puis peser ${cooked} cuites.` },
  sweet_potato: { minutes: 20, step: (_raw, cooked) => `Cuire ${cooked} de patate douce en morceaux à la vapeur, 15 à 20 minutes.` },
  potato: { minutes: 20, step: (_raw, cooked) => `Cuire ${cooked} de pommes de terre en morceaux à la vapeur, 15 à 20 minutes.` },
});

/** Famille du plat selon la proteine (rangement des recettes). */
const PROTEIN_FAMILY = /** @type {Record<string, string>} */ ({ chicken: 'poultry', turkey: 'poultry', beef_steak: 'meat', white_fish: 'fish', salmon: 'fish', tuna_canned: 'fish', shrimp: 'fish', tofu: 'veggie', egg: 'eggs' });

/** @param {string} s */
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * @param {string[]} words
 * @returns {string}
 */
function joinWords(words) {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} et ${words[words.length - 1]}`;
}

/**
 * Identifiant d'un repas assemble : coach-<repas>-a-<proteine>-<legume>-<feculent>.
 * @param {ProgramSlot} slot
 * @param {string} protein
 * @param {string} vegetable
 * @param {string | null} starch
 * @returns {string}
 */
export function assembledId(slot, protein, vegetable, starch) {
  return `coach-${slot}-a-${protein}-${vegetable}-${starch ?? 'none'}`;
}

/**
 * Identifiant d'un menu fixe : coach-<repas>-o<numero>.
 * @param {ProgramSlot} slot
 * @param {number} index
 * @returns {string}
 */
export function optionId(slot, index) {
  return `coach-${slot}-o${index}`;
}

/**
 * Recette d'un repas du programme, reconstruite a partir de son identifiant. null si le
 * programme ne contient plus ce repas.
 * @param {string} id
 * @param {CoachPlan} plan
 * @returns {Recipe | null}
 */
export function coachRecipe(id, plan) {
  const m = /^coach-([a-z_]+)-(a-(.+)|o(\d+))$/.exec(id);
  if (!m) return null;
  const meal = plan.meals.find((x) => x.slot === m[1]);
  if (!meal) return null;
  const parsed = parseCoachMeal(meal.text);
  if (m[4] !== undefined) {
    const option = parsed.options[Number(m[4])];
    return option ? optionRecipe(id, meal, option, parsed.extras, plan) : null;
  }
  if (!parsed.assembled) return null;
  const [protein, vegetable, starch] = /** @type {string} */ (m[3]).split('-');
  return assembledRecipe(id, meal, parsed, protein, vegetable, starch === 'none' ? null : starch, plan);
}

/** Recette de base commune aux repas du programme. */
const BASE = {
  description: 'Repas du programme de votre coach : quantités pour une personne.',
  cuisine: 'french',
  servings: 1,
  difficulty: /** @type {const} */ ('easy'),
  vessel: null,
  preparations: [],
  status: /** @type {const} */ ('validated'),
};

/**
 * @param {CoachPlan} plan
 * @returns {import('../recipes/recipes.js').RecipeSource}
 */
const source = (plan) => ({ type: 'personal', author: 'Programme de mon coach', license: 'Programme personnel, importé dans MealDom', addedAt: plan.importedAt });

/**
 * Repas assemble : proteine + legumes + feculent (pesé cuit) + huile apres cuisson.
 * @param {string} id
 * @param {CoachMeal} meal
 * @param {ParsedMeal} parsed
 * @param {string} protein
 * @param {string} vegetable
 * @param {string | null} starch
 * @param {CoachPlan} plan
 * @returns {Recipe | null}
 */
function assembledRecipe(id, meal, parsed, protein, vegetable, starch, plan) {
  const a = /** @type {NonNullable<ParsedMeal['assembled']>} */ (parsed.assembled);
  if (!a.protein.choices.includes(protein) || !a.vegetables.choices.includes(vegetable)) return null;
  if (starch && !a.starch?.choices.includes(starch)) return null;
  const pg = /** @type {number} */ (a.protein.grams);
  const vg = /** @type {number} */ (a.vegetables.grams);
  /** @type {IngredientLine[]} */
  const ingredients = [];
  /** @type {string[]} */
  const steps = [];
  const minutes = [];
  // Proteine (les oeufs sont comptes a la piece : 55 g environ sans coquille).
  const eggs = Math.max(1, Math.round(pg / 55));
  if (protein === 'egg') ingredients.push({ ingredientId: 'egg', quantity: eggs, unit: 'piece', note: `${pg} g de protéines` });
  else ingredients.push({ ingredientId: protein, quantity: pg, unit: 'g' });
  const ps = PROTEIN_STEPS[protein];
  steps.push(ps ? ps.step(protein === 'egg' ? `${eggs} œufs` : `${pg} g`) : `Cuire ${pg} g de ${coachFoodLabel(protein)} sans matière grasse.`);
  minutes.push(ps?.minutes ?? 10);
  // Legumes (salade composee : laitue, tomates, concombre).
  const vegLabel = a.vegetables.gramsMax ? `${vg} à ${a.vegetables.gramsMax} g` : `${vg} g`;
  if (vegetable.includes('+')) {
    const parts = vegetable.split('+');
    const shares = parts.length === 3 ? [0.3, 0.45, 0.25] : parts.map(() => 1 / parts.length);
    parts.forEach((p, i) => ingredients.push({ ingredientId: p, quantity: Math.round(vg * shares[i]), unit: 'g' }));
  } else ingredients.push({ ingredientId: vegetable, quantity: vg, unit: 'g', ...(a.vegetables.gramsMax ? { note: `${vg} à ${a.vegetables.gramsMax} g` } : {}) });
  const vs = VEGETABLE_STEPS[vegetable];
  steps.push(vs ? vs.step(vegLabel) : `Cuire ${vegLabel} de ${coachFoodLabel(vegetable)} à la vapeur.`);
  minutes.push(vs?.minutes ?? 10);
  // Feculent : achete et cuit cru, pesé cuit.
  if (starch && a.starch?.grams) {
    const cooked = a.starch.grams;
    const factor = a.starch.cooked ? RAW_PER_COOKED[/** @type {keyof typeof RAW_PER_COOKED} */ (starch)] ?? 0.4 : 1;
    const raw = Math.round((cooked * factor) / 5) * 5 || cooked;
    ingredients.push({ ingredientId: starch, quantity: raw, unit: 'g', ...(factor !== 1 ? { note: `${cooked} g une fois cuit` } : {}) });
    const ss = STARCH_STEPS[starch];
    steps.push(ss ? ss.step(`${raw} g`, `${cooked} g`) : `Cuire le féculent, puis peser ${cooked} g cuit.`);
    minutes.push(ss?.minutes ?? 15);
  }
  // Huile ajoutee apres cuisson.
  if (a.fat) {
    const oil = a.fat.choices[0] ?? 'rapeseed_oil';
    ingredients.push({ ingredientId: oil, quantity: 1, unit: 'tbsp', note: 'après cuisson' });
    steps.push(`Servir et ajouter 1 cuillère à soupe d’${coachFoodLabel(oil).replace(/^huile /, 'huile ')} sur le repas, après cuisson.`);
  } else steps.push('Servir.');
  const words = [coachFoodLabel(protein), coachFoodLabel(vegetable), ...(starch ? [coachFoodLabel(starch)] : [])];
  const seafood = ['white_fish', 'salmon', 'tuna_canned', 'shrimp'].includes(protein);
  return {
    ...BASE,
    id,
    name: capitalize(joinWords(words)),
    prepMinutes: 10,
    cookMinutes: Math.max(...minutes),
    ingredients,
    // Poele, four ou vapeur au choix (les etapes donnent les deux) : aucun appareil impose.
    methods: [{ id: 'coach', label: 'Cuisson sans matière grasse', equipment: [], steps }],
    tips: [...parsed.extras.map((e) => `À prendre avec : ${e}`), ...plan.rules],
    source: source(plan),
    mealTypes: [meal.slot === 'lunch' || meal.slot === 'dinner' ? meal.slot : 'lunch'],
    tags: ['light'],
    family: PROTEIN_FAMILY[protein] ?? 'veggie',
    // Repas « meal prep » classique : 3 jours au frais, 2 avec du poisson ; pas de congelation (feculents et legumes).
    keeping: { fridgeDays: seafood ? 2 : 3, freezes: false },
  };
}

/**
 * Aliments d'un menu fixe : chaque morceau de phrase (« + », virgule, « avec », « topping »)
 * donne au plus un aliment et sa quantite.
 * @param {string[]} lines
 * @returns {IngredientLine[]}
 */
export function optionIngredients(lines) {
  /** @type {IngredientLine[]} */
  const out = [];
  for (const line of lines) {
    const fragments = normalizeText(line).split(/\+|,|\bavec\b|\bet\b|topping\s*:|\(|\)|;/);
    for (const fragment of fragments) {
      const food = foodsIn(fragment)[0];
      if (!food || out.some((l) => l.ingredientId === food.id)) continue;
      const { grams } = gramsIn(fragment);
      const count = /(?:^|\s)(\d+|une?|deux|trois)\s+(?:tranches?\s+(?:de\s+)?)?(?!g\b|gr\b)/.exec(fragment.trim());
      const spoon = /cuilleres? a (cafe|soupe)/.exec(fragment);
      const words = { un: 1, une: 1, deux: 2, trois: 3 };
      const n = count ? (count[1] in words ? words[/** @type {keyof typeof words} */ (count[1])] : Number(count[1])) : null;
      const def = DEFAULT_QTY[food.id] ?? { quantity: null, unit: 'to_taste' };
      if (grams !== null) out.push({ ingredientId: food.id, quantity: grams, unit: 'g' });
      else if (spoon) out.push({ ingredientId: food.id, quantity: n ?? 1, unit: spoon[1] === 'cafe' ? 'tsp' : 'tbsp' });
      else if (n !== null && food.id in PIECE_GRAMS) out.push({ ingredientId: food.id, quantity: Math.round(n * PIECE_GRAMS[/** @type {keyof typeof PIECE_GRAMS} */ (food.id)]), unit: 'g', note: `${n} ${coachFoodLabel(food.id)}` });
      else if (n !== null && /tranches?/.test(fragment)) out.push({ ingredientId: food.id, quantity: n, unit: 'slice' });
      else if (n !== null && def.unit === 'piece') out.push({ ingredientId: food.id, quantity: n, unit: 'piece' });
      else out.push({ ingredientId: food.id, quantity: def.quantity, unit: def.unit });
    }
  }
  return out;
}

/** Aliments d'accompagnement : pas dans le nom du menu. */
const MINOR = new Set(['honey', 'cinnamon', 'lemon', 'oat_drink', 'chia_seeds', 'almonds', 'walnuts']);

/**
 * Menu fixe (petit-dejeuner, collation).
 * @param {string} id
 * @param {CoachMeal} meal
 * @param {CoachOption} option
 * @param {string[]} extras
 * @param {CoachPlan} plan
 * @returns {Recipe}
 */
function optionRecipe(id, meal, option, extras, plan) {
  const ingredients = optionIngredients([...option.lines, ...extras]);
  // Nom : le plat annonce (« Pancakes (… ») ou les aliments principaux.
  const lead = /^([^(\d]{3,30})\(/.exec(option.lines[0] ?? '');
  const main = ingredients.filter((l) => !MINOR.has(l.ingredientId)).map((l) => coachFoodLabel(l.ingredientId));
  const name = lead ? lead[1].trim() : main.length ? joinWords(main.slice(0, 3)) : option.lines[0]?.slice(0, 40) ?? 'Repas du programme';
  return {
    ...BASE,
    id,
    name: capitalize(name),
    prepMinutes: 5,
    cookMinutes: /pancake|casserole|micro|cuire|poele/i.test(option.lines.join(' ')) ? 5 : 0,
    ingredients,
    methods: [{ id: 'coach', label: 'Selon le programme', equipment: [], steps: [...option.lines, ...extras.map((e) => `Avec : ${e}`)] }],
    tips: plan.rules,
    source: source(plan),
    mealTypes: [meal.slot === 'breakfast' ? 'breakfast' : meal.slot === 'lunch' || meal.slot === 'dinner' ? meal.slot : 'snack'],
    family: meal.slot === 'breakfast' ? 'breakfast' : 'sweets',
    keeping: { fridgeDays: 0, freezes: false },
  };
}

// ---------------------------------------------------------------------------
// Semaine du programme
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CoachWeekContext
 * @property {string[]} days               Jours a planifier (deja limites a partir d'aujourd'hui)
 * @property {ProgramSlot[]} slots         Repas demandes
 * @property {Meal[]} meals                Repas deja prevus
 * @property {boolean} redo                Remplacer les repas non verrouilles
 * @property {Set<number>} sportDays       0 = lundi ... 6 = dimanche
 * @property {(recipe: Recipe) => boolean} allowed   Compatible avec le foyer (allergies, regimes, aliments refuses)
 */

/**
 * @typedef {{ date: string, slot: ProgramSlot, recipe: Recipe, mealId: string | null }} CoachPick
 */

/**
 * Jour de la semaine (0 = lundi).
 * @param {string} date
 * @returns {number}
 */
function weekday(date) {
  const d = parseIsoDate(date);
  return d ? (d.getDay() + 6) % 7 : 0;
}

/**
 * Semaine composee selon le programme : chaque repas suit les grammages du coach ; les
 * proteines, legumes et feculents tournent (jamais la meme proteine deux repas de suite),
 * les menus fixes alternent ; la collation d'apres sport seulement les jours de sport.
 * @param {CoachPlan} plan
 * @param {CoachWeekContext} ctx
 * @returns {{ picks: CoachPick[], notes: string[] }}
 */
export function planCoachWeek(plan, ctx) {
  /** @type {CoachPick[]} */
  const picks = [];
  /** @type {string[]} */
  const notes = [];
  const parsed = new Map(plan.meals.map((m) => [m.slot, parseCoachMeal(m.text)]));
  // Compteurs de rotation par repas, pour varier d'un jour a l'autre.
  /** @type {Map<string, number>} */
  const turn = new Map();
  /** @type {Map<ProgramSlot, number>} */
  const kept = new Map();
  /** @type {Set<ProgramSlot>} */
  const impossible = new Set();
  let assembledCount = 0;
  let lastProtein = '';
  const sportSnack = plan.meals.find((m) => m.sportDaysOnly);
  if (sportSnack && ctx.slots.includes(sportSnack.slot) && ctx.sportDays.size === 0) {
    notes.push('La collation d’après le sport n’est planifiée que les jours de sport : indiquez-les dans le programme minceur (semaine type de sport).');
  }
  // Choix compatibles avec le foyer, repas par repas (un aliment refuse n'ecarte que lui).
  /** @type {Map<ProgramSlot, { proteins: string[], vegs: string[], starches: (string | null)[] } | null>} */
  const usable = new Map();
  for (const meal of plan.meals) {
    const a = parsed.get(meal.slot)?.assembled;
    if (a) usable.set(meal.slot, usableChoices(meal.slot, a, plan, ctx.allowed));
  }
  for (const date of ctx.days) {
    for (const meal of plan.meals) {
      if (!ctx.slots.includes(meal.slot)) continue;
      if (meal.sportDaysOnly && !ctx.sportDays.has(weekday(date))) continue;
      const existing = ctx.meals.find((m) => m.date === date && m.slot === meal.slot) ?? null;
      if (existing && (!ctx.redo || existing.locked)) {
        if (!existing.recipeId.startsWith('coach-')) kept.set(meal.slot, (kept.get(meal.slot) ?? 0) + 1);
        continue;
      }
      const p = /** @type {ParsedMeal} */ (parsed.get(meal.slot));
      /** @type {Recipe | null} */
      let recipe = null;
      if (p.assembled) {
        const u = usable.get(meal.slot);
        if (!u) {
          impossible.add(meal.slot);
          continue;
        }
        const k = assembledCount;
        let protein = u.proteins[k % u.proteins.length];
        if (protein === lastProtein && u.proteins.length > 1) protein = u.proteins[(k + 1) % u.proteins.length];
        const vegetable = u.vegs[(k + Math.floor(k / u.vegs.length)) % u.vegs.length];
        const starch = u.starches[(k * 3 + Math.floor(k / u.starches.length)) % u.starches.length];
        recipe = coachRecipe(assembledId(meal.slot, protein, vegetable, starch), plan);
        // Combinaison refusee (deux aliments ensemble) : la premiere qui convient avec cette proteine.
        if (!recipe || !ctx.allowed(recipe)) {
          recipe = null;
          for (const v of u.vegs) {
            for (const st of u.starches) {
              /** @type {Recipe | null} */
              const r = recipe ? null : coachRecipe(assembledId(meal.slot, protein, v, st), plan);
              if (r && ctx.allowed(r)) recipe = r;
            }
          }
        }
        assembledCount += 1;
        lastProtein = protein;
      } else if (p.options.length) {
        const start = turn.get(meal.slot) ?? 0;
        for (let i = 0; i < p.options.length && !recipe; i += 1) {
          const candidate = coachRecipe(optionId(meal.slot, (start + i) % p.options.length), plan);
          if (candidate && ctx.allowed(candidate)) recipe = candidate;
        }
        turn.set(meal.slot, start + 1);
        if (!recipe) impossible.add(meal.slot);
      }
      if (recipe && ctx.allowed(recipe)) picks.push({ date, slot: meal.slot, recipe, mealId: existing?.id ?? null });
    }
  }
  const slotName = (/** @type {ProgramSlot} */ s) => SLOT_NAMES[s];
  if (kept.size) {
    const list = [...kept].map(([slot, n]) => `${n} ${slotName(slot)}${n > 1 ? 's' : ''}`);
    notes.push(`${joinWords(list)} déjà prévu${[...kept.values()].reduce((a, b) => a + b, 0) > 1 ? 's' : ''} ${[...kept.values()].reduce((a, b) => a + b, 0) > 1 ? 'sont gardés' : 'est gardé'}. Pour les remplacer par les repas du programme, choisissez « Tout refaire ».`);
  }
  if (impossible.size) notes.push(`Aucun ${joinWords([...impossible].map(slotName))} du programme ne convient à votre foyer (allergies, régimes ou aliments refusés) : vérifiez « Mon foyer ».`);
  return { picks, notes };
}

/** Noms des repas dans les messages. */
const SLOT_NAMES = /** @type {Record<ProgramSlot, string>} */ ({ breakfast: 'petit-déjeuner', morning_snack: 'collation du matin', lunch: 'déjeuner', snack: 'goûter', dinner: 'dîner' });

/**
 * Proteines, legumes et feculents d'un repas assemble qui conviennent au foyer : on trouve une
 * combinaison acceptee, puis on garde chaque aliment qui passe avec elle. null si aucune.
 * @param {ProgramSlot} slot
 * @param {NonNullable<ParsedMeal['assembled']>} a
 * @param {CoachPlan} plan
 * @param {(recipe: Recipe) => boolean} allowed
 * @returns {{ proteins: string[], vegs: string[], starches: (string | null)[] } | null}
 */
function usableChoices(slot, a, plan, allowed) {
  /** @type {(string | null)[]} */
  const starches = a.starch?.choices.length ? a.starch.choices : [null];
  const ok = (/** @type {string} */ p, /** @type {string} */ v, /** @type {string | null} */ st) => {
    const r = coachRecipe(assembledId(slot, p, v, st), plan);
    return r !== null && allowed(r);
  };
  /** @type {[string, string, string | null] | null} */
  let base = null;
  for (const p of a.protein.choices) for (const v of a.vegetables.choices) for (const st of starches) if (!base && ok(p, v, st)) base = [p, v, st];
  if (!base) return null;
  const [bp, bv, bs] = base;
  return {
    proteins: a.protein.choices.filter((p) => ok(p, bv, bs)),
    vegs: a.vegetables.choices.filter((v) => ok(bp, v, bs)),
    starches: starches.filter((st) => ok(bp, bv, st)),
  };
}

/**
 * Recettes d'une journee type du programme (premieres possibilites), pour estimer les apports.
 * @param {CoachPlan} plan
 * @param {boolean} sportDay
 * @returns {Recipe[]}
 */
export function typicalDay(plan, sportDay) {
  /** @type {Recipe[]} */
  const out = [];
  for (const meal of plan.meals) {
    if (meal.sportDaysOnly && !sportDay) continue;
    const p = parseCoachMeal(meal.text);
    const r = p.assembled
      ? coachRecipe(assembledId(meal.slot, p.assembled.protein.choices[0], p.assembled.vegetables.choices[0], p.assembled.starch?.choices[0] ?? null), plan)
      : coachRecipe(optionId(meal.slot, 0), plan);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Date du prochain bilan (poids, mensurations) : toutes les N semaines depuis l'import.
 * @param {CoachPlan} plan
 * @param {string} today
 * @returns {string | null}
 */
export function nextCheckIn(plan, today) {
  if (!plan.checkInWeeks) return null;
  let date = plan.importedAt;
  while (date <= today) date = addDays(date, plan.checkInWeeks * 7);
  return date;
}

// ---------------------------------------------------------------------------
// Lecture par l'IA (PDF, photo, capture d'ecran)
// ---------------------------------------------------------------------------

/** Consignes de lecture d'un programme par l'IA. */
export const COACH_PROMPT = `Tu recopies le programme alimentaire qu'un coach sportif ou une diététicienne a donné à une personne.
Recopie fidèlement, en français : n'invente rien, ne change aucune quantité, n'ajoute aucun aliment.
Pour chaque repas :
- slot : breakfast (petit-déjeuner), morning_snack (collation du matin), lunch (déjeuner), snack (collation de l'après-midi ou d'après le sport), dinner (dîner) ;
- time : l'horaire tel qu'écrit, par exemple « 7 h - 7 h 30 » (vide s'il n'y en a pas) ;
- sportDaysOnly : vrai si ce repas n'est pris que les jours de sport ;
- text : une ligne par élément, la quantité en tête quand elle existe (« 170 g de protéines (poulet, dinde, bœuf...) », « 100 g de riz, quinoa... (à peser cuit) », « 1 cuillère à soupe d'huile de colza après cuisson ») ; une ligne « Ou » seule entre deux possibilités ; les compléments communs à toutes les possibilités sur des lignes commençant par « + » (« + 10 amandes ou noix », « + un thé vert », gélules) ou par « À jeun : ».
rules : les consignes générales, une par élément (interdits, autorisations).
waterLiters : l'eau à boire par jour, en litres, si elle est indiquée.
checkInWeeks : tous les combien de semaines faire le bilan (poids, mensurations), si c'est indiqué.
notes : l'objectif en une phrase, sans nom, prénom ni autre information personnelle.`;

/** Format de la reponse de l'IA. */
export const COACH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean', description: 'false si le document ne contient pas de programme alimentaire lisible' },
    meals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slot: { type: 'string', enum: COACH_SLOT_ORDER },
          time: { type: 'string' },
          sportDaysOnly: { type: 'boolean' },
          text: { type: 'string' },
        },
        required: ['slot', 'time', 'sportDaysOnly', 'text'],
      },
    },
    rules: { type: 'array', items: { type: 'string' } },
    waterLiters: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    checkInWeeks: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    notes: { type: 'string' },
  },
  required: ['found', 'meals', 'rules', 'waterLiters', 'checkInWeeks', 'notes'],
};

/**
 * Reponse de l'IA verifiee et mise en forme. null si aucun programme n'a ete lu.
 * @param {unknown} raw
 * @param {string} today
 * @returns {CoachPlan | null}
 */
export function readCoachAnswer(raw, today) {
  const r = /** @type {Record<string, unknown>} */ (raw ?? {});
  if (r.found === false || !Array.isArray(r.meals)) return null;
  /** @type {CoachMeal[]} */
  const meals = [];
  for (const m of r.meals) {
    const x = /** @type {Record<string, unknown>} */ (m ?? {});
    const slot = COACH_SLOT_ORDER.find((s) => s === x.slot);
    const text = typeof x.text === 'string' ? x.text.trim() : '';
    if (!slot || !text || meals.some((y) => y.slot === slot)) continue;
    meals.push({ slot, time: typeof x.time === 'string' ? x.time.trim().slice(0, 40) : '', sportDaysOnly: x.sportDaysOnly === true && slot === 'snack', text: text.slice(0, 3000) });
  }
  if (!meals.length) return null;
  meals.sort((a, b) => COACH_SLOT_ORDER.indexOf(a.slot) - COACH_SLOT_ORDER.indexOf(b.slot));
  const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const water = num(r.waterLiters);
  const weeks = num(r.checkInWeeks);
  return {
    title: 'Programme de mon coach',
    meals,
    rules: Array.isArray(r.rules) ? r.rules.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim().slice(0, 300)).slice(0, 20) : [],
    waterLiters: water !== null && water > 0 && water <= 6 ? water : null,
    checkInWeeks: weeks !== null && Number.isInteger(weeks) && weeks >= 1 && weeks <= 12 ? weeks : null,
    notes: typeof r.notes === 'string' ? r.notes.trim().slice(0, 300) : '',
    importedAt: today,
  };
}
