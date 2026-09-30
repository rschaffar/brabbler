// Adapted from @Nuctori's script-style CI/E2E fixtures in PR #617 (issue #599).
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkFilePanel, checkEditableFile, filePanelFixture } from "./file-panel.mjs";
import { checkExtensionDialogs, extensionSource } from "./extension-dialog.mjs";
import { checkGitDecisionWaiting } from "./git-action-wait.mjs";
import { checkAskUserDialog } from "./ask-user.mjs";
import { checkActivityOverview } from "./activity.mjs";
import { checkProviderAccountAuthorization } from "./provider-accounts.mjs";
import { checkChatAppearance } from "./chat-appearance.mjs";
import { checkGitWorkflow } from "./git-workflow.mjs";
import { checkSettingsProposalCard } from "./git-settings-proposals.mjs";
import { consumeExpectedTaskConflict } from "./git-task-binding.mjs";
import { checkGitExplorer } from "./git-explorer.mjs";
import { checkIntegratedGitGraph } from "./git-explorer-merge.mjs";
import { seedGitActionHistory, checkSavedGitActionHistory } from "./git-action-history.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.env.E2E_SERVER_MODE || "dev";
assert.ok(mode === "dev" || mode === "start", "E2E_SERVER_MODE must be dev or start");
assert.ok(mode !== "dev" || !existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-e2e-"));
// Guarded commits/merges read a real Git identity, but never the operator's HOME/config.
const home = join(agentDir, "home");
mkdirSync(home);
writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = E2E\n\temail = e2e@example.invalid\n[commit]\n\tgpgsign = false\n");
const fixtureEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"),
  GIT_CONFIG_GLOBAL: join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const project = join(agentDir, "project");
const otherProject = join(agentDir, "other-project");
const sessionDir = join(agentDir, "sessions", "e2e");
mkdirSync(project);
mkdirSync(otherProject);
const previewFile = join(project, "preview.html");
const editableFile = join(project, "editable.txt");
writeFileSync(previewFile, filePanelFixture);
writeFileSync(editableFile, "Initial text\n");
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
const GIT = "e2e-git-workflow";
const GIT_HISTORY = "e2e-git-action-history";
const PROPOSAL = "e2e-git-settings-proposal";
const PROPOSAL_ID = "12345678-1234-4234-8234-123456789abc";
let gitHistory;
const gitProject = join(agentDir, "git-project");
const targetWorktree = join(agentDir, "git-target-worktree");
const text = (i) => `E2E message ${String(i).padStart(4, "0")}`;
const ids = (start, end) => Array.from({ length: end - start }, (_, i) => `e${start + i}`);

function message(id, parentId, role, content) {
  return { type: "message", id, parentId, timestamp, message: { role, content } };
}

function writeSession(id, entries, cwd = project) {
  const header = { type: "session", version: 3, id, timestamp, cwd };
  writeFileSync(join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`),
    [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

let server;
let serverExited;
let browser;
let page;
let context;
let serverError;
const serverLog = createWriteStream(join(artifacts, "server.log"));
const interrupt = () => {
  process.exitCode = 1;
  server?.kill("SIGTERM");
  void browser?.close().catch(() => {});
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

try {
  // Seed before startup so the first catalogue scan sees every fixture.
  mkdirSync(join(agentDir, "extensions"));
  writeFileSync(join(agentDir, "extensions", "e2e-dialog.js"), extensionSource);
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
  writeSession(BRANCH, [
    message("root", null, "user", "Branch root"),
    message("old", "root", "assistant", "Inactive branch answer"),
    message("new", "root", "assistant", "Active branch answer"),
  ]);
  const recoveryDir = join(agentDir, "pi-web", "run-journal", "v1", BRANCH);
  mkdirSync(recoveryDir, { recursive: true });
  const seedRecoveryRun = (runId) => writeFileSync(join(recoveryDir, `${runId}.start.json`), JSON.stringify({
    version: 1, runId, sessionId: BRANCH, ownerPid: 99999999,
    startedAt: new Date().toISOString(),
  }));
  if (process.env.E2E_ACTIVITY_ONLY !== "1") seedRecoveryRun("11111111-1111-4111-8111-111111111111");
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
        + "E2E answer paragraph.\n\n".repeat(20),
      },
    ]),
  ];
  Object.assign(richEntries.at(-1).message, { provider: "test", model: "E2E Model" });
  writeSession(RICH, richEntries);
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
  const proposalResult = message("proposal-result", "proposal-call", "toolResult", [{ type: "text", text: "Proposal ready for review." }]);
  Object.assign(proposalResult.message, { toolCallId: "proposal-tool", toolName: "git_workflow_propose_settings", isError: false,
    details: { proposalId: PROPOSAL_ID } });
  writeSession(PROPOSAL, [
    message("proposal-user", null, "user", "Please propose a settings change"),
    message("proposal-call", "proposal-user", "assistant", [{ type: "toolCall", id: "proposal-tool", name: "git_workflow_propose_settings",
      arguments: { scope: "project", repositoryPath: gitProject, changes: [{ field: "enabled", value: false }] } }]),
    proposalResult,
    message("proposal-answer", "proposal-result", "assistant", "Review and apply the proposal in chat."),
  ], gitProject);
  for (const id of BULK) writeSession(id, [message("root", null, "user", `E2E bulk ${id}`)]);
  writeSession(OTHER, [
    message("root", null, "user", "Other workspace task"),
    message("reply", "root", "assistant", "Waiting for more work"),
  ], otherProject);
  {
    const otherGit = (...args) => execFileSync("git", ["-C", otherProject, ...args], { encoding: "utf8", env: fixtureEnv }).trim();
    otherGit("init", "-qb", "other-main");
    otherGit("commit", "--allow-empty", "-qm", "Other project fixture");
  }
  {
    mkdirSync(gitProject);
    const git = (...args) => execFileSync("git", ["-C", gitProject, ...args], {
      encoding: "utf8", env: fixtureEnv,
    }).trim();
    const commit = (subject) => git("-c", "user.name=E2E", "-c", "user.email=e2e@example.invalid", "commit", "-m", subject);
    git("init", "-b", "target");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(gitProject, "base.txt"), "Base fixture\n");
    git("add", "base.txt"); commit("base fixture");
    git("switch", "-c", "feature");
    writeFileSync(join(gitProject, "first.txt"), "First feature patch\n");
    git("add", "first.txt"); commit("first feature");
    writeFileSync(join(gitProject, "second.txt"), "Second feature patch\n");
    writeFileSync(join(gitProject, "base.txt"), "Revised base fixture\n");
    git("add", "second.txt", "base.txt"); commit("second feature");
    git("tag", "e2e-light");
    git("tag", "--no-sign", "-a", "e2e-annotated", "-m", "E2E annotated release");
    git("tag", "same-name", "target");
    writeFileSync(join(gitProject, "draft.txt"), "Manual commit fixture\n");
    writeFileSync(join(gitProject, "second-draft.txt"), "Second captured commit file\n");
    git("worktree", "add", targetWorktree, "target");
    writeSession(GIT, [message("root", null, "user", "E2E Git workflow conversation"),
      message("answer", "root", "assistant", "Ready to review Git workflow")], gitProject);
    gitHistory = await seedGitActionHistory(agentDir, GIT_HISTORY);
    writeSession(GIT_HISTORY, [message("root", null, "user", "Earlier Git decisions"), ...gitHistory.entries,
      { type: "compaction", id: "saved-compaction", parentId: gitHistory.entries.at(-1).id, timestamp,
        summary: "Keep the short task context, not private patches.", firstKeptEntryId: "saved-compaction", tokensBefore: 100 },
      message("answer", "saved-compaction", "assistant", "Saved Git action history fixture")], gitProject);
  }

  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), mode, "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...fixtureEnv, NODE_ENV: mode === "dev" ? "development" : "production",
      PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.once("error", (error) => { serverError = error; });
  serverExited = once(server, "exit");
  server.stdout.pipe(serverLog, { end: false });
  server.stderr.pipe(serverLog, { end: false });

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
    assert.ok(response.ok, `POST ${path} -> ${response.status}`);
    return response.json();
  }

  const deadline = Date.now() + 120_000;
  while (true) {
    if (serverError) throw serverError;
    assert.equal(server.exitCode, null, "Server exited before readiness; see server.log");
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      const { sessions } = await response.json();
      assert.deepEqual(sessions.map((session) => session.id).sort(), [LONG, BRANCH, RICH, COMPACTED, APPEND, ARCHIVE, OTHER, GIT, GIT_HISTORY, PROPOSAL, ...BULK].sort());
      break;
    }
    assert.ok(Date.now() < deadline, "Server readiness timed out; see server.log");
    await delay(250);
  }

  if (process.env.E2E_GIT_WORKFLOW_ONLY === "1") {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (event) => { if (event.type() === "error" && !consumeExpectedTaskConflict(page, event)) errors.push(event.text()); });
    page.on("response", (response) => {
      if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
    });
    await checkGitExplorer(page, { base, sessionId: GIT, cwd: gitProject, targetWorktree });
    await checkGitWorkflow(page, { base, api, artifacts, sessionId: GIT, cwd: gitProject, targetWorktree, otherProject });
    await checkIntegratedGitGraph(page, targetWorktree);
    await checkSettingsProposalCard(page, { base, sessionId: PROPOSAL, proposalId: PROPOSAL_ID, projectRoot: gitProject });
    await checkSavedGitActionHistory(page, { base, api, sessionId: GIT_HISTORY, records: gitHistory.records, artifacts });
    await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
    await checkGitDecisionWaiting(page, { base, width: page.viewportSize().width });
    assert.deepEqual(errors, [], "Git workflow browser errors");
    await context.tracing.stop();
    await context.close();
    context = undefined;
    page = undefined;
  } else {
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

  let secondaryAccountId;
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

  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {});
  // A live session keeps the context files it loaded until explicitly reloaded.
  {
    const contextFile = join(otherProject, "AGENTS.md");
    const checkContext = await browser.newContext();
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
      await checkContext.close();
    }
  }
  for (const viewport of [
    ...(process.env.E2E_ARCHIVE_ONLY === "1" ? [] : [{ width: 1280, height: 800 }]),
    ...(process.env.E2E_ACTIVITY_ONLY === "1" ? [{ width: 700, height: 800 }] : []),
    { width: 390, height: 844 },
  ]) {
    context = await browser.newContext({ viewport, locale: "en-US", hasTouch: viewport.width <= 600, isMobile: viewport.width <= 600 });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    const olderResponses = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (event) => { if (event.type() === "error" && !consumeExpectedTaskConflict(page, event)) errors.push(event.text()); });
    page.on("response", (response) => {
      if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
      const url = new URL(response.url());
      if (url.pathname === `/api/sessions/${LONG}/context` && url.searchParams.has("before")) olderResponses.push(response);
    });
    if (process.env.E2E_FILE_EDIT_ONLY === "1") {
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await page.locator(".markdown-code-block pre").waitFor();
      await checkFilePanel(page, previewFile);
      await checkEditableFile(page, editableFile);
      assert.deepEqual(errors, [], "Browser errors during file editing");
      await context.tracing.stop();
      await context.close();
      context = undefined;
      continue;
    }
    if (process.env.E2E_ARCHIVE_ONLY === "1") {
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
      await context.tracing.stop();
      await context.close();
      context = undefined;
      page = undefined;
      continue;
    }
    if (process.env.E2E_ACTIVITY_ONLY === "1") {
      // Seed only after the selected chat has loaded, so clicking its newly
      // discovered Activity row must refresh the warning in that same chat.
      await checkActivityOverview(page, viewport.width, {
        base, api, post, artifacts, waitingSessionId: RICH, selectedSessionId: BRANCH, otherSessionId: OTHER,
        seedInterruptedRun: () => seedRecoveryRun(`${viewport.width}-activity-recovery`),
      });
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      await context.tracing.stop();
      await context.close();
      context = undefined;
      page = undefined;
      continue;
    }
    if (process.env.E2E_ACCOUNT_ONLY === "1") {
      const { oauthProviders } = await api("/api/auth/providers");
      const oauthEntry = oauthProviders.find((item) => item.id === "github-copilot") ?? oauthProviders[0];
      assert.ok(oauthEntry, "OAuth provider required for account browser fixture");
      const { account } = await post("/api/auth/accounts", { provider: oauthEntry.id, label: `E2E device ${viewport.width}`, type: "oauth" });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await checkProviderAccountAuthorization(page, { base, sessionId: RICH, provider: oauthEntry.id,
        providerName: oauthEntry.name, accountLabel: account.label, width: viewport.width, artifacts });
      const removedFixture = await fetch(`${base}/api/auth/accounts`, { method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id }) });
      assert.equal(removedFixture.status, 200);
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      await context.tracing.stop();
      await context.close();
      context = undefined;
      page = undefined;
      continue;
    }
    if (process.env.E2E_ASK_USER_ONLY === "1") {
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await page.locator(".markdown-code-block pre").waitFor();
      const { data: tools } = await post(`/api/agent/${RICH}`, { type: "get_tools" });
      assert.deepEqual(tools.filter((tool) => tool.name === "ask_user").map((tool) => tool.active), [true]);
      assert.match(tools.find((tool) => tool.name === "ask_user").description, /^Ask the user a question/);
      await checkAskUserDialog(page, viewport.width);
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      await context.tracing.stop();
      await context.close();
      context = undefined;
      page = undefined;
      continue;
    }
    if (process.env.E2E_SESSION_LINK_ONLY === "1") {
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
      await context.tracing.stop();
      await context.close();
      context = undefined;
      page = undefined;
      continue;
    }
    if (process.env.E2E_BULK_ONLY === "1") {
      const ids = viewport.width <= 600 ? BULK.slice(2) : BULK.slice(0, 2);
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await page.locator(".markdown-code-block pre").waitFor();
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
      const archiveConflict = `**/api/sessions/${ids[0]}`;
      const failArchive = (route) => route.request().method() === "PATCH"
        ? route.fulfill({ status: 409, json: { error: "Session is running" } }) : route.continue();
      await page.route(archiveConflict, failArchive);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await page.getByRole("alert").getByText("1 failed, 1 succeeded", { exact: false }).waitFor();
      const expectedConflict = errors.indexOf("Failed to load resource: the server responded with a status of 409 (Conflict)");
      assert.notEqual(expectedConflict, -1, "Simulated archive conflict should reach the browser");
      errors.splice(expectedConflict, 1);
      assert.ok(await first.getByRole("checkbox").isChecked(), "Failed session stays selected for retry");
      assert.equal((await api("/api/sessions?force=1")).sessions.find((s) => s.id === ids[1])?.archived, true);
      await page.unroute(archiveConflict, failArchive);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await first.waitFor({ state: "detached" });
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
      await page.getByRole("button", { name: "Active sessions", exact: true }).click();
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await first.scrollIntoViewIfNeeded();
      await first.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByText("Permanently delete selected sessions (1) and their subagents? Forks will remain.").waitFor();
      assert.ok((await api("/api/sessions?force=1")).sessions.some((s) => s.id === ids[0]), "Delete requires confirmation");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("button", { name: "Delete", exact: true }).last().click();
      await first.waitFor({ state: "detached" });
      assert.ok(!(await api("/api/sessions?force=1")).sessions.some((s) => s.id === ids[0]));
      assert.ok((await api("/api/sessions?force=1")).sessions.some((s) => s.id === ids[1]));
      assert.equal(await second.getByRole("checkbox").count(), 0, "Selection mode exits after success");
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      console.log(`PASS: ${viewport.width}px opt-in bulk archive, restore, and confirmed delete`);
      await context.tracing.stop();
      await context.close();
      context = undefined;
      page = undefined;
      continue;
    }
    if (process.env.E2E_MOVE_ONLY === "1") {
      const moveId = viewport.width <= 600 ? ARCHIVE : APPEND;
      await page.goto(`${base}/?session=${moveId}`, { waitUntil: "domcontentloaded" });
      const row = page.locator(`[data-session-id="${moveId}"]`);
      if (viewport.width <= 600) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
      await row.scrollIntoViewIfNeeded();
      if (viewport.width <= 600) await row.getByRole("button", { name: "Session actions", exact: true }).click();
      else await row.hover();
      await row.getByRole("button", { name: "Move to project…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Move to project…" });
      await dialog.getByLabel("Destination project").selectOption(otherProject);
      await dialog.getByRole("button", { name: "Move", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await row.waitFor({ state: "detached" });
      assert.equal((await api("/api/sessions?force=1")).sessions.find((session) => session.id === moveId)?.cwd, otherProject);
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      console.log(`PASS: ${viewport.width}px session move via project picker`);
      await context.tracing.stop();
      await context.close();
      context = undefined;
      page = undefined;
      continue;
    }
    if (viewport.width === 1280) {
      await checkGitExplorer(page, { base, sessionId: GIT, cwd: gitProject, targetWorktree });
      await checkGitWorkflow(page, { base, api, artifacts, sessionId: GIT, cwd: gitProject, targetWorktree, otherProject });
      await checkIntegratedGitGraph(page, targetWorktree);
      await checkSavedGitActionHistory(page, { base, api, sessionId: GIT_HISTORY, records: gitHistory.records, artifacts });
    }
    // Use a separate tab: a deliberate full-page reload must not alter the
    // reading-position and session-history fixtures exercised below.
    const versionPage = await context.newPage();
    try {
      await versionPage.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      const reloadWeb = versionPage.getByRole("button", { name: "Reload Pi Web" });
      assert.equal(await reloadWeb.count(), 0, "The running version should not show a reload prompt");
      await versionPage.route("**/api/app-version", (route) => route.fulfill({ json: { version: "99.99.99" } }));
      await versionPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await reloadWeb.waitFor();
      assert.ok(await versionPage.getByText("Pi Web v99.99.99 is running.").isVisible());
      versionPage.once("dialog", (dialog) => dialog.dismiss());
      await reloadWeb.click();
      await reloadWeb.waitFor();
      await versionPage.unroute("**/api/app-version");
      versionPage.once("dialog", (dialog) => dialog.accept());
      await Promise.all([versionPage.waitForNavigation(), reloadWeb.click()]);
      await reloadWeb.waitFor({ state: "detached" });
      console.log(`PASS: ${viewport.width}px version mismatch prompts before page reload`);
    } finally {
      await versionPage.close();
    }
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
      const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/sessions/${LONG}/context`);
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
    const thinkingRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/thinking")) thinkingRequests.push(request.url());
    });
    await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
    await page.locator("strong").filter({ hasText: "E2E markdown" }).waitFor();
    await page.locator("pre").filter({ hasText: "console.log('E2E code');" }).waitFor();
    await page.getByText("E2E final answer", { exact: true }).waitFor();
    const processDetails = page.getByRole("button", { name: /^Process details/ });
    const thinking = page.getByRole("button", { name: /^Thinking/ });
    assert.equal(await processDetails.count(), 1);
    assert.equal(await thinking.count(), 0, "All thinking stays inside process details");
    const finalMessage = page.locator("[data-entry-id='answer']");
    assert.equal(await finalMessage.getByRole("button", { name: /^Thinking/ }).count(), 0);
    assert.equal(await finalMessage.getByText("test/E2E Model", { exact: true }).count(), 1);
    assert.equal(thinkingRequests.length, 0);
    await processDetails.click();
    assert.equal(await thinking.count(), 3);
    assert.equal(await thinking.last().innerText(), "E2E final reasoning");
    assert.equal(thinkingRequests.length, 0);
    for (const [index, text] of ["Intermediate thinking details.", "Follow-up thinking details.", "Final thinking details."].entries()) {
      await thinking.nth(index).click();
      await page.getByText(text, { exact: false }).waitFor();
    }
    assert.equal(thinkingRequests.length, 3);
    const processText = await processDetails.locator("..").innerText();
    assert.ok(processText.indexOf("E2E intermediate reasoning") < processText.indexOf("echo E2E tool output"));
    assert.ok(processText.indexOf("echo E2E tool output") < processText.indexOf("E2E follow-up reasoning"));
    assert.ok(processText.indexOf("E2E follow-up reasoning") < processText.indexOf("E2E process note"));
    assert.ok(processText.indexOf("E2E process note") < processText.indexOf("E2E final reasoning"));
    assert.equal(processText.split("E2E final reasoning").length - 1, 1);
    assert.ok(!(await finalMessage.last().innerText()).includes("E2E final reasoning"));
    await page.getByText("echo E2E tool output", { exact: true }).waitFor();
    await page.getByRole("button", { name: /bash.*echo E2E tool output/ }).click();
    await page.getByText("E2E tool output", { exact: true }).waitFor();
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
        await page.locator(`[title="${title}"]`).click();
        await page.locator(`[data-entry-id="${entryId}"]:not([data-message-role])`).waitFor({ state: "visible" });
      };
      const readingOffset = (target) => target.evaluate((element) => (
        element.getBoundingClientRect().top - element.closest(".overflow-y-auto").getBoundingClientRect().top
      ));
      const positionForReading = async (target) => {
        await target.evaluate((element) => {
          const scroll = element.closest(".overflow-y-auto");
          scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 120;
        });
        return readingOffset(target);
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
    await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
    await page.locator(".markdown-code-block pre").waitFor();
    await checkFilePanel(page, previewFile);
    await checkEditableFile(page, editableFile);
    await checkExtensionDialogs(page, artifacts, viewport.width);
    await checkGitDecisionWaiting(page, { base, width: viewport.width });
    await checkAskUserDialog(page, viewport.width);
    if (viewport.width <= 600) {
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
      await page.getByText("No matching conversations in this scope").waitFor();
      await page.getByRole("checkbox", { name: "Active and archived" }).check();
      await page.getByRole("button", { name: /E2E archive fixture/ }).waitFor();
      await page.getByRole("checkbox", { name: "Active and archived" }).uncheck();
      await page.getByText("No matching conversations in this scope").waitFor();
      await page.getByRole("button", { name: "Archived sessions", exact: true }).click();
      await page.getByRole("button", { name: /E2E archive fixture/ }).waitFor();
      await page.getByRole("button", { name: "Active sessions", exact: true }).click();
      await page.getByRole("searchbox", { name: "Search conversations..." }).fill("Other workspace task");
      await page.getByText("No matching conversations in this scope").waitFor();
      await page.getByRole("checkbox", { name: "All projects" }).check();
      await page.getByRole("button", { name: /Other workspace task/ }).waitFor();
      await page.getByRole("checkbox", { name: "All projects" }).uncheck();
      await page.getByText("No matching conversations in this scope").waitFor();
      await searchToggle.click();
      await page.getByRole("button", { name: "Archived sessions", exact: true }).click();
      await row.getByText("E2E archive fixture", { exact: true }).click();
      await page.getByText("This session is archived. Restore it to show it in active sessions.").waitFor();
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
      await moveDialog.getByLabel("Destination project").selectOption(otherProject);
      await moveDialog.getByRole("button", { name: "Move", exact: true }).click();
      await moveDialog.waitFor({ state: "detached" });
      await row.waitFor({ state: "detached" });
      const moved = (await api("/api/sessions?force=1")).sessions.find((session) => session.id === ARCHIVE);
      assert.equal(moved?.cwd, otherProject);
      assert.equal(moved?.projectRoot, otherProject);
      await page.goto(`${base}/?session=${OTHER}`, { waitUntil: "domcontentloaded" });
      await page.locator('.mobile-session-title').getByText("Other workspace task", { exact: true }).waitFor();
      assert.equal(await page.locator('.mobile-session-project').textContent(), "other-project");
      console.log("PASS: mobile session move changes the saved project and refreshes the sidebar");
    }
    if (viewport.width > 600) {
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await page.locator(".markdown-code-block pre").waitFor();
      await checkChatAppearance(page);
    }
    assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
    console.log(`PASS: ${viewport.width}px browser pagination, branch, markdown, code, tool call, and compaction navigation`);
    await context.tracing.stop();
    await context.close();
    context = undefined;
    page = undefined;
  }
  if (process.env.E2E_SESSION_LINK_ONLY !== "1") {
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Account for/ }).click();
  await page.getByLabel("Account provider").selectOption("anthropic");
  const accountPicker = page.getByLabel("Session account", { exact: true });
  await accountPicker.selectOption(secondaryAccountId);
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
  await unavailablePicker.selectOption(secondaryAccountId);
  assert.equal(await unavailablePicker.locator("option:checked").innerText(), "Unavailable account");
  await unavailablePicker.selectOption("");
  assert.deepEqual((await api(`/api/auth/accounts/selection?cwd=${encodeURIComponent(project)}&sessionId=${RICH}`)).session, {});
  console.log("PASS: deleted account remains visible and can be explicitly switched to Pi default");
  await context.close();
  context = undefined;
  page = undefined;

  if (process.env.E2E_ACCOUNT_ONLY !== "1") {
    const { oauthProviders } = await api("/api/auth/providers");
    const oauthEntry = oauthProviders.find((item) => item.id === "github-copilot") ?? oauthProviders[0];
    assert.ok(oauthEntry, "OAuth provider required for browser authorization fixture");
    const oauthProvider = oauthEntry.id;
    const { account: deviceAccount } = await post("/api/auth/accounts", { provider: oauthProvider, label: "E2E device", type: "oauth" });
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 600 }]) {
      context = await browser.newContext({ viewport, locale: "en-US", hasTouch: viewport.width <= 600, isMobile: viewport.width <= 600 });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await checkProviderAccountAuthorization(page, { base, sessionId: RICH, provider: oauthProvider,
        providerName: oauthEntry.name, accountLabel: deviceAccount.label, width: viewport.width, artifacts });
      await context.close();
      context = undefined;
      page = undefined;
    }
  }
  }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  if (page) await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  if (context) await context.tracing.stop({ path: join(artifacts, "trace.zip") }).catch(() => {});
} finally {
  await browser?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    const forceKill = setTimeout(() => server.kill("SIGKILL"), 10_000);
    await serverExited;
    clearTimeout(forceKill);
  }
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
