/**
 * Catalogue initial des ingredients normalises.
 * Il sera complete au fil de la constitution du catalogue de recettes.
 *
 * Conversions propres aux ingredients : mesures menageres des tables USDA
 * FoodData Central (SR Legacy). Le "cup" est la tasse americaine (236,59 ml).
 * Les pieces (oignon, oeuf, tomate) varient selon la taille : confiance moyenne.
 */

/** @typedef {import('../domain/ingredients/ingredients.js').Ingredient} Ingredient */

const USDA = 'USDA FoodData Central (SR Legacy), mesure ménagère';

/** @type {Ingredient[]} */
export const INGREDIENTS = [
  {
    id: 'rice_white',
    name: 'riz blanc',
    aliases: ['riz', 'riz long', 'riz basmati', 'white rice', 'rice'],
    allergens: [],
    conversions: [{ fromUnit: 'cup', toUnit: 'g', factor: 185, source: USDA, confidence: 'high', note: 'riz cru' }],
  },
  {
    id: 'wheat_flour',
    name: 'farine de blé',
    aliases: ['farine', 'farine t45', 'farine t55', 'flour', 'all-purpose flour'],
    allergens: ['gluten'],
    conversions: [{ fromUnit: 'cup', toUnit: 'g', factor: 125, source: USDA, confidence: 'high' }],
  },
  {
    id: 'sugar_white',
    name: 'sucre blanc',
    aliases: ['sucre', 'sucre en poudre', 'sucre semoule', 'sugar'],
    allergens: [],
    conversions: [{ fromUnit: 'cup', toUnit: 'g', factor: 200, source: USDA, confidence: 'high' }],
  },
  {
    id: 'butter',
    name: 'beurre',
    aliases: ['butter'],
    allergens: ['milk'],
    conversions: [{ fromUnit: 'tbsp', toUnit: 'g', factor: 14.2, source: USDA, confidence: 'high' }],
  },
  {
    id: 'milk',
    name: 'lait',
    aliases: ['lait entier', 'lait demi-écrémé', 'milk'],
    allergens: ['milk'],
    conversions: [{ fromUnit: 'cup', toUnit: 'g', factor: 244, source: USDA, confidence: 'high' }],
  },
  {
    id: 'olive_oil',
    name: "huile d'olive",
    aliases: ['olive oil'],
    allergens: [],
    conversions: [{ fromUnit: 'tbsp', toUnit: 'g', factor: 13.5, source: USDA, confidence: 'high' }],
  },
  {
    id: 'onion',
    name: 'oignon',
    aliases: ['oignons', 'oignon jaune', 'onion', 'onions'],
    allergens: [],
    conversions: [{ fromUnit: 'piece', toUnit: 'g', factor: 110, source: USDA, confidence: 'medium', note: 'oignon moyen' }],
  },
  {
    id: 'egg',
    name: 'œuf',
    aliases: ['oeuf', 'œufs', 'oeufs', 'egg', 'eggs'],
    allergens: ['eggs'],
    conversions: [{ fromUnit: 'piece', toUnit: 'g', factor: 50, source: USDA, confidence: 'medium', note: 'gros œuf, sans coquille' }],
  },
  {
    id: 'tomato',
    name: 'tomate',
    aliases: ['tomates', 'tomato', 'tomatoes'],
    allergens: [],
    conversions: [{ fromUnit: 'piece', toUnit: 'g', factor: 123, source: USDA, confidence: 'medium', note: 'tomate moyenne' }],
  },
  { id: 'chicken', name: 'poulet', aliases: ['blanc de poulet', 'cuisse de poulet', 'chicken'], allergens: [], conversions: [] },
  { id: 'shrimp', name: 'crevette', aliases: ['crevettes', 'shrimp', 'prawns'], allergens: ['crustaceans'], conversions: [] },
  { id: 'cod', name: 'morue', aliases: ['cabillaud', 'cod'], allergens: ['fish'], conversions: [] },
  { id: 'peanut', name: 'cacahuète', aliases: ['cacahuètes', 'arachide', 'arachides', 'peanut', 'peanuts'], allergens: ['peanuts'], conversions: [] },
  { id: 'soy_sauce', name: 'sauce soja', aliases: ['soy sauce'], allergens: ['soy', 'gluten'], conversions: [] },
  { id: 'mustard', name: 'moutarde', aliases: ['mustard'], allergens: ['mustard'], conversions: [] },
  { id: 'sesame_seeds', name: 'graines de sésame', aliases: ['sésame', 'sesame seeds'], allergens: ['sesame'], conversions: [] },
  { id: 'red_lentils', name: 'lentilles corail', aliases: ['red lentils'], allergens: [], conversions: [] },
  { id: 'garlic', name: 'ail', aliases: ["gousse d'ail", "gousses d'ail", 'garlic'], allergens: [], conversions: [] },
  { id: 'salt', name: 'sel', aliases: ['salt'], allergens: [], conversions: [] },
];
