import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/assistant/conversation.js').Conversation} Conversation */
/** @typedef {import('../../domain/assistant/conversation.js').HistoryEntry} HistoryEntry */
/** @typedef {import('../../domain/assistant/preferences.js').Preference} Preference */

export const conversationStore = objectStore('conversations');
export const historyStore = objectStore('changeHistory');
export const preferenceStore = objectStore('preferences');

/** @returns {Promise<Conversation[]>} */
export const getConversations = () => conversationStore.getAll();

/** @returns {Promise<HistoryEntry[]>} */
export const getHistory = () => historyStore.getAll();

/** @returns {Promise<Preference[]>} */
export const getPreferences = () => preferenceStore.getAll();
