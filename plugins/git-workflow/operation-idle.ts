import { existsSync } from "node:fs";
import { toNativePath } from "../../lib/paths";
import { gitText, gitOutput, records } from "./process";
import { operationMarkerPaths, OPERATION_MARKERS } from "./operation-paths";

const defaultCapabilities = { git: gitText, existsSync, toNativePath, operationMarkerPaths, gitOutput, records };
export type IdleCapabilities = typeof defaultCapabilities;

export async function assertIdle(cwd: string, capabilities: IdleCapabilities = defaultCapabilities) {
  const { git, existsSync, toNativePath, operationMarkerPaths } = capabilities;
  const paths = await operationMarkerPaths(cwd);
  for (const [index, name] of OPERATION_MARKERS.entries()) {
    if (existsSync(toNativePath(paths[index]))) throw new Error(`Conflicting Git operation: ${name}`);
  }
  let sparseCheckout = "";
  try { sparseCheckout = (await git(cwd, ["config", "--get", "core.sparseCheckout"])).trim(); }
  catch (error) {
    // Only config --get's absent-key status is expected, never marker failures.
    if ((error as { status?: number }).status !== 1) throw error;
  }
  if (sparseCheckout === "true") throw new Error("Sparse checkout is unsupported");
}
export async function idle(cwd: string, capabilities: IdleCapabilities = defaultCapabilities) {
  const { gitOutput, records } = capabilities;
  await assertIdle(cwd, capabilities);
  for await (const entry of records(gitOutput(cwd, ["ls-files", "-v", "-z"]))) {
    if (/^[a-zS]/.test(entry)) throw new Error("Hidden index flags are unsupported");
  }
}
