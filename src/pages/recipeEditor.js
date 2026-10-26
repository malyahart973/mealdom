import { escapeHtml } from '../utils/html.js';
import { toIsoDate } from '../domain/planning/dates.js';
import { MEAL_TYPES, RECIPE_TAGS, DIFFICULTY_LABELS } from '../domain/recipes/recipes.js';
import { FAMILIES, recipeFamily } from '../domain/recipes/families.js';
import { EQUIPMENT } from '../domain/recipes/equipment.js';
import { DRAFT_UNITS, buildUserRecipe } from '../domain/recipes/recipeImport.js';
import { getUnit } from '../domain/units/units.js';
import { normalizeText } from '../domain/ingredients/ingredients.js';
import { CUISINES } from '../data/cuisines.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { recipesById, ingredientsById } from '../services/catalog.js';
import { saveUserRecipe, draftFromText, draftFromUrl, draftFromPhoto, canImportWithAi, findIngredient } from '../services/userRecipeService.js';

/** @typedef {import('../domain/recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../domain/recipes/recipeImport.js').RecipeDraft} RecipeDraft */
/** @typedef {{ name: string, quantity: number | null, unit: string, known: boolean }} Row */

/** Nom affiche -> ingredient (noms du catalogue, sans accents ni majuscules). */
const byName = new Map(INGREDIENTS.map((i) => [normalizeText(i.name), i.id]));

/**
 * Ingredient du catalogue pour un nom saisi : nom exact de la liste, sinon recherche.
 * @param {string} name
 * @returns {string | null}
 */
function resolveIngredient(name) {
  const key = normalizeText(name.trim());
  return key ? byName.get(key) ?? findIngredient(name) : null;
}

/**
 * @param {number} index
 * @param {Row} row
 * @returns {string}
 */
function rowHtml(index, row) {
  const qualitative = getUnit(row.unit)?.kind === 'qualitative';
  return `<li class="ing-row${row.known || !row.name ? '' : ' ing-row--unknown'}">
    <label class="visually-hidden" for="ing-name-${index}">Ingrédient ${index + 1}</label>
    <input id="ing-name-${index}" class="ing-row__name" type="text" list="ingredient-names" autocomplete="off" placeholder="Ingrédient" value="${escapeHtml(row.name)}" />
    <label class="visually-hidden" for="ing-qty-${index}">Quantité</label>
    <input id="ing-qty-${index}" class="ing-row__qty" type="text" inputmode="decimal" autocomplete="off" placeholder="Qté" value="${row.quantity !== null && !qualitative ? escapeHtml(String(row.quantity).replace('.', ',')) : ''}" />
    <label class="visually-hidden" for="ing-unit-${index}">Unité</label>
    <select id="ing-unit-${index}" class="ing-row__unit">${DRAFT_UNITS.map((u) => `<option value="${u}"${u === row.unit ? ' selected' : ''}>${escapeHtml(getUnit(u)?.label ?? u)}</option>`).join('')}</select>
    <button type="button" class="ing-row__remove" data-remove aria-label="Retirer cet ingrédient">✕</button>
    ${row.known || !row.name ? '' : '<p class="hint ing-row__hint">Pas dans la liste : choisissez l’ingrédient le plus proche, sinon il sera gardé en note.</p>'}
  </li>`;
}

/**
 * Lignes du formulaire a partir d'une recette lue (texte, lien ou photo).
 * @param {RecipeDraft} draft
 * @returns {Row[]}
 */
function draftRows(draft) {
  return draft.ingredients.map((i) => {
    const id = i.ingredientId ?? null;
    return { name: id ? ingredientsById.get(id)?.name ?? i.name : i.raw || i.name, quantity: i.quantity, unit: i.unit, known: id !== null };
  });
}

/**
 * Ecran « Ma recette » : saisie, modification et import.
 * Adresses : #/recettes/nouvelle, #/recettes/modifier/<id>
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderRecipeEditor(el, params) {
  const existing = params.id ? recipesById.get(params.id) : undefined;
  if (params.id && (!existing || existing.source.type !== 'personal')) {
    el.innerHTML = `<section><h1 class="page-title">Ma recette</h1><p>Seules vos recettes personnelles peuvent être modifiées.</p><a class="button" href="#/recettes">Recettes</a></section>`;
    return;
  }
  const ai = await canImportWithAi();
  /** @type {Row[]} */
  let rows = existing
    ? existing.ingredients.map((l) => ({ name: ingredientsById.get(l.ingredientId)?.name ?? l.ingredientId, quantity: l.quantity, unit: l.unit, known: true }))
    : [{ name: '', quantity: null, unit: 'g', known: true }];
  const robot = existing?.methods.find((m) => m.equipment.includes('food_processor') && m.id === 'food_processor');
  const main = existing?.methods.find((m) => m !== robot);
  let sourceUrl = '';
  /** @type {string[]} */
  let otherIngredients = [];

  el.innerHTML = `
    <section class="recipe-editor">
      <h1 class="page-title">${existing ? 'Modifier ma recette' : 'Nouvelle recette'}</h1>
      ${
        existing
          ? ''
          : `<details class="import" open>
              <summary>Importer une recette</summary>
              <div class="import__block">
                <label for="imp-text"><strong>Coller le texte</strong> d’une recette (site, message, livre…)</label>
                <textarea id="imp-text" rows="5" placeholder="Copiez la recette entière (titre, ingrédients, étapes) et collez-la ici."></textarea>
                <button type="button" class="button button--secondary button--small" data-import="text">Lire le texte</button>
                <p class="hint">Fonctionne sans Internet et sans IA.</p>
              </div>
              <div class="import__block">
                <label for="imp-url"><strong>Lien</strong> d’une page de recette</label>
                <input id="imp-url" type="url" inputmode="url" autocomplete="off" placeholder="https://…" />
                <button type="button" class="button button--secondary button--small" data-import="url">Lire la page</button>
                <p class="hint">${ai ? 'La page est lue par l’IA (Anthropic), puis vous vérifiez tout avant d’enregistrer.' : 'Demande la clé IA (Paramètres). Sans IA : copiez le texte de la page et collez-le ci-dessus.'}</p>
              </div>
              <div class="import__block">
                <input id="imp-photo" type="file" accept="image/*" class="visually-hidden" />
                <label for="imp-photo" class="button button--secondary button--small">Photo ou capture d’écran</label>
                <p class="hint">${ai ? 'Livre, fiche ou capture d’écran (par exemple une recette Cookidoo affichée sur votre téléphone) : l’IA la recopie, vous vérifiez.' : 'Demande la clé IA (Paramètres).'} Pour votre usage personnel.</p>
              </div>
              <p class="status import__status" aria-live="polite"></p>
            </details>`
      }
      <form class="recipe-form" novalidate>
        <div class="field"><label for="rf-name">Nom de la recette</label><input id="rf-name" type="text" maxlength="90" autocomplete="off" value="${escapeHtml(existing?.name ?? '')}" required /></div>
        <div class="field"><label for="rf-desc">Description (facultatif)</label><input id="rf-desc" type="text" maxlength="200" autocomplete="off" value="${escapeHtml(existing?.description ?? '')}" /></div>
        <div class="filters">
          <div class="field field--inline"><label for="rf-family">Famille</label>
            <select id="rf-family">${FAMILIES.map((f) => `<option value="${f.id}"${f.id === (existing?.family ?? 'veggie') ? ' selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}</select></div>
          <div class="field field--inline"><label for="rf-cuisine">Cuisine</label>
            <select id="rf-cuisine">${CUISINES.map((c) => `<option value="${c.id}"${c.id === (existing?.cuisine ?? 'french') ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}</select></div>
          <div class="field field--inline"><label for="rf-servings">Portions</label><input id="rf-servings" type="number" min="1" max="20" inputmode="numeric" value="${existing?.servings ?? 4}" /></div>
          <div class="field field--inline"><label for="rf-level">Difficulté</label>
            <select id="rf-level">${Object.entries(DIFFICULTY_LABELS).map(([id, label]) => `<option value="${id}"${id === (existing?.difficulty ?? 'easy') ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>
          <div class="field field--inline"><label for="rf-prep">Préparation (min)</label><input id="rf-prep" type="number" min="0" max="600" inputmode="numeric" value="${existing?.prepMinutes ?? 15}" /></div>
          <div class="field field--inline"><label for="rf-cook">Cuisson (min)</label><input id="rf-cook" type="number" min="0" max="900" inputmode="numeric" value="${existing?.cookMinutes ?? 20}" /></div>
        </div>
        <fieldset class="field checks"><legend>Moments du repas</legend>
          ${MEAL_TYPES.map((t) => `<label class="check"><input type="checkbox" name="meal" value="${t.id}"${(existing?.mealTypes ?? ['lunch', 'dinner']).includes(t.id) ? ' checked' : ''} /> <span>${escapeHtml(t.label)}</span></label>`).join('')}
        </fieldset>
        <fieldset class="field checks"><legend>Style (facultatif)</legend>
          ${RECIPE_TAGS.map((t) => `<label class="check"><input type="checkbox" name="tag" value="${t.id}"${(existing?.tags ?? []).includes(t.id) ? ' checked' : ''} /> <span>${escapeHtml(t.label)}</span></label>`).join('')}
        </fieldset>

        <h2>Ingrédients</h2>
        <p class="hint">Choisissez chaque ingrédient dans la liste proposée : c’est ce qui permet de calculer les courses, les portions et les calories.</p>
        <datalist id="ingredient-names">${INGREDIENTS.map((i) => `<option value="${escapeHtml(i.name)}"></option>`).join('')}</datalist>
        <ol class="ing-rows"></ol>
        <p><button type="button" class="button button--secondary button--small" data-add-row>+ Ajouter un ingrédient</button></p>

        <h2>Étapes</h2>
        <div class="field"><label for="rf-steps">Une étape par ligne</label>
          <textarea id="rf-steps" rows="7">${escapeHtml((main?.steps ?? []).join('\n'))}</textarea></div>
        <fieldset class="field checks"><legend>Matériel</legend>
          ${EQUIPMENT.filter((e) => e.id !== 'food_processor').map((e) => `<label class="check"><input type="checkbox" name="equip" value="${e.id}"${(main?.equipment ?? ['stovetop']).includes(e.id) ? ' checked' : ''} /> <span>${escapeHtml(e.label)}</span></label>`).join('')}
        </fieldset>
        <div class="field"><label for="rf-robot">Au robot cuiseur (Thermomix), une étape par ligne (facultatif)</label>
          <textarea id="rf-robot" rows="4" placeholder="ex. Mixer 5 s, vitesse 5.">${escapeHtml((robot?.steps ?? []).join('\n'))}</textarea></div>

        <div class="alert" role="alert" hidden></div>
        <div class="form-actions">
          <button type="submit" class="button">Enregistrer</button>
          <a class="button button--secondary" href="${existing ? `#/recettes/${encodeURIComponent(existing.id)}` : '#/recettes'}">Annuler</a>
        </div>
      </form>
    </section>`;

  const form = /** @type {HTMLFormElement} */ (el.querySelector('.recipe-form'));
  const list = /** @type {HTMLElement} */ (el.querySelector('.ing-rows'));
  const alert = /** @type {HTMLElement} */ (el.querySelector('.alert'));
  /** @param {string} id */
  const input = (id) => /** @type {HTMLInputElement} */ (el.querySelector(`#${id}`));

  /** Relit les lignes saisies (avant de redessiner la liste). */
  const readRows = () => {
    rows = [...list.querySelectorAll('.ing-row')].map((li) => {
      const name = /** @type {HTMLInputElement} */ (li.querySelector('.ing-row__name')).value;
      const qtyText = /** @type {HTMLInputElement} */ (li.querySelector('.ing-row__qty')).value.trim().replace(',', '.');
      const unit = /** @type {HTMLSelectElement} */ (li.querySelector('.ing-row__unit')).value;
      const quantity = qtyText && Number.isFinite(Number(qtyText)) ? Number(qtyText) : null;
      return { name, quantity, unit, known: !name.trim() || resolveIngredient(name) !== null };
    });
  };
  const drawRows = () => {
    list.innerHTML = rows.map((row, i) => rowHtml(i, row)).join('');
    list.querySelectorAll('[data-remove]').forEach((b, i) =>
      b.addEventListener('click', () => {
        readRows();
        rows.splice(i, 1);
        if (!rows.length) rows.push({ name: '', quantity: null, unit: 'g', known: true });
        drawRows();
      }),
    );
    list.querySelectorAll('.ing-row__name').forEach((field) =>
      field.addEventListener('change', () => {
        const li = /** @type {HTMLElement} */ (field.closest('.ing-row'));
        const known = !(/** @type {HTMLInputElement} */ (field)).value.trim() || resolveIngredient(/** @type {HTMLInputElement} */ (field).value) !== null;
        li.classList.toggle('ing-row--unknown', !known);
        li.querySelector('.ing-row__hint')?.remove();
      }),
    );
  };
  drawRows();
  el.querySelector('[data-add-row]')?.addEventListener('click', () => {
    readRows();
    rows.push({ name: '', quantity: null, unit: 'g', known: true });
    drawRows();
    /** @type {HTMLInputElement | null} */ (list.querySelector('.ing-row:last-child .ing-row__name'))?.focus();
  });

  /**
   * Remplit le formulaire avec une recette lue.
   * @param {RecipeDraft} draft
   */
  const fill = (draft) => {
    if (draft.name) input('rf-name').value = draft.name;
    if (draft.servings) input('rf-servings').value = String(draft.servings);
    if (draft.prepMinutes !== null) input('rf-prep').value = String(draft.prepMinutes);
    if (draft.cookMinutes !== null) input('rf-cook').value = String(draft.cookMinutes);
    rows = draftRows(draft);
    if (!rows.length) rows.push({ name: '', quantity: null, unit: 'g', known: true });
    drawRows();
    /** @type {HTMLTextAreaElement} */ (el.querySelector('#rf-steps')).value = draft.steps.join('\n');
    /** @type {HTMLTextAreaElement} */ (el.querySelector('#rf-robot')).value = draft.robotSteps.join('\n');
    sourceUrl = draft.sourceUrl ?? '';
    // Famille proposee d'apres le nom et les ingredients reconnus (modifiable).
    const guess = recipeFamily(
      {
        id: 'draft', name: draft.name, description: '', cuisine: 'french', servings: 4, prepMinutes: 0, cookMinutes: 0, difficulty: 'easy', vessel: null,
        ingredients: draft.ingredients.flatMap((i) => (i.ingredientId ? [{ ingredientId: i.ingredientId, quantity: i.quantity, unit: i.unit }] : [])),
        preparations: [], methods: [], tips: [], source: { type: 'personal', author: '', license: '', addedAt: '' }, status: 'draft',
      },
      ingredientsById,
    );
    /** @type {HTMLSelectElement} */ (el.querySelector('#rf-family')).value = guess;
    const unknown = rows.filter((r) => !r.known).length;
    return unknown ? ` ${unknown} ingrédient(s) à choisir dans la liste (en rouge).` : '';
  };

  const status = /** @type {HTMLElement | null} */ (el.querySelector('.import__status'));
  /**
   * @param {() => Promise<{ draft: RecipeDraft | null, error: string | null }>} read
   * @param {string} waiting
   */
  const runImport = async (read, waiting) => {
    if (!status) return;
    status.textContent = waiting;
    const { draft, error } = await read();
    if (!draft) {
      status.textContent = error ?? 'Aucune recette lisible.';
      return;
    }
    const extra = fill(draft);
    status.textContent = `Recette lue : vérifiez chaque champ avant d’enregistrer.${extra}`;
    form.scrollIntoView({ block: 'start' });
  };
  el.querySelector('[data-import="text"]')?.addEventListener('click', () => {
    const text = /** @type {HTMLTextAreaElement} */ (el.querySelector('#imp-text')).value;
    if (!text.trim()) {
      if (status) status.textContent = 'Collez d’abord le texte de la recette.';
      return;
    }
    runImport(async () => {
      const draft = draftFromText(text);
      return draft.ingredients.length || draft.steps.length ? { draft, error: null } : { draft: null, error: 'Je n’ai trouvé ni ingrédients ni étapes dans ce texte.' };
    }, 'Lecture du texte…');
  });
  el.querySelector('[data-import="url"]')?.addEventListener('click', () => {
    const url = input('imp-url').value.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(url)) {
      if (status) status.textContent = 'Collez l’adresse complète de la page (elle commence par https://).';
      return;
    }
    runImport(() => draftFromUrl(url), 'Lecture de la page par l’IA… (quelques secondes)');
  });
  el.querySelector('#imp-photo')?.addEventListener('change', (event) => {
    const field = /** @type {HTMLInputElement} */ (event.target);
    const file = field.files?.[0];
    if (!file) return;
    runImport(async () => {
      const result = await draftFromPhoto(file);
      field.value = '';
      return result;
    }, 'Lecture de la photo par l’IA…');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.hidden = true;
    readRows();
    const filled = rows.filter((r) => r.name.trim());
    const unknown = filled.filter((r) => resolveIngredient(r.name) === null);
    if (unknown.length && !window.confirm(`${unknown.length} ingrédient(s) ne sont pas dans la liste (${unknown.map((r) => r.name).join(', ')}). Ils seront gardés en note, sans être comptés dans les courses ni les calories. Enregistrer quand même ?`)) return;
    /** @type {import('../domain/recipes/recipes.js').IngredientLine[]} */
    const lines = [];
    /** @type {string[]} */
    const problems = [];
    for (const r of filled) {
      const id = resolveIngredient(r.name);
      if (!id) continue;
      const qualitative = getUnit(r.unit)?.kind === 'qualitative';
      if (!qualitative && (r.quantity === null || !(r.quantity > 0))) problems.push(`Quantité manquante pour « ${r.name} » (ou choisissez « au goût »).`);
      lines.push({ ingredientId: id, quantity: qualitative ? null : r.quantity, unit: r.unit });
    }
    otherIngredients = unknown.map((r) => [r.quantity ?? '', r.quantity !== null ? getUnit(r.unit)?.label ?? '' : '', r.name.trim()].filter(Boolean).join(' '));
    const data = new FormData(form);
    const mealTypes = /** @type {import('../domain/recipes/recipes.js').MealType[]} */ (data.getAll('meal').map(String));
    if (!input('rf-name').value.trim()) problems.push('Donnez un nom à la recette.');
    if (!mealTypes.length) problems.push('Cochez au moins un moment du repas.');
    if (!lines.length) problems.push('Ajoutez au moins un ingrédient de la liste.');
    const steps = /** @type {HTMLTextAreaElement} */ (el.querySelector('#rf-steps')).value.split('\n').map((s) => s.replace(/^\s*\d+\s*[.)-]\s*/, '').trim()).filter(Boolean);
    const robotSteps = /** @type {HTMLTextAreaElement} */ (el.querySelector('#rf-robot')).value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!steps.length && !robotSteps.length) problems.push('Écrivez au moins une étape.');
    if (problems.length) return showProblems(problems);

    const recipe = buildUserRecipe(
      {
        id: existing?.id ?? `perso_${crypto.randomUUID()}`,
        name: input('rf-name').value,
        description: input('rf-desc').value,
        family: /** @type {HTMLSelectElement} */ (el.querySelector('#rf-family')).value,
        cuisine: /** @type {HTMLSelectElement} */ (el.querySelector('#rf-cuisine')).value,
        mealTypes,
        servings: Math.max(1, Math.round(Number(input('rf-servings').value) || 4)),
        prepMinutes: Math.max(0, Math.round(Number(input('rf-prep').value) || 0)),
        cookMinutes: Math.max(0, Math.round(Number(input('rf-cook').value) || 0)),
        difficulty: /** @type {'easy' | 'medium' | 'hard'} */ (/** @type {HTMLSelectElement} */ (el.querySelector('#rf-level')).value),
        tags: /** @type {import('../domain/recipes/recipes.js').RecipeTag[]} */ (data.getAll('tag').map(String)),
        ingredients: lines,
        steps,
        robotSteps,
        equipment: data.getAll('equip').map(String),
        otherIngredients: [...(existing ? existingNotes(existing) : []), ...otherIngredients],
        sourceUrl: sourceUrl || undefined,
        addedAt: existing?.source.addedAt,
      },
      toIsoDate(new Date()),
    );
    if (existing && sourceUrl === '') recipe.source = { ...recipe.source, license: existing.source.license };
    const result = await saveUserRecipe(recipe);
    if (!result.ok) return showProblems(result.errors);
    window.location.hash = `#/recettes/${encodeURIComponent(recipe.id)}`;
  });

  /** @param {string[]} problems */
  function showProblems(problems) {
    alert.innerHTML = `<p><strong>À corriger :</strong></p><ul>${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
    alert.hidden = false;
    alert.scrollIntoView({ block: 'center' });
  }
}

/**
 * Ingredients gardes en note lors d'un enregistrement precedent.
 * @param {Recipe} recipe
 * @returns {string[]}
 */
function existingNotes(recipe) {
  const prefix = 'Autres ingrédients (non comptés dans les courses ni les calories) : ';
  const tip = recipe.tips.find((t) => t.startsWith(prefix));
  return tip ? tip.slice(prefix.length).replace(/\.$/, '').split(', ').filter(Boolean) : [];
}
