/** Rubriques de l'ecran "Plus" : peu d'entrees, rangees par usage. */
const SECTIONS = [
  {
    title: 'Ma santé',
    links: [
      ['#/programme', 'Mon programme', 'Repas de votre coach ou repères calculés, objectif, réglages'],
      ['#/poids', 'Pesée et mensurations', 'Courbe, mensurations, bilan à envoyer au coach'],
    ],
  },
  {
    title: 'Ma maison',
    links: [
      ['#/foyer', 'Mon foyer', 'Personnes, allergies, régimes, équipement'],
      ['#/stock', 'Stock', 'Ce que vous avez déjà à la maison'],
    ],
  },
  {
    title: 'Courses et prix',
    links: [
      ['#/prix', 'Prix', 'Scanner ou saisir un prix, photo du ticket, historique'],
      ['#/budget', 'Budget', 'Budget prévu, dépenses réelles, reste'],
      ['#/magasins', 'Magasins', 'Vos magasins, distances et prix relevés'],
      ['#/drive', 'Drive Hyper U Cayenne', 'Promotions, panier et commande'],
      ['#/saison', 'Produits de saison', 'Péyi, prix au plus bas, votre calendrier'],
    ],
  },
  {
    title: 'Assistant et réglages',
    links: [
      ['#/assistant/planifier', 'Assistant', 'Planifier ma semaine, ou demander ce que vous voulez'],
      ['#/parametres', 'Paramètres', 'Sauvegarde, assistant IA, préférences retenues, version'],
    ],
  },
];

/**
 * Ecran "Plus" : acces aux sections secondaires, en quatre rubriques.
 * @param {HTMLElement} el
 */
export function renderMore(el) {
  el.innerHTML = `
    <section>
      <h1 class="page-title">Plus</h1>
      ${SECTIONS.map(
        (s) => `<h2 class="more__title">${s.title}</h2>
          <ul class="link-list">${s.links.map(([href, label, hint]) => `<li><a href="${href}">${label}<span>${hint}</span></a></li>`).join('')}</ul>`,
      ).join('')}
    </section>
  `;
}
