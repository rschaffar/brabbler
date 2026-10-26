import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement, createRef } from 'react';
import { composerFixture, click } from './composer.fixture.mjs';

const session = { id: 'saved-identity-123456', cwd: '/project/worktree', projectRoot: '/project', name: 'Session title', firstMessage: 'fallback text', messageCount: 1 };
async function production(f) { return f.jiti.import('./toolbar.fixture.tsx'); }
const actions = root => [...root.querySelectorAll('[data-mobile-toolbar-action]')].map(node => node.dataset.mobileToolbarAction);
function inputs() {
  return { mobile: true, showChat: true, selectedSession: session, sessionStats: null, autoNameStatus: { kind: 'idle' },
    hasSubagentSessions: true, agentsButtonLabel: 'Agents', agentsBadge: { running: false, count: 2 }, activeTopPanel: null,
    sessionHasBranches: true, branchTree: [], branchActiveLeafId: null, topBarRef: createRef(), systemBtnRef: createRef(),
    setPluginSettingsSession() {}, setSettingsSection() {}, handleViewFullHistory() {}, handleAutoName() {}, toggleTopPanel() {}, handleBranchLeafChange() {}, handleSystemInfoToggle() {}, systemPrompt: null, systemTools: null };
}

test('actual session actions preserve order/eligibility and invoke current callbacks without toolbar theme/language controls', async t => {
  const f = composerFixture(t), p = await production(f), old = [], current = [];
  let props = { ...inputs(), toggleTopPanel: panel => old.push(panel), handleSystemInfoToggle: panel => old.push(panel), handleViewFullHistory: () => old.push('history'), handleAutoName: () => old.push('name') };
  const element = () => createElement(p.I18nProvider, null, createElement(p.ToolbarControls, props));
  const view = await f.mount(element());
  assert.deepEqual(actions(view.container), ['history', 'name', 'agents', 'branches', 'system', 'tools']);
  assert.equal(view.container.querySelectorAll('button').length, 7, 'policy plus exactly six session actions; no additional theme/language action');
  assert.equal(view.container.querySelectorAll('[data-mobile-toolbar-more], [data-mobile-toolbar-actions]').length, 0);
  for (const name of ['theme', 'language']) assert.equal(view.container.querySelector(`[data-mobile-toolbar-action="${name}"]`) === null, true);
  const nodes = [...view.container.querySelectorAll('[data-mobile-toolbar-action]')];
  for (const button of nodes) await click(view, button);
  assert.deepEqual(old, ['history', 'name', 'agents', 'branches', 'system', 'tools']);
  props = { ...props, toggleTopPanel: panel => current.push(panel), handleSystemInfoToggle: panel => current.push(panel), handleViewFullHistory: () => current.push('history'), handleAutoName: () => current.push('name') };
  await view.rerender(element());
  for (const button of nodes) await click(view, button);
  assert.deepEqual(current, old); assert.equal(old.length, 6);
  props = { ...props, hasSubagentSessions: false, sessionHasBranches: false }; await view.rerender(element());
  assert.deepEqual(actions(view.container), ['history', 'name', 'system', 'tools']);
  props = { ...props, selectedSession: null, showChat: false }; await view.rerender(element());
  for (const button of view.container.querySelectorAll('[data-mobile-toolbar-action]')) assert.equal(button.disabled, true);
  props = { ...props, mobile: false }; await view.rerender(element()); assert.equal(view.container.childNodes.length, 0);
});

test('actual swipe strip keeps fixed sidebar outside, real Git/control slots in order and releases resize subscriptions', async t => {
  const f = composerFixture(t), p = await production(f), calls = [];
  const common = inputs(), triggerRef = createRef(); let mobile = true, overviewList = false, id = 'A';
  const render = () => createElement(p.I18nProvider, null, createElement('div', null,
    createElement(p.SidebarToolbarToggle, { sidebarOpen: true, onToggle: () => calls.push('sidebar'), translate: key => key }),
    createElement(p.ToolbarActionsStrip, { isMobile: mobile, showChat: true, selectedSessionId: id, activeOverview: null },
      createElement(p.GitToolbarToggle, { active: false, onToggle: () => calls.push('git'), triggerRef }),
      createElement(p.MobileChatToolbar, { isMobile: mobile, overviewList,
        controls: createElement(p.ToolbarControls, common),
        stats: createElement(p.ToolbarStats, { ...common, contextUsage: { percent: 42, contextWindow: 100000, tokens: 42000 }, locale: 'en' }),
        files: createElement(p.ToolbarFiles, { ...common, contextUsage: null, rightPanelOpen: false, handleRightPanelToggle: () => calls.push('files') }),
      }))));
  const view = await f.mount(render()), sidebar = view.container.querySelector('.sidebar-toggle-button'), strip = view.container.querySelector('.top-bar-actions');
  assert.equal(sidebar.parentElement === strip.parentElement, true); assert.equal(strip.contains(sidebar), false);
  assert.equal(strip.querySelector('button') === triggerRef.current, true);
  assert.equal(triggerRef.current.classList.contains('activity-top-button'), true);
  assert.equal(triggerRef.current.getAttribute('aria-label'), 'Git Explorer');
  const toolbar = strip.querySelector('[data-mobile-toolbar="true"]'); assert.ok(toolbar);
  assert.deepEqual([...toolbar.children].map(node => node.dataset.mobileToolbarStats ?? node.dataset.mobileToolbarFile ?? 'controls'), ['controls', 'true', 'true']);
  Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 300 });
  await f.resize(strip); assert.equal(strip.classList.contains('has-more-right'), true); assert.equal(strip.classList.contains('has-more-left'), false);
  strip.scrollLeft = 200; await view.dispatch(strip, new view.window.Event('scroll'));
  assert.equal(strip.classList.contains('has-more-right'), false); assert.equal(strip.classList.contains('has-more-left'), true);
  for (const target of [sidebar, triggerRef.current, toolbar.querySelector('[data-mobile-toolbar-file]')]) await click(view, target);
  assert.deepEqual(calls, ['sidebar', 'git', 'files']);
  id = 'B'; await view.rerender(render()); assert.equal(view.container.querySelector('.top-bar-actions') === strip, true);
  overviewList = true; await view.rerender(render()); assert.equal(strip.querySelector('[data-mobile-toolbar]') === null, true);
  mobile = false; await view.rerender(render()); assert.equal([...f.observers].some(observer => observer.targets.has(strip)), false);
  await view.unmount(); assert.equal(f.observers.size, 0);
});

test('actual mobile title/project rows honor fallback identities and are withheld outside chat', async t => {
  const f = composerFixture(t), p = await production(f); let props = { isMobile: true, showChat: true, overviewList: false, session, newCwd: '/new/project' };
  const render = () => createElement(p.I18nProvider, null, createElement(p.ToolbarIdentity, props));
  const view = await f.mount(render());
  const title = () => view.container.querySelector('.mobile-session-title')?.textContent;
  const project = () => view.container.querySelector('.mobile-session-project');
  assert.equal(title(), 'Session title'); assert.equal(project().textContent, 'project'); assert.equal(project().title, '/project');
  props = { ...props, session: { ...session, name: '', projectRoot: undefined } }; await view.rerender(render());
  assert.equal(title(), 'fallback text'); assert.equal(project().title, '/project/worktree');
  props = { ...props, session: { ...props.session, firstMessage: `<skill name="review" location="/skills/review/SKILL.md">\nReferences are relative to /skills/review.\n\nInstructions\n</skill>\n\nliteral args` } }; await view.rerender(render());
  assert.equal(title(), '/skill:review literal args');
  props = { ...props, session: { ...props.session, firstMessage: 'x'.repeat(60) } }; await view.rerender(render()); assert.equal(title(), 'x'.repeat(50));
  props = { ...props, session: { ...props.session, firstMessage: '' } }; await view.rerender(render()); assert.equal(title(), session.id.slice(0, 12));
  props = { ...props, session: null }; await view.rerender(render()); assert.equal(title(), 'New session'); assert.equal(project().title, '/new/project');
  for (const change of [{ overviewList: true }, { isMobile: false }, { showChat: false }]) {
    const saved = props; props = { ...props, ...change }; await view.rerender(render()); assert.equal(view.container.childNodes.length, 0); props = saved;
  }
});

test('actual statistics/file controls stay directly reachable and preserve selected-session context/cost intent', async t => {
  const f = composerFixture(t), p = await production(f), calls = [];
  let props = { ...inputs(), contextUsage: { percent: 42.4, contextWindow: 100000, tokens: 42400 }, locale: 'en',
    sessionStats: { tokens: { input: 1000, output: 2000, cacheRead: 3, cacheWrite: 4 }, cost: 0.02 }, toggleTopPanel: panel => calls.push(panel) };
  const render = () => createElement(p.I18nProvider, null, createElement('div', null, createElement(p.ToolbarStats, props), createElement(p.ToolbarFiles, { ...props, rightPanelOpen: false, handleRightPanelToggle: () => calls.push('file') })));
  const view = await f.mount(render()), stats = view.container.querySelector('[data-mobile-toolbar-stats]'), file = view.container.querySelector('[data-mobile-toolbar-file]');
  assert.equal(stats.style.flex, '0 0 110px'); assert.equal(stats.textContent.includes('42%'), true); assert.equal(stats.textContent.includes('$0.02'), true);
  assert.equal(stats.querySelectorAll('.mobile-session-stat-io').length, 2); assert.equal(file.style.position, '');
  await click(view, stats); await click(view, file); assert.deepEqual(calls, ['session', 'file']);
  props = { ...props, showChat: false }; await view.rerender(render()); assert.equal(stats.disabled, true);
});

test('actual panel/expansion rules preserve left geometry, mutual exclusion and close-before-toggle ordering', async t => {
  const f = composerFixture(t), p = await production(f);
  assert.deepEqual(p.topPanelPosition('agents', { bottom: 36, left: 12, width: 800 }), { top: 36, left: 12, width: 420 });
  assert.deepEqual(p.topPanelPosition('agents', { bottom: 72, left: 4, width: 300 }), { top: 72, left: 4, width: 300 });
  assert.deepEqual(p.topPanelPosition('tools', { bottom: 36, left: 12, width: 800 }), { top: 36, left: 12, width: 800 });
  for (const isMobile of [false, true]) for (const rightPanelOpen of [false, true]) for (const rightPanelExpanded of [false, true]) for (const gitExplorerExpanded of [false, true]) for (const activeOverview of ['git', 'activity', null]) {
    const result = p.shellExpansionState({ isMobile, rightPanelOpen, rightPanelExpanded, gitExplorerExpanded, activeOverview });
    assert.equal(result.rightPanelFullWidth, !isMobile && rightPanelOpen && rightPanelExpanded);
    assert.equal(result.gitExplorerFullWidth, !isMobile && activeOverview === 'git' && gitExplorerExpanded && !result.rightPanelFullWidth);
  }
  for (const mobile of [false, true]) for (const overviewList of [false, true]) assert.equal(p.mobileToolbarVisible(mobile, overviewList), mobile && !overviewList);
  const calls = [];
  p.toggleFileExpansion(value => calls.push(['git', value]), value => calls.push(['panel', value]), update => calls.push(['expanded', update(false), update(true)]));
  assert.deepEqual(calls, [['git', false], ['panel', null], ['expanded', true, false]]);
});

// Presentation declarations only. Original installed-browser toolbar/Agents/Git,
// touch/swipe, trust/layout, navigation and expansion chains remain unchanged.
const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
const shell = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
test('mobile toolbar CSS declarations preserve alignment, swipe masks, truncation and stat container priorities', () => {
  const rule = styles.match(/\.activity-top-button\s*\{([^}]+)\}/)?.[1]; assert.ok(rule);
  for (const declaration of [/display:\s*flex/, /align-items:\s*center/, /justify-content:\s*center/, /padding:\s*0/]) assert.match(rule, declaration);
  assert.match(styles, /\.top-bar-actions \{ display: contents; \}/);
  assert.match(styles, /@media \(max-width: 640px\) \{\s*\.top-bar-actions \{[\s\S]*?overflow-x: auto;[\s\S]*?scrollbar-width: none;/);
  assert.match(styles, /\.top-bar-actions::-webkit-scrollbar \{ display: none; \}/);
  assert.match(styles, /\.top-bar-actions\.has-more-right \{[\s\S]*?--edge-mask: linear-gradient/);
  assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.mobile-session-title,\s*\.mobile-session-project \{[\s\S]*?text-overflow: ellipsis/);
  assert.match(shell, /\.mobile-session-stats \{[\s\S]*?container-type: inline-size/);
  assert.match(shell, /@container \(max-width: 158px\)[\s\S]*?\.mobile-session-stat-io/);
  assert.match(shell, /@container \(max-width: 88px\)[\s\S]*?\.mobile-session-stat-cost/);
});

test('actual toolbar panel owner retains Agents across selected-session rerender, closes missing branches/full-width and cleans geometry observers', async t => {
  const f = composerFixture(t), p = await production(f), api = createRef(), sidebar = [];
  let controls = inputs(), fullWidth = false;
  const onSidebar = value => sidebar.push(value);
  const render = () => createElement(p.I18nProvider, null, createElement(p.ToolbarStateProbe, { controls, fullWidth, api, onSidebar }));
  const view = await f.mount(render());
  const agent = () => view.container.querySelector('[data-mobile-toolbar-action="agents"]');
  await click(view, agent()); assert.equal(api.current.activeTopPanel, 'agents'); assert.deepEqual(sidebar, [false]);
  const button = agent();
  controls = { ...controls, selectedSession: { ...session, id: 'other-family-session' } }; await view.rerender(render());
  assert.equal(api.current.activeTopPanel, 'agents'); assert.equal(agent() === button, true);
  const bar = view.container.firstElementChild;
  bar.getBoundingClientRect = () => ({ left: 12, bottom: 36, width: 800 }); await f.resize(bar);
  assert.deepEqual(api.current.topPanelPos, { top: 36, left: 12, width: 420 });
  await click(view, view.container.querySelector('[data-mobile-toolbar-action="branches"]'));
  assert.equal(api.current.activeTopPanel, 'branches');
  controls = { ...controls, sessionHasBranches: false }; await view.rerender(render()); assert.equal(api.current.activeTopPanel, null);
  await click(view, agent()); fullWidth = true; await view.rerender(render()); assert.equal(api.current.activeTopPanel, null);
  fullWidth = false; await view.rerender(render()); await click(view, agent());
  controls = { ...controls, hasSubagentSessions: false }; await view.rerender(render()); assert.equal(api.current.activeTopPanel, null);
  await view.unmount(); assert.equal(f.observers.size, 0);
});

test('Explorer reader key is an intentional composition/identity declaration, independent of expansion dimensions', () => {
  const key = shell.match(/<GitExplorerPanel key=\{([^\n]+)\}/)?.[1];
  assert.equal(key, 'reviewNavigation ? `review:${reviewNavigation.cwd}:${reviewNavigation.requestId}` : activeCwd ?? "no-worktree"');
  assert.doesNotMatch(key, /expanded|width|mobile/i);
});

test('actual scrolling-toolbar subagent marker is present only for a shown subagent chat', async t => {
  const f = composerFixture(t), p = await production(f);
  let props = { showChat: true, selectedSession: { ...session, relation: { kind: 'subagent' } } };
  const render = () => createElement(p.I18nProvider, null, createElement(p.ToolbarActionsStrip, { isMobile: true, showChat: props.showChat, selectedSessionId: props.selectedSession?.id, activeOverview: null }, createElement(p.ToolbarMarker, props)));
  const view = await f.mount(render());
  assert.equal(view.container.querySelectorAll('.top-bar-actions [role="img"]').length, 1);
  assert.equal(view.container.querySelector('[role="img"]').getAttribute('aria-label'), 'Sub-agent');
  assert.equal(view.container.querySelector('svg').getAttribute('width'), '16');
  for (const change of [{ showChat: false }, { selectedSession: session }, { selectedSession: null }]) {
    const previous = props; props = { ...props, ...change }; await view.rerender(render());
    assert.equal(view.container.querySelector('[role="img"]') === null, true); props = previous;
  }
});
