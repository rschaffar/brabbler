{ lib, stdenv, makeWrapper, nodejs, git, util-linux, noto-fonts, src, modules }:
let
  manifest = builtins.fromJSON (builtins.readFile (src + "/package.json"));
in
stdenv.mkDerivation {
  pname = "brabbler";
  version = manifest.version;
  inherit src;
  outputs = [ "out" "tarball" ];
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
    mkdir -p "$app" "$out/bin" "$tarball"
    # Freeze consumer dependency resolution without maintaining a duplicate lock
    # in the checkout. The install smoke test verifies the resulting nested tree.
    cp package-lock.json npm-shrinkwrap.json
    # Honor the package's declared runtime/source inventory, without npm
    # install, postinstall, pruning, or a second node-pty build.
    npm pack --ignore-scripts --offline --pack-destination "$tarball" >/dev/null
    tar -xzf "$tarball"/*.tgz --strip-components=1 -C "$app"
    ln -s ${modules}/node_modules "$app/node_modules"
    makeWrapper ${nodejs}/bin/node "$out/bin/brabbler" \
      --add-flags "$app/bin/brabbler.js" \
      --prefix PATH : ${lib.makeBinPath ([ nodejs git ] ++ lib.optionals stdenv.hostPlatform.isLinux [ util-linux ])}
    runHook postInstall
  '';
  passthru = { inherit modules; };
  meta = {
    description = "A Pi-based agent development workspace";
    license = [ lib.licenses.mit lib.licenses.ofl ];
    mainProgram = "brabbler";
    platforms = lib.platforms.unix;
  };
}
