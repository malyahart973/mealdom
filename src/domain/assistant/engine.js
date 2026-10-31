/**
 * Moteur de propositions : transforme une demande comprise en operations
 * concretes sur le planning (voir proposal.js). Regles lisibles et testees :
 * - les repas verrouilles et les jours passes ne sont jamais touches ;
 * - seules les recettes compatibles avec tout le foyer sont proposees ;
 * - chaque operation porte sa raison ; les limites sont expliquees dans les notes.
 */
import { addDays } from '../planning/dates.js';
import { SLOTS, mealPortionsFor } from '../planning/planning.js';
import { evaluateRecipeForHousehold } from '../household/compatibility.js';
import { applySubstitutions, hasTag, fitsSlot } from '../recipes/recipes.js';
import { activePromotions } from '../drive/drive.js';
import { isEligible, scoreRecipe, recipeCost, recipeContains, matchesTarget, tieBreak } from './scoring.js';
import { substitutesFor } from './substitutes.js';
import { freeSlots } from './proposal.js';
import { sessionFor, daysBetween } from '../batchCooking/keeping.js';

/** @typedef {import('./intent.js').Request} Request */
/** @typedef {import('./intent.js').Mode} Mode */
/** @typedef {import('./intent.js').FoodTarget} FoodTarget */
/** @typedef {import('./scoring.js').ScoringContext} ScoringContext */
/** @typedef {import('./scoring.js').Weights} Weights */
/** @typedef {import('./scoring.js').Constraints} Constraints */
/** @typedef {import('./proposal.js').Operation} Operation */
/** @typedef {import('../planning/planning.js').Meal} Meal */
/** @typedef {import('../planning/planning.js').Slot} Slot */
/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../drive/drive.js').DriveProduct} DriveProduct */

/**
 * @typedef {Object} EngineContext
 * @property {ScoringContext} scoring
 * @property {Recipe[]} recipes
 * @property {Map<string, Recipe>} recipesById
 * @property {Meal[]} meals
 * @property {string} today
 * @property {string[]} days                 Les 7 jours de la semaine concernee
 * @property {Slot[]} activeSlots            Creneaux affiches dans le planning
 * @property {number | null} weeklyBudgetCents
 * @property {Weights} learnedWeights        Preferences apprises (poids reduits)
 * @property {Map<string, DriveProduct[]>} productsByIngredient
 * @property {Map<string, string>} cuisineRegion
 * @property {Set<string>} [preferredCuisines]   Cuisines retenues dans les preferences (bonus leger)
 * @property {Map<string, string>} [familyOf]       Famille de chaque recette (variete : pas cinq salades dans la semaine)
 * @property {string[]} [batchSessions]           Dates des seances de batch cooking (objectif « batch »)
 */

/**
 * @typedef {Object} EngineResult
 * @property {Operation[]} operations
 * @property {string[]} notes
 * @property {boolean} needsClarification
 */

/** Ecart minimal de note pour remplacer un repas existant (evite de tout chambouler). */
const IMPROVEMENT = 2;

/** @type {Map<string, string>} */
const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label.toLowerCase()]));

/**
 * @param {Meal} meal
 * @returns {string}
 */
function mealLabel(meal) {
  return `${meal.recipeName} (${meal.date}, ${slotLabels.get(meal.slot) ?? meal.slot})`;
}

/**
 * Poids des objectifs : demande explicite = 1, preference apprise = son poids.
 * @param {Request} req
 * @param {Weights} learned
 * @returns {Weights}
 */
export function weightsFor(req, learned) {
  /** @type {Weights} */
  const w = { ...learned };
  for (const m of req.modes) w[m] = 1;
  if (req.convivial) w.gourmand = Math.max(w.gourmand ?? 0, 0.6);
  // « gourmand » et « economie » ensemble : on garde les deux, l'economie pese un peu moins
  if (req.modes.includes('gourmand') && (req.modes.includes('economy') || req.budgetCap)) w.economy = Math.max(w.economy ?? 0, 0.7);
  if (req.budgetCap) w.economy = Math.max(w.economy ?? 0, 0.5);
  return w;
}

/**
 * Creneaux concernes par la demande, dans l'ordre chronologique.
 * @param {Request} req
 * @param {EngineContext} ctx
 * @returns {Meal[]}
 */
function targetMeals(req, ctx) {
  const days = new Set(req.days.length ? req.days : ctx.days);
  const order = new Map(SLOTS.map((s, i) => [s.id, i]));
  return ctx.meals
    .filter((m) => days.has(m.date) && ctx.days.includes(m.date) && m.date >= ctx.today && (!req.slots.length || req.slots.includes(m.slot)))
    .sort((a, b) => a.date.localeCompare(b.date) || (order.get(a.slot) ?? 0) - (order.get(b.slot) ?? 0));
}

/**
 * @typedef {{ chosen: string[], cuisines: string[], families: string[], ingredients: Set<string>, dates: Map<string, string[]>, preferCuisine?: string | null, preferTag?: import('../recipes/recipes.js').RecipeTag | null, medianCostIndex: number, maxMinutes: number | null }} WeekEnv
 */

/**
 * Variete de la semaine : chaque famille de plat (salade, soupe...) et chaque region
 * deja tres presente coute un peu plus cher, pour une semaine equilibree.
 * @param {Recipe} recipe
 * @param {WeekEnv} env
 * @param {EngineContext} ctx
 * @returns {number}
 */
function varietyPenalty(recipe, env, ctx) {
  const family = ctx.familyOf?.get(recipe.id);
  const sameFamily = family ? env.families.filter((f) => f === family).length : 0;
  const region = ctx.cuisineRegion.get(recipe.cuisine);
  const sameRegion = region ? env.cuisines.filter((c) => ctx.cuisineRegion.get(c) === region).length : 0;
  return 2.5 * sameFamily + Math.max(0, sameRegion - 2);
}

/**
 * Jours entre la seance de batch cooking qui prepare ce repas et le repas. null sans seance avant.
 * @param {string} date
 * @param {EngineContext} ctx
 * @returns {number | null}
 */
function batchAge(date, ctx) {
  const session = sessionFor(date, ctx.batchSessions ?? []);
  return session === null ? null : daysBetween(session, date);
}

/**
 * Batch cooking : un plat deja prevu dans la meme seance se cuisine en double (une seule fois
 * aux fourneaux pour deux repas) ; le meme plat deux fois le meme jour est evite.
 * @param {Recipe} recipe
 * @param {string} date
 * @param {Weights} weights
 * @param {WeekEnv} env
 * @param {EngineContext} ctx
 * @returns {{ bonus: number, reason: string | null }}
 */
function batchTwin(recipe, date, weights, env, ctx) {
  const w = weights.batch ?? 0;
  const before = env.dates.get(recipe.id) ?? [];
  if (!w || !before.length) return { bonus: 0, reason: null };
  if (before.includes(date)) return { bonus: -10 * w, reason: null };
  const session = sessionFor(date, ctx.batchSessions ?? []);
  const keeping = ctx.scoring.keepingOf?.get(recipe.id);
  if (session === null || !keeping?.batch || !before.some((d) => sessionFor(d, ctx.batchSessions ?? []) === session)) return { bonus: 0, reason: null };
  return { bonus: 6 * w, reason: 'cuisinée en double pendant la même séance' };
}

/**
 * Retient un plat choisi pour la suite de la semaine.
 * @param {WeekEnv} env
 * @param {Recipe} recipe
 * @param {EngineContext} ctx
 * @param {string} date
 */
function remember(env, recipe, ctx, date) {
  env.chosen.push(recipe.id);
  env.dates.set(recipe.id, [...(env.dates.get(recipe.id) ?? []), date]);
  env.cuisines.push(recipe.cuisine);
  env.families.push(ctx.familyOf?.get(recipe.id) ?? '');
}

/**
 * Meilleure recette pour un creneau.
 * @param {{ date: string, slot: Slot }} where
 * @param {Constraints} constraints
 * @param {Weights} weights
 * @param {WeekEnv} env
 * @param {EngineContext} ctx
 * @returns {{ recipe: Recipe, score: number, reasons: string[] } | null}
 */
function bestRecipe(where, constraints, weights, env, ctx) {
  /** @type {{ recipe: Recipe, score: number, reasons: string[] } | null} */
  let best = null;
  for (const recipe of ctx.recipes) {
    if (!isEligible(recipe, { ...constraints, slot: where.slot }, ctx.scoring)) continue;
    const s = scoreRecipe(
      recipe,
      weights,
      { slot: where.slot, medianCostIndex: env.medianCostIndex, maxMinutes: env.maxMinutes, weekCuisines: env.cuisines, weekRecipeIds: env.chosen, weekIngredients: env.ingredients, batchAge: batchAge(where.date, ctx) },
      ctx.scoring,
    );
    const twin = batchTwin(recipe, where.date, weights, env, ctx);
    let score = s.score + twin.bonus + tieBreak(`${recipe.id}|${where.date}|${where.slot}`) - varietyPenalty(recipe, env, ctx);
    if (env.preferCuisine && recipe.cuisine === env.preferCuisine) score += 3;
    if (ctx.preferredCuisines?.has(recipe.cuisine)) score += 2;
    if (env.preferTag && hasTag(recipe, env.preferTag)) score += 6;
    if (!best || score > best.score) best = { recipe, score, reasons: twin.reason ? [...s.reasons, twin.reason] : s.reasons };
  }
  return best;
}

/**
 * Objectifs, criteres stricts et variete de la semaine, communs a toutes les recherches.
 * @param {Request} req
 * @param {EngineContext} ctx
 */
function prepare(req, ctx) {
  const weights = weightsFor(req, ctx.learnedWeights);
  const weekMeals = ctx.meals.filter((m) => ctx.days.includes(m.date));
  const compatibleIds = new Set(ctx.recipes.filter((r) => evaluateRecipeForHousehold(r, ctx.scoring.household, ctx.scoring).status === 'compatible').map((r) => r.id));
  const costIndexes = ctx.recipes.filter((r) => compatibleIds.has(r.id)).map((r) => recipeCost(r, ctx.scoring).index).sort((a, b) => a - b);
  const medianCostIndex = costIndexes[Math.floor(costIndexes.length / 2)] ?? 1;
  const regionCuisines = req.region ? new Set([...ctx.cuisineRegion].filter(([, r]) => r === req.region).map(([c]) => c)) : null;

  /** @type {Constraints} */
  const base = {
    slot: null,
    maxMinutes: req.maxMinutes,
    avoid: req.avoid,
    include: req.include,
    cuisine: req.cuisine,
    cuisines: regionCuisines,
    excludeRecipeIds: new Set(),
    maxCostIndex: null,
    compatibleIds,
  };
  const env = {
    chosen: weekMeals.map((m) => m.recipeId),
    cuisines: weekMeals.map((m) => ctx.recipesById.get(m.recipeId)?.cuisine ?? ''),
    families: weekMeals.map((m) => ctx.familyOf?.get(m.recipeId) ?? ''),
    ingredients: new Set(weekMeals.flatMap((m) => ctx.recipesById.get(m.recipeId)?.ingredients.map((l) => l.ingredientId) ?? [])),
    /** @type {Map<string, string[]>} */ dates: weekMeals.reduce((map, m) => map.set(m.recipeId, [...(map.get(m.recipeId) ?? []), m.date]), new Map()),
    medianCostIndex,
    maxMinutes: req.maxMinutes,
    /** @type {string | null} */ preferCuisine: null,
    /** @type {import('../recipes/recipes.js').RecipeTag | null} */ preferTag: null,
  };
  return { weights, weekMeals, medianCostIndex, base, env };
}

/**
 * Autres recettes possibles pour un creneau, de la mieux notee a la moins bien notee
 * (bouton « Changer » de l'apercu de la semaine).
 * @param {Request} req              Demande d'origine : objectifs et criteres
 * @param {{ date: string, slot: Slot }} where
 * @param {EngineContext} ctx        ctx.meals : la semaine telle que proposee
 * @param {Set<string>} exclude      Recettes deja montrees pour ce creneau
 * @param {number} [limit]
 * @returns {{ recipe: Recipe, score: number, reasons: string[] }[]}
 */
export function suggestRecipes(req, where, ctx, exclude, limit = 3) {
  const { weights, base, env } = prepare(req, { ...ctx, meals: ctx.meals.filter((m) => !(m.date === where.date && m.slot === where.slot)) });
  /** @type {{ recipe: Recipe, score: number, reasons: string[] }[]} */
  const ranked = [];
  for (const recipe of ctx.recipes) {
    if (!isEligible(recipe, { ...base, slot: where.slot, excludeRecipeIds: exclude }, ctx.scoring)) continue;
    const s = scoreRecipe(
      recipe,
      weights,
      { slot: where.slot, medianCostIndex: env.medianCostIndex, maxMinutes: env.maxMinutes, weekCuisines: env.cuisines, weekRecipeIds: env.chosen, weekIngredients: env.ingredients, batchAge: batchAge(where.date, ctx) },
      ctx.scoring,
    );
    const twin = batchTwin(recipe, where.date, weights, env, ctx);
    let score = s.score + twin.bonus + tieBreak(`${recipe.id}|${where.date}|${where.slot}`) - varietyPenalty(recipe, env, ctx);
    if (ctx.preferredCuisines?.has(recipe.cuisine)) score += 2;
    ranked.push({ recipe, score, reasons: twin.reason ? [...s.reasons, twin.reason] : s.reasons });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Proposition a partir d'une demande comprise.
 * @param {Request} req
 * @param {EngineContext} ctx
 * @returns {EngineResult}
 */
export function proposeChanges(req, ctx) {
  /** @type {Operation[]} */
  const operations = [];
  /** @type {string[]} */
  const notes = [];
  const { weights, weekMeals, medianCostIndex, base, env } = prepare(req, ctx);

  // --- Limites et conflits a signaler ---
  if (req.modes.includes('gourmand') && (req.modes.includes('economy') || req.budgetCap)) {
    notes.push('Gourmand et économique : je privilégie des recettes généreuses aux ingrédients abordables ; le coût réel est recalculé sur votre panier.');
  }
  if (weights.promotions && ctx.scoring.promoIngredients.size === 0) {
    notes.push('Aucune promotion vérifiée du Drive n’est enregistrée : je ne peux pas en tenir compte. Importez ou relevez les promotions dans l’écran Drive.');
  }
  if (weights.light && !ctx.scoring.programTargets) notes.push('Aucun programme minceur actif : je me base sur les calories par portion.');
  for (const target of [...req.include, ...(req.replace ? [req.replace.to] : [])]) {
    if (target.ingredientId) {
      const fit = evaluateRecipeForHousehold(
        { ...ctx.recipes[0], ingredients: [{ ingredientId: target.ingredientId, quantity: 1, unit: 'g' }], preparations: [], methods: [{ id: 'x', label: '', equipment: [], steps: ['x'] }] },
        ctx.scoring.household,
        ctx.scoring,
      );
      if (fit.status !== 'compatible') notes.push(`Attention : ${target.label} ne convient pas à tout votre foyer (allergie, régime ou aliment refusé). Je ne l’ajoute pas.`);
    }
  }
  const locked = targetMeals(req, { ...ctx, meals: ctx.meals.filter((m) => m.locked) });
  if (locked.length) notes.push(`Repas verrouillés, laissés tels quels : ${locked.map(mealLabel).join(', ')}.`);

  // --- Budget ---
  if (req.budgetCents !== null) {
    operations.push({ type: 'set_weekly_budget', cents: req.budgetCents, reason: 'Budget de la semaine demandé.' });
  } else if (req.budgetPercent !== null) {
    if (ctx.weeklyBudgetCents !== null) {
      const cents = Math.round((ctx.weeklyBudgetCents * (100 + req.budgetPercent)) / 100);
      operations.push({ type: 'set_weekly_budget', cents, reason: `Budget de la semaine ${req.budgetPercent > 0 ? 'augmenté' : 'réduit'} de ${Math.abs(req.budgetPercent)} %.` });
    } else {
      notes.push('Aucun budget hebdomadaire n’est défini : je réduis le coût des repas, et vous pourrez fixer un budget dans l’écran Budget.');
    }
  }

  // --- Alternative moins chere ou produit indisponible ---
  for (const [ingredientId, kind] of /** @type {[string | null, 'cheaper' | 'unavailable'][]} */ ([
    [req.cheaperAlternativeFor, 'cheaper'],
    [req.unavailable, 'unavailable'],
  ])) {
    if (!ingredientId) continue;
    const name = ctx.scoring.ingredients.get(ingredientId)?.name ?? ingredientId;
    const products = (ctx.productsByIngredient.get(ingredientId) ?? []).filter((p) => p.availability === 'available');
    if (products.length > 1 && kind === 'cheaper') {
      const perUnit = (/** @type {DriveProduct} */ p) => p.priceCents / p.packageQuantity;
      const cheapest = [...products].sort((a, b) => perUnit(a) - perUnit(b))[0];
      operations.push({ type: 'choose_product', ingredientId, productId: cheapest.id, reason: `Article le moins cher au kilo ou au litre parmi ${products.length} produits du Drive pour ${name}.` });
    } else if (products.length && kind === 'unavailable') {
      operations.push({ type: 'choose_product', ingredientId, productId: products[0].id, reason: `Autre produit disponible au Drive pour ${name}.` });
      continue;
    }
    const usedIn = targetMeals(req, ctx).filter((m) => !m.locked && ctx.recipesById.get(m.recipeId)?.ingredients.some((l) => l.ingredientId === ingredientId));
    const price = ctx.scoring.unitPrices.get(ingredientId);
    for (const meal of usedIn) {
      const recipe = /** @type {Recipe} */ (ctx.recipesById.get(meal.recipeId));
      for (const to of substitutesFor(ingredientId)) {
        const toPrice = ctx.scoring.unitPrices.get(to);
        const replaced = applySubstitutions(recipe, [...(meal.substitutions ?? []), { from: ingredientId, to }]);
        if (evaluateRecipeForHousehold(replaced, ctx.scoring.household, ctx.scoring).status !== 'compatible') continue;
        if (kind === 'cheaper') {
          const verified = price && toPrice && price.unit === toPrice.unit;
          if (verified && toPrice.centsPerUnit >= price.centsPerUnit) continue;
          if (!verified && recipeCost(replaced, ctx.scoring).index >= recipeCost(recipe, ctx.scoring).index) continue;
          operations.push({
            type: 'substitute',
            mealId: meal.id,
            from: ingredientId,
            to,
            reason: verified ? `${ctx.scoring.ingredients.get(to)?.name} est moins cher au poids selon vos prix.` : `${ctx.scoring.ingredients.get(to)?.name} est généralement moins cher (prix non vérifiés).`,
          });
        } else {
          operations.push({ type: 'substitute', mealId: meal.id, from: ingredientId, to, reason: `${name} est indisponible.` });
        }
        break;
      }
    }
    if (!operations.some((o) => (o.type === 'substitute' && o.from === ingredientId) || (o.type === 'choose_product' && o.ingredientId === ingredientId))) {
      notes.push(kind === 'cheaper' ? `Je n’ai pas trouvé d’alternative moins chère vérifiable pour ${name}.` : `Je n’ai pas trouvé de remplacement pour ${name} dans les repas de la semaine.`);
    }
  }

  // --- Remplacer un aliment ---
  if (req.replace) {
    const { from, to } = req.replace;
    const concerned = targetMeals(req, ctx).filter((m) => {
      const r = ctx.recipesById.get(m.recipeId);
      return r ? recipeContains(applySubstitutions(r, m.substitutions ?? []), from, ctx.scoring) : false;
    });
    if (!concerned.length) notes.push(`Aucun repas ${req.days.length ? 'de ce jour' : 'de la semaine'} ne contient ${from.label}.`);
    for (const meal of concerned) {
      if (meal.locked) continue;
      const recipe = /** @type {Recipe} */ (ctx.recipesById.get(meal.recipeId));
      const direct = from.ingredientId && to.ingredientId ? recipe.ingredients.find((l) => l.ingredientId === from.ingredientId) : undefined;
      if (direct && to.ingredientId) {
        const substitutions = [...(meal.substitutions ?? []), { from: direct.ingredientId, to: to.ingredientId }];
        if (evaluateRecipeForHousehold(applySubstitutions(recipe, substitutions), ctx.scoring.household, ctx.scoring).status === 'compatible') {
          operations.push({ type: 'substitute', mealId: meal.id, from: direct.ingredientId, to: to.ingredientId, reason: `${from.label} remplacé par ${to.label}, même recette.` });
          continue;
        }
      }
      const pick = bestRecipe(meal, { ...base, include: [to], avoid: [...base.avoid, from] }, weights, { ...env, preferCuisine: recipe.cuisine }, ctx);
      if (pick) {
        remember(env, pick.recipe, ctx, meal.date);
        operations.push({ type: 'replace_recipe', mealId: meal.id, recipeId: pick.recipe.id, reason: `Avec ${to.label} à la place de ${from.label}${pick.reasons.length ? ` ; ${pick.reasons.join(', ')}` : ''}.` });
      } else notes.push(`Aucune recette compatible avec ${to.label} pour ${mealLabel(meal)}.`);
    }
  }

  // --- Invites ---
  if (req.guests) {
    if (!req.days.length) {
      notes.push('Pour quel jour attendez-vous vos invités ? Précisez le jour (et midi ou soir).');
      return { operations, notes, needsClarification: true };
    }
    const dayMeals = targetMeals({ ...req, slots: req.slots.length ? req.slots : ['lunch', 'dinner'] }, ctx);
    // Un seul repas par jour quand ni midi ni soir n'est precise : le dejeuner s'il existe.
    const chosen = req.slots.length ? dayMeals : req.days.flatMap((d) => {
      const list = dayMeals.filter((m) => m.date === d);
      return list.filter((m) => m.slot === 'lunch').slice(0, 1).concat(list.some((m) => m.slot === 'lunch') ? [] : list.slice(0, 1));
    });
    for (const meal of chosen) {
      if (meal.locked) continue;
      const guests = req.guests.mode === 'add' ? meal.guests + req.guests.count : Math.max(0, req.guests.count - meal.attendees.length);
      operations.push({ type: 'set_guests', mealId: meal.id, guests, reason: req.guests.mode === 'add' ? `${req.guests.count} personne(s) en plus.` : `${req.guests.count} personnes à table.` });
    }
    if (!req.slots.length && chosen.length) notes.push(`J’ai ajouté les invités au ${slotLabels.get(chosen[0].slot)} ; dites « le soir » si c’est pour le dîner.`);
    for (const date of req.days) {
      if (chosen.some((m) => m.date === date) || date < ctx.today) continue;
      const slot = req.slots[0] ?? 'lunch';
      const free = freeSlots(ctx.meals, [date], [slot]);
      if (!free.length) continue;
      const pick = bestRecipe({ date, slot }, base, { ...weights, gourmand: Math.max(weights.gourmand ?? 0, 0.6) }, { ...env, preferTag: 'convivial' }, ctx);
      if (pick) {
        remember(env, pick.recipe, ctx, date);
        const guests = req.guests.mode === 'add' ? req.guests.count : Math.max(0, req.guests.count - ctx.scoring.household.members.length);
        operations.push({ type: 'add_meal', date, slot, recipeId: pick.recipe.id, guests, reason: `Repas à partager avec vos invités${pick.reasons.length ? ` ; ${pick.reasons.join(', ')}` : ''}.` });
      }
    }
  }

  // --- Restes du repas precedent ---
  if (req.leftovers) {
    const upcoming = targetMeals(req.days.length || req.slots.length ? req : { ...req, days: ctx.days.filter((d) => d >= ctx.today) }, ctx);
    const target = upcoming[0];
    if (!target) notes.push('Je n’ai pas trouvé de repas à venir pour utiliser des restes.');
    else {
      const order = new Map(SLOTS.map((s, i) => [s.id, i]));
      const before = ctx.meals
        .filter((m) => m.date < target.date || (m.date === target.date && (order.get(m.slot) ?? 0) < (order.get(target.slot) ?? 0)))
        .filter((m) => m.slot !== 'snack' && m.slot !== 'morning_snack' && m.slot !== 'breakfast')
        .sort((a, b) => b.date.localeCompare(a.date) || (order.get(b.slot) ?? 0) - (order.get(a.slot) ?? 0))[0];
      if (!before) notes.push('Aucun repas précédent dans le planning.');
      else if (before.slot === 'dinner' && target.slot === 'lunch' && addDays(before.date, 1) === target.date && !before.locked && !target.locked) {
        operations.push({ type: 'remove_meal', mealId: target.id, reason: 'Remplacé par les restes du dîner de la veille.' });
        operations.push({ type: 'set_next_lunch', mealId: before.id, reason: `Cuisiner un peu plus de ${before.recipeName} pour le déjeuner du lendemain.` });
      } else if (!target.locked) {
        const prev = ctx.recipesById.get(before.recipeId);
        const pick = bestRecipe(
          target,
          base,
          { ...weights, antiwaste: 1 },
          { ...env, ingredients: new Set(prev?.ingredients.map((l) => l.ingredientId) ?? []) },
          ctx,
        );
        if (pick) {
          remember(env, pick.recipe, ctx, target.date);
          operations.push({ type: 'replace_recipe', mealId: target.id, recipeId: pick.recipe.id, reason: `Réutilise les ingrédients déjà ouverts pour ${before.recipeName}.` });
        }
      }
    }
  }

  // --- Ajouter un repas (convivial, a une date precise) ---
  if ((req.addMeal || req.convivial) && !req.guests && req.days.length) {
    const slots = req.slots.length ? req.slots : ['dinner'];
    for (const date of req.days) {
      for (const slot of /** @type {Slot[]} */ (slots)) {
        if (date < ctx.today) continue;
        const existing = ctx.meals.find((m) => m.date === date && m.slot === slot);
        const pick = bestRecipe({ date, slot }, base, weights, { ...env, preferTag: req.convivial ? 'convivial' : null }, ctx);
        if (!pick) {
          notes.push(`Aucune recette compatible trouvée pour le ${date}.`);
          continue;
        }
        remember(env, pick.recipe, ctx, date);
        const why = `${req.convivial ? 'Repas convivial' : 'Repas ajouté'}${pick.reasons.length ? ` ; ${pick.reasons.join(', ')}` : ''}.`;
        if (!existing) operations.push({ type: 'add_meal', date, slot, recipeId: pick.recipe.id, guests: 0, reason: why });
        else if (existing.locked) notes.push(`${mealLabel(existing)} est verrouillé.`);
        else if (existing.recipeId !== pick.recipe.id) operations.push({ type: 'replace_recipe', mealId: existing.id, recipeId: pick.recipe.id, reason: why });
      }
    }
  }

  // --- Garder les repas, changer les produits (qualite, promotions) ---
  if (req.keepMeals && (weights.quality || weights.promotions)) {
    const needed = new Set(weekMeals.flatMap((m) => ctx.recipesById.get(m.recipeId)?.ingredients.map((l) => l.ingredientId) ?? []));
    let count = 0;
    for (const ingredientId of needed) {
      const products = (ctx.productsByIngredient.get(ingredientId) ?? []).filter((p) => p.availability === 'available');
      const pick = weights.quality
        ? products.filter((p) => p.quality.length).sort((a, b) => a.priceCents / a.packageQuantity - b.priceCents / b.packageQuantity)[0]
        : activePromotions(products, ctx.today)[0];
      if (pick) {
        count++;
        operations.push({ type: 'choose_product', ingredientId, productId: pick.id, reason: weights.quality ? `${pick.name} (${pick.quality.join(', ')}).` : `${pick.name} en promotion : ${pick.promotion?.label}.` });
      }
    }
    if (!count) notes.push(weights.quality ? 'Aucun produit de meilleure qualité n’est enregistré pour vos ingrédients : importez les produits du Drive pour que je puisse comparer.' : 'Aucune promotion vérifiée ne concerne vos ingrédients.');
  }

  // --- Generer ou refaire des repas, optimiser selon les objectifs ---
  const generic = !req.keepMeals && (req.generate || req.redo || req.modes.length > 0 || req.cuisine || req.region || req.include.length || req.avoid.length || req.budgetPercent !== null || req.budgetCap);
  const alreadyHandled = new Set(operations.flatMap((o) => ('mealId' in o ? [o.mealId] : [])));
  if (generic && !req.replace && !req.leftovers && !(req.addMeal && req.days.length)) {
    const targets = targetMeals(req, ctx).filter((m) => !m.locked && !alreadyHandled.has(m.id));
    const weekCostIndex = weekMeals.reduce((s, m) => {
      const r = ctx.recipesById.get(m.recipeId);
      return s + (r ? recipeCost(r, ctx.scoring).index * mealPortionsFor(m, ctx.scoring.household).total : 0);
    }, 0);
    const savingGoal = req.budgetPercent !== null && req.budgetPercent < 0 ? (weekCostIndex * -req.budgetPercent) / 100 : null;
    let saved = 0;
    // Pour reduire un budget : les repas les plus chers d'abord.
    const ordered = savingGoal !== null
      ? [...targets].sort((a, b) => (recipeCost(/** @type {Recipe} */ (ctx.recipesById.get(b.recipeId)), ctx.scoring).index) - recipeCost(/** @type {Recipe} */ (ctx.recipesById.get(a.recipeId)), ctx.scoring).index)
      : targets;
    for (const meal of ordered) {
      if (savingGoal !== null && saved >= savingGoal) break;
      const current = ctx.recipesById.get(meal.recipeId);
      if (!current) continue;
      const currentCost = recipeCost(current, ctx.scoring).index;
      const constraints = { ...base, excludeRecipeIds: new Set([current.id]), maxCostIndex: req.budgetCap || savingGoal !== null ? currentCost : null };
      const pick = bestRecipe(meal, constraints, weights, env, ctx);
      if (!pick) continue;
      const currentEligible = isEligible(current, { ...base, slot: meal.slot }, ctx.scoring) && fitsSlot(current, meal.slot);
      const currentScore = currentEligible
        ? scoreRecipe(current, weights, { slot: meal.slot, medianCostIndex, maxMinutes: req.maxMinutes, weekCuisines: env.cuisines, weekRecipeIds: [], weekIngredients: env.ingredients, batchAge: batchAge(meal.date, ctx) }, ctx.scoring).score
        : -100;
      if (!req.redo && pick.score - currentScore < IMPROVEMENT) continue;
      remember(env, pick.recipe, ctx, meal.date);
      saved += (currentCost - recipeCost(pick.recipe, ctx.scoring).index) * mealPortionsFor(meal, ctx.scoring.household).total;
      operations.push({ type: 'replace_recipe', mealId: meal.id, recipeId: pick.recipe.id, reason: pick.reasons.length ? `${pick.reasons.join(', ')}.` : 'Correspond mieux à votre demande.' });
    }
    if (savingGoal !== null && saved < savingGoal * 0.8) notes.push('Je n’ai pas trouvé assez de remplacements pour atteindre toute la baisse demandée sans changer vos contraintes.');

    // Cases vides a remplir si l'on demande un planning
    if (req.generate || (req.redo && !targets.length)) {
      const days = (req.days.length ? req.days : ctx.days).filter((d) => d >= ctx.today);
      const slots = req.slots.length ? req.slots : ctx.activeSlots;
      for (const free of freeSlots(ctx.meals, days, slots)) {
        const pick = bestRecipe(free, base, weights, env, ctx);
        if (!pick) continue;
        remember(env, pick.recipe, ctx, free.date);
        operations.push({ type: 'add_meal', date: free.date, slot: free.slot, recipeId: pick.recipe.id, guests: 0, reason: pick.reasons.length ? `${pick.reasons.join(', ')}.` : 'Complète le planning.' });
      }
    }
  }

  if (!operations.length && !notes.length) {
    notes.push(req.understood ? 'Votre planning correspond déjà bien à cette demande : je n’ai rien trouvé de nettement meilleur.' : 'Je n’ai pas compris la demande. Essayez par exemple « des repas plus rapides cette semaine » ou « remplace le poisson de mardi par du poulet ».');
  }
  return { operations, notes, needsClarification: false };
}

/**
 * Poids des objectifs appris (preferences actives) : plus faibles qu'une demande explicite.
 * @param {{ kind: string, value: string, active: boolean }[]} preferences
 * @returns {Weights}
 */
export function learnedWeights(preferences) {
  /** @type {Weights} */
  const w = {};
  for (const p of preferences) if (p.active && p.kind === 'mode') w[/** @type {Mode} */ (p.value)] = 0.4;
  return w;
}

/**
 * Cuisines preferees (preferences actives « cuisine » ou « region »).
 * @param {{ kind: string, value: string, active: boolean }[]} preferences
 * @param {Map<string, string>} cuisineRegion
 * @returns {Set<string>}
 */
export function preferredCuisines(preferences, cuisineRegion) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const p of preferences) {
    if (!p.active) continue;
    if (p.kind === 'cuisine') set.add(p.value);
    if (p.kind === 'region') for (const [c, r] of cuisineRegion) if (r === p.value) set.add(c);
  }
  return set;
}

/**
 * Cible « aliment » correspondant a un ingredient, pour les preferences a eviter.
 * @param {string} ingredientId
 * @param {string} name
 * @returns {FoodTarget}
 */
export function ingredientTarget(ingredientId, name) {
  return { ingredientId, category: null, label: name };
}

export { matchesTarget };
