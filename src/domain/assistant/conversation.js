/**
 * Conversation avec l'assistant, liee a une semaine du planning.
 */

/** @typedef {import('./intent.js').Request} Request */
/** @typedef {import('./proposal.js').Proposal} Proposal */
/** @typedef {import('./proposal.js').Operation} Operation */
/** @typedef {import('./proposal.js').PlanDiff} PlanDiff */
/** @typedef {import('../drive/quote.js').QuoteComparison} QuoteComparison */
/** @typedef {import('../planning/planning.js').Meal} Meal */

/**
 * Message affiche dans la conversation.
 * @typedef {Object} ChatMessage
 * @property {string} id
 * @property {'user' | 'assistant'} role
 * @property {string} text
 * @property {'ai' | 'engine' | null} source      Qui a repondu : le modele IA ou le moteur local
 * @property {string | null} proposalId
 * @property {string} createdAt
 */

/**
 * Bilan d'une proposition, calcule par l'application (jamais par le modele).
 * @typedef {Object} ProposalReview
 * @property {Operation[]} applied
 * @property {string[]} errors
 * @property {PlanDiff} diff
 * @property {{ beforeCents: number, afterCents: number, comparison: QuoteComparison, missingBefore: number, missingAfter: number, verifiedShareAfter: number, savingCents: number }} cost
 * @property {{ weeklyBudgetCents: number | null, afterBudgetCents: number | null }} budget
 * @property {{ before: number | null, after: number | null } | null} kcalPerPortion   Moyenne des repas modifies
 * @property {boolean} bigChange          Variation importante : nouvelle confirmation demandee
 * @property {string} computedAt
 */

/**
 * @typedef {Proposal & { review: ProposalReview | null, request?: Request | null, seen?: Record<string, string[]> }} StoredProposal
 *   seen : recettes deja montrees par creneau (« date|creneau »), pour que « Changer » propose toujours autre chose
 */

/**
 * @typedef {Object} Conversation
 * @property {string} week                  Lundi de la semaine
 * @property {ChatMessage[]} messages
 * @property {unknown[]} apiMessages        Historique complet envoye au modele (blocs inchanges)
 * @property {StoredProposal[]} proposals
 * @property {Request | null} context       Derniere demande comprise (pour les demandes successives)
 * @property {string[]} pendingEvents       Evenements a signaler au modele au prochain message
 * @property {string} updatedAt
 */

/**
 * Changement accepte, conserve pour pouvoir l'annuler.
 * @typedef {Object} HistoryEntry
 * @property {string} id
 * @property {string} week
 * @property {string} proposalId
 * @property {string} summary
 * @property {string} createdAt
 * @property {{ meals: Meal[], weeklyBudgetCents: number | null, preferredProducts: Record<string, string> }} before   Etat des repas touches
 * @property {{ meals: Meal[], removedMealIds: string[] }} after
 * @property {string[]} touchedMealIds
 * @property {boolean} undone
 */

/**
 * @param {string} week
 * @param {string} nowIso
 * @returns {Conversation}
 */
export function createConversation(week, nowIso) {
  return { week, messages: [], apiMessages: [], proposals: [], context: null, pendingEvents: [], updatedAt: nowIso };
}

/** Une variation de plus de 15 % du total (ou de 15 €) demande une nouvelle confirmation. */
export const BIG_CHANGE_RATIO = 0.15;
export const BIG_CHANGE_CENTS = 1500;

/**
 * La variation de cout est-elle importante ?
 * @param {number} beforeCents
 * @param {number} afterCents
 * @returns {boolean}
 */
export function isBigChange(beforeCents, afterCents) {
  const delta = Math.abs(afterCents - beforeCents);
  return delta >= BIG_CHANGE_CENTS || (beforeCents > 0 && delta / beforeCents > BIG_CHANGE_RATIO);
}
