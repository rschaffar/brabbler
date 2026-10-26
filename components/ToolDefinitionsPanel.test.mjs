import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("./ToolDefinitionsPanel.tsx", import.meta.url), "utf8");
const systemSource = await readFile(new URL("./SystemPromptPanel.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const buttonsSource = await readFile(new URL("./SessionSystemInfoButtons.tsx", import.meta.url), "utf8");
// Structural declarations only; runtime controls and physical layout have their
// mounted/native owners. Failed guards display booleans, not whole source files.
const match = (source, pattern) => assert.equal(pattern.test(source), true, `required declaration: ${pattern.source.slice(0, 480)}`);
const doesNotMatch = (source, pattern) => assert.equal(pattern.test(source), false, `excluded declaration: ${pattern.source.slice(0, 480)}`);

test("keeps System and Tools in separate adjacent toolbar actions", () => {
  match(appShellSource, /import \{ SessionSystemInfoButtons \} from "\.\/SessionSystemInfoButtons"/);
  match(appShellSource, /systemInfoControls=\{<SessionSystemInfoButtons[\s\S]*?handleSystemInfoToggle=\{handleSystemInfoToggle\}/);
  match(buttonsSource, /handleSystemInfoToggle\("system"\)[\s\S]*?handleSystemInfoToggle\("tools"\)/);
  match(appShellSource, /activeTopPanel === "system"[\s\S]*?<SystemPromptPanel/);
  match(appShellSource, /activeTopPanel === "tools"[\s\S]*?<ToolDefinitionsPanel/);
  doesNotMatch(systemSource, /ToolEntry|tools/);
  doesNotMatch(systemSource, /system-prompt-heading/);
  doesNotMatch(panelSource, /tool-definitions-heading/);
});

test("keeps master-detail layout declarations", () => {
  match(panelSource, /className="tool-definitions-sidebar"/);
  match(panelSource, /className="tool-definition-detail"/);
  match(panelSource, /grid-template-columns: clamp\(112px, 26%, 220px\) minmax\(0, 1fr\)/);
});

test("preserves the two-column layout on narrow screens", () => {
  match(
    panelSource,
    /@media \(max-width: 640px\)[\s\S]*?\.tool-definitions-panel \{[\s\S]*?grid-template-columns: 112px minmax\(0, 1fr\)/,
  );
  doesNotMatch(panelSource, /@media \(max-width: 640px\)[\s\S]*?\.tool-definitions-panel \{[\s\S]*?display: block/);
});
