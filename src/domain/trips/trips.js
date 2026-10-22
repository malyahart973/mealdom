/**
 * Trajets et organisation des courses :
 * - cout d'un aller-retour en voiture jusqu'a un magasin ;
 * - cout de chaque article dans chaque magasin (Drive puis prix releves) ;
 * - regroupement des achats sur 1, 2 ou 3 magasins, trajets compris ;
 * - sortie courses de la semaine (jour, heure, ordre de passage, creneau Drive) et rappel agenda.
 * Aucun prix n'est invente : un article sans prix dans un magasin n'y est pas compte.
 */
import { chooseProduct } from '../drive/drive.js';
import { purchaseCost } from '../stores/stores.js';
import { parseIsoDate, addDays } from '../planning/dates.js';

/** @typedef {import('../stores/stores.js').Store} Store */
/** @typedef {import('../stores/stores.js').Price} Price */
/** @typedef {import('../drive/drive.js').DriveProduct} DriveProduct */
/** @typedef {import('../drive/drive.js').ProductPreference} ProductPreference */
/** @typedef {import('../shopping/shopping.js').ShoppingLine} ShoppingLine */
/** @typedef {import('../ingredients/ingredients.js').Ingredient} Ingredient */
/** @typedef {import('../planning/planning.js').Meal} Meal */

/**
 * Vehicule utilise pour les courses. null = inconnu (le cout du trajet n'est pas compte).
 * Consommation 0 : a pied, a velo ou en transport deja paye. Prix du litre en centimes,
 * avec decimales (les prix a la pompe ont 3 chiffres apres la virgule : 1,859 € = 185,9).
 * @typedef {{ consumptionL100: number | null, fuelCentsPerLiter: number | null }} CarSettings
 */

/** Economie minimale pour conseiller un magasin de plus (en centimes). */
export const EXTRA_STORE_MIN_SAVING = 200;
/** Idem quand le foyer a choisi l'objectif "Limiter les trajets et les magasins". */
export const EXTRA_STORE_MIN_SAVING_FEWER_TRIPS = 500;
/** Nombre maximal de magasins dans une meme sortie. */
export const MAX_STORES_PER_TRIP = 3;

/**
 * @param {CarSettings} car
 * @returns {string[]}
 */
export function validateCar(car) {
  /** @type {string[]} */
  const errors = [];
  if (car.consumptionL100 !== null && !(car.consumptionL100 >= 0 && car.consumptionL100 <= 30)) errors.push('Indiquez une consommation en litres aux 100 km, par exemple 6,5 (0 si vous n’utilisez pas de voiture).');
  if (car.fuelCentsPerLiter !== null && !(car.fuelCentsPerLiter > 0 && car.fuelCentsPerLiter <= 1000)) errors.push('Indiquez le prix du litre de carburant, par exemple 1,859.');
  return errors;
}

/**
 * Cout d'un aller-retour jusqu'au magasin, en centimes. null si la distance ou la voiture sont inconnues.
 * @param {Store} store
 * @param {CarSettings} car
 * @returns {number | null}
 */
export function tripCostCents(store, car) {
  const km = store.distanceKm ?? null;
  if (km === null || car.consumptionL100 === null) return null;
  if (car.consumptionL100 === 0) return 0;
  if (car.fuelCentsPerLiter === null) return null;
  return Math.round(((2 * km * car.consumptionL100) / 100) * car.fuelCentsPerLiter);
}

/**
 * @typedef {'drive_verified' | 'drive_stale' | 'manual'} CostKind
 * @typedef {{ cents: number, kind: CostKind }} StoreCost
 */

/**
 * @typedef {Object} CostContext
 * @property {DriveProduct[]} products      Produits Drive releves (tous magasins)
 * @property {Price[]} prices               Prix releves a la main (tous magasins)
 * @property {Map<string, Ingredient>} ingredients
 * @property {string} today
 * @property {Date} now
 * @property {boolean} hasLoyaltyCard
 * @property {ProductPreference} preference
 * @property {Map<string, string>} [preferredProducts]
 */

/**
 * Lignes reellement a acheter.
 * @param {ShoppingLine[]} lines
 * @returns {(ShoppingLine & { toBuy: number })[]}
 */
function toBuy(lines) {
  return /** @type {(ShoppingLine & { toBuy: number })[]} */ (lines.filter((l) => !l.covered && l.toBuy !== null));
}

/**
 * Cout de chaque article a acheter dans chaque magasin : produit du Drive si le magasin en a un,
 * sinon prix releve en magasin. Un article sans prix (ou indisponible) n'apparait pas pour ce magasin.
 * @param {ShoppingLine[]} lines
 * @param {Store[]} stores
 * @param {CostContext} ctx
 * @returns {Map<string, Map<string, StoreCost>>}   cle de ligne -> magasin -> cout
 */
export function storeLineCosts(lines, stores, ctx) {
  /** @type {Map<string, Map<string, StoreCost>>} */
  const out = new Map();
  for (const line of toBuy(lines)) {
    const ingredient = ctx.ingredients.get(line.ingredientId) ?? null;
    /** @type {Map<string, StoreCost>} */
    const perStore = new Map();
    for (const store of stores) {
      const products = ctx.products.filter((p) => p.storeId === store.id && p.ingredientId === line.ingredientId);
      if (products.length) {
        const { choice } = chooseProduct({ ingredientId: line.ingredientId, quantity: line.toBuy, unit: line.unit }, products, {
          today: ctx.today,
          now: ctx.now,
          hasLoyaltyCard: ctx.hasLoyaltyCard,
          preference: ctx.preference,
          preferredId: ctx.preferredProducts?.get(line.ingredientId) ?? null,
          ingredient,
        });
        if (choice) {
          perStore.set(store.id, { cents: choice.cost.cents, kind: choice.fresh ? 'drive_verified' : 'drive_stale' });
          continue;
        }
      }
      const price = ctx.prices.find((p) => p.storeId === store.id && p.ingredientId === line.ingredientId);
      const cost = purchaseCost(line.toBuy, line.unit, price, ingredient);
      if (cost) perStore.set(store.id, { cents: cost.cents, kind: 'manual' });
    }
    out.set(line.key, perStore);
  }
  return out;
}

/**
 * @typedef {Object} GroupingPlan
 * @property {string[]} storeIds            Magasins utilises (le plus gros panier d'abord)
 * @property {Map<string, string>} assignment  cle de ligne -> magasin
 * @property {number} itemsCents            Articles chiffres
 * @property {number} covered               Nombre d'articles chiffres
 * @property {string[]} missingKeys         Articles sans prix dans ces magasins
 * @property {number} tripCents             Trajets dont le cout est connu
 * @property {string[]} unknownTrips        Magasins dont le trajet n'est pas chiffre
 * @property {number} totalCents            Articles + trajets connus
 * @property {number | null} minutes        Temps de trajet (allers-retours), null si inconnu
 * @property {'verified' | 'estimated'} level
 * @property {boolean} perItem              Plan "article par article" (le moins cher partout)
 */

/**
 * @typedef {Object} Grouping
 * @property {GroupingPlan[]} plans          Du plus complet au moins complet, puis du moins cher au plus cher
 * @property {GroupingPlan | null} recommended
 * @property {string} reason                 Pourquoi ce plan est conseille
 * @property {number} toBuyCount
 * @property {string[]} unpricedKeys         Articles sans prix dans aucun magasin
 * @property {number} threshold              Economie minimale pour ajouter un magasin
 */

/**
 * Sous-ensembles de 1 a max elements.
 * @template T
 * @param {T[]} items
 * @param {number} max
 * @returns {T[][]}
 */
function subsets(items, max) {
  /** @type {T[][]} */
  const out = [];
  /** @param {number} start @param {T[]} current */
  const walk = (start, current) => {
    if (current.length) out.push(current);
    if (current.length === max) return;
    for (let i = start; i < items.length; i += 1) walk(i + 1, [...current, items[i]]);
  };
  walk(0, []);
  return out;
}

/**
 * Plan d'achat sur un ensemble de magasins : chaque article chez le moins cher de l'ensemble.
 * null si un magasin de l'ensemble ne sert a rien (le plan existe deja sans lui).
 * @param {string[]} keys
 * @param {Map<string, Map<string, StoreCost>>} costs
 * @param {Store[]} set
 * @param {CarSettings} car
 * @param {boolean} perItem
 * @returns {GroupingPlan | null}
 */
function planFor(keys, costs, set, car, perItem) {
  /** @type {Map<string, string>} */
  const assignment = new Map();
  /** @type {Map<string, number>} */
  const count = new Map();
  let itemsCents = 0;
  let allVerified = true;
  /** @type {string[]} */
  const missingKeys = [];
  for (const key of keys) {
    const perStore = costs.get(key) ?? new Map();
    /** @type {{ storeId: string, cost: StoreCost } | null} */
    let best = null;
    for (const store of set) {
      const cost = perStore.get(store.id);
      if (cost && (!best || cost.cents < best.cost.cents)) best = { storeId: store.id, cost };
    }
    if (!best) {
      missingKeys.push(key);
      continue;
    }
    assignment.set(key, best.storeId);
    count.set(best.storeId, (count.get(best.storeId) ?? 0) + 1);
    itemsCents += best.cost.cents;
    if (best.cost.kind !== 'drive_verified') allVerified = false;
  }
  if (!perItem && set.some((s) => !count.has(s.id))) return null;
  const used = set.filter((s) => count.has(s.id)).sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0));
  if (used.length === 0) return null;
  let tripCents = 0;
  /** @type {string[]} */
  const unknownTrips = [];
  let minutes = /** @type {number | null} */ (0);
  for (const s of used) {
    const trip = tripCostCents(s, car);
    if (trip === null) unknownTrips.push(s.id);
    else tripCents += trip;
    const m = s.travelMinutes ?? null;
    minutes = m === null || minutes === null ? null : minutes + 2 * m;
  }
  return {
    storeIds: used.map((s) => s.id),
    assignment,
    itemsCents,
    covered: assignment.size,
    missingKeys,
    tripCents,
    unknownTrips,
    totalCents: itemsCents + tripCents,
    minutes,
    level: allVerified ? 'verified' : 'estimated',
    perItem,
  };
}

/**
 * Compare les facons de faire les courses : 1, 2 ou 3 magasins, ou chaque article la ou il est
 * le moins cher. Le plan conseille couvre le plus d'articles possible ; chaque magasin de plus n'est
 * conseille que s'il fait economiser au moins le seuil, trajets compris.
 * Hypothese : chaque magasin compte pour un aller-retour depuis le domicile (sans calcul d'itineraire).
 * @param {ShoppingLine[]} lines
 * @param {Map<string, Map<string, StoreCost>>} costs
 * @param {Store[]} stores
 * @param {CarSettings} car
 * @param {{ fewerTrips: boolean }} options
 * @returns {Grouping}
 */
export function groupShopping(lines, costs, stores, car, options) {
  const keys = toBuy(lines).map((l) => l.key);
  const threshold = options.fewerTrips ? EXTRA_STORE_MIN_SAVING_FEWER_TRIPS : EXTRA_STORE_MIN_SAVING;
  const priced = stores.filter((s) => keys.some((k) => costs.get(k)?.has(s.id)));
  const unpricedKeys = keys.filter((k) => !priced.some((s) => costs.get(k)?.has(s.id)));
  /** @type {GroupingPlan[]} */
  const plans = [];
  for (const set of subsets(priced, MAX_STORES_PER_TRIP)) {
    const plan = planFor(keys, costs, set, car, false);
    if (plan) plans.push(plan);
  }
  const perItem = planFor(keys, costs, priced, car, true);
  if (perItem && perItem.storeIds.length > MAX_STORES_PER_TRIP) plans.push(perItem);
  else if (perItem) {
    const same = plans.find((p) => p.storeIds.length === perItem.storeIds.length && p.storeIds.every((id) => perItem.storeIds.includes(id)));
    if (same) same.perItem = true;
  }
  plans.sort((a, b) => b.covered - a.covered || a.totalCents - b.totalCents || a.storeIds.length - b.storeIds.length);

  const base = { toBuyCount: keys.length, unpricedKeys, threshold };
  if (plans.length === 0) return { ...base, plans, recommended: null, reason: 'Aucun prix connu pour les articles de la semaine : relevez quelques prix pour comparer.' };
  const maxCovered = plans[0].covered;
  const complete = plans.filter((p) => p.covered === maxCovered);
  /** @type {Map<number, GroupingPlan>} */
  const bestBySize = new Map();
  for (const p of complete) {
    const current = bestBySize.get(p.storeIds.length);
    if (!current || p.totalCents < current.totalCents) bestBySize.set(p.storeIds.length, p);
  }
  const sizes = [...bestBySize.keys()].sort((a, b) => a - b);
  let recommended = /** @type {GroupingPlan} */ (bestBySize.get(sizes[0]));
  let reason = recommended.storeIds.length === 1 ? 'Un seul magasin suffit pour tous les articles dont le prix est connu.' : 'C’est la sortie la moins chère qui couvre tous les articles dont le prix est connu.';
  for (const size of sizes.slice(1)) {
    const candidate = /** @type {GroupingPlan} */ (bestBySize.get(size));
    const saving = recommended.totalCents - candidate.totalCents;
    const extra = candidate.storeIds.length - recommended.storeIds.length;
    if (saving >= threshold * extra) {
      const tripsKnown = candidate.unknownTrips.length === 0 && recommended.unknownTrips.length === 0;
      recommended = candidate;
      reason = `${extra > 1 ? `${extra} magasins de plus font` : 'Un magasin de plus fait'} économiser ${(saving / 100).toFixed(2).replace('.', ',')} €${
        tripsKnown ? ', trajets compris.' : ' sur les articles (trajets non comptés : indiquez les distances et votre voiture).'
      }`;
    }
  }
  const cheaperIgnored = complete.find((p) => p.totalCents < recommended.totalCents);
  if (cheaperIgnored) {
    reason += ` Faire plus de magasins économiserait moins de ${(threshold / 100).toFixed(2).replace('.', ',')} € : cela ne vaut pas le déplacement.`;
  }
  return { ...base, plans, recommended, reason };
}

// ---------------------------------------------------------------------------
// Sortie courses de la semaine
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ShoppingTrip
 * @property {string} week                  Lundi de la semaine (cle)
 * @property {string} date                  AAAA-MM-JJ
 * @property {string} time                  HH:MM
 * @property {string[]} storeIds            Ordre de passage
 * @property {{ date: string, start: string, end: string } | null} driveSlot  Creneau de retrait reserve sur le site du Drive
 * @property {string} note
 * @property {string} updatedAt
 */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * @param {ShoppingTrip} trip
 * @returns {string[]}
 */
export function validateTrip(trip) {
  /** @type {string[]} */
  const errors = [];
  if (!parseIsoDate(trip.date)) errors.push('Choisissez le jour des courses.');
  if (!TIME.test(trip.time)) errors.push('Indiquez l’heure de départ, par exemple 09:30.');
  if (trip.storeIds.length === 0) errors.push('Choisissez au moins un magasin.');
  if (trip.driveSlot) {
    if (!parseIsoDate(trip.driveSlot.date)) errors.push('Indiquez la date du créneau de retrait Drive.');
    if (!TIME.test(trip.driveSlot.start) || !TIME.test(trip.driveSlot.end) || trip.driveSlot.end <= trip.driveSlot.start) {
      errors.push('Indiquez le créneau de retrait Drive, par exemple de 10:00 à 10:30.');
    }
  }
  if (trip.note.length > 200) errors.push('La note est trop longue (200 caractères au plus).');
  return errors;
}

/** Heure habituelle de chaque repas, pour savoir s'il a lieu avant les courses. */
const SLOT_TIMES = { breakfast: '08:00', lunch: '12:00', snack: '16:00', dinner: '19:00' };

/**
 * Repas de la semaine prevus avant le retour des courses : leurs ingredients doivent deja etre a la maison.
 * @param {Meal[]} meals
 * @param {ShoppingTrip} trip
 * @param {string} monday
 * @returns {Meal[]}
 */
export function mealsBeforeTrip(meals, trip, monday) {
  const end = addDays(monday, 7);
  return meals
    .filter((m) => m.date >= monday && m.date < end)
    .filter((m) => m.date < trip.date || (m.date === trip.date && SLOT_TIMES[m.slot] <= trip.time))
    .sort((a, b) => a.date.localeCompare(b.date) || SLOT_TIMES[a.slot].localeCompare(SLOT_TIMES[b.slot]));
}

/**
 * Texte echappe pour un fichier agenda.
 * @param {string} text
 * @returns {string}
 */
function icsText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
}

/**
 * @param {string} date AAAA-MM-JJ
 * @param {string} time HH:MM
 * @returns {string} AAAAMMJJTHHMM00 (heure locale de l'appareil)
 */
function icsDateTime(date, time) {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

/**
 * Ajoute des minutes a une heure HH:MM (sans changer de jour au-dela de 23:59).
 * @param {string} time
 * @param {number} minutes
 * @returns {string}
 */
function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Fichier agenda (.ics) : la sortie courses et, s'il existe, le retrait Drive, avec un rappel.
 * Les heures sont "flottantes" : le telephone les lit dans son propre fuseau horaire.
 * @param {ShoppingTrip} trip
 * @param {Map<string, string>} storeNames
 * @param {number | null} durationMinutes
 * @param {string[]} details   Lignes de description (ex. liste des magasins et des articles)
 * @param {string} stamp       Horodatage de creation (AAAAMMJJTHHMMSSZ)
 * @returns {string}
 */
export function tripCalendar(trip, storeNames, durationMinutes, details, stamp) {
  const names = trip.storeIds.map((id) => storeNames.get(id) ?? id);
  /** @type {string[]} */
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MealDom//Courses//FR', 'CALSCALE:GREGORIAN'];
  const event = (/** @type {string} */ uid, /** @type {string} */ start, /** @type {string} */ end, /** @type {string} */ summary, /** @type {string} */ description, /** @type {number} */ alarm) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}@mealdom`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(description)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(summary)}`,
      `TRIGGER:-PT${alarm}M`,
      'END:VALARM',
      'END:VEVENT',
    );
  };
  const duration = Math.max(30, durationMinutes ?? 60);
  event(
    `courses-${trip.week}`,
    icsDateTime(trip.date, trip.time),
    icsDateTime(trip.date, addMinutes(trip.time, duration)),
    `Courses : ${names.join(', ')}`,
    [...details, trip.note].filter(Boolean).join('\n'),
    60,
  );
  if (trip.driveSlot) {
    event(
      `drive-${trip.week}`,
      icsDateTime(trip.driveSlot.date, trip.driveSlot.start),
      icsDateTime(trip.driveSlot.date, trip.driveSlot.end),
      'Retrait Drive',
      'Créneau de retrait réservé sur le site du Drive.',
      30,
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Sortie courses a rappeler : aujourd'hui ou dans les 2 jours.
 * @param {ShoppingTrip[]} trips
 * @param {string} today
 * @returns {ShoppingTrip | null}
 */
export function upcomingTrip(trips, today) {
  const limit = addDays(today, 2);
  return (
    trips
      .filter((t) => t.date >= today && t.date <= limit)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0] ?? null
  );
}
