import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { strictJsonObject } from "@/lib/guided-review";
import { keys, stableId, validateOperation, REVIEW_LIMITS } from "@/lib/notebook-review";
import { authorizeReview, revalidateReview, readReview, appendReview, importReviewReply, inspectReviewMaterial, reviewError, ReviewStoreError } from "@/lib/notebook-review-store";
export const dynamic = "force-dynamic";
async function authorization(request: NextRequest) {
  if (!isApiRequestAllowed(request)) throw new ReviewStoreError("Untrusted API request", 403);
  const p = request.nextUrl.searchParams, index = p.get("index");
  if (p.size !== 1 || !index || !path.isAbsolute(index)) throw new Error("Invalid review-data request");
  return authorizeReview(index, await getAllowedFileRoots());
}
function failure(error: unknown) { const e = error instanceof RequestBodyTooLargeError ? { message: error.message, status: 413, possiblyCommitted: false } : reviewError(error); return NextResponse.json({ error: e.message, possiblyCommitted: e.possiblyCommitted }, { status: e.status }); }
/** Read-only, including an absent review-data folder. No imports, mkdir, cleanup or migration. */
export async function GET(request: NextRequest) {
  try { return NextResponse.json(readReview(await authorization(request)), { headers: { "Cache-Control": "no-store" } }); } catch (e) { return failure(e); }
}
export async function POST(request: NextRequest) {
  try {
    const auth = await authorization(request); // Capture physical identity BEFORE the asynchronous body.
    if (!hasJsonContentType(request)) throw new Error("Expected JSON");
    const raw = await parseJsonWithinLimit(request, REVIEW_LIMITS.snapshotBytes, source => strictJsonObject(source, REVIEW_LIMITS.snapshotBytes));
    revalidateReview(auth);
    const body = keys(raw, ["action"], ["expected", "submissionId", "operation", "stepId", "batchId", "text"]);
    if (body.action === "inspect") { keys(body, ["action", "stepId"]); stableId(body.stepId); return NextResponse.json(await inspectReviewMaterial(auth, body.stepId)); }
    const expected = keys(body.expected, ["sequence", "digest"]);
    if (!Number.isSafeInteger(expected.sequence) || (expected.sequence as number) < 0 || typeof expected.digest !== "string" || !/^(?:[a-f0-9]{64})?$/.test(expected.digest)) throw new Error("Invalid expected history tip");
    stableId(body.submissionId);
    const tip = { sequence: expected.sequence as number, digest: expected.digest };
    if (body.action === "append") {
      keys(body, ["action", "expected", "submissionId", "operation"]);
      const operation = validateOperation(body.operation);
      if (operation.kind === "import") throw new Error("Replies require the immutable import pipeline");
      return NextResponse.json(await appendReview(auth, tip, body.submissionId, operation));
    }
    if (body.action === "import") {
      keys(body, ["action", "expected", "submissionId", "batchId"], ["text"]); stableId(body.batchId);
      if (body.text !== undefined && (typeof body.text !== "string" || Buffer.byteLength(body.text) > REVIEW_LIMITS.replyBytes)) throw new Error("Reply exceeds 256 KiB");
      return NextResponse.json(await importReviewReply(auth, tip, body.submissionId, body.batchId, body.text as string | undefined));
    }
    throw new Error("Unknown review-data action");
  } catch (e) { return failure(e); }
}
