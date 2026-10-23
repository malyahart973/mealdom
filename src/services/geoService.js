/**
 * Domicile, position des magasins et calcul des trajets.
 * - Adresse -> coordonnees : service de geocodage de l'IGN (Geoplateforme), l'adresse tapee lui est envoyee.
 * - Itineraire : OSRM (routes OpenStreetMap), seules les coordonnees lui sont envoyees.
 * - « Ma position » : GPS du telephone, rien n'est envoye.
 * Les resultats restent sur l'appareil.
 */
import { CAYENNE, isPlace, parseGeocode, parseRoute, estimateTravel } from '../domain/trips/geo.js';
import { getSetting, setSetting } from '../db/repositories/settingsRepository.js';
import { getStores } from '../db/repositories/budgetRepository.js';
import { saveStore } from './budgetService.js';

/** @typedef {import('../domain/trips/geo.js').GeoPlace} GeoPlace */
/** @typedef {import('../domain/trips/geo.js').TravelEstimate} TravelEstimate */

const GEOCODE_URL = 'https://data.geopf.fr/geocodage/search';
const ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving';
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
 * Calcule distance et temps depuis le domicile pour chaque magasin positionne.
 * @returns {Promise<{ updated: number, estimated: number, missing: string[], error: string | null }>}
 */
export async function computeStoreDistances() {
  const [home, stores] = await Promise.all([getHome(), getStores()]);
  if (!home) return { updated: 0, estimated: 0, missing: [], error: 'Indiquez d’abord votre domicile.' };
  let updated = 0;
  let estimated = 0;
  /** @type {string[]} */
  const missing = [];
  for (const store of stores) {
    if (!store.location) {
      missing.push(store.name);
      continue;
    }
    if (updated > 0) await new Promise((r) => setTimeout(r, ROUTE_PAUSE_MS));
    const travel = await travelBetween(home, store.location);
    const errors = await saveStore({ ...store, distanceKm: travel.km, travelMinutes: travel.minutes, distanceSource: travel.source });
    if (errors.length === 0) {
      updated++;
      if (travel.source === 'estimate') estimated++;
    }
  }
  return { updated, estimated, missing, error: null };
}
