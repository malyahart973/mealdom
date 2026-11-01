import { APP_VERSION } from '../config.js';
import { escapeHtml } from '../utils/html.js';
import { formatIsoDate } from '../utils/format.js';
import { exportData, getLastExportDate, readBackup, applyBackup } from '../services/backupService.js';
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
      <p class="form-actions">
        <button type="button" class="button" data-action="export">Exporter mes données</button>
        <label for="restore-file" class="button button--secondary">Restaurer une sauvegarde</label>
      </p>
      <input id="restore-file" type="file" accept=".json,application/json" class="visually-hidden" />
      <p class="hint">Sur téléphone, le menu de partage s’ouvre : choisissez « Enregistrer dans Fichiers » (iCloud Drive) ou Google Drive pour garder la sauvegarde hors du téléphone. Sur ordinateur, elle va dans les téléchargements. La clé de l’assistant IA n’y figure jamais. « Restaurer » remet les données d’un fichier exporté (nouveau téléphone, autre navigateur…) à la place de celles de cet appareil.</p>
      <p class="alert" role="alert" data-restore-alert hidden></p>
      <p class="status" role="status" data-restore-status></p>

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
      <p class="hint">Le bouton micro de l’assistant utilise la reconnaissance vocale de votre téléphone ou navigateur (Google ou Apple) : votre voix est traitée par ce service, puis le texte reste modifiable avant l’envoi. Vous pouvez aussi utiliser le micro du clavier.</p>
      <p><a href="#/assistant/preferences">Préférences retenues par l’assistant</a></p>
    </section>
  `;

  el.querySelector('[data-action="export"]')?.addEventListener('click', async () => {
    const result = await exportData();
    await renderSettings(el);
    /** @type {HTMLElement} */ (el.querySelector('[data-restore-status]')).textContent =
      result === 'shared' ? 'Sauvegarde partagée.' : result === 'downloaded' ? 'Sauvegarde enregistrée dans les téléchargements.' : 'Export annulé : rien n’a été sauvegardé.';
  });
  el.querySelector('#restore-file')?.addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const alertBox = /** @type {HTMLElement} */ (el.querySelector('[data-restore-alert]'));
    const status = /** @type {HTMLElement} */ (el.querySelector('[data-restore-status]'));
    alertBox.hidden = true;
    const read = await readBackup(file);
    if (!read.ok) {
      alertBox.textContent = read.error;
      alertBox.hidden = false;
      return;
    }
    const { counts, exportDate, applicationVersion } = read.plan;
    const content = [`${counts.meals} repas`, `${counts.weights} pesée(s)`, `${counts.recipes} recette(s) personnelle(s)`, `${counts.prices} prix relevé(s)`].join(', ');
    const ok = window.confirm(
      `Restaurer la sauvegarde du ${formatIsoDate(exportDate) ?? exportDate} (MealDom ${applicationVersion}) : ${content} ?\n\nLes données actuelles de cet appareil seront remplacées. Pour les garder, annulez et exportez-les d’abord.`,
    );
    if (!ok) return;
    try {
      await applyBackup(read.plan);
    } catch {
      alertBox.textContent = 'La restauration a échoué : rien n’a été modifié.';
      alertBox.hidden = false;
      return;
    }
    status.textContent = 'Sauvegarde restaurée. L’application redémarre…';
    // Recharger : les recettes personnelles et les reglages sont relus au demarrage.
    setTimeout(() => window.location.reload(), 800);
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
