{ pkgs, nodejs, src }:
let
  npmHooks = pkgs.npmHooks.override { inherit nodejs; };
in pkgs.stdenvNoCC.mkDerivation {
  pname = "brabbler-test-support";
  version = "1.0.0";
  inherit src nodejs;
  npmDeps = pkgs.fetchNpmDeps {
    inherit src;
    hash = "sha256-l81WMc90xXsedD2B+oHl5OnrymDz8Scu5UYARYJBgEQ=";
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
