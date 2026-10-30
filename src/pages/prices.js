import { escapeHtml } from '../utils/html.js';
import { formatIsoDayMonth, formatNumber } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { formatCents } from '../domain/budget/money.js';
import { PER_LABELS } from '../domain/stores/priceHistory.js';
import { ingredientsById } from '../services/catalog.js';
import { priceOverview, ingredientPriceHistory } from '../services/priceHistoryService.js';
import { drawPriceChart, MAX_SERIES } from './priceChart.js';

/** @param {string} id */
const nameOf = (id) => ingredientsById.get(id)?.name ?? id;

/** @param {number} pct */
const pctText = (pct) => `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${formatNumber(Math.abs(pct))} %`;

/**
 * Ecran Historique des prix : variations et produits suivis.
 * @param {HTMLElement} el
 */
export async function renderPriceOverview(el) {
  const { changes, tracked, count, storeNames } = await priceOverview();
  /** @param {(typeof changes)[number]} c */
  const line = (c) => `<li><a href="#/prix/${encodeURIComponent(c.ingredientId)}">
      <span class="recipe-list__name">${escapeHtml(nameOf(c.ingredientId))} <span class="change ${c.trend.changePct > 0 ? 'change--up' : 'change--down'}">${escapeHtml(pctText(c.trend.changePct))}</span></span>
      <span class="recipe-list__meta">${escapeHtml(storeNames.get(c.storeId) ?? 'Magasin')} : ${escapeHtml(formatCents(c.trend.first.unitCents))} → ${escapeHtml(formatCents(c.trend.last.unitCents))} ${escapeHtml(PER_LABELS[c.per])}, depuis le ${escapeHtml(formatIsoDayMonth(c.trend.first.date))}</span></a></li>`;
  const ups = changes.filter((c) => c.trend.changePct > 0).slice(0, 10);
  const downs = changes.filter((c) => c.trend.changePct < 0).sort((a, b) => a.trend.changePct - b.trend.changePct).slice(0, 10);
  const all = [...tracked].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  el.innerHTML = `
    <section>
      <h1 class="page-title">Historique des prix</h1>
      <p class="actions"><a class="button" href="#/prix/ajouter">Ajouter un prix ou scanner</a></p>
      <p class="hint">Chaque prix relevé (magasins, Drive, import) est conservé ici, ramené au kilo, au litre ou à la pièce pour comparer les formats. ${count} relevé(s) sur ${tracked.size} produit(s).</p>
      ${
        count === 0
          ? '<p class="empty">Aucun prix relevé pour l’instant. <a href="#/prix/ajouter">Ajoutez un prix</a> (scan du code-barres ou saisie) ou importez ceux du <a href="#/drive">Drive</a>.</p>'
          : `<h2>Plus fortes hausses</h2>
            ${ups.length ? `<ul class="recipe-list">${ups.map(line).join('')}</ul>` : '<p class="empty">Aucune hausse relevée.</p>'}
            <h2>Plus fortes baisses</h2>
            ${downs.length ? `<ul class="recipe-list">${downs.map(line).join('')}</ul>` : '<p class="empty">Aucune baisse relevée.</p>'}
            <h2>Produits suivis</h2>
            <ul class="recipe-list">${all.map((id) => `<li><a href="#/prix/${encodeURIComponent(id)}"><span class="recipe-list__name">${escapeHtml(nameOf(id))}</span></a></li>`).join('')}</ul>
            <p class="hint">Une variation ne se calcule qu’à partir de deux relevés du même magasin.</p>`
      }
    </section>`;
}

/**
 * Ecran Historique d'un produit : courbe par magasin et releves.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderPriceHistory(el, params) {
  const ingredientId = params.ingredientId ?? '';
  const { points, per, series, trends, storeNames } = await ingredientPriceHistory(ingredientId);
  // Les magasins les plus suivis ont une couleur ; les autres restent dans le tableau.
  const ordered = [...series].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const charted = ordered.filter(([, s]) => s.length > 0).slice(0, MAX_SERIES);
  const storeName = (/** @type {string} */ id) => storeNames.get(id) ?? 'Magasin supprimé';

  el.innerHTML = `
    <section>
      <h1 class="page-title">${escapeHtml(nameOf(ingredientId))}</h1>
      ${points.length ? `<p class="actions"><a class="button button--secondary" href="#/prix/ajouter/${encodeURIComponent(ingredientId)}">Relever un nouveau prix</a></p>` : ''}
      ${
        points.length === 0
          ? `<p class="empty">Aucun prix relevé pour ce produit.</p><p><a class="button button--secondary" href="#/prix/ajouter/${encodeURIComponent(ingredientId)}">Relever un prix</a></p>`
          : `${per ? `<p class="hint">Prix ${escapeHtml(PER_LABELS[per])}, promotion du moment comprise.</p>` : ''}
            ${charted.some(([, s]) => s.length >= 2) ? '<div class="chart" data-chart></div>' : '<p class="hint">La courbe apparaît à partir de deux relevés dans un même magasin.</p>'}
            ${ordered.length > MAX_SERIES ? `<p class="hint">La courbe montre les ${MAX_SERIES} magasins les plus suivis ; tous les relevés sont dans le tableau.</p>` : ''}
            <dl class="budget-card">${ordered
              .map(([storeId]) => {
                const t = trends.get(storeId);
                return t
                  ? `<div><dt>${escapeHtml(storeName(storeId))}</dt><dd>${escapeHtml(formatCents(t.last.unitCents))}</dd>
                      <dd class="hint">${t.first.date === t.last.date ? `le ${escapeHtml(formatIsoDayMonth(t.last.date))}` : `${escapeHtml(pctText(t.changePct))} depuis le ${escapeHtml(formatIsoDayMonth(t.first.date))} · min ${escapeHtml(formatCents(t.minCents))}`}</dd></div>`
                  : '';
              })
              .join('')}</dl>
            <h2>Relevés</h2>
            <div class="table-scroll"><table class="table">
              <thead><tr><th scope="col">Date</th><th scope="col">Magasin et produit</th><th scope="col">Prix</th><th scope="col">${per ? escapeHtml(PER_LABELS[per].replace(/^l[ea] /, 'Au ').replace('Au pièce', 'À la pièce')) : 'Ramené'}</th></tr></thead>
              <tbody>${points
                .map(
                  (p) => `<tr><td>${escapeHtml(`${p.date.slice(8, 10)}/${p.date.slice(5, 7)}/${p.date.slice(2, 4)}`)}</td>
                    <td>${escapeHtml(storeName(p.storeId))}<br /><span class="hint">${escapeHtml([p.label, formatQuantity(p.packageQuantity, p.packageUnit)].filter(Boolean).join(', '))}</span></td>
                    <td>${escapeHtml(formatCents(p.priceCents))}${p.promoCents !== null ? `<br /><span class="change change--down">promo ${escapeHtml(formatCents(p.promoCents))}</span>` : ''}</td>
                    <td>${p.unitCents === null ? '—' : escapeHtml(formatCents(p.unitCents))}</td></tr>`,
                )
                .join('')}</tbody>
            </table></div>`
      }
      <p><a href="#/prix">Tous les produits suivis</a></p>
    </section>`;

  const chart = /** @type {HTMLElement | null} */ (el.querySelector('[data-chart]'));
  if (chart && per) {
    drawPriceChart(
      chart,
      charted.map(([storeId, s]) => ({ name: storeName(storeId), points: s })),
      PER_LABELS[per],
    );
  }
}
