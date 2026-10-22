import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/trips/trips.js').ShoppingTrip} ShoppingTrip */

export const tripStore = objectStore('shoppingTrips');

/** @returns {Promise<ShoppingTrip[]>} */
export const getTrips = () => tripStore.getAll();
