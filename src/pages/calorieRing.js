import { formatNumber } from '../utils/format.js';

/**
 * Anneau des calories du jour : la part remplie = calories prevues / objectif (bornee a 100 %).
 * Au-dela de l'objectif, l'anneau est plein et le texte le dit.
 * @param {number} planned
 * @param {number} target
 * @param {number} [size]
 * @returns {string}
 */
export function calorieRingSvg(planned, target, size = 112) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const share = target > 0 ? Math.min(1, planned / target) : 0;
  const over = planned > target;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 104 104" role="img"
      aria-label="${formatNumber(planned)} kcal prévues sur un objectif de ${formatNumber(target)} kcal${over ? ', objectif dépassé' : ''}">
    <circle class="ring__track" cx="52" cy="52" r="${r}" fill="none" stroke-width="11" />
    <circle class="ring__value${over ? ' ring__value--over' : ''}" cx="52" cy="52" r="${r}" fill="none" stroke-width="11" stroke-linecap="round"
      stroke-dasharray="${(share * circumference).toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 52 52)" />
    <text class="ring__number" x="52" y="50" text-anchor="middle">${formatNumber(planned)}</text>
    <text class="ring__unit" x="52" y="67" text-anchor="middle">/ ${formatNumber(target)} kcal</text>
  </svg>`;
}
