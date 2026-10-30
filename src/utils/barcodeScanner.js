/**
 * Lecture d'un code-barres avec la camera (ou une photo). Le lecteur integre du
 * navigateur est utilise quand il existe (Android) ; sinon le lecteur ZXing fourni
 * avec l'application (iPhone), qui fonctionne aussi sans Internet.
 */
import { isValidBarcode } from '../domain/stores/barcode.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/** @typedef {{ detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> }} Detector */

/** @type {Promise<Detector> | null} */
let detectorPromise = null;

/** @returns {Promise<Detector>} */
function getDetector() {
  detectorPromise ??= (async () => {
    const Native = /** @type {any} */ (globalThis).BarcodeDetector;
    if (Native) {
      try {
        const supported = /** @type {string[]} */ (await Native.getSupportedFormats());
        if (FORMATS.some((f) => supported.includes(f))) return new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
      } catch {
        // lecteur integre inutilisable : on passe au lecteur fourni
      }
    }
    const mod = await import('../vendor/barcode-detector.js');
    mod.prepareZXingModule({
      overrides: {
        locateFile: (/** @type {string} */ path, /** @type {string} */ prefix) => (path.endsWith('.wasm') ? new URL('../vendor/zxing_reader.wasm', import.meta.url).href : prefix + path),
      },
    });
    return new mod.BarcodeDetector({ formats: FORMATS });
  })();
  return detectorPromise;
}

/**
 * Premier code valide trouve dans une image.
 * @param {ImageBitmapSource} source
 * @returns {Promise<string | null>}
 */
async function firstCode(source) {
  const detector = await getDetector();
  const found = await detector.detect(source);
  return found.map((b) => b.rawValue.replace(/\D/g, '')).find(isValidBarcode) ?? null;
}

/**
 * Code-barres lu sur une photo.
 * @param {File} file
 * @returns {Promise<string | null>}
 */
export async function readBarcodeFromPhoto(file) {
  const bitmap = await createImageBitmap(file);
  try {
    return await firstCode(bitmap);
  } finally {
    bitmap.close();
  }
}

/** @returns {boolean} */
export function canUseCamera() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Lance la camera arriere et cherche un code-barres jusqu'a en trouver un.
 * @param {HTMLVideoElement} video
 * @param {(code: string) => void} onCode
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startScanner(video, onCode) {
  const detector = getDetector();
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  await detector;
  let running = true;
  const stop = () => {
    running = false;
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  const tick = async () => {
    if (!running) return;
    try {
      if (video.readyState >= 2) {
        const code = await firstCode(video);
        if (code && running) {
          stop();
          onCode(code);
          return;
        }
      }
    } catch {
      // image illisible : on reessaie
    }
    if (running) setTimeout(tick, 200);
  };
  tick();
  return { stop };
}
