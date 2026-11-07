/** Removal-only projection. Registered extension definitions never grant builtins
 * or resurrect a tool absent from an explicit/saved child allowlist. */
export function filterNotebookTools(names: readonly string[]): string[] {
  const read = names.includes("read"), edit = names.includes("edit");
  return names.filter(name => name === "notebook_inspect" || name === "notebook_refresh_references" ? read
    : name === "notebook_update_step" ? read && edit : true);
}
