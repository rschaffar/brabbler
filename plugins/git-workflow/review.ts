import type { PluginCard, PluginReviewWriter, RequiredCheck } from "../../lib/plugins/types";
import type { ReviewedGitOperation } from "./server";
import { gitOutput } from "./process";
import { registerGitPatchContext } from "./context";

function* jsonParts(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    yield "["; for (let i = 0; i < value.length; i++) { if (i) yield ","; yield* jsonParts(value[i] ?? null); } yield "]";
  } else if (value !== null && typeof value === "object") {
    yield "{"; let first = true;
    for (const [key, item] of Object.entries(value)) { if (item === undefined) continue; if (!first) yield ","; first = false; yield JSON.stringify(key) + ":"; yield* jsonParts(item); }
    yield "}";
  } else yield JSON.stringify(value) ?? "null";
}
async function writeJson(writer: PluginReviewWriter, value: unknown) {
  let buffer = "";
  for (const part of jsonParts(value)) {
    buffer += part;
    if (buffer.length >= 65536) { await writer.write(Buffer.from(buffer)); buffer = ""; }
  }
  await writer.write(Buffer.from(buffer + "\n"));
}
/** Frame raw bytes, not parsed hunks. A pathological long line never accumulates
 * in memory; every byte (including binary patches) is preserved verbatim. */
export async function writePatchEntries(writer: PluginReviewWriter, source: AsyncIterable<Uint8Array>) {
  const marker = Buffer.from("\ndiff --git ");
  let pending = Buffer.alloc(0), opened = false, count = 0;
  const begin = async () => {
    const newline = pending.indexOf(10);
    const header = pending.subarray(0, newline < 0 ? Math.min(pending.length, 8192) : Math.min(newline, 8192)).toString("utf8");
    await writer.begin(header.startsWith("diff --git ") ? header.slice(11) : `Raw patch ${count + 1}`, "patch");
    opened = true; count++;
  };
  for await (const chunk of source) {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    if (!opened) { if (pending.indexOf(10) < 0 && pending.length < 8192) continue; await begin(); }
    let next: number;
    while ((next = pending.indexOf(marker)) >= 0) {
      await writer.write(pending.subarray(0, next + 1)); await writer.end(); opened = false;
      pending = pending.subarray(next + 1);
      if (pending.indexOf(10) < 0 && pending.length < 8192) break;
      await begin();
    }
    if (opened && pending.length > marker.length) {
      await writer.write(pending.subarray(0, pending.length - marker.length));
      pending = Buffer.from(pending.subarray(pending.length - marker.length));
    }
  }
  if (pending.length && !opened) await begin();
  if (opened) { await writer.write(pending); await writer.end(); }
  return count;
}
export async function buildGitReview(writer: PluginReviewWriter, operation: ReviewedGitOperation,
  snapshot: { card: PluginCard; fingerprint: string; cwd: string; args: string[]; checks: RequiredCheck[]; comparison?: { before: string; after: string } }, signal?: AbortSignal, onProgress?: (text: string) => void) {
  signal?.throwIfAborted();
  await writer.begin("Exact operation, checks and captured state", "text");
  await writeJson(writer, { operation, fingerprint: snapshot.fingerprint, comparison: snapshot.comparison, args: snapshot.args, checks: snapshot.checks, presentation: snapshot.card });
  await writer.end();
  if (snapshot.comparison) {
    const comparison = snapshot.comparison;
    let smallPatch: Buffer[] | undefined = [], size = 0, lastReport = 0;
    async function* source() {
      for await (const chunk of gitOutput(snapshot.cwd,
        ["diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", comparison.before, comparison.after, "--"], { signal })) {
        size += chunk.length;
        if (Date.now() - lastReport >= 1000) { lastReport = Date.now(); onProgress?.(`Saving exact patch: ${size} bytes processed.`); }
        if (size <= 256 * 1024) smallPatch?.push(chunk); else smallPatch = undefined;
        yield chunk;
      }
    }
    await writePatchEntries(writer, source());
    // Optional convenience only: never let unavailable context block an operation.
    if (smallPatch) try { snapshot.card.patchContext = registerGitPatchContext(snapshot.cwd, comparison.before, comparison.after, Buffer.concat(smallPatch).toString("utf8")); } catch { /* Exact durable patch remains available. */ }
  }
  signal?.throwIfAborted();
}
const excerpt = (value: string, length: number) => value.length > length ? value.slice(0, length) + "… [full value in exact review]" : value;
/** Application presentation configuration, never operation JSON or Git policy. */
export interface GitCardPresentation { readonly sectionFieldLimit: number }
export const DEFAULT_GIT_CARD_PRESENTATION: GitCardPresentation = Object.freeze({ sectionFieldLimit: 24 });
/** Limits apply only to presentation. The unabridged card is already persisted. */
export function compactGitCard(card: PluginCard, presentation: GitCardPresentation = DEFAULT_GIT_CARD_PRESENTATION): PluginCard {
  const sectionLimit = presentation.sectionFieldLimit;
  if (!Number.isSafeInteger(sectionLimit) || sectionLimit < 1 || sectionLimit > DEFAULT_GIT_CARD_PRESENTATION.sectionFieldLimit) throw new Error("Git section preview limit must be an integer from 1 to 24");
  const fields = (values: NonNullable<PluginCard["fields"]>, limit: number) => values.slice(0, limit).map((field) => ({ ...field, label: excerpt(field.label, 90), value: excerpt(field.value, 2048) }));
  return { ...card, fields: card.fields && fields(card.fields, 24),
    sections: card.sections?.map((section) => ({ ...section, title: excerpt(section.title, 90),
      ...(section.fields ? { fields: fields(section.fields, sectionLimit) } : {}), text: [section.text ? excerpt(section.text, 8192) : "",
        section.fields && section.fields.length > sectionLimit ? `Showing ${sectionLimit} of ${section.fields.length} items. The exact review contains every item.` : ""].filter(Boolean).join("\n") })),
  };
}
