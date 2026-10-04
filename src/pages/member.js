import { escapeHtml } from '../utils/html.js';
import { ALLERGENS, PRODUCT_LABEL_WARNING } from '../domain/ingredients/allergens.js';
import { DIETS } from '../domain/household/household.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { getHousehold, saveMember, deleteMember, newMemberId } from '../services/householdService.js';
import { checkboxesHtml, checkedValues } from '../utils/forms.js';

/** @typedef {import('../domain/household/household.js').Member} Member */
/** @typedef {import('../domain/household/household.js').Diet} Diet */

const nameIndex = buildNameIndex(INGREDIENTS);

/**
 * Ecran d'ajout ou de modification d'une personne du foyer.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderMember(el, params) {
  const household = await getHousehold();
  const isNew = params.id === 'nouvelle';
  const existing = household.members.find((m) => m.id === params.id);

  if (!isNew && !existing) {
    el.innerHTML = `<p>Cette personne n’existe plus.</p><p><a href="#/foyer">Retour au foyer</a></p>`;
    return;
  }

  /** @type {Member} */
  const member = existing
    ? structuredClone(existing)
    : { id: newMemberId(), name: '', category: 'adult', allergens: [], diet: null, dislikes: [] };

  const categories = household.portionRules.map((r) => ({ id: r.category, label: r.label }));
  const diets = [{ id: '', label: 'Aucun' }, ...DIETS.map((d) => ({ id: d.id, label: d.label }))];

  el.innerHTML = `
    <section>
      <h1 class="page-title">${isNew ? 'Ajouter une personne' : escapeHtml(member.name)}</h1>
      <div class="alert" role="alert" hidden></div>
      <form data-form="member" novalidate>
        <div class="field">
          <label for="member-name">Prénom ou surnom</label>
          <input id="member-name" type="text" maxlength="40" autocomplete="off" value="${escapeHtml(member.name)}" />
        </div>

        <fieldset class="field radios">
          <legend>Âge</legend>
          ${categories
            .map(
              (c) => `<label class="check"><input type="radio" name="category" value="${escapeHtml(c.id)}"${
                c.id === member.category ? ' checked' : ''
              } /> <span>${escapeHtml(c.label)}</span></label>`,
            )
            .join('')}
        </fieldset>

        <fieldset class="field radios">
          <legend>Régime</legend>
          ${diets
            .map(
              (d) => `<label class="check"><input type="radio" name="diet" value="${d.id}"${
                (member.diet ?? '') === d.id ? ' checked' : ''
              } /> <span>${escapeHtml(d.label)}</span></label>`,
            )
            .join('')}
        </fieldset>

        <fieldset class="field checks">
          <legend>Allergies et intolérances</legend>
          <p class="hint">Une recette qui contient l’un de ces allergènes ne sera jamais proposée au foyer.</p>
          ${checkboxesHtml('allergens', ALLERGENS, member.allergens)}
          <p class="hint">${escapeHtml(PRODUCT_LABEL_WARNING)}</p>
        </fieldset>

        <div class="field">
          <label for="dislike-input">Aliments refusés</label>
          <p class="hint">Les recettes qui en contiennent ne seront pas proposées au foyer.</p>
          <div class="inline-form__row">
            <input id="dislike-input" type="text" list="ingredient-names" autocomplete="off" placeholder="ex. courgette" />
            <button type="button" class="button button--small button--secondary" data-action="add-dislike">Ajouter</button>
          </div>
          <datalist id="ingredient-names">
            ${INGREDIENTS.filter((i) => !i.notPurchased)
              .map((i) => `<option value="${escapeHtml(i.name)}"></option>`)
              .join('')}
          </datalist>
          <p class="status" data-status="dislike" aria-live="polite"></p>
          <ul class="tokens" data-list="dislikes"></ul>
        </div>

        <div class="form-actions">
          <button type="submit" class="button">Enregistrer</button>
          ${isNew ? '' : '<button type="button" class="button button--danger" data-action="delete">Retirer cette personne</button>'}
        </div>
      </form>
    </section>
  `;

  const form = /** @type {HTMLFormElement} */ (el.querySelector('[data-form="member"]'));
  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  const dislikeInput = /** @type {HTMLInputElement} */ (el.querySelector('#dislike-input'));
  const dislikeStatus = /** @type {HTMLElement} */ (el.querySelector('[data-status="dislike"]'));
  const dislikeList = /** @type {HTMLElement} */ (el.querySelector('[data-list="dislikes"]'));

  const renderDislikes = () => {
    dislikeList.innerHTML = member.dislikes
      .map(
        (id) => `<li>${escapeHtml(ingredientsById.get(id)?.name ?? id)}
          <button type="button" data-remove="${escapeHtml(id)}" aria-label="Retirer ${escapeHtml(ingredientsById.get(id)?.name ?? id)}">×</button></li>`,
      )
      .join('');
  };

  const addDislike = () => {
    const text = dislikeInput.value.trim();
    if (!text) return;
    const id = findIngredientId(text, nameIndex);
    if (!id) {
      dislikeStatus.textContent = `« ${text} » n’est pas encore dans le catalogue des ingrédients. Choisissez un nom dans la liste.`;
      return;
    }
    if (!member.dislikes.includes(id)) member.dislikes.push(id);
    dislikeInput.value = '';
    dislikeStatus.textContent = '';
    renderDislikes();
  };

  el.querySelector('[data-action="add-dislike"]')?.addEventListener('click', addDislike);
  dislikeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDislike();
    }
  });
  dislikeList.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const id = target.getAttribute('data-remove');
    if (!id) return;
    member.dislikes = member.dislikes.filter((d) => d !== id);
    renderDislikes();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nameInput = /** @type {HTMLInputElement} */ (el.querySelector('#member-name'));
    const category = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="category"]:checked'));
    const diet = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="diet"]:checked'));
    member.name = nameInput.value;
    member.category = category?.value ?? '';
    member.diet = diet && diet.value ? /** @type {Diet} */ (diet.value) : null;
    member.allergens = checkedValues(form, 'allergens');

    const errors = await saveMember(member);
    if (errors.length > 0) {
      alertBox.hidden = false;
      alertBox.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
      alertBox.scrollIntoView({ block: 'center' });
      return;
    }
    window.location.replace('#/foyer');
  });

  el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!window.confirm(`Retirer ${member.name} du foyer ?`)) return;
    await deleteMember(member.id);
    window.location.replace('#/foyer');
  });

  renderDislikes();
}
