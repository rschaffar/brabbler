/** Client-safe identity/shape leaf. No storage, Node APIs or plugin semantics. */
export const OPERATION_REVIEW_TYPE = "brabbler:operation-review";
export interface OperationReviewReference { version: 2; id: string; operationId: string }
export function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isOperationReviewReference(value: unknown): value is OperationReviewReference {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3
    || !["version", "id", "operationId"].every(key => Object.hasOwn(value, key))) return false;
  const ref = value as OperationReviewReference;
  return ref.version === 2 && isOperationId(ref.id) && isOperationId(ref.operationId);
}
