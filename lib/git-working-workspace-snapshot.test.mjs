import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
// Own compiledRoot, never a shared test output directory. Keep the project's
// default target (ES2017); BigInt constructors work without raising it.
const compiledRoot = fs.mkdtempSync(join(tmpdir(), "pi-working-content-compiled-"));
const config = ts.readConfigFile(join(sourceRoot, "..", "tsconfig.json"), ts.sys.readFile);
const compilerOptions = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, sourceRoot).options;
for (const name of ["git-exec", "git-working-workspace-snapshot"]) {
  const source = fs.readFileSync(join(sourceRoot, `${name}.ts`), "utf8");
  const output = ts.transpileModule(source, { fileName: `${name}.ts`, compilerOptions: {
    ...compilerOptions, module: ts.ModuleKind.CommonJS, noEmit: false, incremental: false,
  } });
  fs.writeFileSync(join(compiledRoot, `${name}.js`), output.outputText);
}
const previousEnvironment = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
const testHome = join(compiledRoot, "home");
fs.mkdirSync(testHome);
process.env.HOME = testHome; process.env.XDG_CONFIG_HOME = join(testHome, ".config");
const require = createRequire(import.meta.url);
const { captureGitWorkingWorkspaceContentManifest: capture, GIT_WORKING_WORKSPACE_LIMITS: limits } =
  require(join(compiledRoot, "git-working-workspace-snapshot.js"));
const jiti = createJiti(import.meta.url);
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
after(() => {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(compiledRoot, { recursive: true, force: true });
});
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
});
async function fixture(t, internalAdmin = false) {
  const home = fs.mkdtempSync(join(tmpdir(), "pi-working-content-")), cwd = join(home, "repo");
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  if (internalAdmin) fs.mkdirSync(cwd);
  git(home, "init", "-q", "-b", "main", ...(internalAdmin ? [`--separate-git-dir=${join(cwd, "administration")}`] : []), cwd);
  git(cwd, "config", "user.name", "Fixture"); git(cwd, "config", "user.email", "fixture@example.invalid");
  fs.mkdirSync(join(cwd, "src"));
  fs.writeFileSync(join(cwd, "src", "note"), "first\nsecond\nthird\n");
  fs.writeFileSync(join(cwd, ".gitignore"), "ignored-cache/\n");
  git(cwd, "add", ".gitignore", "src/note"); git(cwd, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "base");
  allowFileRoot(cwd);
  let selection;
  if (internalAdmin) {
    // Git's worktree-list reports the separate git-dir itself as primary in
    // this layout, so capture the REAL disposable repository's physical
    // resources directly. No mocked Git output or fabricated identities.
    const gitDir = git(cwd, "rev-parse", "--path-format=absolute", "--git-dir").trim();
    const commonDir = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
    assert.equal(git(cwd, "rev-parse", "--show-toplevel").trim(), cwd);
    const physical = (file) => {
      const s = fs.lstatSync(file, { bigint: true });
      return { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) };
    };
    const marker = fs.lstatSync(join(cwd, ".git"), { bigint: true });
    selection = { projectRoot: cwd, cwd, branch: "main", gitDir, commonDir, identities: {
      project: physical(cwd), checkout: physical(cwd), common: physical(commonDir), git: physical(gitDir),
      marker: { ...physical(join(cwd, ".git")), changed: String(marker.ctimeNs), size: String(marker.size) },
    } };
  } else selection = await selectGitProjectResources(cwd);
  return { home, cwd, selection, file: join(cwd, "src", "note"), index: join(selection.gitDir, "index") };
}
const unsupported = (fn) => assert.throws(fn, (error) => ["unsupported", "bounded", "unavailable"].includes(error.code));
const changed = (fn) => assert.throws(fn, (error) => error.code === "changed");

// Alter the real fixture at a precise in-read boundary, not a mocked Git repo or
// fabricated filesystem result. Every actual open/stat/read still runs normally.
function duringRead(t, suffix, mutate) {
  const original = fs.readSync; let fired = false;
  t.mock.method(fs, "readSync", function (fd, ...args) {
    const count = original.call(fs, fd, ...args);
    if (!fired && count > 0 && fs.readlinkSync(`/proc/${process.pid}/fd/${fd}`).endsWith(suffix)) {
      fired = true; mutate(fd);
    }
    return count;
  });
  return () => { t.mock.restoreAll(); assert.equal(fired, true); };
}

test("same MM porcelain but different actual dirty bytes changes digest; index and partial hunks survive exactly", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(f.file, "FIRST\nsecond\nthird\n"); git(f.cwd, "add", "src/note");
  fs.writeFileSync(f.file, "FIRST\nsecond\nTHIRD\n");
  fs.writeFileSync(join(f.cwd, "unrelated"), "already staged\n"); git(f.cwd, "add", "unrelated");
  const beforeIndex = fs.readFileSync(f.index), cached = git(f.cwd, "diff", "--cached", "--no-ext-diff"),
    unstaged = git(f.cwd, "diff", "--no-ext-diff"), status = git(f.cwd, "status", "--porcelain=v1", "-z");
  assert.match(status, /MM src\/note/);
  const a = capture(f.selection);
  assert.deepEqual(capture(f.selection), a);
  assert.deepEqual(fs.readFileSync(f.index), beforeIndex);
  assert.equal(git(f.cwd, "diff", "--cached", "--no-ext-diff"), cached);
  assert.equal(git(f.cwd, "diff", "--no-ext-diff"), unstaged);
  fs.writeFileSync(f.file, "FIRST\nsecond\nOTHER\n");
  assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), status);
  const b = capture(f.selection);
  assert.notEqual(a.digest, b.digest); assert.equal(a.indexDigest, b.indexDigest);
  assert.deepEqual(fs.readFileSync(f.index), beforeIndex);
  assert.equal(git(f.cwd, "diff", "--cached", "--no-ext-diff"), cached);
  assert.equal(a.summary.coverage, "tracked-index-head-union-and-nonignored-physical-workspace");
  assert.equal(a.version, 2);
  assert.equal(JSON.stringify(a).includes("already staged"), false);
  assert.equal(JSON.stringify(a).includes("src/note"), false);
  assert.equal(Object.isFrozen(a.summary), true);
});

test("capture opens read-only and invokes only bounded local Git enumeration with a pinned index", async (t) => {
  const f = await fixture(t), originalOpen = fs.openSync, originalGit = childProcess.execFileSync;
  const index = fs.readFileSync(f.index); let commands = 0;
  t.mock.method(fs, "openSync", (file, flags, ...args) => {
    assert.equal(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND), 0);
    assert.ok(flags & fs.constants.O_NOFOLLOW);
    return originalOpen.call(fs, file, flags, ...args);
  });
  for (const method of ["writeSync", "writeFileSync", "chmodSync", "mkdirSync", "renameSync", "unlinkSync", "rmSync", "copyFileSync"]) {
    t.mock.method(fs, method, () => { assert.fail(`capture must not invoke ${method}`); });
  }
  t.mock.method(childProcess, "execFileSync", (file, args, options) => {
    commands++;
    assert.equal(file, "git");
    assert.ok(args.includes("ls-files") || args.includes("ls-tree") || args.includes("check-ignore") || args.includes("config"));
    if (args.includes("config")) {
      assert.ok(args.includes("--no-includes")); assert.ok(args.includes("--file")); assert.ok(args.includes("-"));
      assert.equal(options.cwd, "/"); assert.equal(options.env.GIT_CONFIG_GLOBAL, "/dev/null");
    } else {
      assert.ok(args.includes("--no-optional-locks"));
      assert.equal(fs.readlinkSync(options.env.GIT_INDEX_FILE), f.index);
    }
    assert.equal(options.env.GIT_ALLOW_PROTOCOL, ""); assert.equal(options.env.GIT_NO_LAZY_FETCH, "1");
    assert.equal(options.maxBuffer, limits.gitStdoutBytes); assert.ok(options.timeout <= 15_000);
    return originalGit.call(childProcess, file, args, options);
  });
  try {
    const manifest = capture(f.selection);
    assert.deepEqual(Object.keys(manifest).sort(), ["digest", "indexDigest", "summary", "version"]);
    assert.ok(commands >= 6 && commands <= limits.gitCommands);
  } finally { t.mock.restoreAll(); }
  assert.deepEqual(fs.readFileSync(f.index), index);
});

test("actual index bytes are separately bound and part of the aggregate even with identical working files", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(f.file, "dirty\n");
  const a = capture(f.selection); git(f.cwd, "add", "src/note"); const b = capture(f.selection);
  assert.notEqual(a.indexDigest, b.indexDigest); assert.notEqual(a.digest, b.digest);
  assert.equal(a.summary.totalBytes, b.summary.totalBytes);
});

test("HEAD/index union includes staged and unstaged deletions plus file-to-directory transitions", async (t) => {
  const f = await fixture(t);
  git(f.cwd, "rm", "-q", "src/note");
  const deletion = capture(f.selection);
  assert.equal(deletion.summary.tracked, 2); assert.equal(deletion.summary.absent, 1);
  fs.mkdirSync(f.file, { recursive: true }); fs.writeFileSync(join(f.file, "new"), "new child");
  const directory = capture(f.selection);
  assert.equal(directory.summary.directories, 2); assert.equal(directory.summary.untracked, 2);
  assert.notEqual(directory.digest, deletion.digest);
  git(f.cwd, "add", "src/note/new");
  const staged = capture(f.selection);
  assert.equal(staged.summary.tracked, 3); assert.equal(staged.summary.directories, 2);
  fs.unlinkSync(join(f.cwd, ".gitignore"));
  assert.equal(capture(f.selection).summary.absent, 1, "unstaged deletion remains covered");
});

test("physical executable/type changes are captured even with core.fileMode=false", async (t) => {
  const f = await fixture(t); git(f.cwd, "config", "core.fileMode", "false");
  const status = git(f.cwd, "status", "--porcelain=v1", "-z"), a = capture(f.selection);
  fs.chmodSync(f.file, 0o755); const b = capture(f.selection);
  assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), status);
  assert.notEqual(a.digest, b.digest); assert.equal(a.indexDigest, b.indexDigest);
  fs.unlinkSync(f.file); fs.symlinkSync("missing-target", f.file);
  const c = capture(f.selection); assert.equal(c.summary.symlinks, 1); assert.notEqual(c.digest, b.digest);
});

test("nonignored untracked ordinary bytes, empty files and Unicode are counted without undercount", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(join(f.cwd, "empty"), ""); fs.writeFileSync(join(f.cwd, "雪-é"), "☃雪");
  const a = capture(f.selection);
  assert.equal(a.summary.paths, 5); assert.equal(a.summary.untracked, 3); assert.equal(a.summary.regularFiles, 4);
  const expected = [".gitignore", "src/note", "empty", "雪-é"].reduce((n, file) => n + fs.statSync(join(f.cwd, file)).size, 0);
  assert.equal(a.summary.totalBytes, expected);
  const status = git(f.cwd, "status", "--porcelain=v1", "-z");
  fs.writeFileSync(join(f.cwd, "雪-é"), "☃雨"); const b = capture(f.selection);
  assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), status); assert.notEqual(a.digest, b.digest);
  unsupported(() => capture(f.selection, { paths: 3 }));
  unsupported(() => capture(f.selection, { pathBytes: Buffer.byteLength("雪-é") - 1 }));
  unsupported(() => capture(f.selection, { totalBytes: expected - 1 }));
});

test("ignored caches remain outside labelled coverage, including ignored special files and nested Git", async (t) => {
  const f = await fixture(t), cache = join(f.cwd, "ignored-cache");
  const a = capture(f.selection); fs.mkdirSync(cache);
  fs.writeFileSync(join(cache, "dep"), "dependency-cache-a");
  execFileSync("mkfifo", [join(cache, "pipe")]); fs.mkdirSync(join(cache, ".git"));
  const b = capture(f.selection); assert.equal(b.digest, a.digest);
  fs.writeFileSync(join(cache, "dep"), "dependency-cache-b");
  assert.deepEqual(capture(f.selection), b);
  assert.equal(a.summary.ignoredCachesCovered, false); assert.equal(a.summary.externalInputsCovered, false);
});

test("tracked symlink target BYTES are captured without reading an external or broken target", async (t) => {
  const f = await fixture(t), outside = join(f.home, "external");
  fs.writeFileSync(outside, "do-not-read-this-secret"); fs.chmodSync(outside, 0);
  fs.symlinkSync(Buffer.from(outside), join(f.cwd, "link")); git(f.cwd, "add", "link");
  const a = capture(f.selection); assert.equal(a.summary.symlinks, 1);
  assert.equal(a.summary.totalBytes, fs.statSync(f.file).size + fs.statSync(join(f.cwd, ".gitignore")).size + Buffer.byteLength(outside));
  fs.chmodSync(outside, 0o600); fs.writeFileSync(outside, "different external secret");
  assert.deepEqual(capture(f.selection), a, "external target bytes were not hashed");
  fs.unlinkSync(join(f.cwd, "link"));
  fs.symlinkSync(Buffer.from([0x66, 0x80, 0xff]), join(f.cwd, "link"));
  const b = capture(f.selection);
  assert.notEqual(a.digest, b.digest); assert.equal(a.indexDigest, b.indexDigest);
  assert.equal(b.summary.totalBytes, fs.statSync(f.file).size + fs.statSync(join(f.cwd, ".gitignore")).size + 3);
  assert.equal(JSON.stringify(b).includes(outside), false);
});

test("static symlink parents are refused, not followed to external files", async (t) => {
  const f = await fixture(t), original = join(f.home, "outside");
  fs.renameSync(join(f.cwd, "src"), original); fs.symlinkSync(original, join(f.cwd, "src"));
  unsupported(() => capture(f.selection));
});

test("root and parent replacement during an open read are detected through original directory FDs", async (t) => {
  for (const what of ["root", "parent", "parent-restored"]) {
    const f = await fixture(t);
    const restore = duringRead(t, "/src/note", () => {
      const source = what === "root" ? f.cwd : join(f.cwd, "src"), moved = `${source}-old`;
      fs.renameSync(source, moved);
      if (what === "parent-restored") fs.renameSync(moved, source);
      else {
        fs.mkdirSync(source);
        if (what === "root") { fs.mkdirSync(join(source, "src")); fs.writeFileSync(join(source, "src/note"), "replacement"); }
        else fs.writeFileSync(join(source, "note"), "replacement");
      }
    });
    try { changed(() => capture(f.selection)); } finally { restore(); }
  }
});

test("stale selected root is refused before reading workspace bytes", async (t) => {
  const f = await fixture(t);
  fs.renameSync(f.cwd, `${f.cwd}-old`); fs.mkdirSync(f.cwd);
  changed(() => capture(f.selection));
});

test("transient write-and-restore and named regular-file replacement are detected", async (t) => {
  for (const what of ["restored", "replacement"]) {
    const f = await fixture(t), before = fs.readFileSync(f.file);
    const restore = duringRead(t, "/src/note", () => {
      if (what === "restored") { fs.writeFileSync(f.file, "transient\n"); fs.writeFileSync(f.file, before); }
      else { fs.renameSync(f.file, `${f.file}-old`); fs.writeFileSync(f.file, before); }
    });
    try { changed(() => capture(f.selection)); } finally { restore(); }
  }
});

test("broken regular resources, FIFOs, oversized content/index and finite metadata bounds fail closed", async (t) => {
  for (const what of ["fifo", "unreadable", "oversized", "index-symlink", "index-oversized", "nested"]) {
    const f = await fixture(t);
    if (what === "fifo") { fs.unlinkSync(f.file); execFileSync("mkfifo", [f.file]); }
    if (what === "unreadable") fs.chmodSync(f.file, 0);
    if (what === "oversized") fs.truncateSync(f.file, limits.fileBytes + 1);
    if (what === "index-symlink") { fs.renameSync(f.index, `${f.index}-old`); fs.symlinkSync(`${f.index}-old`, f.index); }
    if (what === "index-oversized") fs.truncateSync(f.index, limits.indexBytes + 1);
    if (what === "nested") { fs.mkdirSync(join(f.cwd, "nested")); git(join(f.cwd, "nested"), "init", "-q"); }
    unsupported(() => capture(f.selection));
  }
  const f = await fixture(t);
  for (const reduced of [{ fileBytes: 1 }, { indexBytes: 1 }, { gitStdoutBytes: 1 }, { directories: 1 }, { depth: 1 }, { paths: 1 }, { totalBytes: 1 }, { paths: 0 }, { fileBytes: limits.fileBytes + 1 }]) {
    unsupported(() => capture(f.selection, reduced));
  }
});

test("index pathname replacement cannot retarget Git to an external index or credential-like file", async (t) => {
  const f = await fixture(t), outside = join(f.home, "private-outside");
  fs.writeFileSync(outside, "not an index: must not read");
  const restore = duringRead(t, "/src/note", () => {
    fs.renameSync(f.index, `${f.index}-old`); fs.symlinkSync(outside, f.index);
  });
  try { changed(() => capture(f.selection)); } finally { restore(); }
});

test("multi-chunk files stream actual bytes; edits past the first chunk change the digest", async (t) => {
  const f = await fixture(t), data = Buffer.alloc(3 * 64 * 1024, 0x61);
  fs.writeFileSync(f.file, data);
  const a = capture(f.selection); data[data.length - 1] = 0x62; fs.writeFileSync(f.file, data);
  const b = capture(f.selection);
  assert.notEqual(a.digest, b.digest); assert.equal(a.indexDigest, b.indexDigest);
  assert.equal(b.summary.totalBytes, data.length + fs.statSync(join(f.cwd, ".gitignore")).size);
});

test("root nonignored FIFO omitted by Git is physically discovered and refused", async (t) => {
  const f = await fixture(t);
  execFileSync("mkfifo", [join(f.cwd, "pipe")]);
  assert.equal(git(f.cwd, "ls-files", "--others", "--exclude-standard", "-z"), "");
  unsupported(() => capture(f.selection));
});

test("conflicts and gitlinks are unsupported, not fabricated clean proof", async (t) => {
  const f = await fixture(t), oid = git(f.cwd, "rev-parse", "HEAD:src/note").trim();
  git(f.cwd, "update-index", "--add", "--cacheinfo", `160000,${git(f.cwd, "rev-parse", "HEAD").trim()},submodule`);
  unsupported(() => capture(f.selection));
  git(f.cwd, "update-index", "--force-remove", "submodule");
  execFileSync("git", ["-C", f.cwd, "update-index", "--index-info"], {
    input: `0 ${"0".repeat(40)}\tsrc/note\n100644 ${oid} 1\tsrc/note\n100644 ${oid} 2\tsrc/note\n`, stdio: ["pipe", "pipe", "pipe"],
  });
  unsupported(() => capture(f.selection));
});

test("nonignored sockets and unreadable untracked files/directories are unsupported", async (t) => {
  const f = await fixture(t), socket = join(f.cwd, "socket"), server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
  try {
    assert.equal(git(f.cwd, "ls-files", "--others", "--exclude-standard", "-z"), "");
    unsupported(() => capture(f.selection));
  } finally { await new Promise((resolve) => server.close(resolve)); }
  for (const kind of ["file", "directory"]) {
    const f = await fixture(t), resource = join(f.cwd, "unreadable");
    if (kind === "file") fs.writeFileSync(resource, "unreadable"); else fs.mkdirSync(resource);
    fs.chmodSync(resource, 0);
    unsupported(() => capture(f.selection));
    fs.chmodSync(resource, kind === "file" ? 0o600 : 0o700);
  }
});

test("all nonignored empty directories are counted and bounded even when Git untracked output is empty", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 12; i++) fs.mkdirSync(join(f.cwd, `empty-${i}`));
  assert.equal(git(f.cwd, "ls-files", "--others", "--exclude-standard", "-z"), "");
  const a = capture(f.selection);
  assert.equal(a.summary.directories, 13); assert.equal(a.summary.inventoryDirectories, 14);
  assert.equal(a.summary.paths, 15); assert.equal(a.summary.untracked, 13);
  unsupported(() => capture(f.selection, { paths: 8 }));
  unsupported(() => capture(f.selection, { inventoryEntries: 8 }));
  unsupported(() => capture(f.selection, { directories: 8 }));
  for (let i = 0; i < 12; i++) execFileSync("mkfifo", [join(f.cwd, `pipe-${i}`)]);
  assert.equal(git(f.cwd, "ls-files", "--others", "--exclude-standard", "-z"), "");
  assert.throws(() => capture(f.selection, { inventoryEntries: 8 }), (error) => error.code === "bounded");
});

test("ordinary, config and object hardlinks are explicitly unsupported before alias content reads", async (t) => {
  for (const source of ["ordinary", "config", "object"]) {
    const f = await fixture(t);
    const oid = git(f.cwd, "rev-parse", "HEAD:src/note").trim();
    const target = source === "ordinary" ? f.file : source === "config" ? join(f.selection.gitDir, "config") :
      join(f.selection.gitDir, "objects", oid.slice(0, 2), oid.slice(2));
    const alias = join(f.cwd, "admin-copy"); fs.linkSync(target, alias);
    const original = fs.readSync; let aliasReads = 0, configReads = 0;
    t.mock.method(fs, "readSync", (fd, ...args) => {
      const file = fs.readlinkSync(`/proc/${process.pid}/fd/${fd}`);
      if (file === alias) aliasReads++;
      if (file === join(f.selection.gitDir, "config")) configReads++;
      return original.call(fs, fd, ...args);
    });
    try {
      unsupported(() => capture(f.selection)); assert.equal(aliasReads, 0);
      if (source === "config") assert.equal(configReads, 0, "linked config is refused before its bounded parser read too");
    } finally { t.mock.restoreAll(); }
  }
});

test("actual separate Git/common directory inside checkout is excluded before ordinary inventory/content reads", async (t) => {
  const f = await fixture(t, true), administrative = join(f.cwd, "administration");
  assert.equal(f.selection.gitDir, administrative); assert.equal(f.selection.commonDir, administrative);
  assert.match(git(f.cwd, "ls-files", "--others", "--exclude-standard", "-z"), /administration/);
  const a = capture(f.selection);
  assert.equal(a.summary.paths, 3); assert.equal(a.summary.directories, 1);
  execFileSync("mkfifo", [join(administrative, "special")]);
  fs.writeFileSync(join(administrative, ".gitignore"), "x"); fs.truncateSync(join(administrative, ".gitignore"), limits.ignoreFileBytes + 1);
  const huge = join(administrative, "huge"); fs.writeFileSync(huge, ""); fs.truncateSync(huge, limits.fileBytes * 2);
  assert.deepEqual(capture(f.selection), a, "only known administrative metadata is read, never ordinary admin subtree contents");
});

test("ignored huge/unreadable caches are pruned without opening or enumerating their contents", async (t) => {
  const f = await fixture(t), cache = join(f.cwd, "ignored-cache");
  fs.mkdirSync(cache); fs.writeFileSync(join(cache, ".gitignore"), ""); fs.truncateSync(join(cache, ".gitignore"), limits.ignoreFileBytes * 2);
  fs.writeFileSync(join(cache, "huge"), ""); fs.truncateSync(join(cache, "huge"), limits.totalBytes * 2);
  for (let i = 0; i < 100; i++) fs.mkdirSync(join(cache, `empty-${i}`));
  execFileSync("mkfifo", [join(cache, "pipe")]); fs.chmodSync(cache, 0);
  const originalOpen = fs.openSync, originalDir = fs.opendirSync;
  const assertNotCache = (name) => {
    const text = String(name);
    if (text.startsWith("/proc/")) {
      const match = text.match(/^\/proc\/\d+\/fd\/\d+/);
      const physical = fs.readlinkSync(match[0]) + text.slice(match[0].length);
      assert.equal(physical.includes("/ignored-cache"), false);
    }
  };
  t.mock.method(fs, "openSync", (name, ...args) => { assertNotCache(name); return originalOpen.call(fs, name, ...args); });
  t.mock.method(fs, "opendirSync", (name, ...args) => { assertNotCache(name); return originalDir.call(fs, name, ...args); });
  try {
    const a = capture(f.selection);
    assert.equal(a.summary.inventoryDirectories, 2); assert.equal(a.summary.directories, 1);
    assert.equal(a.summary.inventoryEntries, 5); assert.equal(a.summary.ignoredCachesCovered, false);
  } finally { t.mock.restoreAll(); fs.chmodSync(cache, 0o700); }
});

test("oversized encountered ignore/config inputs are refused before affected check-ignore classification", async (t) => {
  for (const kind of ["root", "nested", "info", "config", "global"]) {
    const f = await fixture(t), prior = process.env.XDG_CONFIG_HOME;
    let file;
    if (kind === "root") file = join(f.cwd, ".gitignore");
    if (kind === "nested") { fs.mkdirSync(join(f.cwd, "child")); file = join(f.cwd, "child", ".gitignore"); }
    if (kind === "info") file = join(f.selection.commonDir, "info", "exclude");
    if (kind === "config") file = join(f.selection.commonDir, "config");
    if (kind === "global") {
      process.env.XDG_CONFIG_HOME = join(f.home, "xdg"); fs.mkdirSync(join(process.env.XDG_CONFIG_HOME, "git"), { recursive: true });
      file = join(process.env.XDG_CONFIG_HOME, "git", "ignore");
    }
    fs.writeFileSync(file, ""); fs.truncateSync(file, limits.ignoreFileBytes + 1);
    const original = childProcess.execFileSync; let affectedClassifications = 0;
    t.mock.method(childProcess, "execFileSync", (command, args, options) => {
      if (args.includes("check-ignore") && (kind !== "nested" || options.input.includes(Buffer.from("child/")))) affectedClassifications++;
      return original.call(childProcess, command, args, options);
    });
    try {
      assert.throws(() => capture(f.selection), (error) => error.code === "bounded");
      assert.equal(affectedClassifications, 0);
    } finally { t.mock.restoreAll(); process.env.XDG_CONFIG_HOME = prior; }
  }
});

test("known bounded global and info ignore inputs classify special files; arbitrary external excludes/includes and symlink inputs are refused", async (t) => {
  const f = await fixture(t), prior = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(f.home, "xdg"); fs.mkdirSync(join(process.env.XDG_CONFIG_HOME, "git"), { recursive: true });
  const ignore = join(process.env.XDG_CONFIG_HOME, "git", "ignore"); fs.writeFileSync(ignore, "global-pipe\n");
  fs.writeFileSync(join(f.selection.commonDir, "info", "exclude"), "local-pipe\n");
  execFileSync("mkfifo", [join(f.cwd, "global-pipe")]); execFileSync("mkfifo", [join(f.cwd, "local-pipe")]);
  try {
    const a = capture(f.selection); assert.equal(a.summary.paths, 3);
    fs.writeFileSync(ignore, "global-pipe\n# classification bytes bound\n");
    assert.notEqual(capture(f.selection).digest, a.digest);
    const outside = join(f.home, "credential-like"); fs.writeFileSync(outside, "not read as an arbitrary ignore file");
    git(f.cwd, "config", "core.excludesFile", outside);
    unsupported(() => capture(f.selection));
    git(f.cwd, "config", "--unset", "core.excludesFile");
    fs.unlinkSync(ignore); fs.symlinkSync(outside, ignore);
    unsupported(() => capture(f.selection));
    fs.unlinkSync(ignore); fs.writeFileSync(ignore, "global-pipe\n");
    git(f.cwd, "config", "include.path", outside);
    unsupported(() => capture(f.selection));
  } finally { process.env.XDG_CONFIG_HOME = prior; }
});

test("worktreeConfig numeric/unknown encodings cannot bypass prechecking; bare true includes are refused before repository Git commands", async (t) => {
  for (const encoding of ["2", "0x2", "bogus", "", null, "true", "yes", "on", "1"]) {
    const f = await fixture(t), configFile = join(f.selection.commonDir, "config"), worktreeFile = join(f.selection.gitDir, "config.worktree");
    const external = join(f.home, "unread-external-placeholder");
    fs.writeFileSync(external, "[fixture]\nsecret = never-read-placeholder\n"); fs.chmodSync(external, 0);
    fs.writeFileSync(worktreeFile, `[include]\npath = ${external}\n`);
    const config = fs.readFileSync(configFile, "utf8");
    assert.match(config, /repositoryformatversion = 0/);
    fs.writeFileSync(configFile, config.replace("repositoryformatversion = 0", "repositoryformatversion = 1") +
      `[extensions]\nworktreeConfig${encoding === null ? "" : ` = ${encoding}`}\n`);
    const originalGit = childProcess.execFileSync, originalRead = fs.readSync;
    let repositoryCommands = 0, externalReads = 0, worktreeReads = 0;
    t.mock.method(childProcess, "execFileSync", (command, args, options) => {
      if (args.some((arg) => arg.startsWith("--git-dir="))) repositoryCommands++;
      // The only permitted Git calls before refusal parse already-bounded
      // config bytes outside any repo with includes and discovery disabled.
      assert.equal(options.cwd, "/"); assert.equal(options.env.GIT_CONFIG_GLOBAL, "/dev/null");
      assert.ok(args.includes("--no-includes")); assert.ok(args.includes("--file")); assert.ok(args.includes("-"));
      return originalGit.call(childProcess, command, args, options);
    });
    t.mock.method(fs, "readSync", (fd, ...args) => {
      const file = fs.readlinkSync(`/proc/${process.pid}/fd/${fd}`);
      if (file === external) externalReads++;
      if (file === worktreeFile) worktreeReads++;
      return originalRead.call(fs, fd, ...args);
    });
    try {
      assert.throws(() => capture(f.selection), (error) => error.code === "unsupported");
      assert.equal(repositoryCommands, 0); assert.equal(externalReads, 0);
      assert.equal(worktreeReads > 0, encoding === null || ["true", "yes", "on", "1"].includes(encoding));
    } finally { t.mock.restoreAll(); fs.chmodSync(external, 0o600); }
  }
});

test("known false worktreeConfig representations skip inactive external includes without reading them", async (t) => {
  for (const encoding of ["0", "false", "no", "off"]) {
    const f = await fixture(t), configFile = join(f.selection.commonDir, "config"), worktreeFile = join(f.selection.gitDir, "config.worktree");
    const external = join(f.home, "unread-external-placeholder");
    fs.writeFileSync(external, "[fixture]\nsecret = never-read-placeholder\n"); fs.chmodSync(external, 0);
    fs.writeFileSync(worktreeFile, `[include]\npath = ${external}\n`);
    const config = fs.readFileSync(configFile, "utf8");
    fs.writeFileSync(configFile, config.replace("repositoryformatversion = 0", "repositoryformatversion = 1") +
      `[extensions]\nworktreeConfig = ${encoding}\n`);
    const originalRead = fs.readSync; let unexpectedReads = 0;
    t.mock.method(fs, "readSync", (fd, ...args) => {
      const file = fs.readlinkSync(`/proc/${process.pid}/fd/${fd}`);
      if (file === external || file === worktreeFile) unexpectedReads++;
      return originalRead.call(fs, fd, ...args);
    });
    try {
      assert.equal(capture(f.selection).summary.coverage, "tracked-index-head-union-and-nonignored-physical-workspace");
      assert.equal(unexpectedReads, 0);
    } finally { t.mock.restoreAll(); fs.chmodSync(external, 0o600); }
  }
});

test("whole-capture own read, ignore total, input/name volume and command count budgets are enforced", async (t) => {
  const f = await fixture(t), a = capture(f.selection);
  assert.ok(a.summary.readBytes >= a.summary.totalBytes + 2 * a.summary.indexBytes + a.summary.ignoreBytes);
  for (const reduced of [
    { readBytes: a.summary.readBytes - 1 }, { ignoreTotalBytes: 1 }, { gitInputBytes: 1 },
    { gitCommands: 1 }, { inventoryNameBytes: 1 }, { inventoryEntries: 1 },
  ]) assert.throws(() => capture(f.selection, reduced), (error) => error.code === "bounded");
  fs.writeFileSync(join(f.cwd, "雪-é"), "snow");
  const b = capture(f.selection);
  assert.equal(b.summary.inventoryNameBytes - a.summary.inventoryNameBytes, Buffer.byteLength("雪-é"));
});

test("Git negations/directory patterns are respected and tracked files under ignored parents remain covered", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(join(f.cwd, ".gitignore"), "ignored-cache/\n*.tmp\n!kept.tmp\nsrc/\n");
  fs.writeFileSync(join(f.cwd, "kept.tmp"), "kept"); fs.writeFileSync(join(f.cwd, "skip.tmp"), "ignored");
  const a = capture(f.selection);
  assert.equal(a.summary.tracked, 2); assert.equal(a.summary.untracked, 1);
  fs.writeFileSync(f.file, "tracked despite ignored parent\n");
  assert.notEqual(capture(f.selection).digest, a.digest);
  fs.writeFileSync(join(f.cwd, "skip.tmp"), "ignored changed");
  const b = capture(f.selection); fs.writeFileSync(join(f.cwd, "skip.tmp"), "ignored again");
  assert.equal(capture(f.selection).digest, b.digest);
});

test("tracked file-to-ignored-directory transitions bind type without scanning ignored descendants", async (t) => {
  const f = await fixture(t); git(f.cwd, "rm", "-q", "src/note");
  fs.mkdirSync(f.file, { recursive: true });
  fs.writeFileSync(join(f.cwd, ".gitignore"), "ignored-cache/\nsrc/note/\n");
  fs.writeFileSync(join(f.file, ".gitignore"), ""); fs.truncateSync(join(f.file, ".gitignore"), limits.ignoreFileBytes * 2);
  execFileSync("mkfifo", [join(f.file, "pipe")]);
  const a = capture(f.selection);
  assert.equal(a.summary.directories, 2); assert.equal(a.summary.inventoryDirectories, 2);
  assert.equal(a.summary.tracked, 2); assert.equal(a.summary.regularFiles, 1);
  fs.writeFileSync(join(f.file, "cache"), "ignored contents");
  assert.equal(capture(f.selection).digest, a.digest);
});

test("ordinary control-character and BOM/Unicode names remain distinct, byte-counted and non-argument inputs", async (t) => {
  const f = await fixture(t), names = ["tab\tfile", "line\nfile", "-option", "\\literal", "\ufeffbom", "雪", ".GiT"];
  const a = capture(f.selection);
  for (const name of names) fs.writeFileSync(join(f.cwd, name), "");
  const b = capture(f.selection);
  assert.equal(b.summary.paths - a.summary.paths, names.length);
  assert.equal(b.summary.regularFiles - a.summary.regularFiles, names.length);
  assert.equal(b.summary.totalBytes, a.summary.totalBytes);
  assert.equal(b.summary.inventoryNameBytes - a.summary.inventoryNameBytes, names.reduce((n, name) => n + Buffer.byteLength(name), 0));
  assert.notEqual(b.digest, a.digest);
  assert.deepEqual(capture(f.selection), b);
});

test("identical ordinary tracked-file recreation retains content proof, not cross-capture inode continuity", async (t) => {
  const f = await fixture(t), a = capture(f.selection), content = fs.readFileSync(f.file), old = fs.statSync(f.file).ino;
  fs.renameSync(f.file, join(f.home, "retained-old-file")); fs.writeFileSync(f.file, content);
  assert.notEqual(fs.statSync(f.file).ino, old);
  assert.deepEqual(capture(f.selection), a);
});

test("deterministic checkout-relative paths regardless of calling process cwd or creation order", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(join(f.cwd, "z"), "last"); fs.writeFileSync(join(f.cwd, "a"), "first");
  const a = capture(f.selection), prior = process.cwd();
  try { process.chdir(f.home); assert.deepEqual(capture(f.selection), a); }
  finally { process.chdir(prior); }
  fs.unlinkSync(join(f.cwd, "a")); fs.unlinkSync(join(f.cwd, "z"));
  fs.writeFileSync(join(f.cwd, "a"), "first"); fs.writeFileSync(join(f.cwd, "z"), "last");
  assert.deepEqual(capture(f.selection), a);
  assert.equal(process.cwd(), prior);
});
