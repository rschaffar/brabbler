import { parseNpmSource } from "./npm-source";

interface SubagentExtensionLike {
  path: string;
  sourceInfo?: { source?: string; origin?: string };
  tools: Map<string, unknown>;
}

/**
 * Normalize one `ext:` selector to its body: a trailing slash and a trailing star-segment
 * are dropped, so `ext:name`, `ext:name/` and `ext:name/*` are one selector. Shared by the
 * allow list and the deny list so the two cannot disagree on what a selector means.
 */
function normalizeExtensionSelector(selector: string): string {
  const body = selector.slice(4).trim().replace(/\/+$/, "");
  return body.endsWith("/*") ? body.slice(0, -2) : body;
}

function extensionPathParts(extension: SubagentExtensionLike): { parentDir: string; baseName: string } {
  const segments = extension.path.replaceAll("\\", "/").split("/");
  return {
    parentDir: segments.at(-2) ?? extension.path,
    baseName: (segments.at(-1) ?? "").replace(/\.[^.]+$/, ""),
  };
}

/**
 * The source a file belongs to. Only package resources have a real identity in
 * `sourceInfo.source`; top-level ones all carry the shared constant `"local"` (settings
 * entry) or `"auto"` (auto-discovered), so they fall back to their own path — otherwise
 * every unrelated local extension would look like one unit to the name gate below.
 */
function extensionSourceKey(extension: SubagentExtensionLike): string {
  const info = extension.sourceInfo;
  const source = info?.source?.trim();
  return source && info?.origin === "package" ? source : extension.path;
}

/**
 * Every spelling an `ext:<name>` selector could use for one extension: the file's parent
 * directory, its basename, and — for package resources only — the npm source name and that
 * name without its scope (a pinned `npm:@scope/pkg@1.2.3` contributes `@scope/pkg`, not the
 * pin). `"local"` / `"auto"` are deliberately never candidates: they are shared constants,
 * so accepting them would turn `ext:local` into "every local extension".
 */
function extensionCandidateNames(extension: SubagentExtensionLike): string[] {
  const { parentDir, baseName } = extensionPathParts(extension);
  const names = [parentDir, baseName];
  const info = extension.sourceInfo;
  if (info?.origin === "package") {
    const source = (info.source ?? "").trim();
    const packageName = parseNpmSource(source)?.name ?? source;
    names.push(packageName, packageName.replace(/^@[^/]+\//, ""));
  }
  return [...new Set(names.map((name) => name.toLowerCase()).filter(Boolean))];
}

/**
 * Map each candidate name to the set of sources that can offer it. A name claimed by more
 * than one source is not addressable: `index.ts`, a shared `extensions/` directory and two
 * packages collapsing to the same unscoped name (`@a/tool`, `@b/tool`) are all common, and
 * a selector for one of them would otherwise grant tools from unrelated extensions. Several
 * files of the `same` source may share a name — they are one unit, not a collision.
 */
function extensionNameOwners(extensions: readonly SubagentExtensionLike[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const extension of extensions) {
    const owner = extensionSourceKey(extension);
    for (const name of extensionCandidateNames(extension)) {
      const claimed = owners.get(name) ?? new Set<string>();
      claimed.add(owner);
      owners.set(name, claimed);
    }
  }
  return owners;
}

interface ExtensionSelectorMatch {
  name: string;
  toolName?: string;
}

/**
 * Resolve one selector against the addressable names found across `every` loaded extension,
 * keeping the longest match, and return the tool name it asked for (if any). Resolving names
 * per extension instead would let `ext:@scope/pkg` bind to the shorter, unrelated name
 * `@scope` offered by a different extension. Extension names are case-insensitive; tool
 * names are matched exactly as authored.
 */
function resolveExtensionSelector(
  selector: string,
  addressableNames: Iterable<string>,
): ExtensionSelectorMatch | null {
  const lower = selector.toLowerCase();
  let best: string | undefined;
  for (const name of addressableNames) {
    if (lower !== name && !lower.startsWith(`${name}/`)) continue;
    if (best === undefined || name.length > best.length) best = name;
  }
  if (best === undefined) return null;
  const toolName = lower === best ? undefined : selector.slice(best.length + 1) || undefined;
  return { name: best, ...(toolName === undefined ? {} : { toolName }) };
}

export function selectSubagentExtensionTools(
  extensions: Iterable<SubagentExtensionLike>,
  selectors: readonly string[],
  deniedSelectors: readonly string[] = [],
): string[] {
  const normalizeAll = (values: readonly string[]) => values
    .filter((selector) => selector.toLowerCase().startsWith("ext:"))
    .map((selector) => normalizeExtensionSelector(selector))
    .filter(Boolean);
  const wanted = normalizeAll(selectors);
  const denied = normalizeAll(deniedSelectors);
  if (wanted.length === 0) return [];
  const loaded = [...extensions];
  const owners = extensionNameOwners(loaded);
  const addressable = new Set([...owners].filter(([, claimed]) => claimed.size === 1).map(([name]) => name));
  const everyExtension = wanted.includes("*");
  const denyEveryExtension = denied.includes("*");
  // Allow and deny are resolved with the *same* candidate names, so a deny written with one
  // alias (`ext:codegraph`) also covers a grant written with another (`ext:@scope/pkg/tool`).
  const resolveAll = (values: readonly string[], names: Iterable<string>) => values.flatMap((selector) => {
    if (selector === "*") return [];
    const match = resolveExtensionSelector(selector, names);
    return match === null ? [] : [match];
  });
  // Resolve the longest name before rejecting ambiguity, never fall back to
  // a shorter unrelated alias when the intended longer name has two owners.
  const matches = resolveAll(wanted, owners.keys()).filter(match => addressable.has(match.name));
  // Ambiguous aliases must never grant tools, but a denial covers every owner
  // of that alias. Otherwise ext:* could silently defeat a user's denial.
  const denials = resolveAll(denied, owners.keys());

  const selected: string[] = [];
  for (const extension of loaded) {
    const toolNames = [...extension.tools.keys()];
    const owned = new Set(extensionCandidateNames(extension).filter((name) => addressable.has(name)));
    const ownedMatches = matches.filter((match) => owned.has(match.name));
    if (!everyExtension && ownedMatches.length === 0) continue;
    const allOwned = new Set(extensionCandidateNames(extension));
    const ownedDenials = denials.filter((match) => allOwned.has(match.name));
    const covers = (match: ExtensionSelectorMatch, toolName: string) => (
      match.toolName === undefined || match.toolName === toolName
    );
    selected.push(...toolNames.filter((toolName) => {
      const granted = everyExtension || ownedMatches.some((match) => covers(match, toolName));
      if (!granted || denyEveryExtension) return false;
      return !ownedDenials.some((match) => covers(match, toolName));
    }));
  }
  return [...new Set(selected)];
}
