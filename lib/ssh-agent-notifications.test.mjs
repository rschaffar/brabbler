import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the actual small hook callbacks without React, browser notifications,
// credentials, network or any connection/grant authority. Refactoring must update
// this explicit source contract; missing callbacks never become silent skips.
const source = readFileSync(new URL("../hooks/useSshAgent.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("useSshAgent.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function one(predicate) {
  const matches = [];
  function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
  visit(tree); assert.equal(matches.length, 1); return matches[0];
}
function execute(code, context) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Script(compiled).runInNewContext(context);
}
const delivery = one(node => ts.isCallExpression(node) && node.expression.getText(tree) === "showBrowserNotification");
const click = delivery.arguments[0].properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(tree) === "onClick").initializer.getText(tree);
const toggle = one(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === "toggleNotifications").initializer.arguments[0].getText(tree);
const preference = one(node => ts.isTryStatement(node) && node.tryBlock.getText(tree).includes("localStorage.getItem(NOTIFY_KEY)")).getText(tree);
const key = "pi-web:ssh-local-notifications:v1";

test("SSH notification clicks only focus/review a still-live owned request; stale clicks never revive authority", () => {
  for (const state of ["live", "expired", "removed", "different-request", "disconnected", "page-closed"]) {
    const events = [], notices = [];
    const requests = state === "removed" ? [] : [{ id: state === "different-request" ? "other" : "request", deadline: state === "expired" ? 100 : 101 }];
    execute(`(${click})();`, {
      request: { id: "request" }, alive: { current: state !== "page-closed" },
      owned: { current: state === "disconnected" ? null : { id: "owned-connection" } },
      currentRequests: { current: requests }, performance: { now: () => 100 },
      window: { focus: () => events.push("focus") }, reviewRequest: id => events.push(["review", id]),
      setNotice: text => notices.push(text), t: value => value,
    });
    assert.deepEqual(events, state === "live" ? ["focus", ["review", "request"]] : [], state);
    assert.deepEqual(notices, ["live", "page-closed"].includes(state) ? [] : ["sshAgent.staleRequest"], state);
  }
});

test("saved SSH notification opt-in cannot request permission or restore signing state", () => {
  for (const stored of [null, "false", "true"]) for (const permission of ["default", "denied", "granted", "unsupported"]) {
    const enabled = [], notices = [];
    const Notification = { permission, requestPermission() { assert.fail("mount must never request permission"); } };
    execute(preference, {
      localStorage: { getItem: name => { assert.equal(name, key); return stored; } }, NOTIFY_KEY: key,
      window: permission === "unsupported" ? {} : { Notification }, Notification,
      setNotificationsEnabled: value => enabled.push(value), setNotificationStatus: value => notices.push(value), t: value => value,
    });
    assert.deepEqual(enabled, [stored === "true" && permission === "granted"]);
    assert.deepEqual(notices, stored === "true" && permission !== "granted" ? ["sshAgent.notificationDenied"] : []);
  }
});

test("explicit SSH notification permission denial stays disabled; disabling closes only local alerts", async () => {
  for (const permission of ["denied", "granted", "unsupported"]) {
    let prompts = 0, enabled, closed = 0; const writes = [], notices = [];
    const Notification = { permission, async requestPermission() { prompts++; return "denied"; } };
    const notifications = { current: new Map([["request", { close() { closed++; } }]]) };
    const context = {
      notificationBusy: false, alive: { current: true }, notifications,
      window: permission === "unsupported" ? {} : { Notification }, Notification, NOTIFY_KEY: key,
      setNotificationBusy() {}, setNotificationStatus: value => notices.push(value), t: value => value,
      setNotificationsEnabled: value => { enabled = value; }, localStorage: { setItem: (name, value) => writes.push([name, value]) },
    };
    await execute(`(${toggle})(true);`, context);
    assert.equal(enabled, permission === "granted"); assert.equal(prompts, permission === "denied" ? 1 : 0);
    assert.deepEqual(writes, [[key, String(permission === "granted")]]);
    if (permission !== "granted") { assert.ok(notices.includes("sshAgent.notificationDenied")); assert.equal(closed, 1); assert.equal(notifications.current.size, 0); }
    await execute(`(${toggle})(false);`, context);
    assert.equal(enabled, false); assert.equal(notifications.current.size, 0);
    assert.equal(prompts, permission === "denied" ? 1 : 0, "disable never requests permission");
  }
});
