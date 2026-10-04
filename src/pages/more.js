/**
 * Ecran "Plus" : acces aux sections secondaires.
 * @param {HTMLElement} el
 */
export function renderMore(el) {
  el.innerHTML = `
    <section>
      <h1 class="page-title">Plus</h1>
      <ul class="link-list">
        <li><a href="#/foyer">Mon foyer<span>Personnes, allergies, régimes, équipement</span></a></li>
        <li><a href="#/stock">Stock<span>Ce que vous avez déjà à la maison</span></a></li>
        <li><a href="#/budget">Budget<span>Budget prévu et dépenses réelles</span></a></li>
        <li><a href="#/parametres">Paramètres<span>Sauvegarde et version</span></a></li>
      </ul>
    </section>
  `;
}
