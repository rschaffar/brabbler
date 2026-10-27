{ pkgs, src, typingSrc ? src, nodejs, modules, testSupport }:
let
  # Separate input identities: editing a registered JS test invalidates lint,
  # not the unchanged TS graph. Both checks remain mandatory for every core run.
  check = name: source: commands: pkgs.runCommand "brabbler-${name}" {
    nativeBuildInputs = [ nodejs ];
  } ''
    set -euo pipefail
    umask 077
    export HOME="$TMPDIR/home" NEXT_TELEMETRY_DISABLED=1
    export XDG_CONFIG_HOME="$HOME/config" XDG_CACHE_HOME="$HOME/cache"
    mkdir -p "$HOME" "$out"
    cp -R ${source} source
    chmod -R u+w source
    cd source
    ln -s ${modules}/node_modules node_modules
    mkdir -p lib/testing
    ln -s ${testSupport}/node_modules lib/testing/node_modules
    {
      ${commands}
    } 2>&1 | tee "$out/checks.log"
  '';
  types = check "types" typingSrc ''
    printf 'BRABBLER_STATIC_PHASE start typegen\n'
    ${nodejs}/bin/node node_modules/next/dist/bin/next typegen
    printf 'BRABBLER_STATIC_PHASE end typegen\nBRABBLER_STATIC_PHASE start typecheck\n'
    ${nodejs}/bin/node node_modules/typescript/bin/tsc --noEmit --incremental false
    printf 'BRABBLER_STATIC_PHASE end typecheck\n'
  '';
  lint = check "lint" src ''
    printf 'BRABBLER_STATIC_PHASE start lint\n'
    ${nodejs}/bin/node node_modules/eslint/bin/eslint.js .
    printf 'BRABBLER_STATIC_PHASE end lint\n'
  '';
  metadata = pkgs.writeText "brabbler-static-inputs.json" (builtins.toJSON {
    version = 1;
    kind = "brabbler-static-checks";
    source = toString src;
    typeSource = toString typingSrc;
    typeEvidence = toString types;
    lintEvidence = toString lint;
    runtimeVersion = nodejs.version;
    dependencies = toString modules;
    testDependencies = toString testSupport;
    checks = [ "typegen" "typecheck" "lint" ];
    freshness = "Declared-input Nix evidence; dependency realization may reuse a cached result";
  });
in
pkgs.runCommand "brabbler-static-checks" { } ''
  mkdir -p "$out"
  cat ${types}/checks.log ${lint}/checks.log > "$out/checks.log"
  cp ${metadata} "$out/inputs.json"
''
