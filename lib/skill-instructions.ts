import { parseFrontmatter } from "./frontmatter";

export function skillInstructionsBody(content: string): string {
  return parseFrontmatter(content).rest.trim();
}

/** Resolve from the linking document, leaving escapes for the server to refuse. */
export function resolveSkillLink(href: string, fromDocument: string): { document: string; anchor: string } {
  const hash = href.indexOf("#");
  const [linkPath, anchor] = [hash < 0 ? href : href.slice(0, hash), hash < 0 ? "" : href.slice(hash + 1)]
    .map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  if (!linkPath) return { document: fromDocument, anchor };
  if (linkPath.startsWith("/")) return { document: linkPath, anchor };
  const parts = fromDocument.split("/").slice(0, -1);
  for (const part of linkPath.split("/")) {
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return { document: parts.join("/"), anchor };
}
