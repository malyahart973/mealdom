/**
 * Mini outil de tests, sans installation.
 * Fonctionne dans le navigateur (tests/index.html).
 */

/** @type {{ name: string, fn: () => void | Promise<void> }[]} */
const tests = [];

/**
 * Declare un test.
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
export function test(name, fn) {
  tests.push({ name, fn });
}

/**
 * Verifie que deux valeurs sont identiques (comparaison du contenu).
 * @param {unknown} actual
 * @param {unknown} expected
 */
export function assertEqual(actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Attendu ${e}, obtenu ${a}`);
}

/**
 * Lance tous les tests declares et renvoie les resultats.
 * @returns {Promise<{ name: string, ok: boolean, error?: string }[]>}
 */
export async function runTests() {
  const results = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
