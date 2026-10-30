import { escapeHtml } from '../utils/html.js';
import { measurableUnitOptions, parseDecimal } from '../utils/units-select.js';
import { canUseCamera, startScanner, readBarcodeFromPhoto } from '../utils/barcodeScanner.js';
import { AVAILABILITY } from '../domain/stores/stores.js';
import { isValidBarcode } from '../domain/stores/barcode.js';
import { formatCents, parseAmountToCents, centsToInput } from '../domain/budget/money.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { toIsoDate } from '../domain/planning/dates.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { getStores, getPrices, saveStore, savePrice } from '../services/budgetService.js';
import { newId } from '../services/shoppingService.js';
import { lookupBarcode, rememberBarcode, lastPriceStore, setLastPriceStore } from '../services/barcodeService.js';
import { photoFieldHtml, mountPhotoField } from './photoField.js';

/** @typedef {import('../domain/stores/stores.js').Availability} Availability */

const nameIndex = buildNameIndex(INGREDIENTS);

/**
 * Ecran unique « Ajouter un prix » : scan du code-barres, photo de l'etiquette ou saisie.
 * Adresses : #/prix/ajouter, #/prix/ajouter/<ingredient>, #/prix/ajouter/magasin/<magasin>
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderAddPrice(el, params) {
  const [stores, lastStore] = await Promise.all([getStores(), lastPriceStore()]);
  const today = toIsoDate(new Date());
  const preStore = params.storeId ?? lastStore ?? stores[0]?.id ?? '';
  const preIngredient = params.ingredientId ? ingredientsById.get(params.ingredientId) : undefined;
  const sorted = [...stores].sort((a, b) => a.name.localeCompare(b.name));

  el.innerHTML = `
    <section class="add-price">
      <h1 class="page-title">Ajouter un prix</h1>
      <div class="scan">
        ${
          canUseCamera()
            ? `<button type="button" class="button" data-scan>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 5h2v14H3zm4 0h1v14H7zm3 0h2v14h-2zm4 0h1v14h-1zm3 0h1v14h-1zm2 0h2v14h-2z"/></svg>
                Scanner le code-barres</button>`
            : ''
        }
        <div class="scan__view" hidden>
          <video class="scan__video" playsinline muted></video>
          <div class="scan__frame" aria-hidden="true"></div>
          <button type="button" class="button button--secondary button--small" data-stop>Arrêter</button>
        </div>
        <details class="scan__other">
          <summary>Autres façons de lire le code</summary>
          <input id="scan-photo" type="file" accept="image/*" capture="environment" class="visually-hidden" />
          <p><label for="scan-photo" class="button button--secondary button--small">Photographier le code-barres</label></p>
          <div class="field inline-form__row">
            <label class="visually-hidden" for="scan-code">Chiffres du code-barres</label>
            <input id="scan-code" type="text" inputmode="numeric" maxlength="13" autocomplete="off" placeholder="Chiffres sous le code-barres" />
            <button type="button" class="button button--secondary button--small" data-code>OK</button>
          </div>
        </details>
        <p class="status scan__status" aria-live="polite"></p>
        <p class="hint">Le code-barres reconnaît le produit (fiche Open Food Facts ou produit déjà enregistré ici). Le prix, lui, n’existe dans aucune base publique : vous le tapez une fois par magasin, ou vous photographiez l’étiquette.</p>
      </div>

      <form class="stock-form" novalidate>
        ${photoFieldHtml('add-price-photo')}
        <div class="field">
          <label for="ap-store">Magasin</label>
          <select id="ap-store">
            ${sorted.map((s) => `<option value="${s.id}"${s.id === preStore ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            <option value="__new"${sorted.length ? '' : ' selected'}>+ Nouveau magasin…</option>
          </select>
        </div>
        <div class="field" data-new-store${sorted.length ? ' hidden' : ''}>
          <label for="ap-store-name">Nom du nouveau magasin</label>
          <input id="ap-store-name" type="text" maxlength="40" autocomplete="off" placeholder="ex. Hyper U Cayenne" />
        </div>
        <div class="field">
          <label for="ap-ingredient">Produit</label>
          <input id="ap-ingredient" type="text" list="ap-names" autocomplete="off" placeholder="ex. riz blanc" value="${escapeHtml(preIngredient?.name ?? '')}" />
          <datalist id="ap-names">${INGREDIENTS.filter((i) => !i.notPurchased).map((i) => `<option value="${escapeHtml(i.name)}"></option>`).join('')}</datalist>
          <p class="hint" data-off-name hidden></p>
        </div>
        <div class="field">
          <label for="ap-label">Marque ou précision (facultatif)</label>
          <input id="ap-label" type="text" maxlength="40" autocomplete="off" placeholder="ex. marque U, basmati" />
        </div>
        <div class="field">
          <label for="ap-quantity">Contenu du produit vendu</label>
          <div class="when">
            <input id="ap-quantity" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 1" />
            <select id="ap-unit" aria-label="Unité">${measurableUnitOptions('kg')}</select>
          </div>
        </div>
        <label class="check"><input type="checkbox" id="ap-loose" /> <span>Vendu au poids ou à l’unité (prix au kilo, au litre ou à la pièce)</span></label>
        <div class="field when">
          <div><label for="ap-amount">Prix (€)</label><input id="ap-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 3,20" /></div>
          <div><label for="ap-date">Relevé le</label><input id="ap-date" type="date" value="${today}" /></div>
        </div>
        <div class="field">
          <label for="ap-availability">Disponibilité</label>
          <select id="ap-availability">${AVAILABILITY.map((a) => `<option value="${a.id}"${a.id === 'available' ? ' selected' : ''}>${escapeHtml(a.label)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="ap-barcode">Code-barres (facultatif)</label>
          <input id="ap-barcode" type="text" inputmode="numeric" maxlength="13" autocomplete="off" />
        </div>
        <div class="alert" role="alert" hidden></div>
        <p class="status" data-saved aria-live="polite"></p>
        <div class="form-actions">
          <button type="submit" class="button">Enregistrer le prix</button>
          <a class="button button--secondary" href="#/prix">Historique des prix</a>
        </div>
      </form>
    </section>`;

  /** @param {string} id */
  const input = (id) => /** @type {HTMLInputElement} */ (el.querySelector(`#${id}`));
  const storeSelect = /** @type {HTMLSelectElement} */ (el.querySelector('#ap-store'));
  const newStoreField = /** @type {HTMLElement} */ (el.querySelector('[data-new-store]'));
  const scanStatus = /** @type {HTMLElement} */ (el.querySelector('.scan__status'));
  const offName = /** @type {HTMLElement} */ (el.querySelector('[data-off-name]'));
  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  const saved = /** @type {HTMLElement} */ (el.querySelector('[data-saved]'));
  const view = /** @type {HTMLElement} */ (el.querySelector('.scan__view'));
  const video = /** @type {HTMLVideoElement} */ (el.querySelector('.scan__video'));
  /** @type {{ stop: () => void } | null} */
  let scanner = null;

  storeSelect.addEventListener('change', () => {
    newStoreField.hidden = storeSelect.value !== '__new';
  });

  /** Prix deja connu pour ce produit dans ce magasin : on le montre pour comparer. */
  const showKnownPrice = async () => {
    const ingredientId = findIngredientId(input('ap-ingredient').value, nameIndex);
    if (!ingredientId || storeSelect.value === '__new') return;
    const known = (await getPrices()).find((p) => p.storeId === storeSelect.value && p.ingredientId === ingredientId);
    if (known && !input('ap-amount').value) {
      input('ap-quantity').value = String(known.packageQuantity).replace('.', ',');
      input('ap-unit').value = known.packageUnit;
      input('ap-loose').checked = known.soldLoose;
      if (!input('ap-label').value) input('ap-label').value = known.label;
      saved.textContent = `Dernier prix relevé ici : ${formatCents(known.priceCents)} le ${known.date.split('-').reverse().join('/')}. Tapez le nouveau prix.`;
    }
  };
  input('ap-ingredient').addEventListener('change', showKnownPrice);
  storeSelect.addEventListener('change', showKnownPrice);
  if (preIngredient) showKnownPrice();

  /**
   * Remplit le formulaire a partir d'un code-barres.
   * @param {string} code
   */
  const useCode = async (code) => {
    if (!isValidBarcode(code)) {
      scanStatus.textContent = 'Ce code-barres ne semble pas valide. Vérifiez les chiffres.';
      return;
    }
    input('ap-barcode').value = code;
    scanStatus.textContent = `Code ${code} : recherche du produit…`;
    const found = await lookupBarcode(code);
    if (found.link) {
      input('ap-ingredient').value = ingredientsById.get(found.link.ingredientId)?.name ?? '';
      input('ap-label').value = found.link.label;
      input('ap-quantity').value = String(found.link.packageQuantity).replace('.', ',');
      input('ap-unit').value = found.link.packageUnit;
      input('ap-loose').checked = found.link.soldLoose;
      scanStatus.textContent = 'Produit déjà enregistré sur ce téléphone : tapez le prix.';
    } else if (found.product) {
      const p = found.product;
      if (found.suggestedIngredientId) input('ap-ingredient').value = ingredientsById.get(found.suggestedIngredientId)?.name ?? '';
      input('ap-label').value = [p.brand, p.name].filter(Boolean).join(' ').slice(0, 40);
      if (p.packageSize) {
        input('ap-quantity').value = String(p.packageSize.quantity).replace('.', ',');
        input('ap-unit').value = p.packageSize.unit;
      }
      offName.hidden = false;
      offName.textContent = `Open Food Facts : ${p.name}${p.brand ? ` (${p.brand})` : ''}${p.kcalPer100g !== null ? `, ${p.kcalPer100g} kcal pour 100 g` : ''}.${found.suggestedIngredientId ? ' Vérifiez le produit proposé.' : ' Choisissez le produit dans la liste.'}`;
      scanStatus.textContent = 'Produit reconnu : vérifiez puis tapez le prix.';
    } else {
      scanStatus.textContent = found.error ?? '';
    }
    await showKnownPrice();
    input('ap-amount').focus();
  };

  el.querySelector('[data-scan]')?.addEventListener('click', async () => {
    view.hidden = false;
    scanStatus.textContent = 'Visez le code-barres, bien à plat et éclairé.';
    try {
      scanner = await startScanner(video, (code) => {
        view.hidden = true;
        scanner = null;
        if (navigator.vibrate) navigator.vibrate(80);
        useCode(code);
      });
    } catch {
      view.hidden = true;
      scanStatus.textContent = 'La caméra n’est pas accessible (autorisation refusée ?). Photographiez le code-barres ou tapez ses chiffres.';
      /** @type {HTMLDetailsElement} */ (el.querySelector('.scan__other')).open = true;
    }
  });
  el.querySelector('[data-stop]')?.addEventListener('click', () => {
    scanner?.stop();
    scanner = null;
    view.hidden = true;
    scanStatus.textContent = '';
  });
  // Quitter l'ecran eteint la camera.
  window.addEventListener('hashchange', () => scanner?.stop(), { once: true });

  input('scan-photo').addEventListener('change', async () => {
    const file = input('scan-photo').files?.[0];
    if (!file) return;
    scanStatus.textContent = 'Lecture du code-barres…';
    const code = await readBarcodeFromPhoto(file).catch(() => null);
    input('scan-photo').value = '';
    if (code) useCode(code);
    else scanStatus.textContent = 'Aucun code-barres lisible sur cette photo. Rapprochez-vous ou tapez les chiffres.';
  });
  el.querySelector('[data-code]')?.addEventListener('click', () => useCode(input('scan-code').value.replace(/\D/g, '')));

  mountPhotoField(el, 'add-price-photo', (r) => {
    /** @param {string} id @param {string} value */
    const set = (id, value) => {
      if (value) input(id).value = value;
    };
    set('ap-ingredient', r.ingredientId ? ingredientsById.get(r.ingredientId)?.name ?? '' : '');
    set('ap-label', [r.brand, r.name].filter(Boolean).join(' ').slice(0, 40));
    set('ap-quantity', r.packageQuantity === null ? '' : String(r.packageQuantity).replace('.', ','));
    set('ap-unit', r.packageUnit ?? '');
    set('ap-amount', r.priceCents === null ? '' : centsToInput(r.priceCents));
    set('ap-barcode', r.barcode);
  });

  el.querySelector('form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    alertBox.hidden = true;
    /** @type {string[]} */
    const errors = [];
    let storeId = storeSelect.value;
    if (storeId === '__new') {
      const name = input('ap-store-name').value.trim();
      if (!name) errors.push('Donnez le nom du magasin.');
      else {
        storeId = newId();
        errors.push(...(await saveStore({ id: storeId, name, type: /hyper/i.test(name) ? 'hypermarket' : /march/i.test(name) ? 'market' : 'supermarket', commune: '' })));
      }
    }
    const ingredientId = findIngredientId(input('ap-ingredient').value, nameIndex) ?? '';
    const barcode = input('ap-barcode').value.replace(/\D/g, '');
    if (barcode && !isValidBarcode(barcode)) errors.push('Le code-barres n’est pas valide : corrigez-le ou effacez-le.');
    if (!errors.length) {
      errors.push(
        ...(await savePrice({
          id: '',
          storeId,
          ingredientId,
          label: input('ap-label').value,
          packageQuantity: parseDecimal(input('ap-quantity').value),
          packageUnit: input('ap-unit').value,
          priceCents: parseAmountToCents(input('ap-amount').value),
          date: input('ap-date').value || today,
          availability: /** @type {Availability} */ (input('ap-availability').value),
          soldLoose: input('ap-loose').checked,
        })),
      );
    }
    if (errors.length) {
      alertBox.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
      alertBox.hidden = false;
      alertBox.scrollIntoView({ block: 'center' });
      return;
    }
    if (barcode) {
      await rememberBarcode({
        code: barcode,
        ingredientId,
        label: input('ap-label').value.trim(),
        packageQuantity: parseDecimal(input('ap-quantity').value),
        packageUnit: input('ap-unit').value,
        soldLoose: input('ap-loose').checked,
        updatedAt: new Date().toISOString(),
      });
    }
    await setLastPriceStore(storeId);
    const name = ingredientsById.get(ingredientId)?.name ?? '';
    const storeName = (await getStores()).find((s) => s.id === storeId)?.name ?? '';
    await renderAddPrice(el, { storeId });
    const status = /** @type {HTMLElement} */ (el.querySelector('[data-saved]'));
    status.textContent = `Prix enregistré : ${name}, ${storeName}. Scannez le produit suivant.`;
    el.querySelector('.scan')?.scrollIntoView({ block: 'start' });
  });
}
