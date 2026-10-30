import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/stores/barcode.js').BarcodeLink} BarcodeLink */

/** Codes-barres deja reconnus : code -> ingredient, contenance, libelle. */
export const barcodeStore = objectStore('barcodes');

/** @returns {Promise<BarcodeLink[]>} */
export const getBarcodes = () => barcodeStore.getAll();
