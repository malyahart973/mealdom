/**
 * Appel du modele Claude (API Messages d'Anthropic) depuis le telephone.
 * L'application n'a pas de serveur ni d'etape de compilation : l'appel se fait en
 * HTTP direct avec la cle API du client, conservee uniquement sur cet appareil
 * (jamais exportee). Sans cle ou sans Internet, l'assistant utilise le moteur local.
 */
import { SYSTEM_PROMPT, TOOL_DEFINITIONS } from '../domain/assistant/tools.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
// Repli automatique vers un autre modele si une reponse est refusee par les filtres de securite.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * @typedef {{ type: string, [key: string]: unknown }} ContentBlock
 * @typedef {{ role: 'user' | 'assistant', content: string | ContentBlock[] }} ApiMessage
 * @typedef {{ content: ContentBlock[], stop_reason: string | null, stop_details?: { category?: string | null } | null }} ApiResponse
 */

/** Erreur d'appel, avec un message pour le client. */
export class LlmError extends Error {
  /**
   * @param {'no_key' | 'offline' | 'auth' | 'rate_limit' | 'overloaded' | 'bad_request' | 'refusal' | 'unknown'} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Envoie une requete a l'API Messages et traduit les erreurs pour le client.
 * @param {string} apiKey
 * @param {Record<string, unknown>} body
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<ApiResponse>}
 */
async function post(apiKey, body, signal) {
  if (!apiKey) throw new LlmError('no_key', 'Aucune clé API n’est enregistrée.');
  if (!navigator.onLine) throw new LlmError('offline', 'Pas de connexion Internet.');
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-beta': FALLBACK_BETA,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ ...body, fallbacks: 'default' }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new LlmError('offline', 'Le service IA ne répond pas (connexion ?).');
  }
  if (!response.ok) {
    let detail = '';
    try {
      const data = /** @type {{ error?: { message?: string } }} */ (await response.json());
      detail = data.error?.message ?? '';
    } catch {
      // corps illisible : on garde le code HTTP
    }
    if (response.status === 401 || response.status === 403) throw new LlmError('auth', 'La clé API est refusée. Vérifiez-la dans Paramètres.');
    if (response.status === 429) throw new LlmError('rate_limit', 'Trop de demandes au service IA. Réessayez dans un moment.');
    if (response.status >= 500) throw new LlmError('overloaded', 'Le service IA est momentanément indisponible.');
    throw new LlmError('bad_request', `Demande refusée par le service IA (${response.status}) ${detail}`.trim());
  }
  const data = /** @type {ApiResponse} */ (await response.json());
  if (data.stop_reason === 'refusal') throw new LlmError('refusal', 'Le service IA n’a pas pu traiter cette demande.');
  return data;
}

/**
 * Un tour de conversation de l'assistant. Le prompt systeme et les outils sont fixes : ils sont mis en cache.
 * @param {{ apiKey: string, model: string, messages: ApiMessage[], signal?: AbortSignal }} params
 * @returns {Promise<ApiResponse>}
 */
export function callClaude({ apiKey, model, messages, signal }) {
  return post(
    apiKey,
    {
      model,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOL_DEFINITIONS,
      tool_choice: { type: 'auto' },
      output_config: { effort: 'medium' },
      messages,
    },
    signal,
  );
}

/**
 * Lecture d'une image avec une reponse JSON conforme au schema (sortie structuree).
 * @param {{ apiKey: string, model: string, system: string, schema: Record<string, unknown>, imageBase64: string, mediaType: string, instruction: string, signal?: AbortSignal }} params
 * @returns {Promise<unknown>}
 */
export async function readImage({ apiKey, model, system, schema, imageBase64, mediaType, instruction, signal }) {
  const data = await post(
    apiKey,
    {
      model,
      max_tokens: 4000,
      system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: instruction },
          ],
        },
      ],
    },
    signal,
  );
  if (data.stop_reason === 'max_tokens') throw new LlmError('unknown', 'La lecture de la photo a été interrompue. Réessayez.');
  try {
    return JSON.parse(responseText(data.content));
  } catch {
    throw new LlmError('unknown', 'La réponse du service IA est illisible. Réessayez.');
  }
}

/**
 * Texte de la reponse (blocs « text » uniquement).
 * @param {ContentBlock[]} content
 * @returns {string}
 */
export function responseText(content) {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => String(b.text ?? ''))
    .join('\n')
    .trim();
}
