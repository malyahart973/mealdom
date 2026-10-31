/**
 * Mode cuisine : minuteurs (qui continuent quand on change d'etape ou d'ecran) et ecran
 * toujours allume pendant qu'on cuisine.
 * Les minuteurs reposent sur l'heure de fin : ils restent justes meme si le telephone
 * met la page en veille ; la sonnerie retentit au retour sur la page si elle etait en veille.
 */

/**
 * @typedef {Object} Timer
 * @property {string} id
 * @property {string} label
 * @property {number} endsAt          Horodatage de fin (ms) quand il tourne
 * @property {number | null} pausedLeft   Millisecondes restantes quand il est en pause
 * @property {boolean} done
 */

/** @type {Timer[]} */
let timers = [];
/** @type {Set<() => void>} */
const listeners = new Set();
/** @type {ReturnType<typeof setInterval> | null} */
let ticker = null;
/** @type {AudioContext | null} */
let audio = null;
let counter = 0;

/** @returns {Timer[]} */
export function getTimers() {
  return timers;
}

/**
 * Millisecondes restantes.
 * @param {Timer} t
 * @param {number} [now]
 * @returns {number}
 */
export function remaining(t, now = Date.now()) {
  if (t.done) return 0;
  return t.pausedLeft ?? Math.max(0, t.endsAt - now);
}

/**
 * Prevenu a chaque seconde et a chaque changement. Renvoie de quoi se desabonner.
 * @param {() => void} listener
 * @returns {() => void}
 */
export function onTimersChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const l of listeners) l();
}

function tick() {
  const now = Date.now();
  let rang = false;
  for (const t of timers) {
    if (!t.done && t.pausedLeft === null && t.endsAt <= now) {
      t.done = true;
      rang = true;
    }
  }
  if (rang) ring();
  if (!timers.some((t) => !t.done && t.pausedLeft === null) && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  notify();
}

function ensureTicker() {
  ticker ??= setInterval(tick, 1000);
}

/**
 * Le son doit etre autorise par un geste : on prepare l'audio au premier minuteur lance.
 */
function unlockAudio() {
  try {
    const Ctx = window.AudioContext ?? /** @type {typeof AudioContext | undefined} */ (/** @type {any} */ (window).webkitAudioContext);
    if (Ctx) audio ??= new Ctx();
    if (audio?.state === 'suspended') audio.resume();
  } catch {
    audio = null;
  }
}

/** Trois bips et une vibration. */
function ring() {
  try {
    navigator.vibrate?.([400, 200, 400, 200, 400]);
  } catch {
    // vibration indisponible
  }
  if (!audio) return;
  for (let i = 0; i < 3; i += 1) {
    const start = audio.currentTime + i * 0.6;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.45);
  }
}

/**
 * @param {string} label
 * @param {number} seconds
 * @returns {Timer}
 */
export function startTimer(label, seconds) {
  unlockAudio();
  counter += 1;
  const t = { id: `t${counter}`, label, endsAt: Date.now() + seconds * 1000, pausedLeft: null, done: false };
  timers = [...timers, t];
  ensureTicker();
  notify();
  return t;
}

/**
 * @param {string} id
 */
export function togglePause(id) {
  const t = timers.find((x) => x.id === id);
  if (!t || t.done) return;
  if (t.pausedLeft === null) t.pausedLeft = Math.max(0, t.endsAt - Date.now());
  else {
    t.endsAt = Date.now() + t.pausedLeft;
    t.pausedLeft = null;
    ensureTicker();
  }
  notify();
}

/**
 * Ajoute du temps (un minuteur termine repart).
 * @param {string} id
 * @param {number} seconds
 */
export function addTime(id, seconds) {
  const t = timers.find((x) => x.id === id);
  if (!t) return;
  if (t.done) {
    t.done = false;
    t.pausedLeft = null;
    t.endsAt = Date.now() + seconds * 1000;
  } else if (t.pausedLeft !== null) t.pausedLeft += seconds * 1000;
  else t.endsAt += seconds * 1000;
  ensureTicker();
  notify();
}

/**
 * @param {string} id
 */
export function removeTimer(id) {
  timers = timers.filter((t) => t.id !== id);
  notify();
}

// Au retour sur la page (telephone en veille), on rattrape les minuteurs termines.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tick();
});

// ---------------------------------------------------------------------------
// Ecran toujours allume
// ---------------------------------------------------------------------------

/** @type {WakeLockSentinel | null} */
let wakeLock = null;
let wanted = false;

/**
 * Garde l'ecran allume tant que le mode cuisine est ouvert.
 * @returns {Promise<boolean>}  false si le navigateur ne le permet pas
 */
export async function keepScreenOn() {
  wanted = true;
  if (!('wakeLock' in navigator)) return false;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    return true;
  } catch {
    return false;
  }
}

/** Rend la main au telephone (il peut de nouveau eteindre l'ecran). */
export async function releaseScreen() {
  wanted = false;
  try {
    await wakeLock?.release();
  } catch {
    // deja libere
  }
  wakeLock = null;
}

// Le verrou saute quand la page passe en arriere-plan : on le reprend au retour.
document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') keepScreenOn();
});
