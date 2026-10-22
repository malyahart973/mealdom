/**
 * Catalogue complet : recettes de base (recipes.js) et catalogue etendu (catalog/).
 * C'est la liste utilisee par l'application ; les tests de base gardent RECIPES.
 */
import { RECIPES } from './recipes.js';
import { BREAKFAST_RECIPES } from './catalog/breakfast.js';
import { SNACK_RECIPES } from './catalog/snacks.js';
import { ASIA_EAST_RECIPES } from './catalog/asiaEast.js';
import { ASIA_SOUTHEAST_RECIPES } from './catalog/asiaSoutheast.js';
import { ASIA_SOUTH_RECIPES } from './catalog/asiaSouth.js';
import { WORLD_EUROPE_RECIPES } from './catalog/worldEurope.js';
import { WORLD_TROPICS_RECIPES } from './catalog/worldTropics.js';
import { WORLD_AMERICAS_RECIPES } from './catalog/worldAmericas.js';
import { LIGHT_RECIPES } from './catalog/light.js';

/** @type {import('../domain/recipes/recipes.js').Recipe[]} */
export const ALL_RECIPES = [...RECIPES, ...BREAKFAST_RECIPES, ...SNACK_RECIPES, ...ASIA_EAST_RECIPES, ...ASIA_SOUTHEAST_RECIPES, ...ASIA_SOUTH_RECIPES, ...WORLD_EUROPE_RECIPES, ...WORLD_TROPICS_RECIPES, ...WORLD_AMERICAS_RECIPES, ...LIGHT_RECIPES];
