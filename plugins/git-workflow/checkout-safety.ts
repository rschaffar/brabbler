import { lstatSync, realpathSync } from "node:fs";
import { samePath } from "../../lib/paths";
import { gitOutput, records } from "./process";

/** Directory identity, not volatile timestamps or content. Never adopt a replacement. */
export function directoryIdentity(path: string): string {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(realpathSync(path), path)) {
    throw new Error("Git observation refuses a symlink or substituted directory");
  }
  return `${stat.dev}:${stat.ino}:${stat.mode}`;
}

/** Even status can execute clean filters; use this before content-based reads. */
export async function refuseFilters(cwd: string, paths: string | AsyncIterable<Uint8Array>, index?: string) {
  let i = 0;
  for await (const attribute of records(gitOutput(cwd, ["check-attr", "-z", "--stdin", "filter"], { input: paths, index }))) {
    if (i++ % 3 === 2 && attribute !== "unspecified" && attribute !== "unset") throw new Error("Git plugin preflight refuses clean/process filter attributes; use ordinary Git tools for this repository");
  }
}
