import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { createJiti } from "jiti";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { checkSubagentModelSettings } from "./subagent-settings-ui.mjs";
import { readBrowserResponse } from "./browser-http.mjs";

/** Script actual model-issued Agent calls. No host runtime/controller is fabricated. */
export function subagentLifecycleFixtureSource(root) {
  return `import { fauxProvider, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(join(root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js"))};
export default function (pi) {
  const faux = fauxProvider({ provider: "e2e-subagents", api: "e2e-subagents", models: [
    { id: "parent", reasoning: true }, { id: "child", reasoning: true }, { id: "literal:high", reasoning: true }
  ] });
  const text = message => typeof message?.content === "string" ? message.content : (message?.content ?? []).map(block => block.text ?? "").join("\\n");
  const respond = async (context, options, _state, model) => {
    faux.appendResponses([respond]);
    const last = context.messages.at(-1);
    if (model.id !== "parent") {
      if (context.messages.some(message => message.role === "user" && text(message).includes("HOLD_CHILD"))) {
        await new Promise(resolve => { if (options?.signal?.aborted) resolve(); else options?.signal?.addEventListener("abort", resolve, { once: true }); });
      }
      return fauxAssistantMessage("Lifecycle child complete");
    }
    if (last?.role === "toolResult") return fauxAssistantMessage("Lifecycle parent report:\\n\\n" + text(last));
    const task = text(last);
    // Native parallel tool setup has no array-order guarantee. Whichever child
    // gets the single slot must hold it until Stop; the other remains unprompted.
    if (task === "queue-children") return fauxAssistantMessage([
      fauxToolCall("Agent", { subagent_type: "e2e-lifecycle", prompt: "HOLD_CHILD A", description: "Held lifecycle child A", model: "e2e-subagents/child" }),
      fauxToolCall("Agent", { subagent_type: "e2e-lifecycle", prompt: "HOLD_CHILD B", description: "Held lifecycle child B", model: "e2e-subagents/child" })
    ], { stopReason: "toolUse" });
    if (task === "isolated-child") return fauxAssistantMessage([fauxToolCall("Agent", {
      subagent_type: "e2e-lifecycle", prompt: "Complete isolated task", description: "Isolated lifecycle child",
      model: "e2e-subagents/child:high", isolation: "worktree"
    })], { stopReason: "toolUse" });
    if (task.startsWith("resume-child ")) return fauxAssistantMessage([fauxToolCall("Agent", {
      resume: task.slice("resume-child ".length), prompt: "Continue explicitly", description: "Resumed lifecycle child"
    })], { stopReason: "toolUse" });
    return fauxAssistantMessage("Lifecycle idle");
  };
  faux.setResponses([respond]);
  pi.registerProvider(faux.provider);
}`;
}

export async function checkSubagentLifecycle(page, { base, api, post, root, agentDir, width, returnSessionId }) {
  const cwd = join(agentDir, `subagent-project-${width}`);
  mkdirSync(cwd);
  writeFileSync(join(cwd, "fact.txt"), "Lifecycle fixture\n");
  const git = (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  git("init", "-qb", "main"); git("add", "fact.txt");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "initial");
  mkdirSync(join(agentDir, "agents"), { recursive: true });
  writeFileSync(join(agentDir, "agents", "e2e-lifecycle.md"), ["---", "description: Lifecycle fixture", "tools: read", "load_skills: false", "load_extensions: false", "max_turns: 1", "model: e2e-subagents/child:high", "---", "Complete the task."].join("\n"));
  const settingsPath = join(agentDir, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  if (!settings.enabledModels.includes("e2e-subagents/**")) settings.enabledModels.push("e2e-subagents/**");
  writeFileSync(settingsPath, JSON.stringify(settings));
  const enabled = await page.request.put(`${base}/api/subagents/settings`, { data: { enabled: true, maxConcurrent: 1 } });
  assert.ok(enabled.ok(), await enabled.text());
  const parent = await post("/api/agent/new", { cwd, type: "prompt", message: "bootstrap lifecycle", provider: "e2e-subagents", modelId: "parent", toolNames: ["read"], modelSpeed: "fast" });
  const parentId = parent.sessionId;
  // An ensure-only ordinary session has no file/catalogue row yet; navigating to
  // that ID can leave the previous chat selected. Persist and await this real turn.
  await waitForAsyncCondition(page, async id => {
    const response = await fetch(`/api/agent/${id}`);
    const snapshot = await response.json();
    return snapshot.running === true && snapshot.state?.isStreaming === false && snapshot.state?.isPromptRunning === false;
  }, parentId);
  const { readSubagentRun } = await createJiti(import.meta.url).import(join(root, "lib/subagents.ts"));
  const { decodeSessionCatalogue } = await createJiti(import.meta.url, { fsCache: false }).import(join(root, "lib/session-catalogue-wire.ts"));
  const saved = async id => {
    const detail = await api(`/api/sessions/${id}`);
    const path = relative(agentDir, detail.filePath);
    assert.ok(path && !path.startsWith("..") && !isAbsolute(path));
    const [header, ...entries] = readFileSync(detail.filePath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(header.id, id);
    return { detail, entries, run: readSubagentRun(entries, id, detail.filePath) };
  };
  const children = async () => (await api("/api/sessions?force=1")).sessions.filter(session => session.relation?.parentSessionId === parentId);
  const send = async task => {
    await page.locator("textarea").last().fill(task);
    await page.getByRole("button", { name: "Send", exact: true }).click();
  };
  let completed = false, primaryCaught = false, primary;
  // Only the two application reads admitted by the existing final reload. Own
  // their original wait, full read continuation and native JSON separately.
  const reads = [];
  const observe = original => {
    const record = { original };
    record.observation = original.then(value => { record.value = value; }, error => { record.failed = true; record.error = error; });
    reads.push(record); return record;
  };
  const applicationRead = pathname => {
    const waiting = observe(page.waitForResponse(response => new URL(response.url()).pathname === pathname && response.request().method() === "GET"));
    return observe(waiting.original.then(async response => {
      const nativeJSON = observe(response.json());
      const body = await nativeJSON.original;
      assert.equal(response.status(), 200, `Original application ${pathname} body`);
      return { response, body };
    }));
  };
  try {
    await page.goto(`${base}/?session=${parentId}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Lifecycle idle", { exact: true }).waitFor();
    assert.equal((await api(`/api/sessions/${parentId}`)).info.cwd, cwd);
    await page.locator("textarea").last().waitFor();
    await send("isolated-child");
    await page.getByText(/Lifecycle parent report:.*no longer present/s).waitFor();
    const [isolated] = await children();
    assert.ok(isolated);
    const first = await saved(isolated.id);
    assert.match(first.run.runId, /^[0-9a-f-]{36}$/);
    assert.equal(first.run.worktreeExists, false);
    assert.equal(first.run.turnLimit, 1);
    assert.equal(existsSync(first.run.worktreePath), false);
    assert.ok(first.entries.some(entry => entry.type === "thinking_level_change" && entry.thinkingLevel === "high"));
    assert.ok(first.entries.some(entry => entry.customType === "pi-web:model-speed" && entry.data.modelSpeed === "fast"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/Lifecycle parent report:.*no longer present/s).waitFor();
    const invalidProbes = [];
    const probePaths = new Set(["/api/models", "/api/project-trust", "/api/worktrees", "/api/git/status", "/api/auth/accounts/selection"]);
    const observeProbe = request => {
      const url = new URL(request.url());
      if ((probePaths.has(url.pathname) && url.searchParams.get("cwd") === first.run.worktreePath)
        || (url.pathname.startsWith("/api/files/") && decodeURIComponent(url.pathname).includes(first.run.worktreePath))
        || url.pathname === `/api/agent/${isolated.id}/events` || url.pathname === `/api/agent/${isolated.id}/lease`) invalidProbes.push(request.url());
    };
    page.on("request", observeProbe);
    // Process/tool groups are collapsed after history reload; use the real disclosure first.
    await page.getByText(/^Process details/).click();
    const open = page.getByRole("button", { name: "Open sub-agent session", exact: true }).first();
    await open.click();
    await page.waitForURL(url => url.searchParams.get("session") === isolated.id);
    await page.getByText("Lifecycle child complete", { exact: true }).waitFor();
    await page.locator('[data-history-only="true"]').getByText(/Working folder is missing/).waitFor();
    assert.equal(await page.locator("textarea").count(), 0, "missing cwd has no working composer or account probes");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-history-only="true"]').waitFor();
    assert.equal((await api(`/api/sessions/${isolated.id}`)).info.cwd, first.run.worktreePath);
    await page.goto(`${base}/?session=${parentId}`, { waitUntil: "domcontentloaded" });
    await page.locator("textarea").last().waitFor();
    page.off("request", observeProbe);
    assert.deepEqual(invalidProbes, [], "history navigation/reload must not probe or admit the missing workspace");
    await send(`resume-child ${isolated.id}`);
    await page.getByText(/Lifecycle parent report:.*Directory does not exist/s).waitFor();
    assert.equal((await saved(isolated.id)).run.runId, first.run.runId, "refusal creates no new run");
    assert.equal(existsSync(first.run.worktreePath), false);

    await checkSubagentModelSettings(page, { width });

    await send("queue-children");
    await waitForAsyncCondition(page, async id => {
      const response = await fetch("/api/sessions?force=1");
      const sessions = (await response.json()).sessions;
      return sessions.some(session => session.relation?.parentSessionId === id && session.relation.status === "queued");
    }, parentId);
    const queueSnapshot = await children();
    const queued = queueSnapshot.find(child => child.relation.status === "queued");
    assert.ok(queued);
    assert.equal(queueSnapshot.filter(child => child.relation.status === "running").length, 1, "one foreground child owns the only slot regardless of parallel setup order");
    const childIds = queueSnapshot.map(child => child.id).sort();
    assert.equal(childIds.length, 3, "the existing native stage owns isolated, held and queued children");
    assert.equal(new Set(childIds).size, 3);
    assert.equal(childIds.includes(isolated.id), true);
    if (width <= 640) await page.getByRole("button", { name: "More controls", exact: true }).click();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await waitForAsyncCondition(page, async id => {
      const response = await fetch("/api/agent/running");
      return !(await response.json()).runningSessionIds.includes(id);
    }, parentId);
    const stopped = await saved(queued.id);
    assert.equal(stopped.run.status, "aborted");
    assert.ok(stopped.run.runId);
    assert.equal(stopped.entries.some(entry => entry.type === "message" && entry.message.role === "user"), false);
    await page.goto(`${base}/?session=${queued.id}`, { waitUntil: "domcontentloaded" });
    await page.locator("textarea").last().waitFor();
    const catalogue = applicationRead("/api/sessions"), running = applicationRead("/api/agent/running");
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal((await saved(queued.id)).run.runId, stopped.run.runId);
    const [catalogueRead, runningRead] = await Promise.all([catalogue.original, running.original]);
    // Inspect the original admitted browser body, not a replacement API read.
    const nativeRows = decodeSessionCatalogue(catalogueRead.body.sessions);
    const nativeParent = nativeRows.find(row => row.id === parentId);
    assert.equal(nativeParent?.cwd, cwd, "application catalogue carries this actual native parent");
    assert.deepEqual(nativeRows.filter(row => row.relation?.kind === "subagent" && row.relation.parentSessionId === parentId).map(row => row.id).sort(), childIds);
    const familyIds = [parentId, ...childIds];
    assert.deepEqual(runningRead.body.runningSessionIds.filter(id => familyIds.includes(id)), [], "separate native registry snapshot has no running family member");
    assert.deepEqual(runningRead.body.queuedSessionIds.filter(id => familyIds.includes(id)), [], "separate native queue snapshot has no queued family member");
    for (const id of childIds) {
      const native = await saved(id);
      assert.equal(["completed", "aborted"].includes(native.run.status), true, "original native terminal result is separate from toolbar idle");
      assert.equal(typeof native.run.completedAt, "string");
    }
    const nativeAgents = page.getByRole("button", { name: "Agents · 3 subagents", exact: true });
    await nativeAgents.waitFor();
    assert.equal(await nativeAgents.getAttribute("title"), "Agents · 3 subagents");
    assert.equal(await nativeAgents.locator(":scope > span[aria-hidden=true]").innerText(), "3", "actual default Toolbar forwards the genuine native family count");
    console.log(`PASS: ${width}px native subagent IDs, worktree history/refusal, settings suffix, never-prompted queued Stop and actual idle family Toolbar count`);
    completed = true;
  } catch (error) {
    primaryCaught = true; primary = error;
  } finally {
    const failures = primaryCaught ? [primary] : [];
    // Full continuations above include bodies admitted after this join begins;
    // each new native JSON is also retained and independently observed here.
    for (const read of reads) await read.observation;
    for (const read of reads) if (read.failed && !failures.includes(read.error)) failures.push(read.error);
    try {
    if (completed) {
      // Unmount the selected child and settle navigation before deleting its family.
      // Otherwise its still-mounted polling can race deletion during trace export.
      await page.goto(`${base}/?session=${returnSessionId}`, { waitUntil: "domcontentloaded" });
      await page.getByText("Active branch answer", { exact: true }).waitFor();
      await readBrowserResponse(page, `${base}/api/sessions/${parentId}`, { method: "DELETE", expectedStatus: "2xx" });
    } else {
      // Settle the owned family but preserve its files for failure diagnostics.
      await post(`/api/agent/${parentId}`, { type: "abort" });
    }
    } catch (error) { if (!failures.includes(error)) failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Native subagent observation and independent cleanup failed");
  }
}
