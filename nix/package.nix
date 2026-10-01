{
  lib,
  buildNpmPackage,
  fetchNpmDeps,
  git,
  nodejs,
  noto-fonts,
  src,
  piCli ? null,
}:
let
  manifest = builtins.fromJSON (builtins.readFile "${src}/package.json");
  piDependencies = [
    "@earendil-works/pi-agent-core"
    "@earendil-works/pi-ai"
    "@earendil-works/pi-coding-agent"
    "@earendil-works/pi-tui"
  ];
  mismatched = lib.filter (
    name: (manifest.dependencies.${name} or null) != piCli.version
  ) piDependencies;
in
# Consumers sharing a Pi CLI can opt into the SDK version guard; standalone
# installations need only this flake and no second package source.
assert lib.assertMsg (piCli == null || mismatched == [ ]) (
  "Pi Web SDK versions must match the selected Pi CLI (${
    if piCli == null then "none" else piCli.version
  }); mismatched: "
  + lib.concatMapStringsSep ", " (
    name: "${name}=${toString (manifest.dependencies.${name} or "<missing>")}"
  ) mismatched
);
buildNpmPackage {
  pname = "pi-web";
  version = manifest.version;
  inherit src nodejs;
  # The same lockfile-derived, fixed-output npm cache is used by the dev shell.
  npmDeps = import ./npm-deps.nix { inherit fetchNpmDeps src; };
  npmDepsFetcherVersion = 2;

  # The normal Next build downloads a Google font. Nix builds are offline.
  postPatch = ''
    substituteInPlace app/layout.tsx \
      --replace-fail 'import { Noto_Sans_Mono } from "next/font/google";' 'import localFont from "next/font/local";' \
      --replace-fail 'const notoSansMono = Noto_Sans_Mono({' 'const notoSansMono = localFont({' \
      --replace-fail 'subsets: ["latin", "cyrillic"],' 'src: "./NotoSansMono.ttf",'
    cp ${noto-fonts}/share/fonts/noto/NotoSansMono.ttf app/NotoSansMono.ttf
  '';

  npmRebuildFlags = [ "node-pty" ];
  # `nix run` and systemd user services must find the pinned Node/npm and Git
  # without depending on the invoking shell's PATH.
  makeWrapperArgs = [ "--prefix" "PATH" ":" (lib.makeBinPath [ nodejs git ]) ];

  meta = {
    description = "Web UI for the Pi coding agent";
    homepage = "https://github.com/agegr/pi-web";
    license = [
      lib.licenses.mit
      lib.licenses.ofl
    ];
    mainProgram = "pi-web";
    platforms = lib.platforms.unix;
  };
}
