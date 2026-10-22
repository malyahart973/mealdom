/**
 * Courbe de poids en SVG : pesees (points), moyenne sur 7 jours (ligne), objectif (repere).
 * Une seule couleur de serie : points et ligne se distinguent par leur forme (legende).
 */
import { parseIsoDate } from '../domain/planning/dates.js';
import { formatNumber, formatIsoDayMonth } from '../utils/format.js';

/** @typedef {{ date: string, kg: number }} Point */

const HEIGHT = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {string} iso */
const dayOf = (iso) => (parseIsoDate(iso)?.getTime() ?? 0) / DAY_MS;

/**
 * Graduations "rondes" du poids (pas de 0,5, 1, 2 ou 5 kg).
 * @param {number} min
 * @param {number} max
 * @returns {number[]}
 */
function ticks(min, max) {
  const span = max - min;
  const step = [0.5, 1, 2, 5, 10].find((s) => span / s <= 5) ?? 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 10) / 10);
  return out;
}

/**
 * Dessine la courbe dans le conteneur, a sa largeur, avec l'info-bulle (survol et clavier).
 * @param {HTMLElement} container
 * @param {Point[]} entries   Pesees, de la plus ancienne a la plus recente
 * @param {Point[]} trend     Moyenne glissante, memes dates
 * @param {number | null} goalKg
 */
export function drawWeightChart(container, entries, trend, goalKg) {
  const width = Math.max(280, container.clientWidth || 320);
  const x0 = dayOf(entries[0].date);
  const x1 = Math.max(dayOf(entries[entries.length - 1].date), x0 + 7);
  const values = [...entries.map((e) => e.kg), ...trend.map((t) => t.kg), ...(goalKg ? [goalKg] : [])];
  const lo = Math.floor((Math.min(...values) - 0.5) * 2) / 2;
  const hi = Math.ceil((Math.max(...values) + 0.5) * 2) / 2;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  /** @param {string} iso */
  const sx = (iso) => PAD.left + ((dayOf(iso) - x0) / (x1 - x0)) * plotW;
  /** @param {number} kg */
  const sy = (kg) => PAD.top + ((hi - kg) / (hi - lo)) * plotH;

  const yTicks = ticks(lo, hi);
  const xLabels = [entries[0], entries[entries.length - 1]];
  if (entries.length > 4) xLabels.splice(1, 0, entries[Math.floor(entries.length / 2)]);
  const linePath = trend.map((t, i) => `${i ? 'L' : 'M'}${sx(t.date).toFixed(1)},${sy(t.kg).toFixed(1)}`).join('');

  container.innerHTML = `
    <div class="chart__legend" aria-hidden="true">
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" class="chart__dot" /></svg> Pesée</span>
      <span><svg width="18" height="12"><line x1="1" y1="6" x2="17" y2="6" class="chart__line" /></svg> Moyenne sur 7 jours</span>
      ${goalKg ? '<span><svg width="18" height="12"><line x1="1" y1="6" x2="17" y2="6" class="chart__goal" /></svg> Objectif</span>' : ''}
    </div>
    <div class="chart__plot">
      <svg width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" role="img" tabindex="0"
        aria-label="Courbe de poids : ${entries.length} pesées, de ${formatNumber(entries[0].kg)} kg à ${formatNumber(entries[entries.length - 1].kg)} kg. Utilisez les flèches pour parcourir les pesées.">
        ${yTicks
          .map(
            (v) => `<line class="chart__grid" x1="${PAD.left}" x2="${width - PAD.right}" y1="${sy(v)}" y2="${sy(v)}" />
              <text class="chart__tick" x="${PAD.left - 6}" y="${sy(v) + 4}" text-anchor="end">${formatNumber(v)}</text>`,
          )
          .join('')}
        ${xLabels
          .map((e, i) => `<text class="chart__tick" x="${sx(e.date)}" y="${HEIGHT - 8}" text-anchor="${i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}">${formatIsoDayMonth(e.date)}</text>`)
          .join('')}
        ${
          goalKg
            ? `<line class="chart__goal" x1="${PAD.left}" x2="${width - PAD.right}" y1="${sy(goalKg)}" y2="${sy(goalKg)}" />
               <text class="chart__tick" x="${width - PAD.right}" y="${sy(goalKg) - 6}" text-anchor="end">Objectif ${formatNumber(goalKg)} kg</text>`
            : ''
        }
        <path class="chart__line" d="${linePath}" fill="none" />
        ${entries.map((e) => `<circle class="chart__dot" cx="${sx(e.date).toFixed(1)}" cy="${sy(e.kg).toFixed(1)}" r="4" />`).join('')}
        <line class="chart__cross" x1="0" x2="0" y1="${PAD.top}" y2="${HEIGHT - PAD.bottom}" visibility="hidden" />
        <circle class="chart__focus" r="6" visibility="hidden" />
      </svg>
      <div class="chart__tip" hidden><strong></strong><span></span><span></span></div>
    </div>`;

  const svg = /** @type {SVGSVGElement} */ (container.querySelector('.chart__plot svg'));
  const cross = /** @type {SVGLineElement} */ (container.querySelector('.chart__cross'));
  const focus = /** @type {SVGCircleElement} */ (container.querySelector('.chart__focus'));
  const tip = /** @type {HTMLElement} */ (container.querySelector('.chart__tip'));
  const [tipValue, tipDate, tipTrend] = /** @type {HTMLElement[]} */ ([...tip.children]);
  const xs = entries.map((e) => sx(e.date));
  let current = entries.length - 1;

  /** @param {number} i */
  const show = (i) => {
    current = i;
    const e = entries[i];
    const x = xs[i];
    const y = sy(e.kg);
    cross.setAttribute('x1', String(x));
    cross.setAttribute('x2', String(x));
    cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', String(x));
    focus.setAttribute('cy', String(y));
    focus.setAttribute('visibility', 'visible');
    tipValue.textContent = `${formatNumber(e.kg)} kg`;
    tipDate.textContent = formatIsoDayMonth(e.date);
    tipTrend.textContent = `Moyenne 7 j : ${formatNumber(trend[i].kg)} kg`;
    tip.hidden = false;
    const left = Math.min(Math.max(x - tip.offsetWidth / 2, 0), width - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, y - tip.offsetHeight - 12)}px`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    focus.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };

  svg.addEventListener('pointermove', (event) => {
    const box = svg.getBoundingClientRect();
    const px = event.clientX - box.left;
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
      show(Math.min(entries.length - 1, Math.max(0, current + (event.key === 'ArrowLeft' ? -1 : 1))));
    }
  });
}
