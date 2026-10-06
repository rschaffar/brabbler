import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { splitGitPatch, createPatchLoader } = await createJiti(import.meta.url).import("./git-patch-display.ts");
const changed = (name) => `diff --git a/${name} b/${name}\nindex 1111111..2222222 100644\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`;

test("multiple file blocks retain exact bytes, paths and changed-line counts", () => {
  const patch = changed("a.txt") + changed("b.txt");
  const files = splitGitPatch(patch);
  assert.deepEqual(files.map(({ path, status, additions, deletions }) => ({ path, status, additions, deletions })), [
    { path: "a.txt", status: "Modified", additions: 1, deletions: 1 },
    { path: "b.txt", status: "Modified", additions: 1, deletions: 1 },
  ]);
  assert.equal(files.map((file) => file.value.patch).join(""), patch);
  assert.notEqual(files[0].id, files[1].id);
});
test("metadata, renames, quoted paths, binary and large patches remain complete", () => {
  const rename = "diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n";
  const metadata = "diff --git a/tool b/tool\nold mode 100644\nnew mode 100755\n";
  const binary = "diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n";
  const quoted = 'diff --git "a/a\\tfile" "b/a\\tfile"\nold mode 100644\nnew mode 100755\n';
  const large = `diff --git a/large b/large\nnew file mode 100644\n--- /dev/null\n+++ b/large\n@@ -0,0 +1,2501 @@\n${Array.from({ length: 2501 }, (_, i) => `+line${i}`).join("\n")}\n`;
  const files = splitGitPatch(rename + metadata + binary + quoted + large);
  assert.equal(files.length, 5);
  assert.equal(files[0].previousPath, "old.txt"); assert.equal(files[0].path, "new.txt"); assert.equal(files[0].status, "Renamed");
  assert.equal(files[1].additions, 0);
  assert.equal(files[2].value.hasBinaryChanges, true); assert.equal(files[2].additions, undefined);
  assert.equal(files[3].path, "a\tfile");
  assert.equal(files[4].additions, 2501); assert.ok(files[4].value.patch.endsWith("+line2500\n"));
});
test("unsupported framing refuses a partial file list rather than discarding data", () => {
  assert.throws(() => splitGitPatch("unexpected preamble\n" + changed("a")));
  assert.throws(() => splitGitPatch("not a patch"));
});
test("lazy patch queue bounds concurrency, caches successes and cancels queued reads", async () => {
  let active = 0, max = 0;
  const started = [], releases = new Map();
  const load = createPatchLoader(async (id) => {
    active++; max = Math.max(max, active); started.push(id);
    await new Promise((resolve) => releases.set(id, resolve)); active--;
    return { patch: id, hasBinaryChanges: false };
  });
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const promises = controllers.map((controller, index) => load(String(index), controller.signal));
  await Promise.resolve();
  assert.deepEqual(started, ["0", "1", "2"]);
  controllers[4].abort();
  await assert.rejects(promises[4], { name: "AbortError" });
  releases.get("0")(); await promises[0];
  // Queue pumping settles in the promise's finally callback.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["0", "1", "2", "3"]);
  for (const id of ["1", "2", "3"]) releases.get(id)();
  await Promise.all(promises.slice(0, 4));
  assert.equal(max, 3);
  assert.equal((await load("0", new AbortController().signal)).patch, "0");
  assert.equal(started.length, 4);
});
test("aborted active reads and failures are not cached, and later reads can retry", async () => {
  let calls = 0;
  const load = createPatchLoader(async (_id, signal) => {
    calls++;
    if (calls === 1) { await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })); }
    if (calls === 2) throw new Error("Unavailable");
    return { patch: "complete", hasBinaryChanges: false };
  });
  const controller = new AbortController();
  const first = load("a", controller.signal); await Promise.resolve(); controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  await assert.rejects(load("a", new AbortController().signal), /Unavailable/);
  assert.equal((await load("a", new AbortController().signal)).patch, "complete");
  assert.equal(calls, 3);
});
test("effect replay cancels before starting a read and synchronous errors release queue slots", async () => {
  let calls = 0;
  const load = createPatchLoader(() => { calls++; throw new Error("Synchronous failure"); }, 1);
  const controller = new AbortController();
  const first = load("cancelled", controller.signal); controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  await assert.rejects(load("retry", new AbortController().signal), /Synchronous failure/);
  await assert.rejects(load("next", new AbortController().signal), /Synchronous failure/);
  assert.equal(calls, 2, "The cancelled mount never invokes its loader");
});
