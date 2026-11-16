import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// Pure policy owner only; no filesystem binding, native catalog, store or SDK proof.
const jiti = createJiti(import.meta.url, { fsCache: false });
const { createSelectionIdentity, selectionKey, resolveSelection, setSelectionChoice, SelectionModelError } = await jiti.import("./selection.ts");
const context = Object.freeze({ agentDir: "/example/agent", projectBinding: "project:admitted", sessionBinding: "session:own" });
const eligible = Object.freeze({ source: true, trust: true, profile: true });
const origin = Object.freeze({ scope: "global" });
const identity = (kind, name, extra = {}) => createSelectionIdentity({ agentDir: context.agentDir, origin, kind,
  ...(kind === "group" ? { groupKey: name } : { path: `/example/installed/${name}` }), ...extra });
const group = identity("group", "development");
const pkg = identity("package", "tooling");
const skill = identity("skill", "tooling/skills/query/SKILL.md");
const extension = identity("extension", "tooling/extensions/tools.ts");
const object = (id, choices = {}, parent, eligibility = eligible) => ({ identity: id, choices, ...(parent ? { parent } : {}), eligibility });
const key = selectionKey;
const resolved = (objects, id, ctx = context) => resolveSelection(objects, ctx).find(row => row.key === key(id));
function failure(code, run, keys) {
  assert.throws(run, error => {
    assert.equal(error instanceof SelectionModelError, true);
    assert.equal(error.code, code);
    if (keys) assert.deepEqual(error.keys, keys);
    assert.equal(Object.isFrozen(error.keys), true);
    return true;
  });
}
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("identity is normalized lexical installed path + kind + admitted origin in one agentDir", () => {
  const spelling = { agentDir: "/example/./agent/", origin, kind: "skill", path: "/example/installed/tooling/skills/old/../query/SKILL.md" };
  assert.equal(key(spelling), key(skill));
  assert.deepEqual(createSelectionIdentity(spelling), skill);
  assert.notEqual(key(skill), key(identity("extension", "tooling/skills/query/SKILL.md")));
  assert.notEqual(key(skill), key(identity("skill", "tooling/skills/query-help/SKILL.md")), "moves are new objects");
  assert.notEqual(key(skill), key({ ...skill, agentDir: "/example/other-agent" }));
  assert.notEqual(key(skill), key({ ...skill, origin: { scope: "project", binding: context.projectBinding } }));
  assert.notEqual(key(group), key(identity("group", "Development")), "exact group keys, not display labels");
  assert.notEqual(key({ ...skill, path: "/example/a\\b" }), key({ ...skill, path: "/example/a/b" }), "POSIX backslash is literal");
  // No physical target is read or accepted as preference identity. Reconstructing the
  // installed name after a producer update has exactly the same identity.
  assert.equal(key(identity("skill", "tooling/skills/query/SKILL.md")), key(skill));
  assert.equal(Object.isFrozen(skill), true);
  assert.equal(Object.isFrozen(skill.origin), true);
});

test("identity encoding does not conflate separator-bearing group keys or project bindings", () => {
  assert.notEqual(key(identity("group", "a:b")), key(identity("group", "a", { origin: { scope: "project", binding: "b" } })));
  const local = { ...skill, origin: { scope: "project", binding: "a:b" } };
  assert.notEqual(key(local), key({ ...local, origin: { scope: "project", binding: "a" }, path: `${skill.path}:b` }));
  const raw = { ...skill, origin: { scope: "project", binding: context.projectBinding } };
  const copy = createSelectionIdentity(raw);
  raw.origin.binding = "changed";
  assert.equal(copy.origin.binding, context.projectBinding, "no mutable origin alias");
});

test("only skill and extension resource availability is defined; malformed identities refuse", () => {
  for (const kind of ["prompt", "theme", "unknown"]) failure("invalid-input", () => key({ ...skill, kind }));
  for (const path of ["relative/SKILL.md", "", "/bad\0path"]) failure("invalid-input", () => key({ ...skill, path }));
  failure("invalid-input", () => key({ ...group, groupKey: "" }));
  failure("invalid-input", () => key({ ...skill, origin: { scope: "project", binding: "" } }));
});

test("own choices inherit Global -> Project -> Session with explicit provenance and Enabled baseline", () => {
  const cases = [
    [{}, true, "default"],
    [{ global: "disabled" }, false, "global"],
    [{ global: "disabled", project: "inherit", session: "inherit" }, false, "global"],
    [{ global: "disabled", project: "enabled", session: "inherit" }, true, "project"],
    [{ global: "enabled", project: "disabled", session: "enabled" }, true, "session"],
    [{ global: "disabled", project: "enabled", session: "disabled" }, false, "session"],
    [{ global: "inherit", project: "inherit", session: "inherit" }, true, "default"],
  ];
  for (const [choices, enabled, source] of cases) {
    const row = resolved([object(skill, choices)], skill);
    assert.deepEqual(row.own, { enabled, source });
    assert.equal(row.enabled, enabled);
    assert.deepEqual(row.disabledReasons, enabled ? [] : [{ code: "own-disabled", scope: source }]);
    assert.equal(row.scopes.session.choice, choices.session ?? "inherit");
    assert.deepEqual(row.scopes.session.own, row.own);
  }
  const row = resolved([object(skill, { global: "disabled", project: "enabled", session: "inherit" })], skill);
  assert.deepEqual(row.scopes.global.own, { enabled: false, source: "global" });
  assert.deepEqual(row.scopes.project.own, { enabled: true, source: "project" });
});

test("reset removes only the selected own choice and restores inherited provenance", () => {
  const choices = deepFreeze({ global: "disabled", project: "enabled", session: "disabled" });
  const child = object(skill, choices);
  const resetSession = setSelectionChoice(child, context, "session", "inherit");
  assert.deepEqual(resetSession, { global: "disabled", project: "enabled" });
  assert.deepEqual(resolved([{ ...child, choices: resetSession }], skill).own, { enabled: true, source: "project" });
  const resetProject = setSelectionChoice({ ...child, choices: resetSession }, context, "project", "inherit");
  assert.deepEqual(resolved([{ ...child, choices: resetProject }], skill).own, { enabled: false, source: "global" });
  const resetGlobal = setSelectionChoice({ ...child, choices: resetProject }, context, "global", "inherit");
  assert.deepEqual(resolved([{ ...child, choices: resetGlobal }], skill).own, { enabled: true, source: "default" });
  assert.deepEqual(choices, { global: "disabled", project: "enabled", session: "disabled" });
  assert.equal(Object.isFrozen(resetSession), true);
});

test("Session can enable a globally disabled group before child gates are evaluated", () => {
  const rows = resolveSelection([
    object(skill, { session: "enabled" }, pkg),
    object(pkg, {}, group),
    object(group, { global: "disabled", session: "enabled" }),
  ], context);
  assert.deepEqual(rows.map(row => row.enabled), [true, true, true], "input order is not evaluation order");
  assert.deepEqual(rows[2].own, { enabled: true, source: "session" });
  assert.deepEqual(rows[0].gates, [{ key: key(group), enabled: true }, { key: key(pkg), enabled: true }]);
  assert.equal(rows[2].scopes.global.own.enabled, false);
});

test("child Session-On cannot bypass an Off group or package; child preferences never change", () => {
  const choices = deepFreeze({ global: "disabled", project: "enabled", session: "enabled" });
  const child = deepFreeze(object(skill, choices, pkg));
  const offGroup = [child, object(pkg, { session: "enabled" }, group), object(group, { global: "disabled" })];
  const row = resolved(offGroup, skill);
  assert.deepEqual(row.own, { enabled: true, source: "session" });
  assert.equal(row.enabled, false, "an enabled child cannot bypass its effectively Off parents");
  assert.deepEqual(row.disabledReasons, [{ code: "parent-disabled", key: key(group) }, { code: "parent-disabled", key: key(pkg) }]);
  assert.deepEqual(row.gates.map(gate => gate.enabled), [false, false]);
  const offPackage = resolved([child, object(pkg, { global: "disabled" }, group), object(group, { global: "disabled", session: "enabled" })], skill);
  assert.equal(offPackage.enabled, false);
  assert.deepEqual(offPackage.disabledReasons, [{ code: "parent-disabled", key: key(pkg) }]);
  assert.equal(child.choices, choices, "same child preference object after both resolutions");
  assert.deepEqual(choices, { global: "disabled", project: "enabled", session: "enabled" });
});

test("edits and reset remain available under Off parents without editing any descendant", () => {
  const child = deepFreeze(object(skill, { global: "disabled", project: "disabled" }, pkg));
  const next = setSelectionChoice(child, context, "session", "enabled");
  assert.deepEqual(next, { global: "disabled", project: "disabled", session: "enabled" });
  const row = resolved([object(pkg, { global: "disabled" }), { ...child, choices: next }], skill);
  assert.equal(row.scopes.session.editable, true);
  assert.equal(row.own.enabled, true);
  assert.equal(row.enabled, false);
  assert.deepEqual(setSelectionChoice({ ...child, choices: next }, context, "session", "inherit"), child.choices);
});

test("project-local objects start at Project and refuse every Global choice/edit", () => {
  const local = identity("skill", "project/SKILL.md", { origin: { scope: "project", binding: context.projectBinding } });
  const child = object(local, { project: "disabled", session: "enabled" });
  const row = resolved([child], local);
  assert.deepEqual(row.scopes.global, { editable: false, choice: null, own: null });
  assert.deepEqual(row.own, { enabled: true, source: "session" });
  assert.deepEqual(resolved([object(local)], local).scopes.project.own, { enabled: true, source: "default" });
  for (const choice of ["inherit", "enabled", "disabled"]) {
    failure("unavailable-scope", () => setSelectionChoice(child, context, "global", choice));
    failure("unavailable-scope", () => resolveSelection([object(local, { global: choice })], context));
  }
});

test("absent editing scopes are null/unavailable and cannot receive applicable choices", () => {
  const none = { ...context, projectBinding: null, sessionBinding: null };
  const row = resolved([object(skill, { global: "disabled" })], skill, none);
  for (const scope of ["project", "session"]) {
    assert.deepEqual(row.scopes[scope], { editable: false, choice: null, own: null });
    failure("unavailable-scope", () => setSelectionChoice(object(skill), none, scope, "enabled"));
    failure("unavailable-scope", () => resolveSelection([object(skill, { [scope]: "inherit" })], none));
  }
  const sessionOnly = { ...none, sessionBinding: context.sessionBinding };
  assert.equal(resolved([object(skill, { session: "enabled" })], skill, sessionOnly).scopes.session.editable, true,
    "admitted session binding does not fabricate a project binding");
});

test("agentDir and project binding mismatch never widen the explicit admitted context", () => {
  failure("context-mismatch", () => resolveSelection([object({ ...skill, agentDir: "/example/other" })], context));
  const local = { ...skill, origin: { scope: "project", binding: "other-project" } };
  failure("context-mismatch", () => resolveSelection([object(local)], context));
  failure("context-mismatch", () => resolveSelection([object(local)], { ...context, projectBinding: null }));
  failure("invalid-input", () => resolveSelection([], { ...context, sessionBinding: "" }));
});

test("standalone group resources, ungrouped resources and ungrouped packages resolve independently", () => {
  const standalone = identity("extension", "standalone.ts");
  const ungrouped = identity("skill", "ungrouped/SKILL.md");
  const rows = resolveSelection([object(group, { global: "disabled" }), object(standalone, {}, group),
    object(ungrouped), object(pkg), object(skill, {}, pkg)], context);
  assert.deepEqual(rows.map(row => row.enabled), [false, false, true, true, true]);
  assert.deepEqual(rows[1].gates, [{ key: key(group), enabled: false }]);
  assert.deepEqual(rows[2].gates, []);
  assert.deepEqual(rows[4].gates, [{ key: key(pkg), enabled: true }]);
});

test("source, trust and profile are independent hard ceilings, never granted by Enabled", () => {
  for (const ceiling of ["source", "trust", "profile"]) {
    const row = resolved([object(skill, { global: "enabled", session: "enabled" }, undefined, { ...eligible, [ceiling]: false })], skill);
    assert.equal(row.own.enabled, true);
    assert.equal(row.enabled, false);
    assert.deepEqual(row.disabledReasons, [{ code: `${ceiling}-ineligible` }]);
  }
  const allOff = resolved([object(skill, { global: "disabled" }, undefined, { source: false, trust: false, profile: false })], skill);
  assert.deepEqual(allOff.disabledReasons.map(reason => reason.code), ["own-disabled", "source-ineligible", "trust-ineligible", "profile-ineligible"]);
  const parentBlocked = resolved([object(group, { session: "enabled" }, undefined, { ...eligible, trust: false }), object(skill, { session: "enabled" }, group)], skill);
  assert.equal(parentBlocked.enabled, false);
  assert.deepEqual(parentBlocked.disabledReasons, [{ code: "parent-disabled", key: key(group) }]);
  failure("invalid-input", () => resolveSelection([object(skill, {}, undefined, { source: true, trust: true })], context));
});

test("new objects default Enabled, but new package members remain excluded by a package-Off gate", () => {
  const packageOff = object(pkg, { global: "disabled" });
  const old = object(skill, { session: "enabled" }, pkg);
  const before = resolved([packageOff, old], skill);
  const rows = resolveSelection([packageOff, old, object(extension, {}, pkg)], context);
  assert.deepEqual(rows[1], before);
  assert.deepEqual(rows[2].own, { enabled: true, source: "default" });
  assert.equal(rows[2].enabled, false, "whole-package Off also gates a newly installed extension");
  assert.equal(resolved([object(extension)], extension).enabled, true, "ungated new object has Enabled baseline");
});

test("changed parent gates apply immediately without placement review or own-preference transfer", () => {
  const other = identity("group", "research");
  const choices = deepFreeze({ session: "enabled" });
  const a = resolved([object(group, { global: "disabled" }), object(skill, choices, group)], skill);
  const b = resolved([object(other), object(skill, choices, other)], skill);
  assert.equal(a.key, b.key);
  assert.deepEqual(a.own, b.own);
  assert.equal(a.enabled, false);
  assert.equal(b.enabled, true);
  assert.deepEqual(b.gates, [{ key: key(other), enabled: true }]);
  assert.deepEqual(choices, { session: "enabled" });
});

test("duplicate normalized references and conflicting parents fail instead of picking a winner", () => {
  const alias = { ...skill, path: "/example/installed/tooling/skills/query/./SKILL.md" };
  for (const rows of [[object(skill), object(alias)], [object(alias), object(skill)]]) {
    failure("conflict", () => resolveSelection(rows, context), [key(skill)]);
  }
  failure("conflict", () => resolveSelection([object(group), object(pkg), object(skill, {}, group), object(skill, {}, pkg)], context), [key(skill)]);
  failure("conflict", () => resolveSelection([object(group), object({ ...group })], context));
});

test("missing parents and cycles refuse the whole graph with diagnostic identities", () => {
  failure("missing-parent", () => resolveSelection([object(skill, {}, pkg)], context), [key(skill), key(pkg)]);
  failure("cycle", () => resolveSelection([object(group, {}, group)], context), [key(group), key(group)]);
  failure("cycle", () => resolveSelection([object(skill, {}, pkg), object(pkg, {}, group), object(group, {}, pkg)], context));
});

test("flat hierarchy refuses nested groups/packages and resource-as-parent, not guessed gate order", () => {
  const otherGroup = identity("group", "nested");
  const otherPackage = identity("package", "nested-package");
  const rows = [
    [object(group), object(otherGroup, {}, group)],
    [object(pkg), object(otherPackage, {}, pkg)],
    [object(skill), object(extension, {}, skill)],
    [object(skill), object(pkg, {}, skill)],
  ];
  for (const input of rows) failure("invalid-parent", () => resolveSelection(input, context));
  failure("invalid-input", () => resolveSelection([object(skill, { project: "on" })], context));
  failure("invalid-input", () => resolveSelection([object(skill, { other: "enabled" })], context));
});

test("frozen inputs stay byte-equivalent; result and identity snapshots are immutable and detached", () => {
  const input = deepFreeze([object(group), object(pkg, {}, group), object(skill, { project: "disabled" }, pkg)]);
  const before = structuredClone(input);
  const rows = resolveSelection(input, deepFreeze({ ...context }));
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(rows), true);
  for (const row of rows) {
    assert.equal(Object.isFrozen(row), true);
    assert.equal(Object.isFrozen(row.identity), true);
    assert.equal(Object.isFrozen(row.scopes), true);
    assert.equal(Object.isFrozen(row.own), true);
    assert.equal(Object.isFrozen(row.gates), true);
    assert.equal(Object.isFrozen(row.disabledReasons), true);
    for (const scope of Object.values(row.scopes)) {
      assert.equal(Object.isFrozen(scope), true);
      if (scope.own) assert.equal(Object.isFrozen(scope.own), true);
    }
    for (const item of [...row.gates, ...row.disabledReasons]) assert.equal(Object.isFrozen(item), true);
  }
  assert.throws(() => { rows[2].own.enabled = true; }, TypeError);
  const mutable = object({ ...skill, origin: { scope: "global" } }, { global: "disabled" });
  const snapshot = resolved([mutable], skill);
  mutable.identity.path = "/example/moved/SKILL.md";
  mutable.choices.global = "enabled";
  mutable.eligibility = { ...eligible, trust: false };
  assert.equal(snapshot.key, key(skill));
  assert.deepEqual(snapshot.own, { enabled: false, source: "global" });
  assert.equal(snapshot.enabled, false);
  assert.deepEqual(resolveSelection([], context), []);
});
