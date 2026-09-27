import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
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

test("keeps the sidebar toggle fixed and puts all mobile actions in a swipeable row", () => {
  const sidebar = source.indexOf("onClick={handleSidebarToggle}");
  const strip = source.indexOf('ref={topBarActionsRef}');
  const activity = source.indexOf('className="activity-top-button"', strip);
  const gitExplorer = source.indexOf('aria-label="Git Explorer"', strip);
  const workflow = source.indexOf('aria-label="Workflow"', strip);
  const toolbar = source.indexOf('data-mobile-toolbar="true"', strip);
  const stripEnd = source.indexOf("</div>\n          {isMobile && sessionHasBranches", toolbar);
  assert.ok(sidebar >= 0 && sidebar < strip && strip < activity && activity < gitExplorer && gitExplorer < workflow && workflow < toolbar && toolbar < stripEnd);
  assert.match(source.slice(toolbar, stripEnd), /renderChatToolbarActions\(true\)[\s\S]*renderSessionStatsButton\(true\)[\s\S]*renderMainFileToggle\(true\)/);
  assert.match(styles, /\.top-bar-actions \{ display: contents; \}/);
  assert.match(styles, /@media \(max-width: 640px\) \{\s*\.top-bar-actions \{[\s\S]*?overflow-x: auto;[\s\S]*?scrollbar-width: none;/);
  assert.match(styles, /\.top-bar-actions::-webkit-scrollbar \{ display: none; \}/);
  assert.match(source, /onScroll=\{updateTopBarScrollEdges\}/);
  assert.match(source, /strip\.scrollLeft \+ strip\.clientWidth < strip\.scrollWidth - 1/);
  assert.match(styles, /\.top-bar-actions\.has-more-right \{[\s\S]*?--edge-mask: linear-gradient/);
  assert.doesNotMatch(source, /data-mobile-toolbar-more|data-mobile-toolbar-actions/);

  for (const action of ["history", "name", "agents", "branches", "system", "tools"]) {
    assert.match(source, new RegExp(`data-mobile-toolbar-action=(?:\\{mobile \\? )?"${action}"`));
  }
});

test("shows the subagent marker in the scrolling toolbar", () => {
  assert.match(source, /\{showChat && selectedSession\?\.relation\?\.kind === "subagent" && \([\s\S]*?role="img" aria-label=\{translate\("activity.subagent"\)\}[\s\S]*?<SubagentIcon size=\{16\} \/>/);
  assert.match(source, /<SubagentIcon size=\{16\} \/>[\s\S]*?\{isMobile && !\(activeOverview && overviewMobileList\) && \(/);
});

test("only renders the Agents switcher when the active session family has subagents", () => {
  assert.match(source, /const hasSubagentSessions = Boolean\(activeSessionFamily\?\.subagents\.length\)/);
  assert.match(source, /\{hasSubagentSessions && \(\s*<button[\s\S]*?toggleTopPanel\("agents"\)/);
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

test("keeps statistics and file controls reachable without the narrow-phone action overlay", () => {
  assert.match(source, /data-mobile-toolbar-stats=\{mobile \? "true" : undefined\}[\s\S]*?flex: mobile \? "0 0 110px" : undefined/);
  assert.match(source, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
  assert.match(source, /onClick=\{\(\) => toggleTopPanel\("session"\)\}/);
  assert.doesNotMatch(source, /mobileToolbarMoreOpen|setMobileToolbarMoreOpen/);
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
