{ lib, stdenv, makeWrapper, nodejs, git, noto-fonts, src, modules }:
let
  manifest = builtins.fromJSON (builtins.readFile (src + "/package.json"));
in
stdenv.mkDerivation {
  pname = "pi-web";
  version = manifest.version;
  inherit src;
  nativeBuildInputs = [ nodejs makeWrapper ];
  # The only dependency installation/native rebuild is the manifest-keyed
  # modules derivation. Next's build gets a private physical copy; runtime uses
  # the exact immutable output. Never install over a working checkout.
  postPatch = ''
    substituteInPlace app/layout.tsx \
      --replace-fail 'import { Noto_Sans_Mono } from "next/font/google";' 'import localFont from "next/font/local";' \
      --replace-fail 'const notoSansMono = Noto_Sans_Mono({' 'const notoSansMono = localFont({' \
      --replace-fail 'subsets: ["latin", "cyrillic"],' 'src: "./NotoSansMono.ttf",'
    cp ${noto-fonts}/share/fonts/noto/NotoSansMono.ttf app/NotoSansMono.ttf
  '';
  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR/home" NEXT_TELEMETRY_DISABLED=1
    mkdir -p "$HOME"
    cp -R --reflink=auto ${modules}/node_modules ./node_modules
    chmod -R u+w node_modules
    npm run build
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    app="$out/lib/node_modules/${manifest.name}"
    mkdir -p "$app" "$out/bin"
    # Honor the package's declared runtime/source inventory, without npm
    # install, postinstall, pruning, or a second node-pty build.
    npm pack --ignore-scripts --offline --pack-destination "$TMPDIR" >/dev/null
    tar -xzf "$TMPDIR"/*.tgz --strip-components=1 -C "$app"
    ln -s ${modules}/node_modules "$app/node_modules"
    makeWrapper ${nodejs}/bin/node "$out/bin/pi-web" \
      --add-flags "$app/bin/pi-web.js" \
      --prefix PATH : ${lib.makeBinPath [ nodejs git ]}
    runHook postInstall
  '';
  passthru = { inherit modules; };
  meta = {
    description = "Web UI for the Pi coding agent";
    homepage = "https://github.com/agegr/pi-web";
    license = [ lib.licenses.mit lib.licenses.ofl ];
    mainProgram = "pi-web";
    platforms = lib.platforms.unix;
  };
}
