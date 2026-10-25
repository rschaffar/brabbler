// Adapted from @Nuctori's script-style CI/E2E fixtures in PR #617 (issue #599).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { createJiti } from "jiti";
import { checkFilePanel, checkWorkingFileContextBridge, checkEditableFile, checkMarkdownPreview, markdownPanelFixture, filePanelFixture } from "./file-panel.mjs";
import { checkExplorerUploads } from "./explorer-uploads.mjs";
import { seedFileLineLinks, checkFileLineLinks } from "./file-line-links.mjs";
import { checkFileWorkspace } from "./file-workspace.mjs";
import { checkChatBottomFollow } from "./chat-bottom-follow.mjs";
import { seedMarkdownMediaFixtures, checkMarkdownMedia } from "./markdown-media.mjs";
import { seedReviewNotebooks, checkReviewNotebooks } from "./review-notebooks.mjs";
import { checkExtensionDialogs, extensionSource } from "./extension-dialog.mjs";
import { checkAskUserDialog } from "./ask-user.mjs";
import { checkActivityOverview } from "./activity.mjs";
import { checkSubagentLifecycle, subagentLifecycleFixtureSource } from "./subagent-lifecycle.mjs";
import { checkSubagentModelSettings } from "./subagent-settings-ui.mjs";
import { checkSessionPause, sessionPauseFixtureSource } from "./session-pause.mjs";
import { checkProjectAcceptance } from "./project-acceptance.mjs";
import { checkAcceptanceResponsive } from "./project-acceptance-ui.mjs";
import { checkProjectPrivacy } from "./project-privacy.mjs";
import { checkProjectTrustScopes } from "./project-trust-scopes.mjs";
import { checkProviderAccountAuthorization } from "./provider-accounts.mjs";
import { checkChatAppearance, checkLegacyNumericWidthBridge } from "./chat-appearance.mjs";
import { checkNotesNativeJourney, checkNotesTouchGeometry } from "./scratchpad.mjs";
import { checkMessageTimestamps } from "./message-timestamps.mjs";
import { checkUpstreamComposer, checkOverflowTabs } from "./upstream-easy-wins.mjs";
import { checkRequestHeaderBoundary, seedExternalReferenceFixtures, checkExternalReferenceBoundary } from "./security-boundaries.mjs";
import { seedFollowupSettings, checkSkillInstructions, checkModelOverrides, checkPreferenceWiring } from "./upstream-followups.mjs";
import { checkManagedModelContextLayout } from "./managed-model-context.mjs";
import { checkModelSpeedNativeJourney, checkModelSpeedNativeFreshJourney } from "./model-speed.mjs";
import { seedNativeToolsFixtures, checkSelectedNativeRuntime } from "./native-tools.mjs";
import { checkNativeToolsModalLayout } from "./native-tools-layout.mjs";
import { applyFixtureEnvironment, createHarness } from "./harness.mjs";
import { checkRunningSessionForks } from "./running-session-forks.mjs";
import { checkGitExplorer } from "./git-explorer.mjs";
import { contextContents, changedContextContents } from "./git-diff-context.mjs";
import { checkIntegratedGitGraph } from "./git-explorer-merge.mjs";
import { checkSessionMovePicker } from "./session-move.mjs";
import { checkGitWorkflowPluginNativeBridge, gitPluginFixtureSource } from "./git-workflow-plugin.mjs";
import { checkSessionLaunch, sessionLaunchFixtureSource } from "./session-launch.mjs";
import { checkWorktreeManager } from "./worktree-manager.mjs";
import { assertStartupSessionCatalogue, prepareBrowserPrelude } from "./browser-fixture-recipes.mjs";
import { createDiagnosticStages } from "./diagnostic-stage.mjs";
import { browserInputs, createCoverage, selectGroup } from "./scenarios.mjs";
import { historyPageResponse } from "./history-pagination.mjs";
import { checkCompactionVisibility } from "./compaction.mjs";
import { seedSourceHighlighting, checkSourceHighlighting } from "./source-highlighting.mjs";
import { checkHighlightFailure } from "./highlight-failure.mjs";
import { createOwnedRoutes } from "./owned-routes.mjs";
import { seedToolArguments, checkToolArguments, checkStreamedToolArguments } from "./tool-arguments.mjs";

// Validate one-hot ownership before the harness or any fixture side effects.
const group = selectGroup(process.env);
const stage = createDiagnosticStages(group);

if (group === "ssh-agent") {
  const { runBrowserSshSuite } = await import("./browser-ssh-suite.mjs");
  await runBrowserSshSuite();
} else {
// Package acceptance runs only in the disposable NixOS guest. The service
// independently receives its private environment and real module UMask.
process.umask(0o077);
const root = process.env.E2E_PACKAGE_ROOT;
assert.match(root ?? "", /^\/nix\/store\//, "Nix-built application package required");
const harness = createHarness(root, "browser");
const { artifacts, agentDir, env: fixtureEnv } = harness;
if (group === "history") fixtureEnv.PI_WEB_APP_NAME = "  E2E Pi Desk  ";
let coverage;
try {
coverage = createCoverage(group, artifacts);
applyFixtureEnvironment(fixtureEnv); // In-process helpers and children share isolation.
const finishPreparation = stage.start("prepare/browser-fixtures");
const project = join(agentDir, "project");
const otherProject = join(agentDir, "other-project");
const sessionDir = join(agentDir, "sessions", "e2e");
mkdirSync(project);
mkdirSync(otherProject);
mkdirSync(join(project, "browse-only"));
const previewFile = join(project, "preview.html");
const editableFile = join(project, "editable.txt");
writeFileSync(previewFile, filePanelFixture);
writeFileSync(editableFile, "Initial text\n");
const overflowFiles = group === "file-edit" ? Array.from({ length: 12 }, (_, i) => join(project, `upstream-overflow-tab-${i}.txt`)) : [];
for (const path of overflowFiles) writeFileSync(path, "Overflow tab fixture\n");
const markdownFile = join(project, "diagram.md");
writeFileSync(markdownFile, markdownPanelFixture);
mkdirSync(sessionDir, { recursive: true });
const timestamp = "2026-08-23T00:00:00.000Z";
const LONG = "e2e-long-session";
const BRANCH = "e2e-branch-session";
const RICH = "e2e-rich-session";
const COMPACTED = "e2e-compacted-session";
const APPEND = "e2e-external-append-session";
const ARCHIVE = "e2e-archive-session";
const BULK = ["e2e-bulk-desktop-a", "e2e-bulk-desktop-b", "e2e-bulk-mobile-a", "e2e-bulk-mobile-b"];
const OTHER = "e2e-other-project";
const ACTIVITY_SUBAGENTS = group === "activity"
  ? ["e2e-ready-child-a", "e2e-ready-child-b", "e2e-working-child", "e2e-other-child"] : [];
const GIT = "e2e-git-explorer";
const TRUST_MAIN = "e2e-trust-main";
const TRUST_LINKED = "e2e-trust-linked";
const trustProject = join(agentDir, "trust-project");
const trustLinked = join(agentDir, "trust-linked");
const gitProject = join(agentDir, "git-project");
const targetWorktree = join(agentDir, "git-target-worktree");
const text = (i) => `E2E message ${String(i).padStart(4, "0")}`;
const ids = (start, end) => Array.from({ length: end - start }, (_, i) => `e${start + i}`);

function message(id, parentId, role, content) {
  // Native SDK context accounting requires usage on every assistant, including
  // tool-call turns retained after compaction. These fixtures made no LLM calls.
  const usage = role === "assistant" ? {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  } : undefined;
  return { type: "message", id, parentId, timestamp, message: { role, content, ...(usage && { usage }) } };
}

function writeSession(id, entries, cwd = project, parentSessionId) {
  const header = { type: "session", version: 3, id, timestamp, cwd,
    ...(parentSessionId ? { parentSession: join(sessionDir, `2026-08-23T00-00-00-000Z_${parentSessionId}.jsonl`) } : {}) };
  writeFileSync(join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`),
    [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

let browser;
let page;
let context;
let reviewNotebookFixture;
let nativeToolsFixture;

  const activityReview = ACTIVITY_SUBAGENTS.length
    ? await createJiti(import.meta.url).import(join(root, "lib/activity-review-server.ts")) : null;
  // Seed before startup so the first catalogue scan sees every fixture.
  const { managerFixtures, expectedIds: preludeIds } = await prepareBrowserPrelude(group,
    { agentDir, env: fixtureEnv, writeSession, message, timestamp }, stage);
  mkdirSync(join(agentDir, "extensions"));
  writeFileSync(join(agentDir, "extensions", "e2e-dialog.js"), extensionSource);
  writeFileSync(join(agentDir, "extensions", "e2e-session-launch.js"), sessionLaunchFixtureSource(root));
  if (group === "native-tools") nativeToolsFixture = seedNativeToolsFixtures({ root, agentDir, project, env: fixtureEnv, writeSession, message, timestamp });
  if (group === "activity") {
    writeFileSync(join(agentDir, "extensions", "e2e-subagent-lifecycle.js"), subagentLifecycleFixtureSource(root));
    writeFileSync(join(agentDir, "extensions", "e2e-session-pause.js"), sessionPauseFixtureSource(root, agentDir));
  }
  if (group === "git-plugin") writeFileSync(join(agentDir, "extensions", "e2e-git-plugin.js"), gitPluginFixtureSource(root));
  // Simulate the recognized external package so the browser owns ask_user exactly once.
  mkdirSync(join(agentDir, "extensions", "pi-ask-user"));
  writeFileSync(join(agentDir, "extensions", "pi-ask-user", "index.js"), `export default function (pi) {
    pi.registerTool({ name: "ask_user", label: "External Ask", description: "External copy",
      parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
      execute: async () => ({ content: [{ type: "text", text: "External copy ran" }], details: undefined }),
    });
  }`);
  const longEntries = Array.from({ length: 5000 }, (_, i) =>
    message(`e${i}`, i ? `e${i - 1}` : null, i % 2 ? "assistant" : "user", text(i)));
  longEntries.splice(1, 0, message("alternate", "e0", "user", "E2E alternate history branch"));
  writeSession(LONG, longEntries);
  let branchCwd = project;
  if (group === "activity") {
    const git = (...args) => execFileSync("git", ["-C", project, ...args], { encoding: "utf8", env: fixtureEnv }).trim();
    git("init", "-qb", "main");
    git("-c", "user.name=E2E", "-c", "user.email=e2e@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "Activity worktree fixture");
    branchCwd = join(agentDir, "activity-linked");
    git("worktree", "add", "-qb", "feature/activity-worktree", branchCwd);
  }
  writeSession(BRANCH, [
    message("root", null, "user", "Branch root"),
    message("old", "root", "assistant", "Inactive branch answer"),
    message("new", "root", "assistant", "Active branch answer"),
  ], branchCwd);
  const recoveryDir = join(agentDir, "pi-web", "run-journal", "v1", BRANCH);
  mkdirSync(recoveryDir, { recursive: true });
  const seedRecoveryRun = (runId) => writeFileSync(join(recoveryDir, `${runId}.start.json`), JSON.stringify({
    version: 1, runId, sessionId: BRANCH, ownerPid: 99999999,
    startedAt: new Date().toISOString(),
  }));
  if (group !== "activity") seedRecoveryRun("11111111-1111-4111-8111-111111111111");
  const toolResult = message("result", "call", "toolResult", [{ type: "text", text: "E2E tool output" }]);
  Object.assign(toolResult.message, { toolCallId: "t1", toolName: "bash", isError: false });
  const richEntries = [
    message("user", null, "user", "Render **E2E markdown**"),
    message("call", "user", "assistant", [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "E2E intermediate reasoning\nIntermediate thinking details." },
      { type: "text", text: "E2E process paragraph.\n\n".repeat(20) },
      { type: "toolCall", id: "t1", name: "bash", arguments: { command: "echo E2E tool output" } },
    ]),
    toolResult,
    message("answer", "result", "assistant", [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "E2E follow-up reasoning\nFollow-up thinking details." },
      { type: "text", text: "E2E process note" },
      { type: "thinking", thinking: "E2E final reasoning\nFinal thinking details." },
      { type: "text", text:
        "E2E final answer\n```js\nconsole.log('E2E code');\n```\n\n"
        + "E2E answer paragraph.\n\n".repeat(20)
        + "## E2E reading position\n\n"
        + "E2E answer paragraph.\n\n".repeat(20)
        + (overflowFiles.length ? "\n\n" + overflowFiles.map((path, i) => `[Overflow tab ${i}](${path})`).join(" · ") : "")
        + (group === "markdown" ? "\n\n999. Upstream wide marker\n1000. Upstream wide continuation\n" : ""),
      },
    ]),
  ];
  const toolArgumentFixtures = group === "history" ? seedToolArguments({ entries: richEntries, message, project }) : null;
  for (const entry of richEntries) entry.message.timestamp = Date.parse(timestamp);
  Object.assign(richEntries.at(-1).message, {
    provider: "test", model: "E2E Model",
    usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 0, cost: { total: 0.0123 } },
  });
  writeSession(RICH, richEntries);
  const fileLineFixtures = seedFileLineLinks({ project, writeSession, message, workspacePeer: group === "markdown" });
  const externalReferenceFixtures = group === "markdown" ? seedExternalReferenceFixtures({ agentDir, writeSession, message }) : [];
  const followupSettings = group === "markdown" ? seedFollowupSettings({ agentDir, project }) : null;
  const mediaFixtures = group === "markdown" ? seedMarkdownMediaFixtures({ project, agentDir, writeSession, message }) : null;
  const highlightingFixture = group === "markdown" ? seedSourceHighlighting({ project, writeSession, message }) : null;
  // The default page is 50 *visible* messages (user / assistant / compaction).
  // toolResults ride along free after #810, so 48 tool-call assistants + the
  // final answer + the divider fill that window; the user prompt is the 51st
  // visible entry and must stay outside the first page.
  const compactedEntries = [
    message("user", null, "user", "E2E prompt outside the compacted page"),
    { type: "compaction", id: "compact", parentId: "user", timestamp, summary: "E2E compaction anchor", firstKeptEntryId: "user", tokensBefore: 100 },
  ];
  for (let i = 0; i < 48; i++) {
    compactedEntries.push(message(`call${i}`, compactedEntries.at(-1).id, "assistant", [
      { type: "toolCall", id: `t${i}`, name: "bash", arguments: { command: `echo step${i}` } },
    ]));
    const result = message(`result${i}`, `call${i}`, "toolResult", [{ type: "text", text: `step${i}` }]);
    Object.assign(result.message, { toolCallId: `t${i}`, toolName: "bash", isError: false });
    compactedEntries.push(result);
  }
  compactedEntries.push(message("answer", "result47", "assistant", [{ type: "text", text:
    "E2E compacted answer paragraph.\n\n".repeat(20)
    + "## E2E compacted heading\n\n"
    + "E2E compacted answer paragraph.\n\n".repeat(20),
  }]));
  writeSession(COMPACTED, compactedEntries);
  writeSession(APPEND, [
    message("root", null, "user", "E2E wrapper root"),
    message("reply", "root", "assistant", "E2E wrapper reply"),
  ]);
  writeSession(ARCHIVE, [message("root", null, "user", "E2E archive fixture")]);
  for (const id of BULK) writeSession(id, [message("root", null, "user", `E2E bulk ${id}`)]);
  writeSession(OTHER, [
    message("root", null, "user", "Other workspace task"),
    message("reply", "root", "assistant", "Waiting for more work"),
  ], otherProject);
  if (group === "trust") {
    mkdirSync(trustProject);
    const git = (...args) => execFileSync("git", ["-C", trustProject, ...args], { encoding: "utf8", env: fixtureEnv }).trim();
    git("init", "-qb", "main");
    mkdirSync(join(trustProject, ".pi", "extensions"), { recursive: true });
    writeFileSync(join(trustProject, ".pi", "extensions", ".keep"), "fixture\n");
    git("add", ".");
    git("-c", "user.name=E2E", "-c", "user.email=e2e@example.invalid", "commit", "-qm", "trust fixture");
    git("worktree", "add", "-qb", "linked", trustLinked);
    writeSession(TRUST_MAIN, [message("root", null, "user", "Trust main fixture")], trustProject);
    writeSession(TRUST_LINKED, [message("root", null, "user", "Trust linked fixture")], trustLinked);
  }
  for (const [index, id] of ACTIVITY_SUBAGENTS.entries()) {
    const parentSessionId = index === 3 ? OTHER : BRANCH;
    writeSession(id, [
      { type: "custom", id: "meta", parentId: null, timestamp, customType: "pi-web:subagent", data: {
        version: 1, parentSessionId,
        parentSessionPath: join(sessionDir, `2026-08-23T00-00-00-000Z_${parentSessionId}.jsonl`),
        profile: "explore", description: id, task: "Activity bulk review fixture", createdAt: timestamp,
      } },
      message("prompt", "meta", "user", id),
      message("answer", "prompt", "assistant", "Fixture result"),
      { type: "custom", id: "result", parentId: "answer", timestamp, customType: "pi-web:subagent-result",
        data: { version: 1, status: "completed", completedAt: timestamp } },
    ], index === 3 ? otherProject : project, parentSessionId);
  }
  {
    const otherGit = (...args) => execFileSync("git", ["-C", otherProject, ...args], { encoding: "utf8", env: fixtureEnv }).trim();
    otherGit("init", "-qb", "other-main");
    // Beta fixture only, before any seed commit or selected-source capture.
    otherGit("config", "--local", "user.name", "E2E");
    otherGit("config", "--local", "user.email", "e2e@example.invalid");
    otherGit("config", "--local", "commit.gpgsign", "false");
    otherGit("config", "--local", "tag.gpgsign", "false");
    otherGit("commit", "--allow-empty", "-qm", "Other project fixture");
  }
  {
    mkdirSync(gitProject);
    const git = (...args) => execFileSync("git", ["-C", gitProject, ...args], {
      encoding: "utf8", env: fixtureEnv,
    }).trim();
    const commit = (subject) => git("-c", "user.name=E2E", "-c", "user.email=e2e@example.invalid", "commit", "-m", subject);
    git("init", "-b", "target");
    // Alpha fixture only, before commits/tags/candidates. Its linked target
    // shares this common local config; no identity comes from global config.
    git("config", "--local", "user.name", "E2E");
    git("config", "--local", "user.email", "e2e@example.invalid");
    git("config", "--local", "commit.gpgsign", "false");
    git("config", "--local", "tag.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(gitProject, "base.txt"), "Base fixture\n");
    writeFileSync(join(gitProject, "z-context.txt"), contextContents);
    writeFileSync(join(gitProject, "draft.txt"), Array.from({ length: 5000 }, (_, index) => `Plugin context ${index + 1}\n`).join(""));
    mkdirSync(join(gitProject, "checks"));
    writeFileSync(join(gitProject, "checks", "fixture.txt"), "Tracked modern check working directory\n");
    if (group === "markdown") {
      writeFileSync(join(gitProject, "review-source.tsx"), '// Outside the excerpt\nexport const greeting = "<script>not executable</script>";\n\nexport const view = <a title="pinned">Hello</a>;\n/* Multiline\n   comment */\n');
      git("add", "review-source.tsx");
    }
    git("add", "base.txt", "checks/fixture.txt", "z-context.txt", "draft.txt"); commit("base fixture");
    git("switch", "-c", "feature");
    writeFileSync(join(gitProject, "first.txt"), "First feature patch\n");
    git("add", "first.txt"); commit("first feature");
    git("branch", "comparison-base"); // Read-only comparison branch; deliberately no checkout.
    writeFileSync(join(gitProject, "second.txt"), "Second feature patch\n");
    writeFileSync(join(gitProject, "base.txt"), "Revised base fixture\n");
    writeFileSync(join(gitProject, "z-context.txt"), changedContextContents);
    git("add", "second.txt", "base.txt", "z-context.txt"); commit("second feature");
    git("tag", "e2e-light");
    git("tag", "--no-sign", "-a", "e2e-annotated", "-m", "E2E annotated release");
    git("tag", "same-name", "target");
    writeFileSync(join(gitProject, "draft.txt"), "Manual commit fixture\n");
    writeFileSync(join(gitProject, "second-draft.txt"), "Second captured commit file\n");
    git("worktree", "add", targetWorktree, "target");
    writeSession(GIT, [message("root", null, "user", "E2E Git browsing conversation"),
      message("answer", "root", "assistant", "Ready to browse Git history")], gitProject);
    if (group === "markdown") reviewNotebookFixture = seedReviewNotebooks({ gitProject, targetWorktree, env: fixtureEnv, writeSession, message });
  }

  finishPreparation();
  const base = process.env.E2E_BASE_URL;
  assert.equal(base, harness.baseURL, "Use only the harness-selected guest service URL");
  const laneURL = new URL(base);
  assert.equal(laneURL.protocol, "http:");
  assert.equal(laneURL.hostname, "127.0.0.1", "Use only the guest's strict IPv4 loopback service");
  assert.equal(laneURL.origin, base, "Service URL must be the exact canonical lane origin");
  const ownedServer = await harness.startService();

  async function api(path, status = 200) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, status, path);
    return response.json();
  }

  async function post(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) assert.fail(`POST ${path} (${body?.type ?? "request"}) -> ${response.status}: ${(await response.text()).slice(0, 4096)}`);
    return response.json();
  }

  const deadline = Date.now() + 120_000;
  while (true) {
    await ownedServer.check();
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      const { sessions } = await response.json();
      assertStartupSessionCatalogue(sessions, [LONG, BRANCH, RICH, COMPACTED, APPEND, ARCHIVE, OTHER, GIT, fileLineFixtures.sessionId, ...BULK, ...preludeIds, ...ACTIVITY_SUBAGENTS, ...externalReferenceFixtures.map((fixture) => fixture.id), ...(mediaFixtures ? [mediaFixtures.id, mediaFixtures.otherId] : []),
        ...(group === "markdown" ? [fileLineFixtures.peerSessionId] : []),
        ...(highlightingFixture ? [highlightingFixture.sessionId, highlightingFixture.fencesId] : []),
        ...(reviewNotebookFixture ? [reviewNotebookFixture.id] : []),
        ...(group === "trust" ? [TRUST_MAIN, TRUST_LINKED] : [])]);
      for (const id of ACTIVITY_SUBAGENTS) {
        assert.equal(sessions.find((session) => session.id === id)?.relation?.kind, "subagent", `${id} must have real subagent metadata`);
      }
      break;
    }
    assert.ok(Date.now() < deadline, "Server readiness timed out; see server.log");
    await delay(250);
  }

  async function newInputContext(inputId, extraOptions) {
    const input = browserInputs[inputId];
    assert.ok(input, `Unknown browser input: ${inputId}`);
    const next = extraOptions
      ? await harness.newContext(browser, { ...input.options, ...extraOptions }, base)
      : await harness.newContext(browser, input.options, base);
    if (input.piLocale) {
      // Legacy interface preferences must not change controls/dates on reload.
      await next.addInitScript(({ locale, origin }) => {
        if (window === window.top && location.origin === origin) localStorage.setItem("pi-locale", locale);
      }, { locale: input.piLocale, origin: base });
    }
    return next;
  }

  async function runModelSpeedChecks() {
    browser ??= await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const inputId of ["en-desktop", "en-mobile-tall"]) {
      const { viewport } = browserInputs[inputId].options;
      let createdId;
      for (const phase of ["native-wiring-v3", "native-fresh-v2"]) await coverage.run(`model-speed/${phase}@${inputId}`, async () => {
        context = await newInputContext(inputId);
        page = await context.newPage();
        page.setDefaultTimeout(30_000);
        const errors = harness.errorsFor(context);
        const options = { base, api, post, agentDir, project, artifacts, width: viewport.width };
        if (phase === "native-wiring-v3") createdId = await checkModelSpeedNativeJourney(page, options);
        else await checkModelSpeedNativeFreshJourney(page, options, createdId);
        assert.deepEqual(errors, [], `Model-speed browser/server errors at ${viewport.width}px (${phase})`);
        await harness.closeContext(context);
        context = undefined;
        page = undefined;
      });
    }
  }

  async function runRunningForkChecks() {
    browser ??= await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const inputId of ["en-desktop", "en-mobile-tall"]) await coverage.run(`running-forks/${inputId === "en-desktop" ? "canonical-quote-stop-v2" : "first-user-quote-stop-v2"}@${inputId}`, async () => {
      const { viewport } = browserInputs[inputId].options;
      context = await newInputContext(inputId);
      page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors = harness.errorsFor(context);
      await checkRunningSessionForks(page, { base, api, post, artifacts, width: viewport.width });
      assert.deepEqual(errors, [], `Running-fork browser/server errors at ${viewport.width}px`);
      await harness.closeContext(context); context = undefined; page = undefined;
    });
  }

  async function runSessionLaunchChecks() {
    browser ??= await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const inputId of ["en-desktop", "en-mobile-tall"]) await coverage.run(`session-launch/${inputId === "en-desktop" ? "feedback-and-independent-native-v2" : "independent-native-compact-v2"}@${inputId}`, async () => {
      const { viewport } = browserInputs[inputId].options;
      context = await newInputContext(inputId);
      page = await context.newPage(); page.setDefaultTimeout(30_000);
      const errors = harness.errorsFor(context);
      await checkSessionLaunch(page, { base, api, post, project, agentDir, artifacts, width: viewport.width });
      assert.deepEqual(errors, [], `Session-launch browser/server errors at ${viewport.width}px`);
      await harness.closeContext(context); context = undefined; page = undefined;
    });
  }
  async function runWorktreeManagerChecks() {
    browser ??= await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const [index, inputId] of ["en-desktop", "en-mobile-tall"].entries()) await coverage.run(`worktrees/${inputId === "en-desktop" ? "native-loss-bound-review-v3" : "modal-review-layout-v2"}@${inputId}`, async () => {
      const { viewport } = browserInputs[inputId].options;
      context = await newInputContext(inputId);
      page = await context.newPage(); page.setDefaultTimeout(30_000);
      const errors = harness.errorsFor(context);
      await checkWorktreeManager(page, { base, fixture: managerFixtures[index], artifacts, width: viewport.width });
      assert.deepEqual(errors, [], `Worktree-manager errors at ${viewport.width}px`);
      await harness.closeContext(context); context = undefined; page = undefined;
    });
  }
  if (group === "worktrees") {
    await runWorktreeManagerChecks();
  } else if (group === "session-launch") {
    await runSessionLaunchChecks();
  } else if (group === "running-forks") {
    await runRunningForkChecks();
  } else if (group === "model-speed") {
    await runModelSpeedChecks();
  } else if (group === "native-tools") {
    browser ??= await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const inputId of ["en-desktop", "en-mobile-tall"]) await coverage.run(`native-tools/${inputId === "en-desktop" ? "selected-runtime-native-v2" : "modal-layout"}@${inputId}`, async () => {
      const { viewport } = browserInputs[inputId].options;
      context = await newInputContext(inputId); page = await context.newPage(); page.setDefaultTimeout(30_000);
      const errors = harness.errorsFor(context);
      const nativeOptions = { base, api, post, fixture: nativeToolsFixture, artifacts, width: viewport.width };
      if (inputId === "en-desktop") await checkSelectedNativeRuntime(page, nativeOptions);
      else await checkNativeToolsModalLayout(page, nativeOptions);
      assert.deepEqual(errors, [], `Native-tools browser/server errors at ${viewport.width}px`);
      await harness.closeContext(context); context = undefined; page = undefined;
    });
  } else if (group === "trust") {
    browser = await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const inputId of ["en-desktop", "en-mobile-tall"]) await coverage.run(`trust/${inputId === "en-desktop" ? "worktree-caller-cwd-reset-native-v5" : "worktree-compact-restriction-native-v5"}@${inputId}`, async () => {
      const { viewport } = browserInputs[inputId].options;
      context = await newInputContext(inputId);
      page = await context.newPage();
      const errors = harness.errorsFor(context);
      await checkProjectTrustScopes(page, { base, api, trustProject, trustLinked, mainId: TRUST_MAIN, width: viewport.width });
      assert.deepEqual(errors, [], "Trust browser/server errors");
      await harness.closeContext(context); context = undefined; page = undefined;
    });
  } else if (group === "git-plugin") {
    browser = await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const inputId of ["en-desktop", "en-mobile-tall"]) await coverage.run(`git-plugin/settings-disable-subset-v2@${inputId}`, async () => {
      const { viewport } = browserInputs[inputId].options;
      context = await newInputContext(inputId);
      page = await context.newPage();
      const errors = harness.errorsFor(context);
      await checkGitWorkflowPluginNativeBridge(page, base, gitProject, GIT, artifacts, viewport.width);
      assert.deepEqual(errors, [], "Plugin browser/server errors");
      await harness.closeContext(context); context = undefined; page = undefined;
    });
  } else if (group === "appearance") {
    browser = await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const inputId of ["numeric-wide", "legacy-desktop"]) await coverage.run(`appearance/${inputId === "numeric-wide" ? "legacy-width-bridge-v2" : "layout-native-v2"}@${inputId}`, async () => {
      context = await newInputContext(inputId);
      page = await context.newPage();
      const errors = harness.errorsFor(context);
      if (browserInputs[inputId].chatWidth) {
        // Preserve the original timing: install after the initial blank page.
        // A pre-existing numeric preference must not opt out of full width.
        await context.addInitScript(() => {
          // The cross-tab font check creates an initial opaque about:blank page.
          // Seed only app documents, where browser storage is actually available.
          if (location.protocol !== "http:" && location.protocol !== "https:") return;
          if (localStorage.getItem("pi-chat-content-width") === null) localStorage.setItem("pi-chat-content-width", "820");
        });
      }
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await page.locator(".markdown-code-block pre").waitFor();
      if (inputId === "numeric-wide") await checkLegacyNumericWidthBridge(page);
      else await checkChatAppearance(page);
      assert.deepEqual(errors, [], "Chat appearance browser/server errors");
      await harness.closeContext(context); context = undefined; page = undefined;
    });
    for (const inputId of ["en-desktop", "en-mobile-short"]) await coverage.run(`appearance/${inputId === "en-desktop" ? "notes-native" : "notes-touch-layout"}@${inputId}`, async () => {
      context = await newInputContext(inputId);
      page = await context.newPage();
      const errors = harness.errorsFor(context);
      if (inputId === "en-desktop") await checkNotesNativeJourney(page, { base, sessionId: RICH });
      else await checkNotesTouchGeometry(page, { base, sessionId: RICH });
      assert.deepEqual(errors, [], `Scratchpad browser/server errors: ${inputId}`);
      await harness.closeContext(context); context = undefined; page = undefined;
    });
  } else if (group === "timestamps") {
    browser = await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const inputId of ["en-desktop", "en-mobile-tall", "legacy-desktop", "legacy-mobile"]) await coverage.run(`timestamps/${inputId === "en-desktop" || inputId === "legacy-desktop" ? "usage-time-geometry-v3" : "process-hit-test-v3"}@${inputId}`, async () => {
      context = await newInputContext(inputId);
      page = await context.newPage();
      const errors = harness.errorsFor(context);
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await checkMessageTimestamps(page, {
        nativeProcess: inputId === "en-mobile-tall" || inputId === "legacy-mobile",
      });
      assert.deepEqual(errors, [], "Message timestamp browser errors");
      await harness.closeContext(context);
      context = undefined;
      page = undefined;
    });
  } else if (["state", "history", "extension-dialogs", "mobile-sidebar", "diff-context", "markdown", "file-edit", "archive", "privacy", "activity", "accounts", "questions", "session-links", "bulk", "move"].includes(group)) {
  let secondaryAccountId;
  if (group === "state") await coverage.run("state/api-append-accounts@service", async () => {
    await checkRequestHeaderBoundary(base);
  const detail = await api(`/api/sessions/${LONG}?deferThinking=1&deferMedia=1`);
  assert.deepEqual(detail.context.entryIds, ids(4950, 5000));
  assert.equal(detail.context.messages.length, 50);
  assert.equal(detail.context.hasMore, true);
  assert.ok(JSON.stringify(detail).length < 100_000, "Detail transferred unbounded history");
  const tail = await api(`/api/sessions/${LONG}/context?tail=50`);
  assert.deepEqual(tail.context.entryIds, ids(4950, 5000));
  assert.equal(tail.context.messages.length, 50);
  const selectedBranch = await api(`/api/sessions/${BRANCH}/context?leafId=old`);
  assert.deepEqual(selectedBranch.context.entryIds, ["root", "old"]);
  const rootPage = await api(`/api/sessions/${BRANCH}/context?before=old&tail=1`);
  assert.deepEqual(rootPage.context.entryIds, ["root"]);
  assert.equal(rootPage.context.hasMore, false);
  const beforeRoot = await api(`/api/sessions/${BRANCH}/context?before=root`);
  assert.deepEqual(beforeRoot.context.entryIds, []);
  assert.equal(beforeRoot.context.hasMore, false);
  await api("/api/sessions/e2e-does-not-exist", 404);
  await api("/api/files/..%2F..%2Fetc%2Fpasswd?type=read", 403);
  const compacted = await api(`/api/sessions/${COMPACTED}`);
  assert.equal(compacted.context.entryIds[0], "compact");
  assert.equal(compacted.context.messages.some((entry) => entry.role === "user"), false);
  console.log("PASS: bounded history, branch context, pagination root, and API errors");

  // #632 regression: a live wrapper shadows the session file. Ordinary reads
  // keep that snapshot (two processes writing one JSONL is unsupported). A
  // mount/refresh GET (?force=1) must see the external append and stay stable.
  {
    const file = join(sessionDir, `2026-08-23T00-00-00-000Z_${APPEND}.jsonl`);
    await post(`/api/agent/${APPEND}`, { type: "get_state" });
    const beforeAppend = await api(`/api/sessions/${APPEND}`);
    assert.deepEqual(beforeAppend.context.entryIds, ["root", "reply"], "the wrapper must serve its own snapshot first");
    appendFileSync(file, `${JSON.stringify(message("external", "reply", "assistant", "E2E external append"))}\n`);
    const ordinaryRead = await api(`/api/sessions/${APPEND}`);
    assert.deepEqual(ordinaryRead.context.entryIds, ["root", "reply"], "post-turn reads must not probe disk");
    assert.equal(ordinaryRead.wrapperRebuilt, undefined);
    const afterForce = await api(`/api/sessions/${APPEND}?force=1`);
    assert.deepEqual(afterForce.context.entryIds, ["root", "reply", "external"], "a mount/refresh read must see the external append");
    assert.equal(afterForce.wrapperRebuilt, true);
    const again = await api(`/api/sessions/${APPEND}`);
    assert.deepEqual(again.context.entryIds, ["root", "reply", "external"], "repeated reads must stay stable");
    const appended = await api(`/api/sessions/${APPEND}/context?tail=1`);
    assert.deepEqual(appended.context.entryIds, ["external"], "the appended entry must be readable on its own");
    console.log("PASS: external session-file appends are visible on force/mount reads");
  }

  // Secondary provider identities stay out of pi's auth.json and project
  // defaults are snapshotted when each session is created.
  {
    const unsupported = await fetch(`${base}/api/auth/accounts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "not-a-provider", label: "Invalid", type: "oauth" }),
    });
    assert.equal(unsupported.status, 400);
    const invalidOAuth = await fetch(`${base}/api/auth/login/anthropic?accountId=missing`);
    assert.match(await invalidOAuth.text(), /OAuth account not found for provider/);
    const { account } = await post("/api/auth/accounts", { provider: "anthropic", label: "E2E work", type: "api_key" });
    assert.equal(account.authorized, false);
    secondaryAccountId = account.id;
    const secret = "e2e-secondary-key-only";
    await post(`/api/auth/accounts/${account.id}/api-key`, { apiKey: secret });
    const metadata = await api("/api/auth/accounts");
    assert.equal(JSON.stringify(metadata).includes(secret), false, "Account metadata must never contain credentials");
    assert.equal(metadata.accounts.find((entry) => entry.id === account.id).authorized, true);
    const response = await fetch(`${base}/api/auth/accounts/selection`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", cwd: project, provider: "anthropic", accountId: account.id }),
    });
    assert.equal(response.status, 200);
    const first = await post("/api/agent/new", { cwd: project, type: "ensure_session", toolNames: ["read"] });
    assert.equal((await api(`/api/auth/accounts/selection?cwd=${encodeURIComponent(project)}&sessionId=${first.sessionId}`)).session.anthropic, account.id);
    const removedDefault = await fetch(`${base}/api/auth/accounts/selection`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", cwd: project, provider: "anthropic", accountId: null }),
    });
    assert.equal(removedDefault.status, 200);
    assert.equal((await api(`/api/auth/accounts/selection?cwd=${encodeURIComponent(project)}&sessionId=${first.sessionId}`)).session.anthropic, account.id,
      "existing sessions must retain their project-default snapshot");
    const second = await post("/api/agent/new", { cwd: project, type: "ensure_session" });
    assert.deepEqual((await api(`/api/auth/accounts/selection?cwd=${encodeURIComponent(project)}&sessionId=${second.sessionId}`)).session, {});
    const switched = await fetch(`${base}/api/auth/accounts/selection`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "session", sessionId: first.sessionId, provider: "anthropic", accountId: null }),
    });
    assert.equal(switched.status, 200);
    const switchedId = (await switched.json()).sessionId;
    assert.ok(switchedId);
    assert.deepEqual((await api(`/api/auth/accounts/selection?cwd=${encodeURIComponent(project)}&sessionId=${switchedId}`)).session, {});
    const tools = (await post(`/api/agent/${switchedId}`, { type: "get_tools" })).data;
    assert.equal(tools.find((entry) => entry.name === "read")?.active, true);
    assert.equal(tools.find((entry) => entry.name === "bash")?.active, false,
      "transient account switches must retain the tool preset");
    const { account: other } = await post("/api/auth/accounts", { provider: "openai", label: "E2E other", type: "api_key" });
    await post(`/api/auth/accounts/${other.id}/api-key`, { apiKey: "e2e-other-key" });
    const setSession = (provider, accountId) => fetch(`${base}/api/auth/accounts/selection`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "session", sessionId: APPEND, provider, accountId }),
    });
    const changes = await Promise.all([setSession("anthropic", account.id), setSession("openai", other.id)]);
    assert.deepEqual(changes.map((entry) => entry.status), [200, 200]);
    assert.deepEqual((await api(`/api/auth/accounts/selection?cwd=${encodeURIComponent(project)}&sessionId=${APPEND}`)).session,
      { anthropic: account.id, openai: other.id }, "concurrent switches must preserve both providers");
    console.log("PASS: isolated account creation, metadata redaction, project defaults, transient switching and concurrent persisted switches");
  }

  });

  browser = await harness.launchBrowser(chromium, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {});
  // A live session keeps the context files it loaded until explicitly reloaded.
  if (group === "state") await coverage.run("state/agents-reload@default", async () => {
    const contextFile = join(otherProject, "AGENTS.md");
    const checkContext = await newInputContext("default");
    const checkPage = await checkContext.newPage();
    try {
      await post(`/api/agent/${OTHER}`, { type: "get_state" });
      await checkPage.goto(`${base}/?session=${OTHER}`, { waitUntil: "domcontentloaded" });
      await checkPage.getByText("Waiting for more work", { exact: true }).waitFor();
      const reloadNotice = checkPage.getByText("Session instructions changed on disk.", { exact: false });
      assert.equal(await reloadNotice.count(), 0);
      writeFileSync(contextFile, "New project instructions");
      await checkPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await reloadNotice.waitFor();
      await checkPage.getByRole("button", { name: "Reload session" }).click();
      await reloadNotice.waitFor({ state: "detached" });
      assert.equal((await api(`/api/agent/${OTHER}`)).state.contextFilesChanged, false);
      writeFileSync(contextFile, "Updated project instructions");
      await checkPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await reloadNotice.waitFor();
      console.log("PASS: live context changes offer a session reload and clear after applying");
    } finally {
      rmSync(contextFile, { force: true });
      await harness.closeContext(checkContext);
    }
  });
  for (const inputId of group === "state" ? []
    : group === "archive" || group === "mobile-sidebar" ? ["legacy-mobile"]
    : group === "diff-context" ? ["legacy-desktop"]
    : group === "activity" || group === "privacy" ? ["legacy-desktop", "legacy-tablet", "legacy-mobile"]
    : ["legacy-desktop", "legacy-mobile"]) {
    const { viewport } = browserInputs[inputId].options;
    context = await newInputContext(inputId);
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = harness.errorsFor(context);
    const olderResponses = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname === `/api/sessions/${LONG}/context` && url.searchParams.has("before")) olderResponses.push(response);
    });
    if (group === "diff-context") {
      await coverage.run(`diff-context/d409-render-merge-v2@${inputId}`, async () => {
        // The absent managed control is checked on a hydrated chat, just as in
        // the former general path. Explorer must precede the mutating merge.
        await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
        await page.locator(".markdown-code-block pre").waitFor();
        assert.equal(await page.getByRole("button", { name: "Workflow", exact: true }).count(), 0, "Managed Workflow controls must be absent");
        await checkGitExplorer(page, { base, sessionId: GIT, cwd: gitProject, targetWorktree });
        await checkIntegratedGitGraph(page, targetWorktree);
        assert.deepEqual(errors, [], `Browser errors during diff review at ${viewport.width}px`);
        await harness.closeContext(context); context = undefined; page = undefined;
      });
      continue;
    }
    if (group === "markdown") {
      await coverage.run(`markdown/${inputId === "legacy-desktop" ? "render-files-native-v3" : "render-touch-wiring-v2"}@${inputId}`, async () => {
      const finishMarkdownStage = stage.start(`markdown/${inputId}/chain`);
      // This added chunk-interception fixture needs no service worker. Existing
      // Markdown scenarios below retain their original, independent context.
      const highlightContext = await newInputContext(inputId, { serviceWorkers: "block" });
      const highlightErrors = harness.errorsFor(highlightContext);
      try {
        const highlightPage = await highlightContext.newPage();
        highlightPage.setDefaultTimeout(30_000);
        await stage(`markdown/${inputId}/source-highlighting`, async () => { await checkSourceHighlighting(highlightPage, base, highlightingFixture); });
        assert.deepEqual(highlightErrors, [], "Browser errors during source highlighting");
      } finally { await harness.closeContext(highlightContext); }
      // Missing webpack registration/retry is package-runtime behavior, not a
      // second responsive layout. Keep its independent cold context once; both
      // inputs above still exercise actual chunk execution and native Selection.
      if (inputId === "legacy-desktop") {
        const failureContext = await newInputContext(inputId, { serviceWorkers: "block" });
        const failureErrors = harness.errorsFor(failureContext);
        try {
          const failurePage = await failureContext.newPage();
          failurePage.setDefaultTimeout(30_000);
          await stage(`markdown/${inputId}/highlight-failure`, async () => { await checkHighlightFailure(failurePage, base, highlightingFixture); });
          assert.deepEqual(failureErrors, [], "Browser errors during grammar failure/retry");
        } finally { await harness.closeContext(failureContext); }
      }
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await page.locator(".markdown-code-block pre").waitFor();
      const wideList = page.locator(".markdown-body ol").filter({ hasText: "Upstream wide marker" });
      await wideList.waitFor();
      const marker = await wideList.evaluate((node) => ({ digits: node.style.getPropertyValue("--ol-marker-digits"), padding: parseFloat(getComputedStyle(node).paddingLeft), font: parseFloat(getComputedStyle(node).fontSize), start: node.start }));
      assert.equal(marker.digits, "4");
      assert.equal(marker.start, 999);
      assert.ok(marker.padding >= marker.font * 3, JSON.stringify(marker));
      await stage(`markdown/${inputId}/preview-natural-polls`, async () => { await checkMarkdownPreview(page, markdownFile); });
      await stage(`markdown/${inputId}/line-links`, async () => { await checkFileLineLinks(page, base, fileLineFixtures); });
      await stage(`markdown/${inputId}/workspace`, async () => { await checkFileWorkspace(page, base, fileLineFixtures, artifacts); });
      await stage(`markdown/${inputId}/media`, async () => { await checkMarkdownMedia(page, { base, fixtures: mediaFixtures }); });
      await stage(`markdown/${inputId}/review-notebooks`, async () => { await checkReviewNotebooks(page, { base, fixture: reviewNotebookFixture }); });
      await stage(`markdown/${inputId}/skill-instructions`, async () => { await checkSkillInstructions(page, base, followupSettings); });
      await stage(`markdown/${inputId}/model-overrides`, async () => { await checkModelOverrides(page, base, RICH, project); });
      await stage(`markdown/${inputId}/managed-model-context`, async () => { await checkManagedModelContextLayout(page); });
      await stage(`markdown/${inputId}/external-references`, async () => { await checkExternalReferenceBoundary(page, base, externalReferenceFixtures); });
      await stage(`markdown/${inputId}/blocked-preferences`, async () => { await checkPreferenceWiring(page, base, RICH); });
      assert.deepEqual(errors, [], "Browser errors during Markdown preview and line links");
      await harness.closeContext(context); context = undefined; page = undefined;
      finishMarkdownStage();
      });
      continue;
    }
    if (group === "file-edit") {
      await coverage.run(`file-edit/native-context-owned-source-tail-v3@${inputId}`, async () => {
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await page.locator(".markdown-code-block pre").waitFor();
      await checkFilePanel(page, previewFile);
      await checkWorkingFileContextBridge(page, editableFile);
      await checkEditableFile(page, editableFile);
      await checkExplorerUploads(page, { project, base });
      await checkOverflowTabs(page);
      assert.deepEqual(errors, [], "Browser errors during file editing");
      await harness.closeContext(context);
      context = undefined; page = undefined;
      });
      continue;
    }
    if (group === "archive") {
      await coverage.run(`archive/inline-restore@${inputId}`, async () => {
      const archiveResponse = await fetch(`${base}/api/sessions/${ARCHIVE}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      assert.equal(archiveResponse.status, 200);
      await page.goto(`${base}/?session=${ARCHIVE}`, { waitUntil: "domcontentloaded" });
      const archivedNotice = page.getByText("This session is archived. Restore it to show it in active sessions.");
      await archivedNotice.waitFor();
      await page.getByRole("button", { name: "Restore session", exact: true }).click();
      await archivedNotice.waitFor({ state: "detached" });
      assert.equal(new URL(page.url()).searchParams.get("session"), ARCHIVE);
      assert.equal((await api("/api/sessions?force=1")).sessions.find((session) => session.id === ARCHIVE)?.archived, undefined);
      assert.deepEqual(errors, [], "Browser errors during inline restoration");
      console.log("PASS: archived chat restores inline and remains open");
      await harness.closeContext(context);
      context = undefined;
      page = undefined;
      });
      continue;
    }
    if (group === "privacy") {
      await coverage.run(`privacy/native-owned-v3@${inputId}`, async () => {
        await checkProjectPrivacy(page, viewport.width, { base, api, post, harness, selectedSessionId: BRANCH, otherSessionId: OTHER });
        assert.deepEqual(errors, [], `Project privacy browser errors at width ${viewport.width}`);
        await harness.closeContext(context); context = undefined; page = undefined;
      });
      continue;
    }
    if (group === "activity") {
      const activityScenario = inputId === "legacy-desktop" ? "activity/native-state-recipe-owned-v4" : "activity/compact-state-recipe-owned-v4";
      await coverage.run(`${activityScenario}@${inputId}`, async () => {
      const finishActivityStage = stage.start(`activity/${inputId}/chain`);
      // Seed only after the selected chat has loaded, so clicking its newly
      // discovered Activity row must refresh the warning in that same chat.
      await stage(`activity/${inputId}/overview`, async () => { await checkActivityOverview(page, viewport.width, {
        base, api, post, artifacts, harness, waitingSessionId: RICH, selectedSessionId: BRANCH, otherSessionId: OTHER,
        seedInterruptedRun: () => seedRecoveryRun(`${viewport.width}-activity-recovery`),
        subagentIds: ACTIVITY_SUBAGENTS,
        seedSubagentCompletions: () => {
          const path = join(agentDir, "pi-web", "activity-review.json");
          return new Map([BRANCH, ...ACTIVITY_SUBAGENTS].map((sessionId) => {
            const { at } = activityReview.recordActivityCompletion(sessionId, path);
            return [sessionId, at];
          }));
        },
      }); });
      if (inputId === "legacy-desktop") {
        // One complete coherent native S/P/X chain. Responsive receipts below
        // name their smaller ownership honestly, without native-status fakes.
        await stage(`activity/${inputId}/subagent-lifecycle`, async () => { await checkSubagentLifecycle(page, { base, api, post, root, agentDir, width: viewport.width, returnSessionId: BRANCH }); });
        await stage(`activity/${inputId}/session-pause`, async () => { await checkSessionPause(page, { base, api, post, root, agentDir, artifacts, width: viewport.width, returnSessionId: BRANCH }); });
        await stage(`activity/${inputId}/project-acceptance`, async () => { await checkProjectAcceptance(page, { base, api, post, project, width: viewport.width, returnSessionId: BRANCH }); });
      } else {
        await stage(`activity/${inputId}/acceptance-responsive-ui`, async () => {
          await checkAcceptanceResponsive(page, { base, api, project, width: viewport.width, returnSessionId: BRANCH });
        });
        if (inputId === "legacy-mobile") {
          // S keeps its real global definition, enabled-model settings, provider
          // extension and project directory after deleting the native family.
          // Reuse that actual project's model availability; do not repeat the SDK
          // lifecycle or fabricate /api/models to reach the mobile selector.
          await stage(`activity/${inputId}/subagent-settings-ui`, async () => {
            await page.goto(`${base}/?cwd=${encodeURIComponent(join(agentDir, "subagent-project-1280"))}`, { waitUntil: "domcontentloaded" });
            await checkSubagentModelSettings(page, { width: viewport.width });
            await page.goto(`${base}/?session=${BRANCH}`, { waitUntil: "domcontentloaded" });
            await page.getByText("Active branch answer", { exact: true }).waitFor();
          });
        }
      }
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      await harness.closeContext(context);
      context = undefined;
      page = undefined;
      finishActivityStage();
      });
      continue;
    }
    if (group === "accounts") {
      await coverage.run(`accounts/created-device-owner-v3@${inputId}`, async () => {
      const { oauthProviders } = await api("/api/auth/providers");
      const oauthEntry = oauthProviders.find((item) => item.id === "github-copilot") ?? oauthProviders[0];
      assert.ok(oauthEntry, "OAuth provider required for account browser fixture");
      const { account } = await post("/api/auth/accounts", { provider: oauthEntry.id, label: `E2E device ${viewport.width}`, type: "oauth" });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await checkProviderAccountAuthorization(page, { base, sessionId: RICH, provider: oauthEntry.id,
        providerName: oauthEntry.name, accountId: account.id, accountLabel: account.label, width: viewport.width, artifacts });
      const removedFixture = await fetch(`${base}/api/auth/accounts`, { method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id }) });
      assert.equal(removedFixture.status, 200);
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      await harness.closeContext(context);
      context = undefined;
      page = undefined;
      });
      continue;
    }
    if (group === "questions") {
      await coverage.run(`questions/${inputId === "legacy-desktop" ? "native-publication-v2" : "compact-native-v2"}@${inputId}`, async () => {
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await page.locator(".markdown-code-block pre").waitFor();
      if (inputId === "legacy-desktop") {
        const { data: tools } = await post(`/api/agent/${RICH}`, { type: "get_tools" });
        assert.deepEqual(tools.filter((tool) => tool.name === "ask_user").map((tool) => tool.active), [true]);
        assert.match(tools.find((tool) => tool.name === "ask_user").description, /^Ask the user a question/);
      }
      await checkAskUserDialog(page, viewport.width);
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      await harness.closeContext(context);
      context = undefined;
      page = undefined;
      });
      continue;
    }
    if (group === "session-links") {
      await coverage.run(`session-links/copy-follow@${inputId}`, async () => {
      await page.goto(`${base}/?session=${ARCHIVE}`, { waitUntil: "domcontentloaded" });
      await page.getByText("E2E archive fixture", { exact: true }).first().waitFor();
      if (viewport.width <= 600) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
      const row = page.locator(`[data-session-id="${ARCHIVE}"]`);
      await row.scrollIntoViewIfNeeded();
      if (viewport.width <= 600) await row.getByRole("button", { name: "Session actions" }).click();
      else await row.hover();
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await row.getByRole("button", { name: "Copy session link" }).click();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(link, `${base}/?session=${ARCHIVE}`);
      assert.equal(new URL(page.url()).searchParams.get("session"), ARCHIVE);
      await page.goto(link, { waitUntil: "domcontentloaded" });
      await page.getByText("E2E archive fixture", { exact: true }).first().waitFor();
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      console.log(`PASS: ${viewport.width}px copied session URL opens the saved chat without changing selection`);
      await harness.closeContext(context);
      context = undefined;
      page = undefined;
      });
      continue;
    }
    if (group === "bulk") {
      await coverage.run(`bulk/native-selection-mutations-v2@${inputId}`, async () => {
      const ids = viewport.width <= 600 ? BULK.slice(2) : BULK.slice(0, 2);
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      if (viewport.width <= 600) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
      const first = page.locator(`[data-session-id="${ids[0]}"]`);
      const second = page.locator(`[data-session-id="${ids[1]}"]`);
      const select = page.getByRole("button", { name: "Select", exact: true });
      await select.waitFor();
      assert.equal(await first.getByRole("checkbox").count(), 0, "Selection controls stay hidden until Select");
      await select.click();
      await first.scrollIntoViewIfNeeded();
      await first.getByRole("checkbox").check();
      await second.scrollIntoViewIfNeeded();
      await second.getByRole("checkbox").check();
      await page.getByText("2 selected", { exact: true }).waitFor();
      // Failed-only retry/currentness are actual Sidebar lower-owner cases.
      // Keep one installed control -> native mutation -> catalogue bridge.
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await first.waitFor({ state: "detached" });
      await select.waitFor({ state: "visible" }); // all admitted family mutations exited selection
      const archivedSessions = (await api("/api/sessions?force=1")).sessions;
      assert.ok(ids.every((id) => archivedSessions.find((s) => s.id === id)?.archived === true));
      await page.getByRole("button", { name: "Archived sessions", exact: true }).click();
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await first.scrollIntoViewIfNeeded();
      await first.getByRole("checkbox").check();
      await second.scrollIntoViewIfNeeded();
      await second.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await first.waitFor({ state: "detached" });
      await select.waitFor({ state: "visible" }); // do not join the second family via the first row or GET
      await page.getByRole("button", { name: "Active sessions", exact: true }).click();
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await first.scrollIntoViewIfNeeded();
      await first.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByText("Permanently delete selected sessions (1) and their subagents? Forks will remain.").waitFor();
      assert.ok((await api("/api/sessions?force=1")).sessions.some((s) => s.id === ids[0]), "Delete requires confirmation");
      await page.getByRole("button", { name: "Delete", exact: true }).last().click();
      await first.waitFor({ state: "detached" });
      assert.ok(!(await api("/api/sessions?force=1")).sessions.some((s) => s.id === ids[0]));
      assert.ok((await api("/api/sessions?force=1")).sessions.some((s) => s.id === ids[1]));
      assert.equal(await second.getByRole("checkbox").count(), 0, "Selection mode exits after success");
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      console.log(`PASS: ${viewport.width}px opt-in bulk archive, restore, and confirmed delete`);
      await harness.closeContext(context);
      context = undefined;
      page = undefined;
      });
      continue;
    }
    if (group === "move") {
      await coverage.run(`move/${inputId === "legacy-desktop" ? "picker-recovery-native-v2" : "picker-modal-browse-v2"}@${inputId}`, async () => {
      const moveId = viewport.width <= 600 ? ARCHIVE : APPEND;
      await checkSessionMovePicker(page, { base, api, post, agentDir, sessionId: moveId, project, otherProject, gitProject, targetWorktree, mobile: viewport.width <= 600 });
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      console.log(`PASS: ${viewport.width}px native move picker/Browse and selected-uncertain shell boundary; desktop recovery execution`);
      await harness.closeContext(context);
      context = undefined;
      page = undefined;
      });
      continue;
    }
    if (group === "history") {
    await coverage.run(`history/installed-thinking-body-native-v4@${inputId}`, async () => {
    const finishHistoryStage = stage.start(`history/${inputId}/chain`);
    // Interception needs its own SW-blocked context. The original history/PWA
    // context below stays unchanged, and reload cannot alter its reading state.
    const finishVersionStage = stage.start(`history/${inputId}/version-reload`);
    const versionContext = await newInputContext(inputId, { serviceWorkers: "block" });
    const versionErrors = harness.errorsFor(versionContext);
    const versionPage = await versionContext.newPage();
    versionPage.setDefaultTimeout(30_000);
    const versionPattern = "**/api/app-version";
    const versionRoute = createOwnedRoutes(route => route.fulfill({ json: { version: "99.99.99" } }), route => route.continue());
    try {
      const initialVersion = versionPage.waitForResponse(response => new URL(response.url()).pathname === "/api/app-version");
      void initialVersion.catch(() => {});
      await versionPage.bringToFront();
      await versionPage.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      assert.equal(await versionPage.evaluate(() => document.visibilityState), "visible");
      assert.equal((await (await initialVersion).json()).version, null, "isolated fixtures disable live version checks");
      await versionPage.getByText("E2E final answer", { exact: true }).waitFor();
      const reloadWeb = versionPage.getByRole("button", { name: "Reload Pi Web" });
      assert.equal(await reloadWeb.count(), 0, "The running version should not show a reload prompt");
      await versionPage.route(versionPattern, versionRoute.handler);
      const changedVersion = versionPage.waitForResponse(response => new URL(response.url()).pathname === "/api/app-version");
      void changedVersion.catch(() => {});
      await versionPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      assert.equal((await (await changedVersion).json()).version, "99.99.99");
      await reloadWeb.waitFor();
      assert.ok(await versionPage.getByText("Pi Web v99.99.99 is running.").isVisible());
      versionPage.once("dialog", (dialog) => dialog.dismiss());
      await reloadWeb.click();
      await reloadWeb.waitFor();
      await versionRoute.dispose(handler => versionPage.unroute(versionPattern, handler));
      versionPage.once("dialog", (dialog) => dialog.accept());
      await Promise.all([versionPage.waitForNavigation(), reloadWeb.click()]);
      await reloadWeb.waitFor({ state: "detached" });
      assert.deepEqual(versionErrors, [], "Browser errors during version mismatch/reload");
      console.log(`PASS: ${viewport.width}px version mismatch prompts before page reload`);
    } finally {
      try { await versionRoute.dispose(handler => versionPage.unroute(versionPattern, handler)); }
      finally { await harness.closeContext(versionContext); }
    }
    finishVersionStage();
    await stage(`history/${inputId}/composer`, async () => { await checkUpstreamComposer(context, base, RICH, LONG, viewport.width); });
    const finishPaginationStage = stage.start(`history/${inputId}/identity-pagination`);
    const stateReady = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/sessions/${LONG}/state`);
    await page.goto(`${base}/?session=${LONG}`, { waitUntil: "domcontentloaded" });
    assert.equal((await stateReady).status(), 200);
    await page.getByText(text(4999), { exact: true }).waitFor();
    const mobileIdentity = page.locator('[data-mobile-session-identity="true"]');
    if (viewport.width <= 600) {
      await mobileIdentity.waitFor();
      assert.equal(await mobileIdentity.locator(".mobile-session-title").textContent(), text(0));
      assert.equal(await mobileIdentity.locator(".mobile-session-project").textContent(), "project");
      assert.equal(await mobileIdentity.locator(".mobile-session-project").getAttribute("title"), project);
      assert.ok(await mobileIdentity.evaluate((element) => element.scrollWidth <= element.clientWidth), "Mobile identity must not overflow the viewport");
      const topActions = page.locator(".top-bar-actions");
      const sidebarToggle = page.getByRole("button", { name: "Show sidebar" });
      const sidebarX = (await sidebarToggle.boundingBox()).x;
      assert.equal(await topActions.evaluate((element) => getComputedStyle(element).scrollbarWidth), "none");
      const scrolled = await topActions.evaluate((element) => {
        const overflow = element.scrollWidth - element.clientWidth;
        element.scrollTo({ left: overflow, behavior: "instant" });
        return { overflow, scrollLeft: element.scrollLeft };
      });
      assert.ok(scrolled.overflow > 0 && scrolled.scrollLeft > 0, "Mobile actions must scroll horizontally");
      assert.equal((await sidebarToggle.boundingBox()).x, sidebarX, "Sidebar toggle must stay pinned while scrolling");
      assert.ok(await page.locator('[data-mobile-toolbar-file="true"]').isVisible(), "Trailing file control must be reachable");
      for (const label of ["Git Explorer"]) {
        const button = page.getByRole("button", { name: label, exact: true });
        await button.scrollIntoViewIfNeeded();
        assert.ok(await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const strip = element.closest(".top-bar-actions").getBoundingClientRect();
          return rect.left >= strip.left && rect.right <= strip.right;
        }), `${label} remains reachable in the scroll row`);
      }
    } else {
      assert.equal(await mobileIdentity.count(), 0, "Desktop chat should not gain a mobile identity row");
    }
    const latestUser = await page.getByText(text(4998), { exact: true }).elementHandle();
    assert.ok(latestUser, "Latest user message must be mounted before pagination");
    const sentinel = page.getByText("Scroll up to load earlier messages", { exact: true });
    await sentinel.waitFor({ state: "attached" });
    assert.equal(await page.getByText(text(4949), { exact: true }).count(), 0);

    // Exercise the real IntersectionObserver and prepend path, twice.
    for (let turn = 0; turn < 2; turn++) {
      const before = `e${4950 - turn * 50}`;
      const responsePromise = page.waitForResponse((response) => historyPageResponse(response, LONG, before));
      await sentinel.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
      const response = await responsePromise;
      const older = (await response.json()).context;
      const firstMessage = older.messages.find((message) => message.role === "user")?.content;
      assert.equal(typeof firstMessage, "string", "Older page must contain user messages");
      await page.getByText(firstMessage, { exact: true }).waitFor({ state: "attached" });
      await page.getByText(text(4999), { exact: true }).evaluate((element) => element.scrollIntoView({ block: "end", behavior: "instant" }));
    }
    assert.deepEqual(await latestUser.evaluate((element) => ({
      connected: element.isConnected,
      text: element.textContent,
    })), { connected: true, text: text(4998) }, "Prepending history must preserve existing message nodes");
    await latestUser.dispose();
    assert.ok(olderResponses.length >= 2, "Scrolling must fetch consecutive older pages");
    let oldest = Number(new URL(olderResponses[0].url()).searchParams.get("before")?.slice(1));
    assert.ok(Number.isInteger(oldest), "Older page must include a numeric before cursor");
    for (const response of olderResponses) {
      assert.equal(response.status(), 200);
      assert.equal(new URL(response.url()).searchParams.get("before"), `e${oldest}`);
      const older = (await response.json()).context;
      assert.deepEqual(older.entryIds, ids(oldest - 50, oldest));
      assert.equal(older.messages.length, 50);
      oldest -= 50;
      assert.equal(older.oldestEntryId, `e${oldest}`);
      assert.equal(older.hasMore, true);
    }
    const rendered = await page.getByText(/^E2E message \d{4}$/).allTextContents();
    // The sidebar also displays the first message as the session title.
    assert.deepEqual(rendered.filter((value) => value !== text(0)),
      Array.from({ length: 5000 - oldest }, (_, i) => text(oldest + i)), "Missing, reordered, or duplicate chat messages");
    await page.screenshot({ path: join(artifacts, `history-${viewport.width}.png`) });
    finishPaginationStage();
    const finishRecoveryStage = stage.start(`history/${inputId}/recovery`);

    await page.goto(`${base}/?session=${BRANCH}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Active branch answer", { exact: true }).waitFor();
    if (viewport.width <= 600) {
      await page.locator('.mobile-session-title').getByText("Branch root", { exact: true }).waitFor();
    }
    assert.equal(await page.getByText("Inactive branch answer", { exact: true }).count(), 0);
    const interruption = page.getByText("A previous run may have been interrupted", { exact: false });
    if (viewport.width === 1280) {
      await interruption.waitFor();
      await page.getByRole("button", { name: /^Activity/ }).click();
      const overview = page.getByRole("region", { name: "Activity" });
      const interruptedRow = overview.locator(".activity-item-interrupted").filter({ hasText: "Branch root" });
      await interruptedRow.waitFor();
      await interruptedRow.click();
      await interruption.waitFor();
      await page.getByRole("button", { name: "Close Activity" }).click();
      await page.reload({ waitUntil: "domcontentloaded" });
      await interruption.waitFor();
      await page.getByRole("button", { name: "Dismiss" }).click();
      await interruption.waitFor({ state: "detached" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Active branch answer", { exact: true }).waitFor();
      assert.equal(await interruption.count(), 0);
    } else {
      assert.equal(await interruption.count(), 0, "acknowledgement persists across tabs");
    }
    console.log("PASS: interrupted run notice survives reload until dismissed and never replaces saved history");
    finishRecoveryStage();
    const finishReadingStage = stage.start(`history/${inputId}/rendering-reading-branch`);
    await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
    await page.locator("strong").filter({ hasText: "E2E markdown" }).waitFor();
    await page.locator("pre").filter({ hasText: "console.log('E2E code');" }).waitFor();
    await page.getByText("E2E final answer", { exact: true }).waitFor();
    const processDetails = page.getByRole("button", { name: /^Process details/ });
    const thinking = page.getByRole("button", { name: /^Thinking/ });
    // Exact three-read/body/cache/order policy has its actual lower owner.
    // Retain the installed Process -> Thinking -> real body at THIS profile.
    await processDetails.click();
    await thinking.first().click();
    await page.getByText("Intermediate thinking details.", { exact: false }).waitFor();
    await page.getByText("echo E2E tool output", { exact: true }).waitFor();
    await page.getByRole("button", { name: /bash.*echo E2E tool output/ }).click();
    await page.getByText("E2E tool output", { exact: true }).waitFor();
    await stage(`history/${inputId}/tool-arguments`, async () => { await checkToolArguments(page, toolArgumentFixtures, { artifacts, width: viewport.width }); });
    await page.goto(`${base}/?session=${COMPACTED}`, { waitUntil: "domcontentloaded" });
    const heading = page.getByRole("heading", { name: "E2E compacted heading", exact: true });
    await heading.waitFor({ state: "attached" });
    if (viewport.width > 600) {
      const node = page.locator("[data-minimap-node-index='0']");
      await node.waitFor();
      const rect = await node.boundingBox();
      assert.ok(rect);
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const preview = page.locator("[data-minimap-preview-box]");
      await preview.getByRole("button", { name: "E2E compaction anchor", exact: true }).waitFor();
      await preview.getByRole("button", { name: "E2E compacted heading", exact: true }).click();
      await page.waitForFunction(() => {
        const heading = document.querySelector("[data-entry-id='answer'] h2");
        const scroll = heading?.closest(".overflow-y-auto");
        return heading && scroll && Math.abs(heading.getBoundingClientRect().top
          - scroll.getBoundingClientRect().top - scroll.clientHeight * 0.3) < 5;
      });
      await page.screenshot({ path: join(artifacts, "compaction-minimap.png") });

      const selectSession = async (title, entryId) => {
        // Select the actual row, not a clipped label or its hover actions.
        await page.locator(".session-row").filter({ has: page.getByTitle(title, { exact: true }) })
          .click({ position: { x: 12, y: 12 } });
        await page.locator(`[data-entry-id="${entryId}"]:not([data-message-role])`).waitFor({ state: "visible" });
      };
      const readingOffset = (target) => target.evaluate((element) => (
        element.getBoundingClientRect().top - element.closest(".overflow-y-auto").getBoundingClientRect().top
      ));
      const positionForReading = async (target) => {
        const offset = await target.evaluate(async (element) => {
          // A response/attached row can precede pagination's post-layout anchoring.
          // Establish a real visible reading position, not an off-screen snapshot.
          const layout = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await layout();
          const scroll = element.closest(".overflow-y-auto");
          scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 120;
          await layout();
          return element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
        });
        assert.ok(Math.abs(offset - 120) < 5, `Reading fixture must settle at its visible anchor, got ${offset}`);
        return offset;
      };
      await selectSession(text(0), "e4999");
      const olderPage = page.waitForResponse((response) => response.url().includes(`/api/sessions/${LONG}/context?`));
      await page.getByText("Scroll up to load earlier messages", { exact: true }).evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
      await olderPage;
      const olderMessage = page.locator("[data-entry-id='e4920']");
      const olderOffset = await positionForReading(olderMessage);
      await selectSession("Render **E2E markdown**", "user");
      const process = page.getByRole("button", { name: /process details/i });
      await process.click();
      const answerHeading = page.getByRole("heading", { name: "E2E reading position", exact: true });
      const answerOffset = await positionForReading(answerHeading);
      await selectSession(text(0), "e4920");
      // The message can become visible before its post-layout scroll restoration runs.
      await page.waitForFunction(({ expected }) => {
        const element = document.querySelector('[data-entry-id="e4920"]:not([data-message-role])');
        const scroll = element?.closest(".overflow-y-auto");
        return element && scroll && Math.abs(element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - expected) < 5;
      }, { expected: olderOffset }, { timeout: 8000 });
      assert.ok(Math.abs(await readingOffset(olderMessage) - olderOffset) < 5, "Returning to older history must restore its reading offset");
      await selectSession("Render **E2E markdown**", "user");
      assert.equal(await process.getAttribute("aria-expanded"), "false");
      assert.ok(Math.abs(await readingOffset(answerHeading) - answerOffset) < 5, "Collapsing process details on remount must not displace the answer");

      // Hold pagination until a different branch has loaded, exercising effect cancellation.
      let releaseHistory;
      const historyGate = new Promise((resolve) => { releaseHistory = resolve; });
      const contextRoute = `**/api/sessions/${LONG}/context?*`;
      await page.route(contextRoute, async (route) => {
        if (new URL(route.request().url()).searchParams.has("before")) await historyGate;
        await route.continue().catch(() => {});
      });
      // Context loading is real; avoid starting an agent just to persist the test branch.
      const agentRoute = `**/api/agent/${LONG}`;
      await page.route(agentRoute, (route) => route.fulfill({ json: {} }));
      try {
        const pendingHistory = page.waitForRequest((request) => request.url().includes(`/api/sessions/${LONG}/context?`) && new URL(request.url()).searchParams.has("before"));
        await page.locator(`[title="${text(0)}"]`).click();
        await pendingHistory;
        await page.getByRole("button", { name: "Branches", exact: true }).click();
        await page.getByText("E2E alternate history branch", { exact: true }).click();
        await page.locator("[data-entry-id='alternate']:not([data-message-role])").waitFor({ state: "visible" });
        await page.screenshot({ path: join(artifacts, "scroll-restore-branch.png") });
      } finally {
        releaseHistory();
        await page.unroute(contextRoute);
        await page.unroute(agentRoute);
      }
      console.log("PASS: session reading offsets, collapsed process details, and cancelled branch restoration");
      await page.goto(`${base}/?session=${COMPACTED}`, { waitUntil: "domcontentloaded" });
      await heading.waitFor({ state: "visible" });
    }
    finishReadingStage();
    await stage(`history/${inputId}/bottom-follow`, async () => { await checkChatBottomFollow(page, { base, id: RICH, timestamp }); });
    await stage(`history/${inputId}/streamed-tool-arguments`, async () => { await checkStreamedToolArguments(page, { base, id: RICH, timestamp }); });
    await stage(`history/${inputId}/compaction`, async () => { await checkCompactionVisibility(page, { base, id: COMPACTED, artifacts, width: viewport.width }); });
    assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
    console.log(`PASS: ${viewport.width}px browser pagination, branch, markdown, code, tool call, and compaction navigation`);
    await harness.closeContext(context);
    context = undefined;
    page = undefined;
    finishHistoryStage();
    });
    continue;
    }
    if (group === "extension-dialogs") {
      await coverage.run(`extension-dialogs/${inputId === "legacy-desktop" ? "wrap-native-publication-v2" : "compact-wrap-native-v2"}@${inputId}`, async () => {
        await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
        await page.locator(".markdown-code-block pre").waitFor();
        await checkExtensionDialogs(page, artifacts, viewport.width);
        assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
        await harness.closeContext(context); context = undefined; page = undefined;
      });
      continue;
    }
    if (group === "mobile-sidebar") {
      await coverage.run(`mobile-sidebar/compact-search-native-rename-restore-move-v3@${inputId}`, async () => {
      await page.goto(`${base}/?session=${ARCHIVE}`, { waitUntil: "domcontentloaded" });
      await page.getByText("E2E archive fixture", { exact: true }).first().waitFor();
      await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
      const row = page.locator(`[data-session-id="${ARCHIVE}"]`);
      await row.scrollIntoViewIfNeeded();
      const actionsToggle = row.getByRole("button", { name: "Session actions", exact: true });
      const archiveButton = row.getByRole("button", { name: "Archive", exact: true });
      await actionsToggle.waitFor({ state: "visible" });
      assert.ok(await actionsToggle.evaluate((button) => button.getBoundingClientRect().width <= 34));
      assert.equal(await archiveButton.isVisible(), false, "Only the compact toggle should show initially");
      await actionsToggle.click();
      await archiveButton.waitFor({ state: "visible" });
      assert.equal(await actionsToggle.getAttribute("aria-expanded"), "true");
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await row.getByRole("button", { name: "Copy session link" }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${base}/?session=${ARCHIVE}`);
      assert.equal(new URL(page.url()).searchParams.get("session"), ARCHIVE, "Copy must not select a different row");
      await actionsToggle.click();
      await page.keyboard.press("Escape");
      assert.equal(await archiveButton.isVisible(), false, "Escape should collapse the actions");
      await actionsToggle.click();
      await archiveButton.waitFor({ state: "visible" });
      const iconOffset = await archiveButton.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        const icon = button.querySelector("svg").getBoundingClientRect();
        return [Math.abs((icon.left + icon.right - bounds.left - bounds.right) / 2),
          Math.abs((icon.top + icon.bottom - bounds.top - bounds.bottom) / 2)];
      });
      assert.ok(iconOffset.every((offset) => offset <= 1), `Archive icon is off-center: ${iconOffset}`);
      await archiveButton.click();
      await row.waitFor({ state: "detached" });
      assert.equal((await api("/api/sessions")).sessions.find((session) => session.id === ARCHIVE)?.archived, true);
      const searchToggle = page.getByRole("button", { name: "Search conversations", exact: true });
      await searchToggle.click();
      await page.getByRole("searchbox", { name: "Search conversations..." }).fill("E2E archive fixture");
      await page.getByRole("checkbox", { name: "Active and archived" }).check();
      await page.getByRole("button", { name: /E2E archive fixture/ }).waitFor();
      const titlesOnly = page.getByRole("checkbox", { name: "Titles only", exact: true });
      await titlesOnly.check();
      await page.getByText("No matching conversations in this scope").waitFor();
      // Preserve the exact native title-before/after-rename query bridge. The
      // exhaustive single-toggle request/result matrix is actual Sidebar-owned.
      const renameResponse = await fetch(`${base}/api/sessions/${ARCHIVE}`, {
        method: "PATCH", body: JSON.stringify({ name: "E2E archive fixture" }), signal: AbortSignal.timeout(30_000),
      });
      await renameResponse.arrayBuffer(); // full native response before any status assertion
      assert.equal(renameResponse.status, 200);
      await titlesOnly.uncheck();
      await titlesOnly.check();
      await page.getByRole("button", { name: /E2E archive fixture/ }).waitFor();
      await titlesOnly.uncheck();
      await page.getByRole("checkbox", { name: "Active and archived" }).uncheck();
      await page.getByRole("searchbox", { name: "Search conversations..." }).fill("Other workspace task");
      await page.getByRole("checkbox", { name: "All projects" }).check();
      await page.getByRole("button", { name: /Other workspace task/ }).waitFor();
      await searchToggle.click();
      await page.getByRole("button", { name: "Archived sessions", exact: true }).click();
      // Finish reopening/reconciliation before testing restore. The notice can
      // render while SSE is still starting an old wrapper; restoring then races
      // that startup against the newly appended restore entry (Branch changed).
      const archivedSnapshot = await api(`/api/sessions/${ARCHIVE}?force=1`);
      const archivedAnchor = archivedSnapshot.leafId;
      const reopenedContext = page.waitForResponse((response) => {
        const address = new URL(response.url());
        return address.pathname === `/api/sessions/${ARCHIVE}/context`
          && address.searchParams.get("ancestorId") === archivedAnchor;
      });
      // Own the complete admitted response body even if the independent UI wait
      // fails. The result adapter preserves original errors, not a no-op catch.
      const reopenedRead = reopenedContext.then(async response => ({ response, body: await response.json() }));
      const reopenedOutcome = reopenedRead.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
      let reopenedUi = { ok: true };
      try {
        await row.getByText("E2E archive fixture", { exact: true }).click();
        await page.getByText("This session is archived. Restore it to show it in active sessions.").waitFor();
      } catch (error) { reopenedUi = { ok: false, error }; }
      const reopenedResult = await reopenedOutcome;
      const reopenedFailures = [];
      if (!reopenedUi.ok) reopenedFailures.push(reopenedUi.error);
      if (!reopenedResult.ok) reopenedFailures.push(reopenedResult.error);
      if (reopenedFailures.length === 1) throw reopenedFailures[0];
      if (reopenedFailures.length) throw new AggregateError(reopenedFailures, "Archived receiving UI and native response failed");
      const { response: reopenedResponse, body: reopenedBody } = reopenedResult.value;
      assert.equal(reopenedResponse.status(), 200);
      assert.deepEqual(reopenedBody.context.entryIds, archivedSnapshot.context.entryIds);
      await page.getByRole("button", { name: "Restore session", exact: true }).click();
      await page.getByText("This session is archived. Restore it to show it in active sessions.").waitFor({ state: "detached" });
      await row.waitFor({ state: "detached" });
      assert.equal(new URL(page.url()).searchParams.get("session"), ARCHIVE, "Inline restore should keep the chat open");
      assert.equal((await api("/api/sessions")).sessions.find((session) => session.id === ARCHIVE)?.archived, undefined);
      console.log("PASS: mobile session archive and inline restore keep the chat open without a page reload");
      await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
      await page.getByRole("button", { name: "Active sessions", exact: true }).click();
      await row.getByRole("button", { name: "Session actions", exact: true }).click();
      await row.getByRole("button", { name: "Move to project…", exact: true }).click();
      const moveDialog = page.getByRole("dialog", { name: "Move to project…" });
      await moveDialog.getByLabel("Destination project").click();
      await moveDialog.locator(`button[role="option"][data-value="${otherProject}"]`).click();
      await moveDialog.getByRole("button", { name: "Move", exact: true }).click();
      await moveDialog.waitFor({ state: "detached" });
      // Moving the open chat now retargets its replacement working context to
      // the confirmed destination (also safe when the source has vanished).
      // Verify the refreshed destination list, not disappearance from a source
      // list the UI no longer displays.
      await page.getByRole("button").and(page.getByTitle(otherProject, { exact: true })).waitFor();
      await row.waitFor({ state: "visible" });
      await page.locator(`[data-session-id="${OTHER}"]`).waitFor({ state: "visible" });
      const moved = (await api("/api/sessions?force=1")).sessions.find((session) => session.id === ARCHIVE);
      assert.equal(moved?.cwd, otherProject);
      assert.equal(moved?.projectRoot, otherProject);
      await page.goto(`${base}/?session=${OTHER}`, { waitUntil: "domcontentloaded" });
      await page.locator('.mobile-session-title').getByText("Other workspace task", { exact: true }).waitFor();
      assert.equal(await page.locator('.mobile-session-project').textContent(), "other-project");
      console.log("PASS: mobile session move changes the saved project and refreshes the sidebar");
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      await harness.closeContext(context); context = undefined; page = undefined;
      });
      continue;
    }
    assert.fail(`No browser scenario dispatch for ${group}`);
  }
  if (group === "state") await coverage.run("state/durable-account@default", async () => {
  context = await newInputContext("default");
  page = await context.newPage();
  await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Account for/ }).click();
  await page.getByLabel("Account provider").selectOption("anthropic");
  const accountPicker = page.getByLabel("Session account", { exact: true });
  const waitForAccountSave = (accountId) => {
    const pending = page.waitForResponse((response) => {
      if (new URL(response.url()).pathname !== "/api/auth/accounts/selection" || response.request().method() !== "PUT") return false;
      const body = response.request().postDataJSON();
      return body.scope === "session" && body.sessionId === RICH && body.provider === "anthropic" && body.accountId === accountId;
    });
    void pending.catch(() => {});
    return pending;
  };
  // selectOption dispatches change, not completion of the asynchronous durable write.
  const accountSaved = waitForAccountSave(secondaryAccountId);
  await accountPicker.selectOption(secondaryAccountId);
  assert.equal((await accountSaved).status(), 200);
  assert.equal((await api(`/api/auth/accounts/selection?cwd=${encodeURIComponent(project)}&sessionId=${RICH}`)).session.anthropic, secondaryAccountId);
  console.log("PASS: browser session account selector persists an idle-session switch");
  const removed = await fetch(`${base}/api/auth/accounts`, {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: secondaryAccountId }),
  });
  assert.equal(removed.status, 200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Account for/ }).click();
  await page.getByLabel("Account provider").selectOption("anthropic");
  const unavailablePicker = page.getByLabel("Session account", { exact: true });
  // The deleted binding is already selected. Selecting it again issues a real
  // rejected PUT, rather than testing restoration/display of the saved binding.
  assert.equal(await unavailablePicker.inputValue(), secondaryAccountId);
  assert.equal(await unavailablePicker.locator("option:checked").innerText(), "Unavailable account");
  const accountCleared = waitForAccountSave(null);
  await unavailablePicker.selectOption("");
  assert.equal((await accountCleared).status(), 200);
  assert.deepEqual((await api(`/api/auth/accounts/selection?cwd=${encodeURIComponent(project)}&sessionId=${RICH}`)).session, {});
  console.log("PASS: deleted account remains visible and can be explicitly switched to Pi default");
  await harness.closeContext(context);
  context = undefined;
  page = undefined;
  });

  if (group === "accounts") {
    const { oauthProviders } = await api("/api/auth/providers");
    const oauthEntry = oauthProviders.find((item) => item.id === "github-copilot") ?? oauthProviders[0];
    assert.ok(oauthEntry, "OAuth provider required for browser authorization fixture");
    const oauthProvider = oauthEntry.id;
    const { account: deviceAccount } = await post("/api/auth/accounts", { provider: oauthProvider, label: "E2E device", type: "oauth" });
    for (const inputId of ["en-desktop", "en-mobile-short"]) await coverage.run(`accounts/shared-device-owner-v3@${inputId}`, async () => {
      const { viewport } = browserInputs[inputId].options;
      context = await newInputContext(inputId);
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await checkProviderAccountAuthorization(page, { base, sessionId: RICH, provider: oauthProvider,
        providerName: oauthEntry.name, accountId: deviceAccount.id, accountLabel: deviceAccount.label, width: viewport.width, artifacts });
      await harness.closeContext(context);
      context = undefined;
      page = undefined;
    });
  }
  } else {
    assert.fail(`No group dispatch for ${group}`);
  }
  coverage.finish();
} catch (error) {
  stage.finishOpen();
  console.error(error);
  process.exitCode = 1;
  coverage?.fail(error);
  await harness.fail(error);
} finally {
  stage.finishOpen();
  await harness.finish();
}
}
