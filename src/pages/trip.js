import { escapeHtml } from '../utils/html.js';
import { formatIsoDay, formatIsoDayMonth, formatMinutes, formatTime } from '../utils/format.js';
import { parseDecimal } from '../utils/units-select.js';
import { addDays, parseIsoDate, toIsoDate, weekStart } from '../domain/planning/dates.js';
import { formatCents } from '../domain/budget/money.js';
import { circuitFor, bestCircuit, fuelCostCents, legKey, MAX_STORES_PER_TRIP } from '../domain/trips/trips.js';
import { SLOTS } from '../domain/planning/planning.js';
import { ingredientsById } from '../services/catalog.js';
import { saveStore } from '../services/budgetService.js';
import { getCarSettings, saveCarSettings, weekGrouping, getTrip, saveTrip, deleteTrip, mealsBefore, downloadTripCalendar } from '../services/tripService.js';
import { getHome, saveHome, searchAddress, currentPlace, computeStoreDistances } from '../services/geoService.js';
import { SOURCE_LABELS, isInGuyane } from '../domain/trips/geo.js';

/** @typedef {import('../domain/trips/geo.js').GeoPlace} GeoPlace */

/**
 * Recherche d'adresse ou position GPS, pour le domicile ou un magasin.
 * @param {string} key
 * @param {string} placeholder
 * @param {string} gpsLabel
 * @returns {string}
 */
function placeSearchHtml(key, placeholder, gpsLabel) {
  return `<div class="place-search" data-place="${key}">
    <div class="inline-form__row">
      <input type="text" autocomplete="street-address" placeholder="${escapeHtml(placeholder)}" data-place-query aria-label="Adresse" />
      <button type="button" class="button button--small button--secondary" data-place-search>Chercher</button>
    </div>
    <ul class="place-results" hidden></ul>
    <p><button type="button" class="button button--small button--secondary" data-place-gps>${escapeHtml(gpsLabel)}</button></p>
    <p class="hint place-status" role="status"></p>
  </div>`;
}

/**
 * Branche une recherche d'adresse : le choix (adresse ou GPS) est transmis a onPick.
 * @param {HTMLElement} root
 * @param {string} key
 * @param {(place: GeoPlace) => Promise<void>} onPick
 */
function mountPlaceSearch(root, key, onPick) {
  const box = /** @type {HTMLElement} */ (root.querySelector(`[data-place="${key}"]`));
  const query = /** @type {HTMLInputElement} */ (box.querySelector('[data-place-query]'));
  const results = /** @type {HTMLElement} */ (box.querySelector('.place-results'));
  const status = /** @type {HTMLElement} */ (box.querySelector('.place-status'));
  /** @type {GeoPlace[]} */
  let found = [];
  const search = async () => {
    status.textContent = 'Recherche…';
    const { places, error } = await searchAddress(query.value);
    found = places;
    status.textContent = error ?? 'Choisissez l’adresse :';
    results.hidden = places.length === 0;
    results.innerHTML = places
      .map((p, i) => `<li><button type="button" class="button button--small button--secondary" data-place-pick="${i}">${escapeHtml(p.label)}${isInGuyane(p) ? '' : ' (hors Guyane)'}</button></li>`)
      .join('');
  };
  box.querySelector('[data-place-search]')?.addEventListener('click', search);
  query.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  });
  results.addEventListener('click', async (event) => {
    const index = /** @type {HTMLElement} */ (event.target).getAttribute('data-place-pick');
    if (index !== null && found[Number(index)]) await onPick(found[Number(index)]);
  });
  box.querySelector('[data-place-gps]')?.addEventListener('click', async () => {
    status.textContent = 'Localisation en cours…';
    const { place, error } = await currentPlace(`Position GPS du ${new Date().toLocaleDateString('fr-FR')}`);
    if (place) await onPick(place);
    else status.textContent = error ?? '';
  });
}

/** @typedef {import('../domain/trips/trips.js').GroupingPlan} GroupingPlan */
/** @typedef {import('../domain/trips/trips.js').Circuit} Circuit */
/** @typedef {import('../domain/trips/trips.js').ShoppingTrip} ShoppingTrip */
/** @typedef {import('../domain/stores/stores.js').Store} Store */

const slotLabels = new Map(SLOTS.map((s) => [s.id, s.label.toLowerCase()]));

/** Plans affiches dans le tableau de comparaison. */
const MAX_PLANS_SHOWN = 6;

/** @param {number | null | undefined} v */
const decimalInput = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

/**
 * Ecran Organiser les courses : regrouper les magasins, compter les trajets, planifier la sortie.
 * @param {HTMLElement} el
 * @param {Record<string, string>} params
 */
export async function renderTrip(el, params) {
  const today = toIsoDate(new Date());
  const monday = weekStart(params.date && parseIsoDate(params.date) ? params.date : today);
  const [{ mealCount, lines, grouping, stores, car, fewerTrips, legs }, trip, home] = await Promise.all([weekGrouping(monday), getTrip(monday), getHome()]);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const storeName = (/** @type {string} */ id) => storesById.get(id)?.name ?? 'Magasin supprimé';
  const lineName = new Map(lines.map((l) => [l.key, ingredientsById.get(l.ingredientId)?.name ?? l.ingredientId]));
  const rec = grouping.recommended;
  const before = trip ? await mealsBefore(trip) : [];
  const defaultDate = addDays(monday, -2) >= today ? addDays(monday, -2) : today;
  const missingDistance = stores.filter((s) => (s.distanceKm ?? null) === null);

  /** @param {GroupingPlan} p */
  const planStores = (p) => p.storeIds.map(storeName).join(' + ');
  /** @param {Circuit} c */
  const circuitPath = (c) => ['Domicile', ...c.storeIds.map(storeName), 'Domicile'].join(' → ');
  /** @param {number} km */
  const formatKm = (km) => `${String(km).replace('.', ',')}\u00a0km`;
  /**
   * Circuit et reserves sur les distances.
   * @param {Circuit} c
   */
  const circuitHtml = (c) => {
    const saved = Math.round((c.separateKm - c.km) * 10) / 10;
    const notes = [
      ...c.viaHome.map(([a, b]) => `Trajet direct ${storeName(a)} – ${storeName(b)} inconnu : compté comme un retour à la maison. Indiquez la position des deux magasins (en bas de page).`),
      ...(c.estimated ? ['Trajet entre magasins estimé à vol d’oiseau : touchez « Calculer les distances » (en bas de page) pour l’itinéraire réel.'] : []),
    ];
    return `<p class="trip-circuit"><strong>${escapeHtml(circuitPath(c))}</strong> : ${escapeHtml(formatKm(c.km))}${
      saved >= 0.5 ? `, soit ${escapeHtml(formatKm(saved))} de moins que des allers-retours séparés` : ''
    }.</p>${notes.map((n) => `<p class="hint">${escapeHtml(n)}</p>`).join('')}`;
  };
  /** @param {GroupingPlan} p */
  const tripText = (p) =>
    p.unknownTrips.length === p.storeIds.length ? 'non chiffré' : `${formatCents(p.tripCents)}${p.unknownTrips.length ? ' (incomplet)' : ''}`;

  const planCard = (/** @type {GroupingPlan} */ p) => `
    <div class="proposal trip-plan">
      <h3>${escapeHtml(planStores(p))}</h3>
      <p class="hint">${escapeHtml(grouping.reason)}</p>
      ${p.circuit ? circuitHtml(p.circuit) : ''}
      <dl class="budget-card">
        <div><dt>Articles</dt><dd>${escapeHtml(formatCents(p.itemsCents))}</dd></div>
        <div><dt>${p.circuit ? 'Carburant' : 'Trajets (aller-retour)'}</dt><dd>${escapeHtml(tripText(p))}</dd></div>
        <div><dt>Total</dt><dd>${escapeHtml(formatCents(p.totalCents))}</dd></div>
        <div><dt>Temps de route</dt><dd>${p.minutes === null ? '—' : escapeHtml(formatMinutes(p.minutes))}</dd></div>
      </dl>
      <p><span class="badge badge--${p.level === 'verified' ? 'verified' : 'estimated'}">${p.level === 'verified' ? 'Prix Drive vérifiés' : 'Estimation'}</span>
        ${p.covered} article(s) chiffré(s) sur ${grouping.toBuyCount}${p.missingKeys.length ? ` ; ${p.missingKeys.length} sans prix dans ${p.storeIds.length > 1 ? 'ces magasins' : 'ce magasin'}` : ''}.</p>
      ${p.storeIds
        .map((id) => {
          const keys = [...p.assignment].filter(([, s]) => s === id).map(([k]) => k);
          return `<details class="proposal__ingredients"><summary>${escapeHtml(storeName(id))} : ${keys.length} article(s)</summary>
            <ul>${keys.map((k) => `<li>${escapeHtml(lineName.get(k) ?? k)}</li>`).join('')}</ul></details>`;
        })
        .join('')}
      ${p.missingKeys.length ? `<details class="proposal__ingredients"><summary>Sans prix connu : ${p.missingKeys.length} article(s)</summary><ul>${p.missingKeys.map((k) => `<li>${escapeHtml(lineName.get(k) ?? k)}</li>`).join('')}</ul></details>` : ''}
      <button type="button" class="button button--secondary" data-use-plan="${escapeHtml(p.storeIds.join(','))}">Planifier cette sortie</button>
    </div>`;

  const otherPlans = grouping.plans.filter((p) => p !== rec).slice(0, MAX_PLANS_SHOWN);
  const stops = trip?.storeIds ?? rec?.storeIds ?? [];
  const tripStores = (trip?.storeIds ?? []).map((id) => storesById.get(id)).filter((s) => s !== undefined);
  // Sortie enregistree : circuit dans l'ordre choisi, et ordre plus court s'il existe.
  const tripCircuit = circuitFor(tripStores, legs);
  const shorter = tripCircuit && tripStores.length > 1 ? bestCircuit(tripStores, legs) : null;
  const gainKm = tripCircuit && shorter ? Math.round((tripCircuit.km - shorter.km) * 10) / 10 : 0;
  const betterOrder = gainKm >= 0.5 ? shorter : null;
  const tripMinutes = tripCircuit ? tripCircuit.minutes : null;
  const tripCost = tripCircuit ? fuelCostCents(tripCircuit.km, car) : null;
  // Trajets entre magasins positionnes, pour la section Trajets.
  const located = stores.filter((s) => s.location);
  const pairs = located.flatMap((a, i) => located.slice(i + 1).map((b) => ({ a, b, leg: legs.get(legKey(a.id, b.id)) ?? null })));

  /** @param {number} index */
  const stopSelect = (index) => `<select data-stop="${index}" aria-label="Arrêt ${index + 1}">
      <option value="">${index === 0 ? 'Choisir un magasin' : 'Aucun'}</option>
      ${stores.map((s) => `<option value="${escapeHtml(s.id)}"${stops[index] === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
    </select>`;

  el.innerHTML = `
    <section>
      <h1 class="page-title">Organiser les courses</h1>
      <nav class="week-nav" aria-label="Changer de semaine">
        <a href="#/courses/organisation/semaine/${addDays(monday, -7)}" aria-label="Semaine précédente">‹</a>
        <span>Semaine du ${escapeHtml(formatIsoDayMonth(monday))}</span>
        <a href="#/courses/organisation/semaine/${addDays(monday, 7)}" aria-label="Semaine suivante">›</a>
      </nav>

      ${
        trip
          ? `<div class="batch-summary trip-summary">
              <p><strong>Courses prévues ${escapeHtml(formatIsoDay(trip.date))} à ${escapeHtml(formatTime(trip.time))}</strong> :
                ${trip.storeIds.map((id, i) => `${i ? 'puis ' : ''}${escapeHtml(storeName(id))}`).join(', ')}.</p>
              ${trip.driveSlot ? `<p>Retrait Drive ${escapeHtml(formatIsoDay(trip.driveSlot.date))}, de ${escapeHtml(formatTime(trip.driveSlot.start))} à ${escapeHtml(formatTime(trip.driveSlot.end))}.</p>` : ''}
              ${tripCircuit ? circuitHtml(tripCircuit) : '<p class="hint">Distance inconnue pour au moins un magasin : indiquez-la en bas de page pour calculer le circuit.</p>'}
              <p class="hint">${tripMinutes !== null ? `Environ ${escapeHtml(formatMinutes(tripMinutes))} de route` : 'Temps de route inconnu'}${tripCost !== null ? `, ${escapeHtml(formatCents(tripCost))} de carburant` : ''}.${trip.note ? ` ${escapeHtml(trip.note)}` : ''}</p>
              ${
                betterOrder
                  ? `<div class="fit fit--warn"><p><strong>Plus court : ${escapeHtml(betterOrder.storeIds.map(storeName).join(' puis '))}</strong>, ${escapeHtml(formatKm(gainKm))} de moins.</p>
                      <button type="button" class="button button--small" data-action="reorder" data-order="${escapeHtml(betterOrder.storeIds.join(','))}">Prendre cet ordre</button></div>`
                  : ''
              }
              ${
                before.length
                  ? `<div class="fit fit--ko"><p><strong>${before.length} repas avant les courses</strong> : vérifiez que vous avez déjà leurs ingrédients.</p>
                      <ul>${before.map((m) => `<li>${escapeHtml(formatIsoDay(m.date))}, ${escapeHtml(slotLabels.get(m.slot) ?? m.slot)} : ${escapeHtml(m.recipeName)}</li>`).join('')}</ul></div>`
                  : ''
              }
              <div class="form-actions">
                <button type="button" class="button" data-action="calendar">Ajouter à mon agenda</button>
                <button type="button" class="button button--danger" data-action="delete-trip">Supprimer</button>
              </div>
              <p class="hint">Le fichier agenda ajoute la sortie (et le retrait Drive) dans le calendrier du téléphone, avec un rappel.</p>
            </div>`
          : ''
      }

      <h2>Regrouper les courses</h2>
      ${
        mealCount === 0
          ? `<p class="empty">Aucun repas planifié cette semaine : rien à acheter.</p>`
          : stores.length === 0
            ? `<p>Ajoutez vos magasins et quelques prix pour comparer : <a href="#/magasins">Magasins</a> ou <a href="#/drive">Drive Hyper U Cayenne</a>.</p>`
            : `<p>${grouping.toBuyCount} article(s) à acheter.${grouping.unpricedKeys.length ? ` ${grouping.unpricedKeys.length} n’ont de prix dans aucun magasin : ils ne sont pas comptés.` : ''}
                ${fewerTrips ? 'Objectif du foyer « limiter les trajets » : un magasin de plus doit faire économiser au moins ' : 'Un magasin de plus n’est conseillé que s’il fait économiser au moins '}${escapeHtml(formatCents(grouping.threshold))}${missingDistance.length || car.consumptionL100 === null ? '. Indiquez les distances et votre voiture (en bas de page) pour compter aussi le coût des trajets.' : ', trajets compris.'}</p>
              ${rec ? planCard(rec) : `<p class="empty">${escapeHtml(grouping.reason)}</p>`}
              ${
                otherPlans.length
                  ? `<h3>Autres possibilités</h3>
                    <table class="table">
                      <thead><tr><th scope="col">Magasins</th><th scope="col">Chiffrés</th><th scope="col">Trajets</th><th scope="col">Total</th></tr></thead>
                      <tbody>${otherPlans
                        .map(
                          (p) => `<tr><td>${escapeHtml(planStores(p))}${p.perItem ? '<br /><span class="hint">article par article</span>' : ''}</td>
                            <td>${p.covered}/${grouping.toBuyCount}</td><td>${escapeHtml(tripText(p))}</td><td>${escapeHtml(formatCents(p.totalCents))}</td></tr>`,
                        )
                        .join('')}</tbody>
                    </table>`
                  : ''
              }
              <p class="hint">Le trajet est compté en circuit : de chez vous, chaque magasin dans l’ordre le plus court, puis retour. À distance égale, MealDom finit par le magasin où vous achetez le plus de frais et de surgelés. Seuls les prix relevés sont utilisés, jamais de prix inventés. Pour comparer, relevez les prix des mêmes articles dans plusieurs magasins.</p>`
      }

      <h2>Planifier la sortie</h2>
      <div class="alert" role="alert" data-alert="trip" hidden></div>
      <form class="stock-form" data-form="trip" novalidate>
        <div class="field when">
          <div><label for="trip-date">Jour</label><input id="trip-date" type="date" value="${escapeHtml(trip?.date ?? defaultDate)}" /></div>
          <div><label for="trip-time">Départ</label><input id="trip-time" type="time" value="${escapeHtml(trip?.time ?? '09:30')}" /></div>
        </div>
        <fieldset class="field"><legend>Ordre de passage</legend>
          ${Array.from({ length: MAX_STORES_PER_TRIP }, (_, i) => stopSelect(i)).join('')}
          <p class="hint">« Planifier cette sortie » met les magasins dans l’ordre du circuit le plus court. Si vous changez l’ordre, MealDom vous dira s’il existe plus court. Prévoyez une glacière pour le frais.</p>
        </fieldset>
        <label class="check"><input type="checkbox" id="trip-has-slot"${trip?.driveSlot ? ' checked' : ''} /> <span>J’ai réservé un créneau de retrait au Drive</span></label>
        <div class="field when" data-block="slot"${trip?.driveSlot ? '' : ' hidden'}>
          <div><label for="slot-date">Date</label><input id="slot-date" type="date" value="${escapeHtml(trip?.driveSlot?.date ?? trip?.date ?? defaultDate)}" /></div>
          <div><label for="slot-start">De</label><input id="slot-start" type="time" value="${escapeHtml(trip?.driveSlot?.start ?? '10:00')}" /></div>
          <div><label for="slot-end">À</label><input id="slot-end" type="time" value="${escapeHtml(trip?.driveSlot?.end ?? '10:30')}" /></div>
        </div>
        <div class="field"><label for="trip-note">Note (facultatif)</label><input id="trip-note" type="text" maxlength="200" autocomplete="off" value="${escapeHtml(trip?.note ?? '')}" placeholder="ex. sacs, glacière, carte de fidélité" /></div>
        <div class="form-actions"><button type="submit" class="button">Enregistrer la sortie</button></div>
      </form>

      <h2>Trajets</h2>
      <div class="alert" role="alert" data-alert="travel" hidden></div>
      <h3>Mon domicile</h3>
      <p>${home ? `<strong>${escapeHtml(home.label)}</strong> <button type="button" class="button button--small button--secondary" data-action="clear-home">Effacer</button>` : 'Non renseigné.'}</p>
      ${placeSearchHtml('home', 'ex. 12 rue de la République, Cayenne', 'Je suis chez moi : utiliser ma position')}
      ${
        stores.length
          ? `<h3>Position des magasins</h3>
            <ul class="local-list">${stores
              .map((s) => `<li><span><strong>${escapeHtml(s.name)}</strong> : ${s.location ? escapeHtml(s.location.label) : 'position inconnue'}</span></li>`)
              .join('')}</ul>
            <div class="field"><label for="store-pick">Magasin à positionner</label>
              <select id="store-pick">${stores.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')}</select></div>
            ${placeSearchHtml('store', 'Adresse du magasin, ex. ZI Collery, Cayenne', 'Je suis dans ce magasin : utiliser ma position')}
            <p><button type="button" class="button" data-action="compute-distances"${home ? '' : ' disabled'}>Calculer les distances (domicile et entre magasins)</button></p>
            <p class="hint" data-compute-status role="status"></p>
            ${
              pairs.length
                ? `<details class="proposal__ingredients"><summary>Distances entre magasins (${pairs.length})</summary>
                    <ul>${pairs
                      .map(
                        ({ a, b, leg }) =>
                          `<li>${escapeHtml(a.name)} – ${escapeHtml(b.name)} : ${leg ? `${escapeHtml(formatKm(leg.km))}${leg.minutes !== null ? `, ${escapeHtml(formatMinutes(leg.minutes))}` : ''} <span class="hint">(${escapeHtml(leg.source === 'via_home' ? 'via le domicile' : SOURCE_LABELS[leg.source])})</span>` : 'inconnue'}</li>`,
                      )
                      .join('')}</ul></details>`
                : ''
            }`
          : ''
      }
      <p class="hint">L’adresse tapée est envoyée au service d’adresses de l’IGN (Géoplateforme) ; pour l’itinéraire, seules les coordonnées sont envoyées au service OSRM. Votre position reste sur ce téléphone. Itinéraires : OSRM, données © contributeurs OpenStreetMap. Sans réponse de ces services, la distance est estimée à vol d’oiseau (× 1,3) et signalée comme telle.</p>
      <h3>Voiture et distances</h3>
      <form class="stock-form" data-form="car" novalidate>
        <label class="check"><input type="checkbox" id="car-none"${car.consumptionL100 === 0 ? ' checked' : ''} /> <span>Je fais mes courses sans voiture (à pied, à vélo, en bus)</span></label>
        <div class="field when" data-block="car"${car.consumptionL100 === 0 ? ' hidden' : ''}>
          <div><label for="car-consumption">Consommation (L/100 km)</label><input id="car-consumption" type="text" inputmode="decimal" autocomplete="off" value="${car.consumptionL100 ? escapeHtml(decimalInput(car.consumptionL100)) : ''}" placeholder="ex. 6,5" /></div>
          <div><label for="car-fuel">Prix du litre (€)</label><input id="car-fuel" type="text" inputmode="decimal" autocomplete="off" value="${car.fuelCentsPerLiter ? escapeHtml(decimalInput(Math.round(car.fuelCentsPerLiter * 10) / 1000)) : ''}" placeholder="ex. 1,859" /></div>
        </div>
        <p class="hint">En Guyane, le prix des carburants est fixé chaque mois par la préfecture : reprenez celui affiché à la pompe.</p>
        ${
          stores.length
            ? `<table class="table travel-table">
                <thead><tr><th scope="col">Magasin</th><th scope="col">Distance (km, aller)</th><th scope="col">Temps (min, aller)</th></tr></thead>
                <tbody>${stores
                  .map(
                    (s) => `<tr><td>${escapeHtml(s.name)}${s.distanceSource ? `<br /><span class="hint">${escapeHtml(SOURCE_LABELS[s.distanceSource])}</span>` : ''}</td>
                      <td><input type="text" inputmode="decimal" data-km="${escapeHtml(s.id)}" value="${escapeHtml(decimalInput(s.distanceKm))}" aria-label="Distance jusqu’à ${escapeHtml(s.name)}" /></td>
                      <td><input type="text" inputmode="numeric" data-min="${escapeHtml(s.id)}" value="${s.travelMinutes ?? ''}" aria-label="Temps jusqu’à ${escapeHtml(s.name)}" /></td></tr>`,
                  )
                  .join('')}</tbody>
              </table>
              ${missingDistance.length ? `<p class="hint">Distance inconnue pour ${missingDistance.length} magasin(s) : leur trajet n’est pas compté.</p>` : ''}`
            : ''
        }
        <div class="form-actions"><button type="submit" class="button button--secondary">Enregistrer les trajets</button></div>
      </form>
    </section>`;

  /** @param {string} name @param {string[]} messages */
  const say = (name, messages) => {
    const box = /** @type {HTMLElement} */ (el.querySelector(`[data-alert="${name}"]`));
    box.hidden = messages.length === 0;
    box.innerHTML = messages.map((m) => `<p>${escapeHtml(m)}</p>`).join('');
    if (messages.length) box.scrollIntoView({ block: 'center' });
  };
  /** @param {string} sel */
  const val = (sel) => /** @type {HTMLInputElement} */ (el.querySelector(sel)).value.trim();

  el.querySelectorAll('[data-use-plan]').forEach((b) =>
    b.addEventListener('click', () => {
      const ids = (b.getAttribute('data-use-plan') ?? '').split(',');
      el.querySelectorAll('[data-stop]').forEach((select, i) => {
        /** @type {HTMLSelectElement} */ (select).value = ids[i] ?? '';
      });
      el.querySelector('[data-form="trip"]')?.scrollIntoView({ block: 'start' });
    }),
  );

  const slotBox = /** @type {HTMLInputElement} */ (el.querySelector('#trip-has-slot'));
  slotBox.addEventListener('change', () => {
    /** @type {HTMLElement} */ (el.querySelector('[data-block="slot"]')).hidden = !slotBox.checked;
  });
  const noCar = /** @type {HTMLInputElement} */ (el.querySelector('#car-none'));
  noCar.addEventListener('change', () => {
    /** @type {HTMLElement} */ (el.querySelector('[data-block="car"]')).hidden = noCar.checked;
  });

  el.querySelector('[data-form="trip"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ids = [...el.querySelectorAll('[data-stop]')].map((s) => /** @type {HTMLSelectElement} */ (s).value).filter((id, i, all) => id && all.indexOf(id) === i);
    /** @type {ShoppingTrip} */
    const next = {
      week: monday,
      date: val('#trip-date'),
      time: val('#trip-time'),
      storeIds: ids,
      driveSlot: slotBox.checked ? { date: val('#slot-date'), start: val('#slot-start'), end: val('#slot-end') } : null,
      note: val('#trip-note'),
      updatedAt: '',
    };
    const errors = await saveTrip(next);
    if (errors.length) say('trip', errors);
    else {
      await renderTrip(el, params);
      window.scrollTo({ top: 0 });
    }
  });

  el.querySelector('[data-action="reorder"]')?.addEventListener('click', async (event) => {
    if (!trip) return;
    const order = (/** @type {HTMLElement} */ (event.currentTarget).getAttribute('data-order') ?? '').split(',').filter(Boolean);
    const errors = await saveTrip({ ...trip, storeIds: order });
    if (errors.length) say('trip', errors);
    else await renderTrip(el, params);
  });

  el.querySelector('[data-action="delete-trip"]')?.addEventListener('click', async () => {
    if (!window.confirm('Supprimer la sortie courses de cette semaine ?')) return;
    await deleteTrip(monday);
    await renderTrip(el, params);
  });

  el.querySelector('[data-action="calendar"]')?.addEventListener('click', async () => {
    if (!trip) return;
    const details = [
      `Ordre de passage : ${trip.storeIds.map(storeName).join(', ')}`,
      ...(rec && rec.storeIds.join() === trip.storeIds.join()
        ? trip.storeIds.map((id) => `${storeName(id)} : ${[...rec.assignment].filter(([, s]) => s === id).map(([k]) => lineName.get(k)).join(', ')}`)
        : []),
    ];
    await downloadTripCalendar(trip, tripMinutes, details);
  });

  mountPlaceSearch(el, 'home', async (place) => {
    await saveHome(place);
    await renderTrip(el, params);
  });
  el.querySelector('[data-action="clear-home"]')?.addEventListener('click', async () => {
    await saveHome(null);
    await renderTrip(el, params);
  });
  if (stores.length) {
    mountPlaceSearch(el, 'store', async (place) => {
      const id = /** @type {HTMLSelectElement} */ (el.querySelector('#store-pick')).value;
      const store = storesById.get(id);
      if (!store) return;
      await saveStore({ ...store, location: place });
      await renderTrip(el, params);
    });
  }
  el.querySelector('[data-action="compute-distances"]')?.addEventListener('click', async (event) => {
    const button = /** @type {HTMLButtonElement} */ (event.target);
    const status = /** @type {HTMLElement} */ (el.querySelector('[data-compute-status]'));
    button.disabled = true;
    status.textContent = 'Calcul des itinéraires…';
    const result = await computeStoreDistances();
    if (result.error) {
      status.textContent = result.error;
      button.disabled = false;
      return;
    }
    await renderTrip(el, params);
    const parts = [`${result.updated} magasin(s) mis à jour.`];
    if (result.between) parts.push(`${result.between} trajet(s) entre magasins calculé(s).`);
    if (result.estimated) parts.push(`${result.estimated} estimé(s) à vol d’oiseau : service d’itinéraire injoignable.`);
    if (result.missing.length) parts.push(`Position inconnue : ${result.missing.join(', ')}.`);
    const after = /** @type {HTMLElement | null} */ (el.querySelector('[data-compute-status]'));
    if (after) after.textContent = parts.join(' ');
  });

  el.querySelector('[data-form="car"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const consumptionText = val('#car-consumption');
    const fuelText = val('#car-fuel');
    const consumption = noCar.checked ? 0 : consumptionText ? parseDecimal(consumptionText) : null;
    const fuelEuros = fuelText ? parseDecimal(fuelText) : null;
    const errors = await saveCarSettings({
      consumptionL100: consumption,
      fuelCentsPerLiter: noCar.checked ? car.fuelCentsPerLiter : fuelEuros === null ? null : Math.round(fuelEuros * 1000) / 10,
    });
    for (const store of stores) {
      const kmText = /** @type {HTMLInputElement} */ (el.querySelector(`[data-km="${CSS.escape(store.id)}"]`)).value.trim();
      const minText = /** @type {HTMLInputElement} */ (el.querySelector(`[data-min="${CSS.escape(store.id)}"]`)).value.trim();
      /** @type {Store} */
      const updated = {
        ...store,
        distanceKm: kmText ? parseDecimal(kmText) : null,
        travelMinutes: minText ? (/^\d+$/.test(minText) ? Number(minText) : Number.NaN) : null,
      };
      if (updated.distanceKm === store.distanceKm && updated.travelMinutes === store.travelMinutes) continue;
      const storeErrors = await saveStore({ ...updated, distanceSource: 'manual' });
      errors.push(...storeErrors.map((e) => `${store.name} : ${e}`));
    }
    if (errors.length) say('travel', errors);
    else await renderTrip(el, params);
  });
}
