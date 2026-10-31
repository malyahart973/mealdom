/**
 * Domicile, position des magasins et calcul des trajets (domicile -> magasin et entre magasins).
 * - Adresse -> coordonnees : service de geocodage de l'IGN (Geoplateforme), l'adresse tapee lui est envoyee.
 * - Itineraires : OSRM (routes OpenStreetMap), seules les coordonnees lui sont envoyees.
 * - « Ma position » : GPS du telephone, rien n'est envoye.
 * Les resultats restent sur l'appareil.
 */
import { CAYENNE, isPlace, parseGeocode, parseRoute, parseTable, estimateTravel } from '../domain/trips/geo.js';
import { legKey } from '../domain/trips/trips.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { getStores } from '../db/repositories/budgetRepository.js';
import { saveStore } from './budgetService.js';

/** @typedef {import('../domain/trips/geo.js').GeoPlace} GeoPlace */
/** @typedef {import('../domain/trips/geo.js').TravelEstimate} TravelEstimate */
/** @typedef {import('../domain/trips/trips.js').Leg} Leg */
/** @typedef {import('../domain/stores/stores.js').Store} Store */

const GEOCODE_URL = 'https://data.geopf.fr/geocodage/search';
const ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving';
const TABLE_URL = 'https://router.project-osrm.org/table/v1/driving';
/** Le service d'itineraire public demande au plus une requete par seconde. */
const ROUTE_PAUSE_MS = 1100;

/** @returns {Promise<GeoPlace | null>} */
export async function getHome() {
  const value = await getSetting('homeLocation');
  return isPlace(value) ? value : null;
}

/**
 * @param {GeoPlace | null} place
 * @returns {Promise<void>}
 */
export function saveHome(place) {
  return setSetting('homeLocation', place);
}

/**
 * Recherche d'une adresse (les adresses de Guyane passent en premier).
 * @param {string} query
 * @returns {Promise<{ places: GeoPlace[], error: string | null }>}
 */
export async function searchAddress(query) {
  const q = query.trim();
  if (q.length < 3) return { places: [], error: 'Tapez au moins le nom de la rue et la commune.' };
  if (!navigator.onLine) return { places: [], error: 'La recherche d’adresse demande Internet. Vous pouvez aussi utiliser votre position.' };
  const base = `${GEOCODE_URL}?q=${encodeURIComponent(q)}&limit=5`;
  try {
    let response = await fetch(`${base}&lat=${CAYENNE.lat}&lon=${CAYENNE.lon}`);
    if (!response.ok) response = await fetch(base);
    if (!response.ok) return { places: [], error: 'Le service d’adresses ne répond pas. Réessayez plus tard ou utilisez votre position.' };
    const places = parseGeocode(await response.json());
    return { places, error: places.length ? null : 'Adresse introuvable : précisez le numéro, la rue et la commune.' };
  } catch {
    return { places: [], error: 'Le service d’adresses ne répond pas. Réessayez plus tard ou utilisez votre position.' };
  }
}

/**
 * Position actuelle du telephone (GPS).
 * @param {string} label
 * @returns {Promise<{ place: GeoPlace | null, error: string | null }>}
 */
export function currentPlace(label) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ place: null, error: 'La localisation n’est pas disponible sur cet appareil.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ place: { label, lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lon: Math.round(pos.coords.longitude * 1e5) / 1e5 }, error: null }),
      (err) =>
        resolve({
          place: null,
          error: err.code === err.PERMISSION_DENIED ? 'Localisation refusée : autorisez-la pour MealDom dans les réglages du navigateur.' : 'Position introuvable pour le moment. Réessayez à l’extérieur ou tapez l’adresse.',
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

/**
 * Trajet en voiture entre deux positions ; estimation a vol d'oiseau si le service ne repond pas.
 * @param {GeoPlace} from
 * @param {GeoPlace} to
 * @returns {Promise<TravelEstimate>}
 */
export async function travelBetween(from, to) {
  if (navigator.onLine) {
    try {
      const response = await fetch(`${ROUTE_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`);
      if (response.ok) {
        const route = parseRoute(await response.json());
        if (route) return route;
      }
    } catch {
      // service indisponible : estimation ci-dessous
    }
  }
  return estimateTravel(from, to);
}

/**
 * Cle d'une paire de positions : un magasin deplace n'utilise plus l'ancien itineraire.
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @returns {string}
 */
function placesKey(a, b) {
  const one = (/** @type {{ lat: number, lon: number }} */ p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  return [one(a), one(b)].sort().join('~');
}

/**
 * Itineraires entre magasins deja calcules (par paire de positions).
 * @returns {Promise<Record<string, { km: number, minutes: number }>>}
 */
async function getRoutesBetweenStores() {
  const value = await getSetting('storeLegs');
  return value && typeof value === 'object' ? /** @type {Record<string, { km: number, minutes: number }>} */ (value) : {};
}

/**
 * Trajets entre magasins positionnes : itineraire deja calcule, sinon estimation a vol d'oiseau.
 * Les magasins sans position n'y figurent pas (leur trajet compte comme un passage par le domicile).
 * @param {Store[]} stores
 * @returns {Promise<Map<string, Leg>>}
 */
export async function storeLegs(stores) {
  const routes = await getRoutesBetweenStores();
  const located = stores.filter((s) => s.location);
  /** @type {Map<string, Leg>} */
  const legs = new Map();
  for (let i = 0; i < located.length; i += 1) {
    for (let j = i + 1; j < located.length; j += 1) {
      const a = /** @type {GeoPlace} */ (located[i].location);
      const b = /** @type {GeoPlace} */ (located[j].location);
      const route = routes[placesKey(a, b)];
      legs.set(legKey(located[i].id, located[j].id), route ? { ...route, source: 'route' } : estimateTravel(a, b));
    }
  }
  return legs;
}

/**
 * Tous les trajets entre ces positions en une seule demande au service d'itineraire.
 * @param {GeoPlace[]} places
 * @returns {Promise<ReturnType<typeof parseTable>>}
 */
async function travelTable(places) {
  if (!navigator.onLine || places.length < 2) return null;
  try {
    const coords = places.map((p) => `${p.lon},${p.lat}`).join(';');
    const response = await fetch(`${TABLE_URL}/${coords}?annotations=distance,duration`);
    return response.ok ? parseTable(await response.json(), places.length) : null;
  } catch {
    return null;
  }
}

/**
 * Calcule distance et temps depuis le domicile pour chaque magasin positionne, et entre magasins.
 * Une seule demande au service d'itineraire ; s'il ne repond pas, un itineraire par magasin depuis
 * le domicile, puis estimation a vol d'oiseau.
 * @returns {Promise<{ updated: number, estimated: number, missing: string[], between: number, error: string | null }>}
 */
export async function computeStoreDistances() {
  const [home, stores] = await Promise.all([getHome(), getStores()]);
  if (!home) return { updated: 0, estimated: 0, missing: [], between: 0, error: 'Indiquez d’abord votre domicile.' };
  const located = stores.filter((s) => s.location);
  const missing = stores.filter((s) => !s.location).map((s) => s.name);
  const places = [home, ...located.map((s) => /** @type {GeoPlace} */ (s.location))];
  const table = await travelTable(places);
  let updated = 0;
  let estimated = 0;
  let between = 0;
  for (const [index, store] of located.entries()) {
    const cell = table?.[0][index + 1] ?? null;
    /** @type {TravelEstimate} */
    let travel;
    if (cell) travel = { ...cell, source: 'route' };
    else {
      if (updated > 0) await new Promise((r) => setTimeout(r, ROUTE_PAUSE_MS));
      travel = await travelBetween(home, places[index + 1]);
    }
    const errors = await saveStore({ ...store, distanceKm: travel.km, travelMinutes: travel.minutes, distanceSource: travel.source });
    if (errors.length === 0) {
      updated++;
      if (travel.source === 'estimate') estimated++;
    }
  }
  if (table) {
    /** @type {Record<string, { km: number, minutes: number }>} */
    const routes = {};
    for (let i = 1; i < places.length; i += 1) {
      for (let j = i + 1; j < places.length; j += 1) {
        const cell = table[i][j];
        if (cell) {
          routes[placesKey(places[i], places[j])] = cell;
          between++;
        }
      }
    }
    await setSetting('storeLegs', routes);
  }
  return { updated, estimated, missing, between, error: null };
}
