import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  validateGitCheckRecipe: validate, validateGitCheckRecipes: validateList,
  normalizeGitCheckRecipe: normalize, selectGitCheckRecipesForStage: select,
  hasExtendedGitCheckRecipe: extended, validGitCheckCwd,
  MAX_GIT_CHECK_CWD, MAX_GIT_CHECK_ENV_ENTRIES, MAX_GIT_CHECK_ENV_NAME,
  MAX_GIT_CHECK_ENV_VALUE, MAX_GIT_CHECK_ENV_BYTES,
} = await jiti.import("./git-check-recipe.ts");
const { sanitizeProjectCommandEnvironment } = await jiti.import("./project-command-env.ts");
const old = { label: "Tests", argv: ["npm", "test"] };
const recipe = { ...old, cwd: "packages/web", env: { CI: "1", MODE: " a b ", EMPTY: "" }, requiredStage: "handoff" };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("legacy bytes and digest stay exact; only pure execution normalization inserts defaults", () => {
  const before = structuredClone(old);
  assert.equal(JSON.stringify(validate(old)), JSON.stringify(old));
  assert.equal(hash(validate(old)), hash(old));
  assert.equal(extended(validate(old)), false);
  assert.deepEqual(normalize(old), { ...old, cwd: ".", env: {}, requiredStage: "integration" });
  assert.deepEqual(old, before);
  for (const extra of [{ cwd: "." }, { env: {} }, { requiredStage: "integration" }]) {
    assert.equal(extended(validate({ ...old, ...extra })), true, "explicit defaults need a supported runner too");
    assert.equal(JSON.stringify(validate({ ...old, ...extra })), JSON.stringify({ ...old, ...extra }));
    assert.notEqual(hash(validate({ ...old, ...extra })), hash(old));
  }
});

test("extended recipe is a deep copy without expansion, trimming or shell evaluation", () => {
  const input = structuredClone(recipe);
  const copy = validate(input);
  assert.deepEqual(copy, input);
  copy.argv[0] = "changed"; copy.env.CI = "changed";
  assert.deepEqual(input, recipe);
  const literal = { ...old, env: { FLAGS: "$HOME $(echo literal); *", EMPTY: "", SPACES: "   " } };
  assert.deepEqual(normalize(literal).env, literal.env);
  for (const stage of ["commit", "integration", "handoff", "none"]) assert.equal(validate({ ...old, requiredStage: stage }).requiredStage, stage);
});

test("checkout-relative cwd refuses traversal, absolute and Windows-ambiguous paths", () => {
  for (const cwd of [".", "packages/web", ".pi/checks", "a-b_2/c++", "src.v2"]) assert.equal(validGitCheckCwd(cwd), true, cwd);
  for (const cwd of ["", "..", "./src", "src/.", "src/../test", "src//test", "/src", "//host/share", "C:/src", "C:src", "C:\\src",
    "\\\\host\\share", "src\\test", "src/", "src ", " src", "src.", "src/aux", "NUL.txt", "com1", "LPT9.log", "a:b", "a~1", "a\n", "a\0b", "é", null, [], 1,
    "x".repeat(MAX_GIT_CHECK_CWD + 1)]) assert.equal(validGitCheckCwd(cwd), false, String(cwd));
  assert.equal(validGitCheckCwd("x".repeat(MAX_GIT_CHECK_CWD)), true);
});

test("env bounds, portable names and sanitation denial are case-insensitive", () => {
  for (const name of ["CI", "_FLAG", "TEST_MODE", "a1"]) assert.deepEqual(validate({ ...old, env: { [name]: "" } }).env, { [name]: "" });
  const removed = ["PORT", "NODE_ENV", "NEXT_PUBLIC_VALUE", "NEXT_RUNTIME", "PI_WEB_PASSWORD"];
  for (const platform of ["linux", "win32"]) {
    assert.deepEqual(sanitizeProjectCommandEnvironment(Object.fromEntries(removed.map((key) => [key, "x"])), platform), {});
  }
  for (const name of [...removed, "GIT_DIR", "GIT_CONFIG_COUNT", "GIT_OPTIONAL_LOCKS", "GIT_NO_REPLACE_OBJECTS", "TOKEN", "API_KEY", "SECRET",
    "A-B", "1A", "A=B", "A B", "é", "", "x".repeat(MAX_GIT_CHECK_ENV_NAME + 1)]) {
    for (const key of [name, name.toLowerCase()]) assert.throws(() => validate({ ...old, env: { [key]: "x" } }), /Invalid Git workflow check/, key);
  }
  assert.throws(() => validate({ ...old, env: { CI: "1", ci: "2" } }));
  assert.doesNotThrow(() => validate({ ...old, env: { ["x".repeat(MAX_GIT_CHECK_ENV_NAME)]: "1" } }));
  for (const char of ["x", "é", "😀"]) {
    const value = char.repeat(MAX_GIT_CHECK_ENV_VALUE / Buffer.byteLength(char));
    assert.doesNotThrow(() => validate({ ...old, env: { TEST: value } }));
    assert.throws(() => validate({ ...old, env: { TEST: value + "x" } }));
  }
  const env = Object.fromEntries(Array.from({ length: MAX_GIT_CHECK_ENV_ENTRIES }, (_, i) => [`E${i}`, ""]));
  assert.doesNotThrow(() => validate({ ...old, env }));
  assert.throws(() => validate({ ...old, env: { ...env, EXTRA: "" } }));
  const total = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`E${i}`, "x".repeat(MAX_GIT_CHECK_ENV_VALUE)]));
  assert.ok(Object.entries(total).reduce((sum, [key, value]) => sum + key.length + value.length + 2, 0) > MAX_GIT_CHECK_ENV_BYTES);
  assert.throws(() => validate({ ...old, env: total }));
  const overhead = Object.keys(total).reduce((sum, key) => sum + key.length + 2, 0);
  total.E15 = "x".repeat(MAX_GIT_CHECK_ENV_VALUE - overhead);
  assert.doesNotThrow(() => validate({ ...old, env: total }), "aggregate byte boundary accepted");
  total.E15 += "x";
  assert.throws(() => validate({ ...old, env: total }), "aggregate boundary plus one refused");
});

test("strict extension unknown keys, sizes and types fail closed", () => {
  for (const extra of [{ shell: true }, { timeout: 10 }, { cwd: undefined }, { cwd: {} }, { cwd: false },
    { env: undefined }, { env: null }, { env: [] }, { env: "CI=1" }, { env: new Date() },
    { requiredStage: undefined }, { requiredStage: null }, { requiredStage: [] }, { requiredStage: 1 }, { requiredStage: "all" },
    ...[null, undefined, false, 1, [], {}].map((value) => ({ env: { CI: value } })),
    ...["a\0b", "a\nb", "a\tb", "a\u2028b", "https://example.invalid", "Bearer credential", "ghp_abcdefghijklmno"].map((value) => ({ env: { CI: value } }))]) {
    assert.throws(() => validate({ ...old, ...extra }), /Invalid Git workflow check/);
  }
  for (const value of [null, [], "npm test", {}, { label: "Tests" }, { argv: ["npm"] }]) assert.throws(() => validate(value));
  assert.throws(() => validateList([old, { ...old, cwd: "../outside" }]));
  assert.throws(() => validateList(Array(1)), "sparse recipe arrays are invalid");
  const sparse = ["npm"]; sparse.length = 2;
  assert.throws(() => validate({ ...old, argv: sparse }), "sparse argv is invalid");
  assert.throws(() => validate({ ...old, [Symbol("unknown")]: true }));
  assert.throws(() => validate({ ...old, env: { [Symbol("unknown")]: "1" } }));
});

test("stage selection preserves saved indices, defaults legacy to integration and never invents checks/receipts", () => {
  const recipes = [old, { ...old, requiredStage: "none" }, { ...old, requiredStage: "commit" }, recipe,
    { ...old, requiredStage: "integration" }];
  const before = structuredClone(recipes);
  for (const [stage, indices] of [["commit", [2]], ["integration", [0, 4]], ["handoff", [3]]]) {
    const selected = select(recipes, stage);
    assert.deepEqual(selected.map((item) => item.checkIndex), indices);
    assert.deepEqual(selected.map((item) => item.recipe), indices.map((i) => recipes[i]));
    assert.deepEqual(select([], stage), []);
    assert.deepEqual(select([{ ...old, requiredStage: "none" }], stage), []);
  }
  assert.deepEqual(recipes, before);
  assert.throws(() => select(recipes, "none"));
  assert.throws(() => select([], "all"));
  assert.throws(() => select([{ ...old, requiredStage: "future" }], "integration"));
});
