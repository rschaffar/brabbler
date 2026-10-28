{ pkgs, nodejs, src }:
let
  npmHooks = pkgs.npmHooks.override { inherit nodejs; };
in
pkgs.stdenv.mkDerivation {
  pname = "brabbler-node-modules";
  version = (builtins.fromJSON (builtins.readFile (src + "/package.json"))).version;
  inherit src nodejs;
  npmDeps = import ./npm-deps.nix { inherit (pkgs) fetchNpmDeps; inherit src; };
  npmRebuildFlags = [ "node-pty" ];
  nativeBuildInputs = [ nodejs nodejs.python npmHooks.npmConfigHook ];
  # npmConfigHook ignores app lifecycle scripts. Apply to this owned writable
  # tree before publishing the modules shared by build, tests and runtime.
  preInstall = ''
    node bin/sdk-runtime-policy.js --preflight
    node bin/patch-sdk-command-env.js --apply
    node bin/sdk-runtime-policy.js --apply
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r node_modules "$out/node_modules"
    runHook postInstall
  '';
}
