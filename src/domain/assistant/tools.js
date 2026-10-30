/**
 * Outils mis a disposition du modele IA. Le modele PROPOSE, EXPLIQUE et CALCULE
 * a partir de ces outils ; l'application VERIFIE les prix et EXECUTE seulement
 * les operations autorisees, apres l'accord du client. Aucun outil ne permet
 * d'ecrire directement dans la base ni de passer une commande.
 */
import { OPERATION_TYPES } from './proposal.js';
import { MODES } from './intent.js';

/** Version du prompt systeme (a changer si le texte change). */
export const PROMPT_VERSION = '2026-10-23';

/** Prompt systeme (fixe, pour profiter du cache du fournisseur). */
export const SYSTEM_PROMPT = `Tu es le copilote culinaire et budgétaire de MealDom, une application de planning de repas utilisée en Guyane française. Tu réponds en français, avec des phrases courtes, chaleureuses et concrètes.

Ce que tu fais :
- Comprendre la demande du client (objectif, repas et jours concernés, produits, budget, contraintes, préférences, priorité) en gardant le contexte de la conversation : ne redemande pas une information déjà donnée ; pose une seule question courte seulement si une information indispensable manque.
- Proposer des modifications du planning, des recettes, des ingrédients ou des produits du Drive, les expliquer et en présenter l'impact.

Règles impératives :
1. Tu n'inventes JAMAIS un prix, une promotion, une disponibilité, une économie ou une compatibilité. Tu utilises uniquement les données renvoyées par les outils. Si une donnée manque ou n'est pas récente, dis-le et présente toute estimation comme une estimation.
2. Toute modification passe par l'outil propose_changes (opérations précises) ou run_optimizer (moteur de l'application). L'application vérifie chaque opération, recalcule le panier et affiche l'avant/après ; le client accepte, modifie ou annule avec les boutons. N'écris jamais qu'un changement est appliqué : il est proposé.
3. Tu ne peux pas passer de commande. La commande au Drive (Hyper U Cayenne) se fait dans l'écran Drive, après une validation explicite du client. Accepter une recette ne vaut jamais validation d'une commande.
4. Les recettes renvoyées par search_recipes conviennent déjà à tout le foyer (allergies, régimes, aliments refusés, matériel). N'en propose pas d'autres. Les repas verrouillés ne doivent pas être modifiés.
5. Les montants et économies que tu annonces sont ceux calculés par l'application dans le résultat de propose_changes ou run_optimizer, avec leur niveau de fiabilité (« vérifié Drive » ou « estimation »). Si la comparaison n'est pas possible, dis-le.
6. Pour la perte de poids, appuie-toi sur get_program (objectifs par repas, portions en grammes). Reste général et prudent ; pour toute question médicale, conseille un médecin ou un diététicien.
7. search_recipes écarte les recettes impossibles avec ce que la cliente trouve et signale dans hardToFindInGuyane les ingrédients difficiles à trouver en Guyane, avec leur alternative. Ce sont des indications générales, non vérifiées magasin par magasin : présente-les comme telles et préfère les recettes sans ingrédient difficile. Quand une alternative est appliquée, dis-le.

Méthode :
- Commence par get_planning si tu n'as pas encore le planning de la semaine dans la conversation.
- Pour une demande d'optimisation générale (plus gourmand, moins cher, plus rapide, plus léger, plus de légumes, anti-gaspillage, peu de vaisselle, promotions, cuisine asiatique, compléter la semaine...), utilise run_optimizer avec la demande reformulée, puis ajuste si besoin avec propose_changes.
- Pour une demande précise, cherche les recettes avec search_recipes et propose des opérations ciblées.
- Après la proposition, résume : ce qui change, pourquoi, le coût avant/après tel que calculé (et sa fiabilité), l'impact sur le budget et les quantités, les compromis éventuels. Termine en invitant à accepter, modifier ou annuler.`;

const slotEnum = ['breakfast', 'morning_snack', 'lunch', 'snack', 'dinner'];

/** Definitions des outils (format de l'API Messages). */
export const TOOL_DEFINITIONS = [
  {
    name: 'get_planning',
    description: 'Planning de la semaine affichée (repas, créneaux libres, repas verrouillés, invités), foyer (nombre de personnes, contraintes), budget, préférences retenues, programme minceur, et état des données de prix (Drive, promotions, fraîcheur). À appeler avant de proposer des changements.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_recipes',
    description: 'Cherche des recettes du catalogue (environ 600) qui conviennent à TOUT le foyer. Renvoie id, nom, cuisine, temps, calories et protéines par portion, étiquettes et coût estimé par portion quand des prix existent.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Mots à chercher dans le nom, la cuisine ou les ingrédients.' },
        slot: { type: 'string', enum: slotEnum, description: 'Repas visé.' },
        cuisine: { type: 'string', description: 'Identifiant de cuisine (thai, japanese, korean, chinese, vietnamese, indian, caribbean, guianese, french, italian...).' },
        region: { type: 'string', enum: ['asia', 'caribbean', 'europe', 'africa', 'middle_east', 'americas'] },
        maxMinutes: { type: 'integer', minimum: 5, maximum: 300 },
        tags: { type: 'array', items: { type: 'string', enum: ['gourmand', 'light', 'budget', 'convivial', 'spicy', 'make_ahead', 'kids'] } },
        includeIngredient: { type: 'string', description: 'Identifiant d’ingrédient qui doit être présent.' },
        excludeIngredients: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_recipe',
    description: 'Détail d’une recette : ingrédients avec quantités, préparations, temps, valeurs nutritionnelles par portion.',
    input_schema: { type: 'object', properties: { recipeId: { type: 'string' } }, required: ['recipeId'], additionalProperties: false },
  },
  {
    name: 'get_prices',
    description: 'Prix connus pour des ingrédients : produits du Drive (prix, contenance, disponibilité, promotion, date du relevé, vérifié ou à revérifier) et prix relevés à la main. Ne renvoie que des données enregistrées : une absence signifie « prix inconnu ».',
    input_schema: { type: 'object', properties: { ingredientIds: { type: 'array', items: { type: 'string' }, maxItems: 30 } }, required: ['ingredientIds'], additionalProperties: false },
  },
  {
    name: 'get_promotions',
    description: 'Promotions actives aujourd’hui au Drive du magasin choisi, avec conditions et dates. Seules les promotions enregistrées et dont le relevé est récent sont « vérifiées ».',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_program',
    description: 'Programme minceur du client s’il est actif : objectif calorique du jour, calories et protéines visées par repas, progression du poids.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_optimizer',
    description: `Fait travailler le moteur de l'application sur une demande en langage naturel (ex. « des repas plus gourmands sans dépasser le budget », « complète la semaine avec des plats asiatiques légers »). Le moteur respecte foyer, verrous et préférences, combine les objectifs (${MODES.map((m) => m.id).join(', ')}), puis l'application chiffre l'avant/après. Renvoie la proposition et son bilan.`,
    input_schema: { type: 'object', properties: { request: { type: 'string', description: 'Demande reformulée, en français.' } }, required: ['request'], additionalProperties: false },
  },
  {
    name: 'propose_changes',
    description: 'Prépare une proposition de modification composée d’opérations précises. L’application vérifie chaque opération (foyer, verrous, créneaux), recalcule la liste de courses et le coût, et renvoie le bilan. Rien n’est appliqué sans l’accord du client.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Résumé en une phrase.' },
        operations: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: OPERATION_TYPES },
              mealId: { type: 'string' },
              recipeId: { type: 'string' },
              date: { type: 'string', description: 'AAAA-MM-JJ (add_meal)' },
              slot: { type: 'string', enum: slotEnum },
              guests: { type: 'integer', minimum: 0, maximum: 30 },
              fromIngredientId: { type: 'string' },
              toIngredientId: { type: 'string' },
              ingredientId: { type: 'string' },
              productId: { type: 'string' },
              weeklyBudgetEuros: { type: 'number', minimum: 0 },
              reason: { type: 'string', description: 'Pourquoi ce changement, en une phrase.' },
            },
            required: ['type', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['summary', 'operations'],
      additionalProperties: false,
    },
  },
  {
    name: 'remember_preference',
    description: 'Retient une préférence quand le client le demande explicitement (« retiens que », « à l’avenir »). Le client peut la voir et la modifier dans l’écran Préférences.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['mode', 'cuisine', 'avoid', 'max_minutes'] },
        value: { type: 'string', description: `mode : ${MODES.map((m) => m.id).join(', ')} ; cuisine : identifiant ; avoid : ingrédient ou famille ; max_minutes : nombre.` },
        label: { type: 'string', description: 'Libellé lisible pour le client.' },
      },
      required: ['kind', 'value', 'label'],
      additionalProperties: false,
    },
  },
];

/** @type {Set<string>} */
export const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name));
