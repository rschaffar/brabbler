import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const askUserSource = await readFile(new URL("./AskUserDialog.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./BlockingCard.tsx", import.meta.url), "utf8");
const minimapSource = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const dialogSource = source.slice(source.indexOf("function ExtensionDialog"), source.indexOf("type ExtensionCustomRequest"));
const customSource = source.slice(source.indexOf("function ExtensionCustomPanel"));

test("renders every blocking question inline at the live tail of the chat scroller", () => {
  assert.match(source, /ref=\{scrollContainerRef\}[\s\S]*?ref=\{questionCardRef\}[\s\S]*?<AskUserDialog[\s\S]*?<ExtensionDialog[\s\S]*?<ChatMinimap/);
  assert.match(source, /return followBlockingCard\(container, card, questionFollowRef\.current\)/);
  assert.match(source, /questionFollowRef\.current\?\.id !== questionId/);
  assert.match(source, /\[questionId, loading, covered, scrollContainerRef\]/);
  assert.doesNotMatch(dialogSource, /position: "absolute"|pointerEvents: "none"|aria-modal/);
  assert.doesNotMatch(askUserSource, /position: "absolute"|pointerEvents: "none"|aria-modal/);
  assert.match(dialogSource, /<BlockingCard title=\{request.title\}/);
  assert.match(askUserSource, /<BlockingCard title=\{request.question\}/);
  assert.match(shellSource, /role="group" aria-label=\{title\} aria-labelledby=\{titleId\}/);
  assert.match(customSource, /position: "absolute"[\s\S]*?inset: 0/);
});

test("minimap navigation relinquishes live-card follow, including unrevealed history", () => {
  assert.match(source, /onNavigate=\{stopQuestionFollow\}/);
  assert.match(source, /const stopQuestionFollow = useCallback\(\(\) => \{\s*if \(questionFollowRef\.current\) questionFollowRef\.current\.following = false/);
  assert.match(source, /const revealHistoryForMinimap = useCallback\(\(\) => \{\s*stopQuestionFollow\(\)/);
  assert.match(minimapSource, /const lockActiveNode = useCallback\(\(index: number\) => \{\s*onNavigate\?\.\(\)/);
});

test("keeps collapse and cancel available inside the cards", () => {
  assert.match(dialogSource, /setCollapsed\(true\)/);
  assert.match(shellSource, /chat\.extensionCollapse/);
  assert.match(dialogSource, /chat\.cancel/);
  assert.match(askUserSource, /setCollapsed\(true\)/);
  assert.match(askUserSource, /chat\.cancel/);
  assert.match(source, /<ExtensionDialog key=\{extensionDialog.id\}/);
  assert.match(source, /<AskUserDialog key=\{extensionDialog.id\}/);
});

test("preserves extension question markdown and keyboard navigation", () => {
  assert.match(source, /import \{ MarkdownBody \} from "\.\/MarkdownBody"/);
  assert.match(dialogSource, /<MarkdownBody>\{request\.message\}<\/MarkdownBody>/);
  assert.match(dialogSource, /role="button"[\s\S]*?data-extension-option[\s\S]*?<div inert>[\s\S]*?<MarkdownBody>\{option\}<\/MarkdownBody>/);
  assert.match(dialogSource, /ref=\{index === 0 \? focusFirstOption : undefined\}/);
  assert.match(shellSource, /id=\{titleId\} className="blocking-card-title">\{title\}/);
  assert.match(css, /\.blocking-card-title[^\n]*white-space: pre-wrap; overflow-wrap: anywhere/);
  assert.match(css, /\.blocking-card-header[^\n]*max-height: min\(180px, 22dvh\); overflow-y: auto/);
  assert.match(css, /\.blocking-card-body[^\n]*min-height: 0; overflow-y: auto/);
  assert.match(css, /\.blocking-card-footer[^\n]*flex-shrink: 0/);
});
