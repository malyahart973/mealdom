import { escapeHtml } from '../utils/html.js';
import { formatNumber, formatIsoDay } from '../utils/format.js';
import { toIsoDate } from '../domain/planning/dates.js';
import { validateProgram } from '../domain/nutrition/program.js';
import { parseKg, sortEntries, smoothedTrend, weightProgress } from '../domain/nutrition/weight.js';
import { getProgram, getWeights, saveWeight, deleteWeight } from '../services/programService.js';
import { drawWeightChart } from './weightChart.js';

/** @typedef {import('../domain/nutrition/weight.js').WeightProgress} WeightProgress */

/**
 * Message selon la progression : on commente la tendance, jamais une pesee isolee.
 * @param {WeightProgress} p
 * @returns {string}
 */
function statusText(p) {
  const rate = p.rateKgPerWeek === null ? '' : formatNumber(Math.abs(p.rateKgPerWeek));
  switch (p.status) {
    case 'reached':
      return 'Objectif atteint, bravo ! Pour stabiliser, augmentez progressivement les portions (environ 100 kcal par jour chaque semaine) en continuant les pesées.';
    case 'too_fast':
      return `Vous perdez environ ${rate} kg par semaine : c’est plus rapide que conseillé. Mangez au moins l’objectif du jour, sans sauter de repas ; si cela continue, parlez-en à votre médecin.`;
    case 'gaining':
      return `Légère reprise ces dernières semaines (environ ${rate} kg par semaine). C’est fréquent (eau, sel, cycle) : revenez aux portions du programme et regardez la moyenne plutôt que chaque pesée.`;
    case 'stalled':
      return 'Plateau : le poids bouge peu depuis quelques semaines. Pesez quelques portions pour vérifier les quantités, et ajoutez 20 à 30 minutes de marche par jour.';
    case 'on_track':
      return `Vous êtes sur un bon rythme : environ ${rate} kg perdus par semaine.`;
    default:
      return 'Pesez-vous une ou deux fois par semaine, le matin à jeun, sur la même balance. Le rythme s’affiche après 3 pesées sur au moins 10 jours.';
  }
}

/**
 * Ecran Suivi du poids : pesees, courbe, progression vers l'objectif.
 * @param {HTMLElement} el
 */
export async function renderWeight(el) {
  const today = toIsoDate(new Date());
  const [program, entries] = await Promise.all([getProgram(), getWeights()]);
  const hasProgram = validateProgram(program, today).length === 0;
  const sorted = sortEntries(entries);
  const progress = hasProgram ? weightProgress(program, entries, today) : null;
  const latest = sorted.length ? sorted[sorted.length - 1] : null;

  el.innerHTML = `
    <section>
      <h1 class="page-title">Suivi du poids</h1>
      ${
        progress
          ? `<dl class="budget-card">
              <div><dt>Poids actuel</dt><dd>${escapeHtml(formatNumber(progress.currentKg))} kg</dd></div>
              <div><dt>Perdu depuis le début</dt><dd>${escapeHtml(formatNumber(Math.max(0, progress.lostKg)))} kg</dd></div>
              <div><dt>Reste à perdre</dt><dd>${escapeHtml(formatNumber(progress.remainingKg))} kg</dd></div>
            </dl>
            <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}" aria-label="Progression vers l’objectif">
              <span style="width:${progress.percent}%"></span></div>
            <p class="hint">${progress.percent} % du chemin entre ${escapeHtml(formatNumber(progress.startKg))} kg et ${escapeHtml(formatNumber(progress.goalKg))} kg.</p>
            <p class="status status--${progress.status}">${escapeHtml(statusText(progress))}</p>`
          : `<p>Notez vos pesées ici. Pour voir votre objectif et votre progression, <a href="#/programme">renseignez votre programme</a>.</p>`
      }

      <h2>Nouvelle pesée</h2>
      <div class="alert" role="alert" hidden></div>
      <form class="stock-form" data-form="weight" novalidate>
        <div class="field"><label for="w-kg">Poids (kg)</label><input id="w-kg" type="text" inputmode="decimal" autocomplete="off" placeholder="ex. ${latest ? escapeHtml(formatNumber(latest.kg)) : '71,4'}" /></div>
        <div class="field"><label for="w-date">Date</label><input id="w-date" type="date" value="${today}" max="${today}" /></div>
        <div class="field"><label for="w-note">Note (facultatif)</label><input id="w-note" type="text" maxlength="80" autocomplete="off" placeholder="ex. après le week-end" /></div>
        <div class="form-actions"><button type="submit" class="button">Enregistrer</button></div>
        <p class="hint">Une pesée par jour : une nouvelle pesée à la même date remplace la précédente.</p>
      </form>

      ${
        sorted.length >= 2
          ? `<h2>Courbe</h2><div class="chart" data-chart></div>
             <p class="hint">Le poids varie d’un jour à l’autre (eau, sel, repas) : la moyenne sur 7 jours montre la vraie tendance.</p>`
          : ''
      }

      ${
        sorted.length
          ? `<h2>Mes pesées</h2>
            <table class="table">
              <thead><tr><th scope="col">Date</th><th scope="col">Poids</th><th scope="col">Moyenne 7 j</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
              <tbody>${[...smoothedTrend(sorted)]
                .reverse()
                .map((t) => {
                  const e = /** @type {import('../domain/nutrition/weight.js').WeightEntry} */ (sorted.find((x) => x.date === t.date));
                  return `<tr><td>${escapeHtml(formatIsoDay(e.date))}${e.note ? `<br /><span class="hint">${escapeHtml(e.note)}</span>` : ''}</td>
                    <td>${escapeHtml(formatNumber(e.kg))} kg</td><td>${escapeHtml(formatNumber(t.kg))} kg</td>
                    <td><button type="button" class="icon-button" data-remove="${e.date}" aria-label="Supprimer la pesée du ${escapeHtml(formatIsoDay(e.date))}">×</button></td></tr>`;
                })
                .join('')}</tbody>
            </table>`
          : ''
      }
    </section>`;

  const chart = /** @type {HTMLElement | null} */ (el.querySelector('[data-chart]'));
  if (chart) {
    const trend = smoothedTrend(sorted);
    const draw = () => drawWeightChart(chart, sorted, trend, hasProgram ? program.goalWeightKg : null);
    draw();
    // Redessine a la nouvelle largeur (rotation du telephone) tant que l'ecran est affiche.
    let width = chart.clientWidth;
    const observer = new ResizeObserver(() => {
      if (!chart.isConnected) observer.disconnect();
      else if (Math.abs(chart.clientWidth - width) > 4) {
        width = chart.clientWidth;
        draw();
      }
    });
    observer.observe(chart);
  }

  el.querySelector('[data-form="weight"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    /** @param {string} id */
    const val = (id) => /** @type {HTMLInputElement} */ (el.querySelector(id)).value.trim();
    const errors = await saveWeight({ date: val('#w-date'), kg: parseKg(val('#w-kg')), note: val('#w-note') });
    if (errors.length) {
      const alert = /** @type {HTMLElement} */ (el.querySelector('.alert'));
      alert.hidden = false;
      alert.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
      return;
    }
    await renderWeight(el);
  });

  el.querySelector('table')?.addEventListener('click', async (event) => {
    const date = /** @type {HTMLElement} */ (event.target).getAttribute('data-remove');
    if (!date || !window.confirm('Supprimer cette pesée ?')) return;
    await deleteWeight(date);
    await renderWeight(el);
  });
}
