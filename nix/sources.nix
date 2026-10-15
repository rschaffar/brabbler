{ lib, root }:
let
  inherit (lib) fileset;
  paths = names: fileset.unions (map (name: fileset.maybeMissing (root + "/${name}")) names);
  manifests = paths [ "package.json" "package-lock.json" ];
  application = fileset.union
    (paths [
      "package.json" "package-lock.json" "LICENSE" "tsconfig.json" "next.config.ts"
      "postcss.config.mjs" "tailwind.config.ts" "instrumentation.ts"
      "instrumentation-node.ts" "proxy.ts"
    ])
    (fileset.unions (map (name: fileset.fileFilter (file:
      !(lib.hasSuffix ".test.mjs" file.name || lib.hasSuffix ".fixture.mjs" file.name)
      && !(lib.hasPrefix ".env" file.name)
    ) (root + "/${name}")) [ "app" "components" "hooks" "lib" "plugins" "public" "bin" ]));
  tests = fileset.intersection
    (fileset.fileFilter (file: !(lib.hasPrefix ".env" file.name)) root)
    (fileset.union application (paths [
    "app" "components" "hooks" "lib" "plugins" "public" "e2e" "nix" "docs" ".github"
    "AGENTS.md" "CONTEXT.md" "README.md" "eslint.config.mjs"
    "flake.nix" "flake.lock" ".gitignore" ".agents/skills/writing-plans"
  ]));
  source = fileset: lib.fileset.toSource { inherit root fileset; };
in
{
  manifests = source manifests;
  application = source application;
  tests = source tests;
}
