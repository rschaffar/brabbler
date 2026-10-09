import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, type BigIntStats } from "node:fs";
import { join } from "node:path";

export interface CleanupDirectoryIdentity { path: string; identity: string[] }
export const directoryIdentity = (stat: BigIntStats) => [String(stat.dev), String(stat.ino), String(stat.mode)];
export function supportsNestedCleanup(): boolean {
  return process.platform === "linux" && !!constants.O_DIRECTORY && !!constants.O_NOFOLLOW && existsSync("/proc/self/fd");
}

/** Hold the captured physical ancestor chain. Deletion through the final proc-fd
 * path cannot follow an intermediate symlink substituted after validation.
 * This is not an external-writer lock: leaf replacements can still race effects.
 */
export function holdCleanupParent(worktree: string, root: string, identities: CleanupDirectoryIdentity[]) {
  if (!supportsNestedCleanup()) throw new Error("Nested cleanup requires Linux no-follow directory handles; resources retained");
  const expected = new Map(identities.map((item) => [item.path, item.identity]));
  const chain: Array<{ fd: number; path: string; entry: string }> = [];
  const matches = (stat: BigIntStats, path: string) => stat.isDirectory()
    && JSON.stringify(directoryIdentity(stat)) === JSON.stringify(expected.get(path));
  const close = () => { for (const item of chain.reverse()) closeSync(item.fd); chain.length = 0; };
  const open = (absolute: string, path: string, entry: string) => {
    const fd = openSync(absolute, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    chain.push({ fd, path, entry });
    if (!matches(fstatSync(fd, { bigint: true }), path)) throw new Error("Cleanup ancestor identity changed; resources retained");
  };
  try {
    open(worktree, "", "");
    const parts = root.split("/"); let prefix = "";
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      open(join(`/proc/self/fd/${chain.at(-1)!.fd}`, part), prefix, part);
    }
    const validate = () => {
      if (!matches(lstatSync(worktree, { bigint: true }), "")) throw new Error("Cleanup worktree identity changed; resources retained");
      for (let i = 0; i < chain.length; i++) {
        const item = chain[i];
        if (!matches(fstatSync(item.fd, { bigint: true }), item.path)
          || i > 0 && !matches(lstatSync(join(`/proc/self/fd/${chain[i - 1].fd}`, item.entry), { bigint: true }), item.path)) {
          throw new Error("Cleanup ancestor identity changed; resources retained");
        }
      }
    };
    validate();
    return { path: join(`/proc/self/fd/${chain.at(-1)!.fd}`, parts.at(-1)!), validate, close };
  } catch (error) { close(); throw error; }
}
