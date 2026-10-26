/**
 * Assistant conversationnel : relie la conversation, le modele IA (facultatif),
 * le moteur local, les regles de l'application et la base.
 *
 * Separation des roles :
 * - le modele IA (ou le moteur local) PROPOSE des operations et les EXPLIQUE ;
 * - l'application VERIFIE (foyer, verrous, creneaux), CHIFFRE avec les prix connus
 *   et n'ECRIT dans le planning qu'apres l'accord du client ;
 * - aucune commande Drive n'est passee ici.
 */
import { parseRequest, mergeRequests, describeRequest, makeIngredientFinder } from '../domain/assistant/intent.js';
import { proposeChanges, suggestRecipes, learnedWeights, preferredCuisines } from '../domain/assistant/engine.js';
import { guidedRequest, describeChoices, operationIndexFor } from '../domain/assistant/guided.js';
import { applyOperations, parseOperations, planDiff, freeSlots } from '../domain/assistant/proposal.js';
import { learnFromRequest, applyPreferences, describePreferences, upsertPreference } from '../domain/assistant/preferences.js';
import { createConversation, isBigChange } from '../domain/assistant/conversation.js';
import { TOOL_NAMES } from '../domain/assistant/tools.js';
import { recipeCost, isEligible } from '../domain/assistant/scoring.js';
import { fitToBudget, rankThrifty } from '../domain/assistant/budgetFit.js';
import { compareQuotes } from '../domain/drive/quote.js';
import { isFresh, activePromotions, promotionStatus } from '../domain/drive/drive.js';
import { roundNutrients } from '../domain/nutrition/nutrition.js';
import { programFitScore } from '../domain/nutrition/program.js';
import { evaluateRecipeForHousehold } from '../domain/household/compatibility.js';
import { allIngredientIds, totalMinutes, recipeMealTypes, hasTag } from '../domain/recipes/recipes.js';
import { buildNameIndex, normalizeText } from '../domain/ingredients/ingredients.js';
import { SLOTS, mealPortionsFor } from '../domain/planning/planning.js';
import { expiryStatus, itemsToUseFirst } from '../domain/shopping/shopping.js';
import { weekDays, toIsoDate } from '../domain/planning/dates.js';
import { formatCents } from '../domain/budget/money.js';
import { conversationStore, historyStore, preferenceStore, getHistory, getPreferences } from '../db/repositories/assistantRepository.js';
import { putMeal, deleteMealRecord } from '../db/repositories/mealRepository.js';
import { getInventory } from '../db/repositories/shoppingRepository.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { getMeals, getShowBreakfast, getShowSnack, newMealId } from './planningService.js';
import { getHousehold } from './householdService.js';
import { getBudget, saveBudget } from './budgetService.js';
import { loadPriceData, quoteForMeals, weekQuoter, productsByIngredient, unitPrices, saveDriveSettings } from './driveService.js';
import { programSummary } from './programService.js';
import { isFeasibleLocally, recipeLocalIssues } from '../domain/ingredients/territory.js';
import { substitutesFor } from '../domain/assistant/substitutes.js';
import { loadAvailability, autoSubstituter } from './territoryService.js';
import { seasonNow } from './seasonService.js';
import { callClaude, responseText, LlmError, DEFAULT_MODEL } from './llmService.js';
import { recipes, recipesById, ingredientsById, preparationsById, cuisineLabels, familyOf, nutritionContext, nutritionByRecipe as recipeNutritionMap } from './catalog.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { CUISINES, REGIONS } from '../data/cuisines.js';
import { formatIsoDay } from '../utils/format.js';

/** @typedef {import('../domain/assistant/conversation.js').Conversation} Conversation */
/** @typedef {import('../domain/assistant/conversation.js').ChatMessage} ChatMessage */
/** @typedef {import('../domain/assistant/conversation.js').StoredProposal} StoredProposal */
/** @typedef {import('../domain/assistant/conversation.js').ProposalReview} ProposalReview */
/** @typedef {import('../domain/assistant/conversation.js').HistoryEntry} HistoryEntry */
/** @typedef {import('../domain/assistant/intent.js').Request} Request */
/** @typedef {import('../domain/assistant/proposal.js').Operation} Operation */
/** @typedef {import('../domain/assistant/proposal.js').PlanState} PlanState */
/** @typedef {import('../domain/assistant/preferences.js').Preference} Preference */
/** @typedef {import('../domain/planning/planning.js').Meal} Meal */
/** @typedef {import('../domain/planning/planning.js').Slot} Slot */
/** @typedef {import('./llmService.js').ApiMessage} ApiMessage */
/** @typedef {import('./llmService.js').ContentBlock} ContentBlock */

const finder = makeIngredientFinder(buildNameIndex(INGREDIENTS), ingredientsById);
const cuisineRegion = new Map(CUISINES.map((c) => [c.id, c.region]));
const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label]));
/** Noms des cuisines et des regions, pour resumer la demande. */
/** @type {Map<string, string>} */
const placeLabels = new Map();
for (const c of CUISINES) placeLabels.set(c.id, c.label.toLowerCase());
for (const r of REGIONS) placeLabels.set(r.id, r.label);


/** Nombre maximal d'echanges outil/modele par message du client. */
const MAX_TOOL_ROUNDS = 8;

// ---------------------------------------------------------------------------
// Reglages
// ---------------------------------------------------------------------------

/**
 * @typedef {{ hasKey: boolean, model: string, useAi: boolean }} AssistantSettings
 */

/** @returns {Promise<AssistantSettings>} */
export async function getAssistantSettings() {
  const [key, model, useAi] = await Promise.all([getSetting('assistantApiKey'), getSetting('assistantModel'), getSetting('assistantUseAi')]);
  return { hasKey: typeof key === 'string' && key.length > 0, model: typeof model === 'string' && model ? model : DEFAULT_MODEL, useAi: useAi !== false };
}

/**
 * @param {{ apiKey?: string | null, model?: string, useAi?: boolean }} changes
 * @returns {Promise<void>}
 */
export async function saveAssistantSettings(changes) {
  if (changes.apiKey !== undefined) await setSetting('assistantApiKey', changes.apiKey ? changes.apiKey.trim() : null);
  if (changes.model !== undefined) await setSetting('assistantModel', changes.model.trim() || DEFAULT_MODEL);
  if (changes.useAi !== undefined) await setSetting('assistantUseAi', changes.useAi);
}

// ---------------------------------------------------------------------------
// Environnement de travail (charge depuis la base a chaque demande)
// ---------------------------------------------------------------------------

/**
 * @param {string} monday
 */
async function loadEnvironment(monday) {
  const now = new Date();
  const today = toIsoDate(now);
  const days = weekDays(monday);
  const [meals, household, budget, inventory, priceData, preferences, program, showBreakfast, showSnack, availability, season] = await Promise.all([
    getMeals(),
    getHousehold(),
    getBudget(),
    getInventory(),
    loadPriceData(),
    getPreferences(),
    programSummary(),
    getShowBreakfast(),
    getShowSnack(),
    loadAvailability(),
    seasonNow(now),
  ]);
  const byIngredient = productsByIngredient(priceData.products);
  const promoIngredients = new Set(
    activePromotions(priceData.products, today)
      .filter((p) => isFresh(p, now) && p.ingredientId)
      .map((p) => /** @type {string} */ (p.ingredientId)),
  );
  /** @type {import('../domain/assistant/scoring.js').ScoringContext} */
  const scoring = {
    household,
    ingredients: ingredientsById,
    preparations: preparationsById,
    nutrition: nutritionContext.nutrition,
    nutritionByRecipe: recipeNutritionMap(),
    unitPrices: unitPrices(priceData.products, priceData.prices, now),
    promoIngredients,
    stockIngredients: new Set(inventory.filter((i) => i.quantity > 0 && expiryStatus(i, today).status !== 'expired').map((i) => i.ingredientId)),
    expiringIngredients: new Set(itemsToUseFirst(inventory, today).filter((i) => expiryStatus(i, today).status !== 'expired').map((i) => i.ingredientId)),
    programTargets: program ? program.meals : null,
    availability,
    seasonalIngredients: season.favoured,
  };
  /** @type {Slot[]} */
  const activeSlots = SLOTS.map((s) => s.id).filter((s) => (s !== 'breakfast' || showBreakfast) && (s !== 'snack' || showSnack));
  return {
    now,
    today,
    monday,
    days,
    meals,
    household,
    budget,
    priceData,
    preferences,
    program,
    activeSlots,
    byIngredient,
    scoring,
    /** @type {import('../domain/assistant/engine.js').EngineContext} */
    engine: {
      scoring,
      recipes,
      recipesById,
      meals,
      today,
      days,
      activeSlots,
      weeklyBudgetCents: budget.weeklyCents,
      learnedWeights: learnedWeights(preferences),
      productsByIngredient: byIngredient,
      cuisineRegion,
      preferredCuisines: preferredCuisines(preferences, cuisineRegion),
      familyOf,
    },
    /** @type {import('../domain/assistant/proposal.js').ApplyContext} */
    apply: { household, recipes: recipesById, ingredients: ingredientsById, preparations: preparationsById, productsByIngredient: byIngredient, newId: newMealId, autoSubstitutions: autoSubstituter(availability) },
  };
}

/** @typedef {Awaited<ReturnType<typeof loadEnvironment>>} Env */

/**
 * @param {Env} env
 * @returns {PlanState}
 */
function currentState(env) {
  return { meals: env.meals, weeklyBudgetCents: env.budget.weeklyCents, preferredProducts: env.priceData.settings.preferredProducts };
}

// ---------------------------------------------------------------------------
// Bilan d'une proposition (calcule par l'application, jamais par le modele)
// ---------------------------------------------------------------------------

/**
 * @param {Operation[]} operations
 * @param {Env} env
 * @returns {Promise<{ review: ProposalReview, state: PlanState }>}
 */
async function reviewOperations(operations, env) {
  const before = currentState(env);
  const result = applyOperations(before, operations, env.apply);
  const diff = planDiff(env.meals, result.state.meals, env.days, env.apply);
  const [qb, qa] = await Promise.all([
    quoteForMeals(env.meals, env.monday, env.priceData, before.preferredProducts),
    quoteForMeals(result.state.meals, env.monday, env.priceData, result.state.preferredProducts),
  ]);
  const comparison = compareQuotes(qb.quote, qa.quote);
  const changedAfter = result.state.meals.filter((m) => diff.meals.some((d) => d.date === m.date && d.slot === m.slot));
  const changedBefore = env.meals.filter((m) => diff.meals.some((d) => d.date === m.date && d.slot === m.slot));
  /** @param {Meal[]} list */
  const avgKcal = (list) => {
    const values = list.map((m) => recipeNutritionMap().get(m.recipeId)?.kcal).filter((v) => v !== undefined);
    return values.length ? Math.round(values.reduce((a, b) => a + /** @type {number} */ (b), 0) / values.length) : null;
  };
  const verifiedShareAfter = qa.quote.totalCents > 0 ? qa.quote.verifiedCents / qa.quote.totalCents : 0;
  return {
    state: result.state,
    review: {
      applied: result.applied,
      errors: result.errors,
      diff,
      cost: {
        beforeCents: qb.quote.totalCents,
        afterCents: qa.quote.totalCents,
        comparison,
        missingBefore: qb.quote.missing.length,
        missingAfter: qa.quote.missing.length,
        verifiedShareAfter,
        savingCents: qa.quote.savingCents,
      },
      budget: { weeklyBudgetCents: env.budget.weeklyCents, afterBudgetCents: result.state.weeklyBudgetCents },
      kcalPerPortion: changedBefore.length || changedAfter.length ? { before: avgKcal(changedBefore), after: avgKcal(changedAfter) } : null,
      bigChange: diff.meals.length >= 5 || (comparison.deltaCents !== null && isBigChange(qb.quote.totalCents, qa.quote.totalCents)),
      computedAt: env.now.toISOString(),
    },
  };
}

/**
 * Bilan resume pour le modele IA (les montants viennent de l'application).
 * @param {ProposalReview} review
 */
function reviewForModel(review) {
  const c = review.cost;
  return {
    appliedOperations: review.applied.length,
    refused: review.errors,
    mealChanges: review.diff.meals,
    ingredientsAdded: review.diff.added.map((a) => ingredientsById.get(a.ingredientId)?.name ?? a.ingredientId),
    ingredientsRemoved: review.diff.removed.map((a) => ingredientsById.get(a.ingredientId)?.name ?? a.ingredientId),
    portions: review.diff.portions,
    cost: {
      before: formatCents(c.beforeCents),
      after: formatCents(c.afterCents),
      difference: c.comparison.deltaCents === null ? null : formatCents(c.comparison.deltaCents),
      reliability: c.comparison.level,
      explanation: c.comparison.explanation,
      itemsWithoutPriceAfter: c.missingAfter,
      promotionSavings: formatCents(c.savingCents),
    },
    weeklyBudget: review.budget.afterBudgetCents === null ? 'non défini' : formatCents(review.budget.afterBudgetCents),
    averageKcalPerPortion: review.kcalPerPortion,
    needsSecondConfirmation: review.bigChange,
  };
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/**
 * @param {string} monday
 * @returns {Promise<Conversation>}
 */
export async function getConversation(monday) {
  const stored = /** @type {Conversation | undefined} */ (await conversationStore.get(monday));
  return stored ?? createConversation(monday, new Date().toISOString());
}

/**
 * @param {Conversation} conv
 * @returns {Promise<void>}
 */
function saveConversation(conv) {
  return conversationStore.put({ ...conv, updatedAt: new Date().toISOString() });
}

/**
 * Efface la conversation de la semaine (les changements acceptes restent).
 * @param {string} monday
 * @returns {Promise<void>}
 */
export function clearConversation(monday) {
  return conversationStore.delete(monday);
}

/**
 * @param {'user' | 'assistant'} role
 * @param {string} text
 * @param {'ai' | 'engine' | null} source
 * @param {string | null} proposalId
 * @returns {ChatMessage}
 */
function message(role, text, source, proposalId) {
  return { id: newMealId(), role, text, source, proposalId, createdAt: new Date().toISOString() };
}

/**
 * Cree une proposition en attente (les precedentes en attente expirent).
 * @param {Conversation} conv
 * @param {Operation[]} operations
 * @param {string} summary
 * @param {string[]} notes
 * @param {'ai' | 'engine'} author
 * @param {Request | null} request
 * @param {Env} env
 * @returns {Promise<StoredProposal>}
 */
async function createProposal(conv, operations, summary, notes, author, request, env) {
  for (const p of conv.proposals) if (p.status === 'pending') p.status = 'expired';
  const { review } = await reviewOperations(operations, env);
  /** @type {StoredProposal & { request?: Request | null }} */
  const proposal = {
    id: newMealId(),
    week: conv.week,
    summary,
    operations: review.applied,
    notes: [...notes, ...review.errors],
    author,
    status: review.applied.length ? 'pending' : 'rejected',
    createdAt: env.now.toISOString(),
    review,
    request,
  };
  conv.proposals.push(proposal);
  return proposal;
}

/**
 * Texte de reponse du moteur local.
 * @param {Request} req
 * @param {StoredProposal | null} proposal
 * @param {string[]} notes
 * @returns {string}
 */
function engineReply(req, proposal, notes) {
  const lines = [describeRequest(req, (d) => formatIsoDay(d), slotLabels, placeLabels)];
  if (proposal && proposal.status === 'pending' && proposal.review) {
    const n = proposal.review.applied.length;
    lines.push(`Voici ma proposition (${n} modification${n > 1 ? 's' : ''}). Vérifiez l’aperçu ci-dessous puis acceptez, modifiez ou annulez.`);
    const c = proposal.review.cost.comparison;
    if (c.deltaCents !== null) {
      const sign = c.deltaCents > 0 ? '+' : c.deltaCents < 0 ? '−' : '';
      lines.push(`Coût des courses : ${formatCents(proposal.review.cost.beforeCents)} → ${formatCents(proposal.review.cost.afterCents)} (${sign}${formatCents(Math.abs(c.deltaCents))}, ${c.level === 'verified' ? 'prix Drive vérifiés' : 'estimation'}).`);
    } else lines.push(c.explanation);
  }
  for (const n of notes) lines.push(n);
  return lines.join('\n');
}

/**
 * Envoie un message a l'assistant.
 * @param {string} monday
 * @param {string} text
 * @param {{ focusIngredientId?: string | null }} [opts]
 * @returns {Promise<Conversation>}
 */
export async function sendMessage(monday, text, opts = {}) {
  const clean = text.trim().slice(0, 1000);
  const conv = await getConversation(monday);
  if (!clean) return conv;
  const env = await loadEnvironment(monday);
  conv.messages.push(message('user', clean, null, null));

  const parsed = parseRequest(clean, { today: env.today, monday, focusIngredientId: opts.focusIngredientId ?? null, ...finder });
  if (BUDGET_FIT.test(normalizeText(clean))) {
    await fitBudgetTurn(conv, env, parsed.budgetCents);
    await saveConversation(conv);
    return conv;
  }
  if (parsed.undo) {
    const result = await undoLast(monday);
    conv.messages.push(message('assistant', result.message, 'engine', null));
    conv.pendingEvents.push(`Le client a annulé la dernière modification : ${result.message}`);
    await saveConversation(conv);
    return conv;
  }
  const merged = applyPreferences(mergeRequests(conv.context, parsed), env.preferences);
  if (parsed.remember && parsed.understood) {
    await savePreferences(learnFromRequest(env.preferences, parsed, env.now.toISOString(), cuisineLabels));
  }

  const settings = await getAssistantSettings();
  let handled = false;
  if (settings.useAi && settings.hasKey) {
    try {
      await runAiTurn(conv, clean, env, settings, merged);
      handled = true;
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      conv.messages.push(message('assistant', `L’IA n’est pas disponible (${error.message}) : je réponds avec le moteur de l’application.`, 'engine', null));
    }
  }
  if (!handled) {
    const result = proposeChanges(merged, { ...env.engine });
    let proposal = null;
    if (result.operations.length) proposal = await createProposal(conv, result.operations, describeRequest(merged, (d) => formatIsoDay(d), slotLabels, placeLabels), result.notes, 'engine', merged, env);
    conv.messages.push(message('assistant', engineReply(merged, proposal, result.notes), 'engine', proposal?.status === 'pending' ? proposal.id : null));
    // Le modele IA sera informe de ce qui s'est passe hors ligne.
    conv.pendingEvents.push(`Hors connexion IA, le client a demandé : « ${clean} ». Le moteur local a répondu${proposal ? ` avec une proposition (${proposal.summary})` : ''}.`);
  }
  if (merged.understood && !merged.undo) conv.context = merged;
  await saveConversation(conv);
  return conv;
}

// ---------------------------------------------------------------------------
// Parcours guide « Planifier ma semaine »
// ---------------------------------------------------------------------------

const regionLabels = new Map(REGIONS.map((r) => [r.id, r.label]));

/**
 * Valeurs de depart du parcours guide : derniers choix, sinon repas affiches,
 * « leger » si un programme minceur est actif et preference de temps retenue.
 * @returns {Promise<{ choices: import('../domain/assistant/guided.js').GuidedChoices, weeklyBudgetCents: number | null, programActive: boolean }>}
 */
export async function guidedDefaults() {
  const [stored, budget, program, showBreakfast, showSnack, preferences] = await Promise.all([
    getSetting('guidedChoices'),
    getBudget(),
    programSummary(),
    getShowBreakfast(),
    getShowSnack(),
    getPreferences(),
  ]);
  const maxPref = preferences.find((p) => p.active && p.kind === 'max_minutes');
  /** @type {import('../domain/assistant/guided.js').GuidedChoices} */
  const fallback = {
    slots: SLOTS.map((s) => s.id).filter((s) => (s !== 'breakfast' || showBreakfast) && (s !== 'snack' || showSnack)),
    keepExisting: true,
    budgetCents: null,
    maxMinutes: maxPref ? Number(maxPref.value) : 45,
    wishes: program ? ['light'] : [],
    region: null,
  };
  const last = /** @type {Partial<import('../domain/assistant/guided.js').GuidedChoices> | null} */ (stored && typeof stored === 'object' ? stored : null);
  return {
    choices: last ? { ...fallback, ...last, budgetCents: null } : fallback,
    weeklyBudgetCents: budget.weeklyCents,
    programActive: program !== null,
  };
}

/**
 * Compose la semaine a partir des choix du parcours guide. La proposition
 * rejoint la conversation de la semaine (historique et annulation communs).
 * @param {string} monday
 * @param {import('../domain/assistant/guided.js').GuidedChoices} choices
 * @returns {Promise<{ proposalId: string | null, notes: string[] }>}
 */
export async function planWeek(monday, choices) {
  const conv = await getConversation(monday);
  const env = await loadEnvironment(monday);
  await setSetting('guidedChoices', { ...choices, budgetCents: null });
  const req = applyPreferences(guidedRequest(choices), env.preferences);
  const result = proposeChanges(req, env.engine);
  // « Garder les repas deja prevus » : on ne fait que remplir les cases vides.
  const operations = choices.keepExisting ? result.operations.filter((o) => o.type !== 'replace_recipe') : result.operations;
  const summary = describeChoices(choices, slotLabels, regionLabels);
  conv.messages.push(message('user', summary, null, null));
  const proposal = operations.length ? await createProposal(conv, operations, 'Planifier ma semaine', result.notes, 'engine', req, env) : null;
  const pending = proposal?.status === 'pending' ? proposal : null;
  const notes = pending ? result.notes : [...result.notes, 'Aucun repas à ajouter : la semaine est déjà remplie ou aucune recette ne correspond à vos choix.'];
  conv.messages.push(message('assistant', pending ? `Voici une semaine de ${pending.operations.filter((o) => o.type === 'add_meal' || o.type === 'replace_recipe').length} repas. Changez ce qui ne vous plaît pas, puis validez.` : notes.join('\n'), 'engine', pending?.id ?? null));
  conv.pendingEvents.push(`Le client a utilisé le parcours guidé : « ${summary} ».`);
  await saveConversation(conv);
  return { proposalId: pending?.id ?? null, notes };
}

/**
 * @param {string} monday
 * @param {string} proposalId
 */
async function pendingProposal(monday, proposalId) {
  const conv = await getConversation(monday);
  const proposal = /** @type {StoredProposal | undefined} */ (conv.proposals.find((p) => p.id === proposalId && p.status === 'pending'));
  return { conv, proposal };
}

/**
 * Apercu de la semaine telle que proposee : un jour par carte, repas par repas.
 * @param {string} monday
 * @param {string} proposalId
 */
export async function previewProposal(monday, proposalId) {
  const conv = await getConversation(monday);
  const proposal = /** @type {StoredProposal | undefined} */ (conv.proposals.find((p) => p.id === proposalId));
  if (!proposal) return null;
  const env = await loadEnvironment(monday);
  const { review, state } = proposal.status === 'pending' ? await reviewOperations(proposal.operations, env) : { review: proposal.review, state: { meals: env.meals } };
  const wanted = new Set(proposal.request?.slots?.length ? proposal.request.slots : env.activeSlots);
  const changed = new Set((review?.diff.meals ?? []).map((d) => `${d.date}|${d.slot}`));
  /** Raison de chaque plat propose, par creneau. */
  /** @type {Map<string, string>} */
  const reasons = new Map();
  for (const o of proposal.operations) {
    if (o.type === 'add_meal') reasons.set(`${o.date}|${o.slot}`, o.reason);
    if (o.type === 'replace_recipe') {
      const m = env.meals.find((x) => x.id === o.mealId);
      if (m) reasons.set(`${m.date}|${m.slot}`, o.reason);
    }
  }
  const nutrition = recipeNutritionMap();
  const days = env.days
    .filter((date) => date >= env.today)
    .map((date) => ({
      date,
      meals: SLOTS.filter((s) => wanted.has(s.id) || state.meals.some((m) => m.date === date && m.slot === s.id)).map((s) => {
        const meal = state.meals.find((m) => m.date === date && m.slot === s.id) ?? null;
        const recipe = meal ? recipesById.get(meal.recipeId) : undefined;
        const kcal = recipe ? nutrition.get(recipe.id)?.kcal : undefined;
        return {
          slot: s.id,
          slotLabel: s.label,
          mealId: meal?.id ?? null,
          recipeId: recipe?.id ?? null,
          recipeName: meal?.recipeName ?? null,
          minutes: recipe ? totalMinutes(recipe) : null,
          kcal: kcal === undefined ? null : Math.round(kcal),
          changed: changed.has(`${date}|${s.id}`),
          reason: reasons.get(`${date}|${s.id}`) ?? null,
          locked: meal?.locked ?? false,
        };
      }),
    }));
  return { proposal, review, days, programActive: env.program !== null };
}

/**
 * « Changer » : remplace le plat propose a un creneau par la meilleure autre idee.
 * @param {string} monday
 * @param {string} proposalId
 * @param {string} date
 * @param {Slot} slot
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function swapProposalMeal(monday, proposalId, date, slot) {
  const { conv, proposal } = await pendingProposal(monday, proposalId);
  if (!proposal) return { ok: false, message: 'Cette proposition n’est plus valable.' };
  const env = await loadEnvironment(monday);
  const { state } = await reviewOperations(proposal.operations, env);
  const key = `${date}|${slot}`;
  const current = state.meals.find((m) => m.date === date && m.slot === slot);
  const existing = env.meals.find((m) => m.date === date && m.slot === slot) ?? null;
  if (existing?.locked) return { ok: false, message: 'Ce repas est verrouillé dans le planning.' };
  const seen = proposal.seen?.[key] ?? [];
  const exclude = new Set([...seen, ...(current ? [current.recipeId] : [])]);
  const request = proposal.request ?? guidedRequest({ slots: [slot], keepExisting: true, budgetCents: null, maxMinutes: null, wishes: [], region: null });
  const [pick] = suggestRecipes(request, { date, slot }, { ...env.engine, meals: state.meals }, exclude, 1);
  if (!pick) return { ok: false, message: 'Je n’ai plus d’autre idée pour ce repas avec vos critères.' };
  const reason = pick.reasons.length ? `${pick.reasons.join(', ')}.` : 'Autre idée demandée.';
  const index = operationIndexFor(proposal.operations, { date, slot }, existing?.id ?? null);
  /** @type {Operation} */
  const operation = existing
    ? { type: 'replace_recipe', mealId: existing.id, recipeId: pick.recipe.id, reason }
    : { type: 'add_meal', date, slot, recipeId: pick.recipe.id, guests: index >= 0 && proposal.operations[index].type === 'add_meal' ? /** @type {{ guests: number }} */ (proposal.operations[index]).guests : 0, reason };
  if (index >= 0) proposal.operations[index] = operation;
  else proposal.operations.push(operation);
  proposal.seen = { ...(proposal.seen ?? {}), [key]: [...exclude] };
  proposal.review = (await reviewOperations(proposal.operations, env)).review;
  await saveConversation(conv);
  return { ok: true, message: `${pick.recipe.name} à la place.` };
}

/**
 * « Retirer » : le creneau garde son repas d'origine (ou reste vide).
 * @param {string} monday
 * @param {string} proposalId
 * @param {string} date
 * @param {Slot} slot
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function dropProposalMeal(monday, proposalId, date, slot) {
  const { conv, proposal } = await pendingProposal(monday, proposalId);
  if (!proposal) return { ok: false, message: 'Cette proposition n’est plus valable.' };
  const env = await loadEnvironment(monday);
  const existing = env.meals.find((m) => m.date === date && m.slot === slot) ?? null;
  const index = operationIndexFor(proposal.operations, { date, slot }, existing?.id ?? null);
  if (index < 0) return { ok: false, message: 'Ce repas ne fait pas partie de la proposition.' };
  proposal.operations.splice(index, 1);
  if (!proposal.operations.length) proposal.status = 'rejected';
  else proposal.review = (await reviewOperations(proposal.operations, env)).review;
  await saveConversation(conv);
  return { ok: true, message: existing ? 'Le repas prévu est conservé.' : 'Ce repas reste libre.' };
}

// ---------------------------------------------------------------------------
// Ajuster les courses au budget (prix reels du Drive et des releves)
// ---------------------------------------------------------------------------

/** Demandes explicites d'ajustement au budget : « ajuste mes courses au budget », « tenir dans mon budget ». */
const BUDGET_FIT = /ajust\w*\b.{0,40}\bbudget|\b(tenir|rentrer|rester)\s+dans\s+(mon|le|ce)\s+budget/;

/**
 * Calcule et ajoute a la conversation la proposition qui fait passer les courses sous le budget.
 * @param {Conversation} conv
 * @param {Env} env
 * @param {number | null} budgetOverride  Budget donne dans la demande (« ajuste a 80 € »)
 */
async function fitBudgetTurn(conv, env, budgetOverride) {
  const budgetCents = budgetOverride ?? env.budget.weeklyCents;
  if (budgetCents === null) {
    conv.messages.push(message('assistant', 'Aucun budget hebdomadaire n’est défini. Fixez-le dans l’écran Budget, ou dites par exemple « ajuste mes courses à un budget de 80 € ».', 'engine', null));
    return;
  }
  const quoter = await weekQuoter(env.monday, env.priceData);
  const compatibleIds = new Set(recipes.filter((r) => evaluateRecipeForHousehold(r, env.household, env.scoring).status === 'compatible').map((r) => r.id));
  /** @type {import('../domain/assistant/scoring.js').Constraints} */
  const base = { slot: null, maxMinutes: null, avoid: [], include: [], cuisine: null, cuisines: null, excludeRecipeIds: new Set(), maxCostIndex: null, compatibleIds };
  const result = fitToBudget({
    meals: env.meals,
    days: env.days,
    today: env.today,
    budgetCents,
    preferred: new Map(Object.entries(env.priceData.settings.preferredProducts)),
    preference: env.priceData.settings.preference,
    quote: (meals, preferred, preference) => quoter(meals, preferred, preference).quote,
    candidates: (meal, exclude) =>
      rankThrifty(
        recipes.filter((r) => isEligible(r, { ...base, slot: meal.slot, excludeRecipeIds: exclude }, env.scoring)),
        (r) => recipeCost(r, env.scoring).index,
      ),
    recipesById,
    nameOf: (id) => ingredientsById.get(id)?.name ?? id,
    autoSubstitutions: env.apply.autoSubstitutions,
  });
  /** @type {Operation[]} */
  const operations = budgetOverride !== null && budgetOverride !== env.budget.weeklyCents
    ? [{ type: 'set_weekly_budget', cents: budgetOverride, reason: 'Budget de la semaine demandé.' }, ...result.operations]
    : result.operations;
  const summary = `Ajuster les courses au budget de ${formatCents(budgetCents)}`;
  const proposal = operations.length ? await createProposal(conv, operations, summary, result.notes.slice(1), 'engine', null, env) : null;
  const lines = [result.notes[0]];
  if (proposal && proposal.status === 'pending') {
    lines.push(`Voici ma proposition (${proposal.operations.length} modification${proposal.operations.length > 1 ? 's' : ''}) : d’abord des produits moins chers, puis, si besoin, des repas plus économiques. Vérifiez l’aperçu puis acceptez, modifiez ou annulez.`);
  } else lines.push(...result.notes.slice(1));
  conv.messages.push(message('assistant', lines.join('\n'), 'engine', proposal?.status === 'pending' ? proposal.id : null));
  conv.pendingEvents.push(`Le client a demandé d’ajuster les courses au budget de ${formatCents(budgetCents)}. Le moteur a répondu : ${result.notes[0]}`);
}

/**
 * Ajustement au budget lance depuis un bouton (ecran Drive ou Courses).
 * @param {string} monday
 * @returns {Promise<Conversation>}
 */
export async function fitBudget(monday) {
  const conv = await getConversation(monday);
  const env = await loadEnvironment(monday);
  conv.messages.push(message('user', 'Ajuste les courses de la semaine à mon budget.', null, null));
  await fitBudgetTurn(conv, env, null);
  await saveConversation(conv);
  return conv;
}

// ---------------------------------------------------------------------------
// Tour avec le modele IA
// ---------------------------------------------------------------------------

/**
 * @param {Conversation} conv
 * @param {string} text
 * @param {Env} env
 * @param {AssistantSettings} settings
 * @param {Request} merged
 */
async function runAiTurn(conv, text, env, settings, merged) {
  const apiKey = /** @type {string} */ (await getSetting('assistantApiKey'));
  const startLength = conv.apiMessages.length;
  const events = conv.pendingEvents.length ? `[Informations de l’application : ${conv.pendingEvents.join(' ')}]\n` : '';
  const header = `[Semaine du ${env.monday} ; aujourd’hui ${env.today} (${formatIsoDay(env.today)})]\n`;
  /** @type {ApiMessage[]} */
  const history = /** @type {ApiMessage[]} */ (conv.apiMessages);
  history.push({ role: 'user', content: `${events}${header}${text}` });
  /** @type {StoredProposal | null} */
  let proposal = null;
  let reply = '';
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await callClaude({ apiKey, model: settings.model, messages: history });
      history.push({ role: 'assistant', content: response.content });
      if (response.stop_reason !== 'tool_use') {
        reply = responseText(response.content) || 'Je n’ai pas de réponse à proposer.';
        if (response.stop_reason === 'max_tokens') reply += '\n(Réponse coupée : demandez-moi de continuer.)';
        break;
      }
      /** @type {ContentBlock[]} */
      const results = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const out = await executeTool(String(block.name), block.input, conv, env, merged);
        if (out.proposal) proposal = out.proposal;
        results.push({ type: 'tool_result', tool_use_id: String(block.id), content: JSON.stringify(out.result), ...(out.isError ? { is_error: true } : {}) });
      }
      history.push({ role: 'user', content: results });
      if (round === MAX_TOOL_ROUNDS - 1) reply = 'J’ai préparé ce que j’ai pu ; voici la proposition actuelle.';
    }
  } catch (error) {
    // Historique remis dans son etat d'avant ce tour (jamais de tour a moitie enregistre).
    conv.apiMessages = history.slice(0, startLength);
    if (proposal) proposal.status = 'expired';
    throw error;
  }
  conv.pendingEvents = [];
  conv.messages.push(message('assistant', reply, 'ai', proposal?.status === 'pending' ? proposal.id : null));
}

/**
 * Execute un outil demande par le modele. Lecture seule, sauf la preparation
 * d'une proposition (en attente) et la memorisation d'une preference demandee.
 * @param {string} name
 * @param {unknown} input
 * @param {Conversation} conv
 * @param {Env} env
 * @param {Request} merged
 * @returns {Promise<{ result: unknown, isError?: boolean, proposal?: StoredProposal }>}
 */
async function executeTool(name, input, conv, env, merged) {
  if (!TOOL_NAMES.has(name)) return { result: { error: `Outil inconnu : ${name}` }, isError: true };
  const args = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const str = (/** @type {string} */ k) => (typeof args[k] === 'string' ? /** @type {string} */ (args[k]) : null);
  try {
    switch (name) {
      case 'get_planning':
        return { result: planningForModel(env) };
      case 'search_recipes':
        return { result: searchRecipes(args, env) };
      case 'get_recipe': {
        const recipe = recipesById.get(str('recipeId') ?? '');
        if (!recipe) return { result: { error: 'Recette inconnue.' }, isError: true };
        const fit = evaluateRecipeForHousehold(recipe, env.household, env.scoring);
        return {
          result: {
            id: recipe.id,
            name: recipe.name,
            cuisine: recipe.cuisine,
            servings: recipe.servings,
            minutes: totalMinutes(recipe),
            mealTypes: recipeMealTypes(recipe),
            tags: recipe.tags ?? [],
            suitsHousehold: fit.status === 'compatible',
            ingredients: recipe.ingredients.map((l) => ({ id: l.ingredientId, name: ingredientsById.get(l.ingredientId)?.name, quantity: l.quantity, unit: l.unit })),
            preparations: recipe.preparations.map((p) => ({ id: p.preparationId, name: preparationsById.get(p.preparationId)?.name, quantity: p.quantity, unit: p.unit })),
            perPortion: roundNutrients(recipeNutritionMap().get(recipe.id) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }),
          },
        };
      }
      case 'get_prices':
        return { result: pricesForModel(Array.isArray(args.ingredientIds) ? args.ingredientIds.map(String).slice(0, 30) : [], env) };
      case 'get_promotions':
        return { result: promotionsForModel(env) };
      case 'get_program':
        return { result: env.program ? { active: true, dailyKcal: env.program.targets.kcal, proteinG: env.program.targets.proteinG, perMeal: env.program.meals, progress: env.program.progress } : { active: false } };
      case 'run_optimizer': {
        const request = str('request') ?? '';
        const req = applyPreferences(mergeRequests(merged, parseRequest(request, { today: env.today, monday: env.monday, ...finder })), env.preferences);
        const result = proposeChanges(req, env.engine);
        if (!result.operations.length) return { result: { operations: [], notes: result.notes, needsClarification: result.needsClarification } };
        const proposal = await createProposal(conv, result.operations, describeRequest(req, (d) => formatIsoDay(d), slotLabels, placeLabels), result.notes, 'engine', req, env);
        return { proposal, result: { proposalId: proposal.id, operations: describeOperations(proposal.operations, env), notes: proposal.notes, review: proposal.review ? reviewForModel(proposal.review) : null } };
      }
      case 'propose_changes': {
        const parsed = parseOperations(args.operations);
        if (!parsed.ok) return { result: { error: parsed.error }, isError: true };
        const proposal = await createProposal(conv, parsed.operations, str('summary') ?? 'Proposition de l’assistant', [], 'ai', merged, env);
        if (proposal.status !== 'pending') return { proposal, result: { error: 'Aucune opération n’a pu être appliquée.', refused: proposal.notes }, isError: true };
        return { proposal, result: { proposalId: proposal.id, operations: describeOperations(proposal.operations, env), review: proposal.review ? reviewForModel(proposal.review) : null } };
      }
      case 'remember_preference': {
        const kind = str('kind');
        const value = str('value');
        const label = str('label');
        if (!kind || !value || !label || !['mode', 'cuisine', 'avoid', 'max_minutes'].includes(kind)) return { result: { error: 'Préférence invalide.' }, isError: true };
        const id = kind === 'max_minutes' ? 'max_minutes' : `${kind}:${value}`;
        await savePreferences(upsertPreference(env.preferences, { id, kind: /** @type {Preference['kind']} */ (kind), value, label, source: 'explicit', count: 1, active: true, updatedAt: env.now.toISOString() }));
        return { result: { saved: true, visibleIn: 'Plus > Préférences de l’assistant' } };
      }
      default:
        return { result: { error: 'Outil non disponible.' }, isError: true };
    }
  } catch (error) {
    return { result: { error: error instanceof Error ? error.message : String(error) }, isError: true };
  }
}

/**
 * @param {Operation[]} operations
 * @param {Env} env
 */
function describeOperations(operations, env) {
  return operations.map((o) => {
    const meal = 'mealId' in o ? env.meals.find((m) => m.id === o.mealId) : undefined;
    const where = meal ? `${meal.date} ${meal.slot} (${meal.recipeName})` : 'date' in o ? `${o.date} ${o.slot}` : '';
    const recipe = 'recipeId' in o ? recipesById.get(o.recipeId)?.name : undefined;
    return { type: o.type, where, recipe, reason: o.reason };
  });
}

/**
 * @param {Env} env
 */
function planningForModel(env) {
  const weekMeals = env.meals.filter((m) => env.days.includes(m.date)).sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  const members = env.household.members;
  return {
    week: env.monday,
    today: env.today,
    shownSlots: env.activeSlots,
    meals: weekMeals.map((m) => ({
      mealId: m.id,
      date: m.date,
      slot: m.slot,
      recipeId: m.recipeId,
      recipeName: m.recipeName,
      portions: mealPortionsFor(m, env.household),
      guests: m.guests,
      locked: m.locked,
      past: m.date < env.today,
      cooksAlsoNextLunch: Boolean(m.nextLunch),
      substitutions: m.substitutions ?? [],
      kcalPerPortion: Math.round(recipeNutritionMap().get(m.recipeId)?.kcal ?? 0),
    })),
    freeSlots: freeSlots(env.meals, env.days.filter((d) => d >= env.today), env.activeSlots),
    household: {
      people: members.length,
      categories: members.map((m) => m.category),
      allergies: [...new Set(members.flatMap((m) => m.allergens))],
      diets: [...new Set(members.map((m) => m.diet).filter(Boolean))],
      dislikes: [...new Set(members.flatMap((m) => m.dislikes))].map((id) => ingredientsById.get(id)?.name ?? id),
      equipment: env.household.equipment,
    },
    budget: { weekly: env.budget.weeklyCents === null ? null : formatCents(env.budget.weeklyCents), monthly: env.budget.monthlyCents === null ? null : formatCents(env.budget.monthlyCents) },
    preferences: describePreferences(env.preferences),
    weightLossProgram: env.program ? { dailyKcal: env.program.targets.kcal, perMeal: env.program.meals } : null,
    priceData: {
      driveStore: env.priceData.store?.name ?? null,
      driveProducts: env.priceData.products.length,
      driveProductsCheckedLast48h: env.priceData.products.filter((p) => isFresh(p, env.now)).length,
      verifiedPromotionsToday: env.scoring.promoIngredients.size,
      manualPrices: env.priceData.prices.length,
    },
  };
}

/**
 * @param {Record<string, unknown>} args
 * @param {Env} env
 */
function searchRecipes(args, env) {
  const words = normalizeText(typeof args.query === 'string' ? args.query : '').split(' ').filter(Boolean);
  const slot = typeof args.slot === 'string' ? args.slot : null;
  const cuisine = typeof args.cuisine === 'string' ? args.cuisine : null;
  const region = typeof args.region === 'string' ? args.region : null;
  const maxMinutes = typeof args.maxMinutes === 'number' ? args.maxMinutes : null;
  const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
  const include = typeof args.includeIngredient === 'string' ? args.includeIngredient : null;
  const exclude = Array.isArray(args.excludeIngredients) ? args.excludeIngredients.map(String) : [];
  const limit = typeof args.limit === 'number' ? Math.min(20, Math.max(1, args.limit)) : 10;
  const target = slot && env.program ? env.program.meals[/** @type {'breakfast' | 'lunch' | 'snack' | 'dinner'} */ (slot)] : null;
  const found = recipes
    .filter((r) => {
      if (slot && !recipeMealTypes(r).includes(/** @type {Slot} */ (slot))) return false;
      if (cuisine && r.cuisine !== cuisine) return false;
      if (region && cuisineRegion.get(r.cuisine) !== region) return false;
      if (maxMinutes !== null && totalMinutes(r) > maxMinutes) return false;
      if (tags.some((t) => !hasTag(r, /** @type {any} */ (t)))) return false;
      const ids = allIngredientIds(r, preparationsById);
      if (include && !ids.includes(include)) return false;
      if (exclude.some((id) => ids.includes(id))) return false;
      if (words.length) {
        const text = normalizeText([r.name, cuisineLabels.get(r.cuisine) ?? '', ...ids.map((id) => ingredientsById.get(id)?.name ?? '')].join(' '));
        if (!words.every((w) => text.includes(w))) return false;
      }
      return evaluateRecipeForHousehold(r, env.household, env.scoring).status === 'compatible' && isFeasibleLocally(r, preparationsById, env.scoring.availability ?? (() => 'common'), substitutesFor);
    })
    .map((r) => {
      const n = recipeNutritionMap().get(r.id);
      return { r, fit: target && n ? programFitScore(n, target) : 0 };
    })
    .sort((a, b) => b.fit - a.fit)
    .slice(0, limit);
  return found.map(({ r }) => {
    const n = recipeNutritionMap().get(r.id);
    const cost = recipeCost(r, env.scoring);
    return {
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      minutes: totalMinutes(r),
      mealTypes: recipeMealTypes(r),
      tags: r.tags ?? [],
      oneVessel: Boolean(r.vessel),
      kcalPerPortion: n ? Math.round(n.kcal) : null,
      proteinPerPortion: n ? Math.round(n.protein) : null,
      costPerPortion: cost.real === null ? 'prix inconnus' : `${formatCents(cost.real)} (estimation d’après vos prix)`,
      hardToFindInGuyane: recipeLocalIssues(r, preparationsById, env.scoring.availability ?? (() => 'common'), substitutesFor).map(
        (i) => `${ingredientsById.get(i.ingredientId)?.name ?? i.ingredientId} (${i.level === 'missing' ? 'introuvable pour la cliente' : i.level === 'rare' ? 'souvent introuvable' : 'magasin spécialisé'}${i.substitute ? `, alternative : ${ingredientsById.get(i.substitute)?.name}` : ''})`,
      ),
    };
  });
}

/**
 * @param {string[]} ids
 * @param {Env} env
 */
function pricesForModel(ids, env) {
  return ids.map((id) => ({
    ingredientId: id,
    name: ingredientsById.get(id)?.name ?? 'inconnu',
    drive: (env.byIngredient.get(id) ?? []).map((p) => ({
      productId: p.id,
      name: p.name,
      brand: p.brand,
      price: formatCents(p.priceCents),
      contents: `${p.packageQuantity} ${p.packageUnit}`,
      availability: p.availability,
      quality: p.quality,
      promotion: p.promotion ? { label: p.promotion.label, status: promotionStatus(p.promotion, env.today), from: p.promotion.startDate, to: p.promotion.endDate, conditions: p.promotion.conditions } : null,
      checkedAt: p.checkedAt,
      reliability: isFresh(p, env.now) ? 'vérifié (moins de 48 h)' : 'à revérifier',
    })),
    manual: env.priceData.prices
      .filter((p) => p.ingredientId === id)
      .map((p) => ({ store: p.storeId, price: formatCents(p.priceCents), contents: `${p.packageQuantity} ${p.packageUnit}`, date: p.date, availability: p.availability })),
  }));
}

/**
 * @param {Env} env
 */
function promotionsForModel(env) {
  return activePromotions(env.priceData.products, env.today).map((p) => ({
    productId: p.id,
    name: p.name,
    ingredientId: p.ingredientId,
    price: formatCents(p.priceCents),
    offer: p.promotion?.label,
    until: p.promotion?.endDate,
    conditions: p.promotion?.conditions,
    loyaltyCard: p.promotion?.requiresCard,
    reliability: isFresh(p, env.now) ? 'vérifié (moins de 48 h)' : 'à revérifier',
  }));
}

// ---------------------------------------------------------------------------
// Accepter, refuser, annuler
// ---------------------------------------------------------------------------

/**
 * Applique une proposition acceptee par le client. Tout est revalide sur l'etat actuel.
 * @param {string} monday
 * @param {string} proposalId
 * @param {{ confirmedBigChange?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, needsConfirmation?: boolean, message: string, conversation: Conversation }>}
 */
export async function acceptProposal(monday, proposalId, opts = {}) {
  const conv = await getConversation(monday);
  const proposal = /** @type {(StoredProposal & { request?: Request | null }) | undefined} */ (conv.proposals.find((p) => p.id === proposalId));
  if (!proposal || proposal.status !== 'pending') return { ok: false, message: 'Cette proposition n’est plus valable.', conversation: conv };
  const env = await loadEnvironment(monday);
  const { review, state } = await reviewOperations(proposal.operations, env);
  if (!review.applied.length) {
    proposal.status = 'expired';
    await saveConversation(conv);
    return { ok: false, message: `Le planning a changé : la proposition ne peut plus s’appliquer. ${review.errors.join(' ')}`, conversation: conv };
  }
  if (review.bigChange && !opts.confirmedBigChange) {
    proposal.review = review;
    await saveConversation(conv);
    return { ok: false, needsConfirmation: true, message: 'Changement important : confirmez une seconde fois.', conversation: conv };
  }

  // Ecriture : seulement les repas touches.
  const beforeById = new Map(env.meals.map((m) => [m.id, m]));
  const afterById = new Map(state.meals.map((m) => [m.id, m]));
  /** @type {string[]} */
  const touched = [];
  for (const meal of state.meals) {
    const old = beforeById.get(meal.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(meal)) {
      await putMeal(meal);
      touched.push(meal.id);
    }
  }
  /** @type {string[]} */
  const removed = [];
  for (const meal of env.meals) {
    if (!afterById.has(meal.id)) {
      await deleteMealRecord(meal.id);
      removed.push(meal.id);
      touched.push(meal.id);
    }
  }
  if (state.weeklyBudgetCents !== env.budget.weeklyCents) await saveBudget({ ...env.budget, weeklyCents: state.weeklyBudgetCents });
  if (JSON.stringify(state.preferredProducts) !== JSON.stringify(env.priceData.settings.preferredProducts)) await saveDriveSettings({ preferredProducts: state.preferredProducts });

  /** @type {HistoryEntry} */
  const entry = {
    id: newMealId(),
    week: monday,
    proposalId,
    summary: proposal.summary,
    createdAt: new Date().toISOString(),
    before: { meals: env.meals.filter((m) => touched.includes(m.id)), weeklyBudgetCents: env.budget.weeklyCents, preferredProducts: env.priceData.settings.preferredProducts },
    after: { meals: state.meals.filter((m) => touched.includes(m.id)), removedMealIds: removed },
    touchedMealIds: touched,
    undone: false,
  };
  await historyStore.put(entry);
  if (proposal.request) await savePreferences(learnFromRequest(env.preferences, proposal.request, entry.createdAt, cuisineLabels));

  proposal.status = 'accepted';
  proposal.review = review;
  const n = review.applied.length;
  const text = `C’est fait : ${n} modification${n > 1 ? 's' : ''} appliquée${n > 1 ? 's' : ''}. La liste de courses et le panier Drive sont recalculés.${review.errors.length ? ` Non appliqué : ${review.errors.join(' ')}` : ''} Vous pouvez annuler depuis l’historique.`;
  conv.messages.push(message('assistant', text, 'engine', null));
  conv.pendingEvents.push(`Le client a accepté la proposition « ${proposal.summary} » (${n} opération(s) appliquée(s)).`);
  await saveConversation(conv);
  return { ok: true, message: text, conversation: conv };
}

/**
 * @param {string} monday
 * @param {string} proposalId
 * @returns {Promise<Conversation>}
 */
export async function rejectProposal(monday, proposalId) {
  const conv = await getConversation(monday);
  const proposal = conv.proposals.find((p) => p.id === proposalId);
  if (proposal && proposal.status === 'pending') {
    proposal.status = 'rejected';
    conv.messages.push(message('assistant', 'Proposition annulée : votre planning n’a pas changé.', 'engine', null));
    conv.pendingEvents.push(`Le client a refusé la proposition « ${proposal.summary} ».`);
    await saveConversation(conv);
  }
  return conv;
}

/**
 * Historique des changements acceptes d'une semaine (du plus recent au plus ancien).
 * @param {string} monday
 * @returns {Promise<HistoryEntry[]>}
 */
export async function weekHistory(monday) {
  return (await getHistory()).filter((h) => h.week === monday).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Annule un changement : les repas touches retrouvent leur etat d'avant.
 * Un repas modifie a la main depuis n'est pas ecrase : il est signale.
 * @param {string} historyId
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function undoChange(historyId) {
  const entry = /** @type {HistoryEntry | undefined} */ (await historyStore.get(historyId));
  if (!entry || entry.undone) return { ok: false, message: 'Ce changement a déjà été annulé.' };
  const [meals, budget] = await Promise.all([getMeals(), getBudget()]);
  const current = new Map(meals.map((m) => [m.id, m]));
  const afterById = new Map(entry.after.meals.map((m) => [m.id, m]));
  /** @type {string[]} */
  const skipped = [];
  for (const id of entry.touchedMealIds) {
    const now = current.get(id);
    const expected = afterById.get(id);
    const changedSince = expected ? JSON.stringify(now) !== JSON.stringify(expected) : now !== undefined;
    if (changedSince) {
      skipped.push(now?.recipeName ?? expected?.recipeName ?? id);
      continue;
    }
    const before = entry.before.meals.find((m) => m.id === id);
    if (before) await putMeal(before);
    else await deleteMealRecord(id);
  }
  if (budget.weeklyCents !== entry.before.weeklyBudgetCents) await saveBudget({ ...budget, weeklyCents: entry.before.weeklyBudgetCents });
  await saveDriveSettings({ preferredProducts: entry.before.preferredProducts });
  await historyStore.put({ ...entry, undone: true });
  return {
    ok: true,
    message: skipped.length ? `Changement annulé, sauf pour ${skipped.join(', ')} (modifié depuis).` : `Changement « ${entry.summary} » annulé.`,
  };
}

/**
 * Annule le dernier changement accepte de la semaine.
 * @param {string} monday
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function undoLast(monday) {
  const last = (await weekHistory(monday)).find((h) => !h.undone);
  return last ? undoChange(last.id) : { ok: false, message: 'Aucun changement de l’assistant à annuler cette semaine.' };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/** @returns {Promise<Preference[]>} */
export { getPreferences };

/**
 * Remplace toute la memoire des preferences.
 * @param {Preference[]} prefs
 * @returns {Promise<void>}
 */
export async function savePreferences(prefs) {
  const existing = await getPreferences();
  const ids = new Set(prefs.map((p) => p.id));
  for (const p of existing) if (!ids.has(p.id)) await preferenceStore.delete(p.id);
  for (const p of prefs) await preferenceStore.put(p);
}

/**
 * @param {Preference} pref
 * @returns {Promise<void>}
 */
export async function savePreference(pref) {
  await preferenceStore.put(pref);
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deletePreference(id) {
  return preferenceStore.delete(id);
}
