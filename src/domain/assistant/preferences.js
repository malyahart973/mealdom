/**
 * Memoire des preferences : ce que le client demande souvent (repas gourmands,
 * peu de vaisselle, promotions...) est retenu pour les prochains plannings.
 * - une demande ACCEPTEE compte une fois ; a partir de 3, la preference devient active ;
 * - « retiens que... » / « à l'avenir » : active tout de suite ;
 * - le client voit, modifie, desactive ou supprime chaque preference.
 */
import { MODES } from './intent.js';

/** @typedef {import('./intent.js').Request} Request */

/** Nombre de demandes acceptees avant qu'une preference soit appliquee. */
export const LEARN_THRESHOLD = 3;

/**
 * @typedef {Object} Preference
 * @property {string} id                 "mode:gourmand", "cuisine:thai", "max_minutes", "avoid:pork"...
 * @property {'mode' | 'cuisine' | 'region' | 'max_minutes' | 'avoid'} kind
 * @property {string} value
 * @property {string} label
 * @property {'learned' | 'explicit'} source
 * @property {number} count
 * @property {boolean} active
 * @property {string} updatedAt
 */

const modeLabels = new Map(MODES.map((m) => [m.id, m.label]));

/**
 * Preferences qu'une demande permet d'apprendre.
 * @param {Request} req
 * @param {Map<string, string>} cuisineLabels
 * @returns {{ id: string, kind: Preference['kind'], value: string, label: string }[]}
 */
export function signalsOf(req, cuisineLabels) {
  /** @type {{ id: string, kind: Preference['kind'], value: string, label: string }[]} */
  const out = req.modes.map((m) => ({ id: `mode:${m}`, kind: /** @type {const} */ ('mode'), value: m, label: modeLabels.get(m) ?? m }));
  if (req.cuisine) out.push({ id: `cuisine:${req.cuisine}`, kind: 'cuisine', value: req.cuisine, label: `Cuisine ${(cuisineLabels.get(req.cuisine) ?? req.cuisine).toLowerCase()}` });
  if (req.region === 'asia') out.push({ id: 'region:asia', kind: 'region', value: 'asia', label: 'Cuisines d’Asie' });
  if (req.maxMinutes !== null) out.push({ id: 'max_minutes', kind: 'max_minutes', value: String(req.maxMinutes), label: `${req.maxMinutes} minutes maximum` });
  for (const a of req.avoid) {
    const key = a.ingredientId ?? a.category ?? a.label;
    out.push({ id: `avoid:${key}`, kind: 'avoid', value: key, label: `Éviter : ${a.label}` });
  }
  return out;
}

/**
 * Met a jour la memoire apres une demande acceptee (ou « retiens que... »).
 * @param {Preference[]} prefs
 * @param {Request} req
 * @param {string} nowIso
 * @param {Map<string, string>} cuisineLabels
 * @returns {Preference[]}
 */
export function learnFromRequest(prefs, req, nowIso, cuisineLabels) {
  const byId = new Map(prefs.map((p) => [p.id, { ...p }]));
  for (const s of signalsOf(req, cuisineLabels)) {
    const existing = byId.get(s.id);
    if (existing) {
      existing.count += 1;
      existing.updatedAt = nowIso;
      if (req.remember) existing.source = 'explicit';
      // Une preference desactivee par le client n'est jamais reactivee automatiquement.
      if (req.remember) existing.active = true;
      else if (existing.source === 'learned' && existing.count === LEARN_THRESHOLD) existing.active = true;
    } else {
      byId.set(s.id, { ...s, source: req.remember ? 'explicit' : 'learned', count: 1, active: req.remember || LEARN_THRESHOLD <= 1, updatedAt: nowIso });
    }
  }
  return [...byId.values()];
}

/**
 * Preferences actives appliquees a une demande (sans ecraser ce que le client vient de dire).
 * @param {Request} req
 * @param {Preference[]} prefs
 * @returns {Request}
 */
export function applyPreferences(req, prefs) {
  const active = prefs.filter((p) => p.active);
  const maxMinutes = active.find((p) => p.kind === 'max_minutes');
  return {
    ...req,
    maxMinutes: req.maxMinutes ?? (maxMinutes ? Number(maxMinutes.value) : null),
    avoid: [
      ...req.avoid,
      ...active
        .filter((p) => p.kind === 'avoid' && !req.avoid.some((a) => (a.ingredientId ?? a.category) === p.value))
        .map((p) => ({ ingredientId: p.value.includes('_') || !['fish', 'shellfish', 'meat', 'pork', 'poultry', 'beef', 'lamb', 'egg', 'dairy'].includes(p.value) ? p.value : null, category: ['fish', 'shellfish', 'meat', 'pork', 'poultry', 'beef', 'lamb', 'egg', 'dairy'].includes(p.value) ? p.value : null, label: p.label.replace('Éviter : ', '') })),
    ],
  };
}

/**
 * Preferences actives sous forme de texte (pour le modele IA et l'ecran).
 * @param {Preference[]} prefs
 * @returns {string[]}
 */
export function describePreferences(prefs) {
  return prefs.filter((p) => p.active).map((p) => p.label);
}

/**
 * Ajout ou modification manuelle d'une preference par le client.
 * @param {Preference[]} prefs
 * @param {Preference} pref
 * @returns {Preference[]}
 */
export function upsertPreference(prefs, pref) {
  return prefs.some((p) => p.id === pref.id) ? prefs.map((p) => (p.id === pref.id ? pref : p)) : [...prefs, pref];
}
