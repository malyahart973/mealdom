import { escapeHtml } from './html.js';

/**
 * Cases a cocher.
 * @param {string} name
 * @param {{ id: string, label: string }[]} options
 * @param {string[]} checked
 * @returns {string}
 */
export function checkboxesHtml(name, options, checked) {
  return options
    .map(
      (o) => `<label class="check"><input type="checkbox" name="${name}" value="${escapeHtml(o.id)}"${
        checked.includes(o.id) ? ' checked' : ''
      } /> <span>${escapeHtml(o.label)}</span></label>`,
    )
    .join('');
}

/**
 * Valeurs cochees d'un groupe de cases.
 * @param {ParentNode} root
 * @param {string} name
 * @returns {string[]}
 */
export function checkedValues(root, name) {
  return [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => /** @type {HTMLInputElement} */ (i).value);
}
