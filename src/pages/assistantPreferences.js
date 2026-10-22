import { escapeHtml } from '../utils/html.js';
import { MODES } from '../domain/assistant/intent.js';
import { LEARN_THRESHOLD } from '../domain/assistant/preferences.js';
import { getPreferences, savePreference, deletePreference } from '../services/assistantService.js';
import { CUISINES } from '../data/cuisines.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { FOOD_FAMILIES } from '../domain/assistant/intent.js';

/** @typedef {import('../domain/assistant/preferences.js').Preference} Preference */

const nameIndex = buildNameIndex(INGREDIENTS);

/**
 * Ecran des preferences retenues par l'assistant : consultation et modification.
 * @param {HTMLElement} el
 */
export async function renderAssistantPreferences(el) {
  const prefs = (await getPreferences()).sort((a, b) => Number(b.active) - Number(a.active) || b.count - a.count);
  el.innerHTML = `
    <section>
      <h1 class="page-title">Préférences de l’assistant</h1>
      <p>L’assistant retient ce que vous demandez souvent : une demande acceptée ${LEARN_THRESHOLD} fois devient une préférence appliquée à vos prochains plannings. Dites « retiens que… » pour l’enregistrer tout de suite. Vous gardez la main ici.</p>
      <div class="alert" role="alert" hidden></div>
      ${
        prefs.length
          ? `<ul class="shop">${prefs
              .map(
                (p) => `<li>
            <label class="check"><input type="checkbox" data-toggle="${escapeHtml(p.id)}"${p.active ? ' checked' : ''} />
              <span><strong>${escapeHtml(p.label)}</strong>
              <span class="hint">${p.source === 'explicit' ? 'Demandée explicitement' : `Apprise (${p.count} demande${p.count > 1 ? 's' : ''} acceptée${p.count > 1 ? 's' : ''})`}${p.active ? '' : p.source === 'learned' && p.count < LEARN_THRESHOLD ? ' · en cours d’apprentissage' : ' · désactivée'}</span></span></label>
            <button type="button" class="icon-button" data-remove="${escapeHtml(p.id)}" aria-label="Supprimer cette préférence">×</button>
          </li>`,
              )
              .join('')}</ul>`
          : '<p class="empty">Aucune préférence pour l’instant.</p>'
      }

      <h2>Ajouter une préférence</h2>
      <form class="stock-form" data-form="pref" novalidate>
        <div class="field">
          <label for="pref-kind">Type</label>
          <select id="pref-kind">
            <option value="mode">Objectif</option>
            <option value="cuisine">Cuisine</option>
            <option value="avoid">Aliment à éviter</option>
            <option value="max_minutes">Temps maximum</option>
          </select>
        </div>
        <div class="field" data-for="mode"><label for="pref-mode">Objectif</label>
          <select id="pref-mode">${MODES.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('')}</select></div>
        <div class="field" data-for="cuisine" hidden><label for="pref-cuisine">Cuisine</label>
          <select id="pref-cuisine">${CUISINES.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('')}</select></div>
        <div class="field" data-for="avoid" hidden><label for="pref-avoid">Aliment ou famille (ex. porc, poisson, coriandre)</label>
          <input id="pref-avoid" type="text" list="pref-avoid-list" autocomplete="off" />
          <datalist id="pref-avoid-list">${FOOD_FAMILIES.map((f) => `<option value="${escapeHtml(f.label)}"></option>`).join('')}${INGREDIENTS.filter((i) => !i.notPurchased).map((i) => `<option value="${escapeHtml(i.name)}"></option>`).join('')}</datalist></div>
        <div class="field" data-for="max_minutes" hidden><label for="pref-minutes">Minutes maximum</label>
          <input id="pref-minutes" type="text" inputmode="numeric" value="30" /></div>
        <button type="submit" class="button">Ajouter</button>
      </form>
    </section>`;

  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  const kind = /** @type {HTMLSelectElement} */ (el.querySelector('#pref-kind'));
  const showFields = () => {
    for (const f of el.querySelectorAll('[data-for]')) /** @type {HTMLElement} */ (f).hidden = f.getAttribute('data-for') !== kind.value;
  };
  kind.addEventListener('change', showFields);

  el.querySelectorAll('[data-toggle]').forEach((input) =>
    input.addEventListener('change', async () => {
      const pref = prefs.find((p) => p.id === input.getAttribute('data-toggle'));
      if (!pref) return;
      await savePreference({ ...pref, active: /** @type {HTMLInputElement} */ (input).checked, updatedAt: new Date().toISOString() });
      await renderAssistantPreferences(el);
    }),
  );
  el.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', async () => {
      await deletePreference(b.getAttribute('data-remove') ?? '');
      await renderAssistantPreferences(el);
    }),
  );
  el.querySelector('[data-form="pref"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const now = new Date().toISOString();
    /** @type {Preference | null} */
    let pref = null;
    if (kind.value === 'mode') {
      const value = /** @type {HTMLSelectElement} */ (el.querySelector('#pref-mode')).value;
      pref = { id: `mode:${value}`, kind: 'mode', value, label: MODES.find((m) => m.id === value)?.label ?? value, source: 'explicit', count: 1, active: true, updatedAt: now };
    } else if (kind.value === 'cuisine') {
      const value = /** @type {HTMLSelectElement} */ (el.querySelector('#pref-cuisine')).value;
      pref = { id: `cuisine:${value}`, kind: 'cuisine', value, label: `Cuisine ${(CUISINES.find((c) => c.id === value)?.label ?? value).toLowerCase()}`, source: 'explicit', count: 1, active: true, updatedAt: now };
    } else if (kind.value === 'avoid') {
      const text = /** @type {HTMLInputElement} */ (el.querySelector('#pref-avoid')).value.trim();
      const family = FOOD_FAMILIES.find((f) => f.label === text);
      const id = family ? family.category : findIngredientId(text, nameIndex);
      if (!id) {
        alertBox.hidden = false;
        alertBox.textContent = 'Aliment inconnu : choisissez-le dans la liste.';
        return;
      }
      pref = { id: `avoid:${id}`, kind: 'avoid', value: id, label: `Éviter : ${family?.label ?? text}`, source: 'explicit', count: 1, active: true, updatedAt: now };
    } else {
      const minutes = Number(/** @type {HTMLInputElement} */ (el.querySelector('#pref-minutes')).value);
      if (!Number.isInteger(minutes) || minutes < 10 || minutes > 240) {
        alertBox.hidden = false;
        alertBox.textContent = 'Indiquez un nombre de minutes entre 10 et 240.';
        return;
      }
      pref = { id: 'max_minutes', kind: 'max_minutes', value: String(minutes), label: `${minutes} minutes maximum`, source: 'explicit', count: 1, active: true, updatedAt: now };
    }
    await savePreference(pref);
    await renderAssistantPreferences(el);
  });
}
