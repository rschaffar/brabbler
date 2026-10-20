import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const settingsPanel = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatAppearanceHook = await readFile(new URL("../hooks/useChatAppearance.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const { clampChatContentWidth, clampChatContentFontSize } = await jiti.import("../hooks/useChatAppearance.ts");

const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

const widthVariable = /var\(--chat-content-max-width, none\)/g;

test("chat content defaults to full available width behind one shared variable", () => {
  assert.equal((chatWindow.match(widthVariable) ?? []).length, 2);
  assert.equal((chatInput.match(widthVariable) ?? []).length, 1);
  assert.match(globals, /--chat-content-max-width: none;/);
  assert.match(chatAppearanceHook, /fullWidth: true/);
  assert.match(chatAppearanceHook, /fullWidth \? "none" : `\$\{width\}px`/);
  assert.doesNotMatch(chatWindow, /max-w-\[820px\]|maxWidth: 820/);
  assert.doesNotMatch(chatInput, /maxWidth: 820/);
});

test("General chat settings own the chat width preference", () => {
  assert.match(chatInput, /useChatAppearance\(\)/);
  assert.match(settingsPanel, /useChatAppearance\(\)/);
  assert.match(settingsPanel, /type="range"/);
  assert.match(settingsPanel, /min=\{CHAT_CONTENT_WIDTH_MIN\}/);
  assert.match(settingsPanel, /max=\{CHAT_CONTENT_WIDTH_MAX\}/);
  assert.match(settingsPanel, /step=\{10\}/);
  assert.match(chatAppearanceHook, /pi-chat-content-width/);
  assert.match(chatAppearanceHook, /localStorage\.setItem/);
});

test("the composer and Settings share a persisted full-width toggle", () => {
  assert.match(chatAppearanceHook, /pi-chat-content-full-width/);
  assert.match(chatAppearanceHook, /readStoredPreference\(CHAT_CONTENT_FULL_WIDTH_STORAGE_KEY\) !== "false"/);
  assert.match(chatInput, /aria-label=\{fullWidth \? t\("chat.useReadingWidth"\) : t\("chat.useFullWidth"\)\}/);
  assert.match(settingsPanel, /<span>\{t\("settings.chatFullWidth"\)\}<\/span>/);
  assert.match(chatInput, /onClick=\{\(\) => setFullWidth\(!fullWidth\)\}/);
  assert.match(settingsPanel, /checked=\{fullWidth\}/);
  assert.match(settingsPanel, /onChange=\{setFullWidth\}/);
});

test("chat width validation preserves the default and supported range", () => {
  assert.equal(clampChatContentWidth(undefined), 820);
  assert.equal(clampChatContentWidth("invalid"), 820);
  assert.equal(clampChatContentWidth(700), 820);
  assert.equal(clampChatContentWidth(1104), 1104);
  assert.equal(clampChatContentWidth(2400), 2000);
});

test("AppShell restores fonts independently and existing drafts remeasure family and weight changes", () => {
  assert.match(appShell, /useFontPreferences\(\);/);
  assert.match(chatInput, /useLayoutEffect\(resizeTextarea, \[value, fontSize, uiFontFamily, uiWeight, resizeTextarea\]\)/);
  assert.match(globals, /--font-mono-default: var\(--font-noto-mono\)/);
  assert.match(globals, /\.git-diff-code-view diffs-container \{[^}]*--diffs-font-family: var\(--font-mono\)[^}]*font-weight: var\(--font-mono-weight\)/);
  assert.match(globals, /\.markdown-body :is\(h1, h2, h3, h4, h5, h6, strong, b\) code \{\s*font-weight: inherit/);
});

test("chat font size preserves the default and bounds stored or supplied values", () => {
  for (const value of [undefined, null, "invalid", Infinity, NaN]) {
    assert.equal(clampChatContentFontSize(value), 14);
  }
  assert.equal(clampChatContentFontSize(8), 12);
  assert.equal(clampChatContentFontSize("18"), 18);
  assert.equal(clampChatContentFontSize(18.7), 19);
  assert.equal(clampChatContentFontSize(30), 24);
});
