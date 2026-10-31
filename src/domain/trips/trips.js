/**
 * Trajets et organisation des courses :
 * - cout d'un aller-retour en voiture jusqu'a un magasin ;
 * - circuit domicile -> magasins -> domicile dans l'ordre le plus court ;
 * - cout de chaque article dans chaque magasin (Drive puis prix releves) ;
 * - regroupement des achats sur 1, 2 ou 3 magasins, circuit compris ;
 * - sortie courses de la semaine (jour, heure, ordre de passage, creneau Drive) et rappel agenda.
 * Aucun prix n'est invente : un article sans prix dans un magasin n'y est pas compte.
 */
import { chooseProduct } from '../drive/drive.js';
import { purchaseCost } from '../stores/stores.js';
import { parseIsoDate, addDays } from '../planning/dates.js';
import { calendarFile, addMinutes } from '../planning/calendar.js';

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
  return km === null ? null : fuelCostCents(2 * km, car);
}

/**
 * Cout du carburant pour une distance, en centimes. null si la voiture est inconnue.
 * @param {number} km
 * @param {CarSettings} car
 * @returns {number | null}
 */
export function fuelCostCents(km, car) {
  if (car.consumptionL100 === null) return null;
  if (car.consumptionL100 === 0) return 0;
  if (car.fuelCentsPerLiter === null) return null;
  return Math.round(((km * car.consumptionL100) / 100) * car.fuelCentsPerLiter);
}

// ---------------------------------------------------------------------------
// Circuit de courses : domicile -> magasins -> domicile
// ---------------------------------------------------------------------------

/**
 * Trajet direct entre deux magasins (aller simple, le sens n'est pas distingue).
 * 'via_home' : trajet direct inconnu, compte comme un passage par le domicile (jamais sous-estime).
 * @typedef {{ km: number, minutes: number | null, source: import('./geo.js').DistanceSource | 'via_home' }} Leg
 */

/**
 * Cle d'un trajet entre deux magasins.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function legKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * @typedef {Object} Circuit
 * @property {string[]} storeIds     Ordre de passage
 * @property {number} km             Domicile -> magasins -> domicile
 * @property {number | null} minutes Temps de route, null si un temps manque
 * @property {number} separateKm     Les memes magasins en allers-retours separes depuis le domicile
 * @property {string[][]} viaHome    Paires de magasins sans trajet direct connu (comptees via le domicile)
 * @property {boolean} estimated     Au moins un trajet entre magasins estime a vol d'oiseau
 */

/** Au-dela, l'ordre est choisi de proche en proche (le nombre d'ordres possibles explose). */
const MAX_EXACT_STOPS = 7;
/** Deux circuits a moins de 100 m d'ecart sont aussi courts l'un que l'autre. */
const SAME_KM = 0.1;

/** @param {number} n */
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Trajet entre deux magasins dont la distance au domicile est connue.
 * @param {Store} a
 * @param {Store} b
 * @param {Map<string, Leg>} legs
 * @returns {Leg}
 */
function legBetween(a, b, legs) {
  const direct = legs.get(legKey(a.id, b.id));
  if (direct) return direct;
  const ma = a.travelMinutes ?? null;
  const mb = b.travelMinutes ?? null;
  return { km: (a.distanceKm ?? 0) + (b.distanceKm ?? 0), minutes: ma === null || mb === null ? null : ma + mb, source: 'via_home' };
}

/**
 * Circuit dans l'ordre donne. null si la distance d'un magasin au domicile est inconnue.
 * @param {Store[]} stops
 * @param {Map<string, Leg>} legs
 * @returns {Circuit | null}
 */
export function circuitFor(stops, legs) {
  if (stops.length === 0 || stops.some((s) => (s.distanceKm ?? null) === null)) return null;
  const first = stops[0];
  const last = stops[stops.length - 1];
  let km = (first.distanceKm ?? 0) + (last.distanceKm ?? 0);
  const fm = first.travelMinutes ?? null;
  const lm = last.travelMinutes ?? null;
  let minutes = fm === null || lm === null ? null : fm + lm;
  /** @type {string[][]} */
  const viaHome = [];
  let estimated = false;
  for (let i = 1; i < stops.length; i += 1) {
    const leg = legBetween(stops[i - 1], stops[i], legs);
    km += leg.km;
    minutes = minutes === null || leg.minutes === null ? null : minutes + leg.minutes;
    if (leg.source === 'via_home') viaHome.push([stops[i - 1].id, stops[i].id]);
    if (leg.source === 'estimate') estimated = true;
  }
  return {
    storeIds: stops.map((s) => s.id),
    km: round1(km),
    minutes,
    separateKm: round1(stops.reduce((n, s) => n + 2 * (s.distanceKm ?? 0), 0)),
    viaHome,
    estimated,
  };
}

/**
 * Tous les ordres possibles.
 * @template T
 * @param {T[]} items
 * @returns {T[][]}
 */
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/**
 * Ordre de proche en proche, en partant du magasin le plus proche du domicile.
 * @param {Store[]} stops
 * @param {Map<string, Leg>} legs
 * @returns {Store[]}
 */
function nearestOrder(stops, legs) {
  const left = [...stops].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  const order = [/** @type {Store} */ (left.shift())];
  while (left.length) {
    const from = order[order.length - 1];
    left.sort((a, b) => legBetween(from, a, legs).km - legBetween(from, b, legs).km);
    order.push(/** @type {Store} */ (left.shift()));
  }
  return order;
}

/**
 * Circuit le plus court passant par ces magasins. A distance egale (un circuit et son inverse),
 * on finit par le magasin ou l'on achete le plus de produits frais et surgeles.
 * null si la distance d'un magasin au domicile est inconnue.
 * @param {Store[]} stops
 * @param {Map<string, Leg>} legs
 * @param {Map<string, number>} [chilled]   magasin -> nombre d'articles frais ou surgeles
 * @returns {Circuit | null}
 */
export function bestCircuit(stops, legs, chilled = new Map()) {
  const orders = stops.length <= MAX_EXACT_STOPS ? permutations(stops) : [nearestOrder(stops, legs)];
  /** @param {Circuit} c */
  const chilledLast = (c) => chilled.get(c.storeIds[c.storeIds.length - 1]) ?? 0;
  /** @type {Circuit | null} */
  let best = null;
  for (const order of orders) {
    const c = circuitFor(order, legs);
    if (!c) return null;
    if (!best || c.km < best.km - SAME_KM || (Math.abs(c.km - best.km) <= SAME_KM && chilledLast(c) > chilledLast(best))) best = c;
  }
  return best;
}

/** Rayons dont les produits doivent rester au frais : achetes en dernier si possible. */
const CHILLED_AISLES = new Set(['frozen', 'meat_fish', 'dairy_eggs']);

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
 * @property {string[]} storeIds            Magasins utilises, dans l'ordre du circuit (sinon le plus gros panier d'abord)
 * @property {Map<string, string>} assignment  cle de ligne -> magasin
 * @property {number} itemsCents            Articles chiffres
 * @property {number} covered               Nombre d'articles chiffres
 * @property {string[]} missingKeys         Articles sans prix dans ces magasins
 * @property {number} tripCents             Trajets dont le cout est connu
 * @property {string[]} unknownTrips        Magasins dont le trajet n'est pas chiffre
 * @property {number} totalCents            Articles + trajets connus
 * @property {number | null} minutes        Temps de route, null si inconnu
 * @property {Circuit | null} circuit       Circuit domicile -> magasins -> domicile (null si une distance au domicile manque)
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
 * Le trajet est le circuit le plus court ; si la distance d'un magasin au domicile manque,
 * chaque magasin connu compte pour un aller-retour.
 * @param {string[]} keys
 * @param {Map<string, Map<string, StoreCost>>} costs
 * @param {Store[]} set
 * @param {CarSettings} car
 * @param {boolean} perItem
 * @param {{ legs: Map<string, Leg>, chilledKeys: Set<string> }} travel
 * @returns {GroupingPlan | null}
 */
function planFor(keys, costs, set, car, perItem, travel) {
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
  /** @type {Map<string, number>} */
  const chilled = new Map();
  for (const [key, storeId] of assignment) if (travel.chilledKeys.has(key)) chilled.set(storeId, (chilled.get(storeId) ?? 0) + 1);
  const circuit = bestCircuit(used, travel.legs, chilled);
  let tripCents = 0;
  /** @type {string[]} */
  let unknownTrips = [];
  let minutes = /** @type {number | null} */ (0);
  if (circuit) {
    const cost = fuelCostCents(circuit.km, car);
    if (cost === null) unknownTrips = used.map((s) => s.id);
    else tripCents = cost;
    minutes = circuit.minutes;
  } else {
    for (const s of used) {
      const trip = tripCostCents(s, car);
      if (trip === null) unknownTrips.push(s.id);
      else tripCents += trip;
      const m = s.travelMinutes ?? null;
      minutes = m === null || minutes === null ? null : minutes + 2 * m;
    }
  }
  return {
    storeIds: circuit ? circuit.storeIds : used.map((s) => s.id),
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
    circuit,
  };
}

/**
 * Compare les facons de faire les courses : 1, 2 ou 3 magasins, ou chaque article la ou il est
 * le moins cher. Le plan conseille couvre le plus d'articles possible ; chaque magasin de plus n'est
 * conseille que s'il fait economiser au moins le seuil, trajets compris.
 * Trajet : circuit domicile -> magasins -> domicile. Un trajet entre deux magasins absent de legs
 * compte comme un passage par le domicile.
 * @param {ShoppingLine[]} lines
 * @param {Map<string, Map<string, StoreCost>>} costs
 * @param {Store[]} stores
 * @param {CarSettings} car
 * @param {{ fewerTrips: boolean, legs?: Map<string, Leg> }} options
 * @returns {Grouping}
 */
export function groupShopping(lines, costs, stores, car, options) {
  const keys = toBuy(lines).map((l) => l.key);
  const travel = {
    legs: options.legs ?? new Map(),
    chilledKeys: new Set(lines.filter((l) => CHILLED_AISLES.has(l.aisle)).map((l) => l.key)),
  };
  const threshold = options.fewerTrips ? EXTRA_STORE_MIN_SAVING_FEWER_TRIPS : EXTRA_STORE_MIN_SAVING;
  const priced = stores.filter((s) => keys.some((k) => costs.get(k)?.has(s.id)));
  const unpricedKeys = keys.filter((k) => !priced.some((s) => costs.get(k)?.has(s.id)));
  /** @type {GroupingPlan[]} */
  const plans = [];
  for (const set of subsets(priced, MAX_STORES_PER_TRIP)) {
    const plan = planFor(keys, costs, set, car, false, travel);
    if (plan) plans.push(plan);
  }
  const perItem = planFor(keys, costs, priced, car, true, travel);
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
const SLOT_TIMES = { breakfast: '08:00', morning_snack: '10:00', lunch: '12:00', snack: '16:00', dinner: '19:00' };

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
 * Fichier agenda (.ics) : la sortie courses et, s'il existe, le retrait Drive, avec un rappel.
 * @param {ShoppingTrip} trip
 * @param {Map<string, string>} storeNames
 * @param {number | null} durationMinutes
 * @param {string[]} details   Lignes de description (ex. liste des magasins et des articles)
 * @param {string} stamp       Horodatage de creation (AAAAMMJJTHHMMSSZ)
 * @returns {string}
 */
export function tripCalendar(trip, storeNames, durationMinutes, details, stamp) {
  const names = trip.storeIds.map((id) => storeNames.get(id) ?? id);
  const duration = Math.max(30, durationMinutes ?? 60);
  /** @type {import('../planning/calendar.js').CalendarEvent[]} */
  const events = [
    {
      uid: `courses-${trip.week}`,
      date: trip.date,
      start: trip.time,
      end: addMinutes(trip.time, duration),
      summary: `Courses : ${names.join(', ')}`,
      description: [...details, trip.note].filter(Boolean).join('\n'),
      alarmMinutes: 60,
    },
  ];
  if (trip.driveSlot) {
    events.push({
      uid: `drive-${trip.week}`,
      date: trip.driveSlot.date,
      start: trip.driveSlot.start,
      end: trip.driveSlot.end,
      summary: 'Retrait Drive',
      description: 'Créneau de retrait réservé sur le site du Drive.',
      alarmMinutes: 30,
    });
  }
  return calendarFile('Courses', events, stamp);
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
