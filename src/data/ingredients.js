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
    id: 'rice_white', aisle: 'grocery',
    name: 'riz blanc',
    aliases: ['riz', 'riz long', 'riz basmati', 'white rice', 'rice'],
    allergens: [],
    conversions: [{ fromUnit: 'cup', toUnit: 'g', factor: 185, source: USDA, confidence: 'high', note: 'riz cru' }],
  },
  {
    id: 'wheat_flour', aisle: 'grocery',
    name: 'farine de blé',
    aliases: ['farine', 'farine t45', 'farine t55', 'flour', 'all-purpose flour'],
    allergens: ['gluten'],
    conversions: [{ fromUnit: 'cup', toUnit: 'g', factor: 125, source: USDA, confidence: 'high' }],
  },
  {
    id: 'sugar_white', aisle: 'grocery',
    name: 'sucre blanc',
    aliases: ['sucre', 'sucre en poudre', 'sucre semoule', 'sugar'],
    allergens: [],
    conversions: [{ fromUnit: 'cup', toUnit: 'g', factor: 200, source: USDA, confidence: 'high' }],
  },
  {
    id: 'butter', aisle: 'dairy_eggs',
    name: 'beurre',
    aliases: ['butter'],
    allergens: ['milk'],
    categories: ['dairy'],
    conversions: [{ fromUnit: 'tbsp', toUnit: 'g', factor: 14.2, source: USDA, confidence: 'high' }],
  },
  {
    id: 'milk', aisle: 'dairy_eggs',
    name: 'lait',
    aliases: ['lait entier', 'lait demi-écrémé', 'milk'],
    allergens: ['milk'],
    categories: ['dairy'],
    conversions: [{ fromUnit: 'cup', toUnit: 'g', factor: 244, source: USDA, confidence: 'high' }],
  },
  {
    id: 'olive_oil', aisle: 'grocery',
    name: "huile d'olive",
    aliases: ['olive oil'],
    allergens: [],
    conversions: [{ fromUnit: 'tbsp', toUnit: 'g', factor: 13.5, source: USDA, confidence: 'high' }],
  },
  {
    id: 'onion', aisle: 'fruits_vegetables',
    name: 'oignon',
    aliases: ['oignons', 'oignon jaune', 'onion', 'onions'],
    allergens: [],
    conversions: [{ fromUnit: 'piece', toUnit: 'g', factor: 110, source: USDA, confidence: 'medium', note: 'oignon moyen' }],
  },
  {
    id: 'egg', aisle: 'dairy_eggs',
    name: 'œuf',
    aliases: ['oeuf', 'œufs', 'oeufs', 'egg', 'eggs'],
    allergens: ['eggs'],
    categories: ['egg'],
    conversions: [{ fromUnit: 'piece', toUnit: 'g', factor: 50, source: USDA, confidence: 'medium', note: 'gros œuf, sans coquille' }],
  },
  {
    id: 'tomato', aisle: 'fruits_vegetables',
    name: 'tomate',
    aliases: ['tomates', 'tomato', 'tomatoes'],
    allergens: [],
    conversions: [{ fromUnit: 'piece', toUnit: 'g', factor: 123, source: USDA, confidence: 'medium', note: 'tomate moyenne' }],
  },
  { id: 'chicken', aisle: 'meat_fish', name: 'poulet', aliases: ['blanc de poulet', 'cuisse de poulet', 'chicken'], allergens: [], categories: ['meat', 'poultry'], conversions: [] },
  { id: 'shrimp', aisle: 'meat_fish', name: 'crevette', aliases: ['crevettes', 'shrimp', 'prawns'], allergens: ['crustaceans'], categories: ['shellfish'], conversions: [] },
  { id: 'cod', aisle: 'meat_fish', name: 'morue', aliases: ['cabillaud', 'cod'], allergens: ['fish'], categories: ['fish'], conversions: [] },
  { id: 'peanut', aisle: 'grocery', name: 'cacahuète', aliases: ['cacahuètes', 'arachide', 'arachides', 'peanut', 'peanuts'], allergens: ['peanuts'], conversions: [] },
  { id: 'soy_sauce', aisle: 'spices', name: 'sauce soja', aliases: ['soy sauce'], allergens: ['soy', 'gluten'], conversions: [] },
  { id: 'mustard', aisle: 'spices', name: 'moutarde', aliases: ['mustard'], allergens: ['mustard'], conversions: [] },
  { id: 'sesame_seeds', aisle: 'grocery', name: 'graines de sésame', aliases: ['sésame', 'sesame seeds'], allergens: ['sesame'], conversions: [] },
  { id: 'red_lentils', aisle: 'grocery', name: 'lentilles corail', aliases: ['red lentils'], allergens: [], conversions: [] },
  { id: 'garlic', aisle: 'fruits_vegetables', name: 'ail', aliases: ["gousse d'ail", "gousses d'ail", 'garlic'], allergens: [], conversions: [] },
  { id: 'salt', aisle: 'spices', name: 'sel', aliases: ['salt'], allergens: [], conversions: [] },
  { id: 'black_pepper', aisle: 'spices', name: 'poivre', aliases: ['poivre noir', 'pepper', 'black pepper'], allergens: [], conversions: [] },
  { id: 'water', name: 'eau', aliases: ['water'], allergens: [], conversions: [], notPurchased: true },
  { id: 'vegetable_oil', aisle: 'grocery', name: 'huile végétale', aliases: ['huile', 'huile de tournesol', 'vegetable oil'], allergens: [], conversions: [] },
  { id: 'potato', aisle: 'fruits_vegetables', name: 'pomme de terre', aliases: ['pommes de terre', 'potato', 'potatoes'], allergens: [], conversions: [] },
  { id: 'zucchini', aisle: 'fruits_vegetables', name: 'courgette', aliases: ['courgettes', 'zucchini'], allergens: [], conversions: [] },
  { id: 'lime', aisle: 'fruits_vegetables', name: 'citron vert', aliases: ['citrons verts', 'lime', 'limes'], allergens: [], conversions: [] },
  {
    id: 'colombo_powder', aisle: 'spices',
    name: 'poudre à colombo',
    aliases: ['colombo', 'poudre de colombo'],
    // Les melanges traditionnels contiennent des graines de moutarde.
    allergens: ['mustard'],
    conversions: [],
  },
  { id: 'carrot', aisle: 'fruits_vegetables', name: 'carotte', aliases: ['carottes', 'carrot', 'carrots'], allergens: [], conversions: [] },
  { id: 'peas_frozen', aisle: 'frozen', name: 'petits pois surgelés', aliases: ['petits pois', 'peas'], allergens: [], conversions: [] },
  { id: 'ground_beef', aisle: 'meat_fish', name: 'bœuf haché', aliases: ['boeuf haché', 'viande hachée', 'ground beef'], allergens: [], categories: ['meat'], conversions: [] },
  { id: 'red_beans_cooked', aisle: 'grocery', name: 'haricots rouges cuits', aliases: ['haricots rouges', 'red kidney beans'], allergens: [], conversions: [] },
  { id: 'crushed_tomatoes', aisle: 'grocery', name: 'tomates concassées', aliases: ['tomates concassées en conserve', 'crushed tomatoes'], allergens: [], conversions: [] },
  { id: 'cumin', aisle: 'spices', name: 'cumin moulu', aliases: ['cumin', 'ground cumin'], allergens: [], conversions: [] },
  { id: 'chili_powder', aisle: 'spices', name: 'piment en poudre', aliases: ['piment', 'chili powder'], allergens: [], conversions: [] },
  { id: 'pasta', aisle: 'grocery', name: 'pâtes', aliases: ['spaghetti', 'pasta'], allergens: ['gluten'], conversions: [] },
  { id: 'basil', aisle: 'fruits_vegetables', name: 'basilic frais', aliases: ['basilic', 'basil'], allergens: [], conversions: [] },
  {
    id: 'parmesan', aisle: 'dairy_eggs',
    name: 'parmesan',
    aliases: ['parmigiano'],
    allergens: ['milk'],
    // Le parmesan AOP est fabrique avec de la presure animale.
    categories: ['dairy', 'animal_rennet'],
    conversions: [],
  },
  { id: 'coconut_milk', aisle: 'grocery', name: 'lait de coco', aliases: ['coconut milk'], allergens: [], conversions: [] },
  { id: 'ginger', aisle: 'fruits_vegetables', name: 'gingembre frais', aliases: ['gingembre', 'ginger'], allergens: [], conversions: [] },
  { id: 'turmeric', aisle: 'spices', name: 'curcuma', aliases: ['turmeric'], allergens: [], conversions: [] },
  { id: 'coriander', aisle: 'fruits_vegetables', name: 'coriandre fraîche', aliases: ['coriandre', 'cilantro'], allergens: [], conversions: [] },
  { id: 'wheat_tortilla', aisle: 'bakery', name: 'tortillas de blé', aliases: ['tortillas', 'tortilla', 'wraps'], allergens: ['gluten'], conversions: [] },
  { id: 'avocado', aisle: 'fruits_vegetables', name: 'avocat', aliases: ['avocats', 'avocado'], allergens: [], conversions: [] },
  { id: 'bay_leaf', aisle: 'spices', name: 'laurier', aliases: ['feuille de laurier', 'feuilles de laurier', 'bay leaf'], allergens: [], conversions: [] },
];
