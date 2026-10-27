import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

function sourceAt(root: string): { path: string; version: string } | null {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (manifest.name !== "brabbler" || typeof manifest.version !== "string"
      || !existsSync(join(root, "app", "layout.tsx"))
      || !existsSync(join(root, "lib", "rpc-manager.ts"))) return null;
    return { path: root, version: manifest.version };
  } catch {
    return null;
  }
}

/** Prefer the executing module's package (dev or .next/server/chunks), not the caller's cwd. */
export function brabblerSourceLocation(root?: string): { path: string; version: string } | null {
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
export function createBrabblerSourceExtension(
  locate: () => ReturnType<typeof brabblerSourceLocation> = brabblerSourceLocation,
): InlineExtension {
  return {
    name: "brabbler-source",
    hidden: true,
    factory: (pi) => {
      pi.registerTool({
        name: "brabbler_source",
        label: "Brabbler source",
        description: "Locate the source of this running Brabbler version when investigating Brabbler itself. Returns a local path and version, not source contents; read only the files you need with your file tools.",
        parameters: Type.Object({}),
        async execute() {
          const source = locate();
          if (!source) return {
            content: [{ type: "text" as const, text: "Brabbler source is unavailable in this installation." }],
            isError: true,
            details: {},
          };
          return {
            content: [{ type: "text" as const, text: `Brabbler ${source.version} source: ${source.path}\nFirst-party code is in app/, components/, hooks/, lib/, and plugins/. Treat this installed copy as a reference; work in a checkout for changes.` }],
            details: {},
          };
        },
      });
    },
  };
}
