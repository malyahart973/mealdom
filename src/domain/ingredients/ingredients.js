/**
 * Ingredients normalises : reconnaissance des noms et allergenes.
 */

/**
 * Conversion propre a un ingredient : 1 fromUnit = factor toUnit.
 * @typedef {Object} IngredientConversion
 * @property {string} fromUnit
 * @property {string} toUnit
 * @property {number} factor
 * @property {string} source
 * @property {'high' | 'medium' | 'low'} confidence
 * @property {string} [note]
 */

/**
 * @typedef {Object} Ingredient
 * @property {string} id
 * @property {string} name              Nom affiche
 * @property {string[]} aliases         Autres ecritures acceptees (pluriel, anglais...)
 * @property {string[]} allergens       Identifiants parmi les 14 allergenes
 * @property {IngredientConversion[]} conversions
 * @property {boolean} [notPurchased]   Vrai pour l'eau du robinet : jamais dans la liste de courses
 * @property {DietCategory[]} [categories]  Origine animale, pour les regimes (vide = vegetal)
 * @property {Aisle} [aisle]              Rayon du magasin, pour classer la liste de courses
 */

/**
 * @typedef {'fruits_vegetables' | 'meat_fish' | 'dairy_eggs' | 'grocery' | 'spices' | 'frozen' | 'bakery' | 'other'} Aisle
 */

/** Rayons, dans l'ordre habituel d'un magasin. @type {{ id: Aisle, label: string }[]} */
export const AISLES = [
  { id: 'fruits_vegetables', label: 'Fruits et légumes' },
  { id: 'bakery', label: 'Pain et boulangerie' },
  { id: 'meat_fish', label: 'Viandes et poissons' },
  { id: 'dairy_eggs', label: 'Crèmerie et œufs' },
  { id: 'grocery', label: 'Épicerie' },
  { id: 'spices', label: 'Épices et condiments' },
  { id: 'frozen', label: 'Surgelés' },
  { id: 'other', label: 'Autres' },
]

/**
 * @typedef {'meat' | 'poultry' | 'pork' | 'fish' | 'shellfish' | 'dairy' | 'egg' | 'honey' | 'gelatin' | 'animal_rennet'} DietCategory
 */

/**
 * Met un texte sous forme comparable : minuscules, sans accents, espaces simplifies.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Construit l'index de reconnaissance des noms.
 * Refuse qu'un meme nom designe deux ingredients differents (pas de fusion abusive).
 * @param {Ingredient[]} ingredients
 * @returns {Map<string, string>} nom normalise -> id d'ingredient
 */
export function buildNameIndex(ingredients) {
  /** @type {Map<string, string>} */
  const index = new Map();
  for (const ingredient of ingredients) {
    for (const name of [ingredient.name, ...ingredient.aliases]) {
      const key = normalizeText(name);
      const existing = index.get(key);
      if (existing && existing !== ingredient.id) {
        throw new Error(`Le nom "${name}" designe deja l'ingredient "${existing}".`);
      }
      index.set(key, ingredient.id);
    }
  }
  return index;
}

/**
 * Trouve l'ingredient correspondant a un texte. Renvoie null si inconnu :
 * on ne devine jamais.
 * @param {string} text
 * @param {Map<string, string>} nameIndex
 * @returns {string | null}
 */
export function findIngredientId(text, nameIndex) {
  return nameIndex.get(normalizeText(text)) ?? null;
}

/**
 * Ingredients aux noms proches d'un texte (fautes de frappe, pluriel, mot en trop), du plus
 * proche au moins proche : pour proposer « Vouliez-vous dire… ? », jamais pour choisir a la place.
 * @param {string} text
 * @param {Ingredient[]} ingredients
 * @param {number} limit
 * @returns {Ingredient[]}
 */
export function suggestIngredients(text, ingredients, limit) {
  const query = normalizeText(text).replace(/[^a-z0-9' ]/g, ' ').split(' ').filter((w) => w.length >= 3);
  if (!query.length) return [];
  /** @param {string} a @param {string} b */
  const close = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))));
  /** @type {{ ingredient: Ingredient, score: number }[]} */
  const scored = [];
  for (const ingredient of ingredients) {
    if (ingredient.notPurchased) continue;
    let best = 0;
    for (const [i, name] of [ingredient.name, ...ingredient.aliases].entries()) {
      const words = normalizeText(name).split(' ').filter((w) => w.length >= 3);
      const own = i === 0 ? 0.1 : 0;
      // Le premier mot porte le sens (« café moulu », « tomate cerise ») : il doit ressembler.
      if (!words.some((w) => close(query[0], w))) continue;
      const hits = query.filter((q) => words.some((w) => close(q, w))).length;
      best = Math.max(best, hits / Math.max(query.length, words.length) + (close(query[0], words[0] ?? '') ? 0.5 : 0) + own);
    }
    if (best > 0) scored.push({ ingredient, score: best });
  }
  return scored.sort((a, b) => b.score - a.score || a.ingredient.name.length - b.ingredient.name.length).slice(0, limit).map((s) => s.ingredient);
}

/**
 * Resultat de la verification des allergenes d'une liste d'ingredients.
 * - compatible : aucun allergene interdit
 * - incompatible : au moins un allergene interdit (liste dans "found")
 * - unknown : un ingredient n'est pas connu, on ne peut rien garantir
 * @typedef {{ status: 'compatible' } | { status: 'incompatible', found: string[] } | { status: 'unknown', unknownIngredients: string[] }} AllergenCheck
 */

/**
 * Verifie qu'aucun ingredient ne contient un allergene interdit.
 * Un ingredient inconnu rend le resultat "unknown", jamais "compatible".
 * @param {string[]} ingredientIds
 * @param {string[]} forbiddenAllergens
 * @param {Map<string, Ingredient>} catalog
 * @returns {AllergenCheck}
 */
export function checkAllergens(ingredientIds, forbiddenAllergens, catalog) {
  const forbidden = new Set(forbiddenAllergens);
  /** @type {Set<string>} */
  const found = new Set();
  /** @type {string[]} */
  const unknownIngredients = [];

  for (const id of ingredientIds) {
    const ingredient = catalog.get(id);
    if (!ingredient) {
      unknownIngredients.push(id);
      continue;
    }
    for (const allergen of ingredient.allergens) {
      if (forbidden.has(allergen)) found.add(allergen);
    }
  }

  // Un allergene interdit trouve suffit a exclure, meme si d'autres ingredients sont inconnus.
  if (found.size > 0) return { status: 'incompatible', found: [...found].sort() };
  if (unknownIngredients.length > 0) return { status: 'unknown', unknownIngredients };
  return { status: 'compatible' };
}
