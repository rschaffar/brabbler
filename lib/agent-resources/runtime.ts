import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { getAgentDir, type DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { readCommittedResourceSelection } from "./api";
import { selectionKey } from "./selection";
import { requiresResourceCatalog } from "./preferences";
import type { AgentSessionLike } from "../pi-types";

type LoaderOptions = Omit<ConstructorParameters<typeof DefaultResourceLoader>[0], "cwd" | "agentDir">;
type Kind = "skill" | "extension";
type Snapshot = Awaited<ReturnType<typeof readCommittedResourceSelection>>;
type ExtensionResult = Parameters<NonNullable<LoaderOptions["extensionsOverride"]>>[0];
const diagnosticKey = (error: { path: string; error: string }) => JSON.stringify([error.path, error.error]);
/** SDK tool/flag collision messages are pinned diagnostics, not import errors.
 * Re-evaluate only those pairs when selection actually removed a loaded record.
 * A removed first owner can expose a different still-live collision. */
function reconcileRemovedCollisions(base: ExtensionResult, extensions: ExtensionResult["extensions"]): ExtensionResult["errors"] {
  const retained = new Set(extensions.map(extension => extension.path));
  const removed = new Set(base.extensions.filter(extension => !retained.has(extension.path)).map(extension => extension.path));
  if (!removed.size) return base.errors;
  const collisions = (records: ExtensionResult["extensions"]) => {
    const result: { path: string; error: string; earlier: string }[] = [];
    for (const kind of ["tools", "flags"] as const) {
      const owners = new Map<string, string>();
      for (const record of records) for (const name of record[kind].keys()) {
        const earlier = owners.get(name);
        if (earlier && earlier !== record.path) result.push({ path: record.path, earlier,
          error: kind === "tools" ? `Tool "${name}" conflicts with ${earlier}` : `Flag "--${name}" conflicts with ${earlier}` });
        else owners.set(name, record.path);
      }
    }
    return result;
  };
  const obsolete = new Set(collisions(base.extensions)
    .filter(error => removed.has(error.path) || removed.has(error.earlier)).map(diagnosticKey));
  const errors = base.errors.filter(error => !obsolete.has(diagnosticKey(error)));
  const present = new Set(errors.map(diagnosticKey));
  for (const { path, error } of collisions(extensions)) {
    const diagnostic = { path, error };
    if (!present.has(diagnosticKey(diagnostic))) { errors.push(diagnostic); present.add(diagnosticKey(diagnostic)); }
  }
  return errors;
}
function present(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function refused(detail: string): never {
  throw new Error(`Resource runtime refused: ${detail}. Repair the native/catalog binding and reopen the session`);
}

/** One fixed, committed construction snapshot; no save notification, idle action,
 * applied status or loader discovery here. Unconfigured native installations keep
 * their existing loader unchanged. A missing configured catalog is not an empty
 * selection when retained preferences already exist. */
export async function prepareResourceRuntime(input: { cwd: string; sessionId?: string }, captured?: ResourceRuntimeSelection) {
  const agentDir = getAgentDir();
  if (captured) await captured.assertCurrent();
  if (!present(join(agentDir, "resource-catalog.json"))) {
    if (present(join(agentDir, "brabbler/resource-preferences.json")) && requiresResourceCatalog(agentDir)) refused("retained preferences require resource-catalog.json");
    return Object.freeze({ selection: undefined, compose: (options: LoaderOptions) => options });
  }
  const selection = captured ?? await readCommittedResourceSelection(input);
  if (selection.context.agentDir !== agentDir || selection.cwd !== realpathSync(input.cwd)) refused("construction snapshot context changed");
  const bindings = new Map<string, { key: string; enabled: boolean; path: string; kind: Kind }>();
  const entries: { key: string; enabled: boolean; path: string; kind: Kind }[] = [];
  for (const row of selection.catalog.rows) {
    if (row.kind !== "skill" && row.kind !== "extension") continue;
    if (row.membership !== "confirmed" || !row.identity || !row.selection) refused(`unsupported ${row.kind} entry ${row.path}`);
    const entry = Object.freeze({ key: selectionKey(row.identity), enabled: row.selection.enabled, path: row.path, kind: row.kind });
    entries.push(entry);
    // Current observation aliases only, never persisted physical preference keys
    // or inferred package membership from containment/display names.
    for (const path of new Set([row.path, ...row.observedPaths])) {
      for (const alias of [normalize(path), realpathSync(path)]) {
        const key = JSON.stringify([row.kind, alias]), previous = bindings.get(key);
        if (previous && previous.key !== entry.key) refused(`ambiguous ${row.kind} observation ${path}`);
        bindings.set(key, entry);
      }
    }
  }
  const lookup = (kind: Kind, path: string) => {
    // Only aliases captured under catalog admission qualify. An unseen alias is
    // unsupported too; do not probe new paths to manufacture binding authority.
    return isAbsolute(path) ? bindings.get(JSON.stringify([kind, normalize(path)])) : undefined;
  };
  await selection.assertCurrent();
  return Object.freeze({ selection, compose(options: LoaderOptions): LoaderOptions {
    const enabled = (kind: Kind) => entries.filter(entry => entry.kind === kind && entry.enabled
      && !(kind === "skill" ? options.noSkills : options.noExtensions));
    const extensionEntries = enabled("extension"), skillEntries = enabled("skill");
    // Exact caller-supplied required factories, including the SDK's builtin form.
    // Inline numbering excludes builtin factories, matching the public loader.
    const required = new Set<string>();
    let inlineIndex = 0;
    for (const factory of options.extensionFactories ?? []) {
      if (typeof factory !== "function" && factory.builtin) required.add(`builtin:${factory.name}`);
      else {
        inlineIndex++;
        required.add(`<inline:${typeof factory === "function" ? inlineIndex : factory.name}>`);
      }
    }
    return { ...options,
      // Complete native-filtered candidates in memory. Native package selectors,
      // prompt/theme handling and all on-disk settings remain untouched.
      additionalExtensionPaths: [...new Set([...(options.additionalExtensionPaths ?? []), ...extensionEntries.map(entry => entry.path)])],
      additionalSkillPaths: [...new Set([...(options.additionalSkillPaths ?? []), ...skillEntries.map(entry => entry.path)])],
      extensionsOverride(base) {
        const extensions = base.extensions.filter(extension => {
          if (required.has(extension.path)) return true;
          const entry = lookup("extension", extension.path);
          if (!entry) refused(`unbound extension candidate ${extension.path}`);
          return entry.enabled && !options.noExtensions;
        });
        for (const entry of extensionEntries) if (!extensions.some(extension => lookup("extension", extension.path)?.key === entry.key)) {
          refused(`enabled extension was not loaded: ${entry.path}`);
        }
        const selected = { ...base, extensions, errors: reconcileRemovedCollisions(base, extensions) };
        // Selection precedes existing Bash/ask-user/subagent conflict policies.
        const result = options.extensionsOverride?.(selected) ?? selected;
        if (result.errors.length) refused("extension loading failed or has unresolved conflicts; inspect SDK loader diagnostics");
        return result;
      },
      skillsOverride(base) {
        // Native name precedence is accepted only between admitted catalog members
        // whose loser is not enabled; any other collision stays unresolved.
        const resolvedCollision = (diagnostic: (typeof base.diagnostics)[number]) => {
          const collision = diagnostic.collision;
          if (diagnostic.type !== "collision" || collision?.resourceType !== "skill") return false;
          const winner = lookup("skill", collision.winnerPath), loser = lookup("skill", collision.loserPath);
          return Boolean(winner && loser && winner.key !== loser.key && !loser.enabled);
        };
        if (base.diagnostics.some(diagnostic => diagnostic.type !== "warning" && !resolvedCollision(diagnostic))) refused("skill loading failed; inspect SDK skill diagnostics");
        const skills = base.skills.filter(skill => {
          const entry = lookup("skill", skill.filePath);
          if (!entry) refused(`unbound skill candidate ${skill.filePath}`);
          return !options.noSkills && entry.enabled;
        });
        for (const entry of skillEntries) if (!skills.some(skill => lookup("skill", skill.filePath)?.key === entry.key)) {
          refused(`enabled skill was not loaded: ${entry.path}`);
        }
        const selected = { ...base, skills };
        // The SDK invokes this again after resources_discover. Authored manual-
        // only metadata stays intact; Off removes the actual invocation record.
        return options.skillsOverride?.(selected) ?? selected;
      },
    };
  } });
}
/** Reporting only: intersect this construction's admitted aliases with public
 * loaded records, after profile/host overrides and resources_discover. Unknown
 * aliases prove nothing; never probe paths or turn management eligibility into
 * activation/inspection authority. Required inline host records have no keys. */
export function includedResourceKeys(selection: ResourceRuntimeSelection, loader: Pick<AgentSessionLike["resourceLoader"], "getSkills" | "getExtensions">): string[] {
  const loaded = new Set([
    ...loader.getSkills().skills.flatMap(skill => "filePath" in skill && typeof skill.filePath === "string"
      ? [JSON.stringify(["skill", normalize(skill.filePath)])] : []),
    ...(loader.getExtensions?.().extensions ?? []).map(extension => JSON.stringify(["extension", normalize(extension.path)])),
  ]);
  return selection.catalog.rows.flatMap(row => (row.kind === "skill" || row.kind === "extension")
    && row.membership === "confirmed" && row.identity
    && [row.path, ...row.observedPaths].some(path => loaded.has(JSON.stringify([row.kind, normalize(path)])))
    ? [selectionKey(row.identity)] : []);
}
export type ResourceRuntimeSelection = Snapshot;
