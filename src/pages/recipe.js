import { escapeHtml } from '../utils/html.js';
import { formatMinutes, formatNumber } from '../utils/format.js';
import { formatQuantity } from '../utils/quantity.js';
import { ALLERGENS, PRODUCT_LABEL_WARNING } from '../domain/ingredients/allergens.js';
import { equipmentLabel } from '../domain/recipes/equipment.js';
import {
  DIFFICULTY_LABELS,
  VESSEL_LABELS,
  findSharedPreparations,
  MEAL_TYPES,
  RECIPE_TAGS,
  recipeAllergens,
  recipeMealTypes,
  totalMinutes,
} from '../domain/recipes/recipes.js';
import { recipes, recipesById, preparationsById, ingredientsById, cuisineLabels, nutritionContext } from '../services/catalog.js';
import { recipeNutrition, roundNutrients, portionLines } from '../domain/nutrition/nutrition.js';
import { personalPortion } from '../domain/nutrition/program.js';
import { programSummary } from '../services/programService.js';
import { loadAvailability, getAvailabilityOverrides, setAvailabilityOverride } from '../services/territoryService.js';
import { recipeLocalIssues } from '../domain/ingredients/territory.js';
import { substitutesFor } from '../domain/assistant/substitutes.js';
import { GUYANE_HINTS, WHERE_LABELS } from '../data/territory.js';
import { seasonNow } from '../services/seasonService.js';
import { seasonalIngredients } from '../domain/ingredients/seasons.js';
import { getHousehold } from '../services/householdService.js';
import { evaluateRecipeForHousehold } from '../domain/household/compatibility.js';
import { DIETS } from '../domain/household/household.js';

/** @typedef {import('../domain/recipes/recipes.js').IngredientLine} IngredientLine */
/** @typedef {import('../domain/recipes/recipes.js').CookingMethod} CookingMethod */

const allergenLabels = new Map(ALLERGENS.map((a) => [a.id, a.label]));
const dietLabels = new Map(DIETS.map((d) => [d.id, d.label.toLowerCase()]));
const mealTypeLabels = new Map(MEAL_TYPES.map((t) => [t.id, t.label]));
const tagLabels = new Map(RECIPE_TAGS.map((t) => [t.id, t.label]));

/**
 * Quantites en grammes d'une portion personnelle.
 * @param {import('../domain/recipes/recipes.js').Recipe} recipe
 * @param {number} portions
 * @returns {string}
 */
function gramsHtml(recipe, portions) {
  return `<ul class="ingredients">${portionLines(recipe, portions, nutritionContext)
    .map((l) => {
      const name = l.kind === 'ingredient' ? ingredientsById.get(l.id)?.name ?? l.id : (preparationsById.get(l.id)?.name ?? l.id).toLowerCase();
      const qty = l.grams !== null ? `${l.grams} g` : formatQuantity(l.quantity, l.unit);
      return `<li><span class="ingredients__qty">${escapeHtml(qty)}</span><span>${escapeHtml(name)}</span></li>`;
    })
    .join('')}</ul>`;
}

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
      <p class="hint">Matériel : ${escapeHtml(m.equipment.length ? m.equipment.map(equipmentLabel).join(', ') : 'aucun')}</p>
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

  const [household, program, availability, overrides, season] = await Promise.all([getHousehold(), programSummary(), loadAvailability(), getAvailabilityOverrides(), seasonNow()]);
  const local = seasonalIngredients(recipe, preparationsById, season.favoured);
  const issues = recipeLocalIssues(recipe, preparationsById, availability, substitutesFor);
  /** @param {string} id */
  const nameOf = (id) => ingredientsById.get(id)?.name ?? id;
  const localHtml = issues.length
    ? `<section class="local-box" aria-labelledby="local-title">
        <h2 id="local-title">Trouver les ingrédients en Guyane</h2>
        <ul class="local-list">${issues
          .map((i) => {
            const hint = GUYANE_HINTS[i.ingredientId];
            const status =
              i.level === 'missing'
                ? 'introuvable pour vous'
                : i.level === 'rare'
                  ? 'souvent introuvable en Guyane'
                  : hint?.where
                    ? WHERE_LABELS[hint.where]
                    : 'magasin spécialisé';
            const own = overrides[i.ingredientId];
            return `<li>
              <p><strong>${escapeHtml(nameOf(i.ingredientId))}</strong> : ${escapeHtml(status)}${own ? ' (votre réponse)' : ''}.
                ${i.substitute ? `Alternative : <strong>${escapeHtml(nameOf(i.substitute))}</strong>${i.inPreparation ? ' (dans une préparation de base : à remplacer vous-même)' : ''}.` : 'Pas d’alternative connue.'}</p>
              <p class="row-actions">
                ${own !== 'found' ? `<button type="button" class="button button--small button--secondary" data-local="${escapeHtml(i.ingredientId)}" data-value="found">Je le trouve</button>` : ''}
                ${own !== 'missing' ? `<button type="button" class="button button--small button--secondary" data-local="${escapeHtml(i.ingredientId)}" data-value="missing">Introuvable pour moi</button>` : ''}
                ${own ? `<button type="button" class="button button--small button--secondary" data-local="${escapeHtml(i.ingredientId)}" data-value="">Annuler ma réponse</button>` : ''}
              </p>
            </li>`;
          })
          .join('')}</ul>
        <p class="hint">Indications générales, non vérifiées magasin par magasin : vos réponses priment. Un ingrédient « introuvable pour moi » est remplacé par son alternative dans les repas proposés par l’assistant et sur la liste de courses ; sans alternative, la recette n’est plus proposée.</p>
      </section>`
    : '';
  const nutrition = recipeNutrition(recipe, nutritionContext);
  const perPortion = roundNutrients(nutrition.perPortion);
  const types = recipeMealTypes(recipe);
  /** @type {{ slot: 'breakfast' | 'lunch' | 'snack' | 'dinner', label: string, kcal: number, portion: ReturnType<typeof personalPortion> }[]} */
  const personal = program
    ? MEAL_TYPES.filter((t) => types.includes(t.id) && program.program.mealSplit[t.id] > 0).map((t) => ({
        slot: t.id,
        label: t.label,
        kcal: program.meals[t.id].kcal,
        portion: personalPortion(nutrition.perPortion, program.meals[t.id].kcal),
      }))
    : [];
  const personalHtml = personal.length
    ? `<section class="portion-box" aria-labelledby="portion-title">
        <h2 id="portion-title">Votre portion (programme minceur)</h2>
        ${personal
          .map(
            (p, i) => `<details class="prep"${i === 0 ? ' open' : ''}>
              <summary>${escapeHtml(p.label)} : ${escapeHtml(formatNumber(p.portion.portions))} portion, environ ${p.portion.kcal} kcal et ${p.portion.protein} g de protéines</summary>
              ${p.portion.fits ? '' : `<p class="hint">${p.portion.portions >= 1.6 ? 'Recette légère pour ce repas : ajoutez un laitage, un fruit ou du pain complet pour atteindre' : 'Recette riche pour ce repas : même une demi-portion dépasse'} l’objectif de ${p.kcal} kcal.</p>`}
              ${gramsHtml(recipe, p.portion.portions)}
            </details>`,
          )
          .join('')}
        <p class="hint">Quantités crues, en grammes, pour votre assiette : pesez-les ou servez-vous en conséquence. Les légumes peuvent être augmentés à volonté.</p>
      </section>`
    : '';
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
      <h1 class="page-title">${escapeHtml(recipe.name)}</h1>
      <p>${escapeHtml(recipe.description)}</p>
      <dl class="recipe__facts">
        <div><dt>Cuisine</dt><dd>${escapeHtml(cuisineLabels.get(recipe.cuisine) ?? '')}</dd></div>
        <div><dt>Portions</dt><dd>${recipe.servings} adultes</dd></div>
        <div><dt>Préparation</dt><dd>${escapeHtml(formatMinutes(recipe.prepMinutes))}</dd></div>
        <div><dt>Cuisson</dt><dd>${escapeHtml(formatMinutes(recipe.cookMinutes))}</dd></div>
        <div><dt>Difficulté</dt><dd>${escapeHtml(DIFFICULTY_LABELS[recipe.difficulty])}</dd></div>
        ${recipe.vessel ? `<div><dt>Vaisselle</dt><dd>${escapeHtml(VESSEL_LABELS[recipe.vessel])}</dd></div>` : ''}
        <div><dt>Repas</dt><dd>${escapeHtml(types.map((t) => mealTypeLabels.get(t)).join(', '))}</dd></div>
      </dl>
      ${(recipe.tags ?? []).length ? `<p>${(recipe.tags ?? []).map((t) => `<span class="tag">${escapeHtml(tagLabels.get(t) ?? t)}</span>`).join(' ')}</p>` : ''}
      ${local.length ? `<p class="hint">De saison ou péyi en ce moment : ${escapeHtml(local.map((id) => ingredientsById.get(id)?.name ?? id).join(', '))}. <a href="#/saison">Produits de saison</a></p>` : ''}

      ${fitHtml}
      <div class="allergens" role="note">
        <p><strong>${escapeHtml(allergenText)}</strong></p>
        <p class="hint">${escapeHtml(PRODUCT_LABEL_WARNING)}</p>
      </div>

      ${personalHtml}
      ${localHtml}

      <h2>Ingrédients pour ${recipe.servings} portions</h2>
      ${ingredientsHtml(recipe.ingredients)}
      ${recipe.preparations.length ? `<h2>Préparé à l’avance</h2>${preparationsHtml}` : ''}

      ${methodsHtml(recipe.methods, 'h2')}

      <h2>Valeurs nutritionnelles d’une portion</h2>
      <dl class="facts">
        <div><dt>Énergie</dt><dd>${Math.round(perPortion.kcal)} kcal</dd></div>
        <div><dt>Protéines</dt><dd>${escapeHtml(formatNumber(perPortion.protein))} g</dd></div>
        <div><dt>Glucides</dt><dd>${escapeHtml(formatNumber(perPortion.carbs))} g</dd></div>
        <div><dt>Lipides</dt><dd>${escapeHtml(formatNumber(perPortion.fat))} g</dd></div>
        <div><dt>Fibres</dt><dd>${escapeHtml(formatNumber(perPortion.fiber))} g</dd></div>
      </dl>
      <p class="hint">Estimation calculée à partir des tables de composition des aliments (valeurs moyennes, ingrédients crus)${
        nutrition.complete ? '' : ' ; certains ingrédients en petite quantité ou « selon le goût » ne sont pas comptés'
      }. Les produits que vous achetez peuvent différer : l’étiquette fait foi.</p>

      ${recipe.tips.length ? `<h2>Bon à savoir</h2>${recipe.tips.map((t) => `<p>${escapeHtml(t)}</p>`).join('')}` : ''}

      <p class="hint source">Source : ${escapeHtml(recipe.source.license)}.</p>
    </article>
  `;

  el.querySelectorAll('[data-local]').forEach((button) =>
    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-value');
      await setAvailabilityOverride(button.getAttribute('data-local') ?? '', value === 'found' || value === 'missing' ? value : null);
      await renderRecipe(el, params);
      el.querySelector('.local-box')?.scrollIntoView({ block: 'center' });
    }),
  );
}
