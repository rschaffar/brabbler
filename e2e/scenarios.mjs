// Reviewed execution units: a chain is deliberately indivisible when later
// assertions depend on its earlier writes. Input IDs include browser defaults,
// legacy storage preferences and viewport *height*, not just the width.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const groups = JSON.parse(readFileSync(new URL("../nix/e2e-groups.json", import.meta.url), "utf8"));
export const browserInputs = {
  "default": { options: {} }, // Playwright: 1280x720, en-US, no touch.
  "legacy-desktop": { options: { viewport: { width: 1280, height: 800 }, locale: "zh-CN", hasTouch: false, isMobile: false }, piLocale: "zh-CN" },
  "legacy-tablet": { options: { viewport: { width: 700, height: 800 }, locale: "zh-CN", hasTouch: false, isMobile: false }, piLocale: "zh-CN" },
  "legacy-mobile": { options: { viewport: { width: 390, height: 844 }, locale: "zh-TW", hasTouch: true, isMobile: true }, piLocale: "zh-TW" },
  "en-desktop": { options: { viewport: { width: 1280, height: 800 }, locale: "en-US", hasTouch: false, isMobile: false } },
  "en-mobile-tall": { options: { viewport: { width: 390, height: 844 }, locale: "en-US", hasTouch: true, isMobile: true } },
  "en-mobile-short": { options: { viewport: { width: 390, height: 600 }, locale: "en-US", hasTouch: true, isMobile: true } },
  "numeric-wide": { options: { viewport: { width: 2560, height: 1100 }, locale: "en-US" }, chatWidth: "820" },
};

// Order is part of ownership: history desktop dismisses the recovery marker
// before fresh mobile reads it; state and shared-account chains retain writes.
export const scenarios = {
  "ssh-agent": ["ssh-agent/webauthn-openssh@en-desktop", "ssh-agent/webauthn-openssh@en-mobile-tall"],
  "state": ["state/api-append-accounts@service", "state/agents-reload@default", "state/durable-account@default"],
  "history": ["history/reading-chain@legacy-desktop", "history/reading-chain@legacy-mobile"],
  "extension-dialogs": ["extension-dialogs/full@legacy-desktop", "extension-dialogs/full@legacy-mobile"],
  "mobile-sidebar": ["mobile-sidebar/archive-search-restore-move@legacy-mobile"],
  "worktrees": ["worktrees/full@en-desktop", "worktrees/full@en-mobile-tall"],
  "session-launch": ["session-launch/full@en-desktop", "session-launch/full@en-mobile-tall"],
  "running-forks": ["running-forks/full@en-desktop", "running-forks/full@en-mobile-tall"],
  "model-speed": ["model-speed/exercise@en-desktop", "model-speed/fresh@en-desktop", "model-speed/exercise@en-mobile-tall", "model-speed/fresh@en-mobile-tall"],
  "native-tools": ["native-tools/full@en-desktop", "native-tools/full@en-mobile-tall"],
  "trust": ["trust/full@en-desktop", "trust/full@en-mobile-tall"],
  "git-plugin": ["git-plugin/full@en-desktop", "git-plugin/full@en-mobile-tall"],
  "appearance": ["appearance/full@numeric-wide", "appearance/full@legacy-desktop", "appearance/scratchpad@en-desktop", "appearance/scratchpad@en-mobile-short"],
  "timestamps": ["timestamps/full@en-desktop", "timestamps/full@en-mobile-tall", "timestamps/full@legacy-desktop", "timestamps/full@legacy-mobile"],
  "diff-context": ["diff-context/explorer-then-merge@legacy-desktop"],
  "markdown": ["markdown/preview-then-line-links@legacy-desktop", "markdown/preview-then-line-links@legacy-mobile"],
  "file-edit": ["file-edit/panel-diff-edit@legacy-desktop", "file-edit/panel-diff-edit@legacy-mobile"],
  "archive": ["archive/inline-restore@legacy-mobile"],
  "privacy": ["privacy/full@legacy-desktop", "privacy/full@legacy-tablet", "privacy/full@legacy-mobile"],
  "activity": ["activity/golden-native@legacy-desktop", "activity/responsive@legacy-tablet", "activity/responsive@legacy-mobile"],
  "accounts": ["accounts/created-deleted@legacy-desktop", "accounts/created-deleted@legacy-mobile", "accounts/shared-device@en-desktop", "accounts/shared-device@en-mobile-short"],
  "questions": ["questions/registration-and-dialog@legacy-desktop", "questions/registration-and-dialog@legacy-mobile"],
  "session-links": ["session-links/copy-follow@legacy-desktop", "session-links/copy-follow@legacy-mobile"],
  "bulk": ["bulk/archive-restore-delete@legacy-desktop", "bulk/archive-restore-delete@legacy-mobile"],
  "move": ["move/full-picker@legacy-desktop", "move/full-picker@legacy-mobile"],
};
for (const entries of Object.values(scenarios)) Object.freeze(entries);
Object.freeze(scenarios);
for (const input of Object.values(browserInputs)) {
  if (input.options.viewport) Object.freeze(input.options.viewport);
  Object.freeze(input.options); Object.freeze(input);
}
Object.freeze(browserInputs);

export function validateInventory(inventory = groups) {
  const browser = Object.entries(inventory).filter(([, value]) => value.suite === "browser");
  assert.deepEqual(browser.map(([name]) => name).sort(), Object.keys(scenarios).sort(), "Browser owners must match the group inventory exactly");
  const selectors = browser.map(([, value]) => value.selector);
  assert.ok(selectors.every((selector) => /^E2E_[A-Z_]+_ONLY$/.test(selector)), "Every browser group requires an explicit selector");
  assert.equal(new Set(selectors).size, selectors.length, "Duplicate browser selector");
  const ids = Object.values(scenarios).flat();
  assert.equal(new Set(ids).size, ids.length, "Duplicate scenario owner");
  for (const [owner, entries] of Object.entries(scenarios)) for (const id of entries) {
    assert.ok(id.startsWith(`${owner}/`), `Unowned scenario ${id}`);
    const input = id.split("@")[1];
    assert.ok(input === "service" || Object.hasOwn(browserInputs, input), `Unknown input ${id}`);
  }
  assert.deepEqual(inventory.terminal, { suite: "terminal", selector: null });
  assert.equal(Object.keys(inventory).length, browser.length + 1, "Unknown suite in group inventory");
}

// Fail closed before createHarness (which allocates fixtures and artifacts).
export function selectGroup(env) {
  validateInventory();
  const supplied = Object.keys(env).filter((key) => /^E2E_.*_ONLY$/.test(key));
  const bySelector = new Map(Object.entries(groups).filter(([, value]) => value.suite === "browser").map(([name, value]) => [value.selector, name]));
  for (const selector of supplied) assert.ok(bySelector.has(selector), `Unknown E2E selector: ${selector}`);
  assert.equal(supplied.length, 1, "Exactly one E2E_*_ONLY selector is required");
  assert.equal(env[supplied[0]], "1", `Selector ${supplied[0]} must equal 1`);
  return bySelector.get(supplied[0]);
}

// No scheduling/retries: the suite supplies the operation and the reviewed ID.
// An attempted ID cannot be retried, and success is recorded only after return.
export function createCoverage(group, artifacts) {
  assert.ok(group === "terminal" || Object.hasOwn(scenarios, group), `Unknown scenario owner: ${group}`);
  const expected = group === "terminal" ? ["terminal/full@production-pty"] : [...scenarios[group]];
  const attempted = new Set(), completed = [];
  const receipt = { version: 1, group, expected, completed, status: "running", active: null };
  const save = () => writeFileSync(join(artifacts, "coverage.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  save();
  return {
    async run(id, operation) {
      assert.equal(receipt.status, "running", "Coverage is already closed");
      assert.ok(expected.includes(id), `Unowned scenario: ${id}`);
      assert.ok(!attempted.has(id), `Duplicate scenario: ${id}`);
      assert.equal(receipt.active, null, "Scenario chains must run serially");
      assert.equal(id, expected[completed.length], `Scenario ordering: expected ${expected[completed.length]}, got ${id}`);
      attempted.add(id); receipt.active = id; save();
      try {
        const result = await operation();
        completed.push(id); receipt.active = null; save();
        return result;
      } catch (error) {
        receipt.status = "failed"; receipt.error = String(error?.message ?? error); save();
        throw error;
      }
    },
    fail(error) { receipt.status = "failed"; receipt.error = String(error?.message ?? error); save(); },
    finish() {
      assert.equal(receipt.status, "running", "Coverage did not finish successfully");
      assert.equal(receipt.active, null, "Scenario still active");
      assert.deepEqual(completed, expected, "Incomplete scenario coverage");
      receipt.status = "passed"; save();
    },
  };
}
