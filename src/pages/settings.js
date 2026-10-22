import { APP_VERSION } from '../config.js';
import { escapeHtml } from '../utils/html.js';
import { formatIsoDate } from '../utils/format.js';
import { exportData, getLastExportDate } from '../services/backupService.js';
import { getPersistenceStatus } from '../services/storage.js';
import { getAssistantSettings, saveAssistantSettings } from '../services/assistantService.js';
import { DEFAULT_MODEL } from '../services/llmService.js';

/** @type {Record<string, string>} */
const PERSISTENCE_LABELS = {
  granted: 'Oui',
  denied: 'Non, le navigateur peut les effacer si la place manque',
  unsupported: 'Non pris en charge par ce navigateur',
};

/**
 * Ecran Parametres.
 * @param {HTMLElement} el
 */
export async function renderSettings(el) {
  const [lastExport, persistence, ai] = await Promise.all([getLastExportDate(), getPersistenceStatus(), getAssistantSettings()]);
  const lastExportLabel = lastExport ? formatIsoDate(lastExport) ?? 'date inconnue' : 'jamais';

  el.innerHTML = `
    <section>
      <h1 class="page-title">Paramètres</h1>
      <h2>Données</h2>
      <dl class="facts">
        <div><dt>Dernière sauvegarde</dt><dd>${escapeHtml(lastExportLabel)}</dd></div>
        <div><dt>Données protégées contre l'effacement</dt><dd>${escapeHtml(PERSISTENCE_LABELS[persistence])}</dd></div>
        <div><dt>Version</dt><dd>${escapeHtml(APP_VERSION)}</dd></div>
      </dl>
      <button type="button" class="button" data-action="export">Exporter mes données</button>
      <p class="hint">Le fichier exporté se trouve ensuite dans vos téléchargements. Gardez-le en lieu sûr. La clé de l’assistant IA n’y figure jamais.</p>

      <h2>Assistant IA</h2>
      <p>Sans clé, l’assistant fonctionne avec le moteur de l’application, même hors ligne : il comprend les demandes courantes et prépare des propositions. Avec une clé API Anthropic (Claude), il comprend les demandes plus libres et explique davantage ses choix.</p>
      <p class="hint">Avec l’IA, vos demandes et les informations utiles du planning (repas, contraintes du foyer, prix enregistrés) sont envoyées à Anthropic pour être traitées. Chaque message est facturé sur votre compte Anthropic : fixez une limite de dépenses dans la console Anthropic. La clé reste uniquement sur cet appareil.</p>
      <div class="alert" role="alert" hidden></div>
      <form class="stock-form" data-form="ai" novalidate>
        <label class="check"><input type="checkbox" name="useAi"${ai.useAi ? ' checked' : ''} /> <span>Utiliser l’IA quand une clé est enregistrée et qu’Internet est disponible</span></label>
        <div class="field">
          <label for="ai-key">Clé API Anthropic ${ai.hasKey ? '(enregistrée)' : ''}</label>
          <input id="ai-key" name="apiKey" type="password" autocomplete="off" placeholder="${ai.hasKey ? 'Laisser vide pour garder la clé actuelle' : 'sk-ant-…'}" />
        </div>
        <div class="field">
          <label for="ai-model">Modèle</label>
          <input id="ai-model" name="model" type="text" autocomplete="off" value="${escapeHtml(ai.model)}" />
          <p class="hint">Par défaut : ${escapeHtml(DEFAULT_MODEL)}.</p>
        </div>
        <div class="form-actions">
          <button type="submit" class="button">Enregistrer</button>
          ${ai.hasKey ? '<button type="button" class="button button--danger" data-action="forget-key">Supprimer la clé</button>' : ''}
        </div>
      </form>
      <p><a href="#/assistant/preferences">Préférences retenues par l’assistant</a></p>
    </section>
  `;

  el.querySelector('[data-action="export"]')?.addEventListener('click', async () => {
    await exportData();
    await renderSettings(el);
  });
  const form = /** @type {HTMLFormElement} */ (el.querySelector('[data-form="ai"]'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = /** @type {HTMLInputElement} */ (form.elements.namedItem('apiKey')).value.trim();
    const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
    if (key && !key.startsWith('sk-ant-')) {
      alertBox.hidden = false;
      alertBox.textContent = 'Cette clé ne ressemble pas à une clé Anthropic (elle commence par « sk-ant- »).';
      return;
    }
    await saveAssistantSettings({
      useAi: /** @type {HTMLInputElement} */ (form.elements.namedItem('useAi')).checked,
      model: /** @type {HTMLInputElement} */ (form.elements.namedItem('model')).value,
      ...(key ? { apiKey: key } : {}),
    });
    await renderSettings(el);
  });
  el.querySelector('[data-action="forget-key"]')?.addEventListener('click', async () => {
    await saveAssistantSettings({ apiKey: null });
    await renderSettings(el);
  });
}
