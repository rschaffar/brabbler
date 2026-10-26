// Literal original e2e/extension-dialog.mjs:29-38 tuple, not a copied state machine.
import assert from 'node:assert/strict';
import { click, input, key, choose, textButton } from './cards-git.fixture.mjs';
export { click, input, key, choose, textButton };
export const batchRequest = (id = 'batch-original') => ({
  type: 'extension_ui_request', id, method: 'ask_user_batch', title: 'E2E question set', context: 'Related decisions', questions: [
    { id: 'scope', shortLabel: 'Scope', question: 'Choose scope', context: 'Scope background', type: 'single', required: true, options: [
      { id: 'small', title: 'Small', description: 'Start small', recommended: true }, { id: 'large', title: 'Large' },
    ] },
    { id: 'platforms', shortLabel: 'Platforms', question: 'Choose platforms', type: 'multiple', required: true, options: [
      { id: 'desktop', title: 'Desktop' }, { id: 'mobile', title: 'Mobile' }, { id: 'none', title: 'None', exclusive: true },
    ] },
    { id: 'notes', shortLabel: 'Notes', question: 'Any constraints?', type: 'text', required: false, options: [] },
  ],
});
export const originalAnswers = [
  { id: 'scope', kind: 'freeform', text: 'A tailored release', comment: 'And keep it reversible' },
  { id: 'platforms', kind: 'selection', selections: ['desktop', 'mobile'], comment: 'Test both sizes' },
  { id: 'notes', kind: 'skipped' },
];
export const footer = (v, label) => textButton(v.container.querySelector('footer'), label);
export const field = (v, label) => {
  const roots = [...v.container.querySelectorAll('[data-question-set]')];
  assert.equal(roots.length, 1, 'field lookup requires exactly one current question set');
  const [root] = roots;
  assert.equal(root.isConnected, true, 'question set must remain mounted');
  const matches = [...root.querySelectorAll('textarea')].filter(node => {
    if (node.closest('[hidden]')) return false;
    const labels = [...node.labels];
    if (labels.length !== 1) return false;
    const [caption] = labels;
    // Actual production labels contain literal caption text and this textarea.
    // label.textContent also includes React's textarea default-value text after
    // typing/restoration; that value is not part of the field's visible caption.
    if (caption.control !== node || caption.children.length !== 1 || caption.firstElementChild !== node) return false;
    const captionText = [...caption.childNodes].filter(child => child.nodeType === v.window.Node.TEXT_NODE)
      .map(child => child.textContent).join('').trim();
    return captionText === label;
  });
  assert.equal(matches.length, 1, `expected exactly one current field: ${label}`);
  const [node] = matches;
  return node;
};
export const details = v => field(v, 'Additional details (optional)');
export const main = v => field(v, 'Type your answer…');
export const choice = (v, title) => {
  const label = [...v.container.querySelectorAll('label')].find(node =>
    node.querySelector('strong')?.firstChild?.textContent === title || node.textContent.trim() === title);
  const node = label?.querySelector('input'); assert.ok(node, `missing choice: ${title}`); return node;
};
export const checked = v => [...v.container.querySelectorAll('input:checked')].map(node => node.closest('label').querySelector('strong')?.firstChild?.textContent ?? node.closest('label').textContent.trim());
export async function go(v, index, branch = 'desktop') {
  if (branch === 'mobile') await choose(v, v.container.querySelector('select'), String(index));
  else {
    const nav = v.container.querySelector('nav');
    const node = index === 3 ? textButton(nav, 'Review answers')
      : [...nav.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.startsWith(['Scope:', 'Platforms:', 'Notes:'][index]));
    await click(v, node);
  }
  assert.equal(v.window.document.activeElement === v.container.querySelector('h3'), true, 'actual page effect focuses heading');
}
export async function originalMixedDraft(v) {
  for (const section of v.container.querySelectorAll('details')) {
    assert.equal(section.open, true);
    await click(v, section.querySelector('summary')); assert.equal(section.open, false);
    await click(v, section.querySelector('summary')); assert.equal(section.open, true);
  }
  assert.match(v.container.textContent, /Related decisions/); assert.match(v.container.textContent, /Scope background/);
  assert.deepEqual(checked(v), [], 'recommend-notdefault');
  await click(v, choice(v, 'Small')); await input(v, details(v), 'Keep the first release small');
  await click(v, footer(v, 'Next'));
  for (const title of ['Desktop', 'Mobile', 'None']) await click(v, choice(v, title));
  assert.deepEqual(checked(v), ['None'], 'exclusiveNone removes both nonexclusive selections');
  await click(v, choice(v, 'None')); assert.deepEqual(checked(v), []);
  await click(v, choice(v, 'None')); await click(v, choice(v, 'Desktop'));
  assert.deepEqual(checked(v), ['Desktop'], 'nonexclusive selection removes None');
  await click(v, choice(v, 'Mobile')); await input(v, details(v), 'Test both sizes');
  await click(v, footer(v, 'Next'));
  await input(v, main(v), 'A temporary constraint'); await input(v, details(v), 'Separate text details');
  await click(v, choice(v, 'Skip this question'));
  await click(v, footer(v, 'Back'));
  assert.deepEqual(checked(v), ['Desktop', 'Mobile']); assert.equal(details(v).value, 'Test both sizes');
  await click(v, footer(v, 'Back'));
  await click(v, choice(v, 'Write an alternative answer')); await input(v, main(v), 'A tailored release');
  assert.equal(details(v).value, 'Keep the first release small');
  await input(v, details(v), 'And keep it reversible');
  await key(v, main(v), 'Enter', { ctrlKey: true }); await key(v, main(v), 'Escape');
  main(v).focus(); const original = main(v);
  await click(v, v.container.querySelector('[aria-label="Collapse"]'));
  assert.equal(v.window.document.activeElement === v.container.querySelector('.blocking-card-collapsed'), true);
  await click(v, v.container.querySelector('.blocking-card-collapsed'));
  assert.equal(main(v) === original, true); assert.equal(main(v).value, 'A tailored release');
  assert.equal(v.window.document.activeElement === original, true);
}
export async function originalReview(v, branch = 'desktop') {
  // Remount/reload starts at Scope, not at the old page index.
  assert.equal(main(v).value, 'A tailored release'); assert.equal(details(v).value, 'And keep it reversible');
  await go(v, 3, branch);
  for (const text of ['A tailored release', 'And keep it reversible', 'Desktop, Mobile', 'Test both sizes', 'Skipped']) assert.ok(v.container.textContent.includes(text), text);
  assert.equal(v.container.textContent.includes('A temporary constraint'), false, 'skipped inactive text is not a submitted answer');
  await click(v, v.container.querySelector('[aria-label="Edit Notes"]'));
  assert.equal(main(v).value, 'A temporary constraint'); assert.equal(details(v).value, 'Separate text details');
  assert.equal(choice(v, 'Skip this question').checked, true);
  await click(v, footer(v, 'Review answers'));
}
