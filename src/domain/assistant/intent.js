/**
 * Comprehension des demandes ecrites librement (sans Internet).
 * Analyse deterministe et testee : objectifs, jours, repas, budget, invites,
 * remplacements, contraintes. Elle sert de repli quand le modele IA n'est pas
 * disponible, et a memoriser les preferences.
 */
import { normalizeText } from '../ingredients/ingredients.js';
import { addDays } from '../planning/dates.js';

/** @typedef {import('../planning/planning.js').Slot} Slot */

/**
 * Objectifs d'optimisation combinables.
 * @typedef {'promotions' | 'gourmand' | 'economy' | 'balance' | 'vegetables' | 'quick' | 'antiwaste' | 'light' | 'few_dishes' | 'quality' | 'seasonal' | 'protein' | 'batch'} Mode
 */

/** @type {{ id: Mode, label: string }[]} */
export const MODES = [
  { id: 'promotions', label: 'Promotions' },
  { id: 'gourmand', label: 'Gourmand' },
  { id: 'economy', label: 'Économie' },
  { id: 'balance', label: 'Équilibre et variété' },
  { id: 'vegetables', label: 'Plus de légumes' },
  { id: 'quick', label: 'Rapidité' },
  { id: 'antiwaste', label: 'Anti-gaspillage' },
  { id: 'light', label: 'Léger (programme minceur)' },
  { id: 'few_dishes', label: 'Peu de vaisselle' },
  { id: 'quality', label: 'Meilleure qualité' },
  { id: 'seasonal', label: 'Produits de saison et péyi' },
  { id: 'protein', label: 'Riche en protéines' },
  { id: 'batch', label: 'Batch cooking (cuisiner à l’avance)' },
];

/**
 * Cible d'un remplacement : un ingredient precis ou une famille (poisson, viande...).
 * @typedef {{ ingredientId: string | null, category: string | null, label: string }} FoodTarget
 */

/**
 * @typedef {Object} Request
 * @property {string} text
 * @property {Mode[]} modes
 * @property {number | null} budgetPercent      ex. -15 pour « réduis de 15 % »
 * @property {number | null} budgetCents        Budget de la semaine demande
 * @property {'keep' | null} budgetCap          « sans dépasser mon budget » : ne pas augmenter le cout
 * @property {number | null} maxMinutes
 * @property {string[]} days                    Dates concernees (vide = toute la semaine)
 * @property {Slot[]} slots                     Repas concernes (vide = tous)
 * @property {{ from: FoodTarget, to: FoodTarget } | null} replace
 * @property {FoodTarget[]} avoid               « sans poisson », « pas de porc »
 * @property {FoodTarget[]} include             « avec du saumon »
 * @property {{ count: number, mode: 'add' | 'total' } | null} guests
 * @property {boolean} convivial
 * @property {boolean} leftovers
 * @property {boolean} nextLunchLeftovers          les diners servent aussi au dejeuner du lendemain
 * @property {string | null} cheaperAlternativeFor   ingredient (ou focus de l'ecran)
 * @property {string | null} unavailable              ingredient indisponible
 * @property {boolean} keepMeals                garder les repas, changer les produits
 * @property {boolean} addMeal
 * @property {boolean} generate                 « fais-moi le planning de la semaine »
 * @property {boolean} redo                     « refais mardi »
 * @property {string | null} cuisine
 * @property {string | null} region
 * @property {boolean} refinement               « mais… », « et aussi… » : complete la demande precedente
 * @property {boolean} reset
 * @property {boolean} remember                 « retiens que… », « à l’avenir »
 * @property {boolean} undo
 * @property {boolean} understood
 */

/**
 * Familles d'aliments reconnues dans les phrases (categorie d'origine ou rayon).
 * @type {{ words: string[], category: string, label: string }[]}
 */
export const FOOD_FAMILIES = [
  { words: ['poisson', 'poissons'], category: 'fish', label: 'poisson' },
  { words: ['fruits de mer', 'crustaces', 'crevettes', 'crevette'], category: 'shellfish', label: 'fruits de mer' },
  { words: ['viande rouge', 'boeuf', 'bœuf'], category: 'beef', label: 'bœuf' },
  { words: ['viande', 'viandes'], category: 'meat', label: 'viande' },
  { words: ['porc', 'cochon'], category: 'pork', label: 'porc' },
  { words: ['volaille', 'poulet', 'dinde'], category: 'poultry', label: 'volaille' },
  { words: ['agneau', 'cabri', 'mouton'], category: 'lamb', label: 'agneau' },
  { words: ['oeufs', 'oeuf'], category: 'egg', label: 'œufs' },
  { words: ['produits laitiers', 'laitages', 'fromage', 'fromages'], category: 'dairy', label: 'produits laitiers' },
];

/** Cuisines citees librement -> identifiant (ou region). */
const CUISINE_WORDS = [
  { words: ['asiatique', 'asiatiques', 'asie'], region: 'asia' },
  { words: ['thai', 'thaie', 'thaies', 'thailandais', 'thailandaise'], cuisine: 'thai' },
  { words: ['japonais', 'japonaise', 'japonaises'], cuisine: 'japanese' },
  { words: ['chinois', 'chinoise', 'chinoises'], cuisine: 'chinese' },
  { words: ['coreen', 'coreenne', 'coreennes'], cuisine: 'korean' },
  { words: ['vietnamien', 'vietnamienne', 'vietnamiennes'], cuisine: 'vietnamese' },
  { words: ['indien', 'indienne', 'indiennes'], cuisine: 'indian' },
  { words: ['creole', 'creoles', 'antillais', 'antillaise', 'antillaises'], cuisine: 'caribbean' },
  { words: ['guyanais', 'guyanaise', 'guyanaises'], cuisine: 'guianese' },
  { words: ['italien', 'italienne', 'italiennes'], cuisine: 'italian' },
  { words: ['mexicain', 'mexicaine', 'mexicaines'], cuisine: 'mexican' },
  { words: ['africain', 'africaine', 'africaines'], cuisine: 'african' },
  { words: ['oriental', 'orientale', 'marocain', 'maghrebin', 'maghrebine'], cuisine: 'maghreb' },
  { words: ['francais', 'francaise', 'francaises', 'traditionnel'], cuisine: 'french' },
];

const NUMBER_WORDS = /** @type {Record<string, number>} */ ({
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, vingt: 20, trente: 30,
});

const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/**
 * @param {string} text
 * @param {RegExp} re
 * @returns {boolean}
 */
const has = (text, re) => re.test(text);

/**
 * Nombre ecrit en chiffres ou en lettres juste avant un mot.
 * @param {string} text
 * @param {string} after   expression reguliere du mot qui suit
 * @returns {number | null}
 */
function numberBefore(text, after) {
  const re = new RegExp(`(\\d+|${Object.keys(NUMBER_WORDS).join('|')})\\s+(?:\\w+\\s+)?${after}`);
  const m = re.exec(text);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]] ?? null;
}

/**
 * Aliment cite apres un mot donne : famille connue ou ingredient du catalogue.
 * @param {string} fragment   texte normalise commencant apres le mot declencheur
 * @param {(text: string) => { id: string, name: string } | null} findIngredient
 * @returns {FoodTarget | null}
 */
function foodIn(fragment, findIngredient) {
  const clean = fragment.replace(/^(le|la|les|l'|du|de la|de l'|des|de|d'|un|une)\s*/, '').trim();
  const ingredient = findIngredient(clean);
  for (const family of FOOD_FAMILIES) {
    if (family.words.some((w) => clean === normalizeText(w) || clean.startsWith(`${normalizeText(w)} `))) {
      // « poulet » : on garde l'ingredient precis si le nom correspond exactement
      if (ingredient && normalizeText(ingredient.name).split(' ')[0] === clean.split(' ')[0]) {
        return { ingredientId: ingredient.id, category: null, label: ingredient.name };
      }
      return { ingredientId: null, category: family.category, label: family.label };
    }
  }
  return ingredient ? { ingredientId: ingredient.id, category: null, label: ingredient.name } : null;
}

/**
 * Jours cites, a partir de la semaine affichee.
 * @param {string} text
 * @param {{ today: string, monday: string }} ctx
 * @returns {{ days: string[], slots: Slot[] }}
 */
function datesAndSlots(text, ctx) {
  /** @type {Set<string>} */
  const days = new Set();
  /** @type {Set<Slot>} */
  const slots = new Set();
  DAY_NAMES.forEach((name, i) => {
    if (new RegExp(`\\b${name}s?\\b`).test(text)) days.add(addDays(ctx.monday, i));
  });
  if (/\bweek-?end\b/.test(text)) {
    days.add(addDays(ctx.monday, 5));
    days.add(addDays(ctx.monday, 6));
  }
  if (/\baujourd'?hui\b|\bce soir\b|\bce midi\b|\bce matin\b/.test(text)) days.add(ctx.today);
  if (/\bdemain\b/.test(text)) days.add(addDays(ctx.today, 1));
  if (/\bce soir\b|\bsoir\b|\bdiner\b|\bdiners\b/.test(text)) slots.add('dinner');
  if (/\bce midi\b|\bmidi\b|\bdejeuner\b|\bdejeuners\b/.test(text)) slots.add('lunch');
  if (/petit[- ]?dej|\bmatin\b/.test(text)) slots.add('breakfast');
  if (/\bcollation du matin\b|\ben-cas du matin\b|\b10 heures\b|\bdix heures\b/.test(text)) slots.add('morning_snack');
  else if (/\bgouter\b|\bgouters\b|\b4 heures\b|\bquatre heures\b|\ben-cas\b|\bcollation\b/.test(text)) slots.add('snack');
  return { days: [...days].sort(), slots: [...slots] };
}

/**
 * Analyse une demande.
 * @param {string} rawText
 * @param {{ today: string, monday: string, focusIngredientId?: string | null, findIngredient: (text: string) => { id: string, name: string } | null, findIngredientInText: (text: string) => { id: string, name: string } | null }} ctx
 * @returns {Request}
 */
export function parseRequest(rawText, ctx) {
  const text = normalizeText(rawText).replace(/[!?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  /** @type {Set<Mode>} */
  const modes = new Set();

  if (has(text, /\bpromo|\bpromotion|\ben solde|\boffres?\b|\bbons plans?\b/)) modes.add('promotions');
  if (has(text, /gourmand|savoureu|plus de gout|\bregal|plaisir|genereu|reconfortant/)) modes.add('gourmand');
  if (has(text, /moins cher|economi|pas cher|petit budget|budget serre|reduis?\w* (le |mon )?budget|baisse\w* (le |mon )?budget|depenser moins/)) modes.add('economy');
  if (has(text, /equilibr|\bvari|diversifi|\bsain/)) modes.add('balance');
  if (has(text, /plus de legumes|legumes|vegetal/)) modes.add('vegetables');
  if (has(text, /rapide|\bvite\b|express|pas le temps|minutes?\b|\bmin\b|moins d'une heure/)) modes.add('quick');
  if (has(text, /\breste|gaspill|ce que j'ai|frigo|placard|mon stock|deja achete/)) modes.add('antiwaste');
  if (has(text, /leger|minceur|regime|calorie|perdre du poids|maigrir|mon programme/)) modes.add('light');
  if (has(text, /vaisselle|une seule (casserole|poele|cocotte)|one pot/)) modes.add('few_dishes');
  if (has(text, /meilleure qualite|qualite|\bbio\b|label rouge/)) modes.add('quality');
  if (has(text, /de saison|produits? locaux|produits? du pays|produits? pei|\bpeyi\b|\blocal\b/)) modes.add('seasonal');
  if (has(text, /proteine/)) modes.add('protein');
  if (has(text, /\bbatch|meal prep|(cuisiner|preparer|cuisine|prepare)\w* (tout )?(a|en) l'avance|en avance/)) modes.add('batch');

  const percent = /(\d+(?:[.,]\d+)?)\s*(?:%|pour ?cent)/.exec(text);
  let budgetPercent = null;
  if (percent && /budget|cout|depense|moins cher|reduis|baisse|diminue|augmente/.test(text)) {
    const value = Number(percent[1].replace(',', '.'));
    budgetPercent = /augmente|hausse|plus de budget/.test(text) ? value : -value;
    if (budgetPercent < 0) modes.add('economy');
  }
  const money = /(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)/.exec(text);
  const budgetCents = money && /budget|semaine|depenser|maximum|max|pas plus/.test(text) ? Math.round(Number(money[1].replace(',', '.')) * 100) : null;
  const budgetCap = /sans depasser|ne pas depasser|sans augmenter|meme budget|dans (mon|le) budget|sans (exploser|depasser) (le|mon) budget/.test(text) ? 'keep' : null;

  let maxMinutes = null;
  const minutes = /(?:moins de|en|max(?:imum)?|pas plus de)\s*(\d+)\s*(?:min|minutes)/.exec(text) ?? /(\d+)\s*(?:min|minutes)\b/.exec(text);
  if (minutes) maxMinutes = Number(minutes[1]);
  else if (/moins d'une heure/.test(text)) maxMinutes = 60;
  else if (modes.has('quick')) maxMinutes = 30;

  const { days, slots } = datesAndSlots(text, ctx);

  // « remplace le poisson de mardi par du poulet »
  let replace = null;
  const rep = /(?:remplace|change|echange|substitue)\w*\s+(.+?)\s+par\s+(.+)$/.exec(text);
  if (rep) {
    const fromText = rep[1].replace(/\s+(?:de|du|d'|pour)\s+(?:ce |cette )?(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|soir|midi|aujourd'hui).*$/, '');
    const toText = rep[2].replace(/\s+(?:de|du|d'|pour|le|ce)\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|soir|midi).*$/, '');
    const from = foodIn(fromText, ctx.findIngredient);
    const to = foodIn(toText, ctx.findIngredient);
    if (from && to) replace = { from, to };
  }

  /** @type {FoodTarget[]} */
  const avoid = [];
  for (const m of text.matchAll(/(?:sans|pas de|plus de|evite\w*|je n'aime pas|n'aime pas)\s+(\w+(?:\s\w+)?)/g)) {
    if (/^(depasser|augmenter|budget|legumes|vaisselle|four|cuisson|temps)/.test(m[1])) continue;
    if (m[0].startsWith('plus de')) continue; // « plus de légumes » = davantage
    const food = foodIn(m[1], ctx.findIngredient);
    if (food) avoid.push(food);
  }
  /** @type {FoodTarget[]} */
  const include = [];
  for (const m of text.matchAll(/(?:avec (?:du|de la|des)|manger (?:du|de la|des)|envie (?:de|d')|j'aimerais (?:du|de la|des))\s+(\w+(?:\s\w+)?)/g)) {
    const food = foodIn(m[1], ctx.findIngredient);
    if (food) include.push(food);
  }

  /** @type {Request['guests']} */
  let guests = null;
  const guestCount = numberBefore(text, '(?:personnes?|invites?|convives?|amis?)');
  if (guestCount !== null && /recoi|recevons|recevoir|invite|supplementaire|en plus|de plus|accueill|viennent|venir/.test(text)) {
    guests = { count: guestCount, mode: 'add' };
  } else {
    const total = /on (?:sera|est) (\d+|\w+)/.exec(text);
    if (total) {
      const n = /^\d+$/.test(total[1]) ? Number(total[1]) : NUMBER_WORDS[total[1]];
      if (n) guests = { count: n, mode: 'total' };
    }
  }

  const cheaper = /alternative moins chere|moins cher (?:que|pour)|remplacer? .* moins cher|equivalent moins cher|moins chere? a ce produit/.test(text);
  const mentioned = ctx.findIngredientInText(text);
  const cheaperAlternativeFor = cheaper ? (rep ? null : mentioned?.id ?? ctx.focusIngredientId ?? null) : null;
  const unavailable = /indisponible|rupture|plus de stock|introuvable|n'ont plus|il n'y a plus/.test(text) ? mentioned?.id ?? ctx.focusIngredientId ?? null : null;

  let cuisine = null;
  let region = null;
  for (const c of CUISINE_WORDS) {
    if (c.words.some((w) => new RegExp(`\\b${w}\\b`).test(text))) {
      if (c.region) region = c.region;
      if (c.cuisine) cuisine = c.cuisine;
    }
  }

  const convivial = /convivial|recevoir|on recoit|je recois|fete|anniversaire|a partager|apero|invites/.test(text);
  const leftovers = /restes?\b/.test(text) && /utilise|reutilise|avec les|finir|recycle|repas precedent/.test(text);
  const keepMeals = /garde\w* (les memes|mes|le meme|les) (repas|recettes|plats|menus)|meme(s)? repas/.test(text);
  const nextLunchLeftovers = /(restes?|cuisiner plus|en double|double portion)\b.*\b(lendemain|midi)\b/.test(text) && !/utilise|reutilise|finir/.test(text);
  const addMeal = /prevoi\w*|ajoute\w*|planifie\w*|rajoute\w*/.test(text) && /repas|diner|dejeuner|gouter|petit/.test(text);
  const generate = /(fais|fait|propose|prepare|genere|cree|compose|organise|remplis|complete)\w*(?:[\s-]+(?:moi|nous))?\s+(?:un|le|mon|des|les|une|ma)\s+(planning|menu|menus|repas de la semaine|semaine)/.test(text);
  const redo = /\brefai\w*|\brefaire\b|\brecompose\w*|\bchange tout\b/.test(text);
  const refinement = /^(mais|et|aussi|plutot|par contre|en plus|par ailleurs|sauf)\b/.test(text) || /\bmais (sans|avec|pas|garde)/.test(text);
  const reset = /\boublie\b|\brecommence|repart\w* de zero|reinitialise/.test(text);
  const remember = /\bretiens\b|\bretenir\b|souviens|a l'avenir|toujours|desormais|dorenavant|a chaque fois/.test(text);
  const undo = /annule\w* (la |ma )?(derniere|dernier) (modif|changement)|reviens en arriere|defai\w*|retour en arriere/.test(text);

  const understood =
    modes.size > 0 || replace !== null || guests !== null || budgetPercent !== null || budgetCents !== null || budgetCap !== null || convivial ||
    leftovers || nextLunchLeftovers || cheaperAlternativeFor !== null || unavailable !== null || keepMeals || addMeal || generate || redo || cuisine !== null ||
    region !== null || reset || undo || avoid.length > 0 || include.length > 0 || maxMinutes !== null;

  return {
    text: rawText,
    modes: [...modes],
    budgetPercent,
    budgetCents,
    budgetCap,
    maxMinutes,
    days,
    slots,
    replace,
    avoid,
    include,
    guests,
    convivial,
    leftovers,
    nextLunchLeftovers,
    cheaperAlternativeFor,
    unavailable,
    keepMeals,
    addMeal,
    generate,
    redo,
    cuisine,
    region,
    refinement,
    reset,
    remember,
    undo,
    understood,
  };
}

/**
 * Demande vide (point de depart d'une conversation).
 * @returns {Request}
 */
export function emptyRequest() {
  return parseRequest('', {
    today: '2000-01-03',
    monday: '2000-01-03',
    findIngredient: () => null,
    findIngredientInText: () => null,
  });
}

/**
 * Combine la nouvelle demande avec le contexte de la conversation :
 * « Je veux des repas plus gourmands. » puis « Mais sans dépasser mon budget. »
 * garde l'objectif gourmand et ajoute la contrainte budgetaire.
 * Une demande qui ne precise ni objectif ni repas reprend ceux de la precedente.
 * @param {Request | null} previous
 * @param {Request} next
 * @returns {Request}
 */
export function mergeRequests(previous, next) {
  if (!previous || next.reset) return next;
  const hasOwnAction =
    next.replace !== null || next.guests !== null || next.cheaperAlternativeFor !== null || next.unavailable !== null || next.addMeal ||
    next.leftovers || next.nextLunchLeftovers || next.generate || next.undo;
  const onlyConstraints = !hasOwnAction && next.modes.length === 0 && next.cuisine === null && next.region === null;
  if (!next.refinement && !onlyConstraints) return next;
  /** @param {any[]} a @param {any[]} b */
  const union = (a, b) => [...new Set([...a, ...b])];
  return {
    ...previous,
    text: next.text,
    modes: union(previous.modes, next.modes),
    budgetPercent: next.budgetPercent ?? previous.budgetPercent,
    budgetCents: next.budgetCents ?? previous.budgetCents,
    budgetCap: next.budgetCap ?? previous.budgetCap,
    maxMinutes: next.maxMinutes ?? previous.maxMinutes,
    days: next.days.length ? next.days : previous.days,
    slots: next.slots.length ? next.slots : previous.slots,
    avoid: [...previous.avoid, ...next.avoid],
    include: [...previous.include, ...next.include],
    cuisine: next.cuisine ?? previous.cuisine,
    region: next.region ?? previous.region,
    keepMeals: next.keepMeals || previous.keepMeals,
    // les actions ponctuelles ne sont pas rejouees
    replace: next.replace,
    guests: next.guests,
    cheaperAlternativeFor: next.cheaperAlternativeFor,
    unavailable: next.unavailable,
    addMeal: next.addMeal,
    leftovers: next.leftovers,
    nextLunchLeftovers: next.nextLunchLeftovers || previous.nextLunchLeftovers,
    generate: next.generate || previous.generate,
    redo: next.redo || previous.redo,
    convivial: next.convivial || previous.convivial,
    refinement: true,
    reset: false,
    remember: next.remember,
    undo: next.undo,
    understood: true,
  };
}

/**
 * Resume lisible de ce qui a ete compris (affiche au client).
 * @param {Request} r
 * @param {(iso: string) => string} dayLabel
 * @param {Map<string, string>} slotLabels
 * @param {Map<string, string>} [placeLabels]  Noms des cuisines et des regions (ex. japanese -> japonaise, asia -> Asie)
 * @returns {string}
 */
export function describeRequest(r, dayLabel, slotLabels, placeLabels) {
  /** @type {string[]} */
  const parts = [];
  const modeLabels = new Map(MODES.map((m) => [m.id, m.label.toLowerCase()]));
  if (r.generate) parts.push('composer le planning');
  else if (r.redo) parts.push('refaire les repas');
  if (r.modes.length) parts.push(`objectifs : ${r.modes.map((m) => modeLabels.get(m)).join(', ')}`);
  if (r.budgetPercent !== null) parts.push(`budget ${r.budgetPercent > 0 ? '+' : ''}${r.budgetPercent} %`);
  if (r.budgetCents !== null) parts.push(`budget de ${(r.budgetCents / 100).toFixed(2).replace('.', ',')} €`);
  if (r.budgetCap) parts.push('sans augmenter le coût');
  if (r.maxMinutes !== null) parts.push(`${r.maxMinutes} minutes maximum`);
  if (r.replace) parts.push(`remplacer ${r.replace.from.label} par ${r.replace.to.label}`);
  if (r.avoid.length) parts.push(`éviter : ${r.avoid.map((a) => a.label).join(', ')}`);
  if (r.include.length) parts.push(`avec : ${r.include.map((a) => a.label).join(', ')}`);
  if (r.guests) parts.push(r.guests.mode === 'add' ? `${r.guests.count} invité(s) en plus` : `${r.guests.count} personnes à table`);
  if (r.convivial) parts.push('repas convivial');
  if (r.leftovers) parts.push('utiliser les restes');
  if (r.nextLunchLeftovers) parts.push('les restes du dîner pour le déjeuner du lendemain');
  const place = r.cuisine ?? r.region;
  if (place) parts.push(`cuisine : ${placeLabels?.get(place) ?? place}`);
  if (r.keepMeals) parts.push('garder les mêmes repas');
  if (r.days.length) parts.push(`jours : ${r.days.map(dayLabel).join(', ')}`);
  if (r.slots.length) parts.push(`repas : ${r.slots.map((s) => (slotLabels.get(s) ?? s).toLowerCase()).join(', ')}`);
  return parts.length ? `J’ai compris : ${parts.join(' ; ')}.` : 'Je n’ai pas bien compris la demande.';
}

/**
 * Recherche d'ingredients dans un texte libre, a partir de l'index des noms.
 * - findIngredient : le debut du fragment (« poulet de mardi » -> poulet) ;
 * - findIngredientInText : le premier ingredient cite n'importe ou (le nom le plus long gagne).
 * @param {Map<string, string>} nameIndex   nom normalise -> id (voir buildNameIndex)
 * @param {Map<string, { id: string, name: string }>} ingredients
 */
export function makeIngredientFinder(nameIndex, ingredients) {
  /** @param {string} key */
  const lookup = (key) => {
    const id = nameIndex.get(key) ?? nameIndex.get(key.replace(/s$/, ''));
    return id ? ingredients.get(id) ?? null : null;
  };
  /** @param {string} fragment */
  const findIngredient = (fragment) => {
    const words = normalizeText(fragment).split(' ').filter(Boolean);
    for (let n = Math.min(5, words.length); n >= 1; n--) {
      const found = lookup(words.slice(0, n).join(' '));
      if (found) return found;
    }
    return null;
  };
  /** @param {string} text */
  const findIngredientInText = (text) => {
    const words = normalizeText(text).split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (['le', 'la', 'les', 'du', 'de', 'des', 'un', 'une', 'ce', 'a'].includes(words[i])) continue;
      const found = findIngredient(words.slice(i).join(' '));
      if (found) return found;
    }
    return null;
  };
  return { findIngredient, findIngredientInText };
}
