import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

function sourceAt(root: string): { path: string; version: string } | null {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (manifest.name !== "@agegr/pi-web" || typeof manifest.version !== "string"
      || !existsSync(join(root, "app", "layout.tsx"))
      || !existsSync(join(root, "lib", "rpc-manager.ts"))) return null;
    return { path: root, version: manifest.version };
  } catch {
    return null;
  }
}

/** Prefer the executing module's package (dev or .next/server/chunks), not the caller's cwd. */
export function piWebSourceLocation(root?: string): { path: string; version: string } | null {
  if (root !== undefined) return sourceAt(resolve(root));
  let candidate = resolve(__dirname);
  while (true) {
    const source = sourceAt(candidate);
    if (source) return source;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  // The standard launcher starts Next with cwd set to its installed package.
  return sourceAt(resolve(process.cwd()));
}

/** A small, on-demand pointer; source contents never enter the system prompt. */
export function createPiWebSourceExtension(
  locate: () => ReturnType<typeof piWebSourceLocation> = piWebSourceLocation,
): InlineExtension {
  return {
    name: "pi-web-source",
    hidden: true,
    factory: (pi) => {
      pi.registerTool({
        name: "pi_web_source",
        label: "Pi Web source",
        description: "Locate the source of this running Pi Web version when investigating Pi Web itself. Returns a local path and version, not source contents; read only the files you need with your file tools.",
        parameters: Type.Object({}),
        async execute() {
          const source = locate();
          if (!source) return {
            content: [{ type: "text" as const, text: "Pi Web source is unavailable in this installation." }],
            isError: true,
            details: {},
          };
          return {
            content: [{ type: "text" as const, text: `Pi Web ${source.version} source: ${source.path}\nFirst-party code is in app/, components/, hooks/, lib/, and plugins/. Treat this installed copy as a reference; work in a checkout for changes.` }],
            details: {},
          };
        },
      });
    },
  };
}
