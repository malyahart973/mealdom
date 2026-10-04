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
  { id: 'black_pepper', name: 'poivre', aliases: ['poivre noir', 'pepper', 'black pepper'], allergens: [], conversions: [] },
  { id: 'water', name: 'eau', aliases: ['water'], allergens: [], conversions: [], notPurchased: true },
  { id: 'vegetable_oil', name: 'huile végétale', aliases: ['huile', 'huile de tournesol', 'vegetable oil'], allergens: [], conversions: [] },
  { id: 'potato', name: 'pomme de terre', aliases: ['pommes de terre', 'potato', 'potatoes'], allergens: [], conversions: [] },
  { id: 'zucchini', name: 'courgette', aliases: ['courgettes', 'zucchini'], allergens: [], conversions: [] },
  { id: 'lime', name: 'citron vert', aliases: ['citrons verts', 'lime', 'limes'], allergens: [], conversions: [] },
  {
    id: 'colombo_powder',
    name: 'poudre à colombo',
    aliases: ['colombo', 'poudre de colombo'],
    // Les melanges traditionnels contiennent des graines de moutarde.
    allergens: ['mustard'],
    conversions: [],
  },
  { id: 'carrot', name: 'carotte', aliases: ['carottes', 'carrot', 'carrots'], allergens: [], conversions: [] },
  { id: 'peas_frozen', name: 'petits pois surgelés', aliases: ['petits pois', 'peas'], allergens: [], conversions: [] },
  { id: 'ground_beef', name: 'bœuf haché', aliases: ['boeuf haché', 'viande hachée', 'ground beef'], allergens: [], conversions: [] },
  { id: 'red_beans_cooked', name: 'haricots rouges cuits', aliases: ['haricots rouges', 'red kidney beans'], allergens: [], conversions: [] },
  { id: 'crushed_tomatoes', name: 'tomates concassées', aliases: ['tomates concassées en conserve', 'crushed tomatoes'], allergens: [], conversions: [] },
  { id: 'cumin', name: 'cumin moulu', aliases: ['cumin', 'ground cumin'], allergens: [], conversions: [] },
  { id: 'chili_powder', name: 'piment en poudre', aliases: ['piment', 'chili powder'], allergens: [], conversions: [] },
  { id: 'pasta', name: 'pâtes', aliases: ['spaghetti', 'pasta'], allergens: ['gluten'], conversions: [] },
  { id: 'basil', name: 'basilic frais', aliases: ['basilic', 'basil'], allergens: [], conversions: [] },
  { id: 'parmesan', name: 'parmesan', aliases: ['parmigiano'], allergens: ['milk'], conversions: [] },
  { id: 'coconut_milk', name: 'lait de coco', aliases: ['coconut milk'], allergens: [], conversions: [] },
  { id: 'ginger', name: 'gingembre frais', aliases: ['gingembre', 'ginger'], allergens: [], conversions: [] },
  { id: 'turmeric', name: 'curcuma', aliases: ['turmeric'], allergens: [], conversions: [] },
  { id: 'coriander', name: 'coriandre fraîche', aliases: ['coriandre', 'cilantro'], allergens: [], conversions: [] },
];
