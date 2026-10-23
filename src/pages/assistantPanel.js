import { escapeHtml } from '../utils/html.js';
import { isSpeechAvailable, startDictation } from '../utils/speech.js';
import { formatIsoDay, formatNumber } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { formatCents } from '../domain/budget/money.js';
import { SLOTS } from '../domain/planning/planning.js';
import { roundUpQuantity } from '../domain/units/units.js';
import { ingredientsById } from '../services/catalog.js';
import {
  getConversation,
  sendMessage,
  acceptProposal,
  rejectProposal,
  weekHistory,
  undoChange,
  getAssistantSettings,
  clearConversation,
} from '../services/assistantService.js';

/** @typedef {import('../domain/assistant/conversation.js').Conversation} Conversation */
/** @typedef {import('../domain/assistant/conversation.js').StoredProposal} StoredProposal */
/** @typedef {import('../domain/assistant/conversation.js').ProposalReview} ProposalReview */

const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label.toLowerCase()]));

/** Exemples de demandes proposes au client. */
export const SUGGESTIONS = [
  'Fais-moi le planning de la semaine',
  'Plus de recettes asiatiques',
  'Une semaine légère pour mon programme',
  'Je veux privilégier les produits en promotion',
  'Rends les repas plus gourmands',
  'Ajuste les courses à mon budget',
  'Réduis mon budget de 15 %',
  'Je veux manger plus de légumes',
  'Des repas en moins de 30 minutes',
  'Remplace le poisson de mardi par du poulet',
  'Prévois un repas convivial pour samedi soir',
  'Utilise les restes du repas précédent',
  'Je reçois quatre personnes supplémentaires dimanche',
  'Garde les mêmes repas, mais propose des ingrédients de meilleure qualité',
  'Peu de vaisselle cette semaine',
  'Annule la dernière modification',
];

const reliabilityLabels = {
  verified: 'Prix Drive vérifiés',
  estimated: 'Estimation',
  not_comparable: 'Comparaison impossible',
};

/**
 * Montant signe : « +2,40 € », « −5,30 € ».
 * @param {number} cents
 * @returns {string}
 */
function signed(cents) {
  return `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${formatCents(Math.abs(cents))}`;
}

/**
 * @param {string} ingredientId
 * @returns {string}
 */
function ingredientName(ingredientId) {
  return ingredientsById.get(ingredientId)?.name ?? ingredientId;
}

/**
 * Apercu d'une proposition : modifications, raisons, cout, budget, quantites, compromis.
 * @param {StoredProposal} proposal
 * @param {string} monday
 * @returns {string}
 */
function reviewHtml(proposal, monday) {
  const review = /** @type {ProposalReview} */ (proposal.review);
  const c = review.cost;
  const reasons = proposal.operations.map((o) => o.reason).filter((r, i, all) => r && all.indexOf(r) === i);
  const status = {
    pending: '',
    accepted: '<p class="badge badge--ok">Acceptée</p>',
    rejected: '<p class="badge">Annulée</p>',
    expired: '<p class="badge">Remplacée par une proposition plus récente</p>',
  }[proposal.status];
  const remaining = review.budget.afterBudgetCents !== null ? review.budget.afterBudgetCents - c.afterCents : null;
  const qty = (/** @type {number | null} */ q, /** @type {string} */ unit) => (q === null ? '' : formatQuantity(roundUpQuantity(q, unit), unit));
  return `
    <article class="proposal" data-proposal="${escapeHtml(proposal.id)}">
      <header class="proposal__head">
        <h3>${escapeHtml(proposal.summary)}</h3>
        <p class="hint">${proposal.author === 'ai' ? 'Proposé par l’IA, vérifié et chiffré par l’application' : 'Proposé et chiffré par l’application'}</p>
        ${status}
      </header>

      <h4>Modifications</h4>
      <ul class="proposal__changes">
        ${review.diff.meals
          .map(
            (m) => `<li><strong>${escapeHtml(formatIsoDay(m.date))}, ${escapeHtml(slotLabels.get(m.slot) ?? m.slot)}</strong> :
              ${m.before && m.after && m.before !== m.after ? `${escapeHtml(m.before)} → <strong>${escapeHtml(m.after)}</strong>` : ''}
              ${!m.before && m.after ? `ajout de <strong>${escapeHtml(m.after)}</strong>` : ''}
              ${m.before && !m.after ? `<strong>${escapeHtml(m.before)}</strong> retiré` : ''}
              ${m.before && m.after && m.before === m.after ? escapeHtml(m.before) : ''}
              ${m.detail ? `<span class="hint">(${escapeHtml(m.detail)})</span>` : ''}</li>`,
          )
          .join('')}
        ${proposal.operations
          .filter((o) => o.type === 'set_weekly_budget' || o.type === 'choose_product')
          .map((o) =>
            o.type === 'set_weekly_budget'
              ? `<li>Budget de la semaine : <strong>${escapeHtml(formatCents(o.cents))}</strong></li>`
              : o.type === 'choose_product'
                ? `<li>Produit Drive pour ${escapeHtml(ingredientName(o.ingredientId))} : ${escapeHtml(o.reason)}</li>`
                : '',
          )
          .join('')}
      </ul>
      ${reasons.length ? `<h4>Pourquoi</h4><ul class="proposal__reasons">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}

      <h4>Courses de la semaine</h4>
      <dl class="budget-card proposal__cost">
        <div><dt>Avant</dt><dd>${escapeHtml(formatCents(c.beforeCents))}</dd></div>
        <div><dt>Après</dt><dd>${escapeHtml(formatCents(c.afterCents))}</dd></div>
        <div class="${c.comparison.deltaCents !== null && c.comparison.deltaCents > 0 ? 'over' : ''}"><dt>Écart</dt><dd>${c.comparison.deltaCents === null ? '—' : escapeHtml(signed(c.comparison.deltaCents))}</dd></div>
        ${remaining !== null ? `<div class="${remaining < 0 ? 'over' : ''}"><dt>Reste sur le budget</dt><dd>${escapeHtml(signed(remaining).replace('+', ''))}</dd></div>` : ''}
      </dl>
      <p><span class="badge badge--${c.comparison.level}">${escapeHtml(reliabilityLabels[c.comparison.level])}</span> ${escapeHtml(c.comparison.explanation)}</p>
      ${c.savingCents > 0 ? `<p>Dont promotions appliquées : ${escapeHtml(formatCents(c.savingCents))}.</p>` : ''}
      ${c.missingAfter > 0 ? `<p class="hint">${c.missingAfter} article(s) sans prix connu : ils ne sont pas comptés.</p>` : ''}

      <h4>Quantités</h4>
      <p>Portions cuisinées dans la semaine : ${escapeHtml(formatNumber(review.diff.portions.before))} → ${escapeHtml(formatNumber(review.diff.portions.after))}.
      ${review.kcalPerPortion && review.kcalPerPortion.before !== null && review.kcalPerPortion.after !== null ? ` Calories moyennes par portion des repas modifiés : ${review.kcalPerPortion.before} → ${review.kcalPerPortion.after} kcal.` : ''}</p>
      ${
        review.diff.added.length || review.diff.removed.length || review.diff.changed.length
          ? `<details class="proposal__ingredients"><summary>Ingrédients : ${review.diff.added.length} ajouté(s), ${review.diff.removed.length} retiré(s), ${review.diff.changed.length} quantité(s) modifiée(s)</summary>
              <ul>
                ${review.diff.added.map((a) => `<li>+ ${escapeHtml(ingredientName(a.ingredientId))} ${escapeHtml(qty(a.after, a.unit))}</li>`).join('')}
                ${review.diff.removed.map((a) => `<li>− ${escapeHtml(ingredientName(a.ingredientId))} ${escapeHtml(qty(a.before, a.unit))}</li>`).join('')}
                ${review.diff.changed.map((a) => `<li>${escapeHtml(ingredientName(a.ingredientId))} : ${escapeHtml(qty(a.before, a.unit))} → ${escapeHtml(qty(a.after, a.unit))}</li>`).join('')}
              </ul></details>`
          : ''
      }
      ${proposal.notes.length ? `<h4>À savoir</h4><ul class="proposal__notes">${proposal.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}

      ${
        proposal.status === 'pending'
          ? `<div class="proposal__actions">
              ${review.bigChange ? '<label class="check"><input type="checkbox" data-confirm-big /> <span>Changement important : je confirme l’avoir vérifié.</span></label>' : ''}
              <button type="button" class="button" data-accept="${escapeHtml(proposal.id)}"${review.bigChange ? ' disabled' : ''}>Accepter</button>
              <button type="button" class="button button--secondary" data-modify>Modifier</button>
              <button type="button" class="button button--danger" data-reject="${escapeHtml(proposal.id)}">Annuler</button>
            </div>
            <p class="hint">Accepter modifie le planning et la liste de courses. Aucune commande n’est passée : la commande Drive se valide séparément.</p>`
          : ''
      }
      <p class="proposal__links"><a href="#/courses/semaine/${monday}">Liste de courses</a> · <a href="#/drive/semaine/${monday}">Panier Drive</a></p>
    </article>`;
}

/**
 * @param {Conversation} conv
 * @param {string} monday
 * @returns {string}
 */
function chatHtml(conv, monday) {
  if (!conv.messages.length) {
    return `<li class="chat__msg chat__msg--assistant"><p>Bonjour ! Dites-moi librement ce que vous souhaitez changer : je propose, j’explique et je chiffre ; vous gardez la main pour accepter.</p></li>`;
  }
  const proposals = new Map(conv.proposals.map((p) => [p.id, p]));
  return conv.messages
    .map((m) => {
      const proposal = m.proposalId ? proposals.get(m.proposalId) : undefined;
      return `<li class="chat__msg chat__msg--${m.role}">
        ${m.text.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
        ${m.role === 'assistant' && m.source ? `<span class="chat__source">${m.source === 'ai' ? 'IA' : 'Moteur de l’application'}</span>` : ''}
        ${proposal && proposal.review ? reviewHtml(proposal, monday) : ''}
      </li>`;
    })
    .join('');
}

/**
 * Zone de conversation avec l'assistant, utilisable dans le planning ou en plein ecran.
 * @param {HTMLElement} root
 * @param {{ monday: string, focusIngredientId?: string | null, onPlanChange?: () => void, initialText?: string }} opts
 */
export async function mountAssistant(root, opts) {
  const { monday } = opts;
  const [conv, settings, history] = await Promise.all([getConversation(monday), getAssistantSettings(), weekHistory(monday)]);
  const mode = settings.useAi && settings.hasKey ? (navigator.onLine ? 'IA connectée' : 'Hors ligne : moteur de l’application') : 'Moteur de l’application (sans IA)';

  root.innerHTML = `
    <div class="assistant">
      <div class="assistant__head">
        <h2>Assistant de la semaine du ${escapeHtml(formatIsoDay(monday))}</h2>
        <p class="hint"><span class="badge">${escapeHtml(mode)}</span>
          <a href="#/assistant/preferences">Préférences retenues</a> · <a href="#/parametres">Réglages de l’IA</a></p>
      </div>
      <ol class="chat" aria-live="polite">${chatHtml(conv, monday)}</ol>
      <p class="chat__busy" role="status" hidden></p>
      <div class="alert" role="alert" hidden></div>
      <form class="chat__form" novalidate>
        <label for="chat-input" class="visually-hidden">Votre demande</label>
        <textarea id="chat-input" rows="2" maxlength="1000" placeholder="Ex. : des repas gourmands, en promotion, en moins de 30 minutes">${escapeHtml(opts.initialText ?? '')}</textarea>
        ${
          isSpeechAvailable()
            ? `<button type="button" class="button button--secondary chat__mic" data-mic aria-pressed="false" aria-label="Dicter ma demande" title="Dicter ma demande">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>
              </button>`
            : ''
        }
        <button type="submit" class="button">Envoyer</button>
      </form>
      <p class="hint chat__listening" role="status" hidden>J’écoute… Parlez, puis relisez avant d’envoyer.</p>
      <details class="chat__suggestions">
        <summary>Idées de demandes</summary>
        <div class="chips">${SUGGESTIONS.map((s) => `<button type="button" class="chip" data-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>
      </details>
      ${
        history.length
          ? `<details class="chat__history"><summary>Historique des changements (${history.length})</summary><ul class="shop">${history
              .map(
                (h) => `<li><span class="shop__item"><span>${escapeHtml(h.summary)}<span class="hint">${escapeHtml(new Date(h.createdAt).toLocaleString('fr-FR'))}${h.undone ? ' · annulé' : ''}</span></span></span>
                ${h.undone ? '' : `<button type="button" class="button button--small button--secondary" data-undo="${escapeHtml(h.id)}">Annuler ce changement</button>`}</li>`,
              )
              .join('')}</ul></details>`
          : ''
      }
      ${conv.messages.length ? '<p><button type="button" class="button button--small button--secondary" data-clear>Effacer la conversation</button></p>' : ''}
    </div>`;

  const chat = /** @type {HTMLElement} */ (root.querySelector('.chat'));
  const form = /** @type {HTMLFormElement} */ (root.querySelector('.chat__form'));
  const input = /** @type {HTMLTextAreaElement} */ (root.querySelector('#chat-input'));
  const busy = /** @type {HTMLElement} */ (root.querySelector('.chat__busy'));
  const alertBox = /** @type {HTMLElement} */ (root.querySelector('.alert'));
  const lastProposal = chat.querySelector('.proposal:last-of-type');
  (lastProposal ?? chat.lastElementChild)?.scrollIntoView({ block: 'nearest' });

  /** @param {string} text */
  const setBusy = (text) => {
    busy.hidden = !text;
    busy.textContent = text;
    for (const b of root.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (b).disabled = Boolean(text);
  };
  /** @param {string} text */
  const showError = (text) => {
    alertBox.hidden = !text;
    alertBox.textContent = text;
  };
  const refresh = async () => {
    await mountAssistant(root, { ...opts, initialText: '' });
  };

  /** @param {string} text */
  const send = async (text) => {
    if (!text.trim()) return;
    showError('');
    setBusy('Je réfléchis et je recalcule le budget…');
    try {
      await sendMessage(monday, text, { focusIngredientId: opts.focusIngredientId ?? null });
      if (/annule/i.test(text)) opts.onPlanChange?.();
      await refresh();
    } catch (error) {
      console.error(error);
      setBusy('');
      showError('La demande n’a pas pu être traitée. Réessayez.');
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send(input.value);
  });
  const mic = /** @type {HTMLButtonElement | null} */ (root.querySelector('[data-mic]'));
  const listening = /** @type {HTMLElement} */ (root.querySelector('.chat__listening'));
  /** @type {import('../utils/speech.js').SpeechHandle | null} */
  let dictation = null;
  mic?.addEventListener('click', () => {
    if (dictation) {
      dictation.stop();
      return;
    }
    const before = input.value.trim();
    showError('');
    dictation = startDictation({
      onText: (text) => {
        input.value = before ? `${before} ${text}` : text;
      },
      onEnd: (error) => {
        dictation = null;
        mic.setAttribute('aria-pressed', 'false');
        listening.hidden = true;
        if (error) showError(error);
        input.focus();
      },
    });
    if (dictation) {
      mic.setAttribute('aria-pressed', 'true');
      listening.hidden = false;
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(input.value);
    }
  });
  root.querySelectorAll('[data-suggest]').forEach((b) =>
    b.addEventListener('click', () => {
      input.value = b.getAttribute('data-suggest') ?? '';
      input.focus();
    }),
  );
  root.querySelector('[data-confirm-big]')?.addEventListener('change', (event) => {
    const accept = root.querySelector('.proposal [data-accept]');
    if (accept) /** @type {HTMLButtonElement} */ (accept).disabled = !(/** @type {HTMLInputElement} */ (event.target).checked);
  });
  root.querySelectorAll('[data-accept]').forEach((b) =>
    b.addEventListener('click', async () => {
      const big = /** @type {HTMLInputElement | null} */ (root.querySelector('[data-confirm-big]'));
      setBusy('Application des changements et recalcul du budget et du panier…');
      const result = await acceptProposal(monday, b.getAttribute('data-accept') ?? '', { confirmedBigChange: Boolean(big?.checked) });
      if (!result.ok) showError(result.message);
      opts.onPlanChange?.();
      await refresh();
      if (!result.ok) showError(result.message);
    }),
  );
  root.querySelectorAll('[data-reject]').forEach((b) =>
    b.addEventListener('click', async () => {
      await rejectProposal(monday, b.getAttribute('data-reject') ?? '');
      await refresh();
    }),
  );
  root.querySelector('[data-modify]')?.addEventListener('click', () => {
    input.value = 'Plutôt ';
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  root.querySelectorAll('[data-undo]').forEach((b) =>
    b.addEventListener('click', async () => {
      setBusy('Annulation du changement…');
      const result = await undoChange(b.getAttribute('data-undo') ?? '');
      opts.onPlanChange?.();
      await refresh();
      showError(result.ok ? '' : result.message);
      if (result.ok) {
        busy.hidden = false;
        busy.textContent = result.message;
      }
    }),
  );
  root.querySelector('[data-clear]')?.addEventListener('click', async () => {
    if (!window.confirm('Effacer la conversation de cette semaine ? Les changements acceptés restent dans le planning.')) return;
    await clearConversation(monday);
    await refresh();
  });
}
