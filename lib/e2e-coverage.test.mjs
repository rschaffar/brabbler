import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { browserInputs, createCoverage, groups, scenarios, selectGroup, validateInventory } from "../e2e/scenarios.mjs";

// Independent inventory transcribed from the reviewed 34ac894 browser suite,
// NOT generated from scenarios/groups. A row represents an indivisible old
// assertion chain; inputs distinguish locale, storage, height and fresh context.
const oldCoverage = {
  state: ["api-append-accounts@service", "agents-reload@default", "durable-account@default"],
  history: ["reading-chain@legacy-desktop", "reading-chain@legacy-mobile"],
  "extension-dialogs": ["full@legacy-desktop", "full@legacy-mobile"],
  "mobile-sidebar": ["archive-search-restore-move@legacy-mobile"],
  worktrees: ["full@en-desktop", "full@en-mobile-tall"],
  "session-launch": ["full@en-desktop", "full@en-mobile-tall"],
  "running-forks": ["full@en-desktop", "full@en-mobile-tall"],
  "model-speed": ["exercise@en-desktop", "fresh@en-desktop", "exercise@en-mobile-tall", "fresh@en-mobile-tall"],
  trust: ["full@en-desktop", "full@en-mobile-tall"],
  "git-plugin": ["full@en-desktop", "full@en-mobile-tall"],
  appearance: ["full@numeric-wide", "full@legacy-desktop"],
  timestamps: ["full@en-desktop", "full@en-mobile-tall", "full@legacy-desktop", "full@legacy-mobile"],
  "diff-context": ["explorer-then-merge@legacy-desktop"],
  markdown: ["preview-then-line-links@legacy-desktop", "preview-then-line-links@legacy-mobile"],
  "file-edit": ["panel-diff-edit@legacy-desktop", "panel-diff-edit@legacy-mobile"],
  archive: ["inline-restore@legacy-mobile"],
  privacy: ["full@legacy-desktop", "full@legacy-tablet", "full@legacy-mobile"],
  activity: ["worktree-interruption-subagents@legacy-desktop", "worktree-interruption-subagents@legacy-tablet", "worktree-interruption-subagents@legacy-mobile"],
  accounts: ["created-deleted@legacy-desktop", "created-deleted@legacy-mobile", "shared-device@en-desktop", "shared-device@en-mobile-short"],
  questions: ["registration-and-dialog@legacy-desktop", "registration-and-dialog@legacy-mobile"],
  "session-links": ["copy-follow@legacy-desktop", "copy-follow@legacy-mobile"],
  bulk: ["archive-restore-delete@legacy-desktop", "archive-restore-delete@legacy-mobile"],
  move: ["full-picker@legacy-desktop", "full-picker@legacy-mobile"],
};
const oldSelectors = {
  state: "E2E_STATE_ONLY", history: "E2E_HISTORY_ONLY", "extension-dialogs": "E2E_EXTENSION_DIALOGS_ONLY", "mobile-sidebar": "E2E_MOBILE_SIDEBAR_ONLY",
  worktrees: "E2E_WORKTREE_MANAGER_ONLY", "session-launch": "E2E_SESSION_LAUNCH_ONLY", "running-forks": "E2E_RUNNING_FORKS_ONLY", "model-speed": "E2E_MODEL_SPEED_ONLY",
  trust: "E2E_TRUST_ONLY", "git-plugin": "E2E_GIT_WORKFLOW_PLUGIN_ONLY", appearance: "E2E_CHAT_APPEARANCE_ONLY", timestamps: "E2E_TIMESTAMPS_ONLY",
  "diff-context": "E2E_DIFF_CONTEXT_ONLY", markdown: "E2E_MARKDOWN_ONLY", "file-edit": "E2E_FILE_EDIT_ONLY", archive: "E2E_ARCHIVE_ONLY",
  privacy: "E2E_PROJECT_PRIVACY_ONLY", activity: "E2E_ACTIVITY_ONLY", accounts: "E2E_ACCOUNT_ONLY", questions: "E2E_ASK_USER_ONLY",
  "session-links": "E2E_SESSION_LINK_ONLY", bulk: "E2E_BULK_ONLY", move: "E2E_MOVE_ONLY",
};
const expectedScenarios = Object.fromEntries(Object.entries(oldCoverage).map(([owner, chains]) => [owner, chains.map(chain => `${owner}/${chain}`)]));
const source = readFileSync(new URL("../e2e/browser-suite.mjs", import.meta.url), "utf8");
const files = readFileSync(new URL("../e2e/file-panel.mjs", import.meta.url), "utf8");
const easyWins = readFileSync(new URL("../e2e/upstream-easy-wins.mjs", import.meta.url), "utf8");

function section(text, start, end) {
  const first = text.indexOf(start);
  assert.notEqual(first, -1, `Missing start: ${start}`);
  const last = text.indexOf(end, first + start.length);
  assert.notEqual(last, -1, `Missing end: ${end}`);
  return text.slice(first, last);
}
function branch(owner, next) {
  return section(source, `    if (group === "${owner}") {`, next ? `    if (group === "${next}") {` : '    assert.fail(`No browser scenario dispatch');
}
function ordered(text, needles) {
  let after = 0;
  for (const needle of needles) {
    const found = text.indexOf(needle, after);
    assert.notEqual(found, -1, `Missing/reordered baseline obligation: ${needle}`);
    after = found + needle.length;
  }
}
function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), "e2e-coverage-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const receiptAt = directory => JSON.parse(readFileSync(join(directory, "coverage.json"), "utf8"));

test("reviewed old acceptance union has one exact owner per scenario/input and no general aggregate", () => {
  assert.deepEqual(scenarios, { ...expectedScenarios, "ssh-agent": ["ssh-agent/webauthn-openssh@en-desktop", "ssh-agent/webauthn-openssh@en-mobile-tall"],
    "native-tools": ["native-tools/full@en-desktop", "native-tools/full@en-mobile-tall"] });
  assert.equal(Object.values(expectedScenarios).flat().length, 52);
  assert.equal(new Set(Object.values(scenarios).flat()).size, 56);
  const expectedGroups = Object.fromEntries(Object.entries(oldSelectors).map(([owner, selector]) => [owner, { suite: "browser", selector }]));
  expectedGroups.terminal = { suite: "terminal", selector: null };
  expectedGroups["ssh-agent"] = { suite: "browser", selector: "E2E_SSH_AGENT_ONLY" };
  expectedGroups["native-tools"] = { suite: "browser", selector: "E2E_NATIVE_TOOLS_ONLY" };
  assert.deepEqual(groups, expectedGroups);
  assert.equal(Object.keys(groups).length, 26);
  validateInventory();
  const duplicate = structuredClone(groups);
  duplicate.history.selector = duplicate.state.selector;
  assert.throws(() => validateInventory(duplicate), /Duplicate browser selector/);
  const unselected = structuredClone(groups);
  unselected.history.selector = null;
  assert.throws(() => validateInventory(unselected), /explicit selector/);
  assert.throws(() => validateInventory({ ...groups, general: { suite: "browser", selector: null } }), /owners/);
});

test("reviewed inputs preserve viewport heights, touch, locale and both legacy/fresh preferences", () => {
  assert.deepEqual(browserInputs, {
    default: { options: {} },
    "legacy-desktop": { options: { viewport: { width: 1280, height: 800 }, locale: "zh-CN", hasTouch: false, isMobile: false }, piLocale: "zh-CN" },
    "legacy-tablet": { options: { viewport: { width: 700, height: 800 }, locale: "zh-CN", hasTouch: false, isMobile: false }, piLocale: "zh-CN" },
    "legacy-mobile": { options: { viewport: { width: 390, height: 844 }, locale: "zh-TW", hasTouch: true, isMobile: true }, piLocale: "zh-TW" },
    "en-desktop": { options: { viewport: { width: 1280, height: 800 }, locale: "en-US", hasTouch: false, isMobile: false } },
    "en-mobile-tall": { options: { viewport: { width: 390, height: 844 }, locale: "en-US", hasTouch: true, isMobile: true } },
    "en-mobile-short": { options: { viewport: { width: 390, height: 600 }, locale: "en-US", hasTouch: true, isMobile: true } },
    "numeric-wide": { options: { viewport: { width: 2560, height: 1100 }, locale: "en-US" }, chatWidth: "820" },
  });
  ordered(source, ["const input = browserInputs[inputId]", "harness.newContext(browser, input.options, base)", "if (input.piLocale)", 'localStorage.setItem("pi-locale", locale)', "locale: input.piLocale, origin: base"]);
  const appearance = section(source, '} else if (group === "appearance") {', '} else if (group === "timestamps") {');
  ordered(appearance, ['["numeric-wide", "legacy-desktop"]', "newInputContext(inputId)", "page = await context.newPage()", "const errors = harness.errorsFor(context)", "if (browserInputs[inputId].chatWidth)", 'localStorage.getItem("pi-chat-content-width") === null', 'localStorage.setItem("pi-chat-content-width", "820")', "await page.goto", "await checkChatAppearance("]);
  assert.match(source, /group === "archive" \|\| group === "mobile-sidebar" \? \["legacy-mobile"\]/);
  assert.match(source, /group === "diff-context" \? \["legacy-desktop"\]/);
  assert.match(source, /group === "activity" \|\| group === "privacy" \? \["legacy-desktop", "legacy-tablet", "legacy-mobile"\]/);
  assert.match(source, /\["numeric-wide", "legacy-desktop"\]/);
  assert.match(source, /\["en-desktop", "en-mobile-tall", "legacy-desktop", "legacy-mobile"\]/);
  assert.match(source, /\["en-desktop", "en-mobile-short"\]/);
});

test("selector bijection rejects missing, unknown, multiple and non-one values before fixture effects", () => {
  for (const [owner, selector] of Object.entries(oldSelectors)) assert.equal(selectGroup({ [selector]: "1", E2E_BASE_URL: "http://127.0.0.1:30142" }), owner);
  assert.throws(() => selectGroup({}), /Exactly one/);
  for (const value of ["0", "", "true", undefined]) assert.throws(() => selectGroup({ E2E_HISTORY_ONLY: value }), /must equal 1/);
  for (const env of [{ E2E_UNKNOWN_ONLY: "1" }, { E2E_UNKNOWN_ONLY: "0", E2E_HISTORY_ONLY: "1" }]) assert.throws(() => selectGroup(env), /Unknown E2E selector/);
  for (const second of ["0", "1", ""]) assert.throws(() => selectGroup({ E2E_STATE_ONLY: "1", E2E_HISTORY_ONLY: second }), /Exactly one/);
  ordered(source, ["const group = selectGroup(process.env)", "process.umask", "const harness = createHarness", "createCoverage(group, artifacts)", "applyFixtureEnvironment", "mkdirSync(project)"]);
  assert.doesNotMatch(source, /process\.env\.E2E_[A-Z_]+_ONLY|Object\.keys\(process\.env\)\.some/);
  for (const owner of Object.keys(oldCoverage)) assert.ok(source.includes(`group === "${owner}"`), `Explicit dispatch missing: ${owner}`);
  ordered(source, ["assert.equal(base, harness.baseURL", "assert.equal(laneURL.protocol, \"http:\")", "assert.equal(laneURL.hostname, \"127.0.0.1\"", "assert.equal(laneURL.origin, base", "await harness.startService()"]);
  assert.doesNotMatch(source, /127\.0\.0\.1:30141/);
  ordered(source, ["coverage.finish();", "} catch (error)", "coverage?.fail(error)", "await harness.fail(error)", "} finally", "await harness.finish()"]);
});

test("state owns all API/account/APPEND assertions and the dependent AGENTS and durable idle-account footer", () => {
  const api = section(source, 'if (group === "state") await coverage.run("state/api-append-accounts@service"', '\n  browser = await harness.launchBrowser(chromium, process.env');
  ordered(api, [
    "detail.context.entryIds, ids(4950, 5000)", "detail.context.messages.length, 50", "detail.context.hasMore, true", "JSON.stringify(detail).length < 100_000",
    "tail.context.entryIds, ids(4950, 5000)", "selectedBranch.context.entryIds", "rootPage.context.hasMore, false", "beforeRoot.context.entryIds, []", "beforeRoot.context.hasMore, false",
    'api("/api/sessions/e2e-does-not-exist", 404)', 'api("/api/files/..%2F..%2Fetc%2Fpasswd?type=read", 403)', 'compacted.context.entryIds[0], "compact"', 'entry.role === "user"), false',
    'beforeAppend.context.entryIds, ["root", "reply"]', "appendFileSync(file", 'ordinaryRead.context.entryIds, ["root", "reply"]', "ordinaryRead.wrapperRebuilt, undefined",
    'afterForce.context.entryIds, ["root", "reply", "external"]', "afterForce.wrapperRebuilt, true", 'again.context.entryIds, ["root", "reply", "external"]', 'appended.context.entryIds, ["external"]',
    "unsupported.status, 400", "/OAuth account not found for provider/", "account.authorized, false", "secondaryAccountId = account.id", "JSON.stringify(metadata).includes(secret), false", "entry.id === account.id).authorized, true",
    'toolNames: ["read"]', "first.sessionId", "removedDefault.status, 200", '"existing sessions must retain their project-default snapshot"', "second.sessionId", "switched.status, 200", "switchedId", 'entry.name === "read")?.active, true', 'entry.name === "bash")?.active, false',
    "Promise.all([setSession", "changes.map((entry) => entry.status), [200, 200]", '{ anthropic: account.id, openai: other.id }',
  ]);
  const reload = section(source, 'if (group === "state") await coverage.run("state/agents-reload@default"', '\n  for (const inputId of group === "state"');
  ordered(reload, ['newInputContext("default")', "reloadNotice.count(), 0", 'writeFileSync(contextFile, "New project instructions")', "reloadNotice.waitFor()", 'name: "Reload session"', 'reloadNotice.waitFor({ state: "detached" })', "state.contextFilesChanged, false", 'writeFileSync(contextFile, "Updated project instructions")', "reloadNotice.waitFor()", "rmSync(contextFile", "harness.closeContext(checkContext)"]);
  const durable = section(source, 'if (group === "state") await coverage.run("state/durable-account@default"', '\n  if (group === "accounts") {');
  ordered(durable, ['newInputContext("default")', "waitForAccountSave(secondaryAccountId)", "accountPicker.selectOption(secondaryAccountId)", "(await accountSaved).status(), 200", "session.anthropic, secondaryAccountId", "id: secondaryAccountId", "removed.status, 200", "page.reload", "unavailablePicker.inputValue(), secondaryAccountId", '"Unavailable account"', "waitForAccountSave(null)", 'unavailablePicker.selectOption("")', "(await accountCleared).status(), 200", ")).session, {}"]);
  assert.equal((source.match(/state\/api-append-accounts@service/g) ?? []).length, 1);
  assert.equal((source.match(/state\/durable-account@default/g) ?? []).length, 1);
});

test("history keeps version, identity, observer pagination, recovery acknowledgement and the contiguous rendering/reading chain", () => {
  const history = branch("history", "extension-dialogs");
  ordered(history, [
    'coverage.run(`history/reading-chain@${inputId}`', 'const versionContext = await newInputContext(inputId, { serviceWorkers: "block" })', "harness.errorsFor(versionContext)", "const versionPage = await versionContext.newPage()", 'version: "99.99.99"', "const initialVersion = versionPage.waitForResponse", "versionPage.bringToFront()", "versionPage.goto", 'document.visibilityState), "visible"', "initialVersion).json()", 'getByText("E2E final answer", { exact: true }).waitFor()', "reloadWeb.count(), 0", "versionPage.route(versionPattern, versionRoute.handler)", "const changedVersion = versionPage.waitForResponse", 'document.dispatchEvent(new Event("visibilitychange"))', 'changedVersion).json()).version, "99.99.99"', "dialog.dismiss()", "reloadWeb.waitFor()", "versionRoute.dispose(handler => versionPage.unroute(versionPattern, handler))", "dialog.accept()", "versionPage.waitForNavigation()", 'reloadWeb.waitFor({ state: "detached" })', "assert.deepEqual(versionErrors, []", "harness.closeContext(versionContext)",
    "const stateReady = page.waitForResponse", "(await stateReady).status(), 200", "text(4999)", "mobileIdentity", 'getAttribute("title"), project', "element.scrollWidth <= element.clientWidth", 'scrollbarWidth), "none"', "scrolled.overflow > 0 && scrolled.scrollLeft > 0", '"Sidebar toggle must stay pinned while scrolling"', '"Trailing file control must be reachable"', "strip.right", "mobileIdentity.count(), 0",
    "const latestUser", 'sentinel.waitFor({ state: "attached" })', "text(4949)", "turn < 2", "responsePromise", "older.messages.find", "connected: element.isConnected", '"Prepending history must preserve existing message nodes"', "olderResponses.length >= 2", "Number.isInteger(oldest)", 'searchParams.get("before"), `e${oldest}`', "older.entryIds, ids(oldest - 50, oldest)", "older.messages.length, 50", "older.oldestEntryId", "older.hasMore, true", '"Missing, reordered, or duplicate chat messages"',
    '"Active branch answer"', '"Inactive branch answer"', "const interruption", 'name: /^Activity/', "interruptedRow.click()", "page.reload", 'name: "Dismiss"', 'interruption.waitFor({ state: "detached" })', "page.reload", "interruption.count(), 0", '"acknowledgement persists across tabs"',
    "const thinkingRequests", 'hasText: "E2E markdown"', "console.log('E2E code');", '"E2E final answer"', "processDetails.count(), 1", '"All thinking stays inside process details"', '"test/E2E Model"', "thinkingRequests.length, 0", "processDetails.click()", "thinking.count(), 3", 'thinking.last().innerText(), "E2E final reasoning"', "thinkingRequests.length, 0", '"Intermediate thinking details."', "thinkingRequests.length, 3", 'processText.indexOf("E2E intermediate reasoning") < processText.indexOf("echo E2E tool output")', 'processText.indexOf("echo E2E tool output") < processText.indexOf("E2E follow-up reasoning")', 'processText.indexOf("E2E follow-up reasoning") < processText.indexOf("E2E process note")', 'processText.indexOf("E2E process note") < processText.indexOf("E2E final reasoning")', 'processText.split("E2E final reasoning").length - 1, 1', 'includes("E2E final reasoning")', 'name: /bash.*echo E2E tool output/',
    "session=${COMPACTED}", 'heading.waitFor({ state: "attached" })', '"[data-minimap-node-index=\'0\']"', '"E2E compaction anchor"', '"E2E compacted heading"', "scroll.clientHeight * 0.3) < 5", "compaction-minimap.png",
    "const selectSession", "requestAnimationFrame(() => requestAnimationFrame(resolve))", "Math.abs(offset - 120) < 5", 'selectSession(text(0), "e4999")', "const olderPage", "await olderPage", "const olderOffset", 'selectSession("Render **E2E markdown**", "user")', "const answerOffset", 'selectSession(text(0), "e4920")', "{ timeout: 8000 }", '"Returning to older history must restore its reading offset"', 'getAttribute("aria-expanded"), "false"', '"Collapsing process details on remount must not displace the answer"',
    "let releaseHistory", "await historyGate", "const agentRoute", "const pendingHistory", "await pendingHistory", 'name: "Branches"', '"E2E alternate history branch"', "scroll-restore-branch.png", "releaseHistory()", "page.unroute(contextRoute)", "page.unroute(agentRoute)", 'heading.waitFor({ state: "visible" })', "await checkCompactionVisibility(", "assert.deepEqual(errors, []", "harness.closeContext(context)",
  ]);
  assert.doesNotMatch(history, /checkMessageTimestamps|checkProjectPrivacy|checkFilePanel|checkExtensionDialogs|checkAskUserDialog/);
  // Exact expected arrays above additionally require desktop THEN fresh mobile;
  // mobile's acknowledgement assertion must never run before desktop's Dismiss.
});

test("disjoint file, Git, extension and native-question owners retain helper prerequisites and all internal variants", () => {
  const diff = branch("diff-context", "markdown");
  ordered(diff, ["session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', '"Managed Workflow controls must be absent"', "await checkGitExplorer(", "await checkIntegratedGitGraph(", "assert.deepEqual(errors, []"]);
  assert.doesNotMatch(diff, /checkFilePanel|checkFileDiffViews|checkEditableFile/);
  ordered(branch("file-edit", "archive"), ["session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', "await checkFilePanel(", "await checkFileDiffViews(", "await checkEditableFile("]);
  ordered(branch("markdown", "file-edit"), ["session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', "await checkMarkdownPreview(", "await checkFileLineLinks("]);
  ordered(branch("extension-dialogs", "mobile-sidebar"), ["session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', "await checkExtensionDialogs("]);
  ordered(branch("questions", "session-links"), ["session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', 'type: "get_tools"', 'tools.filter((tool) => tool.name === "ask_user").map((tool) => tool.active), [true]', '/^Ask the user a question/', "await checkAskUserDialog("]);
  for (const name of ["checkFilePanel", "checkFileDiffViews", "checkEditableFile", "checkMarkdownPreview", "checkFileLineLinks", "checkExtensionDialogs", "checkAskUserDialog", "checkMessageTimestamps", "checkChatAppearance", "checkProjectPrivacy", "checkGitExplorer", "checkIntegratedGitGraph", "checkModelSpeed", "checkModelSpeedPersistence", "checkRunningSessionForks", "checkSessionLaunch", "checkWorktreeManager", "checkCompactionVisibility", "checkProjectTrustScopes", "checkGitWorkflowPlugin", "runModelSpeedChecks", "runRunningForkChecks", "runSessionLaunchChecks", "runWorktreeManagerChecks"]) {
    assert.equal((source.match(new RegExp(`await ${name}\\(`, "g")) ?? []).length, 1, `${name} has one execution owner`);
  }
  ordered(files, ["export async function checkMarkdownPreview", "writeFileSync(filePath, markdownPanelFixture)", "unchanged refresh retains the SVG node", 'name: "Source"', "await page.waitForTimeout(16_000)", "background polls retain the open viewer", "source choice survives polling", 'replace("Original label", "Updated label")', 'for (const colorScheme of ["dark", "light"])', "error: false, math: true, scripts: 0", "await page.emulateMedia({ colorScheme: originalScheme })"]);
  const diffs = section(files, "export async function checkFileDiffViews", "export async function checkEditableFile");
  ordered(diffs, ["modified:", "added:", "deleted:", "context: contextPatch", "Object.entries(patches)", "await checkDiffContext(", '"Source/Diff retains the revision-bound model"']);
  ordered(files, ["export async function checkEditableFile", 'name: /preview\\.html/', '"tab switching retains the draft"']);
  assert.ok(source.includes("writeSession(OTHER, ["), "Markdown sibling access still has a real other-project fixture");
});

test("overflow tabs retain native pointer activation after panel closure and chat presentation", () => {
  const overflow = easyWins.slice(easyWins.indexOf("export async function checkOverflowTabs"));
  ordered(overflow, ['i < 12', 'await hide.click()', 'panel.waitFor({ state: "hidden" })', 'link.scrollIntoViewIfNeeded()', 'requestAnimationFrame(() => requestAnimationFrame(resolve))', 'await link.click()', 'upstream-overflow-tab-${i}.txt', 'scrollWidth > node.clientWidth', 'last.scrollIntoViewIfNeeded()', 'geometry.closeTop >= geometry.listTop', 'last.press("Home")', '.first().press("End")', 'last.getByRole("button").click()', 'last.waitFor({ state: "detached" })']);
  assert.doesNotMatch(overflow, /waitForTimeout|force:\s*true|dispatchEvent|\.click\(\{.*trial/);
});

test("mobile sidebar preserves compact actions, search scopes, reconciled inline restore and post-restore project move", () => {
  ordered(branch("mobile-sidebar"), [
    "session=${ARCHIVE}", 'name: "Show sidebar"', "button.getBoundingClientRect().width <= 34", '"Only the compact toggle should show initially"', 'getAttribute("aria-expanded"), "true"', 'name: "Copy session link"', '"Copy must not select a different row"', 'page.keyboard.press("Escape")', '"Escape should collapse the actions"', "const iconOffset", "offset <= 1", "await archiveButton.click()", "row.waitFor({ state: \"detached\" })", "?.archived, true",
    'fill("E2E archive fixture")', '"No matching conversations in this scope"', 'name: "Active and archived"', "await titlesOnly.check()", "await titlesOnly.uncheck()", "const renameResponse", "renameResponse.status, 200", "await titlesOnly.check()", "await titlesOnly.uncheck()", 'name: "Active and archived" }).uncheck()', 'name: "Archived sessions"', 'name: "Active sessions"', 'fill("Other workspace task")', 'name: "All projects" }).check()', 'name: "All projects" }).uncheck()', '"Reopening search resets title-only mode"',
    "const archivedSnapshot", "const archivedAnchor = archivedSnapshot.leafId", "const reopenedContext = page.waitForResponse", 'searchParams.get("ancestorId") === archivedAnchor', 'row.getByText("E2E archive fixture"', "const reopenedResponse = await reopenedContext", "reopenedResponse.status(), 200", "(await reopenedResponse.json()).context.entryIds, archivedSnapshot.context.entryIds", 'name: "Restore session"', '"Inline restore should keep the chat open"', "?.archived, undefined",
    'name: "Move to project…"', 'data-value="${otherProject}"', 'name: "Move", exact: true', 'moveDialog.waitFor({ state: "detached" })', "moved?.cwd, otherProject", "moved?.projectRoot, otherProject", "session=${OTHER}", 'getByText("Other workspace task", { exact: true }).waitFor()', 'textContent(), "other-project"', "assert.deepEqual(errors, []",
  ]);
});

test("accounts retain independent create/delete variants and a separate shared-device chain; Activity retains real worktree recovery", () => {
  ordered(branch("accounts", "questions"), ['label: `E2E device ${viewport.width}`', "await checkProviderAccountAuthorization(", "id: account.id", "removedFixture.status, 200"]);
  const shared = section(source, '\n  if (group === "accounts") {', '\n  } else {\n    assert.fail(`No group dispatch');
  ordered(shared, ['label: "E2E device"', 'for (const inputId of ["en-desktop", "en-mobile-short"])', 'coverage.run(`accounts/shared-device@${inputId}`', "newInputContext(inputId)", "accountLabel: deviceAccount.label"]);
  assert.equal((source.match(/await checkProviderAccountAuthorization\(/g) ?? []).length, 2);
  ordered(source, ['if (group === "activity") {', 'git("init", "-qb", "main")', 'branchCwd = join(agentDir, "activity-linked")', 'git("worktree", "add", "-qb", "feature/activity-worktree", branchCwd)', "], branchCwd)", 'if (group !== "activity") seedRecoveryRun']);
  ordered(branch("activity", "accounts"), ["await checkActivityOverview(", "seedInterruptedRun: () => seedRecoveryRun", "subagentIds: ACTIVITY_SUBAGENTS", "activityReview.recordActivityCompletion"]);
});

test("other named focused owners preserve their complete helper/action chains and input order", () => {
  const speed = section(source, "async function runModelSpeedChecks", "async function runRunningForkChecks");
  ordered(speed, ['["en-desktop", "en-mobile-tall"]', "let createdId", '["exercise", "fresh"]', 'coverage.run(`model-speed/${phase}@${inputId}`', "newInputContext(inputId)", "createdId = await checkModelSpeed(page, options)", "await checkModelSpeedPersistence(page, options, createdId)", "assert.deepEqual(errors, []", "harness.closeContext(context)"]);
  for (const [start, end, owner, helper] of [
    ["async function runRunningForkChecks", "async function runSessionLaunchChecks", "running-forks", "checkRunningSessionForks"],
    ["async function runSessionLaunchChecks", "async function runWorktreeManagerChecks", "session-launch", "checkSessionLaunch"],
    ["async function runWorktreeManagerChecks", 'if (group === "worktrees")', "worktrees", "checkWorktreeManager"],
    ['} else if (group === "trust")', '} else if (group === "git-plugin")', "trust", "checkProjectTrustScopes"],
    ['} else if (group === "git-plugin")', '} else if (group === "appearance")', "git-plugin", "checkGitWorkflowPlugin"],
  ]) ordered(section(source, start, end), ['["en-desktop", "en-mobile-tall"]', `coverage.run(\`${owner}/full@\${inputId}\``, "newInputContext(inputId)", `await ${helper}(`, "assert.deepEqual(errors, []", "harness.closeContext(context)"]);
  ordered(branch("archive", "privacy"), ["archived: true", "archiveResponse.status, 200", "session=${ARCHIVE}", "archivedNotice.waitFor()", 'name: "Restore session"', 'archivedNotice.waitFor({ state: "detached" })', 'searchParams.get("session"), ARCHIVE', "?.archived, undefined"]);
  ordered(branch("session-links", "bulk"), ["session=${ARCHIVE}", "row.scrollIntoViewIfNeeded()", 'width <= 600) await row.getByRole("button", { name: "Session actions"', "else await row.hover()", 'name: "Copy session link"', "assert.equal(link, `${base}/?session=${ARCHIVE}`)", 'searchParams.get("session"), ARCHIVE', "page.goto(link", 'getByText("E2E archive fixture", { exact: true }).first().waitFor()']);
  ordered(branch("bulk", "move"), ["BULK.slice(2) : BULK.slice(0, 2)", '"Selection controls stay hidden until Select"', '"2 selected"', "status: 409", '"1 failed, 1 succeeded"', "assert.notEqual(expectedConflict, -1", "errors.splice(expectedConflict, 1)", '"Failed session stays selected for retry"', "page.unroute(archiveConflict, failArchive)", "archivedSessions", 'name: "Restore"', 'name: "Delete"', '"Permanently delete selected sessions (1) and their subagents? Forks will remain."', '"Delete requires confirmation"', 'name: "Cancel"', 'name: "Delete"', "!", '"Selection mode exits after success"']);
  ordered(branch("move", "history"), ["viewport.width <= 600 ? ARCHIVE : APPEND", "await checkSessionMovePicker(page, { base, api, sessionId: moveId, project, otherProject, gitProject, targetWorktree, mobile: viewport.width <= 600 })", "assert.deepEqual(errors, []", "harness.closeContext(context)"]);
});

test("completion receipts require the independent exact expected set for every browser group", async t => {
  for (const [owner, expected] of Object.entries(expectedScenarios)) {
    const directory = scratch(t);
    const coverage = createCoverage(owner, directory);
    assert.deepEqual(receiptAt(directory).completed, []);
    for (const [index, id] of expected.entries()) {
      assert.equal(await coverage.run(id, async () => index), index);
      assert.deepEqual(receiptAt(directory).completed, expected.slice(0, index + 1));
    }
    coverage.finish();
    assert.deepEqual(receiptAt(directory), { version: 1, group: owner, expected, completed: expected, status: "passed", active: null });
    assert.throws(() => coverage.finish(), /did not finish successfully/);
  }
});

test("completion rejects omissions, duplicates, unowned and out-of-order IDs without executing them", async t => {
  const directory = scratch(t), coverage = createCoverage("history", directory);
  let executed = 0;
  const first = "history/reading-chain@legacy-desktop", second = "history/reading-chain@legacy-mobile";
  assert.throws(() => coverage.finish(), /Incomplete scenario coverage/);
  await assert.rejects(coverage.run("timestamps/full@legacy-desktop", async () => executed++), /Unowned scenario/);
  await assert.rejects(coverage.run(second, async () => executed++), /Scenario ordering/);
  assert.equal(executed, 0);
  await coverage.run(first, async () => executed++);
  await assert.rejects(coverage.run(first, async () => executed++), /Duplicate scenario/);
  assert.equal(executed, 1);
  assert.throws(() => coverage.finish(), /Incomplete scenario coverage/);
  assert.deepEqual(receiptAt(directory).completed, [first]);
  assert.equal(receiptAt(directory).status, "running");
});

test("pending or failed scenario operations never produce successful completion or permit retries", async t => {
  const directory = scratch(t), coverage = createCoverage("history", directory);
  const first = "history/reading-chain@legacy-desktop", second = "history/reading-chain@legacy-mobile";
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = coverage.run(first, async () => { await gate; return 42; });
  assert.deepEqual(receiptAt(directory).completed, []);
  assert.equal(receiptAt(directory).active, first);
  assert.throws(() => coverage.finish(), /Scenario still active/);
  await assert.rejects(coverage.run(first, async () => assert.fail("duplicate must not execute")), /Duplicate scenario/);
  await assert.rejects(coverage.run(second, async () => assert.fail("concurrent must not execute")), /serially/);
  release();
  assert.equal(await pending, 42);
  const original = new Error("original operation failure");
  await assert.rejects(coverage.run(second, async () => { throw original; }), error => error === original);
  assert.deepEqual(receiptAt(directory).completed, [first]);
  assert.equal(receiptAt(directory).active, second);
  assert.equal(receiptAt(directory).status, "failed");
  assert.equal(receiptAt(directory).error, original.message);
  assert.throws(() => coverage.finish(), /did not finish successfully/);
  await assert.rejects(coverage.run(second, async () => assert.fail("no retry")), /already closed/);
  const interrupted = createCoverage("archive", scratch(t));
  interrupted.fail(new Error("fixture acquisition interrupted"));
  assert.throws(() => interrupted.finish(), /did not finish successfully/);
});
