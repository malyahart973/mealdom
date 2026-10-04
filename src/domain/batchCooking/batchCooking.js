/**
 * Batch cooking de base (RM-16 a RM-19) : a partir des repas planifies,
 * calcule les preparations a faire a l'avance, leurs quantites totales
 * et un ordre de travail simple et explicable.
 * Aucune optimisation mathematique : des regles lisibles et testees.
 */
import { convertUniversal, roundUpQuantity } from '../units/units.js';
import { compatibleMethods } from '../recipes/recipes.js';
import { mealPortionsFor } from '../planning/planning.js';

/** @typedef {import('../planning/planning.js').Meal} Meal */
/** @typedef {import('../household/household.js').Household} Household */
/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {import('../recipes/recipes.js').IngredientLine} IngredientLine */
/** @typedef {import('../recipes/recipes.js').CookingMethod} CookingMethod */

/**
 * @typedef {Object} PreparationUse
 * @property {string} mealId
 * @property {string} date
 * @property {import('../planning/planning.js').Slot} slot
 * @property {string} recipeName
 * @property {number} quantity       Dans l'unite de la preparation
 */

/**
 * @typedef {Object} PreparationRequirement
 * @property {string} preparationId
 * @property {number} quantity       Total a preparer, dans l'unite de la preparation
 * @property {string} unit
 * @property {PreparationUse[]} uses
 */

/**
 * Quantites de preparations necessaires pour une liste de repas.
 * Pour chaque repas : quantite de la recette x (portions a cuisiner / portions de la recette).
 * Les portions a cuisiner incluent le dejeuner du lendemain.
 * @param {Meal[]} meals
 * @param {Household} household
 * @param {Map<string, Recipe>} recipes
 * @param {Map<string, Preparation>} preparations
 * @returns {{ requirements: PreparationRequirement[], problems: string[] }}
 */
export function preparationRequirements(meals, household, recipes, preparations) {
  /** @type {Map<string, PreparationRequirement>} */
  const byPrep = new Map();
  /** @type {string[]} */
  const problems = [];
  const sorted = [...meals].sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));

  for (const meal of sorted) {
    const recipe = recipes.get(meal.recipeId);
    if (!recipe) {
      problems.push(`La recette de « ${meal.recipeName} » n’existe plus : ses préparations ne sont pas comptées.`);
      continue;
    }
    const factor = mealPortionsFor(meal, household).total / recipe.servings;
    for (const line of recipe.preparations) {
      const prep = preparations.get(line.preparationId);
      if (!prep) {
        problems.push(`Préparation inconnue dans « ${recipe.name} ».`);
        continue;
      }
      const converted = convertUniversal(line.quantity * factor, line.unit, prep.yield.unit);
      if (!converted.ok) {
        problems.push(`Unité incompatible pour ${prep.name} dans « ${recipe.name} ».`);
        continue;
      }
      const req = byPrep.get(prep.id) ?? { preparationId: prep.id, quantity: 0, unit: prep.yield.unit, uses: [] };
      req.quantity += converted.value;
      req.uses.push({ mealId: meal.id, date: meal.date, slot: meal.slot, recipeName: recipe.name, quantity: converted.value });
      byPrep.set(prep.id, req);
    }
  }

  const requirements = [...byPrep.values()].map((r) => ({
    ...r,
    quantity: roundUpQuantity(r.quantity, r.unit),
    uses: r.uses.map((u) => ({ ...u, quantity: roundUpQuantity(u.quantity, r.unit) })),
  }));
  return { requirements, problems };
}

/**
 * Ingredients d'une preparation pour une quantite voulue (regle de trois, arrondi au-dessus).
 * @param {Preparation} prep
 * @param {number} quantity          Dans l'unite du rendement de la preparation
 * @returns {{ factor: number, ingredients: IngredientLine[] }}
 */
export function scalePreparation(prep, quantity) {
  const factor = quantity / prep.yield.quantity;
  return {
    factor,
    ingredients: prep.ingredients.map((line) => ({
      ...line,
      quantity: line.quantity === null ? null : roundUpQuantity(line.quantity * factor, line.unit),
    })),
  };
}

/**
 * @typedef {Object} CookingTask
 * @property {string} preparationId
 * @property {string} name
 * @property {number} quantity
 * @property {string} unit
 * @property {CookingMethod | null} method       null si aucun materiel du foyer ne convient
 * @property {IngredientLine[]} ingredients
 * @property {number} prepMinutes                Temps actif (on est occupe)
 * @property {number} cookMinutes                Temps de cuisson (on peut faire autre chose)
 * @property {number} uses                       Nombre de repas servis
 */

/**
 * @typedef {Object} CookingSession
 * @property {CookingTask[]} tasks               Dans l'ordre conseille
 * @property {number} sequentialMinutes          En faisant tout l'un apres l'autre
 * @property {number} estimatedMinutes           En lancant les cuissons en parallele
 * @property {string[][]} parallelGroups         Taches qui cuisent en meme temps (par appareil different)
 */

/**
 * Construit une session de cuisine.
 * Regles :
 * 1. la methode retenue est la premiere realisable avec le materiel du foyer ;
 * 2. on commence par ce qui cuit le plus longtemps ;
 * 3. une personne seule : le temps actif s'additionne ;
 *    les cuissons sur des appareils differents se font en meme temps.
 * Estimation = temps actif total + cuissons du plus long appareil.
 * @param {PreparationRequirement[]} requirements
 * @param {Map<string, Preparation>} preparations
 * @param {string[]} householdEquipment
 * @returns {CookingSession}
 */
export function buildCookingSession(requirements, preparations, householdEquipment) {
  /** @type {CookingTask[]} */
  const tasks = [];
  for (const req of requirements) {
    const prep = preparations.get(req.preparationId);
    if (!prep) continue;
    const method = compatibleMethods(prep, householdEquipment)[0] ?? null;
    const factor = req.quantity / prep.yield.quantity;
    // Au-dela d'une fournee, la preparation (pas la cuisson) prend plus de temps.
    const prepMinutes = Math.ceil(prep.prepMinutes * Math.max(1, factor));
    tasks.push({
      preparationId: prep.id,
      name: prep.name,
      quantity: req.quantity,
      unit: req.unit,
      method,
      ingredients: scalePreparation(prep, req.quantity).ingredients,
      prepMinutes,
      cookMinutes: prep.cookMinutes,
      uses: req.uses.length,
    });
  }

  tasks.sort((a, b) => b.cookMinutes - a.cookMinutes || a.name.localeCompare(b.name));

  /** @type {Map<string, CookingTask[]>} */
  const lanes = new Map();
  for (const task of tasks) {
    const key = task.method?.equipment[0] ?? 'sans-appareil';
    lanes.set(key, [...(lanes.get(key) ?? []), task]);
  }

  const handsOn = tasks.reduce((sum, t) => sum + t.prepMinutes, 0);
  const longestLane = Math.max(0, ...[...lanes.values()].map((l) => l.reduce((sum, t) => sum + t.cookMinutes, 0)));
  const sequential = tasks.reduce((sum, t) => sum + t.prepMinutes + t.cookMinutes, 0);

  // Groupes : la n-ieme tache de chaque appareil cuit en meme temps.
  /** @type {string[][]} */
  const parallelGroups = [];
  const laneList = [...lanes.values()];
  const depth = Math.max(0, ...laneList.map((l) => l.length));
  for (let i = 0; i < depth; i++) {
    const group = laneList.map((l) => l[i]).filter((t) => t !== undefined && t.cookMinutes > 0).map((t) => t.preparationId);
    if (group.length > 1) parallelGroups.push(group);
  }

  return {
    tasks,
    sequentialMinutes: sequential,
    estimatedMinutes: Math.min(sequential, handsOn + longestLane),
    parallelGroups,
  };
}
