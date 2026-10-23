import { escapeHtml } from '../utils/html.js';
import { MONTH_LABELS, PEYI_PRODUCE } from '../data/seasons.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { buildNameIndex, findIngredientId } from '../domain/ingredients/ingredients.js';
import { ingredientsById } from '../services/catalog.js';
import { seasonNow, saveSeason } from '../services/seasonService.js';

const nameIndex = buildNameIndex(INGREDIENTS);
/** @param {string} id */
const nameOf = (id) => ingredientsById.get(id)?.name ?? id;

/**
 * Mois en texte court : « sept. à janv. » ou « mars, juin ».
 * @param {number[]} months
 * @returns {string}
 */
function monthsText(months) {
  return months.map((m) => MONTH_LABELS[m - 1]).join(', ');
}

/**
 * Liste de produits avec lien vers leurs recettes.
 * @param {string[]} ids
 * @returns {string}
 */
function productsHtml(ids) {
  return `<ul class="season-list">${ids
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    .map((id) => `<li><a href="#/recettes/avec/${encodeURIComponent(id)}">${escapeHtml(nameOf(id))}</a></li>`)
    .join('')}</ul>`;
}

/**
 * Ecran Produits de saison en Guyane.
 * @param {HTMLElement} el
 */
export async function renderSeasons(el) {
  const s = await seasonNow();
  const monthName = MONTH_LABELS[s.month - 1];
  const entries = Object.entries(s.calendar).sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));

  el.innerHTML = `
    <section>
      <h1 class="page-title">Produits de saison</h1>
      <p>En ${escapeHtml(monthName)}, l’assistant favorise ces produits dans ses propositions, et le filtre « De saison et péyi » des recettes les met en avant.</p>

      <h2>Prix au plus bas en ce moment</h2>
      ${s.lowPrice.size ? productsHtml([...s.lowPrice]) : '<p class="empty">Rien pour l’instant : il faut au moins 3 relevés de prix d’un produit sur 4 mois pour repérer un prix au plus bas.</p>'}

      <h2>De saison en ${escapeHtml(monthName)}, selon votre calendrier</h2>
      ${s.season.size ? productsHtml([...s.season]) : '<p class="empty">Votre calendrier ne contient encore aucun produit pour ce mois.</p>'}

      <h2>Produits péyi</h2>
      <p class="hint">Cultivés en Guyane et disponibles une grande partie de l’année. Un produit que vous déclarez hors saison ce mois-ci n’est pas favorisé.</p>
      ${productsHtml([...PEYI_PRODUCE])}

      <h2 data-heading="calendar">Mon calendrier des saisons</h2>
      <p class="hint">Je n’ai pas trouvé de calendrier officiel mois par mois pour la Guyane : les saisons varient selon les variétés et les années. Notez ce que vous voyez au marché ; l’application s’en sert ensuite.</p>
      <div class="alert" role="alert" hidden></div>
      <form class="stock-form" data-form="season" novalidate>
        <div class="field">
          <label for="season-product">Produit</label>
          <input id="season-product" type="text" list="season-names" autocomplete="off" placeholder="ex. mangue" />
          <datalist id="season-names">${INGREDIENTS.filter((i) => !i.notPurchased).map((i) => `<option value="${escapeHtml(i.name)}"></option>`).join('')}</datalist>
        </div>
        <fieldset class="field">
          <legend>Mois de saison</legend>
          <div class="month-grid">${MONTH_LABELS.map(
            (m, i) => `<label class="check"><input type="checkbox" name="month" value="${i + 1}" /> <span>${escapeHtml(m)}</span></label>`,
          ).join('')}</div>
        </fieldset>
        <div class="form-actions"><button type="submit" class="button">Enregistrer</button></div>
      </form>
      ${
        entries.length
          ? `<ul class="local-list">${entries
              .map(
                ([id, months]) => `<li><span><strong>${escapeHtml(nameOf(id))}</strong> : ${escapeHtml(monthsText(months))}</span>
                  <span class="row-actions"><button type="button" class="button button--small button--secondary" data-edit-season="${escapeHtml(id)}">Modifier</button>
                  <button type="button" class="icon-button" data-remove-season="${escapeHtml(id)}" aria-label="Retirer ${escapeHtml(nameOf(id))} du calendrier">×</button></span></li>`,
              )
              .join('')}</ul>`
          : ''
      }
    </section>`;

  const form = /** @type {HTMLFormElement} */ (el.querySelector('[data-form="season"]'));
  const product = /** @type {HTMLInputElement} */ (el.querySelector('#season-product'));
  const boxes = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('input[name="month"]')]);
  const alertBox = /** @type {HTMLElement} */ (el.querySelector('.alert'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = findIngredientId(product.value, nameIndex);
    if (!id) {
      alertBox.hidden = false;
      alertBox.textContent = 'Choisissez un produit de la liste.';
      return;
    }
    const errors = await saveSeason(id, boxes.filter((b) => b.checked).map((b) => Number(b.value)));
    if (errors.length) {
      alertBox.hidden = false;
      alertBox.textContent = errors.join(' ');
      return;
    }
    await renderSeasons(el);
  });
  el.querySelector('section')?.addEventListener('click', async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const edit = target.getAttribute('data-edit-season');
    const remove = target.getAttribute('data-remove-season');
    if (edit) {
      product.value = nameOf(edit);
      const months = s.calendar[edit] ?? [];
      for (const b of boxes) b.checked = months.includes(Number(b.value));
      el.querySelector('[data-heading="calendar"]')?.scrollIntoView({ block: 'start' });
    } else if (remove) {
      await saveSeason(remove, []);
      await renderSeasons(el);
    }
  });
}
