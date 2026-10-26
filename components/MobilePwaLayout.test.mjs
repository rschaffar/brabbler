import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { composerFixture, inputText } from "./composer.fixture.mjs";

const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const settingsCssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const customPanelSource = await readFile(new URL("./ExtensionCustomPanel.tsx", import.meta.url), "utf8");

test("configures iOS standalone mode to use the full screen", () => {
  assert.match(layoutSource, /statusBarStyle: "black-translucent"/);
  assert.match(layoutSource, /viewportFit: "cover"/);
  assert.match(layoutSource, /interactiveWidget: "resizes-content"/);
  assert.match(cssSource, /@media \(display-mode: standalone\) \{[\s\S]*?--app-viewport-height: 100vh;/);
});

test("safe-area and dynamic viewport presentation declarations remain connected to their CSS variables", () => {
  assert.match(appShellSource, /paddingTop: "env\(safe-area-inset-top\)"/);
  assert.match(appShellSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
  assert.match(appShellSource, /paddingLeft: "env\(safe-area-inset-left\)"/);
  assert.match(appShellSource, /paddingRight: "env\(safe-area-inset-right\)"/);
  assert.match(appShellSource, /height: "calc\(36px \+ env\(safe-area-inset-top\)\)"/);
  assert.match(appShellSource, /\/\* Right panel tab bar \*\/[\s\S]*?height: "calc\(36px \+ env\(safe-area-inset-top\)\)"/);
  assert.match(appShellSource, /height: "var\(--app-viewport-height, 100dvh\)"/);
  assert.match(cssSource, /height: var\(--app-viewport-height, 100dvh\)/);
  assert.match(cssSource, /left: env\(safe-area-inset-left\)/);
  assert.match(chatWindowSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
});

test("contains chat content and inputs within the mobile viewport", () => {
  assert.match(cssSource, /\.markdown-body \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/);
  assert.match(cssSource, /\.markdown-code-block \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/);
  assert.match(chatWindowSource, /overflow-x-hidden overflow-y-auto/);
  assert.match(customPanelSource, /maxHeight: "min\(760px, 100%\)"/);
  assert.match(chatWindowSource, /<ExtensionCustomPanel\b/);
});

test("prevents iOS focus zoom from widening the layout", () => {
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?textarea,[\s\S]*?input,[\s\S]*?select \{\s*font-size: 16px !important;/);
});

test("keeps modal dialogs clear of the iOS status bar in standalone mode", () => {
  assert.match(settingsCssSource, /@supports \(-webkit-touch-callout: none\) \{[\s\S]*?@media \(display-mode: standalone\) \{/);
  assert.match(settingsCssSource, /padding-top: max\(59px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(8px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(24px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(8px, env\(safe-area-inset-left\)\);/);
  assert.match(settingsCssSource, /@media \(display-mode: standalone\) and \(orientation: landscape\) \{[\s\S]*?padding-top: max\(8px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(59px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(8px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(59px, env\(safe-area-inset-left\)\);/);
  assert.match(settingsCssSource, /\.settings-dialog-surface,[\s\S]*?\.config-panel-root\.is-modal > \.config-panel-surface \{[\s\S]*?max-width: 100%;[\s\S]*?max-height: 100%;/);
});

for (const mobile of [false, true]) for (const busy of [false, true]) for (const callbacks of [false, true]) {
  test(`actual composer keeps its editor and action layout mobile=${mobile} busy=${busy} queue=${callbacks}`, async t => {
    const f = composerFixture(t, { mobile }), c = await f.input({ isStreaming: busy,
      onSteer: callbacks ? () => {} : undefined, onFollowUp: callbacks ? () => {} : undefined });
    await inputText(c.view, c.ta, 'draft remains');
    const stacked = mobile && busy && callbacks;
    assert.equal(c.ta.style.width, '100%'); assert.equal(c.ta.style.minWidth, '0');
    assert.equal(c.ta.parentElement.style.flexDirection, stacked ? 'column' : 'row');
    assert.equal(c.ta.style.flex, stacked ? '0 0 auto' : '1 1 0%');
    await c.update({ isStreaming: !busy });
    assert.equal(c.view.container.querySelector('textarea') === c.ta, true);
    assert.equal(c.ta.value, 'draft remains');
  });
}
