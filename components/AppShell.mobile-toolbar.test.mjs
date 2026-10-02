import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const mobileHookSource = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("centers top-bar overview icons, including the block-level Git SVG", () => {
  const rule = styles.match(/\.activity-top-button\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /display:\s*flex/);
  assert.match(rule, /align-items:\s*center/);
  assert.match(rule, /justify-content:\s*center/);
  assert.match(rule, /padding:\s*0/);
  assert.match(source, /className="activity-top-button" aria-label="Git Explorer"/);
});

test("shows the selected session title and project beneath the mobile toolbar only in chat", () => {
  assert.match(source, /selectedSession\.name \|\| \(skillExpansionToCommand\(selectedSession\.firstMessage\) \?\? selectedSession\.firstMessage\)\.slice\(0, 50\) \|\| selectedSession\.id\.slice\(0, 12\)/);
  assert.match(source, /: translate\("i18n\.newSession"\)/);
  assert.match(source, /selectedSession\?\.projectRoot \?\? selectedSession\?\.cwd \?\? effectiveNewSessionCwd/);
  assert.match(source, /\{isMobile && showChat && !\(activeOverview && overviewMobileList\) && \([\s\S]*?data-mobile-session-identity="true"[\s\S]*?mobile-session-title[\s\S]*?mobile-session-project/);
  assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.mobile-session-title,\s*\.mobile-session-project \{[\s\S]*?text-overflow: ellipsis/);
});

test("keeps action icons inline in medium mobile sidebars", () => {
  assert.match(mobileHookSource, /NARROW_MOBILE_QUERY = "\(max-width: 480px\)"/);
  assert.match(source, /const isNarrowMobile = useIsNarrowMobile\(\);/);
  assert.match(source, /\{!isNarrowMobile && renderChatToolbarActions\(true\)\}/);
  assert.match(source, /\{isNarrowMobile && \([\s\S]*?data-mobile-toolbar-more="true"/);
});

test("uses a compact narrow-mobile toolbar with a floating action layer", () => {
  assert.match(source, /data-mobile-toolbar="true"[\s\S]*?flex: 1,[\s\S]*?minWidth: 0/);
  assert.match(
    source,
    /data-mobile-toolbar-actions="true"[\s\S]*?position: "absolute"[\s\S]*?right: 0,[\s\S]*?left: TOP_BAR_ICON_BUTTON_SIZE/,
  );

  for (const action of ["history", "name", "agents", "branches", "system", "tools"]) {
    assert.match(source, new RegExp(`data-mobile-toolbar-action=(?:\\{mobile \\? )?"${action}"`));
  }
});

test("shows a persistent subagent marker in the chat toolbar, outside the mobile overflow menu", () => {
  assert.match(source, /\{showChat && selectedSession\?\.relation\?\.kind === "subagent" && \([\s\S]*?role="img" aria-label=\{translate\("activity.subagent"\)\}[\s\S]*?<SubagentIcon size=\{16\} \/>/);
  assert.match(source, /<SubagentIcon size=\{16\} \/>[\s\S]*?\{isMobile && !\(activeOverview && overviewMobileList\) && \([\s\S]*?ref=\{mobileToolbarRef\}/);
});

test("only renders the Agents switcher when the active session family has subagents", () => {
  assert.match(source, /const hasSubagentSessions = Boolean\(activeSessionFamily\?\.subagents\.length\)/);
  assert.match(source, /\{hasSubagentSessions && \(\s*<button[\s\S]*?toggleTopPanel\("agents", mobile\)/);
  assert.match(source, /activeTopPanel === "agents" && activeSessionFamily && selectedSession/);
});

test("keeps the Agents panel open while switching sessions and positions it at the left", () => {
  assert.match(source, /const AGENT_PANEL_WIDTH = 420/);
  assert.match(
    source,
    /if \(activeTopPanel === "agents"\)[\s\S]*?left: topBarRect\.left[\s\S]*?width: Math\.min\(AGENT_PANEL_WIDTH, topBarRect\.width\)/,
  );
  assert.match(source, /<AgentSessionPanel[\s\S]*?onSelectSession=\{handleSelectSession\}/);
});

test("only renders branch toolbar controls for sessions with branches", () => {
  assert.match(source, /const sessionHasBranches = hasSessionBranches\(branchTree\)/);
  assert.match(source, /\{sessionHasBranches && \(mobile \? \(/);
  assert.match(source, /\{isMobile && sessionHasBranches && \(/);
  assert.match(source, /panel === "branches" \? null : panel/);
});

test("keeps covered statistics and file controls out of interaction and focus", () => {
  assert.match(source, /const covered = mobile && isNarrowMobile && mobileToolbarMoreOpen;/);
  assert.match(source, /disabled=\{!showChat \|\| covered\}[\s\S]*?tabIndex=\{covered \? -1 : undefined\}/);
  assert.match(source, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}[\s\S]*?visibility: covered \? "hidden" : "visible"/);
  assert.match(source, /aria-hidden=\{covered \? true : undefined\}/);
});

test("closes the mobile action layer on outside click, Escape, layout changes, and session changes", () => {
  assert.match(source, /event\.composedPath\(\)\.includes\(toolbar\)/);
  assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown, true\)/);
  assert.match(source, /event\.key !== "Escape"[\s\S]*?setMobileToolbarMoreOpen\(false\)/);
  assert.match(source, /\}, \[isMobile, isNarrowMobile, selectedSession\?\.id, newSessionDraftId\]\);/);
});

test("keeps the mobile action layer open after using an expanded action", () => {
  const toggleTopPanel = source.match(/const toggleTopPanel = useCallback\([\s\S]*?\n  \}, \[isMobile, isNarrowMobile\]\);/)?.[0];
  const historyHandler = source.match(/onClick=\{\(\) => \{[\s\S]*?handleViewFullHistory\(\);[\s\S]*?\n          \}\}/)?.[0];
  const autoNameHandler = source.match(/onClick=\{\(\) => \{[\s\S]*?void handleAutoName\(\);[\s\S]*?\n              \}\}/)?.[0];

  for (const handler of [toggleTopPanel, historyHandler, autoNameHandler]) {
    assert.ok(handler);
    assert.doesNotMatch(handler, /setMobileToolbarMoreOpen\(false\)/);
    assert.match(handler, /setMobileToolbarMoreOpen\(true\)/);
  }

  assert.match(source, /toggleTopPanel\("branches", true\)/);
  assert.match(source, /handleSystemInfoToggle\("system", mobile\)/);
  assert.match(source, /handleSystemInfoToggle\("tools", mobile\)/);
  assert.match(source, /onClick=\{\(\) => toggleTopPanel\("session"\)\}/);
});

test("keeps theme and language in settings instead of the chat toolbar", () => {
  assert.doesNotMatch(source, /renderThemeButton/);
  assert.doesNotMatch(source, /renderLanguageButton/);
  assert.doesNotMatch(source, /toggleTopPanel\("language"/);
  assert.doesNotMatch(source, /data-mobile-toolbar-action=\{mobile \? "theme"/);
  assert.doesNotMatch(source, /data-mobile-toolbar-action=\{mobile \? "language"/);
  assert.match(source, /import \{ useTheme \} from "@\/hooks\/useTheme"/);
  assert.match(source, /useTheme\(\);/);
});

test("prioritizes context and cost when the mobile statistics area narrows", () => {
  assert.match(source, /\.mobile-session-stats \{[\s\S]*?container-type: inline-size/);
  assert.match(source, /@container \(max-width: 158px\)[\s\S]*?\.mobile-session-stat-io/);
  assert.match(source, /@container \(max-width: 88px\)[\s\S]*?\.mobile-session-stat-cost/);
  assert.match(source, /mobileContextText = percent !== null \? `\$\{percent\.toFixed\(0\)\}%` : null/);
});

test("places trust warnings below the mobile toolbar and the file toggle in toolbar flow", () => {
  assert.match(source, /\{isMobile && !\(activeOverview && overviewMobileList\) && renderProjectTrustWarning\(true\)\}/);
  assert.match(source, /data-mobile-trust-banner=\{mobileBanner \? "true" : undefined\}/);
  assert.doesNotMatch(source, /File panel toggle — always visible at top-right/);
  assert.doesNotMatch(source, /position: "fixed", top: "env\(safe-area-inset-top\)"/);
});

test("closes top-bar dropdowns when the file panel expands to full width", () => {
  assert.match(
    source,
    /const handleRightPanelExpandToggle = useCallback\(\(\) => \{\s*setActiveTopPanel\(null\);\s*setRightPanelExpanded\(\(expanded\) => !expanded\);/,
  );
  assert.match(source, /onClick=\{handleRightPanelExpandToggle\}/);
  assert.match(source, /if \(rightPanelFullWidth\) setActiveTopPanel\(null\);/);
});
