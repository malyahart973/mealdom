import { objectStore } from './storeHelpers.js';

/** @typedef {import('../../domain/drive/drive.js').DriveProduct} DriveProduct */
/** @typedef {import('../../domain/drive/drive.js').DriveOrder} DriveOrder */

/** Un produit est identifie par son magasin et sa reference. @typedef {DriveProduct & { key: string }} StoredDriveProduct */

export const driveProductStore = objectStore('driveProducts');
export const driveOrderStore = objectStore('driveOrders');

/** @returns {Promise<StoredDriveProduct[]>} */
export const getDriveProducts = () => driveProductStore.getAll();

/** @returns {Promise<DriveOrder[]>} */
export const getDriveOrders = () => driveOrderStore.getAll();

/**
 * @param {DriveProduct} p
 * @returns {string}
 */
export function driveProductKey(p) {
  return `${p.storeId}|${p.id}`;
}
