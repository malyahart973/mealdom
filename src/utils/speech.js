/**
 * Dictee vocale avec la reconnaissance de la parole du navigateur (Chrome, Edge, Safari).
 * Le son est traite par le service du telephone ou du navigateur (Google ou Apple), pas par MealDom.
 */

/**
 * @typedef {Object} SpeechHandle
 * @property {() => void} stop
 */

/**
 * @typedef {{ resultIndex: number, results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }} RecognitionResultEvent
 * @typedef {{ lang: string, interimResults: boolean, continuous: boolean, maxAlternatives: number,
 *   onresult: ((e: RecognitionResultEvent) => void) | null, onerror: ((e: { error: string }) => void) | null,
 *   onend: (() => void) | null, start: () => void, stop: () => void }} Recognition
 */

/** @returns {(new () => Recognition) | null} */
function recognitionClass() {
  const w = /** @type {{ SpeechRecognition?: new () => Recognition, webkitSpeechRecognition?: new () => Recognition }} */ (/** @type {unknown} */ (window));
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** @returns {boolean} */
export function isSpeechAvailable() {
  return recognitionClass() !== null;
}

/** @type {Record<string, string>} */
const ERRORS = {
  'not-allowed': 'Le micro est bloqué : autorisez-le pour MealDom dans les réglages du navigateur.',
  'service-not-allowed': 'La dictée n’est pas autorisée sur cet appareil.',
  'no-speech': 'Je n’ai rien entendu. Touchez le micro et parlez.',
  'audio-capture': 'Aucun micro n’est disponible.',
  network: 'La dictée demande une connexion Internet.',
};

/**
 * Lance la dictee en francais. Le texte reconnu arrive au fur et a mesure (provisoire puis definitif).
 * @param {{ onText: (text: string, final: boolean) => void, onEnd: (error: string | null) => void }} handlers
 * @returns {SpeechHandle | null}  null si la dictee n'est pas disponible
 */
export function startDictation(handlers) {
  const Recognition = recognitionClass();
  if (!Recognition) return null;
  const rec = new Recognition();
  rec.lang = 'fr-FR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  /** @type {string | null} */
  let error = null;
  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    handlers.onText((finalText + interim).trim(), interim === '');
  };
  rec.onerror = (event) => {
    if (event.error !== 'aborted') error = ERRORS[event.error] ?? 'La dictée s’est interrompue.';
  };
  rec.onend = () => handlers.onEnd(error);
  rec.start();
  return { stop: () => rec.stop() };
}
