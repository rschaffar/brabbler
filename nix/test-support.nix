{ pkgs, nodejs, src }:
let
  npmHooks = pkgs.npmHooks.override { inherit nodejs; };
in pkgs.stdenvNoCC.mkDerivation {
  pname = "pi-web-test-support";
  version = "1.0.0";
  inherit src nodejs;
  npmDeps = pkgs.fetchNpmDeps {
    inherit src;
    hash = "sha256-wAY0FSqW6RGMqZ8AgvE7eHbnO+XUN4b5Txh1drFDKxU=";
    fetcherVersion = 2;
  };
  # DOM support is pure JS. Never rebuild node-pty or install another React.
  npmRebuildFlags = [ "--ignore-scripts" ];
  nativeBuildInputs = [ nodejs npmHooks.npmConfigHook ];
  dontBuild = true;
  installPhase = ''
    mkdir -p "$out"
    cp -r node_modules "$out/node_modules"
  '';
}
