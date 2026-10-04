/**
 * Preparations reutilisables du catalogue.
 * Une recette qui en a besoin y fait reference explicitement (voir recipes.js).
 */

/** @typedef {import('../domain/recipes/recipes.js').Preparation} Preparation */

/** @type {Preparation[]} */
export const PREPARATIONS = [
  {
    id: 'cooked_rice',
    name: 'Riz blanc cuit',
    yield: { quantity: 800, unit: 'g' },
    prepMinutes: 2,
    cookMinutes: 12,
    ingredients: [
      { ingredientId: 'rice_white', quantity: 300, unit: 'g' },
      { ingredientId: 'water', quantity: 1.5, unit: 'l' },
      { ingredientId: 'salt', quantity: null, unit: 'pinch' },
    ],
    methods: [
      {
        id: 'stovetop',
        label: 'Casserole',
        equipment: ['stovetop'],
        steps: [
          "Rincer le riz à l'eau froide jusqu'à ce que l'eau soit presque claire.",
          "Porter l'eau salée à ébullition dans une grande casserole.",
          'Verser le riz et cuire à petits bouillons le temps indiqué sur le paquet, en général 10 à 12 minutes.',
          'Égoutter, puis étaler le riz pour qu’il refroidisse vite s’il est préparé à l’avance.',
        ],
      },
    ],
  },
  {
    id: 'shredded_chicken',
    name: 'Poulet effiloché',
    yield: { quantity: 600, unit: 'g' },
    prepMinutes: 10,
    cookMinutes: 25,
    ingredients: [
      { ingredientId: 'chicken', quantity: 800, unit: 'g', note: 'blancs ou hauts de cuisse sans os' },
      { ingredientId: 'onion', quantity: 1, unit: 'piece' },
      { ingredientId: 'bay_leaf', quantity: 2, unit: 'piece' },
      { ingredientId: 'water', quantity: 1.5, unit: 'l' },
      { ingredientId: 'salt', quantity: null, unit: 'pinch' },
      { ingredientId: 'black_pepper', quantity: null, unit: 'to_taste' },
    ],
    methods: [
      {
        id: 'stovetop',
        label: 'Casserole',
        equipment: ['stovetop'],
        steps: [
          "Mettre le poulet dans une casserole avec l'oignon coupé en deux, le laurier, le sel et le poivre. Couvrir d'eau froide.",
          'Porter à frémissement, puis cuire 20 à 25 minutes à petit feu, sans faire bouillir fort. Le poulet doit être cuit à cœur.',
          'Égoutter, laisser tiédir 5 minutes, puis effilocher la viande avec deux fourchettes.',
        ],
      },
      {
        id: 'pressure_cooker',
        label: 'Autocuiseur ou multicuiseur',
        equipment: ['pressure_cooker'],
        steps: [
          "Mettre le poulet, l'oignon, le laurier, le sel et le poivre dans la cuve avec 50 cl d'eau.",
          'Fermer et cuire 10 minutes sous pression, puis laisser la pression retomber naturellement.',
          'Égoutter et effilocher la viande avec deux fourchettes.',
        ],
      },
    ],
  },
  {
    id: 'roasted_vegetables',
    name: 'Légumes rôtis',
    yield: { quantity: 700, unit: 'g' },
    prepMinutes: 15,
    cookMinutes: 35,
    ingredients: [
      { ingredientId: 'zucchini', quantity: 2, unit: 'piece' },
      { ingredientId: 'carrot', quantity: 3, unit: 'piece' },
      { ingredientId: 'onion', quantity: 2, unit: 'piece' },
      { ingredientId: 'olive_oil', quantity: 3, unit: 'tbsp' },
      { ingredientId: 'salt', quantity: null, unit: 'to_taste' },
      { ingredientId: 'black_pepper', quantity: null, unit: 'to_taste' },
    ],
    methods: [
      {
        id: 'oven',
        label: 'Au four',
        equipment: ['oven'],
        steps: [
          'Préchauffer le four à 200 °C.',
          'Couper les légumes en morceaux de taille égale, les mélanger avec l’huile, le sel et le poivre.',
          'Les étaler sur une plaque en une seule couche et rôtir 30 à 35 minutes, en remuant à mi-cuisson.',
        ],
      },
      {
        id: 'air_fryer',
        label: 'Air fryer',
        equipment: ['air_fryer'],
        steps: [
          'Couper les légumes en morceaux de taille égale, les mélanger avec l’huile, le sel et le poivre.',
          'Cuire à 190 °C pendant 18 à 22 minutes en deux fournées si besoin, en secouant le panier à mi-cuisson.',
        ],
      },
    ],
  },
];
