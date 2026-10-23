/**
 * Courbe des prix d'un produit, une ligne en escalier par magasin (un prix releve vaut
 * jusqu'au releve suivant). Trois magasins au plus, couleurs fixes ; le tableau des
 * releves sous la courbe donne toutes les valeurs.
 */
import { parseIsoDate } from '../domain/planning/dates.js';
import { formatIsoDayMonth } from '../utils/format.js';
import { formatCents } from '../domain/budget/money.js';

/** @typedef {{ date: string, unitCents: number }} Point */

const HEIGHT = 220;
const PAD = { top: 14, right: 16, bottom: 28, left: 56 };
const DAY = 86400000;
/** Nombre de couleurs de serie disponibles (au-dela : seulement dans le tableau). */
export const MAX_SERIES = 3;

/** @param {string} iso */
const dayOf = (iso) => (parseIsoDate(iso)?.getTime() ?? 0) / DAY;

/**
 * Prix connu a une date : le dernier releve fait ce jour-la ou avant.
 * @param {Point[]} serie
 * @param {string} date
 * @returns {number | null}
 */
function valueAt(serie, date) {
  let value = null;
  for (const p of serie) if (p.date <= date) value = p.unitCents;
  return value;
}

/**
 * @param {HTMLElement} container
 * @param {{ name: string, points: Point[] }[]} series   Trois au plus, dans un ordre fixe
 * @param {string} perLabel   ex. « le kilo »
 */
export function drawPriceChart(container, series, perLabel) {
  const width = Math.max(280, container.clientWidth || 320);
  const all = series.flatMap((s) => s.points);
  const dates = [...new Set(all.map((p) => p.date))].sort();
  const x0 = dayOf(dates[0]);
  const x1 = Math.max(dayOf(dates[dates.length - 1]), x0 + 7);
  const values = all.map((p) => p.unitCents);
  const span = Math.max(...values) - Math.min(...values);
  const lo = Math.max(0, Math.min(...values) - Math.max(span * 0.15, 10));
  const hi = Math.max(...values) + Math.max(span * 0.15, 10);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  /** @param {string} iso */
  const sx = (iso) => PAD.left + ((dayOf(iso) - x0) / (x1 - x0)) * plotW;
  /** @param {number} v */
  const sy = (v) => PAD.top + ((hi - v) / (hi - lo)) * plotH;
  const end = dates[dates.length - 1];
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));
  /** @param {Point[]} pts */
  const stepPath = (pts) => {
    let d = '';
    pts.forEach((p, i) => {
      const x = sx(p.date).toFixed(1);
      const y = sy(p.unitCents).toFixed(1);
      d += i === 0 ? `M${x},${y}` : `H${x}V${y}`;
    });
    return `${d}H${sx(end).toFixed(1)}`;
  };

  container.innerHTML = `
    <div class="chart__legend">
      ${series.map((s, i) => `<span><svg width="18" height="12" aria-hidden="true"><line x1="1" y1="6" x2="17" y2="6" class="series-${i + 1}" stroke-width="2" /></svg> ${s.name.replace(/</g, '&lt;')}</span>`).join('')}
    </div>
    <div class="chart__plot">
      <svg width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" role="img" tabindex="0" aria-label="Évolution du prix ${perLabel} : utilisez les flèches pour parcourir les relevés.">
        ${ticks
          .map((v) => `<line class="chart__grid" x1="${PAD.left}" x2="${width - PAD.right}" y1="${sy(v)}" y2="${sy(v)}" />
            <text class="chart__tick" x="${PAD.left - 6}" y="${sy(v) + 4}" text-anchor="end">${formatCents(v)}</text>`)
          .join('')}
        <text class="chart__tick" x="${PAD.left}" y="${HEIGHT - 8}" text-anchor="start">${formatIsoDayMonth(dates[0])}</text>
        <text class="chart__tick" x="${width - PAD.right}" y="${HEIGHT - 8}" text-anchor="end">${formatIsoDayMonth(end)}</text>
        ${series.map((s, i) => `<path class="series-${i + 1}" d="${stepPath(s.points)}" fill="none" stroke-width="2" stroke-linejoin="round" />`).join('')}
        ${series.map((s, i) => s.points.map((p) => `<circle class="series-${i + 1} chart__mark" cx="${sx(p.date).toFixed(1)}" cy="${sy(p.unitCents).toFixed(1)}" r="4" />`).join('')).join('')}
        <line class="chart__cross" x1="0" x2="0" y1="${PAD.top}" y2="${HEIGHT - PAD.bottom}" visibility="hidden" />
      </svg>
      <div class="chart__tip" hidden></div>
    </div>`;

  const svg = /** @type {SVGSVGElement} */ (container.querySelector('.chart__plot svg'));
  const cross = /** @type {SVGLineElement} */ (container.querySelector('.chart__cross'));
  const tip = /** @type {HTMLElement} */ (container.querySelector('.chart__tip'));
  const xs = dates.map(sx);
  let current = dates.length - 1;

  /** @param {number} i */
  const show = (i) => {
    current = i;
    const date = dates[i];
    cross.setAttribute('x1', String(xs[i]));
    cross.setAttribute('x2', String(xs[i]));
    cross.setAttribute('visibility', 'visible');
    tip.replaceChildren();
    const title = document.createElement('span');
    title.textContent = formatIsoDayMonth(date);
    tip.append(title);
    series.forEach((s, k) => {
      const v = valueAt(s.points, date);
      if (v === null) return;
      const row = document.createElement('span');
      row.className = 'chart__tip-row';
      const key = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      key.setAttribute('width', '14');
      key.setAttribute('height', '10');
      key.innerHTML = `<line x1="1" y1="5" x2="13" y2="5" class="series-${k + 1}" stroke-width="2" />`;
      const value = document.createElement('strong');
      value.textContent = formatCents(v);
      const label = document.createElement('span');
      label.textContent = s.name;
      row.append(key, value, label);
      tip.append(row);
    });
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(xs[i] - tip.offsetWidth / 2, 0), width - tip.offsetWidth)}px`;
    tip.style.top = '0px';
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  svg.addEventListener('pointermove', (event) => {
    const px = event.clientX - svg.getBoundingClientRect().left;
    let best = 0;
    xs.forEach((x, i) => {
      if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i;
    });
    show(best);
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(current));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      show(Math.min(dates.length - 1, Math.max(0, current + (event.key === 'ArrowLeft' ? -1 : 1))));
    }
  });
}
