import { escapeHtml } from '../utils/html.js';
import { formatIsoDayMonth } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { measurableUnitOptions, parseDecimal } from '../utils/units-select.js';
import { addDays, parseIsoDate, toIsoDate, weekStart } from '../domain/planning/dates.js';
import { formatCents, parseAmountToCents, centsToInput } from '../domain/budget/money.js';
import { QUALITIES, IMPORT_COLUMNS, DRIVE_FRESH_HOURS, isFresh, promotionStatus, orderText, importTemplate } from '../domain/drive/drive.js';
import { AVAILABILITY } from '../domain/stores/stores.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { INGREDIENTS } from '../data/ingredients.js';
import {
  getDriveSettings,
  saveDriveSettings,
  setupHyperUCayenne,
  getDriveStore,
  getStoreProducts,
  saveDriveProduct,
  deleteDriveProduct,
  importDriveCsv,
  weekQuote,
  prepareOrder,
  verifyOrder,
  confirmOrder,
  markOrderSent,
  getDriveOrders,
} from '../services/driveService.js';

/** @typedef {import('../domain/drive/drive.js').DriveProduct} DriveProduct */
/** @typedef {import('../domain/drive/drive.js').PromoType} PromoType */

const nameIndex = buildNameIndex(INGREDIENTS);
const qualityLabels = new Map(QUALITIES.map((q) => [q.id, q.label]));
const kindLabels = {
  drive_verified: ['Vérifié Drive', 'ok'],
  drive_stale: ['À revérifier', 'estimated'],
  manual: ['Relevé en magasin', 'estimated'],
  missing: ['Prix inconnu', 'not_comparable'],
};

/** @param {string} id */
const ingredientName = (id) => ingredientsById.get(id)?.name ?? id;

/**
 * @param {DriveProduct} p
 * @param {Date} now
 * @returns {string}
 */
function productHtml(p, now) {
  const promo = p.promotion;
  const pStatus = promotionStatus(promo, toIsoDate(now));
  return `<li>
    <span class="shop__item"><span><strong>${escapeHtml(p.name)}</strong> ${p.brand ? `<span class="hint">${escapeHtml(p.brand)}</span>` : ''}
      <span class="shop__qty">${escapeHtml(formatCents(p.priceCents))} · ${escapeHtml(formatQuantity(p.packageQuantity, p.packageUnit))}</span>
      <span class="hint">${p.ingredientId ? escapeHtml(ingredientName(p.ingredientId)) : '<strong>Non relié à un ingrédient</strong>'} · ${escapeHtml(AVAILABILITY.find((a) => a.id === p.availability)?.label ?? '')}${p.quality.length ? ` · ${escapeHtml(p.quality.map((q) => qualityLabels.get(q)).join(', '))}` : ''}</span>
      ${promo ? `<span class="shop__price">${pStatus === 'active' ? 'Promotion' : pStatus === 'upcoming' ? 'Promotion à venir' : 'Promotion terminée'} : ${escapeHtml(promo.label)} (${escapeHtml(promo.startDate)} → ${escapeHtml(promo.endDate)})${promo.requiresCard ? ' · avec la carte' : ''}</span>` : ''}
      <span class="badge badge--${isFresh(p, now) ? 'ok' : 'estimated'}">${isFresh(p, now) ? 'Prix vérifié' : 'À revérifier'} · relevé le ${escapeHtml(new Date(p.checkedAt).toLocaleString('fr-FR'))}</span></span></span>
    <span class="row-actions">
      <button type="button" class="button button--small button--secondary" data-recheck="${escapeHtml(p.id)}">Prix vérifié aujourd’hui</button>
      <button type="button" class="button button--small button--secondary" data-edit="${escapeHtml(p.id)}">Modifier</button>
      <button type="button" class="icon-button" data-remove="${escapeHtml(p.id)}" aria-label="Supprimer ${escapeHtml(p.name)}">×</button>
    </span>
  </li>`;
}

/**
 * Ecran Drive : magasin, prix releves, panier de la semaine et commande.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderDrive(el, params) {
  const now = new Date();
  const today = toIsoDate(now);
  const monday = weekStart(params.date && parseIsoDate(params.date) ? params.date : today);
  const store = await getDriveStore();

  if (!store || !store.drive) {
    el.innerHTML = `
      <section>
        <h1 class="page-title">Drive</h1>
        <p>En Guyane, le seul Drive alimentaire disponible aujourd’hui est celui de l’<strong>Hyper U de Cayenne</strong>. MealDom peut préparer votre panier à partir du planning, vérifier les prix que vous avez relevés et vous guider jusqu’à la commande.</p>
        <p class="hint">Hyper U ne propose pas d’accès public pour les applications : MealDom ne lit pas le site à votre place et ne commande jamais seul. Les prix et promotions viennent de vos relevés sur le site du Drive (ou d’un fichier importé), toujours datés.</p>
        <button type="button" class="button" data-action="setup">Utiliser le Drive Hyper U Cayenne</button>
      </section>`;
    el.querySelector('[data-action="setup"]')?.addEventListener('click', async () => {
      await setupHyperUCayenne();
      await renderDrive(el, params);
    });
    return;
  }

  const [settings, products, { quote, lines }, orders] = await Promise.all([getDriveSettings(), getStoreProducts(), weekQuote(monday), getDriveOrders()]);
  const order = orders.find((o) => o.id === `order-${monday}`) ?? null;
  const check = order ? await verifyOrder(order) : null;
  const fresh = products.filter((p) => isFresh(p, now)).length;
  const promos = products.filter((p) => p.availability === 'available' && promotionStatus(p.promotion, today) === 'active');
  const toBuyCount = lines.filter((l) => !l.covered && l.toBuy !== null).length;
  /** @type {DriveProduct | null} */
  let editing = null;

  el.innerHTML = `
    <section>
      <h1 class="page-title">Drive – ${escapeHtml(store.name)}</h1>
      <p><a class="button button--secondary" href="${escapeHtml(store.drive.url)}" target="_blank" rel="noopener">Ouvrir le site ${escapeHtml(store.drive.label)}</a>
        <a class="button button--secondary" href="#/courses/organisation/semaine/${monday}">Organiser les courses</a></p>
      <p class="hint">Choisissez le magasin Hyper U Cayenne sur le site. MealDom n’y accède pas lui-même : vérifiez les prix sur le site, puis notez-les ici (ou importez-les).</p>

      <dl class="budget-card">
        <div><dt>Produits relevés</dt><dd>${products.length}</dd></div>
        <div class="${fresh < products.length ? 'over' : ''}"><dt>Prix vérifiés (moins de ${DRIVE_FRESH_HOURS} h)</dt><dd>${fresh}</dd></div>
        <div><dt>Promotions actives</dt><dd>${promos.length}</dd></div>
      </dl>

      <h2>Réglages</h2>
      <label class="check"><input type="checkbox" data-setting="card"${settings.hasLoyaltyCard ? ' checked' : ''} /> <span>J’ai la carte de fidélité U (offres réservées aux porteurs)</span></label>
      <div class="field">
        <label for="drive-pref">Choix des produits</label>
        <select id="drive-pref" data-setting="preference">
          <option value="cheapest"${settings.preference === 'cheapest' ? ' selected' : ''}>Le moins cher pour la quantité achetée</option>
          <option value="promotions"${settings.preference === 'promotions' ? ' selected' : ''}>Les promotions d’abord</option>
          <option value="quality"${settings.preference === 'quality' ? ' selected' : ''}>La qualité d’abord (bio, Label Rouge, local)</option>
        </select>
      </div>

      <h2>Panier de la semaine</h2>
      <nav class="week-nav" aria-label="Changer de semaine">
        <a href="#/drive/semaine/${addDays(monday, -7)}" aria-label="Semaine précédente">‹</a>
        <span>Semaine du ${escapeHtml(formatIsoDayMonth(monday))}</span>
        <a href="#/drive/semaine/${addDays(monday, 7)}" aria-label="Semaine suivante">›</a>
      </nav>
      ${
        toBuyCount === 0
          ? '<p class="empty">Rien à acheter pour les repas de cette semaine (ou aucun repas planifié).</p>'
          : `<dl class="budget-card">
              <div><dt>Total chiffré</dt><dd>${escapeHtml(formatCents(quote.totalCents))}</dd></div>
              <div><dt>Dont prix Drive vérifiés</dt><dd>${escapeHtml(formatCents(quote.verifiedCents))}</dd></div>
              ${quote.savingCents ? `<div><dt>Promotions appliquées</dt><dd>−${escapeHtml(formatCents(quote.savingCents))}</dd></div>` : ''}
              <div class="${quote.missing.length ? 'over' : ''}"><dt>Sans prix</dt><dd>${quote.missing.length}</dd></div>
            </dl>
            ${quote.allVerified ? '<p><span class="badge badge--ok">Tout le panier est chiffré avec des prix Drive vérifiés.</span></p>' : '<p class="hint">Le total n’est une valeur sûre que si tous les articles sont « Vérifié Drive ». Les autres montants sont des estimations.</p>'}
            <ul class="shop">${quote.lines
              .map((l) => {
                const [label, cls] = kindLabels[l.kind];
                return `<li><span class="shop__item"><span><strong>${escapeHtml(ingredientName(l.ingredientId))}</strong>
                  <span class="shop__qty">${l.productName ? `${l.count} × ${escapeHtml(l.productName)}` : ''} ${l.cents !== null ? `· ${escapeHtml(formatCents(l.cents))}` : ''}</span>
                  ${l.promoLabel ? `<span class="shop__price">Promotion : ${escapeHtml(l.promoLabel)} (−${escapeHtml(formatCents(l.savingCents))})</span>` : ''}
                  ${l.promoNote ? `<span class="hint">${escapeHtml(l.promoNote)}</span>` : ''}
                  <span class="badge badge--${cls}">${escapeHtml(label)}${l.checkedAt && l.kind !== 'drive_verified' ? ` · ${escapeHtml(l.checkedAt.slice(0, 10))}` : ''}</span></span></span>
                  <a class="shop__pkg" href="#/assistant/produit/${encodeURIComponent(l.ingredientId)}">Moins cher ?</a></li>`;
              })
              .join('')}</ul>`
      }

      <h2>Commande</h2>
      <div class="alert" role="alert" data-alert="order" hidden></div>
      ${
        !order
          ? '<p>Préparez la commande à partir du panier : MealDom vérifiera les prix, les quantités, la disponibilité et le magasin.</p>'
          : `<p>Commande ${order.status === 'sent' ? '<strong>passée sur le site du Drive</strong>' : order.status === 'confirmed' ? '<strong>validée par vous</strong>' : 'en préparation'} : ${order.items.length} article(s), ${escapeHtml(formatCents(order.totalCents))}${order.notInDrive.length ? ` ; ${order.notInDrive.length} article(s) à acheter ailleurs` : ''}.</p>
            ${check && check.blocking.length ? `<div class="fit fit--ko"><p><strong>À régler avant de commander</strong></p><ul>${check.blocking.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul></div>` : ''}
            ${check && check.warnings.length ? `<ul class="proposal__notes">${check.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}`
      }
      <div class="form-actions">
        <button type="button" class="button button--secondary" data-action="prepare"${toBuyCount === 0 ? ' disabled' : ''}>${order ? 'Recalculer la commande' : 'Préparer la commande'}</button>
      </div>
      ${
        order && order.status === 'draft' && check?.ok
          ? `<form class="stock-form" data-form="confirm" novalidate>
              <label class="check"><input type="checkbox" name="agree" /> <span>Je valide la commande de ${order.items.length} article(s) pour ${escapeHtml(formatCents(order.totalCents))} au ${escapeHtml(store.name)}. Je sais que les prix peuvent encore évoluer sur le site.</span></label>
              <button type="submit" class="button">Valider ma commande</button>
              <p class="hint">Valider une recette ou une proposition de l’assistant ne vaut jamais validation de commande.</p>
            </form>`
          : ''
      }
      ${
        order && order.status === 'confirmed'
          ? `<div class="form-actions">
              <a class="button" href="${escapeHtml(store.drive.url)}" target="_blank" rel="noopener">Commander sur le site du Drive</a>
              <button type="button" class="button button--secondary" data-action="copy">Copier la liste</button>
              <button type="button" class="button button--secondary" data-action="sent">J’ai passé la commande</button>
            </div>
            <p class="hint">MealDom ne transmet rien automatiquement : ajoutez les articles sur le site avec la liste copiée, puis indiquez que c’est fait.</p>`
          : ''
      }

      ${
        promos.length
          ? `<h2>Promotions en cours</h2><ul class="shop">${promos.map((p) => productHtml(p, now)).join('')}</ul>`
          : ''
      }

      <h2>Produits relevés (${products.length})</h2>
      ${products.length ? `<ul class="shop" data-list="products">${products.sort((a, b) => a.name.localeCompare(b.name)).map((p) => productHtml(p, now)).join('')}</ul>` : '<p class="empty">Aucun produit pour l’instant.</p>'}

      <h2 data-heading="product">Ajouter un produit relevé sur le Drive</h2>
      <div class="alert" role="alert" data-alert="product" hidden></div>
      <form class="stock-form" data-form="product" novalidate>
        <div class="field"><label for="dp-ref">Référence (code produit ou EAN, sur le site)</label><input id="dp-ref" type="text" maxlength="40" autocomplete="off" /></div>
        <div class="field"><label for="dp-name">Nom du produit</label><input id="dp-name" type="text" maxlength="80" autocomplete="off" placeholder="ex. Riz long grain 1 kg" /></div>
        <div class="field"><label for="dp-brand">Marque (facultatif)</label><input id="dp-brand" type="text" maxlength="40" autocomplete="off" /></div>
        <div class="field"><label for="dp-ingredient">Ingrédient correspondant</label>
          <input id="dp-ingredient" type="text" list="dp-names" autocomplete="off" placeholder="ex. riz blanc" />
          <datalist id="dp-names">${INGREDIENTS.filter((i) => !i.notPurchased).map((i) => `<option value="${escapeHtml(i.name)}"></option>`).join('')}</datalist></div>
        <div class="field"><label for="dp-qty">Contenance</label>
          <div class="when"><input id="dp-qty" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 1" />
          <select id="dp-unit" aria-label="Unité">${measurableUnitOptions('kg')}</select></div></div>
        <div class="field"><label for="dp-price">Prix affiché (€)</label><input id="dp-price" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 2,49" /></div>
        <div class="field"><label for="dp-avail">Disponibilité sur le site</label>
          <select id="dp-avail">${AVAILABILITY.map((a) => `<option value="${a.id}">${escapeHtml(a.label)}</option>`).join('')}</select></div>
        <fieldset class="field checks"><legend>Qualité (facultatif)</legend>
          ${QUALITIES.map((q) => `<label class="check"><input type="checkbox" name="quality" value="${q.id}" /> <span>${escapeHtml(q.label)}</span></label>`).join('')}</fieldset>
        <fieldset class="field"><legend>Promotion (facultatif, telle qu’affichée)</legend>
          <select id="dp-promo-type" aria-label="Type de promotion">
            <option value="">Aucune</option>
            <option value="percent">Remise en %</option>
            <option value="amount">Remise en € par article</option>
            <option value="price">Prix promo par article</option>
            <option value="second_half">2e article à −X %</option>
            <option value="n_for_m">X achetés pour Y payés</option>
          </select>
          <input id="dp-promo-value" type="text" autocomplete="off" placeholder="ex. 20, 0,50, 1,99, 50 ou 3 pour 2" aria-label="Valeur de la promotion" />
          <input id="dp-promo-label" type="text" maxlength="60" autocomplete="off" placeholder="Texte de l’offre, ex. -20 % immédiatement" aria-label="Texte de l’offre" />
          <div class="when"><input id="dp-promo-start" type="date" aria-label="Début" value="${today}" /><input id="dp-promo-end" type="date" aria-label="Fin" /></div>
          <label class="check"><input id="dp-promo-card" type="checkbox" /> <span>Réservée à la carte de fidélité</span></label>
        </fieldset>
        <div class="form-actions"><button type="submit" class="button">Enregistrer (prix vérifié maintenant)</button></div>
      </form>

      <h2>Importer un fichier</h2>
      <ol class="steps">
        <li>Téléchargez le modèle et ouvrez-le avec Excel, Google Sheets ou LibreOffice.</li>
        <li>Remplacez les lignes « EXEMPLE » par les produits relevés sur le site du Drive : une ligne par produit, avec sa référence (code produit ou EAN), son prix et « oui » dans la colonne disponible.</li>
        <li>Enregistrez au format « CSV UTF-8 (séparateur point-virgule) », puis choisissez le fichier ci-dessous.</li>
      </ol>
      <p><button type="button" class="button button--secondary" data-action="template">Télécharger le modèle</button></p>
      <p class="hint">Colonnes : ${escapeHtml(IMPORT_COLUMNS.join(' ; '))}. Les promotions s’écrivent par exemple « percent ; 20 » ou « n_for_m ; 3 pour 2 ». Un nom d’ingrédient non reconnu laisse le produit « non relié ». Les lignes dont la référence commence par EXEMPLE ne sont jamais importées.</p>
      <div class="alert" role="alert" data-alert="import" hidden></div>
      <form class="stock-form" data-form="import" novalidate>
        <div class="field"><label for="dp-file">Fichier</label><input id="dp-file" type="file" accept=".csv,text/csv,text/plain" /></div>
        <div class="field"><label for="dp-csv">Ou collez le contenu</label><textarea id="dp-csv" rows="4"></textarea></div>
        <button type="submit" class="button button--secondary">Importer</button>
      </form>
    </section>`;

  /** @param {string} name @param {string[]} messages @param {boolean} [ok] */
  const say = (name, messages, ok = false) => {
    const box = /** @type {HTMLElement} */ (el.querySelector(`[data-alert="${name}"]`));
    box.hidden = messages.length === 0;
    box.classList.toggle('alert--ok', ok);
    box.innerHTML = messages.map((m) => `<p>${escapeHtml(m)}</p>`).join('');
    if (messages.length) box.scrollIntoView({ block: 'center' });
  };

  el.querySelector('[data-setting="card"]')?.addEventListener('change', async (event) => {
    await saveDriveSettings({ hasLoyaltyCard: /** @type {HTMLInputElement} */ (event.target).checked });
    await renderDrive(el, params);
  });
  el.querySelector('[data-setting="preference"]')?.addEventListener('change', async (event) => {
    const value = /** @type {HTMLSelectElement} */ (event.target).value;
    await saveDriveSettings({ preference: value === 'quality' || value === 'promotions' ? value : 'cheapest' });
    await renderDrive(el, params);
  });
  el.querySelector('[data-action="prepare"]')?.addEventListener('click', async () => {
    await prepareOrder(monday);
    await renderDrive(el, params);
  });
  el.querySelector('[data-form="confirm"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (event.target);
    if (!(/** @type {HTMLInputElement} */ (form.elements.namedItem('agree')).checked)) {
      say('order', ['Cochez la case pour valider explicitement la commande.']);
      return;
    }
    if (!order) return;
    const result = await confirmOrder(order.id);
    if (!result.ok) say('order', result.blocking);
    else await renderDrive(el, params);
  });
  el.querySelector('[data-action="copy"]')?.addEventListener('click', async () => {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(orderText(order, formatCents));
      say('order', ['Liste copiée : collez-la dans vos notes ou sur le site du Drive.'], true);
    } catch {
      say('order', ['La copie n’est pas autorisée par le navigateur.']);
    }
  });
  el.querySelector('[data-action="sent"]')?.addEventListener('click', async () => {
    if (!order) return;
    const result = await markOrderSent(order.id);
    if (!result.ok) say('order', result.blocking);
    else await renderDrive(el, params);
  });

  const section = /** @type {HTMLElement} */ (el.querySelector('section'));
  section.addEventListener('click', async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const find = (/** @type {string | null} */ id) => products.find((p) => p.id === id);
    const recheck = find(target.getAttribute('data-recheck'));
    if (recheck) {
      await saveDriveProduct({ ...recheck, checkedAt: new Date().toISOString(), source: 'drive_manual' });
      await renderDrive(el, params);
      return;
    }
    const removed = find(target.getAttribute('data-remove'));
    if (removed) {
      if (!window.confirm(`Supprimer ${removed.name} ?`)) return;
      await deleteDriveProduct(removed);
      await renderDrive(el, params);
      return;
    }
    const edit = find(target.getAttribute('data-edit'));
    if (edit) {
      editing = edit;
      /** @param {string} id @param {string} value */
      const set = (id, value) => {
        /** @type {HTMLInputElement} */ (el.querySelector(id)).value = value;
      };
      set('#dp-ref', edit.id);
      set('#dp-name', edit.name);
      set('#dp-brand', edit.brand);
      set('#dp-ingredient', edit.ingredientId ? ingredientName(edit.ingredientId) : '');
      set('#dp-qty', String(edit.packageQuantity).replace('.', ','));
      set('#dp-unit', edit.packageUnit);
      set('#dp-price', centsToInput(edit.priceCents));
      set('#dp-avail', edit.availability);
      for (const q of el.querySelectorAll('input[name="quality"]')) /** @type {HTMLInputElement} */ (q).checked = edit.quality.includes(/** @type {any} */ (/** @type {HTMLInputElement} */ (q).value));
      set('#dp-promo-type', edit.promotion?.type ?? '');
      set('#dp-promo-value', edit.promotion ? (edit.promotion.type === 'n_for_m' ? `${edit.promotion.buy} pour ${edit.promotion.pay}` : edit.promotion.type === 'amount' || edit.promotion.type === 'price' ? centsToInput(edit.promotion.value) : String(edit.promotion.value)) : '');
      set('#dp-promo-label', edit.promotion?.label ?? '');
      set('#dp-promo-start', edit.promotion?.startDate ?? today);
      set('#dp-promo-end', edit.promotion?.endDate ?? '');
      /** @type {HTMLInputElement} */ (el.querySelector('#dp-promo-card')).checked = Boolean(edit.promotion?.requiresCard);
      el.querySelector('[data-heading="product"]')?.scrollIntoView({ block: 'start' });
    }
  });

  el.querySelector('[data-form="product"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    /** @param {string} id */
    const val = (id) => /** @type {HTMLInputElement} */ (el.querySelector(id)).value.trim();
    const ingredientText = val('#dp-ingredient');
    const ingredientId = ingredientText ? findIngredientId(ingredientText, nameIndex) : null;
    if (ingredientText && !ingredientId) {
      say('product', ['Ingrédient inconnu : choisissez-le dans la liste proposée.']);
      return;
    }
    const promoType = /** @type {PromoType | ''} */ (val('#dp-promo-type'));
    const rawValue = val('#dp-promo-value');
    const nForM = /^(\d+)\s*pour\s*(\d+)$/i.exec(rawValue);
    /** @type {DriveProduct} */
    const product = {
      id: val('#dp-ref'),
      storeId: store.id,
      name: val('#dp-name'),
      brand: val('#dp-brand'),
      ingredientId,
      packageQuantity: parseDecimal(val('#dp-qty')),
      packageUnit: val('#dp-unit'),
      priceCents: parseAmountToCents(val('#dp-price')),
      availability: /** @type {DriveProduct['availability']} */ (val('#dp-avail')),
      quality: /** @type {DriveProduct['quality']} */ ([...el.querySelectorAll('input[name="quality"]:checked')].map((q) => /** @type {HTMLInputElement} */ (q).value)),
      promotion: promoType
        ? {
            type: promoType,
            value: promoType === 'amount' || promoType === 'price' ? parseAmountToCents(rawValue) : promoType === 'n_for_m' ? 0 : parseDecimal(rawValue),
            ...(nForM ? { buy: Number(nForM[1]), pay: Number(nForM[2]) } : {}),
            label: val('#dp-promo-label') || rawValue,
            startDate: val('#dp-promo-start'),
            endDate: val('#dp-promo-end'),
            conditions: /** @type {HTMLInputElement} */ (el.querySelector('#dp-promo-card')).checked ? 'Avec la carte de fidélité' : '',
            requiresCard: /** @type {HTMLInputElement} */ (el.querySelector('#dp-promo-card')).checked,
          }
        : null,
      source: 'drive_manual',
      checkedAt: new Date().toISOString(),
    };
    if (editing && editing.id !== product.id) await deleteDriveProduct(editing);
    const errors = await saveDriveProduct(product);
    if (errors.length) say('product', errors);
    else await renderDrive(el, params);
  });

  el.querySelector('[data-action="template"]')?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([importTemplate()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modele-prix-drive.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  el.querySelector('[data-form="import"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = /** @type {HTMLInputElement} */ (el.querySelector('#dp-file')).files?.[0];
    const text = file ? await file.text() : /** @type {HTMLTextAreaElement} */ (el.querySelector('#dp-csv')).value;
    if (!text.trim()) {
      say('import', ['Choisissez un fichier ou collez son contenu.']);
      return;
    }
    const result = await importDriveCsv(text);
    const messages = [`${result.imported} produit(s) importé(s)${result.unlinked ? `, dont ${result.unlinked} non relié(s) à un ingrédient` : ''}.`, ...result.errors];
    if (result.errors.length) say('import', messages);
    else {
      await renderDrive(el, params);
      say('import', messages, true);
    }
  });
}
