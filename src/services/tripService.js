/**
 * Organisation des courses : voiture, regroupement des magasins, sortie de la semaine.
 */
import { storeLineCosts, groupShopping, validateCar, validateTrip, mealsBeforeTrip, tripCalendar, upcomingTrip } from '../domain/trips/trips.js';
import { toIsoDate } from '../domain/planning/dates.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { getStores } from '../db/repositories/budgetRepository.js';
import { getTrips, tripStore } from '../db/repositories/tripRepository.js';
import { weekShoppingList } from './shoppingService.js';
import { loadPriceData } from './driveService.js';
import { getHousehold } from './householdService.js';
import { getMeals } from './planningService.js';
import { ingredientsById } from './catalog.js';

/** @typedef {import('../domain/trips/trips.js').CarSettings} CarSettings */
/** @typedef {import('../domain/trips/trips.js').ShoppingTrip} ShoppingTrip */

/** @returns {Promise<CarSettings>} */
export async function getCarSettings() {
  const [consumption, fuel] = await Promise.all([getSetting('tripConsumption'), getSetting('tripFuelCents')]);
  return {
    consumptionL100: typeof consumption === 'number' ? consumption : null,
    fuelCentsPerLiter: typeof fuel === 'number' ? fuel : null,
  };
}

/**
 * @param {CarSettings} car
 * @returns {Promise<string[]>}
 */
export async function saveCarSettings(car) {
  const errors = validateCar(car);
  if (errors.length === 0) {
    await Promise.all([setSetting('tripConsumption', car.consumptionL100), setSetting('tripFuelCents', car.fuelCentsPerLiter)]);
  }
  return errors;
}

/**
 * Comparaison des facons de faire les courses de la semaine (prix et trajets).
 * @param {string} monday
 */
export async function weekGrouping(monday) {
  const now = new Date();
  const [list, data, stores, car, household] = await Promise.all([weekShoppingList(monday), loadPriceData(), getStores(), getCarSettings(), getHousehold()]);
  const costs = storeLineCosts(list.lines, stores, {
    products: data.products,
    prices: data.prices,
    ingredients: ingredientsById,
    today: toIsoDate(now),
    now,
    hasLoyaltyCard: data.settings.hasLoyaltyCard,
    preference: data.settings.preference,
    preferredProducts: new Map(Object.entries(data.settings.preferredProducts)),
  });
  const fewerTrips = household.goals.includes('fewer_trips');
  const grouping = groupShopping(list.lines, costs, stores, car, { fewerTrips });
  return { mealCount: list.mealCount, lines: list.lines, costs, grouping, stores, car, fewerTrips };
}

/**
 * @param {string} monday
 * @returns {Promise<ShoppingTrip | null>}
 */
export async function getTrip(monday) {
  return (await tripStore.get(monday)) ?? null;
}

/**
 * @param {ShoppingTrip} trip
 * @returns {Promise<string[]>}
 */
export async function saveTrip(trip) {
  const errors = validateTrip(trip);
  if (errors.length === 0) await tripStore.put({ ...trip, note: trip.note.trim(), updatedAt: new Date().toISOString() });
  return errors;
}

/**
 * @param {string} monday
 * @returns {Promise<void>}
 */
export function deleteTrip(monday) {
  return tripStore.delete(monday);
}

/**
 * Repas de la semaine qui ont lieu avant le retour des courses.
 * @param {ShoppingTrip} trip
 */
export async function mealsBefore(trip) {
  return mealsBeforeTrip(await getMeals(), trip, trip.week);
}

/**
 * Prochaine sortie courses (aujourd'hui ou dans les 2 jours), pour l'accueil.
 * @returns {Promise<ShoppingTrip | null>}
 */
export async function nextTrip() {
  return upcomingTrip(await getTrips(), toIsoDate(new Date()));
}

/**
 * Telecharge le fichier agenda de la sortie (ajout au calendrier du telephone, avec rappel).
 * @param {ShoppingTrip} trip
 * @param {number | null} durationMinutes
 * @param {string[]} details
 */
export async function downloadTripCalendar(trip, durationMinutes, details) {
  const stores = await getStores();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const text = tripCalendar(trip, new Map(stores.map((s) => [s.id, s.name])), durationMinutes, details, stamp);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `courses-${trip.date}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
