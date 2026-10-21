// Adapted from upstream 898eb5ae. HTML/Markdown enable Preview; templates use
// markup instead. Ambiguous .m and .conf deliberately remain plain text.
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", php: "php", lua: "lua", pl: "perl", r: "r",
  go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift",
  scala: "scala", groovy: "groovy", gradle: "groovy", dart: "dart", zig: "zig",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp", mm: "objectivec",
  ex: "elixir", exs: "elixir", hs: "haskell", ml: "ocaml", clj: "clojure", nix: "nix",
  html: "html", htm: "html", vue: "markup", svelte: "markup", astro: "markup",
  css: "css", scss: "scss", less: "less",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", ini: "ini", cfg: "ini", properties: "properties",
  xml: "xml", md: "markdown", mdx: "markdown", tex: "latex",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  ps1: "powershell", psm1: "powershell", bat: "batch", cmd: "batch",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "protobuf",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl", diff: "diff", patch: "diff",
  env: "bash", gitignore: "bash", txt: "text",
  pdf: "pdf", docx: "word",
};

/** Presentation metadata only; never resolves or authorizes a path. */
export function getFileLanguage(filePath: string): string {
  const base = (filePath.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return Object.hasOwn(EXT_TO_LANGUAGE, ext) ? EXT_TO_LANGUAGE[ext] : "text";
}
