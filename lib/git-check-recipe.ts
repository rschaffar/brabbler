/** Pure saved-recipe schema. Validation never inserts execution defaults. */
export type GitCheckStage = "commit" | "integration" | "handoff" | "none";
export type GitCheckRecipe = {
  label: string;
  argv: string[];
  /** Checkout-relative POSIX subdirectory; physical containment is a runner responsibility. */
  cwd?: string;
  /** Literal overrides, not shell assignments or substitutions. */
  env?: Record<string, string>;
  requiredStage?: GitCheckStage;
};

export const MAX_GIT_WORKFLOW_CHECKS = 12;
export const MAX_GIT_WORKFLOW_CHECK_ARGS = 32;
export const MAX_GIT_WORKFLOW_CHECK_LABEL = 80;
export const MAX_GIT_WORKFLOW_CHECK_EXECUTABLE = 256;
export const MAX_GIT_WORKFLOW_CHECK_ARG = 512;
export const MAX_GIT_CHECK_CWD = 256;
export const MAX_GIT_CHECK_ENV_ENTRIES = 32;
export const MAX_GIT_CHECK_ENV_NAME = 64;
export const MAX_GIT_CHECK_ENV_VALUE = 512;
export const MAX_GIT_CHECK_ENV_BYTES = 8192;

const encoder = new TextEncoder();
const controls = /[\x00-\x1f\x7f\u0085\u2028\u2029]/;
const urls = /(?:[a-z][a-z\d+.-]*:\/\/|\b(?:https?|ssh|git|ftp|file|mailto):|www\.|\b[^\s@]+@[^\s@:]+\.[^\s@:]+(?::|\/))/i;
const credentials = /(?:^|[^a-z\d])(?:(?:--?)?(?:api[-_]?key|token|password|passwd|secret|credential|authorization|auth)(?:[=:_-]|$)|bearer\s+|(?:sk-[a-z\d]{12,}|gh[pousr]_[a-z\d]{12,}|github_pat_[a-z\d_]{12,}|AKIA[A-Z0-9]{16}))/i;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && encoder.encode(value).length <= max && !controls.test(value);
}
function validArg(value: unknown, max: number): value is string {
  // Screening is not a guarantee that arbitrary project code is safe.
  return bounded(value, max) && value.trim().length > 0 && !urls.test(value) && !credentials.test(value);
}
function invalid(): never {
  throw new Error("Invalid Git workflow check: use bounded literal recipe fields (no unknown fields, controls, URLs or obvious credentials)");
}

/** No traversal, absolute paths, drive/UNC syntax, or Windows-ambiguous components. */
export function validGitCheckCwd(value: unknown): value is string {
  if (!bounded(value, MAX_GIT_CHECK_CWD) || !value) return false;
  if (value === ".") return true;
  return value.split("/").every((part) => /^[A-Za-z0-9_.+\-]+$/.test(part)
    && part !== "." && part !== ".." && !part.endsWith(".")
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

/** Case-insensitive rejection covers both POSIX and Windows hosts. Keep aligned with project-command-env.ts. */
export function validGitCheckEnvName(value: string): boolean {
  return value.length <= MAX_GIT_CHECK_ENV_NAME && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    && !/^(?:GIT_|NEXT_|PORT$|NODE_ENV$|PI_WEB_PASSWORD$)/i.test(value)
    && !credentials.test(value);
}
function validateEnv(input: unknown): Record<string, string> {
  if (!record(input) || Reflect.ownKeys(input).some((key) => typeof key !== "string")) invalid();
  const entries = Object.entries(input);
  if (entries.length > MAX_GIT_CHECK_ENV_ENTRIES) invalid();
  let bytes = 0;
  const names = new Set<string>();
  for (const [name, value] of entries) {
    if (!validGitCheckEnvName(name) || names.has(name.toUpperCase())
      || !bounded(value, MAX_GIT_CHECK_ENV_VALUE) || urls.test(value) || credentials.test(value)) invalid();
    names.add(name.toUpperCase());
    bytes += encoder.encode(name).length + encoder.encode(value).length + 2; // name=value + separator
    if (bytes > MAX_GIT_CHECK_ENV_BYTES) invalid();
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/** Fresh allowlisted copy, retaining absence and explicit defaults exactly. */
export function validateGitCheckRecipe(input: unknown): GitCheckRecipe {
  if (!record(input) || !Object.hasOwn(input, "label") || !Object.hasOwn(input, "argv")
    || Reflect.ownKeys(input).some((key) => typeof key !== "string" || !["label", "argv", "cwd", "env", "requiredStage"].includes(key))
    || !bounded(input.label, MAX_GIT_WORKFLOW_CHECK_LABEL) || !input.label || input.label.trim() !== input.label
    || !Array.isArray(input.argv) || input.argv.length < 1 || input.argv.length > MAX_GIT_WORKFLOW_CHECK_ARGS + 1
    || !validArg(input.argv[0], MAX_GIT_WORKFLOW_CHECK_EXECUTABLE)
    || !Array.from(input.argv.slice(1)).every((arg: unknown) => validArg(arg, MAX_GIT_WORKFLOW_CHECK_ARG))
    || (/^(?:sh|bash|zsh|fish|dash|ksh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i
      .test(String(input.argv[0]).split(/[\\/]/).pop() ?? "")
      && input.argv.slice(1).some((arg: string) => /^(?:-[a-z]*c[a-z]*|-{1,2}(?:command|encodedcommand)|\/c)$/i.test(arg)))) invalid();
  if (Object.hasOwn(input, "cwd") && !validGitCheckCwd(input.cwd)) invalid();
  if (Object.hasOwn(input, "requiredStage") && !["commit", "integration", "handoff", "none"].includes(input.requiredStage as string)) invalid();
  return {
    label: input.label, argv: [...input.argv] as string[],
    ...(Object.hasOwn(input, "cwd") ? { cwd: input.cwd as string } : {}),
    ...(Object.hasOwn(input, "env") ? { env: validateEnv(input.env) } : {}),
    ...(Object.hasOwn(input, "requiredStage") ? { requiredStage: input.requiredStage as GitCheckStage } : {}),
  };
}
export function validateGitCheckRecipes(input: unknown): GitCheckRecipe[] {
  if (!Array.isArray(input) || input.length > MAX_GIT_WORKFLOW_CHECKS) throw new Error("Invalid Git workflow checks");
  return Array.from(input, validateGitCheckRecipe);
}

/** Only execution consumers may request defaults; never use this for persistence or digests. */
export function normalizeGitCheckRecipe(input: unknown): Required<GitCheckRecipe> {
  const recipe = validateGitCheckRecipe(input);
  return { ...recipe, cwd: recipe.cwd ?? ".", env: recipe.env ?? {}, requiredStage: recipe.requiredStage ?? "integration" };
}

/** Legacy runners must refuse even explicitly supplied default-valued extensions. */
export function hasExtendedGitCheckRecipe(recipe: GitCheckRecipe): boolean {
  return ["cwd", "env", "requiredStage"].some((key) => Object.hasOwn(recipe, key));
}

/** Exact stage only, not cumulative. `none` is optional/manual-only, never a prerequisite.
 * Empty selection creates no receipt and says nothing about repository-required verification. */
export function selectGitCheckRecipesForStage(input: unknown, stage: Exclude<GitCheckStage, "none">): { checkIndex: number; recipe: GitCheckRecipe }[] {
  if (!["commit", "integration", "handoff"].includes(stage)) throw new Error("Invalid Git check selection stage");
  return validateGitCheckRecipes(input).flatMap((recipe, checkIndex) =>
    (recipe.requiredStage ?? "integration") === stage ? [{ checkIndex, recipe }] : []);
}
