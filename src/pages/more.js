/**
 * Ecran "Plus" : acces aux sections secondaires.
 * @param {HTMLElement} el
 */
export function renderMore(el) {
  el.innerHTML = `
    <section>
      <h1 class="page-title">Plus</h1>
      <ul class="link-list">
        <li><a href="#/assistant">Assistant<span>Modifier le planning en le demandant simplement</span></a></li>
        <li><a href="#/programme">Programme minceur<span>Vos besoins, vos portions en grammes, des idées de repas</span></a></li>
        <li><a href="#/poids">Suivi du poids<span>Pesées, courbe et progression</span></a></li>
        <li><a href="#/drive">Drive Hyper U Cayenne<span>Prix relevés, promotions, panier et commande</span></a></li>
        <li><a href="#/foyer">Mon foyer<span>Personnes, allergies, régimes, équipement</span></a></li>
        <li><a href="#/stock">Stock<span>Ce que vous avez déjà à la maison</span></a></li>
        <li><a href="#/budget">Budget<span>Budget prévu, dépenses réelles, reste</span></a></li>
        <li><a href="#/magasins">Magasins<span>Vos magasins et les prix relevés</span></a></li>
        <li><a href="#/prix">Historique des prix<span>Hausses, baisses et courbe de chaque produit</span></a></li>
        <li><a href="#/saison">Produits de saison<span>Péyi, prix au plus bas, votre calendrier</span></a></li>
        <li><a href="#/assistant/preferences">Préférences de l’assistant<span>Ce qu’il a retenu de vos demandes</span></a></li>
        <li><a href="#/parametres">Paramètres<span>Sauvegarde, assistant IA et version</span></a></li>
      </ul>
    </section>
  `;
}
