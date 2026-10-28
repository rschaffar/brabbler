{ lib, root }:
let
  inherit (lib) fileset;
  paths = names: fileset.unions (map (name: fileset.maybeMissing (root + "/${name}")) names);
  # Install-time SDK policy is also a dependency realization input.
  manifests = paths [ "package.json" "package-lock.json"
    "bin/patch-sdk-command-env.js" "bin/sdk-command-env-payload.js"
    "bin/sdk-runtime-policy.js" ];
  applicationFiles = fileset.union
    (paths [
      "package.json" "package-lock.json" "LICENSE" "tsconfig.json" "next.config.ts"
      "postcss.config.mjs" "tailwind.config.ts" "instrumentation.ts"
      "instrumentation-node.ts" "proxy.ts"
    ])
    (fileset.unions (map (name: fileset.fileFilter (file:
      builtins.match ".*\\.(test|fixture)\\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$" file.name == null
      && !(lib.hasPrefix ".env" file.name)
    ) (root + "/${name}")) [ "app" "components" "hooks" "lib" "plugins" "public" "bin" ]));
  application = fileset.difference applicationFiles (paths [ "lib/testing" ]);
  tests = fileset.intersection
    (fileset.fileFilter (file: !(lib.hasPrefix ".env" file.name)) root)
    (fileset.union application (paths [
    "app" "components" "hooks" "lib" "plugins" "public" "e2e" "nix" "docs" ".github"
    "AGENTS.md" "CONTEXT.md" "README.md" "eslint.config.mjs"
    "flake.nix" "flake.lock" ".gitignore" ".agents/skills/writing-plans"
  ]));
  # The current TS/ESLint configuration consumes code/config, not prose. Include
  # all code, JSON and styles (including tests/TSX fixtures); exclude docs and Nix
  # definitions from the reusable static evidence identity. Changes to this recipe
  # or the check implementation still change its derivation.
  # Preserve the full application tree, including file-based metadata routes and
  # assets Next may inspect during genuine type generation.
  staticInputs = fileset.union application (fileset.intersection tests (fileset.fileFilter (file:
    builtins.match ".*\\.(cjs|mjs|js|jsx|ts|tsx|mts|cts|json|css)$" file.name != null
  ) root));
  # Node test entrypoints and their live scheduling policy are not TS inputs.
  # Adding a classified JS test must not invalidate the unchanged type graph.
  # Keep TSX/other fixtures; architectural guards reject typed imports of the
  # excluded entrypoints/policy, rather than caching missing type dependencies.
  typingInputs = fileset.difference staticInputs (fileset.union
    (fileset.fileFilter (file: lib.hasSuffix ".test.mjs" file.name) root)
    (paths [ "nix/test-lanes.json" ]));
  source = fileset: lib.fileset.toSource { inherit root fileset; };
in
{
  manifests = source manifests;
  testManifests = fileset.toSource {
    root = root + "/lib/testing";
    fileset = paths [ "lib/testing/package.json" "lib/testing/package-lock.json" ];
  };
  application = source application;
  tests = source tests;
  static = source staticInputs;
  typing = source typingInputs;
}
