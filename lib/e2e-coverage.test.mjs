import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { browserInputs, createCoverage, groups, scenarios, selectGroup, validateInventory } from "../e2e/scenarios.mjs";

// Independent inventory transcribed from the reviewed 34ac894 browser suite,
// NOT generated from scenarios/groups. A row records the historical complete
// chain, not a mandate to retain it. Reviewed current step/input dispositions may
// split/retire duplicate work; inputs distinguish locale/storage/height/context.
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
const currentExpectedScenarios = { ...expectedScenarios,
  timestamps: ["timestamps/usage-time-geometry-v3@en-desktop", "timestamps/process-hit-test-v3@en-mobile-tall", "timestamps/usage-time-geometry-v3@legacy-desktop", "timestamps/process-hit-test-v3@legacy-mobile"],
  accounts: ["accounts/created-device-owner-v3@legacy-desktop", "accounts/created-device-owner-v3@legacy-mobile", "accounts/shared-device-owner-v3@en-desktop", "accounts/shared-device-owner-v3@en-mobile-short"],
  "session-launch": ["session-launch/feedback-and-independent-native-v2@en-desktop", "session-launch/independent-native-compact-v2@en-mobile-tall"],
  trust: ["trust/worktree-caller-cwd-reset-native-v5@en-desktop", "trust/worktree-compact-restriction-native-v5@en-mobile-tall"],
  privacy: ["privacy/native-owned-v3@legacy-desktop", "privacy/native-owned-v3@legacy-tablet", "privacy/native-owned-v3@legacy-mobile"],
  bulk: ["bulk/native-selection-mutations-v2@legacy-desktop", "bulk/native-selection-mutations-v2@legacy-mobile"],
  "mobile-sidebar": ["mobile-sidebar/compact-search-native-rename-restore-move-v3@legacy-mobile"],
  history: ["history/reading-branch-native-v8@legacy-desktop", "history/reading-version-lower-v7@legacy-mobile"],
  markdown: ["markdown/render-files-native-v4@legacy-desktop", "markdown/render-touch-wiring-v3@legacy-mobile"],
  "running-forks": ["running-forks/canonical-quote-stop-v2@en-desktop", "running-forks/first-user-quote-stop-v2@en-mobile-tall"],
  "diff-context": ["diff-context/d409-render-merge-v2@legacy-desktop"],
  move: ["move/picker-recovery-native-v2@legacy-desktop", "move/picker-modal-browse-v2@legacy-mobile"],
  worktrees: ["worktrees/native-loss-bound-review-v3@en-desktop", "worktrees/modal-review-layout-v2@en-mobile-tall"],
  // Independently written current expectations; historical oldCoverage is immutable.
  activity: ["activity/native-toolbar-owned-v5@legacy-desktop", "activity/compact-state-recipe-owned-v4@legacy-tablet", "activity/compact-navigation-owned-v6@legacy-mobile"],
  appearance: ["appearance/legacy-width-bridge-v2@numeric-wide", "appearance/layout-native-v2@legacy-desktop", "appearance/notes-project-native-v2@en-desktop", "appearance/notes-project-touch-layout-v2@en-mobile-short"],
  "ssh-agent": ["ssh-agent/local-cli-auth@en-desktop", "ssh-agent/native-consumers@en-desktop", "ssh-agent/compact-native@en-mobile-tall"],
  "native-tools": ["native-tools/selected-runtime-native-v2@en-desktop", "native-tools/modal-layout@en-mobile-tall"],
  "model-speed": ["model-speed/native-wiring-v3@en-desktop", "model-speed/native-fresh-v2@en-desktop", "model-speed/native-wiring-v3@en-mobile-tall", "model-speed/native-fresh-v2@en-mobile-tall"],
  "git-plugin": ["git-plugin/matrix-settings-v10@en-desktop", "git-plugin/matrix-settings-v10@en-mobile-tall"],
  "file-edit": ["file-edit/native-upload-preview-notice-v5@legacy-desktop", "file-edit/native-upload-preview-notice-v5@legacy-mobile"],
  questions: ["questions/native-publication-v2@legacy-desktop", "questions/compact-native-v2@legacy-mobile"],
  "extension-dialogs": ["extension-dialogs/wrap-native-publication-v2@legacy-desktop", "extension-dialogs/compact-wrap-native-v2@legacy-mobile"],
};
const source = readFileSync(new URL("../e2e/browser-suite.mjs", import.meta.url), "utf8");
const files = readFileSync(new URL("../e2e/file-panel.mjs", import.meta.url), "utf8");
const easyWins = readFileSync(new URL("../e2e/upstream-easy-wins.mjs", import.meta.url), "utf8");
const helperCalls = new Map();
(function visit(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text; helperCalls.set(name, (helperCalls.get(name) ?? 0) + 1);
  }
  ts.forEachChild(node, visit);
})(ts.createSourceFile('browser-suite.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));

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
  for (const expected of needles) {
    // Diagnostic wrappers may await the returned helper promise. Protect helper
    // order without requiring the old incidental `await helper(...)` spelling.
    const needle = expected.replace(/^await (?=(?:check|run)[A-Z])/, '');
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
  assert.deepEqual(scenarios, currentExpectedScenarios);
  assert.equal(Object.values(expectedScenarios).flat().length, 52);
  assert.equal(new Set(Object.values(scenarios).flat()).size, 59);
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
  ordered(appearance, ['["numeric-wide", "legacy-desktop"]', 'coverage.run(`appearance/${inputId === "numeric-wide" ? "legacy-width-bridge-v2" : "layout-native-v2"}@${inputId}`', "newInputContext(inputId)", "page = await context.newPage()", "const errors = harness.errorsFor(context)", "if (browserInputs[inputId].chatWidth)", 'localStorage.getItem("brabbler-chat-content-width") === null', 'localStorage.setItem("brabbler-chat-content-width", "820")', "await page.goto", 'if (inputId === "numeric-wide") await checkLegacyNumericWidthBridge(page)', "else await checkChatAppearance(page)"]);
  ordered(appearance, ['["en-desktop", "en-mobile-short"]', 'coverage.run(`appearance/${inputId === "en-desktop" ? "notes-project-native-v2" : "notes-project-touch-layout-v2"}@${inputId}`', "newInputContext(inputId)", 'if (inputId === "en-desktop") await checkNotesNativeJourney(', "else await checkNotesTouchGeometry(", "assert.deepEqual(errors, []", "await harness.closeContext(context)"]);
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
    'coverage.run(`history/${inputId === "legacy-desktop" ? "reading-branch-native-v8" : "reading-version-lower-v7"}@${inputId}`', 'if (inputId === "legacy-desktop") {', "const versionWork = []", "const ownVersion =", "entry.original = operation()", "entry.observation = entry.original.then", "const admitVersionResponse =", "versionPage.waitForResponse", "Reflect.apply(jsonMethod, response, [])", "const consumer = ownVersion", "assert.equal(result.data.version, expected", "const admitVersionDialog =", "Reflect.apply(nativeMeta.method, dialog, [])", "return undefined;", "const unregisterVersionRoute =", "versionPage.unroute('**/api/app-version', versionRouteAdapter)", "const cleanupVersion =", "versionPhases.push('release-start')", "ownVersion('cleanup.page.close'", "harness.closeContext(versionContext)", "versionPhases.push('releases-initiated')", "await joinVersionKnown()", "close-observer.restore", "close-restoration-complete", "registerVersion(process, 'unhandledRejection'", "newInputContext(inputId, { serviceWorkers: 'block' })", "versionPage.setDefaultTimeout(30_000)", "version: '99.99.99'", "versionRouteAdapter = route =>", "versionRoute.handler(route)", "route.callback.ack", "return ack.original", "const initialVersion = admitVersionResponse('initial', null)", "versionPage.bringToFront()", "versionPage.goto(", "initialVersion.consumer", "ui.initial.notice-count", "versionPage.route('**/api/app-version', versionRouteAdapter)", "const changedVersion = admitVersionResponse('changed', '99.99.99')", "document.dispatchEvent(new Event('visibilitychange'))", "changedVersion.consumer", "const cancel = admitVersionDialog('dismiss')", "cancel.events[0].native", "cancel.events[0].consumer", "await versionValue(disposeVersionRoute())", "const accept = admitVersionDialog('accept')", "versionPage.waitForNavigation()", "const click = ownVersion", "await versionValue(click)", "await versionValue(navigation)", "accept.events[0].native", "accept.events[0].consumer", "reloadWeb.waitFor({ state: 'detached' })", "finally {", "await cleanupVersion()", "Native WebVersion stage failed after owned settlement",
    "const stateReady = page.waitForResponse", "(await stateReady).status(), 200", "text(4999)", "mobileIdentity", 'getAttribute("title"), project', "element.scrollWidth <= element.clientWidth", 'scrollbarWidth), "none"', "scrolled.overflow > 0 && scrolled.scrollLeft > 0", '"Sidebar toggle must stay pinned while scrolling"', '"Trailing file control must be reachable"', "strip.right", "mobileIdentity.count(), 0",
    "const latestUser", 'sentinel.waitFor({ state: "attached" })', "text(4949)", "turn < 2", "responsePromise", "older.messages.find", "connected: element.isConnected", '"Prepending history must preserve existing message nodes"', "olderResponses.length >= 2", "Number.isInteger(oldest)", 'searchParams.get("before"), `e${oldest}`', "older.entryIds, ids(oldest - 50, oldest)", "older.messages.length, 50", "older.oldestEntryId", "older.hasMore, true", '"Missing, reordered, or duplicate chat messages"',
    '"Active branch answer"', '"Inactive branch answer"', "const interruption", 'name: /^Activity/', "interruptedRow.click()", "page.reload", 'name: "Dismiss"', 'interruption.waitFor({ state: "detached" })', "page.reload", "interruption.count(), 0", '"acknowledgement persists across tabs"',
    // Three-read/cache/order/count policy is exercised by the real mounted
    // Thinking owner. These protect only the retained installed/native bridge.
    'hasText: "E2E markdown"', "console.log('E2E code');", '"E2E final answer"',
    "processDetails.click()", "thinking.first().click()", '"Intermediate thinking details."', 'name: /bash.*echo E2E tool output/',
    "session=${COMPACTED}", 'heading.waitFor({ state: "attached" })', '"[data-minimap-node-index=\'0\']"', '"E2E compaction anchor"', '"E2E compacted heading"', "scroll.clientHeight * 0.3) < 5", "compaction-minimap.png",
    "const selectSession", "requestAnimationFrame(() => requestAnimationFrame(resolve))", "Math.abs(offset - 120) < 5", 'selectSession(text(0), "e4999")', "const olderPage", "await olderPage", "const olderOffset", 'selectSession("Render **E2E markdown**", "user")', "const answerOffset", 'selectSession(text(0), "e4920")', "{ timeout: 8000 }", '"Returning to older history must restore its reading offset"', 'getAttribute("aria-expanded"), "false"', '"Collapsing process details on remount must not displace the answer"',
    "checkHistoryBranch(page, { harness, sessionId: LONG, title: text(0), artifacts, errors })", 'heading.waitFor({ state: "visible" })', "await checkCompactionVisibility(", "assert.deepEqual(errors, []", "harness.closeContext(context)",
  ]);
  assert.doesNotMatch(history, /checkMessageTimestamps|checkProjectPrivacy|checkFilePanel|checkExtensionDialogs|checkAskUserDialog/);
  // Exact expected arrays above additionally require desktop THEN fresh mobile;
  // mobile's acknowledgement assertion must never run before desktop's Dismiss.
});

test("disjoint file, Git, extension and native-question owners retain prerequisites and selected native bridges", () => {
  const diff = branch("diff-context", "markdown");
  ordered(diff, ['coverage.run(`diff-context/d409-render-merge-v2@${inputId}`', "session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', '"Managed Workflow controls must be absent"', "await checkGitExplorer(", "await checkIntegratedGitGraph(", "assert.deepEqual(errors, []"]);
  assert.doesNotMatch(diff, /checkFilePanel|checkFileDiffViews|checkEditableFile/);
  ordered(branch("file-edit", "archive"), ["session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', "await checkFilePanel(", "await checkWorkingFileContextBridge(", "await checkEditableFile("]);
  ordered(branch("markdown", "file-edit"), ['coverage.run(`markdown/${inputId === "legacy-desktop" ? "render-files-native-v4" : "render-touch-wiring-v3"}@${inputId}`', "session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', "await checkMarkdownPreview(", "await checkFileLineLinks("]);
  ordered(branch("extension-dialogs", "mobile-sidebar"), ["session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', "await checkExtensionDialogs("]);
  ordered(branch("questions", "session-links"), ["session=${RICH}", 'locator(".markdown-code-block pre").waitFor()', 'type: "get_tools"', 'tools.filter((tool) => tool.name === "ask_user").map((tool) => tool.active), [true]', '/^Ask the user a question/', "await checkAskUserDialog("]);
  for (const name of ["checkFilePanel", "checkWorkingFileContextBridge", "checkEditableFile", "checkMarkdownPreview", "checkFileLineLinks", "checkExtensionDialogs", "checkAskUserDialog", "checkMessageTimestamps", "checkChatAppearance", "checkLegacyNumericWidthBridge", "checkProjectPrivacy", "checkGitExplorer", "checkIntegratedGitGraph", "checkModelSpeedNativeJourney", "checkModelSpeedNativeFreshJourney", "checkNotesNativeJourney", "checkNotesTouchGeometry", "checkSelectedNativeRuntime", "checkNativeToolsModalLayout", "checkRunningSessionForks", "checkSessionLaunch", "checkWorktreeManager", "checkCompactionVisibility", "checkProjectTrustScopes", "checkGitWorkflowPluginNativeBridge", "runModelSpeedChecks", "runRunningForkChecks", "runSessionLaunchChecks", "runWorktreeManagerChecks"]) {
    assert.equal(helperCalls.get(name), 1, `${name} has one execution owner`);
  }
  ordered(files, ["export async function checkMarkdownPreview", "writeFileSync(filePath, markdownPanelFixture)", "unchanged refresh retains the SVG node", 'name: "Source"', "await naturalPolls.wait()", "background polls retain the open viewer", "source choice survives polling", 'replace("Original label", "Updated label")', 'for (const colorScheme of ["dark", "light"])', "error: false, math: true, scripts: 0", "await page.emulateMedia({ colorScheme: originalScheme })"]);
  const diffs = section(files, "export async function checkFileDiffViews", "export async function checkEditableFile");
  // Structural call/selection guard, not execution credit for the lower-owned
  // modified/added/deleted matrix. Its actual FileViewer/CommittedPatchDiff owner
  // and source-fault bindings are recorded separately in test-ownership.md.
  ordered(diffs, ['checkFileDiffViewsForStatuses(page, filePath, ["modified", "added", "deleted", "context"])', "export async function checkWorkingFileContextBridge", 'checkFileDiffViewsForStatuses(page, filePath, ["context"])', "async function checkFileDiffViewsForStatuses", "modified:", "added:", "deleted:", "context: contextPatch", "for (const status of statuses)", "const patch = patches[status]", "const owner = createOwnedRoutes(respond, respond)", "await page.route(routePattern, adapter)", "await checkDiffContext(", '"Gap expansion and all reading controls share one lazy snapshot read"', '"Diff controls do not appear in source mode"', "primary = error; primaryFailed = true", "await owner.dispose(() => page.unroute(routePattern, adapter))", "await Promise.allSettled(admitted)", "const errors = primaryFailed ? [primary, ...failures] : failures"]);
  assert.doesNotMatch(diffs, /Source\/Diff retains the revision-bound model|controls\.getByRole\("button", \{ name: "(?:Unified|Raw patch|Side by side)", exact: true \}\)\.click\(/, "retired policy replay does not remain in the installed controlled reader");
  ordered(files, ["export async function checkEditableFile", 'name: /preview\\.html/', '"tab switching retains the draft"']);
  assert.ok(source.includes("writeSession(OTHER, ["), "Markdown sibling access still has a real other-project fixture");
});

test("composer retires list-policy replay while retaining native input and exact callback boundary", () => {
  const composer = section(easyWins, "export async function checkUpstreamComposer", "export async function checkOverflowTabs");
  assert.doesNotMatch(composer, /ninth|finished|unsupported command|CompositionEvent|execCommand|\[before, after\]|getByRole\("option"\)\.count/);
  ordered(composer, ["const primary = { caught: false", "const registration =", "const observeOriginal", "const executeModel", '"fetch", () => route.fetch()', '"json", () => response.json()', '"fulfill", () => route.fulfill(', '"dispose", () => response.dispose()', "const readManifest", '"get", () => page.request.get(', '"json", () => response.json()', '"dispose", () => response.dispose()', "const settle", "for (const release of releases)", "attemptCleanup(joinCaptured)", '"unroute", () => page.unroute(registration.pattern, registration.adapter)', "routes.dispose(rawHandler", "attemptCleanup(joinCaptured)", "manifestCall.work.original", '"pageClose", () => page.close()', "attemptCleanup(joinCaptured)", "context.newPage()", "registration.adapter = adapter", "page.route(registration.pattern, adapter)", 'manifest.name, "E2E Brabbler"', 'fill(" RELAY-FIXTURE/model-11 ")', 'name: "Fixture model 11"', "checkModelKeyboard(page, width)", '"Enter" : "Shift+Enter"', 'fill("1. undo fixture")', 'press("Control+z")', 'press("Control+Shift+z")', "setSelectionRange(3, 14)", "selectSession(alternateSessionId)", "selectSession(sessionId)", "checkFreshComposerFocus(page, alternateSessionId, width)", "primary.caught = true; primary.value = value", "await attemptCleanup(settle)", "if (primary.caught) errors.push(primary.value)", "throwResult(failure)"]);
});

test("branch retires the controlled obsolete-page replay and retains one exact native caller/body/ACK bridge", () => {
  const history = branch("history", "extension-dialogs");
  const native = readFileSync(new URL("../e2e/history-branch.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(history, /historyGate|releaseHistory|pendingHistory|contextRoute/);
  assert.equal(helperCalls.get("checkHistoryBranch"), 1);
  ordered(native, ["const entries = []", "const own =", "entry.original = invoke()", "entry.observation = entry.original.then", "const joinKnown", "const readResponse", "response.finished()", "Reflect.apply(record.jsonMethod, response, [])", "const rawAgent", "route.fulfill", "return call.callback.original", "const adapter", "routes.handler(route)", "route.dispatcher.ack", "return ack.original", "const removeRoute", "page.unroute(pattern, adapter)", "const closeFailureOwner", "page.close()", "harness.closeContext(context)", 'register(process, "unhandledRejection"', "page.waitForResponse", 'body?.type === "navigate_tree"', 'name: "Branches"', '"E2E alternate history branch"', "await value(agent.complete)", "scroll-restore-branch.png", "for (const release of releases)", "if (primaryCaught) closeFailureOwner()", "routes.dispose(removeRoute)", "await joinKnown()", "close.restore", "registrations.toReversed()", "await joinKnown()", "Native branch failed after owned settlement"]);
});

test("Git selected-policy retirement removes only the reduced cancellation attempt and keeps the real boundary state", () => {
  const git = readFileSync(new URL("../e2e/git-workflow-plugin.mjs", import.meta.url), "utf8");
  const cancellation = section(git, 'const foreignCommitted = foreignGit("rev-parse", "HEAD")', '  if (retainNativeMatrices) {\n    card = await start("disable")');
  ordered(cancellation, ['if (retainNativeMatrices) {', 'start("cross-cancel")', 'patch({ commit: "allow" }, "project")', 'patch({ commit: "deny" }, "project", [], foreign)', 'finish("cross-cancel", "refused")', '} else {', 'patch({ commit: "deny" }, "project", [], foreign)', 'assert.equal(foreignGit("rev-parse", "HEAD"), foreignCommitted)', 'assert.equal(tip(), ownTip)', 'patch({}, "project", ["commit", "commitChecks"])']);
  ordered(git, ['start("cross-approve")', 'getByText(selectedCheck', 'name: "Approve commit"', 'finish("cross-approve", "completed")', 'const foreignCommitted']);
});

test("Git reader retirement preserves both native subjects, inline-mobile drawer and full reader matrix", () => {
  const git = readFileSync(new URL("../e2e/git-workflow-plugin.mjs", import.meta.url), "utf8");
  ordered(git, ['const beforeDraft = execFileSync', 'the exact original desktop before tuple', 'expectedBefore[49] = "Plugin whole-file candidate allow-1280', 'expectedBefore[4499] = "Plugin distant candidate allow-1280', 'the original mobile before is desktop Allow', 'snapshot.oldFile.contents, beforeDraft', 'snapshot.newFile.contents, proposedDraft', 'await jumpTo(first, "Side-by-side diff", 2500', '// Both original content/state tuples', 'if (retainNativeMatrices) {', 'const beforeWide = decisions().length', 'const whole = await fullscreen(card, "Git commit")', 'name: "Wide view"', 'await finish("reconnect", "completed")', 'const changedDraft']);
  const reader = section(git, '// Both original content/state tuples', '    const beforeWide = decisions().length');
  const replay = section(reader, 'if (retainNativeMatrices) {', '} else if (width <= 600) {');
  ordered(reader.slice(reader.indexOf('} else if (width <= 600) {')), ['openFile(card, "second-draft.txt")', 'Unselected file renderers unmount', 'name: "Previous file"', 'name: "Next file"', 'openFile(card, "draft.txt")', 'Inline drawer selection retains the original requested snapshot']);
  ordered(replay, ['name: "Diff context"', 'name: "Unified"', 'name: "Show full file"', 'version(first, "Before")', 'version(first, "After")', 'name: "Search full file"', 'openFile(card, "second-draft.txt")', 'name: "Previous file"', 'version(first, "Changes")', 'name: "Next file"', 'openFile(card, "draft.txt")', 'name: "Collapse"', 'View/version switches, file selection and card collapse reuse only the requested snapshot']);
});

test("Activity Toolbar retirement preserves genuine native family bodies and physical metrics without synthetic poll replay", () => {
  const metrics = readFileSync(new URL("../e2e/activity-family-usage.mjs", import.meta.url), "utf8");
  const native = readFileSync(new URL("../e2e/subagent-lifecycle.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(metrics, /setMetricsChildRunning\(false\)|idleAgents|visibilitychange/);
  ordered(metrics, ['const nativeRead = page.waitForResponse', 'body: await response.json()', 'await agentsButton.click()', 'const nativeResult = await nativeOutcome', 'native.status(), 200', 'native.request().postDataJSON().ids', 'familyUsage.getByText("4/4 available"', 'page.setViewportSize', 'data-agent-usage-id="${childA}"', 'data-agent-usage-id="${selectedSessionId}"', 'const afterMetrics', 'setMetricsChildRunning(true)', 'page.off("request", observeReview)']);
  ordered(native, ['const reads = []', 'const waiting = observe(page.waitForResponse', 'const nativeJSON = observe(response.json())', 'await nativeJSON.original', 'const childIds = queueSnapshot', 'childIds.length, 3', 'const catalogue = applicationRead("/api/sessions"), running = applicationRead("/api/agent/running")', 'await page.reload', 'catalogue.original, running.original', 'runningRead.body.runningSessionIds', 'runningRead.body.queuedSessionIds', 'original native terminal result is separate from toolbar idle', 'name: "Agents · 3 subagents"', 'actual default Toolbar forwards the genuine native family count', 'catch (error)', 'for (const read of reads) await read.observation', 'page.goto(`${base}/?session=${returnSessionId}`', 'readBrowserResponse(page, `${base}/api/sessions/${parentId}`, { method: "DELETE", expectedStatus: "2xx" })']);
});

test("large pagination retires only page switching, retaining cold native review, approval and commits", () => {
  const git = readFileSync(new URL("../e2e/git-workflow-plugin.mjs", import.meta.url), "utf8");
  const large = section(git, 'card = await start("large")', 'console.log(`PASS:');
  ordered(large, ['Showing entries 1–40 of 46', 'Download complete exact patch', 'fullscreen(card', 'openFile(card, "a/large-review-0.txt b/large-review-0.txt")', 'A binary-marker phrase', 'if (retainNativeMatrices)', 'name: "Next files"', 'Showing entries 41–46 of 46', 'await restore(card)', 'name: "Approve commit"', 'finish("large", "completed")', '.length, 45']);
  const allow = section(git, '// Allow still creates one durable outcome card', '// Keep both five-root scenarios');
  ordered(allow, ['finish("allow", "completed")', 'const operationId', 'await page.reload', 'Policy authorized · allow · project', 'await fullscreen', 'await restore', 'name: "Approve commit"', 'name: "Collapse"']);
});

test("historical reader keeps native immutable identity, saved bytes, download and state boundaries", () => {
  const git = readFileSync(new URL("../e2e/git-workflow-plugin.mjs", import.meta.url), "utf8");
  const history = section(git, 'const historicalLoaded = page.waitForResponse(contextUrl)', 'writeFileSync(draftPath, committedDraft)');
  ordered(history, ['historicalContext.status(), 200', 'historicalContext.json(), snapshot', 'contextReads[1].url(), contextUrl', 'jumpTo(historicalFile, "Side-by-side diff", 2500', 'if (retainNativeMatrices)', 'version(historicalFile, "Before")', 'version(historicalFile, "After")', 'version(historicalFile, "Changes")', '// Keep the ORIGINAL native saved bytes', 'name: "Raw patch"', 'textContent(), reviewedPatch', 'Decision only — see the tool result', 'name: /Approve commit|Reject|Cancel/', 'Collapsed historical diff bodies unmount', 'if (retainNativeMatrices)', 'await page.route(contextUrl, refuseContext)', 'await withExpectedBrowserConflict', 'await page.unroute(contextUrl, refuseContext)', '// Reduced inputs already collapsed', 'Historical review cannot execute the approval again', 'Historical context never modifies the current file']);
  const cold = section(git, 'const committedTip = tip()', 'const historicalLoaded = page.waitForResponse(contextUrl)');
  ordered(cold, ['writeFileSync(draftPath, changedDraft)', 'page.reload', 'download.createReadStream()', 'for await (const chunk', 'download.failure(), null']);
  assert.match(history, /version\(historicalFile, "Changes"\)\.click\(\);\s+}\s+\/\/ Keep the ORIGINAL native saved bytes/);
});

test("own Cancel retires only its replay while original native Ask, Stop, Allow and Large remain", () => {
  const git = readFileSync(new URL("../e2e/git-workflow-plugin.mjs", import.meta.url), "utf8");
  const cancel = section(git, '  if (retainNativeMatrices) {\n    card = await start("cancel")', '  // An unrelated repository');
  ordered(cancel, ['card = await start("cancel")', 'const beforeCancel = tip()', 'name: "Cancel"', 'page.keyboard.press("Escape")', 'await finish("cancel", "refused"); assert.equal(tip(), beforeCancel)']);
  ordered(git, ['card = await start("decline")', 'card = await start("reconnect")', 'const committedTip = tip()', 'card = await start("cancel")', 'card = await start("cross-approve")', 'card = await start("stop")', 'const beforeStop = tip()', 'assert.equal(tip(), beforeStop)', 'decisionsBeforeAllow', 'fill(`/e2e-git-plugin allow-${width}`)', 'data-operation-receipt', 'card = await start("large")']);
  assert.match(git, /draft\[49\] = "Plugin whole-file candidate " \+ mode/);
  assert.match(git, /writeFileSync\(join\(selectedCheckout, "second-draft.txt"\), "Second plugin candidate " \+ mode/);
});

test("Activity New retirement preserves original native creation and all three initial-URL receivers", () => {
  const activity = readFileSync(new URL("../e2e/activity.mjs", import.meta.url), "utf8");
  const creation = section(activity, 'const newPanels = retainNavigationMatrices', '  await page.getByText("Active branch answer", { exact: true }).waitFor();\n  assert.equal');
  assert.match(activity, /retainNavigationMatrices = true/);
  ordered(activity, ['await checkOverviewDuringInitialRestore(page, base, selectedSessionId)', 'if (mobile)', 'assert.notEqual(sourceRoot, destination)', 'const newPanels = retainNavigationMatrices ? ["Activity", "Starred"] : ["Activity"]']);
  ordered(creation, ['for (const panel of newPanels)', 'page.goto(`${base}/?session=${selectedSessionId}`', 'page.getByTitle(sourceRoot', 'page.getByTitle(destination', 'page.waitForResponse', 'page.getByRole("button", { name: "New"', 'response.request().postDataJSON().cwd, destination', 'const { sessionId } = await response.json()', 'overview.waitFor({ state: "hidden" })', 'pointerEvents === "none"', 'input.fill(`mobile draft from ${panel}`)', 'node.closest("[inert]")', 'sessions.find(session => session.id === sessionId)?.cwd, destination', 'context.messages, []', 'page.goto(`${base}/?session=${selectedSessionId}`']);
  ordered(branch("activity", "accounts"), ['retainNavigationMatrices: false', 'if (inputId === "legacy-desktop")', 'checkSubagentLifecycle', 'checkSessionPause', 'checkProjectAcceptance']);
});

test("smaller upload retires policy transactions but keeps actual changed/search callers and native bridges", () => {
  const uploads = readFileSync(new URL("../e2e/explorer-uploads.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(uploads, /collapsed\.txt|new-with-skip|Skip existing|changed-row\.txt|not-a-search-match|existing-copy\.txt|clean replacement/);
  ordered(uploads, ["async function callerRead", "const waiting = page.waitForResponse(matcher)", "nativeJSON = response.json()", "data = await nativeJSON", "await action()", "Promise.allSettled([original, acknowledged])", "reply.status(), 200", "await inspect(data, bodyRead, reply)", "async function completed", 'const waiting = response("upload")', "nativeJSON = reply.json()", "await action()", "Promise.allSettled([read, acknowledged])", "reply.status() === 200", "async function pick", 'page.waitForEvent("filechooser")', "button.tap()", 'button.press("Enter")', "Promise.allSettled([choosing, acknowledged])", "choice.value.setFiles(entries)", "async function drop", 'target.dispatchEvent("drop"', "transfer.dispose()", "primaryFailed ? [primary, ...failures]", "drop(row(existing)", 'name: "Add uploaded file to chat"', "pick(project", "pick(nested", 'payload("existing.txt", "cancelled', 'name: "Cancel"', "const statusSnapshot", "createOwnedRoutes(changedStatus, changedStatus)", "const statusAdapter", "statusOwner.handler(route)", "page.route(statusRoute, statusAdapter)", "await callerRead", 'name: "1 changed files"', 'getAttribute("data-upload-directory"), nested', "statusOwner.dispose(() => page.unroute(statusRoute, statusAdapter))", "await Promise.allSettled(admitted)", "const results = await Promise.allSettled(admitted)", "const mixedFixture", "DataTransferItem.prototype.webkitGetAsEntry", 'getProperty("data")', "mixedFixture.evaluate(({ original })", "mixed?.dispose()", "mixedFixture.dispose()", "const inspectSearch", 'search.inputValue(), "existing"']);
  ordered(uploads, ['writeFileSync(join(nested, "existing-external.txt"), "external search refresh\\n")', "await callerRead(indexResponse", "existing-external.txt", 'name: "Search files"', 'name: "Edit"', 'editor.fill("Keep my dirty draft")', 'payload("existing.txt", "disk replacement', 'name: "Replace"', '"Keep my dirty draft"', 'name: "Save"', 'name: "Discard draft and reload"', "if (!mobile)", '["upload-check", "upload"]', "await denial.arrayBuffer()", "denial.status, 403"]);
});

test("overflow tabs retain native pointer activation after panel closure and chat presentation", () => {
  const overflow = easyWins.slice(easyWins.indexOf("export async function checkOverflowTabs"));
  ordered(overflow, ['i < 12', 'await hide.click()', 'panel.waitFor({ state: "hidden" })', 'link.scrollIntoViewIfNeeded()', 'requestAnimationFrame(() => requestAnimationFrame(resolve))', 'await link.click()', 'upstream-overflow-tab-${i}.txt', 'scrollWidth > node.clientWidth', 'last.scrollIntoViewIfNeeded()', 'geometry.closeTop >= geometry.listTop', 'last.press("Home")', '.first().press("End")', 'last.getByRole("button").click()', 'last.waitFor({ state: "detached" })']);
  assert.doesNotMatch(overflow, /waitForTimeout|force:\s*true|dispatchEvent|\.click\(\{.*trial/);
});

test("mobile sidebar preserves compact actions, search scopes, reconciled inline restore and post-restore project move", () => {
  ordered(branch("mobile-sidebar"), [
    "session=${ARCHIVE}", 'name: "Show sidebar"', "button.getBoundingClientRect().width <= 34", '"Only the compact toggle should show initially"', 'getAttribute("aria-expanded"), "true"', 'name: "Copy session link"', '"Copy must not select a different row"', 'page.keyboard.press("Escape")', '"Escape should collapse the actions"', "const iconOffset", "offset <= 1", "await archiveButton.click()", "row.waitFor({ state: \"detached\" })", "?.archived, true",
    'fill("E2E archive fixture")', 'name: "Active and archived" }).check()', "await titlesOnly.check()", '"No matching conversations in this scope"', "const renameResponse", "await renameResponse.arrayBuffer()", "renameResponse.status, 200", "await titlesOnly.uncheck()", "await titlesOnly.check()", "await titlesOnly.uncheck()", 'name: "Active and archived" }).uncheck()', 'fill("Other workspace task")', 'name: "All projects" }).check()', "await searchToggle.click()", 'name: "Archived sessions"',
    "const archivedSnapshot", "const archivedAnchor = archivedSnapshot.leafId", "const reopenedContext = page.waitForResponse", 'searchParams.get("ancestorId") === archivedAnchor', "const reopenedRead = reopenedContext.then", "body: await response.json()", "const reopenedOutcome = reopenedRead.then", 'row.getByText("E2E archive fixture"', "reopenedUi = { ok: false, error }", "const reopenedResult = await reopenedOutcome", "reopenedFailures.push(reopenedUi.error)", "reopenedFailures.push(reopenedResult.error)", "throw reopenedFailures[0]", "new AggregateError(reopenedFailures", "body: reopenedBody", "reopenedResponse.status(), 200", "reopenedBody.context.entryIds, archivedSnapshot.context.entryIds", 'name: "Restore session"', '"Inline restore should keep the chat open"', "?.archived, undefined",
    'name: "Move to project…"', 'data-value="${otherProject}"', 'name: "Move", exact: true', 'moveDialog.waitFor({ state: "detached" })', "moved?.cwd, otherProject", "moved?.projectRoot, otherProject", "session=${OTHER}", 'getByText("Other workspace task", { exact: true }).waitFor()', 'textContent(), "other-project"', "assert.deepEqual(errors, []",
  ]);
});

test("accounts retain independent create/delete variants and a separate shared-device chain; Activity retains real worktree recovery", () => {
  ordered(branch("accounts", "questions"), ['label: `E2E device ${viewport.width}`', "await checkProviderAccountAuthorization(", "id: account.id", "removedFixture.status, 200"]);
  const shared = section(source, '\n  if (group === "accounts") {', '\n  } else {\n    assert.fail(`No group dispatch');
  ordered(shared, ['label: "E2E device"', 'for (const inputId of ["en-desktop", "en-mobile-short"])', 'coverage.run(`accounts/shared-device-owner-v3@${inputId}`', "newInputContext(inputId)", "accountLabel: deviceAccount.label"]);
  assert.equal((source.match(/await checkProviderAccountAuthorization\(/g) ?? []).length, 2);
  ordered(source, ['if (group === "activity") {', 'git("init", "-qb", "main")', 'branchCwd = join(agentDir, "activity-linked")', 'git("worktree", "add", "-qb", "feature/activity-worktree", branchCwd)', "], branchCwd)", 'if (group !== "activity") seedRecoveryRun']);
  ordered(branch("activity", "accounts"), ['const activityScenario = inputId === "legacy-desktop" ? "activity/native-toolbar-owned-v5" : inputId === "legacy-mobile" ? "activity/compact-navigation-owned-v6" : "activity/compact-state-recipe-owned-v4"', 'coverage.run(`${activityScenario}@${inputId}`', "await checkActivityOverview(", "seedInterruptedRun: () => seedRecoveryRun", "subagentIds: ACTIVITY_SUBAGENTS", "activityReview.recordActivityCompletion", 'if (inputId === "legacy-desktop")', "await checkSubagentLifecycle(", "await checkSessionPause(", "await checkProjectAcceptance(", "await checkAcceptanceResponsive(", 'if (inputId === "legacy-mobile")', '"subagent-project-1280"', "await checkSubagentModelSettings(", "assert.deepEqual(errors, []"]);
});

test("named focused owners preserve their reviewed native helper/bridge chains and input order", () => {
  const speed = section(source, "async function runModelSpeedChecks", "async function runRunningForkChecks");
  ordered(speed, ['["en-desktop", "en-mobile-tall"]', 'const { viewport } = browserInputs[inputId].options', "let createdId", '["native-wiring-v3", "native-fresh-v2"]', 'coverage.run(`model-speed/${phase}@${inputId}`', "newInputContext(inputId)", "page = await context.newPage()", "const errors = harness.errorsFor(context)", "width: viewport.width", 'if (phase === "native-wiring-v3") createdId = await checkModelSpeedNativeJourney(page, options)', "else await checkModelSpeedNativeFreshJourney(page, options, createdId)", "assert.deepEqual(errors, []", "harness.closeContext(context)", "context = undefined", "page = undefined"]);
  for (const [start, end, owner, helper] of [
    ["async function runRunningForkChecks", "async function runSessionLaunchChecks", "running-forks", "checkRunningSessionForks"],
    ["async function runSessionLaunchChecks", "async function runWorktreeManagerChecks", "session-launch", "checkSessionLaunch"],
    ["async function runWorktreeManagerChecks", 'if (group === "worktrees")', "worktrees", "checkWorktreeManager"],
    ['} else if (group === "trust")', '} else if (group === "git-plugin")', "trust", "checkProjectTrustScopes"],
    ['} else if (group === "git-plugin")', '} else if (group === "appearance")', "git-plugin", "checkGitWorkflowPluginNativeBridge"],
  ]) {
    const receipt = owner === "running-forks"
      ? 'coverage.run(`running-forks/${inputId === "en-desktop" ? "canonical-quote-stop-v2" : "first-user-quote-stop-v2"}@${inputId}`'
      : owner === "worktrees"
        ? 'coverage.run(`worktrees/${inputId === "en-desktop" ? "native-loss-bound-review-v3" : "modal-review-layout-v2"}@${inputId}`'
        : owner === "session-launch"
          ? 'coverage.run(`session-launch/${inputId === "en-desktop" ? "feedback-and-independent-native-v2" : "independent-native-compact-v2"}@${inputId}`'
          : owner === "trust"
            ? 'coverage.run(`trust/${inputId === "en-desktop" ? "worktree-caller-cwd-reset-native-v5" : "worktree-compact-restriction-native-v5"}@${inputId}`'
            : owner === "git-plugin"
              ? 'coverage.run(`git-plugin/matrix-settings-v10@${inputId}`'
              : `coverage.run(\`${owner}/full@\${inputId}\``;
    ordered(section(source, start, end), ['["en-desktop", "en-mobile-tall"]', receipt, "newInputContext(inputId)", `await ${helper}(`, "assert.deepEqual(errors, []", "harness.closeContext(context)"]);
  }
  ordered(branch("archive", "privacy"), ["archived: true", "archiveResponse.status, 200", "session=${ARCHIVE}", "archivedNotice.waitFor()", 'name: "Restore session"', 'archivedNotice.waitFor({ state: "detached" })', 'searchParams.get("session"), ARCHIVE', "?.archived, undefined"]);
  ordered(branch("session-links", "bulk"), ["session=${ARCHIVE}", "row.scrollIntoViewIfNeeded()", 'width <= 600) await row.getByRole("button", { name: "Session actions"', "else await row.hover()", 'name: "Copy session link"', "assert.equal(link, `${base}/?session=${ARCHIVE}`)", 'searchParams.get("session"), ARCHIVE', "page.goto(link", 'getByText("E2E archive fixture", { exact: true }).first().waitFor()']);
  const bulk = branch("bulk", "move");
  ordered(bulk, ["BULK.slice(2) : BULK.slice(0, 2)", '"Selection controls stay hidden until Select"', '"2 selected"', 'name: "Archive"', 'await select.waitFor({ state: "visible" })', "archivedSessions", 'name: "Restore"', 'await select.waitFor({ state: "visible" })', 'name: "Active sessions"', 'name: "Delete"', '"Permanently delete selected sessions (1) and their subagents? Forks will remain."', '"Delete requires confirmation"', 'name: "Delete"', "!", '"Selection mode exits after success"']);
  assert.doesNotMatch(bulk, /status: 409|failArchive|archiveConflict|errors\.splice|name: "Cancel"/, 'lower-owned conflict/retry/cancel ceremony is not still dispatched in Chromium');
  const move = branch("move", "history");
  ordered(move, ['coverage.run(`move/${inputId === "legacy-desktop" ? "picker-recovery-native-v2" : "picker-modal-browse-v2"}@${inputId}`', "viewport.width <= 600 ? ARCHIVE : APPEND", "await checkSessionMovePicker(page, { base, api, post, agentDir, sessionId: moveId, project, otherProject, gitProject, targetWorktree, mobile: viewport.width <= 600 })", "assert.deepEqual(errors, []", "harness.closeContext(context)"]);
  assert.doesNotMatch(move, /checkSessionWorktreeMoves\(/, 'the old full worktree journey is retired, not also dispatched');
});

test("completion receipts require the independent exact expected set for every browser group", async t => {
  for (const [owner, expected] of Object.entries(currentExpectedScenarios)) {
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

test("Tool policy and synthetic-page work stay retired while installed native and caller bridges remain", () => {
  const tool = readFileSync(new URL("../e2e/tool-arguments.mjs", import.meta.url), "utf8");
  for (const retired of ["checkStreamedToolArguments", "__toolEvents", "Expected clipboard refusal", "readable-nested"]) {
    assert.equal(tool.includes(retired), false, `retired Tool browser work: ${retired}`);
  }
  assert.equal(source.includes("checkStreamedToolArguments"), false, "no retired probe import/call");
  assert.equal(tool.includes(".newPage()"), false, "no redundant Tool page allocation/navigation");
  ordered(tool, ["grantPermissions", 'data-tool-call-id="readable-flat"', 'args.locator("td pre")',
    'pre.press("PageDown")', "fixtures.longLabel", "geometry.x >= 0", "before + 4", 'fontWeight), "600"',
    "copyAndCheck(page, card, expected)", 'raw.press("Enter")', "width > 600", 'join(project, "readable-write.txt")',
    'join(project, "readable-edit.txt")', "copyAndCheck(page, written", "edited.locator", 'E2E seeded readable-edit result']);
});

test("completion rejects omissions, duplicates, unowned and out-of-order IDs without executing them", async t => {
  const directory = scratch(t), coverage = createCoverage("history", directory);
  let executed = 0;
  const first = "history/reading-branch-native-v8@legacy-desktop", second = "history/reading-version-lower-v7@legacy-mobile";
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
  const first = "history/reading-branch-native-v8@legacy-desktop", second = "history/reading-version-lower-v7@legacy-mobile";
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

test("receiving-only definitions reject both retired desktop IDs before callback execution", async t => {
  for (const [owner, id] of [
    ["history", "history/reading-chain@legacy-desktop"],
    ["markdown", "markdown/preview-then-line-links@legacy-desktop"],
  ]) {
    const directory = scratch(t), coverage = createCoverage(owner, directory);
    let executed = 0;
    await assert.rejects(coverage.run(id, async () => executed++), /Unowned scenario/);
    assert.equal(executed, 0, id);
    assert.deepEqual(receiptAt(directory).completed, [], id);
    assert.equal(receiptAt(directory).active, null, id);
  }
});

test("reduced definitions reject every retired original, receiving-only and superseded short ID before execution", async t => {
  for (const [owner, id] of [
    ["history", "history/reading-chain@legacy-desktop"],
    ["history", "history/reading-chain-receiving-v1@legacy-desktop"],
    ["markdown", "markdown/preview-then-line-links@legacy-desktop"],
    ["markdown", "markdown/preview-then-line-links@legacy-mobile"],
    ["markdown", "markdown/preview-then-line-links-files-identity-v1@legacy-desktop"],
    ["markdown", "markdown/rendering-and-model-wiring@legacy-desktop"],
    ["markdown", "markdown/rendering-model-files-identity-v1@legacy-desktop"],
    ["markdown", "markdown/rendering-responsive@legacy-mobile"],
    ["markdown", "markdown/render-files-native-v2@legacy-desktop"],
    ["markdown", "markdown/render-files-native-v3@legacy-desktop"],
    ["markdown", "markdown/render-touch-wiring-v2@legacy-mobile"],
    ["running-forks", "running-forks/full@en-desktop"],
    ["running-forks", "running-forks/full@en-mobile-tall"],
    ["diff-context", "diff-context/explorer-then-merge@legacy-desktop"],
    ["move", "move/full-picker@legacy-desktop"],
    ["move", "move/full-picker@legacy-mobile"],
    ["worktrees", "worktrees/full@en-desktop"],
    ["worktrees", "worktrees/full@en-mobile-tall"],
    ["worktrees", "worktrees/native-loss-review-history-v2@en-desktop"],
    ["model-speed", "model-speed/native-wiring@en-desktop"],
    ["model-speed", "model-speed/native-fresh@en-desktop"],
    ["model-speed", "model-speed/native-wiring@en-mobile-tall"],
    ["model-speed", "model-speed/native-fresh@en-mobile-tall"],
    ["model-speed", "model-speed/native-wiring-v2@en-desktop"],
    ["model-speed", "model-speed/native-wiring-v2@en-mobile-tall"],
    ["model-speed", "model-speed/exercise@en-desktop"],
    ["model-speed", "model-speed/fresh@en-desktop"],
    ["model-speed", "model-speed/exercise@en-mobile-tall"],
    ["model-speed", "model-speed/fresh@en-mobile-tall"],
    ["model-speed", "model-speed/save-wiring@en-desktop"],
    ["model-speed", "model-speed/fresh-restoration@en-desktop"],
    ["model-speed", "model-speed/more-layout@en-mobile-tall"],
    ["native-tools", "native-tools/full@en-desktop"],
    ["native-tools", "native-tools/full@en-mobile-tall"],
    ["git-plugin", "git-plugin/full@en-desktop"],
    ["git-plugin", "git-plugin/full@en-mobile-tall"],
    ["appearance", "appearance/full@numeric-wide"],
    ["appearance", "appearance/full@legacy-desktop"],
    ["appearance", "appearance/scratchpad@en-desktop"],
    ["appearance", "appearance/scratchpad@en-mobile-short"],
    ["appearance", "appearance/notes-native@en-desktop"],
    ["appearance", "appearance/notes-touch-layout@en-mobile-short"],
    ["file-edit", "file-edit/panel-diff-edit@legacy-desktop"],
    ["file-edit", "file-edit/panel-diff-edit@legacy-mobile"],
    ["activity", "activity/golden-native@legacy-desktop"],
    ["activity", "activity/responsive@legacy-tablet"],
    ["activity", "activity/responsive@legacy-mobile"],
    ["questions", "questions/registration-and-dialog@legacy-desktop"],
    ["questions", "questions/registration-and-dialog@legacy-mobile"],
    ["extension-dialogs", "extension-dialogs/full@legacy-desktop"],
    ["extension-dialogs", "extension-dialogs/full@legacy-mobile"],
    ["ssh-agent", "ssh-agent/webauthn-openssh@en-desktop"],
    ["ssh-agent", "ssh-agent/webauthn-openssh@en-mobile-tall"],
    ["history", "history/reading-chain-receiving-reduced-v1@legacy-desktop"],
    ["history", "history/reading-chain@legacy-mobile"],
    ["activity", "activity/native-with-usage-bridge@legacy-desktop"],
    ["activity", "activity/compact-usage-native@legacy-tablet"],
    ["activity", "activity/compact-usage-native@legacy-mobile"],
    ["bulk", "bulk/archive-restore-delete@legacy-desktop"],
    ["bulk", "bulk/archive-restore-delete@legacy-mobile"],
    ["mobile-sidebar", "mobile-sidebar/archive-search-restore-move@legacy-mobile"],
    ["mobile-sidebar", "mobile-sidebar/touch-native-search-restore-move-v2@legacy-mobile"],
    ["activity", "activity/native-usage-direct-v2@legacy-desktop"],
    ["activity", "activity/compact-usage-direct-v2@legacy-tablet"],
    ["activity", "activity/compact-usage-direct-v2@legacy-mobile"],
    ["mobile-sidebar", "mobile-sidebar/private-reopen-ui-only-v1@legacy-mobile"],
    ["mobile-sidebar", "mobile-sidebar/private-reopen-native-continuation-only-v1@legacy-mobile"],
    ["mobile-sidebar", "mobile-sidebar/private-reopen-combined-v1@legacy-mobile"],
    ["privacy", "privacy/full@legacy-desktop"],
    ["privacy", "privacy/full@legacy-tablet"],
    ["privacy", "privacy/full@legacy-mobile"],
    ["privacy", "privacy/native-persistence-navigation-v2@legacy-desktop"],
    ["privacy", "privacy/native-persistence-navigation-v2@legacy-tablet"],
    ["privacy", "privacy/native-persistence-navigation-v2@legacy-mobile"],
    ["bulk", "bulk/private-archive-final-family-held-v1@legacy-desktop"],
    ["bulk", "bulk/private-archive-final-family-held-v1@legacy-mobile"],
    ["bulk", "bulk/private-restore-final-family-held-v1@legacy-desktop"],
    ["bulk", "bulk/private-restore-final-family-held-v1@legacy-mobile"],
    ["accounts", "accounts/created-deleted@legacy-desktop"],
    ["accounts", "accounts/created-deleted@legacy-mobile"],
    ["accounts", "accounts/shared-device@en-desktop"],
    ["accounts", "accounts/shared-device@en-mobile-short"],
    ["native-tools", "native-tools/selected-runtime-wiring@en-desktop"],
    ["questions", "questions/native-publication@legacy-desktop"],
    ["questions", "questions/compact-native@legacy-mobile"],
    ["extension-dialogs", "extension-dialogs/native-publication@legacy-desktop"],
    ["extension-dialogs", "extension-dialogs/compact-native@legacy-mobile"],
    ["session-launch", "session-launch/full@en-desktop"],
    ["session-launch", "session-launch/full@en-mobile-tall"],
    ["trust", "trust/full@en-desktop"],
    ["trust", "trust/full@en-mobile-tall"],
    ["accounts", "accounts/created-device-native-v2@legacy-desktop"],
    ["accounts", "accounts/created-device-native-v2@legacy-mobile"],
    ["accounts", "accounts/shared-device-native-v2@en-desktop"],
    ["accounts", "accounts/shared-device-native-v2@en-mobile-short"],
    ["trust", "trust/scoped-native-settings-v2@en-desktop"],
    ["trust", "trust/worktree-compact-settings-v2@en-mobile-tall"],
    ["trust", "trust/worktree-settings-reset-native-v3@en-desktop"],
    ["trust", "trust/worktree-compact-restriction-native-v3@en-mobile-tall"],
    ["trust", "trust/scoped-caller-cwd-native-v4@en-desktop"],
    ["trust", "trust/scoped-native-compact-v4@en-mobile-tall"],
    ["trust", "trust/worktree-caller-cwd-reset-native-v4@en-desktop"],
    ["trust", "trust/worktree-compact-restriction-native-v4@en-mobile-tall"],
    ["bulk", "bulk/private-archive-final-family-held-v2@legacy-desktop"],
    ["bulk", "bulk/private-archive-final-family-held-v2@legacy-mobile"],
    ["privacy", "privacy/save-click-read-own-v1@legacy-desktop"],
    ["privacy", "privacy/save-click-read-own-v1@legacy-tablet"],
    ["privacy", "privacy/save-click-read-own-v1@legacy-mobile"],
    ["privacy", "privacy/save-400-body-own-v1@legacy-desktop"],
    ["privacy", "privacy/save-400-body-own-v1@legacy-tablet"],
    ["privacy", "privacy/save-400-body-own-v1@legacy-mobile"],
    ["privacy", "privacy/routes-ack-own-v1@legacy-desktop"],
    ["privacy", "privacy/routes-ack-own-v1@legacy-tablet"],
    ["privacy", "privacy/routes-ack-own-v1@legacy-mobile"],
    ["privacy", "privacy/routes-primary-peer-close-own-v1@legacy-desktop"],
    ["privacy", "privacy/routes-primary-peer-close-own-v1@legacy-tablet"],
    ["privacy", "privacy/routes-primary-peer-close-own-v1@legacy-mobile"],
    ["privacy", "privacy/registration-own-v1@legacy-desktop"],
    ["privacy", "privacy/registration-own-v1@legacy-tablet"],
    ["privacy", "privacy/registration-own-v1@legacy-mobile"],
    ["privacy", "privacy/save-400-body-own-v2@legacy-desktop"],
    ["privacy", "privacy/save-400-body-own-v2@legacy-tablet"],
    ["privacy", "privacy/save-400-body-own-v2@legacy-mobile"],
    ["privacy", "privacy/registration-early-raw-own-v2@legacy-desktop"],
    ["privacy", "privacy/registration-early-raw-own-v2@legacy-tablet"],
    ["privacy", "privacy/registration-early-raw-own-v2@legacy-mobile"],
    ["privacy", "privacy/registration-early-raw-own-v3@legacy-desktop"],
    ["privacy", "privacy/registration-early-raw-own-v3@legacy-tablet"],
    ["privacy", "privacy/registration-early-raw-own-v3@legacy-mobile"],
    ["timestamps", "timestamps/full@en-desktop"],
    ["timestamps", "timestamps/full@en-mobile-tall"],
    ["timestamps", "timestamps/full@legacy-desktop"],
    ["timestamps", "timestamps/full@legacy-mobile"],
    ["timestamps", "timestamps/locale-layout-v2@en-desktop"],
    ["timestamps", "timestamps/locale-layout-v2@legacy-desktop"],
    ["git-plugin", "git-plugin/native-review-partial-v1@en-desktop"],
    ["git-plugin", "git-plugin/native-review-partial-v1@en-mobile-tall"],
    ["git-plugin", "git-plugin/settings-disable-subset-v2@en-desktop"],
    ["git-plugin", "git-plugin/settings-disable-subset-v2@en-mobile-tall"],
    ["git-plugin", "git-plugin/matrix-settings-v9@en-desktop"],
    ["git-plugin", "git-plugin/matrix-settings-v9@en-mobile-tall"],
    ["git-plugin", "git-plugin/pagination-owned-v8@en-desktop"],
    ["git-plugin", "git-plugin/pagination-owned-v8@en-mobile-tall"],
    ["git-plugin", "git-plugin/historical-reader-owned-v7@en-desktop"],
    ["git-plugin", "git-plugin/historical-reader-owned-v7@en-mobile-tall"],
    ["git-plugin", "git-plugin/cancel-input-owned-v6@en-desktop"],
    ["git-plugin", "git-plugin/cancel-input-owned-v6@en-mobile-tall"],
    ["git-plugin", "git-plugin/reader-input-owned-v5@en-desktop"],
    ["git-plugin", "git-plugin/reader-input-owned-v5@en-mobile-tall"],
    ["git-plugin", "git-plugin/selected-policy-owned-v4@en-desktop"],
    ["git-plugin", "git-plugin/selected-policy-owned-v4@en-mobile-tall"],
    ["git-plugin", "git-plugin/reader-desktop-owned-v3@en-desktop"],
    ["git-plugin", "git-plugin/reader-desktop-owned-v3@en-mobile-tall"],
    ["file-edit", "file-edit/native-context-partial-v1@legacy-desktop"],
    ["file-edit", "file-edit/native-context-partial-v1@legacy-mobile"],
    ["file-edit", "file-edit/private-context-fulfill-route-reject-own-v1@legacy-desktop"],
    ["file-edit", "file-edit/private-context-fulfill-route-reject-own-v1@legacy-mobile"],
    ["file-edit", "file-edit/private-context-primary-route-cleanup-own-v1@legacy-desktop"],
    ["file-edit", "file-edit/private-context-primary-route-cleanup-own-v1@legacy-mobile"],
    ["activity", "activity/compact-state-recipe-owned-v4@legacy-mobile"],
    ["activity", "activity/native-state-recipe-owned-v4@legacy-desktop"],
    ["activity", "activity/private-toolbar-forward-v1@legacy-desktop"],
    ["activity", "activity/private-toolbar-forward-v1@legacy-tablet"],
    ["activity", "activity/private-toolbar-forward-v1@legacy-mobile"],
    ["activity", "activity/native-usage-owned-read-v3@legacy-desktop"],
    ["activity", "activity/compact-usage-owned-read-v3@legacy-tablet"],
    ["activity", "activity/compact-usage-owned-read-v3@legacy-mobile"],
    ["history", "history/reading-receiving-compaction-v2@legacy-desktop"],
    ["history", "history/reading-touch-compaction-v2@legacy-mobile"],
    ["history", "history/installed-thinking-body-native-v4@legacy-desktop"],
    ["history", "history/installed-thinking-body-native-v4@legacy-mobile"],
    ["history", "history/reading-tool-native-v5@legacy-desktop"],
    ["history", "history/reading-tool-native-v5@legacy-mobile"],
    ["history", "history/reading-composer-native-v6@legacy-desktop"],
    ["history", "history/reading-composer-native-v6@legacy-mobile"],
    ["history", "history/reading-version-bridge-v7@legacy-desktop"],
    ["file-edit", "file-edit/native-context-owned-source-tail-v3@legacy-desktop"],
    ["file-edit", "file-edit/native-context-owned-source-tail-v3@legacy-mobile"],
    ["file-edit", "file-edit/native-upload-caller-owned-v4@legacy-desktop"],
    ["file-edit", "file-edit/native-upload-caller-owned-v4@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-drop-body-v1@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-drop-body-v2@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-chooser-v1@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-chooser-v2@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-status-registration-v1@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-status-registration-v2@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-index-body-v1@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-index-body-v2@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-mixed-v1@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-mixed-v2@legacy-desktop"],
    ["file-edit", "file-edit/private-upload-drop-body-v1@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-drop-body-v2@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-chooser-v1@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-chooser-v2@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-status-registration-v1@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-status-registration-v2@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-index-body-v1@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-index-body-v2@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-mixed-v1@legacy-mobile"],
    ["file-edit", "file-edit/private-upload-mixed-v2@legacy-mobile"],
    ["history", "history/private-branch-body-ui-v1@legacy-desktop"],
    ["history", "history/private-branch-raw-ui-v1@legacy-desktop"],
    ["history", "history/reading-native-version-owned-v4@legacy-desktop"],
    ["history", "history/reading-touch-version-owned-v4@legacy-mobile"],
    ["history", "history/reading-native-version-bridge-v5@legacy-desktop"],
    ["history", "history/reading-touch-version-lower-v5@legacy-mobile"],
    ["history", "history/private-web-version-ld-response-ui-first-v1@legacy-desktop"],
    ["history", "history/private-web-version-ld-dialog-ui-v1@legacy-desktop"],
    ["history", "history/private-composer-route-after-native-success-v1@legacy-desktop"],
    ["history", "history/private-composer-ui-unroute-after-success-v1@legacy-desktop"],
    ["terminal", "terminal/full@production-pty"],
    ["terminal", "terminal/native-pty-and-touch-partial-v1@production-pty"],
    ["terminal", "terminal/native-fonts-pty-touch-and-desktop-held-create-v2@production-pty"],
  ]) {
    const directory = scratch(t), coverage = createCoverage(owner, directory);
    let executed = 0;
    await assert.rejects(coverage.run(id, async () => executed++), /Unowned scenario/);
    assert.equal(executed, 0, id);
    assert.deepEqual(receiptAt(directory).completed, [], id);
    assert.equal(receiptAt(directory).active, null, id);
  }
});

test("reduced managed geometry retains populated saved600000 before bounds", () => {
  const managed = readFileSync(new URL("../e2e/managed-model-context.mjs", import.meta.url), "utf8");
  const tail = managed.slice(managed.indexOf("export async function checkManagedModelContextLayout"));
  ordered(tail, ["const savedContextWindow = 600000", 'request.method(), "GET"', 'input.inputValue(), "600000"', 'getAttribute("placeholder"), "600000"', "input.boundingBox()", "reads.includes(path)", "routes.dispose("]);
  assert.doesNotMatch(tail, /input\.fill\(/);
});
