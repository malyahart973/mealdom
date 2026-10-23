import { test, assertEqual } from './runner.js';
import { haversineKm, estimateTravel, parseGeocode, parseRoute, isInGuyane, isPlace } from '../src/domain/trips/geo.js';

const cayenne = { label: 'Cayenne', lat: 4.9372, lon: -52.326 };
const matoury = { label: 'Matoury', lat: 4.8473, lon: -52.3313 };

test('Distance à vol d’oiseau Cayenne – Matoury ≈ 10 km', () => {
  const km = haversineKm(cayenne, matoury);
  if (km < 9.5 || km > 10.5) throw new Error(String(km));
});

test('Estimation sans itinéraire : × 1,3 et 35 km/h, signalée comme estimation', () => {
  const t = estimateTravel(cayenne, matoury);
  assertEqual([t.km, t.minutes, t.source], [13, 22, 'estimate']);
});

test('Géocodage : coordonnées [longitude, latitude] lues, Guyane d’abord', () => {
  const json = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: { label: 'Rue de la République 75011 Paris' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-52.3301, 4.9385] }, properties: { label: 'Rue de la République 97300 Cayenne' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: ['x', 1] }, properties: { label: 'cassé' } },
    ],
  };
  const places = parseGeocode(json);
  assertEqual([places.length, places[0].label, places[0].lat, places[0].lon, isInGuyane(places[0]), isInGuyane(places[1])], [2, 'Rue de la République 97300 Cayenne', 4.9385, -52.3301, true, false]);
});

test('Géocodage : réponse vide ou inattendue = aucune adresse', () => {
  assertEqual([parseGeocode(null), parseGeocode({ features: 'x' }), parseGeocode({})], [[], [], []]);
});

test('Itinéraire OSRM : mètres et secondes convertis en km et minutes', () => {
  assertEqual(parseRoute({ code: 'Ok', routes: [{ distance: 12345, duration: 1130 }] }), { km: 12.3, minutes: 19, source: 'route' });
  assertEqual([parseRoute({ code: 'NoRoute', routes: [] }), parseRoute(null)], [null, null]);
});

test('Position valide', () => {
  assertEqual([isPlace(cayenne), isPlace({ label: 'x', lat: 120, lon: 0 }), isPlace({ lat: 1, lon: 1 })], [true, false, false]);
});
