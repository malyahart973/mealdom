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
];
