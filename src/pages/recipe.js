import { escapeHtml } from '../utils/html.js';
import { formatMinutes } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { ALLERGENS, PRODUCT_LABEL_WARNING } from '../domain/ingredients/allergens.js';
import { equipmentLabel } from '../domain/recipes/equipment.js';
import {
  DIFFICULTY_LABELS,
  VESSEL_LABELS,
  findSharedPreparations,
  recipeAllergens,
  totalMinutes,
} from '../domain/recipes/recipes.js';
import { recipes, recipesById, preparationsById, ingredientsById, cuisineLabels } from '../services/catalog.js';
import { getHousehold } from '../services/householdService.js';
import { evaluateRecipeForHousehold } from '../domain/household/compatibility.js';
import { DIETS } from '../domain/household/household.js';

/** @typedef {import('../domain/recipes/recipes.js').IngredientLine} IngredientLine */
/** @typedef {import('../domain/recipes/recipes.js').CookingMethod} CookingMethod */

const allergenLabels = new Map(ALLERGENS.map((a) => [a.id, a.label]));
const dietLabels = new Map(DIETS.map((d) => [d.id, d.label.toLowerCase()]));

/**
 * "Léa", "Léa et Marc", "Léa, Marc et Sam"
 * @param {string[]} names
 * @returns {string}
 */
function joinNames(names) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/**
 * Phrase expliquant pourquoi la recette ne convient pas.
 * @param {import('../domain/household/compatibility.js').IncompatibilityReason} reason
 * @returns {string}
 */
function reasonText(reason) {
  switch (reason.type) {
    case 'allergen':
      return `Contient : ${(allergenLabels.get(reason.allergen) ?? reason.allergen).toLowerCase()}. Allergie de ${joinNames(reason.members)}.`;
    case 'diet':
      return `Ne respecte pas le régime ${dietLabels.get(reason.diet) ?? reason.diet} de ${joinNames(reason.members)}.`;
    case 'dislike':
      return `Contient ${ingredientsById.get(reason.ingredientId)?.name ?? reason.ingredientId}, refusé par ${joinNames(reason.members)}.`;
    case 'equipment':
      return 'Demande un matériel qui n’est pas coché dans votre foyer.';
    case 'unknown_ingredient':
      return 'Un ingrédient n’a pas pu être vérifié.';
  }
}

/**
 * @param {IngredientLine[]} lines
 * @returns {string}
 */
function ingredientsHtml(lines) {
  return `<ul class="ingredients">${lines
    .map((l) => {
      const name = ingredientsById.get(l.ingredientId)?.name ?? l.ingredientId;
      return `<li><span class="ingredients__qty">${escapeHtml(formatQuantity(l.quantity, l.unit))}</span>
        <span>${escapeHtml(name)}${l.note ? ` <span class="hint">(${escapeHtml(l.note)})</span>` : ''}</span></li>`;
    })
    .join('')}</ul>`;
}

/**
 * @param {CookingMethod[]} methods
 * @param {'h2' | 'h3'} level
 * @returns {string}
 */
function methodsHtml(methods, level) {
  return methods
    .map(
      (m) => `
      <${level}>${escapeHtml(m.label)}</${level}>
      <p class="hint">Matériel : ${escapeHtml(m.equipment.map(equipmentLabel).join(', '))}</p>
      <ol class="steps">${m.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`,
    )
    .join('');
}

/**
 * Ecran d'une recette.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderRecipe(el, params) {
  const recipe = recipesById.get(params.id ?? '');
  if (!recipe) {
    el.innerHTML = `<p>Cette recette n’existe pas ou a été retirée.</p><p><a href="#/recettes">Voir toutes les recettes</a></p>`;
    return;
  }

  const household = await getHousehold();
  const fit = evaluateRecipeForHousehold(recipe, household, { ingredients: ingredientsById, preparations: preparationsById });
  const fitHtml =
    fit.status === 'compatible'
      ? household.members.length
        ? '<div class="fit fit--ok"><p><strong>Convient à tout le foyer.</strong></p></div>'
        : ''
      : `<div class="fit fit--ko"><p><strong>${
          fit.status === 'unknown' ? 'Compatibilité impossible à vérifier' : 'Ne convient pas à votre foyer'
        }</strong></p><ul>${fit.reasons.map((r) => `<li>${escapeHtml(reasonText(r))}</li>`).join('')}</ul></div>`;

  const shared = findSharedPreparations(recipes);
  const { allergens, complete } = recipeAllergens(recipe, preparationsById, ingredientsById);
  const allergenText = allergens.length
    ? `Contient : ${allergens.map((a) => allergenLabels.get(a) ?? a).join(', ')}.`
    : complete
      ? 'Aucun des 14 allergènes réglementaires dans les ingrédients.'
      : 'Allergènes impossibles à vérifier : un ingrédient est inconnu.';

  const preparationsHtml = recipe.preparations
    .map((line) => {
      const prep = preparationsById.get(line.preparationId);
      if (!prep) return '';
      const others = (shared.get(prep.id) ?? [])
        .filter((id) => id !== recipe.id)
        .map((id) => recipesById.get(id))
        .filter((r) => r !== undefined);
      return `
        <details class="prep">
          <summary><span class="ingredients__qty">${escapeHtml(formatQuantity(line.quantity, line.unit))}</span> ${escapeHtml(prep.name.toLowerCase())}</summary>
          <p class="hint">Donne ${escapeHtml(formatQuantity(prep.yield.quantity, prep.yield.unit))} en ${escapeHtml(formatMinutes(totalMinutes(prep)))}.</p>
          ${ingredientsHtml(prep.ingredients)}
          ${methodsHtml(prep.methods, 'h3')}
        </details>
        ${
          others.length
            ? `<p class="batch">À préparer en une fois : ${escapeHtml(prep.name.toLowerCase())} sert aussi pour ${others
                .map((r) => `<a href="#/recettes/${encodeURIComponent(r.id)}">${escapeHtml(r.name)}</a>`)
                .join(', ')}.</p>`
            : ''
        }`;
    })
    .join('');

  el.innerHTML = `
    <article class="recipe">
      <p><a href="#/recettes" class="back">Toutes les recettes</a></p>
      <h1 class="page-title">${escapeHtml(recipe.name)}</h1>
      <p>${escapeHtml(recipe.description)}</p>
      <dl class="recipe__facts">
        <div><dt>Cuisine</dt><dd>${escapeHtml(cuisineLabels.get(recipe.cuisine) ?? '')}</dd></div>
        <div><dt>Portions</dt><dd>${recipe.servings} adultes</dd></div>
        <div><dt>Préparation</dt><dd>${escapeHtml(formatMinutes(recipe.prepMinutes))}</dd></div>
        <div><dt>Cuisson</dt><dd>${escapeHtml(formatMinutes(recipe.cookMinutes))}</dd></div>
        <div><dt>Difficulté</dt><dd>${escapeHtml(DIFFICULTY_LABELS[recipe.difficulty])}</dd></div>
        ${recipe.vessel ? `<div><dt>Vaisselle</dt><dd>${escapeHtml(VESSEL_LABELS[recipe.vessel])}</dd></div>` : ''}
      </dl>

      ${fitHtml}
      <div class="allergens" role="note">
        <p><strong>${escapeHtml(allergenText)}</strong></p>
        <p class="hint">${escapeHtml(PRODUCT_LABEL_WARNING)}</p>
      </div>

      <h2>Ingrédients pour ${recipe.servings} portions</h2>
      ${ingredientsHtml(recipe.ingredients)}
      ${recipe.preparations.length ? `<h2>Préparé à l’avance</h2>${preparationsHtml}` : ''}

      ${methodsHtml(recipe.methods, 'h2')}

      ${recipe.tips.length ? `<h2>Bon à savoir</h2>${recipe.tips.map((t) => `<p>${escapeHtml(t)}</p>`).join('')}` : ''}

      <p class="hint source">Source : ${escapeHtml(recipe.source.license)}.</p>
    </article>
  `;
}
