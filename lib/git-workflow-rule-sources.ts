import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isPathWithinRoots } from "./path-security";
import { samePath } from "./paths";
import { bindingDigest, bindingFields, bindingFileFingerprint, bindingHash, bindingIdentity, bindingPath, bindingText, GitTaskBindingError, readBindingFile, statInstructionFile, validateBindingIdentity } from "./git-workflow-binding-io";
import { GIT_BINDING_LIMITS as LIMITS, type GitBindingWorkspace, type GitRuleSource, type GitRuleSourceSet, type GitRuleSourceTarget } from "./git-workflow-binding-types";

export const GIT_RULE_DISCOVERY = "pi-0.87.1-context-v1" as const;
const NAMES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
const unavailable = () => new GitTaskBindingError("Instruction sources cannot be captured completely and safely. Check missing, unreadable, non-text or oversized files.");
export class GitRuleSourceTargetsRequired extends GitTaskBindingError {
  constructor(readonly targets: GitRuleSourceTarget[]) {
    super("Instruction paths resolve through symlinks. Review the exact destinations before reading their contents.");
  }
}
function markdown(file: string) { return /\.md$/i.test(file) && !/[\r\n\0]/.test(file); }
export function validateSourceTargets(input: unknown): GitRuleSourceTarget[] {
  if (!Array.isArray(input) || input.length > LIMITS.sources) throw unavailable();
  const targets = input.map((item) => {
    const value = bindingFields(item, ["path", "realPath"]);
    const path = bindingPath(value.path), realPath = bindingPath(value.realPath);
    if (!markdown(path) || !markdown(realPath)) throw unavailable();
    return { path, realPath };
  });
  if (new Set(targets.map((item) => item.path)).size !== targets.length) throw unavailable();
  return targets;
}
export function gitRuleSourceDocuments(set: Pick<GitRuleSourceSet, "sources" | "selectionSources">): GitRuleSource[] {
  return [...set.sources, ...set.selectionSources];
}
export function ruleSourceSetDigest(sources: Omit<GitRuleSourceSet, "digest">): string {
  const metadata = ({ path, realPath, role, identity, digest, bytes }: GitRuleSource) => ({ path, realPath, role, identity, digest, bytes });
  return bindingDigest({ ...sources, sources: sources.sources.map(metadata), selectionSources: sources.selectionSources.map(metadata) });
}
export function validateRuleSourceSet(input: unknown): GitRuleSourceSet {
  const data = bindingFields(input, ["version", "discovery", "coverage", "cwd", "agentDir", "directories", "absent", "shadowed", "selectionSources", "sources", "digest"]);
  if (data.version !== 1 || data.discovery !== GIT_RULE_DISCOVERY || data.coverage !== "primary-and-explicit-dependencies") throw unavailable();
  const paths = (value: unknown, max: number) => {
    if (!Array.isArray(value) || value.length > max) throw unavailable();
    return value.map(bindingPath);
  };
  if (!Array.isArray(data.sources) || !Array.isArray(data.selectionSources) || data.sources.length + data.selectionSources.length > LIMITS.sources
    || !Array.isArray(data.directories) || data.directories.length > 65) throw unavailable();
  const directories = data.directories.map((input) => {
    const entry = bindingFields(input, ["path", "realPath", "identity"]);
    return { path: bindingPath(entry.path), realPath: bindingPath(entry.realPath), identity: validateBindingIdentity(entry.identity) };
  });
  let bytes = 0;
  const validateSource = (input: unknown): GitRuleSource => {
    const source = bindingFields(input, ["path", "realPath", "role", "identity", "digest", "bytes", "content"]);
    if (source.role !== "context" && source.role !== "dependency" || typeof source.content !== "string" || source.content.includes("\0")) throw unavailable();
    const content = source.content, size = Buffer.byteLength(content);
    bytes += size;
    if (source.bytes !== size || size > LIMITS.fileBytes || bytes > LIMITS.totalBytes || source.digest !== bindingHash(content)) throw unavailable();
    const path = bindingPath(source.path), realPath = bindingPath(source.realPath);
    if (!markdown(path) || !markdown(realPath)) throw unavailable();
    return { path, realPath, role: source.role, identity: validateBindingIdentity(source.identity), digest: source.digest as string, bytes: size, content };
  };
  const sources = data.sources.map(validateSource), selectionSources = data.selectionSources.map(validateSource);
  const all = [...sources, ...selectionSources];
  if (new Set(all.map((source) => source.path)).size !== all.length) throw unavailable();
  const value = { version: 1 as const, discovery: GIT_RULE_DISCOVERY, coverage: "primary-and-explicit-dependencies" as const,
    cwd: bindingPath(data.cwd), agentDir: bindingPath(data.agentDir), directories, absent: paths(data.absent, 330), shadowed: paths(data.shadowed, 64), sources, selectionSources };
  if (data.digest !== ruleSourceSetDigest(value)) throw unavailable();
  return { ...value, digest: data.digest as string };
}

export interface CaptureGitRuleSourcesOptions {
  workspace: GitBindingWorkspace;
  agentDir: string;
  dependencies?: string[];
  targets?: GitRuleSourceTarget[];
  allowedDependencyRoots?: Iterable<string>;
}
/** A bounded fail-closed subset of SDK discovery, NOT an effective-prompt or prose-policy inventory.
 * No loader, skill, extension, URL or referenced document is implicitly executed/read.
 */
export function captureGitRuleSources(options: CaptureGitRuleSourcesOptions): GitRuleSourceSet {
  try {
    if (process.platform !== "linux") throw new GitTaskBindingError("Secure instruction-source capture requires Linux descriptor-relative reads on this version.");
    const { workspace } = options;
    const cwd = bindingPath(workspace.root), agentDir = resolve(bindingPath(options.agentDir));
    const dependencies = options.dependencies ?? [], targets = validateSourceTargets(options.targets ?? []);
    if (dependencies.length > LIMITS.dependencies || new Set(dependencies).size !== dependencies.length) throw unavailable();
    const roots = new Set([...(options.allowedDependencyRoots ?? [cwd]), join(agentDir, "skills")]);
    const extra = dependencies.map((file) => {
      const path = isAbsolute(file) ? resolve(bindingPath(file)) : resolve(cwd, bindingText(file));
      if (/^[a-z][a-z+.-]*:/i.test(file) || !markdown(path) || !isPathWithinRoots(path, roots)) throw new GitTaskBindingError("Additional sources must be explicit Markdown files within allowed document roots or the agent skills directory.");
      return path;
    });
    if (new Set(extra).size !== extra.length) throw unavailable();
    const directories: string[] = [];
    for (let dir = cwd;; dir = dirname(dir)) {
      if (directories.length >= 64) throw unavailable();
      directories.push(dir);
      if (dir === dirname(dir)) break;
    }
    const inventory = () => {
      const directoryInventory = [...new Set([agentDir, ...directories])].map((path) => {
        const realPath = realpathSync(path), stat = statSync(realPath, { bigint: true });
        if (!stat.isDirectory()) throw unavailable();
        return { path, realPath, identity: bindingIdentity(stat) };
      });
      const absent: string[] = [];
      const cache = new Map<string, { path: string; realPath: string; fingerprint: string } | null>();
      const probe = (file: string, required = false) => {
        let stat;
        try { stat = lstatSync(file, { bigint: true }); }
        catch (cause) {
          if (!required && (cause as NodeJS.ErrnoException).code === "ENOENT") { absent.push(file); return null; }
          throw unavailable();
        }
        // Inspect metadata before opening: do not fall through a broken symlink,
        // nonregular or unreadable higher-priority source as SDK best-effort discovery does.
        if (!stat.isFile() && !stat.isSymbolicLink()) throw unavailable();
        const realPath = realpathSync(file);
        if (!markdown(realPath)) throw unavailable(); // Never follow AGENTS.md into a key/auth/.env file.
        stat = statInstructionFile(realPath);
        if (!stat.isFile() || (stat.mode & BigInt(0o444)) === BigInt(0) || stat.size > BigInt(LIMITS.fileBytes)) throw unavailable();
        return { path: file, realPath, fingerprint: bindingFileFingerprint(stat) };
      };
      const select = (dir: string) => {
        if (cache.has(dir)) return cache.get(dir)!;
        for (const name of NAMES) {
          const source = probe(join(dir, name));
          if (source) { cache.set(dir, source); return source; }
        }
        cache.set(dir, null); return null;
      };
      const global = select(agentDir);
      const local = select(cwd);
      const nested = cwd.startsWith(`${workspace.projectRoot}${sep}`)
        && samePath(join(workspace.projectRoot, ".git"), workspace.commonDir);
      const shadow = nested && local ? join(workspace.projectRoot, basename(local.path)) : undefined;
      const shadowed: string[] = [];
      const probes: NonNullable<ReturnType<typeof probe>>[] = [];
      const seen = new Set(global ? [global.path] : []);
      const ancestors: NonNullable<ReturnType<typeof probe>>[] = [];
      for (const dir of directories) {
        const source = select(dir);
        if (source && shadow && samePath(source.realPath, shadow)) { shadowed.push(source.path); probes.push(source); }
        else if (source && !seen.has(source.path)) { ancestors.unshift(source); seen.add(source.path); }
      }
      const contexts = [...(global ? [global] : []), ...ancestors].map((source) => ({ ...source, role: "context" as const }));
      const extras = extra.filter((file) => !seen.has(file)).map((file) => ({ ...probe(file, true)!, role: "dependency" as const }));
      const selected = [...contexts, ...extras];
      const selection = probes.filter((source) => !selected.some((item) => item.path === source.path)).map((source) => ({ ...source, role: "context" as const }));
      if (selected.length + selection.length > LIMITS.sources) throw unavailable();
      return { directories: directoryInventory, absent, shadowed, selected, selection };
    };
    const before = inventory();
    const documents = [...before.selected, ...before.selection];
    const needed = documents.filter((file) => !samePath(file.path, file.realPath)
      && !targets.some((target) => samePath(target.path, file.path) && samePath(target.realPath, file.realPath)))
      .map(({ path, realPath }) => ({ path, realPath }));
    if (needed.length) throw new GitRuleSourceTargetsRequired(needed);
    if (targets.some((target) => !documents.some((file) => samePath(target.path, file.path) && samePath(target.realPath, file.realPath)))) {
      throw new GitTaskBindingError("A reviewed source destination changed. Inspect its new destination before reading it.");
    }
    let total = 0;
    const readSource = ({ path, realPath, role, fingerprint }: (typeof documents)[number]): GitRuleSource => {
      const read = readBindingFile(realPath, LIMITS.fileBytes, false, fingerprint);
      if (read.fingerprint !== fingerprint) throw new GitTaskBindingError("Instruction source changed before capture. Preview again.");
      const { bytes, identity } = read;
      total += bytes.length;
      if (total > LIMITS.totalBytes) throw unavailable();
      const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (content.includes("\0")) throw unavailable();
      return { path, realPath, role, identity, digest: bindingHash(bytes), bytes: bytes.length, content };
    };
    const sources = before.selected.map(readSource), selectionSources = before.selection.map(readSource);
    if (bindingDigest(before) !== bindingDigest(inventory())) throw new GitTaskBindingError("Instruction sources changed during capture. Preview again.");
    const set = { version: 1 as const, discovery: GIT_RULE_DISCOVERY, coverage: "primary-and-explicit-dependencies" as const,
      cwd, agentDir, directories: before.directories, absent: before.absent, shadowed: before.shadowed, sources, selectionSources };
    return { ...set, digest: ruleSourceSetDigest(set) };
  } catch (cause) {
    if (cause instanceof GitTaskBindingError) throw cause;
    throw unavailable();
  }
}
