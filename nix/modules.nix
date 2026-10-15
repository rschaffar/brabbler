{ pkgs, nodejs, src }:
let
  npmHooks = pkgs.npmHooks.override { inherit nodejs; };
in
pkgs.stdenv.mkDerivation {
  pname = "pi-web-node-modules";
  version = (builtins.fromJSON (builtins.readFile (src + "/package.json"))).version;
  inherit src nodejs;
  npmDeps = import ./npm-deps.nix { inherit (pkgs) fetchNpmDeps; inherit src; };
  npmRebuildFlags = [ "node-pty" ];
  nativeBuildInputs = [ nodejs nodejs.python npmHooks.npmConfigHook ];
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r node_modules "$out/node_modules"
    runHook postInstall
  '';
}
