/**
 * Modele des recettes et des preparations (RM-16 a RM-19), et regles associees.
 */
import { getUnit } from '../units/units.js';

/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */

/**
 * Ligne d'ingredient. quantity est null pour une quantite qualitative ("au goût").
 * @typedef {{ ingredientId: string, quantity: number | null, unit: string, note?: string }} IngredientLine
 */

/** @typedef {{ preparationId: string, quantity: number, unit: string }} PreparationLine */

/**
 * Methode de cuisson : equipements necessaires et etapes propres a cette methode.
 * @typedef {{ id: string, label: string, equipment: string[], steps: string[] }} CookingMethod
 */

/**
 * @typedef {Object} RecipeSource
 * @property {'original' | 'licensed' | 'personal'} type
 * @property {string} author
 * @property {string} license
 * @property {string} addedAt          Date ISO (AAAA-MM-JJ)
 */

/**
 * Preparation reutilisable (riz cuit, poulet effiloche...) : la base du batch cooking.
 * @typedef {Object} Preparation
 * @property {string} id
 * @property {string} name
 * @property {{ quantity: number, unit: string }} yield   Quantite obtenue
 * @property {number} prepMinutes
 * @property {number} cookMinutes
 * @property {IngredientLine[]} ingredients
 * @property {CookingMethod[]} methods
 */

/** @typedef {'draft' | 'imported' | 'needs_review' | 'validated' | 'archived'} RecipeStatus */

/** @typedef {'one_pot' | 'one_pan' | 'one_tray'} Vessel */

/** @typedef {'breakfast' | 'lunch' | 'dinner' | 'snack'} MealType */

/**
 * Etiquettes utilisees par les suggestions et l'assistant.
 * @typedef {'gourmand' | 'light' | 'budget' | 'convivial' | 'spicy' | 'make_ahead' | 'kids'} RecipeTag
 */

/** @type {{ id: MealType, label: string }[]} */
export const MEAL_TYPES = [
  { id: 'breakfast', label: 'Petit-déjeuner' },
  { id: 'lunch', label: 'Déjeuner' },
  { id: 'snack', label: 'Goûter' },
  { id: 'dinner', label: 'Dîner' },
];

/** @type {{ id: RecipeTag, label: string }[]} */
export const RECIPE_TAGS = [
  { id: 'gourmand', label: 'Gourmand' },
  { id: 'light', label: 'Léger' },
  { id: 'budget', label: 'Économique' },
  { id: 'convivial', label: 'Convivial' },
  { id: 'spicy', label: 'Épicé' },
  { id: 'make_ahead', label: 'Se prépare à l’avance' },
  { id: 'kids', label: 'Apprécié des enfants' },
];

/** Recette rapide : 30 minutes au plus, preparation et cuisson comprises. */
export const QUICK_MINUTES = 30;

/**
 * @typedef {Object} Recipe
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} cuisine
 * @property {number} servings              Portions ADULTES de reference
 * @property {number} prepMinutes
 * @property {number} cookMinutes
 * @property {'easy' | 'medium' | 'hard'} difficulty
 * @property {Vessel | null} vessel
 * @property {IngredientLine[]} ingredients
 * @property {PreparationLine[]} preparations   Preparations consommees
 * @property {CookingMethod[]} methods
 * @property {string[]} tips
 * @property {RecipeSource} source
 * @property {RecipeStatus} status
 * @property {MealType[]} [mealTypes]      Repas ou la recette a sa place (defaut : dejeuner et diner)
 * @property {RecipeTag[]} [tags]
 * @property {string} [family]            Famille de plat imposee (sinon deduite, voir families.js)
 */

/** @type {Record<Vessel, string>} */
export const VESSEL_LABELS = {
  one_pot: 'Une seule cocotte',
  one_pan: 'Une seule poêle',
  one_tray: 'Un seul plat au four',
};

/** @type {Record<Recipe['difficulty'], string>} */
export const DIFFICULTY_LABELS = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' };

/**
 * @param {{ prepMinutes: number, cookMinutes: number }} item
 * @returns {number}
 */
export function totalMinutes(item) {
  return item.prepMinutes + item.cookMinutes;
}

/**
 * Recette avec des ingredients remplaces (pour un repas). Les quantites sont conservees :
 * on remplace poids pour poids. La recette d'origine n'est pas modifiee.
 * @param {Recipe} recipe
 * @param {{ from: string, to: string }[]} substitutions
 * @returns {Recipe}
 */
export function applySubstitutions(recipe, substitutions) {
  if (!substitutions.length) return recipe;
  const map = new Map(substitutions.map((s) => [s.from, s.to]));
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((l) => (map.has(l.ingredientId) ? { ...l, ingredientId: /** @type {string} */ (map.get(l.ingredientId)) } : l)),
  };
}

/**
 * Repas ou la recette a sa place.
 * @param {Recipe} recipe
 * @returns {MealType[]}
 */
export function recipeMealTypes(recipe) {
  return recipe.mealTypes && recipe.mealTypes.length ? recipe.mealTypes : ['lunch', 'dinner'];
}

/**
 * La recette a-t-elle sa place a ce creneau du planning ?
 * La collation du matin reprend les recettes de gouter.
 * @param {Recipe} recipe
 * @param {string} slot
 * @returns {boolean}
 */
export function fitsSlot(recipe, slot) {
  return recipeMealTypes(recipe).includes(/** @type {MealType} */ (slot === 'morning_snack' ? 'snack' : slot));
}

/**
 * @param {Recipe} recipe
 * @param {RecipeTag} tag
 * @returns {boolean}
 */
export function hasTag(recipe, tag) {
  return (recipe.tags ?? []).includes(tag);
}

/**
 * Tous les ingredients d'une recette, y compris ceux de ses preparations.
 * @param {Recipe} recipe
 * @param {Map<string, Preparation>} preparations
 * @returns {string[]}
 */
export function allIngredientIds(recipe, preparations) {
  const ids = new Set(recipe.ingredients.map((l) => l.ingredientId));
  for (const line of recipe.preparations) {
    const prep = preparations.get(line.preparationId);
    if (prep) for (const l of prep.ingredients) ids.add(l.ingredientId);
    else ids.add(`preparation:${line.preparationId}`); // inconnue -> verification "unknown"
  }
  return [...ids];
}

/**
 * Liste des allergenes contenus dans une recette.
 * @param {Recipe} recipe
 * @param {Map<string, Preparation>} preparations
 * @param {Map<string, Ingredient>} ingredients
 * @returns {{ allergens: string[], complete: boolean }}  complete = faux si un ingredient est inconnu
 */
export function recipeAllergens(recipe, preparations, ingredients) {
  const found = new Set();
  let complete = true;
  for (const id of allIngredientIds(recipe, preparations)) {
    const ingredient = ingredients.get(id);
    if (!ingredient) complete = false;
    else for (const a of ingredient.allergens) found.add(a);
  }
  return { allergens: [...found].sort(), complete };
}

/**
 * Methodes realisables avec l'equipement du foyer (RM-11).
 * @param {Recipe | Preparation} item
 * @param {string[]} householdEquipment
 * @returns {CookingMethod[]}
 */
export function compatibleMethods(item, householdEquipment) {
  const owned = new Set(householdEquipment);
  return item.methods.filter((m) => m.equipment.every((e) => owned.has(e)));
}

/**
 * Vrai si le foyer peut realiser la recette ET chacune de ses preparations
 * avec son equipement. Une preparation inconnue rend la recette irrealisable.
 * @param {Recipe} recipe
 * @param {string[]} householdEquipment
 * @param {Map<string, Preparation>} preparations
 * @returns {boolean}
 */
export function isFeasibleWithEquipment(recipe, householdEquipment, preparations) {
  if (compatibleMethods(recipe, householdEquipment).length === 0) return false;
  return recipe.preparations.every((line) => {
    const prep = preparations.get(line.preparationId);
    return prep !== undefined && compatibleMethods(prep, householdEquipment).length > 0;
  });
}

/**
 * Preparations partagees : uniquement les references EXPLICITES (RM-19).
 * Deux recettes qui ont seulement un ingredient brut en commun ne partagent rien.
 * @param {Recipe[]} recipes
 * @returns {Map<string, string[]>} id de preparation -> ids des recettes (au moins 2)
 */
export function findSharedPreparations(recipes) {
  /** @type {Map<string, Set<string>>} */
  const users = new Map();
  for (const recipe of recipes) {
    for (const line of recipe.preparations) {
      const set = users.get(line.preparationId) ?? new Set();
      set.add(recipe.id);
      users.set(line.preparationId, set);
    }
  }
  /** @type {Map<string, string[]>} */
  const shared = new Map();
  for (const [prepId, set] of users) if (set.size >= 2) shared.set(prepId, [...set]);
  return shared;
}

/**
 * @typedef {Object} CatalogRefs
 * @property {Map<string, Ingredient>} ingredients
 * @property {Map<string, Preparation>} preparations
 * @property {Set<string>} cuisines
 * @property {Set<string>} equipment
 */

/**
 * @param {IngredientLine[]} lines
 * @param {CatalogRefs} refs
 * @param {string[]} errors
 */
function checkIngredientLines(lines, refs, errors) {
  for (const line of lines) {
    if (!refs.ingredients.has(line.ingredientId)) errors.push(`Ingrédient inconnu : ${line.ingredientId}`);
    const unit = getUnit(line.unit);
    if (!unit) {
      errors.push(`Unité inconnue : ${line.unit}`);
      continue;
    }
    if (unit.kind === 'qualitative') {
      if (line.quantity !== null) errors.push(`Quantité inutile pour « ${unit.label} » : ${line.ingredientId}`);
    } else if (line.quantity === null || !(line.quantity > 0)) {
      errors.push(`Quantité manquante : ${line.ingredientId}`);
    }
  }
}

/**
 * @param {CookingMethod[]} methods
 * @param {CatalogRefs} refs
 * @param {string[]} errors
 */
function checkMethods(methods, refs, errors) {
  if (methods.length === 0) errors.push('Aucune méthode de cuisson.');
  for (const m of methods) {
    if (m.steps.length === 0) errors.push(`Méthode sans étapes : ${m.id}`);
    for (const e of m.equipment) if (!refs.equipment.has(e)) errors.push(`Équipement inconnu : ${e}`);
  }
}

/**
 * Verifie qu'une preparation est complete.
 * @param {Preparation} prep
 * @param {CatalogRefs} refs
 * @returns {string[]} erreurs (vide = valide)
 */
export function validatePreparation(prep, refs) {
  /** @type {string[]} */
  const errors = [];
  if (!prep.name.trim()) errors.push('Nom manquant.');
  if (!(prep.yield.quantity > 0) || !getUnit(prep.yield.unit)) errors.push('Quantité obtenue invalide.');
  if (prep.ingredients.length === 0) errors.push('Aucun ingrédient.');
  checkIngredientLines(prep.ingredients, refs, errors);
  checkMethods(prep.methods, refs, errors);
  return errors;
}

/**
 * Verifie qu'une recette remplit les conditions du statut "validated".
 * @param {Recipe} recipe
 * @param {CatalogRefs} refs
 * @returns {string[]} erreurs (vide = valide)
 */
export function validateRecipe(recipe, refs) {
  /** @type {string[]} */
  const errors = [];
  if (!recipe.name.trim()) errors.push('Nom manquant.');
  if (!refs.cuisines.has(recipe.cuisine)) errors.push(`Cuisine inconnue : ${recipe.cuisine}`);
  if (!(recipe.servings > 0)) errors.push('Nombre de portions invalide.');
  if (!(recipe.prepMinutes >= 0) || !(recipe.cookMinutes >= 0)) errors.push('Temps invalides.');
  if (recipe.ingredients.length + recipe.preparations.length === 0) errors.push('Aucun ingrédient.');
  checkIngredientLines(recipe.ingredients, refs, errors);
  for (const line of recipe.preparations) {
    if (!refs.preparations.has(line.preparationId)) errors.push(`Préparation inconnue : ${line.preparationId}`);
    if (!(line.quantity > 0) || !getUnit(line.unit)) errors.push(`Quantité de préparation invalide : ${line.preparationId}`);
  }
  checkMethods(recipe.methods, refs, errors);
  const s = recipe.source;
  if (!s || !s.author || !s.license || !s.addedAt) errors.push('Provenance incomplète (auteur, licence, date).');
  for (const m of recipe.mealTypes ?? []) if (!MEAL_TYPES.some((t) => t.id === m)) errors.push(`Repas inconnu : ${m}`);
  for (const t of recipe.tags ?? []) if (!RECIPE_TAGS.some((x) => x.id === t)) errors.push(`Étiquette inconnue : ${t}`);
  return errors;
}
