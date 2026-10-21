# Every whole group has its own ordinary Nix sandbox, not a root/systemd container.
{ pkgs, package, modules, src, flakeSource }:
let
  inherit (pkgs) lib;
  groups = builtins.fromJSON (builtins.readFile ./e2e-groups.json);
  tools = [ pkgs.nodejs_24 pkgs.git pkgs.openssh pkgs.bash pkgs.coreutils pkgs.findutils
    pkgs.gnugrep pkgs.gnused pkgs.diffutils pkgs.which pkgs.curl pkgs.util-linux
    pkgs.gnutar pkgs.gzip pkgs.chromium ];
  fontconfig = pkgs.makeFontsConf {
    fontDirectories = [ pkgs.dejavu_fonts pkgs.liberation_ttf pkgs.unifont pkgs.noto-fonts-color-emoji ];
    impureFontDirectories = [ ];
    includes = [ "${pkgs.fontconfig.out}/etc/fonts/conf.d" ];
  };
  metadata = {
    version = 1;
    backend = "nix-build-sandbox";
    source = toString src;
    flakeSource = toString flakeSource;
    package = "${package}/lib/node_modules/@agegr/pi-web";
    launcher = lib.getExe package;
    node = "${pkgs.nodejs_24}/bin/node";
    chromium = "${pkgs.chromium}/bin/chromium";
    shell = "${pkgs.bash}/bin/bash";
    tar = "${pkgs.gnutar}/bin/tar";
    fontconfig = toString fontconfig;
    toolPath = lib.makeBinPath tools;
  };
  support = pkgs.runCommand "pi-web-browser-support" { } ''
    mkdir -p "$out"
    cp -R ${src}/. "$out/"
    ln -s ${modules}/node_modules "$out/node_modules"
    printf '%s\n' ${lib.escapeShellArg (builtins.toJSON metadata)} > "$out/browser.json"
  '';
  mkCapsule = { group, runId ? "", sourceDigest ? "", hostNamespaces ? { } }:
    assert builtins.hasAttr group groups;
    let configuration = pkgs.writeText "pi-web-browser-${group}-selection.json"
      (builtins.toJSON { inherit group runId sourceDigest hostNamespaces; });
    in pkgs.runCommand "pi-web-browser-${group}-diagnostics" {
      inherit runId;
      preferLocalBuild = true;
      allowSubstitutes = runId == "";
    } ''
      set -euo pipefail
      umask 077
      build_top=$(cd "''${NIX_BUILD_TOP:?Nix build directory required}" && pwd -P)
      root=$(mktemp -d "$build_top/pwb.XXXXXX")
      mkdir -m 700 "$out"
      # The runner, browser, providers and application all execute INSIDE this build.
      # No daemon socket, user bus, ambient credentials or host HOME are forwarded.
      ${pkgs.coreutils}/bin/env -i PATH=${lib.escapeShellArg (lib.makeBinPath tools)} \
        LANG=C.UTF-8 LC_ALL=C.UTF-8 \
        ${pkgs.nodejs_24}/bin/node ${support}/nix/browser-capsule.mjs \
        ${support}/browser.json ${configuration} "$out" "$root"
    '';
  checked = lib.mapAttrs (group: _: let capsule = mkCapsule { inherit group; };
    in pkgs.runCommand "pi-web-browser-${group}-check" { } ''
      ${pkgs.nodejs_24}/bin/node ${support}/nix/browser-plan.mjs check \
        ${support}/browser.json ${lib.escapeShellArg group} ${capsule}
      ln -s ${capsule} "$out"
    '') groups;
  check = pkgs.runCommand "pi-web-browser-acceptance" { } ''
    mkdir -p "$out"
    ${lib.concatStringsSep "\n" (lib.mapAttrsToList (group: result:
      "ln -s ${result} \"$out/${group}\"") checked)}
    printf '%s\n' 'All browser/terminal group verdicts passed; cached declared-input evidence, not a fresh run.' > "$out/result"
  '';
in { inherit support mkCapsule check; }
