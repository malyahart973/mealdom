/**
 * Calcul des portions (regles RM-02 a RM-07 du cahier des charges).
 * Une portion = une portion ADULTE de reference.
 */

/** @typedef {{ category: string, label: string, coefficient: number }} PortionRule */

/**
 * Somme des coefficients des personnes presentes a un repas.
 * Une categorie inconnue est une erreur : on ne devine pas un coefficient.
 * @param {string[]} memberCategories   ex. ['adult', 'adult', 'child']
 * @param {PortionRule[]} rules
 * @returns {number}
 */
export function sumPortions(memberCategories, rules) {
  const coefficients = new Map(rules.map((r) => [r.category, r.coefficient]));
  let total = 0;
  for (const category of memberCategories) {
    const coefficient = coefficients.get(category);
    if (coefficient === undefined) {
      throw new Error(`Categorie d'age inconnue : "${category}".`);
    }
    total += coefficient;
  }
  return Math.round(total * 1e9) / 1e9;
}

/**
 * Arrondi a la demi-portion superieure : 2,1 -> 2,5 ; 2,5 -> 2,5 ; 2,6 -> 3.
 * @param {number} portions
 * @returns {number}
 */
export function roundUpToHalf(portions) {
  const doubled = Math.round(portions * 2 * 1e6) / 1e6;
  return Math.ceil(doubled) / 2;
}

/**
 * Portions a prevoir pour un repas.
 * @param {string[]} memberCategories
 * @param {PortionRule[]} rules
 * @returns {number}
 */
export function mealPortions(memberCategories, rules) {
  return roundUpToHalf(sumPortions(memberCategories, rules));
}

/**
 * Diner qui sert aussi au dejeuner du lendemain : chaque repas est calcule
 * separement (personnes presentes differentes), puis les deux sont additionnes.
 * @param {string[]} dinnerCategories
 * @param {string[]} nextLunchCategories
 * @param {PortionRule[]} rules
 * @returns {{ dinner: number, lunch: number, total: number }}
 */
export function dinnerWithNextLunch(dinnerCategories, nextLunchCategories, rules) {
  const dinner = mealPortions(dinnerCategories, rules);
  const lunch = mealPortions(nextLunchCategories, rules);
  return { dinner, lunch, total: dinner + lunch };
}
