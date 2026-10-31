/**
 * Conservation des plats cuisines a l'avance (batch cooking).
 * Reperes generaux pour un plat refroidi rapidement (moins de 2 heures), couvert, et garde
 * au refrigerateur a 4 °C au plus. Les valeurs restent prudentes : en cas de doute, on congele.
 * Les regles sont lisibles et testees ; une recette peut imposer les siennes (champ keeping).
 */
import { normalizeText } from '../ingredients/ingredients.js';
import { addDays, parseIsoDate } from '../planning/dates.js';

/** @typedef {import('../recipes/recipes.js').Recipe} Recipe */
/** @typedef {import('../recipes/recipes.js').Preparation} Preparation */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */

/**
 * @typedef {Object} Keeping
 * @property {boolean} batch        Se prepare a l'avance et se rechauffe bien
 * @property {number} fridgeDays    Jours au refrigerateur apres la cuisson (0 = a manger le jour meme)
 * @property {boolean} freezes      Se congele sans perdre sa texture
 * @property {string} note          Explication courte
 */

/** Duree de congelation conseillee pour un plat cuisine maison. */
export const FREEZER_MONTHS = 3;

/** Plats mijotes en sauce : se gardent et se congelent tres bien. */
const STEW = /\b(colombo|curry|caris?|carry|chili|mijotes?|tajine|daube|blanquette|bourguignon|ragouts?|dahl?|dal|rougail|fricassee|massale|stew|adobo|rendang|bolognaise|mafe|yassa|feijoada|goulash|civet|pot-au-feu|braises?|haricots rouges|ratatouille|kare|korma|masala|vindaloo|massaman|gaeng|bouillon|soupe|veloute|potage|butter chicken|rajma|paneer|saag|keema|rogan josh|karahi|nihari|kho|navarin|cassoulet|basquaise|moqueca|calalou|doro wat|picadinho|bobo|sancocho|ajiaco|loubia|lablabi|tinga|carnitas|pulled pork|mole|galbi jjim|nikujaga|cacciatore|polpette|albondigas|al sugo|parmigiana|bobotie|blaff|pimentade|dombres|chakalaka|fasolakia|briam|plaki|gemista|farcies?|pain de viande|escondidinho|hachis|parmentier|lasagnes?|moussaka)\b/;
/** Cuissons minute : croustillant ou saignant, a faire le jour meme. */
const LAST_MINUTE = /\b(frite?s?|friture|beignets?|tempura|panes?|panures?|croustillants?|steaks?|grillades?|grilles?|plancha|barbecue|brochettes?|tataki|carpaccio|tartare|ceviche|sushis?|makis?|crudites|poke|minute|accras?|nems?|rouleaux de printemps|tacos|burgers?|sandwichs?|wraps?|bokits?|croque|hot dogs?|karaage|tonkatsu|katsudon|korokke|cordons? bleus|dakgangjeong|tod man pla|lumpia|sel et poivre|poeles?|omurice|chawanmushi|soba froides|nouilles froides|hiyashi chuka|bo tai)\b/;
/** Salades qui se gardent (graines, legumineuses, feculents). */
const KEEPING_SALAD = /\b(taboule|lentilles|pois chiches|quinoa|boulgour|haricots|riz|pates|orzo|couscous)\b/;
/** Plats aux oeufs qui se gardent. */
const KEEPING_EGGS = /\b(frittata|tortilla|muffins d'oeufs|quiche|flan)\b/;
/** Gateaux et biscuits : se gardent quelques jours et se congelent. */
const BAKED = /\b(cakes?|muffins?|cookies?|biscuits?|brownies?|banana bread|madeleines?|gateaux?|granola|barres?|pain|crepes?|pancakes?|gaufres?|financiers?|sables?)\b/;
/** Desserts lactes ou cremeux : 2 jours, ne se congelent pas. */
const CREAMY = /\b(riz au lait|flan|mousse|panna cotta|creme|yaourts?|puddings?|tiramisu|entremets)\b/;
/** Fruits crus : le jour meme. */
const FRESH_FRUIT = /\b(salade de fruits|fruits frais|smoothie|jus)\b/;
/** Petit-dejeuner qui se prepare a l'avance. */
const MAKE_AHEAD_BREAKFAST = /\b(overnight|porridge|chia|granola|muffins?|cakes?|pancakes?|crepes?|banana bread|pain d'epices)\b/;

/**
 * @param {boolean} batch
 * @param {number} fridgeDays
 * @param {boolean} freezes
 * @param {string} note
 * @returns {Keeping}
 */
const keep = (batch, fridgeDays, freezes, note) => ({ batch, fridgeDays: batch ? fridgeDays : 0, freezes: batch && freezes, note });

/**
 * La recette contient-elle du poisson ou des fruits de mer ?
 * @param {Recipe} recipe
 * @param {Map<string, Ingredient>} ingredients
 * @returns {boolean}
 */
function hasSeafood(recipe, ingredients) {
  return recipe.ingredients.some((l) => (ingredients.get(l.ingredientId)?.categories ?? []).some((c) => c === 'fish' || c === 'shellfish'));
}

/**
 * Conservation d'un plat, d'apres sa famille, son nom et ses ingredients.
 * @param {Recipe} recipe
 * @param {string} family          Famille du plat (voir families.js)
 * @param {Map<string, Ingredient>} ingredients
 * @returns {Keeping}
 */
export function recipeKeeping(recipe, family, ingredients) {
  if (recipe.keeping) {
    const k = recipe.keeping;
    return keep(k.fridgeDays > 0, k.fridgeDays, k.freezes, 'Conservation indiquée dans la recette.');
  }
  const name = ` ${normalizeText(recipe.name)} `;
  const seafood = hasSeafood(recipe, ingredients);
  const stew = STEW.test(name);
  /** @type {Keeping} */
  let k;
  if (family === 'sweets') {
    if (FRESH_FRUIT.test(name)) k = keep(false, 0, false, 'Fruits frais : à préparer le jour même.');
    else if (BAKED.test(name)) k = keep(true, 3, true, 'Gâteau ou biscuit : se garde dans une boîte fermée et se congèle.');
    else if (CREAMY.test(name)) k = keep(true, 2, false, 'Dessert crémeux : 2 jours au frais, ne se congèle pas.');
    else k = keep(true, 2, false, 'Dessert : 2 jours au frais.');
  } else if (family === 'breakfast') {
    k = MAKE_AHEAD_BREAKFAST.test(name) ? keep(true, 3, BAKED.test(name), 'Se prépare la veille ou en avance.') : keep(false, 0, false, 'Petit-déjeuner à préparer le matin même.');
  } else if (LAST_MINUTE.test(name) && !stew) {
    k = keep(false, 0, false, 'Cuisson minute ou plat à assembler : meilleur préparé le jour même (ses bases peuvent être faites à l’avance).');
  } else if (family === 'salads') {
    k = KEEPING_SALAD.test(name) ? keep(true, 2, false, 'Salade de graines ou de légumineuses : se garde 2 jours, assaisonnée au dernier moment.') : keep(false, 0, false, 'Salade : à préparer le jour même.');
  } else if (family === 'eggs') {
    k = KEEPING_EGGS.test(name) ? keep(true, 2, false, 'Se garde 2 jours au frais.') : keep(false, 0, false, 'Œufs : à cuire le jour même.');
  } else if (family === 'street') {
    k = keep(false, 0, false, 'À assembler le jour même (ses bases peuvent être faites à l’avance).');
  } else if (family === 'soups' || stew) {
    k = keep(true, 3, true, 'Plat mijoté ou soupe : se garde et se congèle très bien.');
  } else if (family === 'oven' || family === 'tarts') {
    k = keep(true, 3, true, 'Gratin, tarte ou plat au four : se réchauffe au four et se congèle.');
  } else if (family === 'starches') {
    k = keep(true, 2, false, 'Riz ou pâtes : 2 jours au frais, refroidis rapidement.');
  } else {
    k = keep(true, 2, false, 'Plat cuisiné : 2 jours au frais.');
  }
  // Poisson et fruits de mer : jamais plus de 2 jours, congeles seulement en sauce.
  if (k.batch && seafood) k = keep(true, Math.min(k.fridgeDays, 2), k.freezes && (family === 'soups' || stew), `${k.note} Poisson ou fruits de mer : 2 jours au plus.`);
  return k;
}

/**
 * Conservation des preparations de base.
 * @type {Record<string, { fridgeDays: number, freezes: boolean }>}
 */
const PREPARATION_KEEPING = {
  cooked_rice: { fridgeDays: 2, freezes: true },
  shredded_chicken: { fridgeDays: 3, freezes: true },
  roasted_vegetables: { fridgeDays: 3, freezes: false },
};

/**
 * @param {Preparation} prep
 * @returns {Keeping}
 */
export function preparationKeeping(prep) {
  const k = PREPARATION_KEEPING[prep.id] ?? { fridgeDays: 2, freezes: false };
  return keep(true, k.fridgeDays, k.freezes, prep.id === 'cooked_rice' ? 'Riz : à refroidir en moins d’une heure (étalé), puis au frais.' : 'Préparation de base.');
}

/**
 * Nombre de jours entre deux dates AAAA-MM-JJ (b - a).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function daysBetween(a, b) {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (!da || !db) return 0;
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
}

/**
 * Seance de batch qui prepare un repas : la plus recente AVANT le jour du repas (le jour de la
 * seance, on cuisine de toute facon ; le soir, il est trop tard pour le dejeuner). null si aucune.
 * @param {string} date
 * @param {string[]} sessions
 * @returns {string | null}
 */
export function sessionFor(date, sessions) {
  return [...sessions].filter((s) => s < date).sort().pop() ?? null;
}

/**
 * Jour ou se fait la seance de batch.
 * @typedef {'saturday' | 'sunday' | 'monday'} BatchDay
 * @typedef {{ day: BatchDay, midweek: boolean }} BatchPlan
 */

/** @type {{ id: BatchDay, label: string }[]} */
export const BATCH_DAYS = [
  { id: 'saturday', label: 'Samedi' },
  { id: 'sunday', label: 'Dimanche' },
  { id: 'monday', label: 'Lundi' },
];

/** @type {BatchPlan} */
export const DEFAULT_BATCH_PLAN = { day: 'sunday', midweek: false };

/**
 * Dates des seances pour une semaine : la seance principale (samedi ou dimanche avant le lundi,
 * ou le lundi), et en option une seance le mercredi pour la fin de semaine.
 * Une seance deja passee est ramenee a aujourd'hui (si la semaine n'est pas finie).
 * @param {string} monday
 * @param {BatchPlan} plan
 * @param {string} today
 * @returns {string[]}
 */
export function batchSessionDates(monday, plan, today) {
  const offset = plan.day === 'saturday' ? -2 : plan.day === 'sunday' ? -1 : 0;
  const end = addDays(monday, 6);
  const main = addDays(monday, offset);
  const midweek = addDays(monday, 2);
  /** @type {string[]} */
  const out = [];
  if (main >= today) out.push(main);
  else if (today <= end && !(plan.midweek && today >= midweek)) out.push(today);
  if (plan.midweek && midweek >= today) out.push(midweek);
  else if (plan.midweek && today > midweek && today <= end && !out.includes(today)) out.push(today);
  return out;
}

/**
 * Comment garder un plat cuisine pendant une seance jusqu'au jour du repas.
 * - fridge : au refrigerateur ;
 * - freezer : au congelateur, a sortir la veille au soir (thawOn) ;
 * - same_day : a cuisiner le jour meme (ne se garde pas jusque-la).
 * @param {Keeping} keeping
 * @param {string} session
 * @param {string} mealDate
 * @returns {{ storage: 'fridge' | 'freezer' | 'same_day', thawOn: string | null }}
 */
export function storagePlan(keeping, session, mealDate) {
  const age = daysBetween(session, mealDate);
  if (!keeping.batch) return { storage: 'same_day', thawOn: null };
  if (age <= keeping.fridgeDays) return { storage: 'fridge', thawOn: null };
  if (keeping.freezes) return { storage: 'freezer', thawOn: addDays(mealDate, -1) };
  return { storage: 'same_day', thawOn: null };
}
