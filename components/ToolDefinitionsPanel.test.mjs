import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("./ToolDefinitionsPanel.tsx", import.meta.url), "utf8");
const systemSource = await readFile(new URL("./SystemPromptPanel.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("keeps System and Tools in separate adjacent toolbar actions", () => {
  assert.match(appShellSource, /handleSystemInfoToggle\("system"\)[\s\S]*?handleSystemInfoToggle\("tools"\)/);
  assert.match(appShellSource, /activeTopPanel === "system"[\s\S]*?<SystemPromptPanel/);
  assert.match(appShellSource, /activeTopPanel === "tools"[\s\S]*?<ToolDefinitionsPanel/);
  assert.doesNotMatch(systemSource, /ToolEntry|tools/);
  assert.doesNotMatch(systemSource, /system-prompt-heading/);
  assert.doesNotMatch(panelSource, /tool-definitions-heading/);
});

test("keeps master-detail layout declarations", () => {
  assert.match(panelSource, /className="tool-definitions-sidebar"/);
  assert.match(panelSource, /className="tool-definition-detail"/);
  assert.match(panelSource, /grid-template-columns: clamp\(112px, 26%, 220px\) minmax\(0, 1fr\)/);
});

test("preserves the two-column layout on narrow screens", () => {
  assert.match(
    panelSource,
    /@media \(max-width: 640px\)[\s\S]*?\.tool-definitions-panel \{[\s\S]*?grid-template-columns: 112px minmax\(0, 1fr\)/,
  );
  assert.doesNotMatch(panelSource, /@media \(max-width: 640px\)[\s\S]*?\.tool-definitions-panel \{[\s\S]*?display: block/);
});
