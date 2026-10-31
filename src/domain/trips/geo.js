/**
 * Positions et distances : domicile, magasins, itineraires.
 * Les adresses sont transformees en coordonnees par le service de geocodage de l'IGN
 * (Geoplateforme) et les trajets calcules par OSRM sur les routes d'OpenStreetMap.
 * Sans reponse de ces services, la distance est ESTIMEE a vol d'oiseau (x 1,3) et signalee.
 */

/** @typedef {{ label: string, lat: number, lon: number }} GeoPlace */
/** @typedef {'route' | 'estimate' | 'manual'} DistanceSource */
/** @typedef {{ km: number, minutes: number, source: DistanceSource }} TravelEstimate */

/** Centre de Cayenne : sert a privilegier les adresses de Guyane dans la recherche. */
export const CAYENNE = { lat: 4.9372, lon: -52.326 };
/** Detour moyen de la route par rapport a la ligne droite. */
export const ROAD_FACTOR = 1.3;
/** Vitesse moyenne en ville et peri-urbain (km/h), pour l'estimation sans itineraire. */
export const AVERAGE_KMH = 35;

/** @type {Record<DistanceSource, string>} */
export const SOURCE_LABELS = {
  route: 'itinéraire routier',
  estimate: 'estimation à vol d’oiseau',
  manual: 'saisi à la main',
};

/**
 * @param {unknown} p
 * @returns {p is GeoPlace}
 */
export function isPlace(p) {
  const x = /** @type {Record<string, unknown>} */ (p);
  return (
    typeof p === 'object' && p !== null && typeof x.label === 'string' &&
    typeof x.lat === 'number' && typeof x.lon === 'number' &&
    Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180
  );
}

/**
 * La position est-elle en Guyane (avec une marge) ?
 * @param {GeoPlace} p
 * @returns {boolean}
 */
export function isInGuyane(p) {
  return p.lat >= 2 && p.lat <= 6 && p.lon >= -55 && p.lon <= -51;
}

/**
 * Distance a vol d'oiseau en km (formule de haversine).
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @returns {number}
 */
export function haversineKm(a, b) {
  const rad = (/** @type {number} */ d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Trajet estime sans service d'itineraire.
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @returns {TravelEstimate}
 */
export function estimateTravel(a, b) {
  const km = Math.round(haversineKm(a, b) * ROAD_FACTOR * 10) / 10;
  return { km, minutes: Math.max(1, Math.round((km / AVERAGE_KMH) * 60)), source: 'estimate' };
}

/**
 * Lecture d'une reponse de geocodage (GeoJSON : coordonnees [longitude, latitude]).
 * @param {unknown} json
 * @returns {GeoPlace[]}
 */
export function parseGeocode(json) {
  const features = /** @type {{ features?: unknown }} */ (json ?? {}).features;
  if (!Array.isArray(features)) return [];
  /** @type {GeoPlace[]} */
  const out = [];
  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    const label = f?.properties?.label;
    if (!Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number' || typeof label !== 'string') continue;
    const place = { label, lat: coords[1], lon: coords[0] };
    if (isPlace(place)) out.push(place);
  }
  // Les adresses de Guyane d'abord (meme nom de rue en metropole).
  return out.sort((a, b) => Number(isInGuyane(b)) - Number(isInGuyane(a)));
}

/**
 * Lecture d'une reponse d'itineraire OSRM (distance en metres, duree en secondes).
 * @param {unknown} json
 * @returns {TravelEstimate | null}
 */
export function parseRoute(json) {
  const r = /** @type {{ code?: unknown, routes?: { distance?: unknown, duration?: unknown }[] }} */ (json ?? {});
  const route = r.code === 'Ok' && Array.isArray(r.routes) ? r.routes[0] : null;
  if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number' || route.distance < 0) return null;
  return { km: Math.round(route.distance / 100) / 10, minutes: Math.max(1, Math.round(route.duration / 60)), source: 'route' };
}

/**
 * Lecture d'une reponse de matrice OSRM (service « table ») : trajets entre n positions.
 * Le sens n'est pas distingue : on garde la moyenne aller / retour. null si la reponse est inutilisable.
 * Une case sans itineraire vaut null.
 * @param {unknown} json
 * @param {number} n   Nombre de positions envoyees
 * @returns {({ km: number, minutes: number } | null)[][] | null}
 */
export function parseTable(json, n) {
  const r = /** @type {{ code?: unknown, distances?: unknown, durations?: unknown }} */ (json ?? {});
  const d = r.distances;
  const t = r.durations;
  const square = (/** @type {unknown} */ m) => Array.isArray(m) && m.length === n && m.every((row) => Array.isArray(row) && row.length === n);
  if (r.code !== 'Ok' || !square(d) || !square(t)) return null;
  const dist = /** @type {unknown[][]} */ (d);
  const dur = /** @type {unknown[][]} */ (t);
  const ok = (/** @type {unknown} */ v) => typeof v === 'number' && v >= 0;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const values = [dist[i][j], dist[j][i], dur[i][j], dur[j][i]];
      if (!values.every(ok)) return null;
      const [m1, m2, s1, s2] = /** @type {number[]} */ (values);
      return { km: Math.round((m1 + m2) / 200) / 10, minutes: Math.max(i === j ? 0 : 1, Math.round((s1 + s2) / 120)) };
    }),
  );
}
