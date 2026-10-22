/** Literal resource grammar and exact reusable authority. No filesystem or Git reads. */
const rootName = /^[a-zA-Z0-9_.-]+$/;
// Conservative on every platform, including Windows case/trailing-dot aliases.
export const rootKey = (name: string) => name.replace(/[. ]+$/g, "").toLowerCase();
export const pathKey = (name: string) => name.split("/").map(rootKey).join("/");
const validRoot = (name: string) => name.split("/").every((part) => rootName.test(part) && !["", ".git"].includes(rootKey(part)));
export function artifactParentsOf(roots: string[]): string[] {
  const parents = new Set<string>();
  for (const root of roots) {
    const parts = root.split("/");
    for (let i = 1; i < parts.length; i++) parents.add(parts.slice(0, i).join("/"));
  }
  return [...parents];
}
export function permittedArtifactRoots(configured: string | null): string[] {
  const roots = (configured ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (roots.some((value) => !validRoot(value))) throw new Error("Invalid configured generated artifact list");
  return roots;
}
export function validateArtifactRoots(roots: string[]): void {
  if (!Array.isArray(roots) || new Set(roots).size !== roots.length
    || roots.some((name) => typeof name !== "string" || !validRoot(name))) throw new Error("Select distinct literal relative generated files or directories");
  const keys = roots.map(pathKey).sort();
  const selected = new Set<string>();
  for (const key of keys) {
    if (selected.has(key) || artifactParentsOf([key]).some((parent) => selected.has(parent))) throw new Error("Generated artifact roots cannot overlap or alias each other");
    selected.add(key);
  }
}
/** Permission is exact spelling, not containment, ignore status or normalized identity. */
export function unapprovedArtifactRoots(roots: string[], permitted: string[]): string[] {
  return roots.filter((root) => !permitted.includes(root));
}
