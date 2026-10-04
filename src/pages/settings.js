import { APP_VERSION } from '../config.js';
import { escapeHtml } from '../utils/html.js';
import { formatIsoDate } from '../utils/format.js';
import { exportData, getLastExportDate } from '../services/backupService.js';
import { getPersistenceStatus } from '../services/storage.js';

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
  const [lastExport, persistence] = await Promise.all([getLastExportDate(), getPersistenceStatus()]);
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
      <p class="hint">Le fichier exporté se trouve ensuite dans vos téléchargements. Gardez-le en lieu sûr.</p>
    </section>
  `;

  el.querySelector('[data-action="export"]')?.addEventListener('click', async () => {
    await exportData();
    await renderSettings(el);
  });
}
