import { test, assertEqual } from './runner.js';
import { parseRequest, mergeRequests, makeIngredientFinder, describeRequest } from '../src/domain/assistant/intent.js';
import { buildNameIndex } from '../src/domain/ingredients/ingredients.js';
import { INGREDIENTS } from '../src/data/ingredients.js';

const finder = makeIngredientFinder(buildNameIndex(INGREDIENTS), new Map(INGREDIENTS.map((i) => [i.id, i])));
// Semaine du lundi 19 octobre 2026, nous sommes le jeudi 22.
const ctx = { today: '2026-10-22', monday: '2026-10-19', ...finder };
/** @param {string} t */
const parse = (t) => parseRequest(t, ctx);

test('« Je veux privilégier les produits en promotion »', () => assertEqual(parse('Je veux privilégier les produits en promotion.').modes, ['promotions']));
test('« Rends les repas plus gourmands »', () => assertEqual(parse('Rends les repas plus gourmands.').modes, ['gourmand']));
test('« Réduis mon budget de 15 % » : -15 % et mode économie', () => {
  const r = parse('Réduis mon budget de 15 %.');
  assertEqual([r.budgetPercent, r.modes.includes('economy')], [-15, true]);
});
test('« Je veux manger plus de légumes »', () => {
  const r = parse('Je veux manger plus de légumes.');
  assertEqual([r.modes.includes('vegetables'), r.avoid.length], [true, 0]);
});
test('« Remplace le poisson de mardi par du poulet »', () => {
  const r = parse('Remplace le poisson de mardi par du poulet.');
  assertEqual([r.replace?.from.category, r.replace?.to.ingredientId, r.days], ['fish', 'chicken', ['2026-10-20']]);
});
test('« Prévois un repas convivial pour samedi soir »', () => {
  const r = parse('Prévois un repas convivial pour samedi soir.');
  assertEqual([r.convivial, r.addMeal, r.days, r.slots], [true, true, ['2026-10-24'], ['dinner']]);
});
test('« Utilise les restes du repas précédent »', () => assertEqual(parse('Utilise les restes du repas précédent.').leftovers, true));
test('« Trouve une alternative moins chère à ce produit » (produit affiché à l’écran)', () =>
  assertEqual(parseRequest('Trouve une alternative moins chère à ce produit.', { ...ctx, focusIngredientId: 'salmon' }).cheaperAlternativeFor, 'salmon'));
test('« Une alternative moins chère au saumon »', () => assertEqual(parse('Une alternative moins chère au saumon ?').cheaperAlternativeFor, 'salmon'));
test('« Je reçois quatre personnes supplémentaires dimanche »', () => {
  const r = parse('Je reçois quatre personnes supplémentaires dimanche.');
  assertEqual([r.guests, r.days], [{ count: 4, mode: 'add' }, ['2026-10-25']]);
});
test('« Garde les mêmes repas, mais propose des ingrédients de meilleure qualité »', () => {
  const r = parse('Garde les mêmes repas, mais propose des ingrédients de meilleure qualité.');
  assertEqual([r.keepMeals, r.modes.includes('quality')], [true, true]);
});
test('Modes combinés : « Des repas gourmands, en promotion, en moins de 30 minutes »', () => {
  const r = parse('Des repas gourmands, en promotion, en moins de 30 minutes.');
  assertEqual([r.modes.sort(), r.maxMinutes], [['gourmand', 'promotions', 'quick'], 30]);
});
test('« Peu de vaisselle » reconnu', () => assertEqual(parse('Je veux faire peu de vaisselle').modes, ['few_dishes']));
test('« Sans porc » : famille à éviter', () => assertEqual(parse('Des plats asiatiques sans porc').avoid.map((a) => a.category), ['pork']));
test('Cuisine asiatique reconnue', () => assertEqual(parse('Plus de recettes asiatiques cette semaine').region, 'asia'));
test('« Ce soir » = aujourd’hui au dîner', () => {
  const r = parse('Quelque chose de léger ce soir');
  assertEqual([r.days, r.slots, r.modes], [['2026-10-22'], ['dinner'], ['light']]);
});
test('Contexte : « gourmand » puis « mais sans dépasser mon budget » garde les deux', () => {
  const first = parse('Je veux des repas plus gourmands.');
  const merged = mergeRequests(first, parse('Mais sans dépasser mon budget.'));
  assertEqual([merged.modes, merged.budgetCap], [['gourmand'], 'keep']);
});
test('Contexte : une nouvelle demande d’action ne reprend pas l’ancienne', () => {
  const first = parse('Je veux des repas plus gourmands.');
  const merged = mergeRequests(first, parse('Remplace le poisson de mardi par du poulet.'));
  assertEqual(merged.modes, []);
});
test('Contexte : « oublie » repart de zéro', () => {
  const merged = mergeRequests(parse('Repas gourmands'), parse('Oublie tout, recommence.'));
  assertEqual(merged.modes, []);
});
test('Annuler la dernière modification', () => assertEqual(parse('Annule la dernière modification').undo, true));
test('Retenir une préférence', () => assertEqual(parse('Retiens que je veux toujours des recettes rapides').remember, true));
test('Phrase hors sujet : non comprise', () => assertEqual(parse('Quel temps fait-il ?').understood, false));
test('« Fais-moi le planning de la semaine » : génération demandée', () => assertEqual(parse('Fais-moi le planning de la semaine').generate, true));
test('« Fais-moi un planning pour la semaine » : demande comprise et résumée', () => {
  const r = parse('Fais-moi un planning pour la semaine');
  assertEqual([r.generate, describeRequest(r, (d) => d, new Map())], [true, 'J’ai compris : composer le planning.']);
});
