import { renderHome } from './pages/home.js';
import { renderMore } from './pages/more.js';
import { renderSettings } from './pages/settings.js';
import { renderRecipes } from './pages/recipes.js';
import { renderRecipe } from './pages/recipe.js';
import { renderRecipeEditor } from './pages/recipeEditor.js';
import { renderHousehold } from './pages/household.js';
import { renderMember } from './pages/member.js';
import { renderPlanning } from './pages/planning.js';
import { renderMeal } from './pages/meal.js';
import { renderBatch } from './pages/batch.js';
import { renderShopping } from './pages/shopping.js';
import { renderPackage } from './pages/package.js';
import { renderStock } from './pages/stock.js';
import { renderStores } from './pages/stores.js';
import { renderStore } from './pages/store.js';
import { renderBudget } from './pages/budget.js';
import { renderAssistant } from './pages/assistant.js';
import { renderPlanWeek, renderWeekPreview } from './pages/assistantGuided.js';
import { renderAssistantPreferences } from './pages/assistantPreferences.js';
import { renderDrive } from './pages/drive.js';
import { renderProgram } from './pages/program.js';
import { renderWeight } from './pages/weight.js';
import { renderTrip } from './pages/trip.js';
import { renderPriceOverview, renderPriceHistory } from './pages/prices.js';
import { renderAddPrice } from './pages/addPrice.js';
import { renderSeasons } from './pages/seasons.js';

/**
 * @typedef {Object} Route
 * @property {RegExp} pattern     Adresse ; les groupes nommes deviennent des parametres
 * @property {string} title       Titre de l'onglet du navigateur
 * @property {string} tab         Onglet de la barre du bas a mettre en avant
 * @property {(el: HTMLElement, params: Record<string, string>) => void | Promise<void>} render
 * @property {(params: Record<string, string>) => string} [parent]
 *   Ecran "au-dessus" : affiche le bouton Retour (utile dans l'application installee,
 *   qui n'a pas de bouton retour du navigateur)
 */

/** @type {Route[]} */
const routes = [
  { pattern: /^\/$/, title: 'Accueil', tab: '/', render: renderHome },
  { pattern: /^\/planning$/, title: 'Planning', tab: '/planning', render: renderPlanning },
  { pattern: /^\/planning\/semaine\/(?<date>\d{4}-\d{2}-\d{2})$/, title: 'Planning', tab: '/planning', render: renderPlanning },
  {
    pattern: /^\/planning\/ajouter\/(?<date>\d{4}-\d{2}-\d{2})\/(?<slot>[a-z]+)$/,
    title: 'Ajouter un repas',
    tab: '/planning',
    render: renderMeal,
    parent: (p) => `/planning/semaine/${p.date}`,
  },
  { pattern: /^\/planning\/repas\/(?<id>[^/]+)$/, title: 'Repas', tab: '/planning', render: renderMeal, parent: () => '/planning' },
  { pattern: /^\/batch$/, title: 'Batch cooking', tab: '/planning', render: renderBatch, parent: () => '/planning' },
  {
    pattern: /^\/batch\/semaine\/(?<date>\d{4}-\d{2}-\d{2})$/,
    title: 'Batch cooking',
    tab: '/planning',
    render: renderBatch,
    parent: (p) => `/planning/semaine/${p.date}`,
  },
  { pattern: /^\/recettes$/, title: 'Recettes', tab: '/recettes', render: renderRecipes },
  { pattern: /^\/recettes\/avec\/(?<ingredientId>[^/]+)$/, title: 'Recettes', tab: '/recettes', render: renderRecipes, parent: () => '/stock' },
  { pattern: /^\/recettes\/nouvelle$/, title: 'Nouvelle recette', tab: '/recettes', render: renderRecipeEditor, parent: () => '/recettes' },
  {
    pattern: /^\/recettes\/modifier\/(?<id>[^/]+)$/,
    title: 'Modifier ma recette',
    tab: '/recettes',
    render: renderRecipeEditor,
    parent: (p) => `/recettes/${p.id}`,
  },
  { pattern: /^\/recettes\/(?<id>[^/]+)$/, title: 'Recette', tab: '/recettes', render: renderRecipe, parent: () => '/recettes' },
  { pattern: /^\/courses$/, title: 'Courses', tab: '/courses', render: renderShopping },
  { pattern: /^\/courses\/semaine\/(?<date>\d{4}-\d{2}-\d{2})$/, title: 'Courses', tab: '/courses', render: renderShopping },
  {
    pattern: /^\/courses\/conditionnement\/(?<ingredientId>[^/]+)\/(?<week>\d{4}-\d{2}-\d{2})$/,
    title: 'Conditionnement',
    tab: '/courses',
    render: renderPackage,
    parent: (p) => `/courses/semaine/${p.week}`,
  },
  { pattern: /^\/courses\/organisation$/, title: 'Organiser les courses', tab: '/courses', render: renderTrip, parent: () => '/courses' },
  {
    pattern: /^\/courses\/organisation\/semaine\/(?<date>\d{4}-\d{2}-\d{2})$/,
    title: 'Organiser les courses',
    tab: '/courses',
    render: renderTrip,
    parent: (p) => `/courses/semaine/${p.date}`,
  },
  { pattern: /^\/plus$/, title: 'Plus', tab: '/plus', render: renderMore },
  { pattern: /^\/stock$/, title: 'Stock', tab: '/plus', render: renderStock, parent: () => '/plus' },
  { pattern: /^\/budget$/, title: 'Budget', tab: '/plus', render: renderBudget, parent: () => '/plus' },
  { pattern: /^\/budget\/mois\/(?<month>\d{4}-\d{2})$/, title: 'Budget', tab: '/plus', render: renderBudget, parent: () => '/plus' },
  { pattern: /^\/magasins$/, title: 'Magasins', tab: '/plus', render: renderStores, parent: () => '/plus' },
  { pattern: /^\/magasins\/(?<id>[^/]+)$/, title: 'Magasin', tab: '/plus', render: renderStore, parent: () => '/magasins' },
  { pattern: /^\/foyer$/, title: 'Mon foyer', tab: '/plus', render: renderHousehold, parent: () => '/plus' },
  {
    pattern: /^\/foyer\/personne\/(?<id>[^/]+)$/,
    title: 'Personne du foyer',
    tab: '/plus',
    render: renderMember,
    parent: () => '/foyer',
  },
  { pattern: /^\/parametres$/, title: 'Paramètres', tab: '/plus', render: renderSettings, parent: () => '/plus' },
  { pattern: /^\/assistant$/, title: 'Assistant', tab: '/planning', render: renderAssistant, parent: () => '/planning' },
  {
    pattern: /^\/assistant\/semaine\/(?<date>\d{4}-\d{2}-\d{2})$/,
    title: 'Assistant',
    tab: '/planning',
    render: renderAssistant,
    parent: (p) => `/planning/semaine/${p.date}`,
  },
  {
    pattern: /^\/assistant\/produit\/(?<ingredientId>[^/]+)$/,
    title: 'Assistant',
    tab: '/courses',
    render: renderAssistant,
    parent: () => '/courses',
  },
  { pattern: /^\/assistant\/planifier$/, title: 'Planifier ma semaine', tab: '/planning', render: renderPlanWeek, parent: () => '/planning' },
  {
    pattern: /^\/assistant\/planifier\/(?<date>\d{4}-\d{2}-\d{2})$/,
    title: 'Planifier ma semaine',
    tab: '/planning',
    render: renderPlanWeek,
    parent: (p) => `/planning/semaine/${p.date}`,
  },
  {
    pattern: /^\/assistant\/apercu\/(?<date>\d{4}-\d{2}-\d{2})\/(?<proposalId>[^/]+)$/,
    title: 'Votre semaine',
    tab: '/planning',
    render: renderWeekPreview,
    parent: (p) => `/assistant/planifier/${p.date}`,
  },
  { pattern: /^\/assistant\/preferences$/, title: 'Préférences de l’assistant', tab: '/plus', render: renderAssistantPreferences, parent: () => '/plus' },
  { pattern: /^\/drive$/, title: 'Drive', tab: '/courses', render: renderDrive, parent: () => '/courses' },
  {
    pattern: /^\/drive\/semaine\/(?<date>\d{4}-\d{2}-\d{2})$/,
    title: 'Drive',
    tab: '/courses',
    render: renderDrive,
    parent: (p) => `/courses/semaine/${p.date}`,
  },
  { pattern: /^\/saison$/, title: 'Produits de saison', tab: '/plus', render: renderSeasons, parent: () => '/plus' },
  { pattern: /^\/prix$/, title: 'Historique des prix', tab: '/plus', render: renderPriceOverview, parent: () => '/plus' },
  { pattern: /^\/prix\/ajouter$/, title: 'Ajouter un prix', tab: '/courses', render: renderAddPrice, parent: () => '/courses' },
  {
    pattern: /^\/prix\/ajouter\/magasin\/(?<storeId>[^/]+)$/,
    title: 'Ajouter un prix',
    tab: '/plus',
    render: renderAddPrice,
    parent: (p) => `/magasins/${p.storeId}`,
  },
  { pattern: /^\/prix\/ajouter\/(?<ingredientId>[^/]+)$/, title: 'Ajouter un prix', tab: '/courses', render: renderAddPrice, parent: () => '/courses' },
  { pattern: /^\/prix\/(?<ingredientId>[^/]+)$/, title: 'Historique des prix', tab: '/plus', render: renderPriceHistory, parent: () => '/prix' },
  { pattern: /^\/programme$/, title: 'Programme minceur', tab: '/plus', render: renderProgram, parent: () => '/plus' },
  { pattern: /^\/poids$/, title: 'Suivi du poids', tab: '/plus', render: renderWeight, parent: () => '/plus' },
];

/**
 * Trouve l'ecran correspondant a l'adresse ; l'accueil par defaut.
 * @returns {{ route: Route, params: Record<string, string> }}
 */
function match() {
  const path = decodeURIComponent(window.location.hash.replace(/^#/, '') || '/');
  for (const route of routes) {
    const m = route.pattern.exec(path);
    if (m) return { route, params: { ...(m.groups ?? {}) } };
  }
  return { route: routes[0], params: {} };
}

/** Vrai des que l'utilisateur a navigue dans l'application : "Retour" peut alors utiliser l'historique. */
let hasNavigated = false;

/**
 * Bouton Retour de la barre du haut : historique si possible, sinon ecran parent.
 * @param {HTMLButtonElement} button
 * @param {string | null} parentPath
 */
function updateBackButton(button, parentPath) {
  button.hidden = parentPath === null;
  button.onclick = () => {
    if (hasNavigated && window.history.length > 1) window.history.back();
    else window.location.replace(`#${parentPath ?? '/'}`);
  };
}

/**
 * Affiche l'ecran correspondant a l'adresse (#/planning, #/recettes/colombo...).
 * @param {HTMLElement} view
 * @param {HTMLElement} nav
 * @param {HTMLButtonElement} back
 */
async function show(view, nav, back) {
  const { route, params } = match();
  updateBackButton(back, route.parent ? route.parent(params) : null);
  document.title = route.title === 'Accueil' ? 'MealDom' : `${route.title} – MealDom`;
  for (const link of nav.querySelectorAll('a[data-tab]')) {
    if (link.getAttribute('data-tab') === route.tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  try {
    await route.render(view, params);
  } catch (error) {
    console.error(error);
    view.innerHTML = '<p class="error">Cet écran n’a pas pu s’afficher. Rechargez l’application.</p>';
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/**
 * @param {HTMLElement} view
 * @param {HTMLElement} nav
 * @param {HTMLButtonElement} back
 */
export function startRouter(view, nav, back) {
  window.addEventListener('hashchange', () => {
    hasNavigated = true;
    show(view, nav, back);
  });
  show(view, nav, back);
}
