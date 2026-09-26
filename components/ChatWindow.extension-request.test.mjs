import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const askUserSource = await readFile(new URL("./AskUserDialog.tsx", import.meta.url), "utf8");
const dialogSource = source.slice(source.indexOf("function ExtensionDialog"), source.indexOf("type ExtensionCustomRequest"));
const customSource = source.slice(source.indexOf("function ExtensionCustomPanel"));

test("renders every blocking question inline at the live tail of the chat scroller", () => {
  assert.match(source, /ref=\{scrollContainerRef\}[\s\S]*?ref=\{questionCardRef\}[\s\S]*?<AskUserDialog[\s\S]*?<ExtensionDialog[\s\S]*?ref=\{promptAnchorSpacerRef\}/);
  assert.match(source, /questionCardRef\.current\?\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.doesNotMatch(dialogSource, /position: "absolute"|pointerEvents: "none"|aria-modal/);
  assert.doesNotMatch(askUserSource, /position: "absolute"|pointerEvents: "none"|aria-modal/);
  assert.match(dialogSource, /role="group"/);
  assert.match(askUserSource, /role="group"/);
  assert.match(customSource, /position: "absolute"[\s\S]*?inset: 0/);
});

test("keeps collapse and cancel available inside the cards", () => {
  assert.match(dialogSource, /setCollapsed\(true\)/);
  assert.match(dialogSource, /chat\.extensionCollapse/);
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
  assert.match(dialogSource, /whiteSpace: "pre-wrap", overflowWrap: "anywhere" \}\}>\{request\.title\}/);
  assert.match(dialogSource, /maxHeight: "50%", overflowY: "auto"/);
});
