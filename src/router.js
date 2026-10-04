import { renderHome } from './pages/home.js';
import { renderPlaceholder } from './pages/placeholder.js';
import { renderMore } from './pages/more.js';
import { renderSettings } from './pages/settings.js';
import { renderRecipes } from './pages/recipes.js';
import { renderRecipe } from './pages/recipe.js';

/**
 * @typedef {Object} Route
 * @property {RegExp} pattern     Adresse ; les groupes nommes deviennent des parametres
 * @property {string} title       Titre de l'onglet du navigateur
 * @property {string} tab         Onglet de la barre du bas a mettre en avant
 * @property {(el: HTMLElement, params: Record<string, string>) => void | Promise<void>} render
 */

/** @type {Route[]} */
const routes = [
  { pattern: /^\/$/, title: 'Accueil', tab: '/', render: renderHome },
  {
    pattern: /^\/planning$/,
    title: 'Planning',
    tab: '/planning',
    render: (el) =>
      renderPlaceholder(el, {
        title: 'Planning',
        text: 'Vous construirez ici la semaine : repas, portions, et dîner qui sert aussi au déjeuner du lendemain.',
      }),
  },
  { pattern: /^\/recettes$/, title: 'Recettes', tab: '/recettes', render: renderRecipes },
  { pattern: /^\/recettes\/(?<id>[^/]+)$/, title: 'Recette', tab: '/recettes', render: renderRecipe },
  {
    pattern: /^\/courses$/,
    title: 'Courses',
    tab: '/courses',
    render: (el) =>
      renderPlaceholder(el, {
        title: 'Courses',
        text: 'La liste de courses calculée à partir du planning et du stock, et la comparaison des magasins avec le trajet.',
      }),
  },
  { pattern: /^\/plus$/, title: 'Plus', tab: '/plus', render: renderMore },
  {
    pattern: /^\/stock$/,
    title: 'Stock',
    tab: '/plus',
    render: (el) =>
      renderPlaceholder(el, {
        title: 'Stock',
        text: 'Ce que vous avez déjà dans les placards, le frigo et le congélateur, déduit automatiquement des courses.',
      }),
  },
  {
    pattern: /^\/budget$/,
    title: 'Budget',
    tab: '/plus',
    render: (el) =>
      renderPlaceholder(el, { title: 'Budget', text: 'Le budget prévu, les dépenses réellement payées et ce qu’il reste.' }),
  },
  { pattern: /^\/parametres$/, title: 'Paramètres', tab: '/plus', render: renderSettings },
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

/**
 * Affiche l'ecran correspondant a l'adresse (#/planning, #/recettes/colombo...).
 * @param {HTMLElement} view
 * @param {HTMLElement} nav
 */
async function show(view, nav) {
  const { route, params } = match();
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
 */
export function startRouter(view, nav) {
  window.addEventListener('hashchange', () => show(view, nav));
  show(view, nav);
}
