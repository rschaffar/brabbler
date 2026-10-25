import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { act, createElement } from "react";
import { composerFixture, inputText, click, exactQuery, exactHeaders } from "./composer.fixture.mjs";
import { createJiti } from "jiti";

describe("ChatInput fixture ownership", () => {
  let fixtureCleanup;
  let React, renderToStaticMarkup;
  let ChatInput, ModelErrorBanner, ModelScopeWarningBanner, canClearBuiltinCommandInput, canRestoreUserMessage, canRunBuiltinSlashCommandWhileStreaming, compressImageFile, cycleListIndex, filterModelOptions, getUpwardMenuMaxHeight, getUserMessageText, getUserMessageDraftImages, isExactSlashCommand, modelSupportsImageInput, replaceLinksWithMarkdown, shouldCompressImageFile, stacksComposerLayout;
  let ModelSelector, clearDraft, getDraft, mergeRestoredSubmissionDraft, mergeRestoredSubmissionText, rekeyDraft, setDraft, I18nProvider;

  // A child-suite disposer, registered even if async setup rejects. Capture the
  // fixture's own early cleanup registration, including partial construction.
  after(async () => { if (fixtureCleanup) await fixtureCleanup(); });
  before(async () => {
    composerFixture({ after: cleanup => { fixtureCleanup = cleanup; } });
    // Deny external effects before the SSR/rule import graph as well as mounts.
    const jiti = createJiti(import.meta.url, {
      jsx: { runtime: "automatic" },
      tsconfigPaths: true,
      fsCache: false,
    });
    React = await jiti.import("react");
    ({ renderToStaticMarkup } = await jiti.import("react-dom/server"));
    ({ ChatInput, ModelErrorBanner, ModelScopeWarningBanner, canClearBuiltinCommandInput, canRestoreUserMessage, canRunBuiltinSlashCommandWhileStreaming, compressImageFile, cycleListIndex, filterModelOptions, getUpwardMenuMaxHeight, getUserMessageText, getUserMessageDraftImages, isExactSlashCommand, modelSupportsImageInput, replaceLinksWithMarkdown, shouldCompressImageFile, stacksComposerLayout } = await jiti.import("./ChatInput.tsx"));
    ({ ModelSelector } = await jiti.import("./ModelSelector.tsx"));
    ({ clearDraft, getDraft, mergeRestoredSubmissionDraft, mergeRestoredSubmissionText, rekeyDraft, setDraft } = await jiti.import("@/lib/draft-store.ts"));
    ({ I18nProvider } = await jiti.import("@/hooks/useI18n"));
  });

test("composer active-row reselection is explicit and other model pickers retain their no-op", async t => {
  const calls = [];
  const c = await mountedInput(t, { model: { provider: 'fixture', modelId: 'one' },
    modelList: [{ provider: 'fixture', id: 'one', name: 'One' }, { provider: 'other', id: 'one', name: 'Other One' }],
    onModelChange: (...args) => calls.push(args) });
  const choose = async name => {
    await click(c.view, c.view.container.querySelector('.model-selector > button'));
    const row = [...c.view.container.querySelectorAll('button')].find(node => node.textContent.includes(name) && node.getAttribute('role') === 'option');
    assert.ok(row, `model option ${name}`); await click(c.view, row);
  };
  await choose('One'); assert.deepEqual(calls, [['fixture', 'one']]);
  const currentModel = []; await c.update({ onModelChange: (...args) => currentModel.push(args) });
  await choose('One'); assert.deepEqual(currentModel, [['fixture', 'one']]); assert.equal(calls.length, 1);
  await c.update({ isStreaming: true });
  assert.equal(c.view.container.querySelector('.model-selector > button').disabled, true);
  await c.update({ isStreaming: false, isCompacting: true });
  assert.equal(c.view.container.querySelector('.model-selector > button').disabled, true);
  await c.f.dispose();
  const f = composerFixture(t), p = await f.load();
  let props = { options: [{ provider: 'fixture', modelId: 'one', name: 'One' }, { provider: 'other', modelId: 'one', name: 'Other One' }],
    value: { provider: 'fixture', modelId: 'one' }, onChange: (...args) => calls.push(args), ariaLabel: 'Picker' };
  const element = () => createElement(p.I18nProvider, null, createElement(p.ModelSelector, props));
  const view = await f.mount(element());
  const select = async name => {
    await click(view, view.container.querySelector('[aria-label="Picker"]'));
    const row = [...view.container.querySelectorAll('[role="option"]')].find(node => node.textContent.includes(name));
    assert.ok(row); await click(view, row);
  };
  await select('One'); assert.equal(calls.length, 1, 'ordinary active selection is a no-op');
  props = { ...props, isAutoSelection: true }; await view.rerender(element());
  await select('One');
  props = { ...props, isAutoSelection: false }; await view.rerender(element());
  await select('Other One');
  assert.deepEqual(calls, [['fixture', 'one'], ['fixture', 'one'], ['other', 'one']]);
});

test("preserves pasted HTML links as Markdown without changing plain text layout", () => {
  const link = (label, href, occurrence = 0) => ({ label, href, occurrence });

  assert.equal(
    replaceLinksWithMarkdown(
      "Jobs:\nEngineer\nEngineer\nDone",
      [link("Engineer", "https://example.com/1"), link("Engineer", "https://example.com/2", 1)],
    ),
    "Jobs:\n[Engineer](https://example.com/1)\n[Engineer](https://example.com/2)\nDone",
  );
  assert.equal(
    replaceLinksWithMarkdown("Read [this]", [link("[this]", "https://example.com/a_(b)")]),
    "Read [\\[this\\]](https://example.com/a_\\(b\\))",
  );
  assert.equal(
    replaceLinksWithMarkdown("Engineer and Engineer", [link("Engineer", "https://example.com/job", 1)]),
    "Engineer and [Engineer](https://example.com/job)",
  );
  assert.equal(replaceLinksWithMarkdown("plain text", [link("missing", "https://example.com")]), null);
});

test("only compact quotes and streaming mobile composers stack their action row", () => {
  for (const compact of [false, true]) for (const mobile of [false, true]) for (const streaming of [false, true]) {
    assert.equal(stacksComposerLayout(compact, mobile, streaming), compact || (mobile && streaming));
  }
});

test("follow-up shortcuts preserve newline, IME, mobile and completion behavior", async t => {
  const cases = [
    ['Enter steers', {}, {}, 'steer'], ['Alt+Enter follows up', { altKey: true }, {}, 'followup'],
    ['idle Alt+Enter sends', { altKey: true }, { isStreaming: false }, 'send'],
    ['Shift+Enter inserts a newline', { shiftKey: true }, {}, 'native'],
    ['Alt+Shift+Enter keeps native behavior', { altKey: true, shiftKey: true }, {}, 'native'],
    ['composition ref blocks sending', { altKey: true }, { composition: true }, 'native'],
    ['native composition blocks sending', { altKey: true, isComposing: true }, {}, 'native'],
    ['IME keyCode blocks sending', { altKey: true, keyCode: 229 }, {}, 'native'],
    ['composition grace blocks sending', { altKey: true }, { grace: true }, 'prevented'],
    ['mobile Alt+Enter keeps native behavior', { altKey: true }, { mobile: true }, 'native'],
    ['mobile composition grace cannot send', { altKey: true }, { mobile: true, grace: true }, 'native'],
    ['mobile Ctrl+Alt+Enter follows up', { altKey: true, ctrlKey: true }, { mobile: true }, 'followup'],
    ['mobile Cmd+Alt+Enter follows up', { altKey: true, metaKey: true }, { mobile: true }, 'followup'],
    ['mobile modified Enter respects grace', { altKey: true, ctrlKey: true }, { mobile: true, grace: true }, 'prevented'],
    ['Enter falls back to follow-up', {}, { noSteer: true }, 'followup'],
    ['Alt+Enter falls back to steer', { altKey: true }, { noFollowUp: true }, 'steer'],
  ];
  for (const [name, keys, state, expected] of cases) await t.test(name, async child => {
    const actions = [];
    const c = await mountedInput(child, { isStreaming: state.isStreaming ?? true,
      onSend: text => actions.push(['send', text]),
      onSteer: state.noSteer ? undefined : text => actions.push(['steer', text]),
      onFollowUp: state.noFollowUp ? undefined : text => actions.push(['followup', text]),
    }, { mobile: state.mobile });
    let now = 1000; c.f.replace(Date, 'now', () => now);
    await inputText(c.view, c.ta, 'literal draft');
    if (state.composition) await c.view.dispatch(c.ta, new c.view.window.CompositionEvent('compositionstart', { bubbles: true }));
    if (state.grace) {
      now = 950; await c.view.dispatch(c.ta, new c.view.window.CompositionEvent('compositionend', { bubbles: true })); now = 1000;
    }
    const prevented = await c.f.key(c.ta, 'Enter', keys);
    await act(async () => { await c.api.current.whenSettled(); });
    assert.deepEqual(actions.map(([action]) => action), ['native', 'prevented'].includes(expected) ? [] : [expected]);
    assert.equal(prevented, expected !== 'native');
    assert.equal(c.ta.value, ['native', 'prevented'].includes(expected) ? 'literal draft' : '');
  });
});

test('real palette/history completion wins over queue shortcuts and uses current callbacks', async t => {
  const calls = [];
  const c = await mountedInput(t, { isStreaming: true, onSteer: text => calls.push(['old', text]), onFollowUp: text => calls.push(['old-follow', text]),
    slashCommands: [{ name: 'help', source: 'extension', description: 'help' }], onBuiltinCommand: async text => { calls.push(['builtin', text]); return { handled: true }; } });
  await inputText(c.view, c.ta, '/he');
  // Builtins and extensions retain their actual production grouping/order.
  // Select the real named extension row rather than assuming it is first.
  const help = [...c.view.container.querySelectorAll('button')].find(button =>
    [...button.querySelectorAll('span')].some(label => label.textContent.trim() === '/help'));
  assert.ok(help, 'the actual Help completion row is present');
  await c.view.dispatch(help, new c.view.window.MouseEvent('mouseover', { bubbles: true, relatedTarget: c.view.window.document.body }));
  await c.f.key(c.ta, 'Enter', { altKey: true }); await c.f.frame();
  assert.equal(c.ta.value, '/help '); assert.deepEqual(calls, []);
  await inputText(c.view, c.ta, '/copy'); await c.f.key(c.ta, 'Enter', { altKey: true });
  await act(async () => { await c.api.current.whenSettled(); }); assert.deepEqual(calls, [['builtin', '/copy']]);
  await c.update({ isStreaming: false, inputHistory: ['previous'] });
  await inputText(c.view, c.ta, ''); await c.f.key(c.ta, 'ArrowUp'); await c.f.key(c.ta, 'Enter', { altKey: true }); await c.f.frame();
  assert.equal(c.ta.value, 'previous'); assert.equal(calls.length, 1);
  await c.update({ isStreaming: true, onSteer: text => calls.push(['current', text]) });
  await c.f.key(c.ta, 'Enter'); assert.deepEqual(calls.at(-1), ['current', 'previous']);
});

test("file mention arrows wrap around the match list", async t => {
  const c = await mountedInput(t, { cwd: '/fixture', isStreaming: true, onSteer() {}, onFollowUp() {} }, { route(request) {
    assert.equal(request.url.pathname, '/api/file-index'); exactQuery(request, { cwd: '/fixture' }); exactHeaders(request);
    assert.equal(request.options.method ?? 'GET', 'GET'); return { files: ['a.ts', 'b.ts', 'c.ts'], truncated: false };
  } });
  await inputText(c.view, c.ta, '@'); await act(async () => { await c.api.current.whenSettled(); });
  const selected = () => [...c.view.container.querySelectorAll('button')].filter(node => ['a.ts', 'b.ts', 'c.ts'].includes(node.textContent.trim()) && node.style.background === 'var(--bg-selected)').map(node => node.textContent.trim());
  assert.deepEqual(selected(), ['a.ts']);
  for (const [key, expected] of [['ArrowDown', 'b.ts'], ['ArrowDown', 'c.ts'], ['ArrowDown', 'a.ts'], ['ArrowUp', 'c.ts'], ['ArrowUp', 'b.ts'], ['ArrowUp', 'a.ts']]) {
    await c.f.key(c.ta, key); assert.deepEqual(selected(), [expected]);
  }
  await c.f.key(c.ta, 'Enter', { altKey: true }); await c.f.frame(); assert.equal(c.ta.value, '@a.ts ');
  await inputText(c.view, c.ta, '@b'); await c.f.key(c.ta, 'ArrowDown'); await c.f.key(c.ta, 'ArrowUp');
  assert.deepEqual(selected(), ['b.ts']);
  await inputText(c.view, c.ta, '@missing'); await c.f.key(c.ta, 'ArrowDown'); await c.f.key(c.ta, 'ArrowUp'); assert.deepEqual(selected(), []);
});

test("cycleListIndex wraps in both directions", () => {
  assert.equal(cycleListIndex(0, 3, 1), 1);
  assert.equal(cycleListIndex(2, 3, 1), 0);
  assert.equal(cycleListIndex(0, 3, -1), 2);
  assert.equal(cycleListIndex(1, 3, -1), 0);
  assert.equal(cycleListIndex(0, 1, 1), 0);
  assert.equal(cycleListIndex(4, 0, 1), 0);
  assert.equal(cycleListIndex(-1, 4, 1), 0);
});

test("shows the follow-up shortcut in the button tooltip", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ChatInput, {
      onSend() {}, onAbort() {}, onFollowUp() {}, isStreaming: true,
    })),
  );

  assert.match(html, /title="Queue this message after the agent finishes \(Alt\/Option\+Enter\)"/);
  assert.match(html, /aria-keyshortcuts="Alt\+Enter"/);
});

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelErrorBanner, {
        error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Model error/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(
    renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(ModelErrorBanner, { error: null })),
    ),
    "",
  );
});

test("renders enabledModels scope warnings", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelScopeWarningBanner, {
        warnings: ['No models match pattern "ghost-gateway/*"'],
      }),
    ),
  );

  assert.match(html, /Model scope warning/);
  assert.match(html, /ghost-gateway/);
  assert.equal(
    renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(ModelScopeWarningBanner, { warnings: [] })),
    ),
    "",
  );
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        modelError: "Invalid models.json schema",
        modelList: [],
        modelNames: {},
      }),
    ),
  );

  assert.match(html, />No models</);
  assert.match(html, /title="No available models"/);
});

test("renders the read-only tool preset as the active selection", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onToolPresetChange() {},
        isStreaming: false,
        toolPreset: "read-only",
      }),
    ),
  );

  assert.match(html, /title="Change tool preset: read-only"/);
  assert.match(html, />read-only<\/span>/);
});

test("renders the empty tool preset as Chat only", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onToolPresetChange() {},
        isStreaming: false,
        toolPreset: "none",
      }),
    ),
  );

  assert.match(html, /title="Change tool preset: Chat only"/);
  assert.match(html, />Chat only<\/span>/);
});

test("renders the compact composer with the standard Send button and no session controls", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        isStreaming: false,
        compact: true,
      }),
    ),
  );

  assert.match(html, /<textarea/);
  assert.match(html, />Send<\/button>/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /type="file"|Attach image|Change tool preset/);
});

test("shows and locks the optimistic model while a switch is pending", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
        modelList: [{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
        modelSwitching: true,
      }),
    ),
  );

  assert.match(html, /title="Switching model"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, />DeepSeek V4 Flash</);
  assert.match(html, /animation:spin 0\.8s linear infinite/);
});

test("filters model options by name, id, provider and qualified id without merging identities", () => {
  const options = [
    { provider: "ollama", modelId: "qwen3:latest", name: "Qwen 3" },
    { provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { provider: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
    { provider: "relay-a", modelId: "gpt-5.4", name: "GPT-5.4" },
  ];

  assert.deepEqual(filterModelOptions(options, "QWEN"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "claude-sonnet"), [options[1]]);
  assert.deepEqual(filterModelOptions(options, "OpenAI"), [options[2]]);
  assert.deepEqual(filterModelOptions(options, " anthropic/claude "), [options[1]]);
  assert.deepEqual(filterModelOptions(options, "Relay-A/GPT"), [options[3]]);
  assert.deepEqual(filterModelOptions(options, "gpt-5.4"), [options[2], options[3]]);
  assert.equal(filterModelOptions(options, "missing").length, 0);
  assert.equal(filterModelOptions(options, "  "), options);
});

test("renders the shared field model selector as a disabled gray control", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelSelector, {
        options: [{ provider: "openai", modelId: "gpt-5.6-sol", name: "GPT-5.6 Sol" }],
        value: null,
        onChange() {},
        onClear() {},
        emptyLabel: "Parent default",
        ariaLabel: "Model override",
        disabled: true,
        variant: "field",
      }),
    ),
  );

  assert.match(html, /aria-label="Model override"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /background:var\(--bg-panel\)/);
  assert.match(html, />Parent default</);
});

test("caps an upward menu to the visible space above its anchor", () => {
  assert.equal(getUpwardMenuMaxHeight(343, 36), 299);
  assert.equal(getUpwardMenuMaxHeight(40, 36), 0);
  // Composer sitting under a 36px top bar with only ~160px of air: a 400px
  // file list would paint through the bar and hide the leading matches.
  assert.equal(getUpwardMenuMaxHeight(200, 36), 156);
  assert.ok(getUpwardMenuMaxHeight(200, 36) < 400);
});

test("file mention menu applies the measured upward height cap", async t => {
  const c = await mountedInput(t, { cwd: '/fixture' }, { route(request) { exactQuery(request, { cwd: '/fixture' }); assert.equal(request.url.pathname, '/api/file-index'); return { files: ['a.ts'] }; } });
  await inputText(c.view, c.ta, '@'); await act(async () => { await c.api.current.whenSettled(); });
  const menu = [...c.view.container.querySelectorAll('div')].find(node => node.style.maxHeight.startsWith('min(48vh'));
  assert.ok(menu); assert.equal(menu.style.flexDirection, 'column');
  assert.equal([...menu.children].some(node => node.style.minHeight === '0'), true);
  menu.getBoundingClientRect = () => ({ bottom: 200 });
  const layout = menu.parentElement.parentElement;
  layout.style.overflowY = 'hidden'; layout.getBoundingClientRect = () => ({ top: 36 });
  await c.f.resize(layout); await c.f.frame();
  assert.equal(menu.style.maxHeight, 'min(48vh, 400px, 156px)');
});

test("file mention menu remeasures when its layout container shifts the anchor", async t => {
  const c = await mountedInput(t, { cwd: '/fixture' }, { route(request) { assert.equal(request.url.pathname, '/api/file-index'); exactQuery(request, { cwd: '/fixture' }); return { files: ['a.ts'] }; } });
  await inputText(c.view, c.ta, '@'); await act(async () => { await c.api.current.whenSettled(); });
  const menu = [...c.view.container.querySelectorAll('div')].find(node => node.style.maxHeight.startsWith('min(48vh'));
  const parent = menu.parentElement, layout = parent.parentElement;
  assert.equal([...c.f.observers].some(observer => observer.targets.has(parent) && observer.targets.has(layout)), true);
  menu.getBoundingClientRect = () => ({ bottom: 343 });
  layout.style.overflowY = 'hidden'; layout.getBoundingClientRect = () => ({ top: 36 });
  await c.f.resize(layout); await c.f.frame(); assert.equal(menu.style.maxHeight, 'min(48vh, 400px, 299px)');
  menu.getBoundingClientRect = () => ({ bottom: 200 });
  await c.f.resize(layout); assert.equal(c.f.frames.size, 1); await c.f.frame();
  assert.equal(menu.style.maxHeight, 'min(48vh, 400px, 156px)');
  await c.f.key(c.ta, 'Escape'); assert.equal([...c.f.observers].some(observer => observer.targets.has(layout)), false);
  assert.equal(c.f.frames.size, 0);
});

test('real file-menu viewport/window subscriptions coalesce measurements and release on close/unmount', async t => {
  let viewport, viewportEvents, windowEvents;
  const c = await mountedInput(t, { cwd: '/menu-viewport' }, { setup(window, f) {
    viewport = new window.EventTarget(); Object.assign(viewport, { offsetTop: 36 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    viewportEvents = f.watchEvents(viewport, ['resize', 'scroll']); windowEvents = f.watchEvents(window, ['resize', 'scroll']);
  }, route(request) { assert.equal(request.url.pathname, '/api/file-index'); exactQuery(request, { cwd: '/menu-viewport' }); return { files: ['only.ts'] }; } });
  await inputText(c.view, c.ta, '@'); await act(async () => { await c.api.current.whenSettled(); });
  const menu = [...c.view.container.querySelectorAll('div')].find(node => node.style.maxHeight.startsWith('min(48vh')); assert.ok(menu);
  let bottom = 200; menu.getBoundingClientRect = () => ({ bottom });
  await c.view.dispatch(viewport, new c.view.window.Event('resize')); await c.view.dispatch(viewport, new c.view.window.Event('scroll'));
  assert.equal(c.f.frames.size, 1); await c.f.frame(); assert.equal(menu.style.maxHeight, 'min(48vh, 400px, 156px)');
  bottom = 343; await c.view.dispatch(c.view.window, new c.view.window.Event('resize')); await c.f.frame();
  assert.equal(menu.style.maxHeight, 'min(48vh, 400px, 299px)'); assert.equal(viewportEvents.size, 2);
  await c.view.dispatch(viewport, new c.view.window.Event('resize')); assert.equal(c.f.frames.size, 1);
  await c.f.key(c.ta, 'Escape'); assert.equal(c.f.frames.size, 0); assert.equal(viewportEvents.size, 0);
  await c.view.unmount(); assert.equal(windowEvents.size, 0);
});

test("compresses large images while preserving small images and GIFs", async t => {
  assert.equal(shouldCompressImageFile({ size: 1024 * 1024, type: "image/png" }), false);
  assert.equal(shouldCompressImageFile({ size: 1024 * 1024 + 1, type: "image/png" }), true);
  assert.equal(shouldCompressImageFile({ size: 2 * 1024 * 1024, type: "image/gif" }), false);

  const f = composerFixture(t);
  let bitmapCalls = 0;
  let closed = false;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: "", fillRect() {}, drawImage() {} }),
    toDataURL: () => "data:image/jpeg;base64,COMPRESSED",
  };

  f.replace(globalThis, 'FileReader', class {
    readAsDataURL() {
      this.result = "data:image/png;base64,ORIGINAL";
      this.onload();
    }
  });
  f.replace(globalThis, 'createImageBitmap', async () => {
    bitmapCalls += 1;
    return { width: 2048, height: 1024, close() { closed = true; } };
  });
  f.replace(globalThis, 'document', { createElement: () => canvas });

  {
    assert.deepEqual(await compressImageFile({ size: 1024, type: "image/png" }), {
      data: "ORIGINAL",
      mimeType: "image/png",
    });
    assert.deepEqual(await compressImageFile({ size: 2 * 1024 * 1024, type: "image/png" }), {
      data: "COMPRESSED",
      mimeType: "image/jpeg",
    });
    assert.equal(bitmapCalls, 1);
    assert.equal(canvas.width, 1024);
    assert.equal(canvas.height, 512);
    assert.equal(closed, true);
  }
});

test("recognizes exact slash commands for one-Enter submission", () => {
  const builtin = { name: "copy", description: "", source: "builtin" };
  assert.equal(isExactSlashCommand("/copy", builtin), true);
  assert.equal(isExactSlashCommand("  /copy  ", builtin), true);
  assert.equal(isExactSlashCommand("/co", builtin), false);
  assert.equal(isExactSlashCommand("/copy extra", builtin), false);
  assert.equal(isExactSlashCommand("/copy", { ...builtin, source: "extension" }), false);
});

test("clears a completed built-in only while its submitted input is unchanged", () => {
  assert.equal(canClearBuiltinCommandInput("/copy", 0, "/copy"), true);
  assert.equal(canClearBuiltinCommandInput("new follow-up", 0, "/copy"), false);
  assert.equal(canClearBuiltinCommandInput("/copy", 1, "/copy"), false);
});

test("locks built-in command submission until it settles", async t => {
  let resolve; const gate = new Promise(done => { resolve = done; }); const calls = [];
  const c = await mountedInput(t, { onBuiltinCommand: message => { calls.push(message); return gate; } });
  c.f.release(() => resolve({ handled: true }));
  await inputText(c.view, c.ta, '/reload'); await c.f.key(c.ta, 'Enter');
  assert.deepEqual(calls, ['/reload']);
  const fieldset = c.view.container.querySelector('fieldset');
  assert.equal(fieldset.disabled, true); assert.equal(fieldset.getAttribute('aria-busy'), 'true');
  await c.f.key(c.ta, 'Enter'); assert.equal(calls.length, 1);
  const complete = c.api.current.whenSettled();
  await act(async () => { resolve({ handled: true }); await complete; });
  assert.equal(fieldset.disabled, false); assert.equal(fieldset.getAttribute('aria-busy'), 'false'); assert.equal(c.ta.value, '');
});

test("keeps only read-only built-ins available while a run is active", () => {
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/copy"), true);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/session"), true);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/compact"), false);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/auto-compact"), false);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/reload"), false);
});

test("restores text and base64 images when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Review this image @src/example.ts " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };

  assert.equal(getUserMessageText(message), "Review this image @src/example.ts ");
  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/png" },
  ]);
});

test("restores legacy flat image entries when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "AQID", mimeType: "image/jpeg" },
    ],
  };

  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/jpeg" },
  ]);
});

test("does not restore a historical message over a pending image attachment", () => {
  assert.equal(canRestoreUserMessage("", 0, 0), true);
  assert.equal(canRestoreUserMessage("", 1, 0), false);
  assert.equal(canRestoreUserMessage("", 0, 1), false);
  assert.equal(canRestoreUserMessage("draft", 0, 0), false);
});

test("restores a cleared submission using the queued React state", () => {
  let value = "failed submission";
  const updates = [
    () => "",
    (current) => mergeRestoredSubmissionText("failed submission", current),
  ];

  for (const update of updates) value = update(value);

  assert.equal(value, "failed submission");
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "new draft"),
    "failed submission\n\nnew draft",
  );
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "failed submission"),
    "failed submission\n\nfailed submission",
  );
});

test("keeps a failed first submission recoverable across a composer remount", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft(
    "failed submission",
    [image],
    "",
    [],
  );

  assert.deepEqual(restored, {
    value: "failed submission",
    images: [image],
  });
  assert.deepEqual(
    mergeRestoredSubmissionDraft("failed submission", [image], "new draft", []),
    {
      value: "failed submission\n\nnew draft",
      images: [image],
    },
  );
});

test("preserves duplicate image attachments when restoring a submission", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft("", [image, image], "", [image]);

  assert.deepEqual(restored.images, [image, image, image]);
});

test("moves a provisional new-session draft to the real session key", () => {
  const provisionalKey = "new:/tmp/rekey-test";
  const sessionKey = "session-rekey-test";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "queued while preflight ran", images: [] });

  assert.deepEqual(rekeyDraft(provisionalKey, sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });

  clearDraft(sessionKey);
});

test("rekey keeps a synchronously restored draft when React state is still empty", () => {
  const provisionalKey = "new:/tmp/rekey-race";
  const sessionKey = "session-rekey-race";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "restored before state flush", images: [] });

  assert.deepEqual(
    rekeyDraft(provisionalKey, sessionKey, { value: "", images: [] }),
    { value: "restored before state flush", images: [] },
  );
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "restored before state flush",
    images: [],
  });

  clearDraft(sessionKey);
});

test("renders compact errors above the input as a wrapping alert", () => {
  const error = "Compaction failed: OpenAI API error (403): <html>request forbidden</html>";
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        compactError: error,
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Compaction failed: OpenAI API error/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
  assert.match(html, /white-space:pre-wrap/);
  assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
});

test("modelSupportsImageInput warns only when modality info is known and lacks image", () => {
  const modelList = [
    { id: "text-only", name: "Text Only", provider: "ollama", input: ["text"] },
    { id: "vision", name: "Vision", provider: "anthropic", input: ["text", "image"] },
    { id: "unknown", name: "Unknown", provider: "custom", input: undefined },
  ];

  assert.equal(modelSupportsImageInput({ provider: "ollama", modelId: "text-only" }, modelList), false);
  assert.equal(modelSupportsImageInput({ provider: "anthropic", modelId: "vision" }, modelList), true);
  // Unknown modality info never blocks the user.
  assert.equal(modelSupportsImageInput({ provider: "custom", modelId: "unknown" }, modelList), true);
  // Model missing from the list is treated as unknown.
  assert.equal(modelSupportsImageInput({ provider: "x", modelId: "missing" }, modelList), true);
  assert.equal(modelSupportsImageInput(null, modelList), true);
  assert.equal(modelSupportsImageInput({ provider: "ollama", modelId: "text-only" }, undefined), true);
});

test("renders image warnings for known text-only defaults without an explicit model selection", () => {
  const draftKey = "new:/tmp/image-warning-default";
  const modelList = [
    { id: "text-only", name: "Text Only", provider: "custom", input: ["text"] },
    { id: "vision", name: "Vision", provider: "custom", input: ["text", "image"] },
    { id: "unknown", name: "Unknown", provider: "custom" },
  ];
  setDraft(draftKey, {
    value: "Describe this image",
    images: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
  });

  try {
    for (const [modelId, warningExpected] of [["text-only", true], ["vision", false], ["unknown", false], [null, false]]) {
      const html = renderToStaticMarkup(
        React.createElement(
          I18nProvider,
          null,
          React.createElement(ChatInput, {
            onSend() {},
            onAbort() {},
            isStreaming: false,
            isAutoModelSelection: true,
            model: modelId ? { provider: "custom", modelId } : null,
            modelList,
            draftKey,
          }),
        ),
      );

      assert.match(html, /<img/);
      assert.equal(html.includes("Images may not be sent"), warningExpected, `default model: ${modelId}`);
      if (warningExpected) {
        assert.match(html, /The selected model \(Text Only\) does not support image input/);
        assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
      }
    }
  } finally {
    clearDraft(draftKey);
  }
});

async function mountedInput(t, initial = {}, options = {}) {
  const f = composerFixture(t, options);
  return { f, ...await f.input(initial) };
}

for (const [mode, keys] of [['send', {}], ['steer', {}], ['followup', { altKey: true }]]) {
  test(`actual ${mode} events use a separately rerendered current callback and trim submitted text`, async t => {
    const old = [], current = [], initial = { isStreaming: mode !== 'send',
      onSend: (...args) => old.push(args), onSteer: (...args) => old.push(args), onFollowUp: (...args) => old.push(args) };
    const c = await mountedInput(t, initial);
    const prop = mode === 'send' ? 'onSend' : mode === 'steer' ? 'onSteer' : 'onFollowUp';
    await inputText(c.view, c.ta, '  exact current text  ');
    // Value/menu state is already committed: change ONLY the callback before use.
    await c.update({ [prop]: (...args) => current.push(args) });
    await c.f.key(c.ta, 'Enter', keys);
    await act(async () => { await c.api.current.whenSettled(); });
    assert.deepEqual(old, []); assert.deepEqual(current, [['exact current text', undefined]]);
    assert.equal(c.ta.value, '');
  });
}

test('real streaming slash queue routes its explicit behavior through the current callback rather than dropping the command', async t => {
  const calls = [], old = [];
  const c = await mountedInput(t, { isStreaming: true, onSteer() {}, onFollowUp() {}, onPromptWithStreamingBehavior: (...args) => old.push(args) });
  await inputText(c.view, c.ta, '/custom literal argument');
  await c.update({ onPromptWithStreamingBehavior: (...args) => calls.push(args) });
  await c.f.key(c.ta, 'Enter', { altKey: true });
  assert.deepEqual(calls, [['/custom literal argument', 'followUp', undefined]]); assert.deepEqual(old, []);
});

for (const [mode, keys] of [['send', {}], ['steer', {}], ['followup', { altKey: true }]]) {
  test(`actual ${mode} completion includes the returned external callback after unmount`, async t => {
    let resolve, entered = 0; const gate = new Promise(done => { resolve = done; });
    const callback = () => { entered++; return gate; };
    const c = await mountedInput(t, { isStreaming: mode !== 'send', onSend: callback, onSteer: callback, onFollowUp: callback });
    c.f.release(resolve);
    await inputText(c.view, c.ta, 'owned callback'); await c.f.key(c.ta, 'Enter', keys); assert.equal(entered, 1);
    let complete = false; const joined = c.api.current.whenSettled().then(() => { complete = true; });
    await c.view.unmount(); assert.equal(complete, false);
    await act(async () => { resolve(); await joined; }); assert.equal(complete, true);
  });
}

test('actual submission restore updates imperative text/image refs before same-turn rekey and survives remount', async t => {
  const oldKey = 'new:mounted-restore', newKey = 'saved-mounted-restore', image = { data: 'AQID', mimeType: 'image/png' };
  const c = await mountedInput(t, { draftKey: oldKey });
  c.f.release(() => { c.p.clearDraft(oldKey); c.p.clearDraft(newKey); });
  await act(async () => {
    c.api.current.restoreSubmission(' literal rejected text ', [image]);
    c.api.current.rekeyDraft(oldKey, newKey);
  });
  assert.deepEqual(c.p.getDraft(newKey), { value: ' literal rejected text ', images: [image] });
  assert.equal(c.p.getDraft(oldKey), null);
  await c.update({ draftKey: newKey }); assert.equal(c.ta.value, ' literal rejected text ');
  assert.equal(c.view.container.querySelectorAll('img').length, 1);
  await c.view.rerender(null);
  const ref = { current: null };
  await c.view.rerender(createElement(c.p.I18nProvider, null, createElement(c.p.ChatInput, { draftKey: newKey, onSend() {}, onAbort() {}, isStreaming: false, ref })));
  assert.equal(c.view.container.querySelector('textarea').value, ' literal rejected text ');
  assert.equal(c.view.container.querySelectorAll('img').length, 1);
  const handle = ref.current; c.f.join(() => handle.whenSettled());
});


// Add inside the EXISTING fixture-owning describe; no new fixture or test file.
for (const [inputId, mobile] of [['legacy-desktop', false], ['legacy-mobile', true]]) {
  test(`H-COMPOSER exact ${inputId} browser vectors reach the real filter and newline handlers`, async t => {
    const commands = [], sends = [], selections = [];
    let editingSupported = true;
    const modelList = Array.from({ length: 12 }, (_, i) => ({
      provider: i === 11 ? 'relay-fixture' : 'fixture', id: `model-${i}`, name: `Fixture model ${i}`,
    }));
    const c = await mountedInput(t, {
      modelList,
      onSend: (...args) => sends.push(args),
      onModelChange: (...args) => selections.push(args),
    }, { mobile, setup(window, f) {
      // The external editing capability applies ONLY the edit supplied by real
      // ChatInput. It does not compute a list prefix, IME state or fallback.
      // This is not browser undo, native clipboard or native newline insertion.
      const document = window.document;
      const original = Object.getOwnPropertyDescriptor(document, 'execCommand');
      let restored = false;
      // Register before installing the realm capability. Existing beforeDispose
      // releases run after unmount and BEFORE this realm is destroyed, including
      // failed mount. Do not put a realm descriptor in the host-restoration tail.
      f.release(() => {
        if (restored) return;
        if (original) Object.defineProperty(document, 'execCommand', original);
        else delete document.execCommand;
        restored = true;
      });
      Object.defineProperty(document, 'execCommand', { configurable: true, writable: true,
        value: function(command, showUI, text) {
          return f.http.check(() => {
            assert.equal(this === document, true, 'editing receiver is the current document');
            assert.equal(command === 'insertText' || command === 'delete', true, 'only the declared external editing ports');
            assert.equal(showUI, false);
            assert.equal(typeof text, 'string');
            if (command === 'delete') assert.equal(text, '');
            const editor = document.activeElement;
            assert.equal(editor instanceof window.HTMLTextAreaElement, true, 'the actual textarea owns editing');
            commands.push({ command, showUI, text, start: editor.selectionStart, end: editor.selectionEnd });
            if (!editingSupported) return false;
            editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
            editor.dispatchEvent(new window.Event('input', { bubbles: true }));
            return true;
          });
        },
      });
    } });
    const handle = c.api.current;
    const settleInput = () => act(async () => { await handle.whenSettled(); });
    const originalTextarea = c.ta;

    await click(c.view, c.view.container.querySelector('.model-selector > button'));
    const filter = c.view.container.querySelector('input[aria-label="Filter models…"]');
    assert.equal(filter !== null, true, 'the actual 12-model picker exposes its filter');
    const setFilterValue = Object.getOwnPropertyDescriptor(c.view.window.HTMLInputElement.prototype, 'value').set;
    await act(async () => { setFilterValue.call(filter, ' RELAY-FIXTURE/model-11 '); });
    await c.view.dispatch(filter, new c.view.window.Event('input', { bubbles: true }));
    const options = [...c.view.container.querySelectorAll('[role="listbox"] [role="option"]')];
    assert.equal(options.length, 1, 'literal qualified query has exactly one real option');
    assert.equal(options[0].textContent.includes('Fixture model 11'), true);
    assert.equal(c.view.container.querySelector('input[aria-label="Filter models…"]') === filter, true);
    assert.equal(c.view.container.querySelector('textarea') === originalTextarea, true);
    assert.equal(selections.length, 0, 'filtering never selects a synthetic provider');
    await click(c.view, c.view.container.querySelector('.model-selector > button'));

    const prepare = async text => {
      await inputText(c.view, c.ta, text);
      await act(async () => { c.ta.focus(); c.ta.setSelectionRange(text.length, text.length); });
    };
    const lineBreak = async () => {
      const event = new c.view.window.InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertLineBreak', isComposing: false,
      });
      await c.view.dispatch(c.ta, event);
      await settleInput();
      return event.defaultPrevented;
    };
    // Literal browser vectors. A null plan deliberately leaves DOM text alone:
    // jsdom has no native default newline action. The browser keeps that bridge.
    for (const [before, after, edit] of [
      ['9. ninth', '9. ninth\n10. ', { command: 'insertText', start: 8, end: 8, text: '\n10. ' }],
      ['- [x] finished', '- [x] finished\n- [ ] ', { command: 'insertText', start: 14, end: 14, text: '\n- [ ] ' }],
      ['1. first\n2. ', '1. first\n', { command: 'delete', start: 9, end: 12, text: '' }],
      ['```\n- code', null, null],
      ['    - indented code', null, null],
    ]) {
      await prepare(before);
      const start = commands.length;
      const prevented = await lineBreak();
      assert.equal(prevented, edit !== null, `${inputId}: beforeinput decision for ${JSON.stringify(before)}`);
      assert.equal(commands.length - start, edit === null ? 0 : 1, 'one declared edit or native default');
      if (edit !== null) {
        assert.equal(commands[start].command, edit.command);
        assert.equal(commands[start].showUI, false);
        assert.equal(commands[start].start, edit.start);
        assert.equal(commands[start].end, edit.end);
        assert.equal(commands[start].text, edit.text);
        assert.equal(c.ta.value, after);
      } else {
        assert.equal(c.ta.value, before, 'no fake native default action');
      }
      assert.equal(sends.length, 0);
      assert.equal(c.view.container.querySelector('textarea') === originalTextarea, true);
    }

    await prepare('1. unsupported command');
    editingSupported = false;
    const fallbackStart = commands.length;
    assert.equal(await lineBreak(), false, 'a false external edit result cannot swallow the native newline');
    assert.equal(commands.length - fallbackStart, 1);
    assert.equal(commands[fallbackStart].command, 'insertText');
    assert.equal(commands[fallbackStart].showUI, false);
    assert.equal(commands[fallbackStart].text, '\n2. ');
    assert.equal(commands[fallbackStart].start, 22);
    assert.equal(commands[fallbackStart].end, 22);
    assert.equal(c.ta.value, '1. unsupported command', 'native default insertion is not simulated');
    editingSupported = true;

    await prepare('1. composition');
    await c.view.dispatch(c.ta, new c.view.window.CompositionEvent('compositionstart', { bubbles: true }));
    const imeStart = commands.length;
    assert.equal(await lineBreak(), false, 'composition ref wins even when InputEvent.isComposing is false');
    assert.equal(commands.length, imeStart, 'IME confirmation never invokes external list editing');
    assert.equal(c.ta.value, '1. composition');
    await c.view.dispatch(c.ta, new c.view.window.CompositionEvent('compositionend', { bubbles: true }));
    await settleInput();
    assert.equal(sends.length, 0);
    assert.equal(selections.length, 0);
    // Key choice, native undo/redo/selected replacement and phone focus/IME
    // geometry remain in the installed browser. No persistence case is reopened.
  });
}

});
