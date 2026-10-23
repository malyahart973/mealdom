/**
 * Ingredients qui peuvent etre difficiles a trouver en Guyane (Cayenne et alentours).
 * Indications PAR DEFAUT, etablies a partir de connaissances generales et non verifiees
 * magasin par magasin : la cliente les corrige (« je le trouve » / « introuvable »)
 * et ses corrections priment toujours. Un ingredient absent de la liste est considere
 * comme courant.
 */

/** @typedef {'asian_shop' | 'market' | 'imported'} Where */
/** @typedef {{ level: 'specialty' | 'rare', where: Where | null }} TerritoryHint */

/** @type {Record<Where, string>} */
export const WHERE_LABELS = {
  asian_shop: 'plutôt en épicerie asiatique',
  market: 'plutôt au marché ou chez les maraîchers',
  imported: 'rayon des produits importés, souvent cher',
};

/** @param {Where} where @returns {TerritoryHint} */
const specialty = (where) => ({ level: 'specialty', where });
/** @type {TerritoryHint} */
const RARE = { level: 'rare', where: null };

/** @type {Record<string, TerritoryHint>} */
export const GUYANE_HINTS = {
  // Epiceries asiatiques
  rice_sushi: specialty('asian_shop'),
  udon: specialty('asian_shop'),
  ramen_noodles: specialty('asian_shop'),
  glass_noodles: specialty('asian_shop'),
  rice_paper: specialty('asian_shop'),
  wonton_wrappers: specialty('asian_shop'),
  glutinous_rice_flour: specialty('asian_shop'),
  rice_flour: specialty('asian_shop'),
  panko: specialty('asian_shop'),
  mirin: specialty('asian_shop'),
  miso: specialty('asian_shop'),
  nori: specialty('asian_shop'),
  kecap_manis: specialty('asian_shop'),
  black_bean_sauce: specialty('asian_shop'),
  doubanjiang: specialty('asian_shop'),
  hoisin_sauce: specialty('asian_shop'),
  sambal: specialty('asian_shop'),
  curry_paste_red: specialty('asian_shop'),
  curry_paste_green: specialty('asian_shop'),
  curry_paste_yellow: specialty('asian_shop'),
  shiitake: specialty('asian_shop'),
  tofu: specialty('asian_shop'),
  silken_tofu: specialty('asian_shop'),
  kimchi: specialty('asian_shop'),
  edamame: specialty('asian_shop'),
  daikon: specialty('asian_shop'),
  // Marche, maraichers
  lemongrass: specialty('market'),
  thai_basil: specialty('market'),
  galangal: specialty('market'),
  kaffir_lime_leaves: specialty('market'),
  // Produits importes
  leek: specialty('imported'),
  celery: specialty('imported'),
  radish: specialty('imported'),
  beetroot: specialty('imported'),
  arugula: specialty('imported'),
  snow_peas: specialty('imported'),
  berries: specialty('imported'),
  kiwi: specialty('imported'),
  pear: specialty('imported'),
  maple_syrup: specialty('imported'),
  bulgur: specialty('imported'),
  polenta: specialty('imported'),
  chia_seeds: specialty('imported'),
  lamb: specialty('imported'),
  salmon: specialty('imported'),
  ricotta: specialty('imported'),
  reblochon: specialty('imported'),
  skyr: specialty('imported'),
  cottage_cheese: specialty('imported'),
  gnocchi: specialty('imported'),
  naan: specialty('imported'),
  pita: specialty('imported'),
  tahini: specialty('imported'),
  garam_masala: specialty('imported'),
  cardamom: specialty('imported'),
  ras_el_hanout: specialty('imported'),
  rice_arborio: specialty('imported'),
  // Souvent introuvables
  gochujang: RARE,
  doenjang: RARE,
  gochugaru: RARE,
  rice_cakes_korean: RARE,
  massaman_paste: RARE,
  wakame: RARE,
  soba: RARE,
  buckwheat_flour: RARE,
  paneer: RARE,
  endive: RARE,
  strawberries: RARE,
};
