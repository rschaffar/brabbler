import { NextResponse } from "next/server";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isExistingPathWithinRoots } from "@/lib/path-security";
import { readRegularFileText } from "@/lib/regular-file";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { prepareSkillInspection, resourceApiFailure } from "@/lib/agent-resources/api";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/** Skill instructions should stay small enough to inspect without a large API response. */
const SKILL_CONTENT_MAX_BYTES = 1024 * 1024;
const MARKDOWN_FILE = /\.(md|markdown)$/i;

// GET /api/skills/content?cwd=<path>&filePath=<loaded skill path>[&document=<path in the skill folder>]
// The resource loader is the allow-list: accepting any readable Markdown path
// here would turn the Skills panel into a general filesystem reader. `document`
// is another Markdown file under that skill's folder, where pi resolves the
// skill's relative links; its refusals name no filesystem path.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const filePath = searchParams.get("filePath");
  const document = searchParams.get("document");
  const key = searchParams.get("selectionKey");
  const sessionId = searchParams.get("sessionId");
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (key !== null) {
    if (!isApiRequestAllowed(req)) return reply({ error: "Untrusted API request" }, 403);
    if (!key || key.length > 49_152 || filePath !== null || [...searchParams.keys()].some(name => !["selectionKey", "cwd", "sessionId", "document"].includes(name) || searchParams.getAll(name).length !== 1)) {
      return reply({ error: "Use one current selectionKey, optional cwd/own sessionId and contained document; do not combine filePath" }, 400);
    }
  } else {
    // Retained native-loader callers keep their exact membership contract.
    if (sessionId !== null) return reply({ error: "Session inspection requires a current selectionKey" }, 400);
    if (!cwd) return reply({ error: "cwd required" }, 400);
    if (!filePath) return reply({ error: "filePath required" }, 400);
  }

  try {
    const inspection = key !== null ? await prepareSkillInspection({ ...(cwd !== null ? { cwd } : {}), ...(sessionId !== null ? { sessionId } : {}) }, key) : null;
    const skill = inspection?.skill ?? await (async () => {
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(cwd!, allowedRoots)) return null;
      const { skills } = await loadSkillsWithInstallInfo(cwd!);
      return skills.find(item => item.filePath === filePath);
    })();
    if (!skill) {
      if (cwd && !isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return reply({ error: "Access denied" }, 403);
      return reply({ error: "Skill not found" }, 404);
    }

    let target = skill.filePath;
    if (document !== null) {
      const refuse = (status: number, error: string) => reply({ error }, status);
      // The client sends a normalized path. A `..` after a link names one file
      // to path.join() and realpath, another to the filesystem (#748).
      if (path.isAbsolute(document) || /[\\:\0]/.test(document) || document.split("/").includes("..")) {
        return refuse(400, "Document path must stay inside the skill folder");
      }
      if (!MARKDOWN_FILE.test(document)) return refuse(415, "Only Markdown documents can be opened");
      target = path.join(skill.baseDir, document);
      if (!existsSync(target)) return refuse(404, "Skill document not found");
      if (!isExistingPathWithinRoots(target, new Set([skill.baseDir]))) return refuse(403, "Document is outside the skill folder");
      if (!MARKDOWN_FILE.test(realpathSync(target))) return refuse(415, "Only Markdown documents can be opened");
      const stats = statSync(target);
      if (!stats.isFile()) return refuse(400, "Skill document is not a regular file");
      if (stats.size > SKILL_CONTENT_MAX_BYTES) return refuse(413, "Skill document is larger than 1 MiB");
    }

    const validateTarget = () => {
      if (!MARKDOWN_FILE.test(target) || !MARKDOWN_FILE.test(realpathSync(target))) return reply({ error: "Only Markdown documents can be opened" }, 415);
      if (!isExistingPathWithinRoots(target, new Set([skill.baseDir]))) return reply({ error: "Document is outside the skill folder" }, 403);
      const stats = statSync(target, { bigint: true });
      if (!stats.isFile()) return reply({ error: "Skill document is not a regular file" }, 400);
      if (stats.size > BigInt(SKILL_CONTENT_MAX_BYTES)) return reply({ error: "Skill document is larger than 1 MiB" }, 413);
      const physicalPath = realpathSync(target);
      return { physicalPath, stats, token: JSON.stringify([realpathSync(skill.baseDir), physicalPath, String(stats.dev), String(stats.ino), String(stats.size), String(stats.mtimeNs), String(stats.ctimeNs)]) };
    };
    await inspection?.assertCurrent();
    const before = validateTarget();
    if (!("stats" in before)) return before;
    const content = readRegularFileText(before.physicalPath, SKILL_CONTENT_MAX_BYTES, before.stats);
    await inspection?.assertCurrent();
    const after = validateTarget();
    if (!("stats" in after) || after.token !== before.token) return reply({ error: "Skill document changed; refresh before reading" }, 409);
    if (content === undefined) {
      return reply({ error: "Skill file not found" }, 404);
    }
    return reply({ content });
  } catch (error) {
    if (key !== null) {
      const failure = resourceApiFailure(error);
      return reply({ error: failure.error }, failure.status);
    }
    // Node's errors name the path; a document's answer stays without one.
    if (document !== null) return reply({ error: "Skill document could not be read" }, 500);
    return reply({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
