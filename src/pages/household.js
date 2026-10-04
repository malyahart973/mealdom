import { escapeHtml } from '../utils/html.js';
import { checkboxesHtml, checkedValues } from '../utils/forms.js';
import { formatNumber } from '../utils/format.js';
import { ALLERGENS } from '../domain/ingredients/allergens.js';
import { EQUIPMENT } from '../domain/recipes/equipment.js';
import { DIETS, GOALS } from '../domain/household/household.js';
import { getHousehold, saveEquipment, saveGoals, saveCoefficient } from '../services/householdService.js';

/** @typedef {import('../domain/household/household.js').Member} Member */
/** @typedef {import('../domain/household/household.js').Household} Household */

const allergenLabels = new Map(ALLERGENS.map((a) => [a.id, a.label.toLowerCase()]));
const dietLabels = new Map(DIETS.map((d) => [d.id, d.label.toLowerCase()]));

/**
 * Resume d'un membre : "Adulte, végétarien, allergies : lait".
 * @param {Member} member
 * @param {Household} household
 * @returns {string}
 */
function memberSummary(member, household) {
  const parts = [household.portionRules.find((r) => r.category === member.category)?.label ?? member.category];
  if (member.diet) parts.push(dietLabels.get(member.diet) ?? member.diet);
  if (member.allergens.length) {
    parts.push(`allergies : ${member.allergens.map((a) => allergenLabels.get(a) ?? a).join(', ')}`);
  }
  return parts.join(', ');
}

/**
 * Ecran "Mon foyer".
 * @param {HTMLElement} el
 */
export async function renderHousehold(el) {
  const household = await getHousehold();
  const child = household.portionRules.find((r) => r.category === 'child');

  el.innerHTML = `
    <section>
      <h1 class="page-title">Mon foyer</h1>
      <p class="hint">Ces informations restent sur cet appareil. Elles servent à proposer des recettes qui conviennent à tout le monde.</p>

      <h2>Personnes</h2>
      ${
        household.members.length
          ? `<ul class="link-list">${household.members
              .map(
                (m) => `<li><a href="#/foyer/personne/${encodeURIComponent(m.id)}">${escapeHtml(m.name)}<span>${escapeHtml(
                  memberSummary(m, household),
                )}</span></a></li>`,
              )
              .join('')}</ul>`
          : '<p>Aucune personne pour l’instant. Ajoutez chaque membre du foyer avec ses allergies et son régime.</p>'
      }
      <p class="actions"><a class="button" href="#/foyer/personne/nouvelle">Ajouter une personne</a></p>

      <h2>Équipement de cuisine</h2>
      <p class="hint">Les recettes qui demandent un matériel non coché ne seront pas proposées.</p>
      <fieldset class="checks" data-group="equipment">
        <legend class="visually-hidden">Équipement de cuisine</legend>
        ${checkboxesHtml('equipment', EQUIPMENT, household.equipment)}
      </fieldset>
      <p class="status" data-status="equipment" aria-live="polite"></p>

      ${
        child
          ? `<h2>Portions</h2>
      <form class="inline-form" data-form="coefficient" novalidate>
        <label for="child-coefficient">Une portion enfant représente combien de portion adulte ?</label>
        <div class="inline-form__row">
          <input id="child-coefficient" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(formatNumber(child.coefficient))}" />
          <button type="submit" class="button button--small">Enregistrer</button>
        </div>
        <p class="hint">Par défaut : ${escapeHtml(formatNumber(0.5))}. Un adolescent peut manger autant qu’un adulte : comptez-le alors comme adulte.</p>
        <p class="status" data-status="coefficient" aria-live="polite"></p>
      </form>`
          : ''
      }

      <h2>Objectifs</h2>
      <p class="hint">Ils guideront les suggestions dans les prochaines versions.</p>
      <fieldset class="checks" data-group="goals">
        <legend class="visually-hidden">Objectifs</legend>
        ${checkboxesHtml('goals', GOALS, household.goals)}
      </fieldset>
      <p class="status" data-status="goals" aria-live="polite"></p>
    </section>
  `;

  /**
   * @param {string} key
   * @param {string} text
   */
  const setStatus = (key, text) => {
    const status = el.querySelector(`[data-status="${key}"]`);
    if (status) status.textContent = text;
  };

  el.querySelector('[data-group="equipment"]')?.addEventListener('change', async () => {
    await saveEquipment(checkedValues(el, 'equipment'));
    setStatus('equipment', 'Équipement enregistré.');
  });
  el.querySelector('[data-group="goals"]')?.addEventListener('change', async () => {
    await saveGoals(checkedValues(el, 'goals'));
    setStatus('goals', 'Objectifs enregistrés.');
  });
  el.querySelector('[data-form="coefficient"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement} */ (el.querySelector('#child-coefficient'));
    const value = input.value.trim().replace(',', '.');
    const error = await saveCoefficient('child', value === '' ? Number.NaN : Number(value));
    setStatus('coefficient', error ?? 'Portion enfant enregistrée.');
  });
}
