/**
 * Familles de plats : chaque recette appartient a UNE seule famille, pour ranger
 * le catalogue sans doublons. Le moment du repas (dejeuner, diner...) reste une
 * information de planification, pas un rangement.
 */
import { normalizeText } from '../ingredients/ingredients.js';
import { recipeMealTypes } from './recipes.js';

/** @typedef {import('./recipes.js').Recipe} Recipe */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */

/**
 * @typedef {'breakfast' | 'tarts' | 'oven' | 'soups' | 'salads' | 'eggs' | 'starches' | 'street' | 'fish' | 'poultry' | 'meat' | 'veggie' | 'sweets'} FamilyId
 */

/** Ordre d'affichage. @type {{ id: FamilyId, label: string }[]} */
export const FAMILIES = [
  { id: 'tarts', label: 'Quiches, tartes, pizzas et feuilletés' },
  { id: 'oven', label: 'Gratins et plats au four' },
  { id: 'soups', label: 'Soupes et bouillons' },
  { id: 'salads', label: 'Salades et bowls' },
  { id: 'eggs', label: 'Œufs, omelettes et galettes' },
  { id: 'starches', label: 'Pâtes, riz et nouilles' },
  { id: 'street', label: 'Sandwichs, wraps et burgers' },
  { id: 'poultry', label: 'Volailles' },
  { id: 'meat', label: 'Viandes' },
  { id: 'fish', label: 'Poissons et fruits de mer' },
  { id: 'veggie', label: 'Plats végétariens' },
  { id: 'breakfast', label: 'Petit-déjeuner' },
  { id: 'sweets', label: 'Goûters et desserts' },
];

/** @type {Set<string>} */
const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));

/**
 * Mots du nom qui designent la famille (testes dans cet ordre, sans accents).
 * @type {[FamilyId, RegExp][]}
 */
const NAME_RULES = [
  ['soups', /\b(soupe|veloute|potage|bouillon|pho|ramen|tom yum|tom kha|harira|sinigang|chorba|minestrone|laksa|gaspacho|gazpacho|consomme|soupou|bouillabaisse|caldo|chowder|jjigae|soto ayam|tinola|kalguksu|yukgaejang|ribollita|sopa)\b/],
  ['street', /\b(burgers?|sandwichs?|wraps?|tacos|burritos?|banh mi|quesadillas?|kebabs?|hot dogs?|bokits?|croque|pitas?|fajitas?|baos?|sloppy joes|shawarma)\b/],
  ['tarts', /\b(quiches?|tartes? salees?|tarte fine|tourtes?|pizzas?|pissaladiere|flammekueche|feuilletes?|cake (sale|courgette|jambon|olive|thon|legume)s?|pates creoles|empanadas?|samosas?|spanakopita|pastels?)\b/],
  ['salads', /\b(salades?|bowls?|poke|taboule|fattoush|som tam|yam nuea|yam woon sen|goi|ceviche|tartare|bibimbap|panzanella)\b/],
  ['oven', /\b(gratins?|gratine|lasagnes?|parmentier|moussaka|hachis|au four|roti de|poulet roti|clafoutis sale|papillotes?|enchiladas?|plaki|en plaque)\b/],
  ['eggs', /\b(omelettes?|frittata|oeufs (brouilles|cocotte|mimosa|au plat|poches|sautes)|et oeufs|tortilla de patatas|chakchouka|shakshuka|menemen|huevos|kai jeow|tamagoyaki|curry d'oeufs|gyeran|pisto|piperade|galette complete|crepes? (jambon|salees?)|muffins d'oeufs|okonomiyaki|banh xeo|pajeon|jeon)\b/],
  ['starches', /\b(pates|spaghettis?|penne|tagliatelles?|macaronis?|fusilli|linguine|nouilles|risotto|paella|pad thai|pad see ew|pad woon sen|bami|nasi|biryani|udon|soba|lo mein|chow mein|pilaf|pulao|jambalaya|couscous|gnocchis?|japchae|mie goreng|mi xao|ravioli|carbonara|bolognaise|arroz|congee|khichdi|char kway teow|jjajangmyeon|mac and cheese|galinhada|pancit)\b|^ riz\b/],
];

/** Douceurs : un plat de gouter aussi propose au petit-dejeuner reste un dessert. */
const SWEETS = /\b(cake|gateau|tarte|clafoutis|mousse|flan|cookie|brownie|muffin|crumble|compote|beignet|madeleine|sorbet|glace|fondant|banane flambee)/;

/** Ingredients qui ne font pas d'un plat un plat de poisson ou de viande. */
const SEASONINGS = new Set(['fish_sauce', 'oyster_sauce', 'curry_paste_red', 'curry_paste_green', 'curry_paste_yellow', 'massaman_paste', 'kimchi', 'chicken_stock']);

/**
 * Grammes approximatifs d'une ligne d'ingredient (pour comparer viande et poisson).
 * @param {{ quantity: number | null, unit: string }} line
 * @returns {number}
 */
function approxGrams(line) {
  const q = line.quantity ?? 0;
  if (line.unit === 'g' || line.unit === 'ml') return q;
  if (line.unit === 'kg' || line.unit === 'l') return q * 1000;
  if (line.unit === 'piece') return q * 150;
  return 50;
}

/**
 * Famille d'une recette. Un champ « family » explicite (recettes ajoutees, recettes
 * personnelles) l'emporte ; sinon : moment du repas, nom du plat, puis proteine principale.
 * @param {Recipe} recipe
 * @param {Map<string, Ingredient>} ingredients
 * @returns {FamilyId}
 */
export function recipeFamily(recipe, ingredients) {
  if (recipe.family && FAMILY_IDS.has(recipe.family)) return /** @type {FamilyId} */ (recipe.family);
  const types = recipeMealTypes(recipe);
  const main = types.includes('lunch') || types.includes('dinner');
  const name = ` ${normalizeText(recipe.name)} `;
  if (!main) return types.includes('breakfast') && !(types.includes('snack') && SWEETS.test(name)) ? 'breakfast' : 'sweets';
  if (types.includes('breakfast') && /\b(tartines?|porridge|toast|petit-dejeuner)\b/.test(name)) return 'breakfast';
  for (const [family, rule] of NAME_RULES) if (rule.test(name)) return family;
  /** @type {Record<'fish' | 'poultry' | 'meat', number>} */
  const grams = { fish: 0, poultry: 0, meat: 0 };
  for (const line of recipe.ingredients) {
    if (SEASONINGS.has(line.ingredientId)) continue;
    const cats = /** @type {string[]} */ (ingredients.get(line.ingredientId)?.categories ?? []);
    if (cats.includes('fish') || cats.includes('shellfish')) grams.fish += approxGrams(line);
    else if (cats.includes('poultry')) grams.poultry += approxGrams(line);
    else if (cats.includes('meat')) grams.meat += approxGrams(line);
  }
  const best = /** @type {('fish' | 'poultry' | 'meat')[]} */ (['poultry', 'meat', 'fish']).sort((a, b) => grams[b] - grams[a])[0];
  return grams[best] > 0 ? best : 'veggie';
}

/**
 * Libelle d'une famille.
 * @param {string} id
 * @returns {string}
 */
export function familyLabel(id) {
  return FAMILIES.find((f) => f.id === id)?.label ?? id;
}
