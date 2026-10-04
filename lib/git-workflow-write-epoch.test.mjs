import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { bindingTestModule } from "./git-workflow-binding-test-loader.mjs";
const jiti = createJiti(import.meta.url);
const io = await jiti.import("./git-workflow-binding-io.ts");
const authority = await jiti.import("./git-scoped-authority.ts");
const { readGitWorkflowWriteEpoch: read, advanceGitWorkflowWriteEpoch: advance, gitWorkflowPrivateParent } = await jiti.import("./git-workflow-write-epoch.ts");
test("settings epochs distinguish equal-value writes and refuse unknown bytes without repairing them", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-workflow-epoch-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(read(dir), "none");
  advance(dir); const first = read(dir); advance(dir); assert.notEqual(read(dir), first);
  const path = join(gitWorkflowPrivateParent(dir), "git-workflow-write-epoch.json");
  for (const data of ['{"version":2,"epoch":"unknown"}', "invalid", ' {"version":1,"epoch":"x","grant":true}']) {
    writeFileSync(path, data); assert.throws(() => advance(dir)); assert.equal(readFileSync(path, "utf8"), data);
  }
});
test("every newly created private directory is followed by a parent-directory durability barrier", { skip: process.platform !== "linux" }, (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-workflow-directory-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const events = [];
  const epoch = bindingTestModule("./git-workflow-write-epoch.ts", { "./git-scoped-authority": authority, "./git-workflow-binding-io": io,
    "node:fs": { ...fs, mkdirSync(path, ...args) { const result = fs.mkdirSync(path, ...args); events.push(["mkdir", path]); return result; },
      fsyncSync(fd) { events.push(["sync", fs.readlinkSync(`/proc/self/fd/${fd}`)]); return fs.fsyncSync(fd); } } });
  const agent = join(dir, "new-parent", "agent");
  const parent = epoch.gitWorkflowPrivateParent(agent, true);
  const namespace = join(parent, "task-binding");
  epoch.createDurableGitWorkflowDirectory(namespace);
  for (const path of [dirname(agent), agent, parent, namespace]) {
    const created = events.findIndex(([op, target]) => op === "mkdir" && target === path);
    assert.ok(created >= 0); assert.deepEqual(events[created + 1], ["sync", dirname(path)]);
  }
});
