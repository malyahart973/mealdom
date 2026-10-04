import { renderHome } from './pages/home.js';
import { renderPlaceholder } from './pages/placeholder.js';
import { renderMore } from './pages/more.js';
import { renderSettings } from './pages/settings.js';

/**
 * @typedef {Object} Route
 * @property {string} title       Titre de l'onglet du navigateur
 * @property {string} tab         Onglet de la barre du bas a mettre en avant
 * @property {(el: HTMLElement) => void | Promise<void>} render
 */

/** @type {Record<string, Route>} */
const routes = {
  '/': { title: 'Accueil', tab: '/', render: renderHome },
  '/planning': {
    title: 'Planning',
    tab: '/planning',
    render: (el) =>
      renderPlaceholder(el, {
        title: 'Planning',
        text: 'Vous construirez ici la semaine : repas, portions, et dîner qui sert aussi au déjeuner du lendemain.',
      }),
  },
  '/recettes': {
    title: 'Recettes',
    tab: '/recettes',
    render: (el) =>
      renderPlaceholder(el, {
        title: 'Recettes',
        text: 'Des recettes du monde entier, dont des plats en une seule cocotte, filtrées selon les allergies et l’équipement du foyer.',
      }),
  },
  '/courses': {
    title: 'Courses',
    tab: '/courses',
    render: (el) =>
      renderPlaceholder(el, {
        title: 'Courses',
        text: 'La liste de courses calculée à partir du planning et du stock, et la comparaison des magasins avec le trajet.',
      }),
  },
  '/plus': { title: 'Plus', tab: '/plus', render: renderMore },
  '/stock': {
    title: 'Stock',
    tab: '/plus',
    render: (el) =>
      renderPlaceholder(el, {
        title: 'Stock',
        text: 'Ce que vous avez déjà dans les placards, le frigo et le congélateur, déduit automatiquement des courses.',
      }),
  },
  '/budget': {
    title: 'Budget',
    tab: '/plus',
    render: (el) =>
      renderPlaceholder(el, {
        title: 'Budget',
        text: 'Le budget prévu, les dépenses réellement payées et ce qu’il reste.',
      }),
  },
  '/parametres': { title: 'Paramètres', tab: '/plus', render: renderSettings },
};

/** @returns {string} */
function currentPath() {
  const path = window.location.hash.replace(/^#/, '') || '/';
  return path in routes ? path : '/';
}

/**
 * Affiche l'ecran correspondant a l'adresse (#/planning, #/recettes...).
 * @param {HTMLElement} view
 * @param {HTMLElement} nav
 */
async function show(view, nav) {
  const path = currentPath();
  const route = routes[path];
  document.title = route.title === 'Accueil' ? 'MealDom' : `${route.title} – MealDom`;
  for (const link of nav.querySelectorAll('a[data-tab]')) {
    if (link.getAttribute('data-tab') === route.tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  try {
    await route.render(view);
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
