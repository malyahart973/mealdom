/**
 * Batch cooking (RM-16 a RM-19) : a partir des repas planifies,
 * calcule les preparations a faire a l'avance, leurs quantites totales,
 * les plats entiers a cuisiner pendant chaque seance (et comment les garder)
 * et un ordre de travail simple et explicable.
 * Aucune optimisation mathematique : des regles lisibles et testees.
 */
import { convertUniversal, roundUpQuantity } from '../units/units.js';
import { compatibleMethods } from '../recipes/recipes.js';
import { mealPortionsFor } from '../planning/planning.js';
import { sessionFor, storagePlan, preparationKeeping } from './keeping.js';
import { addMinutes } from '../planning/calendar.js';
import { parseIsoDate, addDays } from '../planning/dates.js';

/** @typedef {import('../planning/planning.js').Meal} Meal */
/** @typedef {import('../household/household.js').Household} Household */
/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {import('../recipes/recipes.js').IngredientLine} IngredientLine */
/** @typedef {import('../recipes/recipes.js').CookingMethod} CookingMethod */
/** @typedef {import('./keeping.js').Keeping} Keeping */

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
 * @property {string} preparationId              Identifiant de la tache : la preparation, ou « plat:<repas> » pour un plat entier
 * @property {'preparation' | 'dish'} kind
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
      kind: 'preparation',
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

  return scheduleTasks(tasks);
}

/**
 * Ordre de travail et duree d'une seance.
 * @param {CookingTask[]} list
 * @returns {CookingSession}
 */
function scheduleTasks(list) {
  const tasks = [...list].sort((a, b) => b.cookMinutes - a.cookMinutes || a.name.localeCompare(b.name));

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

// ---------------------------------------------------------------------------
// Seances de batch : plats entiers et preparations, et leur conservation
// ---------------------------------------------------------------------------

/**
 * Un repas servi par un plat cuisine pendant la seance, et comment le garder jusque-la.
 * @typedef {Object} BatchServing
 * @property {Meal} meal
 * @property {number} portions               Dejeuner du lendemain compris
 * @property {'fridge' | 'freezer'} storage
 * @property {string | null} thawOn           Jour ou le sortir du congelateur (le soir, pour le lendemain)
 */

/**
 * Plat entier cuisine une seule fois pendant la seance, pour un ou plusieurs repas.
 * @typedef {Object} BatchDish
 * @property {Recipe} recipe
 * @property {Keeping} keeping
 * @property {number} portions               Total a cuisiner
 * @property {BatchServing[]} servings
 */

/**
 * @typedef {Object} BatchSessionPlan
 * @property {string} date
 * @property {BatchDish[]} dishes
 * @property {PreparationRequirement[]} requirements   Preparations de base (seulement les repas qu'elles peuvent attendre)
 * @property {CookingSession} session
 */

/**
 * @typedef {Object} BatchWeek
 * @property {BatchSessionPlan[]} sessions
 * @property {{ meal: Meal, note: string }[]} sameDay  Dejeuners et diners a cuisiner le jour meme
 * @property {string[]} problems
 */

/** Plat sans regle de conservation connue : cuisine le jour meme. */
const UNKNOWN_KEEPING = { batch: false, fridgeDays: 0, freezes: false, note: 'Conservation inconnue : à cuisiner le jour même.' };

/**
 * Repartit les repas de la semaine entre les seances de batch :
 * 1. chaque repas depend de la seance la plus recente, le jour meme ou avant (les repas d'avant la
 *    premiere seance ne sont pas concernes) ;
 * 2. un plat qui se garde jusqu'au repas est cuisine entier pendant la seance : au refrigerateur s'il
 *    tient jusque-la (restes du lendemain midi compris), sinon au congelateur (a sortir la veille) ;
 *    sinon, ou si la personne l'a choisi pour ce repas, il se cuisine le jour meme ;
 *    le meme plat pour plusieurs repas d'une seance est cuisine une seule fois (portions additionnees) ;
 * 3. les preparations de base sont faites pendant la seance pour les repas qu'elles peuvent attendre ;
 * 4. les appareils sont repartis : un plat qui peut se faire sur plusieurs appareils va sur le moins charge.
 * @param {Meal[]} meals
 * @param {string[]} sessions
 * @param {Household} household
 * @param {{ recipes: Map<string, Recipe>, preparations: Map<string, Preparation>, keepingOf: Map<string, Keeping> }} ctx
 * @returns {BatchWeek}
 */
export function planBatchWeek(meals, sessions, household, ctx) {
  /** @type {string[]} */
  const problems = [];
  /** @type {{ meal: Meal, note: string }[]} */
  const sameDay = [];
  /** @type {Map<string, { dishes: BatchDish[], meals: Meal[] }>} */
  const bySession = new Map([...sessions].sort().map((d) => [d, { dishes: [], meals: [] }]));
  const sorted = [...meals].sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  for (const meal of sorted) {
    const session = sessionFor(meal.date, sessions);
    if (session === null) continue;
    const bucket = /** @type {{ dishes: BatchDish[], meals: Meal[] }} */ (bySession.get(session));
    bucket.meals.push(meal);
    const recipe = ctx.recipes.get(meal.recipeId);
    if (!recipe) {
      problems.push(`La recette de « ${meal.recipeName} » n’existe plus.`);
      continue;
    }
    if (meal.cookSameDay) {
      sameDay.push({ meal, note: 'Vous avez choisi de le cuisiner le jour même.' });
      continue;
    }
    const keeping = ctx.keepingOf.get(recipe.id) ?? UNKNOWN_KEEPING;
    // Avec des restes pour le lendemain midi, le plat doit tenir jusqu'au lendemain.
    const last = storagePlan(keeping, session, meal.nextLunch ? addDays(meal.date, 1) : meal.date);
    const plan = last.storage === 'freezer' ? { storage: last.storage, thawOn: addDays(meal.date, -1) } : last;
    if (plan.storage === 'same_day') {
      if (meal.slot === 'lunch' || meal.slot === 'dinner') {
        sameDay.push({ meal, note: keeping.batch ? `Se garde ${keeping.fridgeDays} jour${keeping.fridgeDays > 1 ? 's' : ''} au frais et ne se congèle pas : trop loin de la séance.` : keeping.note });
      }
      continue;
    }
    const portions = mealPortionsFor(meal, household).total;
    const serving = { meal, portions, storage: plan.storage, thawOn: plan.thawOn };
    const same = bucket.dishes.find((d) => d.recipe.id === recipe.id);
    if (same) {
      same.portions += portions;
      same.servings.push(serving);
    } else bucket.dishes.push({ recipe, keeping, portions, servings: [serving] });
  }

  /** @type {BatchSessionPlan[]} */
  const out = [];
  for (const [date, bucket] of bySession) {
    const { requirements, problems: prepProblems } = preparationRequirements(bucket.meals, household, ctx.recipes, ctx.preparations);
    problems.push(...prepProblems.filter((p) => !problems.includes(p)));
    // Une preparation n'est faite a l'avance que pour les repas qu'elle peut attendre.
    const kept = requirements
      .map((req) => {
        const prep = /** @type {Preparation} */ (ctx.preparations.get(req.preparationId));
        const uses = req.uses.filter((u) => storagePlan(preparationKeeping(prep), date, u.date).storage !== 'same_day');
        return { ...req, uses, quantity: roundUpQuantity(uses.reduce((n, u) => n + u.quantity, 0), req.unit) };
      })
      .filter((req) => req.uses.length > 0);
    const prepTasks = buildCookingSession(kept, ctx.preparations, household.equipment).tasks;
    out.push({ date, dishes: bucket.dishes, requirements: kept, session: scheduleTasks([...prepTasks, ...dishTasks(bucket.dishes, household.equipment)]) });
  }
  return { sessions: out.filter((s) => s.dishes.length || s.requirements.length), sameDay, problems };
}

/**
 * Taches « plat entier » d'une seance, reparties sur les appareils du foyer.
 * @param {BatchDish[]} dishes
 * @param {string[]} equipment
 * @returns {CookingTask[]}
 */
function dishTasks(dishes, equipment) {
  /** @type {Map<string, number>} */
  const load = new Map();
  const ordered = [...dishes].sort((a, b) => b.recipe.cookMinutes - a.recipe.cookMinutes || a.recipe.name.localeCompare(b.recipe.name));
  return ordered.map((dish) => {
    const factor = dish.portions / dish.recipe.servings;
    const methods = compatibleMethods(dish.recipe, equipment);
    const lane = (/** @type {CookingMethod} */ m) => load.get(m.equipment[0] ?? 'sans-appareil') ?? 0;
    const method = methods.length ? methods.reduce((best, m) => (lane(m) < lane(best) ? m : best)) : null;
    if (method) load.set(method.equipment[0] ?? 'sans-appareil', lane(method) + dish.recipe.cookMinutes);
    return {
      preparationId: `plat:${dish.recipe.id}`,
      kind: /** @type {const} */ ('dish'),
      name: dish.recipe.name,
      quantity: dish.portions,
      unit: 'portion',
      method,
      ingredients: dish.recipe.ingredients.map((l) => ({ ...l, quantity: l.quantity === null ? null : roundUpQuantity(l.quantity * factor, l.unit) })),
      prepMinutes: Math.ceil(dish.recipe.prepMinutes * Math.max(1, factor)),
      cookMinutes: dish.recipe.cookMinutes,
      uses: dish.servings.length,
    };
  });
}

/**
 * Heure de debut d'une seance : le matin le week-end, le soir en semaine.
 * @param {string} date
 * @returns {string}
 */
export function sessionStart(date) {
  const day = parseIsoDate(date)?.getDay() ?? 0;
  return day === 0 || day === 6 ? '09:30' : '18:30';
}

/**
 * Evenements agenda : chaque seance (avec l'ordre des taches), et la veille au soir d'un repas
 * congele, un rappel pour sortir le plat du congelateur.
 * @param {BatchWeek} week
 * @param {(meal: Meal) => string} mealLabel   ex. « jeudi, déjeuner »
 * @returns {import('../planning/calendar.js').CalendarEvent[]}
 */
export function batchCalendarEvents(week, mealLabel) {
  /** @type {import('../planning/calendar.js').CalendarEvent[]} */
  const events = [];
  for (const s of week.sessions) {
    const start = sessionStart(s.date);
    events.push({
      uid: `batch-${s.date}`,
      date: s.date,
      start,
      end: addMinutes(start, Math.max(30, s.session.estimatedMinutes)),
      summary: 'Batch cooking',
      description: s.session.tasks.map((t, i) => `${i + 1}. ${t.name}`).join('\n'),
      alarmMinutes: 60,
    });
    for (const d of s.dishes) {
      for (const sv of d.servings.filter((x) => x.thawOn)) {
        events.push({
          uid: `decongeler-${sv.meal.id}`,
          date: /** @type {string} */ (sv.thawOn),
          start: '19:00',
          end: '19:15',
          summary: `Sortir du congélateur : ${d.recipe.name}`,
          description: `Pour ${mealLabel(sv.meal)}. À décongeler au réfrigérateur, puis réchauffer à cœur.`,
          alarmMinutes: 0,
        });
      }
    }
  }
  return events;
}
