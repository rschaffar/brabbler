import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { fsCache: false });
const view = await jiti.import("./settings-view.ts");
const { gitWorkflowManifest: manifest } = await jiti.import("../../plugins/git-workflow/manifest.ts");
const field = key => manifest.fields[key];
const snapshot = () => ({ pluginId: manifest.id, schemaVersion: 1, enabled: false,
  project: "/workspace/repo/.git", sessionId: "11111111-1111-4111-8111-111111111111", sessionProject: "/workspace/repo/.git", sessionApplicable: true,
  global: {}, overrides: {}, sessionOverrides: {}, effective: {}, sources: {} });

test("three scope cells preserve presence, parent-equal pins, inherited origins and exactly one winner", () => {
  const settings = snapshot();
  settings.global.commit = "ask";
  settings.overrides.commit = "ask";
  settings.sessionOverrides.commit = "allow";
  assert.deepEqual(view.settingCell(settings, "commit", field("commit"), "global"), {
    value: "ask", source: "global", available: true, supported: true, saved: true, sameAsParent: true, winning: false });
  assert.deepEqual(view.settingCell(settings, "commit", field("commit"), "project"), {
    value: "ask", source: "project", available: true, supported: true, saved: true, sameAsParent: true, winning: false });
  assert.deepEqual(view.settingCell(settings, "commit", field("commit"), "session"), {
    value: "allow", source: "session", available: true, supported: true, saved: true, sameAsParent: false, winning: true });
  const projectWins = view.previewPluginSettings(manifest, settings, "session", {}, ["commit"]);
  assert.equal(projectWins.sources.commit, "project");
  assert.equal(view.settingCell(projectWins, "commit", field("commit"), "project").winning, true);
  assert.equal(view.settingCell(projectWins, "commit", field("commit"), "session").saved, false);
  assert.equal(view.settingCell(projectWins, "commit", field("commit"), "session").source, "project");
  const globalWins = view.previewPluginSettings(manifest, projectWins, "project", {}, ["commit"]);
  assert.equal(globalWins.sources.commit, "global");
  const builtinWins = view.previewPluginSettings(manifest, globalWins, "global", {}, ["commit"]);
  assert.deepEqual(view.settingCell(builtinWins, "commit", field("commit"), "global"), {
    value: "ask", source: "builtin", available: true, supported: true, saved: false, sameAsParent: false, winning: true });
  assert.deepEqual(settings.sessionOverrides, { commit: "allow" }, "all previews leave the input snapshot unchanged");
});

test("false, null, empty text and empty checks remain saved values, not absence", () => {
  const settings = snapshot();
  settings.global = { enabled: false, targetBranch: "main", commitChecks: [{ name: "Tests", command: "tests" }] };
  settings.overrides = { targetBranch: null, commitChecks: [] };
  settings.sessionOverrides = { enabled: true, targetBranch: "" };
  const resolved = view.recomputePluginSettings(manifest, settings);
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.sources.enabled, "global");
  assert.equal(view.settingCell(resolved, "enabled", field("enabled"), "global").sameAsParent, true);
  assert.equal(view.settingCell(resolved, "enabled", field("enabled"), "session").supported, false);
  assert.equal(resolved.effective.targetBranch, "");
  assert.equal(resolved.sources.targetBranch, "session");
  assert.deepEqual(resolved.effective.commitChecks, []);
  assert.equal(resolved.sources.commitChecks, "project");
  const reset = view.previewPluginSettings(manifest, resolved, "session", {}, ["targetBranch"]);
  assert.equal(reset.effective.targetBranch, null);
  assert.equal(reset.sources.targetBranch, "project");
  assert.equal(Object.hasOwn(reset.overrides, "targetBranch"), true);
  assert.deepEqual(view.parseSettingDraft(field("targetBranch"), "main", true), { ok: true, value: null });
  assert.deepEqual(view.parseSettingDraft(field("targetBranch"), "", false), { ok: true, value: "" });
  assert.deepEqual(view.parseSettingDraft(field("enabled"), "false"), { ok: true, value: false });
});

test("unavailable contexts do not masquerade as inherited editable scopes", () => {
  const settings = snapshot();
  settings.global.commit = "deny";
  settings.overrides.commit = "ask";
  settings.sessionOverrides.commit = "allow";
  settings.sessionApplicable = false;
  settings.sessionProject = "/workspace/other/.git";
  const foreign = view.recomputePluginSettings(manifest, settings);
  assert.equal(foreign.effective.commit, "ask");
  assert.equal(foreign.sources.commit, "project");
  assert.equal(view.settingCell(foreign, "commit", field("commit"), "session").available, false);
  assert.equal(view.settingCell(foreign, "commit", field("commit"), "project").winning, true);
  settings.project = null;
  const missing = view.recomputePluginSettings(manifest, settings);
  assert.equal(missing.sources.commit, "global");
  assert.equal(view.settingCell(missing, "commit", field("commit"), "project").available, false);
  assert.equal(view.settingCell(missing, "commit", field("commit"), "session").available, false);
  delete settings.sessionId;
  settings.sessionApplicable = true;
  assert.equal(view.settingCell(settings, "commit", field("commit"), "session").available, false);
});

test("legacy browser-only session values are preserved but never projected as effective", () => {
  const settings = snapshot();
  settings.global.discardResources = "ask";
  settings.overrides.discardResources = "deny";
  settings.sessionOverrides.discardResources = "allow";
  const resolved = view.recomputePluginSettings(manifest, settings);
  assert.equal(resolved.effective.discardResources, "deny");
  assert.equal(resolved.sources.discardResources, "project");
  assert.equal(resolved.sessionOverrides.discardResources, "allow", "readable legacy presence is not silently deleted");
  assert.equal(view.settingCell(resolved, "discardResources", field("discardResources"), "session").supported, false);
  const cleared = view.previewPluginSettings(manifest, resolved, "session", {}, ["discardResources"]);
  assert.equal(Object.hasOwn(cleared.sessionOverrides, "discardResources"), false);
  assert.equal(cleared.effective.discardResources, "deny");
  assert.equal(cleared.sources.discardResources, "project");
});

test("prospective lower-scope edits remain masked and saved branch/method defaults do not answer Ask", () => {
  const settings = snapshot();
  settings.global = { targetSelection: "ask", targetBranch: "main" };
  settings.sessionOverrides.commit = "allow";
  const masked = view.previewPluginSettings(manifest, settings, "project", { commit: "deny", targetBranch: "release" });
  assert.equal(masked.overrides.commit, "deny");
  assert.equal(masked.effective.commit, "allow");
  assert.equal(masked.sources.commit, "session");
  assert.equal(masked.effective.targetBranch, "release");
  assert.equal(view.settingHasUnansweredChoice(manifest, masked, field("targetBranch")), true);
  assert.equal(view.settingHasUnansweredChoice(manifest, masked, field("mergeMethod")), true);
  const configured = view.previewPluginSettings(manifest, masked, "project", { targetSelection: "configured", methodSelection: "configured" });
  assert.equal(view.settingHasUnansweredChoice(manifest, configured, field("targetBranch")), false);
  assert.equal(view.settingHasUnansweredChoice(manifest, configured, field("mergeMethod")), false);
  const ask = view.previewPluginSettings(manifest, configured, "session", { targetSelection: "ask" });
  assert.equal(view.settingHasUnansweredChoice(manifest, ask, field("targetBranch")), true);
});

test("draft parsing validates exact check data without executing it or conflating [] with follow", () => {
  const checks = field("commitChecks");
  assert.deepEqual(view.parseSettingDraft(checks, "[]"), { ok: true, value: [] });
  const commands = [{ command: "never-executed --fixture", name: "Tests", timeoutMs: 0 }];
  assert.deepEqual(view.parseSettingDraft(checks, JSON.stringify(commands)), { ok: true, value: commands });
  assert.equal(view.settingValuesEqual(commands, [{ name: "Tests", timeoutMs: 0, command: "never-executed --fixture" }]), true);
  assert.equal(view.settingValuesEqual(commands, []), false);
  for (const bad of ["not JSON", "null", "{}", "[null]", JSON.stringify([{ name: "x", command: "a", extra: true }]),
    JSON.stringify([{ name: "x", command: "a" }, { name: "x", command: "b" }]),
    ...[-1, 2_147_483_648, 1.5].map(timeoutMs => JSON.stringify([{ name: "x", command: "a", timeoutMs }]))]) {
    assert.deepEqual(view.parseSettingDraft(checks, bad), { ok: false, error: "checks" }, bad);
  }
  assert.deepEqual(view.parseSettingDraft(field("commit"), "approve"), { ok: false, error: "value" });
  assert.deepEqual(view.parseSettingDraft(field("targetBranch"), "bad\nbranch"), { ok: false, error: "text" });
  assert.deepEqual(view.parseSettingDraft(field("enabled"), "not boolean"), { ok: false, error: "value" });
});
