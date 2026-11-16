/** A coherent identity supplied by the caller, never ordered by this controller. */
export type Change<T> = Readonly<{ revision: string; value: T }>;

declare const attemptBrand: unique symbol;
export type IdleChangeAttempt<T> = Readonly<{
  target: Change<T>;
  [attemptBrand]: true;
}>;
export type IdleChangeSnapshot<T> = Readonly<{
  desired: Change<T>;
  applied?: Change<T>;
  applying?: Change<T>;
  error?: Readonly<{ revision: string; message: string }>;
  pending: boolean;
}>;

const copyChange = <T>(change: Change<T>): Change<T> =>
  Object.freeze({ revision: change.revision, value: change.value });
const diagnostic = (message: string): string =>
  message.replace(/\p{Cc}/gu, " ").trim().slice(0, 512) || "Idle change failed.";

/**
 * Synchronous result bookkeeping only, NOT host idle/admission/lease ownership.
 * The adapter must save first, publish desired before acknowledging the save,
 * visibly refuse fresh ingress, and call begin only under real idle ownership.
 * It calls settle only after the actual effect AND cleanup settle, not on timeout.
 * No action, scheduling, persistence, cancellation, or automatic retry lives here.
 *
 * Change wrappers and returned records are copied/frozen, but generic values are
 * NOT cloned or deeply frozen (functions, cycles and native objects are allowed).
 * Callers must keep values immutable for their entire lifetime and use the same
 * revision only for the same coherent value, including scope/source ceilings.
 * Equality is exact revision equality, not value comparison or revision ordering.
 */
export function createIdleChange<T>(initial: { desired: Change<T>; applied?: Change<T> }) {
  let desired = copyChange(initial.desired);
  let applied = initial.applied === undefined ? undefined : copyChange(initial.applied);
  let active: IdleChangeAttempt<T> | undefined;
  let error: IdleChangeSnapshot<T>["error"];

  const isTargetApplied = (target: Change<T>) => applied?.revision === target.revision;
  const requireActive = (attempt: IdleChangeAttempt<T>) => {
    if (!active || active !== attempt) throw new Error("Unknown or settled idle change attempt");
  };

  return Object.freeze({
    snapshot(): IdleChangeSnapshot<T> {
      return Object.freeze({ desired, applied, applying: active?.target, error,
        pending: Boolean(active || error || !isTargetApplied(desired)) });
    },
    setDesired(next: Change<T>): void {
      desired = copyChange(next); // Coalesce, never abort ownership or clear errors.
    },
    assertFreshAdmission(): void {
      if (error) throw new Error("Idle change failed; explicit repair/retry is required before fresh input");
      if (active || !isTargetApplied(desired)) throw new Error("Idle change pending; fresh input refused");
    },
    begin(): IdleChangeAttempt<T> | undefined {
      if (active || error || isTargetApplied(desired)) return undefined;
      active = Object.freeze({ target: desired }) as IdleChangeAttempt<T>;
      // The action may destroy the old state as soon as begin returns.
      applied = undefined;
      return active;
    },
    reportError(attempt: IdleChangeAttempt<T>, message: string): void {
      requireActive(attempt);
      // First response diagnostic wins; it never releases the actual effect owner.
      error ??= Object.freeze({ revision: attempt.target.revision, message: diagnostic(message) });
    },
    settle(attempt: IdleChangeAttempt<T>, outcome: { applied?: Change<T>; error?: string }): void {
      requireActive(attempt);
      // Supplied applied is an independently verified actual result, not intent.
      // Absence means unknown, even if the old value might still be installed.
      const actual = outcome.applied === undefined ? undefined : copyChange(outcome.applied);
      const failure = outcome.error !== undefined ? diagnostic(outcome.error)
        : actual?.revision !== attempt.target.revision
          ? "Idle change settled without confirming the attempted target." : undefined;
      applied = actual;
      if (failure) {
        error = Object.freeze({ revision: attempt.target.revision,
          message: error && error.message !== failure ? `${error.message}\n${failure}` : failure });
      }
      // A late success retains any reportError. It cannot acknowledge newer intent.
      active = undefined;
    },
    retry(): void {
      if (active) throw new Error("Idle change still owns unsettled work; cannot retry");
      // Explicit repair invalidates knowledge even after a late confirmed success.
      error = undefined;
      applied = undefined;
    },
  });
}
