import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';

// Dormancy ordering/frontmatter switches are obsolete. Retained disabled rows,
// authored manual-only metadata and parent gates now belong to the actual mount
// in SkillsConfig.behavior.test.mjs. This owner retains initial SSR honesty.
const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
const { SkillsConfig } = await jiti.import('./SkillsConfig.tsx');
const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
test('resource SSR never fabricates saved/applied inventory or a live Apply action', () => {
  const html = renderToStaticMarkup(h(I18nProvider, null, h(SkillsConfig, { embedded: true, cwd: null, sessionId: null, onClose() {} })));
  assert.match(html, /config-sidebar-list/);
  assert.match(html, /Search resources/);
  assert.match(html, /New runtimes use saved choices/);
  assert.doesNotMatch(html, /Included in next-turn selection|Apply saved changes|role="switch"/);
});
