// Internal trusted-caller adapter. Never populate these callbacks/owner from request payloads.
import path from "node:path";
import { types } from "node:util";
import { captureGitInvocation, assertGitInvocationCurrentSync, consumeGitInvocationSync, retireGitInvocation,
  type GitInvocationBinding, type GitInvocationHandle } from "./git-invocation";

export interface GitMutationInvocationAuthority {
  owner: GitInvocationBinding["owner"];
  /** Mutation-aware relevant authority revision, including change-and-restore. */
  readAuthorityRevisionSync(): string;
  /** Independently checks this actual owner, exact approval/candidate and required evidence. */
  assertCurrentSync(binding: Readonly<GitInvocationBinding>): void;
}
export interface GitMutationInvocation {
  readonly handle: GitInvocationHandle;
  readonly binding: GitInvocationBinding;
  assertCurrentSync(): void;
  consumeSync(): void;
  retire(): void;
}
/** Call BEFORE the first await, not after preparing objects or waiting for approval. */
export function captureGitMutationAuthority(input: GitMutationInvocationAuthority | undefined) {
  if (!input || typeof input.readAuthorityRevisionSync !== "function" || typeof input.assertCurrentSync !== "function" ||
      !input.owner || typeof input.owner.sessionId !== "string" || !input.owner.sessionId) {
    throw new Error("Trusted original native invocation authority required");
  }
  const read = input.readAuthorityRevisionSync, assert = input.assertCurrentSync;
  if ([read, assert].some((f) => types.isAsyncFunction(f) || types.isGeneratorFunction(f) || types.isProxy(f))) {
    throw new Error("Synchronous original invocation guards required");
  }
  const drain = (value: unknown) => {
    if (value !== null && (typeof value === "object" || typeof value === "function")) void Promise.resolve(value).catch(() => {});
  };
  const readRevision = () => {
    let current: unknown;
    try { current = read(); } catch (e) { drain(e); throw e; }
    if (typeof current !== "string" || !current || current.length > 4096 || /[\x00-\x1f\x7f]/.test(current)) {
      drain(current); throw new Error("Synchronous original authority revision required");
    }
    return current;
  };
  const revision = readRevision();
  const rawOwner = input.owner;
  if (types.isProxy(rawOwner) || ![Object.prototype, null].includes(Object.getPrototypeOf(rawOwner)) ||
      Reflect.ownKeys(rawOwner).length !== 3 || ["sessionId", "sessionFile", "generation"].some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(rawOwner, key);
        return !descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string" ||
          !descriptor.value || descriptor.value.length > 4096 || /[\x00-\x1f\x7f]/.test(descriptor.value);
      }) || !path.isAbsolute(rawOwner.sessionFile) || path.normalize(rawOwner.sessionFile) !== rawOwner.sessionFile) {
    throw new Error("Actual canonical invocation owner required");
  }
  const owner = Object.freeze(structuredClone(rawOwner));
  const readOriginal = () => {
    const current = readRevision();
    if (current !== revision) throw new Error("Original invocation authority changed");
    return current;
  };
  return Object.freeze({ owner, assertOriginalSync(): void { readOriginal(); },
    bind(data: Omit<GitInvocationBinding, "owner">): GitMutationInvocation {
      const freeze = <T>(value: T): T => {
        if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
        return value;
      };
      const binding = freeze(structuredClone({ ...data, owner }));
      // Foundation validates and deeply freezes its private independent copy.
      const handle = captureGitInvocation(binding, { readAuthorityRevisionSync: readOriginal, assertCurrentSync: assert });
      return Object.freeze({ handle, binding,
        assertCurrentSync: () => assertGitInvocationCurrentSync(handle, binding),
        consumeSync: () => consumeGitInvocationSync(handle, binding),
        retire: () => retireGitInvocation(handle) });
    },
  });
}
