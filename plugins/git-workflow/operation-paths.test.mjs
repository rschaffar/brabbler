import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createJiti } from "jiti";
const { operationMarkerPaths, OPERATION_MARKERS } = await createJiti(import.meta.url).import("./operation-paths.ts");

for (const [name, prefix, ending] of [
  ["POSIX", "/fixture/repo/.git/", "\n"],
  ["embedded newlines, tabs and quotes", "/fixture/MERGE_HEAD\nquote ' \tµ/.git/", "\n"],
  ["Windows", "C:/fixture/repo/.git/", "\r\n"],
  ["Windows backslashes", "C:\\fixture\\repo\\.git\\", "\r\n"],
  ["UNC", "//server/share/repo/.git/", "\n"],
]) {
  test(`one batched marker query preserves ${name} paths exactly`, async () => {
    const expected = OPERATION_MARKERS.map((marker) => prefix + marker);
    const calls = [];
    const paths = await operationMarkerPaths("checkout", async (cwd, args) => {
      calls.push({ cwd, args }); return expected.map((path) => path + ending).join("");
    });
    assert.deepEqual(paths, expected);
    assert.deepEqual(calls, [{ cwd: "checkout", args: ["rev-parse", "--path-format=absolute",
      ...OPERATION_MARKERS.flatMap((marker) => ["--git-path", marker])] }]);
  });
}

test("different path prefixes fall back to all six individual Git resolutions without guessing", async () => {
  const expected = OPERATION_MARKERS.map((marker, index) => `/fixture/admin-${index}/${marker}`);
  const calls = [];
  const paths = await operationMarkerPaths("checkout", async (cwd, args) => {
    calls.push({ cwd, args });
    return args.length > 4 ? expected.join("\n") + "\n" : expected[OPERATION_MARKERS.indexOf(args[3])] + "\n";
  });
  assert.deepEqual(paths, expected);
  assert.equal(calls.length, 7);
  assert.deepEqual(calls.slice(1).map(({ args }) => args[3]), OPERATION_MARKERS);
});

test("Git failures propagate immediately rather than entering the compatibility fallback", async () => {
  const failure = Object.assign(new Error("Git read failed"), { status: 128 });
  let calls = 0;
  await assert.rejects(operationMarkerPaths("checkout", async () => { calls++; throw failure; }), (error) => error === failure);
  assert.equal(calls, 1);
});

test("each checkpoint resolves fresh paths instead of caching a prior administrative directory", async () => {
  let calls = 0;
  // Use a stable prefix within each response, but change it between calls.
  const fresh = async () => {
    const prefix = ++calls === 1 ? "/fixture/first/" : "/fixture/second/";
    return OPERATION_MARKERS.map((marker) => prefix + marker + "\n").join("");
  };
  assert.deepEqual(await operationMarkerPaths("checkout", fresh), OPERATION_MARKERS.map((marker) => "/fixture/first/" + marker));
  assert.deepEqual(await operationMarkerPaths("checkout", fresh), OPERATION_MARKERS.map((marker) => "/fixture/second/" + marker));
  assert.equal(calls, 2);
});

async function productionIdle(git, index = ["H ordinary"]) {
  const source = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  const begin = source.indexOf("async function assertIdle(");
  const end = source.indexOf("async function worktrees(", begin);
  assert.ok(begin >= 0 && end > begin);
  const js = ts.transpileModule(source.slice(begin, end) + "\nreturn idle;",
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let indexReads = 0;
  const idle = new Function("git", "existsSync", "toNativePath", "operationMarkerPaths", "OPERATION_MARKERS", "gitOutput", "records", js)(
    git, () => false, (path) => path, (cwd) => operationMarkerPaths(cwd, git), OPERATION_MARKERS,
    (_cwd, args) => { assert.deepEqual(args, ["ls-files", "-v", "-z"]); indexReads++; return index; },
    async function* (entries) { yield* entries; });
  return { idle, indexReads: () => indexReads };
}

function markerOutput(args) {
  return args.filter((arg, index) => args[index - 1] === "--git-path")
    .map((name) => `/fixture/.git/${name}\n`).join("");
}

test("production idle validation uses one marker query and retains sparse-checkout and index checks", async () => {
  const calls = [];
  const { idle, indexReads } = await productionIdle(async (_cwd, args) => {
    calls.push(args);
    return args[0] === "config" ? "false\n" : markerOutput(args);
  });
  await idle("checkout");
  assert.equal(calls.filter((args) => args[0] === "rev-parse").length, 1);
  assert.deepEqual(calls.at(-1), ["config", "--get", "core.sparseCheckout"]);
  assert.equal(indexReads(), 1);
});

for (const status of [1, 128]) {
  test(`production idle rejects marker-resolution status ${status} before config or index reads`, async () => {
    const failure = Object.assign(new Error("Git marker read failed"), { status });
    let calls = 0;
    const { idle, indexReads } = await productionIdle(async () => { calls++; throw failure; });
    await assert.rejects(idle("checkout"), (error) => error === failure);
    assert.equal(calls, 1);
    assert.equal(indexReads(), 0);
  });
}

test("production idle rejects fallback marker-resolution status 1 without treating it as absent config", async () => {
  const failure = Object.assign(new Error("Individual marker read failed"), { status: 1 });
  let calls = 0;
  const { idle, indexReads } = await productionIdle(async () => {
    if (++calls === 1) return "unusual output\n";
    throw failure;
  });
  await assert.rejects(idle("checkout"), (error) => error === failure);
  assert.equal(calls, 2);
  assert.equal(indexReads(), 0);
});

test("only absent sparse-checkout config permits continuing to the index check", async () => {
  const calls = [];
  const { idle, indexReads } = await productionIdle(async (_cwd, args) => {
    calls.push(args);
    if (args[0] === "config") throw Object.assign(new Error("Absent setting"), { status: 1 });
    return markerOutput(args);
  });
  await idle("checkout");
  assert.equal(calls.length, 2);
  assert.equal(indexReads(), 1);
});

test("other sparse-checkout config failures propagate before index reads", async () => {
  const failure = Object.assign(new Error("Config read failed"), { status: 128 });
  const { idle, indexReads } = await productionIdle(async (_cwd, args) => {
    if (args[0] === "config") throw failure;
    return markerOutput(args);
  });
  await assert.rejects(idle("checkout"), (error) => error === failure);
  assert.equal(indexReads(), 0);
});

test("enabled sparse checkout still refuses idle validation", async () => {
  const { idle, indexReads } = await productionIdle(async (_cwd, args) => args[0] === "config" ? "true\n" : markerOutput(args));
  await assert.rejects(idle("checkout"), /Sparse checkout is unsupported/);
  assert.equal(indexReads(), 0);
});

for (const flag of ["a", "S"]) {
  test(`hidden index flag ${flag} still refuses after an absent sparse-checkout setting`, async () => {
    const { idle, indexReads } = await productionIdle(async (_cwd, args) => {
      if (args[0] === "config") throw Object.assign(new Error("Absent setting"), { status: 1 });
      return markerOutput(args);
    }, [`${flag} ordinary`]);
    await assert.rejects(idle("checkout"), /Hidden index flags are unsupported/);
    assert.equal(indexReads(), 1);
  });
}
