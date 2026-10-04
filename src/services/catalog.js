/**
 * Acces au catalogue (ingredients, preparations, recettes, cuisines).
 * Les index sont construits une seule fois.
 */
import { INGREDIENTS } from '../data/ingredients.js';
import { PREPARATIONS } from '../data/preparations.js';
import { RECIPES } from '../data/recipes.js';
import { CUISINES } from '../data/cuisines.js';

export const ingredientsById = new Map(INGREDIENTS.map((i) => [i.id, i]));
export const preparationsById = new Map(PREPARATIONS.map((p) => [p.id, p]));
export const recipesById = new Map(RECIPES.map((r) => [r.id, r]));
export const cuisineLabels = new Map(CUISINES.map((c) => [c.id, c.label]));
export const recipes = RECIPES;

/** Contexte utilise par le filtrage des recettes. */
export const filterContext = { ingredients: ingredientsById, preparations: preparationsById, cuisineLabels };
