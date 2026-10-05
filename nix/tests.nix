{ pkgs, src, nodejs, modules }:
let
  inherit (pkgs) lib;
  # This is the original PUBLIC frontend selected for this pinned test PATH.
  # It may itself be a distribution wrapper: never resolve/unwrap it for exec.
  publicGit = "${pkgs.git}/bin/git";
  forwarder = pkgs.runCommandCC "pi-web-test-git-forwarder" { } ''
    mkdir -p "$out/bin" "$out/share/pi-web-test"
    "$CC" -std=c11 -O2 -Wall -Wextra -Werror \
      ${lib.escapeShellArg ''-DPI_WEB_TEST_GIT_TARGET="${publicGit}"''} \
      ${./test-git-forwarder.c} -o "$out/bin/git"
    printf '%s\n' ${lib.escapeShellArg publicGit} > "$out/share/pi-web-test/public-git"
  '';
  tools = [
    forwarder nodejs pkgs.git pkgs.bash pkgs.coreutils pkgs.findutils
    pkgs.gnugrep pkgs.gnused pkgs.diffutils pkgs.which pkgs.python3 pkgs.util-linux
  ];
  # There is only ONE scheduled check derivation. The shared runner owns the
  # bounded parallel native jobs and the drained SDK/latency-only barrier.
  # max-jobs/cores do not reserve this host against unrelated workloads.
  program = mode:
    let
      toolPath = lib.makeBinPath tools;
      body = pkgs.writeShellScript "pi-web-test-${mode}-body" ''
        set -euo pipefail
        root="$1"
        inventory_only="$2"
        shift 2
        umask 077
        phase=setup
        phase_start() { phase="$1"; printf 'PI_WEB_TEST_PHASE start %s\n' "$phase"; }
        phase_done() { printf 'PI_WEB_TEST_PHASE end %s status=0\n' "$phase"; phase=between-phases; }
        # Keep the original exec/signal path into the runner. This trap reports
        # only an early body/exec failure, never claims descendant settlement.
        trap 'status=$?; trap - EXIT; if [ "$status" -ne 0 ]; then printf "PI_WEB_TEST_PHASE failed %s status=%s retained=%s\n" "$phase" "$status" "$root" >&2 || :; fi; exit "$status"' EXIT
        phase_start export
        ${pkgs.python3}/bin/python3 -B ${./export-test-source.py} ${src} \
          --output "$root/source" --manifest "$root/source-input.json"
        phase_done
        # set -e requires export EXIT0; pathname existence alone is not success.
        phase_start verify-export
        ${pkgs.python3}/bin/python3 -B ${./export-test-source.py} ${src} \
          --output "$root/source" --manifest "$root/source-input.json" --verify-manifest
        phase_done
        if [ "$inventory_only" != 1 ]; then
          phase_start copy-modules
          cp -a --no-preserve=ownership --reflink=auto ${modules}/node_modules "$root/source/node_modules"
          chmod -R u+w "$root/source/node_modules"
          phase_done
        fi
        # The source export preserves original modes. Only this disposable
        # copy is made writable for genuine Next type generation.
        phase_start writable-source
        chmod -R u+w "$root/source"
        cd "$root/source"
        phase_done
        export PATH="${forwarder}/bin:$root/source/node_modules/.bin:${toolPath}"
        if [ "$inventory_only" != 1 ]; then
          phase_start exporter-contracts
          ${pkgs.python3}/bin/python3 -B nix/export-test-source.test.py
          phase_done
          phase_start typegen
          ${nodejs}/bin/node node_modules/next/dist/bin/next typegen
          phase_done
          phase_start typecheck
          ${nodejs}/bin/node node_modules/typescript/bin/tsc --noEmit --incremental false
          phase_done
          phase_start lint
          ${nodejs}/bin/node node_modules/eslint/bin/eslint.js .
          phase_done
        fi
        # Scheduler args, NOT appended npm/Node flags. Every child Node
        # option must precede every test path (see the runner's contracts).
        # Runner owns its bounded final diagnostics; do not duplicate TAP parsing.
        phase_start runner
        exec ${nodejs}/bin/node nix/test-runner.mjs \
          --root "$root/source" --git-bin ${forwarder}/bin \
          --tool-path "$root/source/node_modules/.bin:${toolPath}" \
          --artifacts "$root/artifacts" "$@"
      '';
    in
    pkgs.writeShellScript "pi-web-test-${mode}" ''
      set -euo pipefail
      jobs=8
      jobs_seen=0
      inventory_only=0
      help=0
      selection=()
      ${if mode == "offline" then ''
        refuse() { echo 'Allowed: --jobs <1..32>, repeatable --file <relative-discovered.test.mjs>, --inventory-only, --help' >&2; exit 2; }
        while [ "$#" -gt 0 ]; do
          case "$1" in
            --jobs)
              [ "$#" -ge 2 ] && [ "$jobs_seen" = 0 ] || refuse
              case "$2" in [1-9]|[12][0-9]|3[0-2]) jobs="$2" ;; *) refuse ;; esac
              jobs_seen=1
              shift 2
              ;;
            --file)
              [ "$#" -ge 2 ] || refuse
              case "$2" in
                app/*.test.mjs|components/*.test.mjs|hooks/*.test.mjs|lib/*.test.mjs|public/*.test.mjs) ;;
                *) refuse ;;
              esac
              case "/$2/" in
                */../*|*/./*|*//*|*\\*|*$'\n'*|*$'\r'*) refuse ;;
              esac
              for prior in "''${selection[@]}"; do
                [ "$prior" != "$2" ] || refuse
              done
              # Exact discovery membership is checked by the shared runner.
              # Never expand a glob, evaluate a string or accept tool bindings.
              selection+=(--file "$2")
              shift 2
              ;;
            --inventory-only)
              [ "$inventory_only" = 0 ] || refuse
              inventory_only=1
              shift
              ;;
            --help)
              [ "$help" = 0 ] || refuse
              help=1
              shift
              ;;
            *) refuse ;;
          esac
        done
        if [ "$help" = 1 ]; then
          printf '%s\n' \
            'test-offline [--jobs <1..32>] [--file <relative-discovered.test.mjs> ...] [--inventory-only] [--help]' \
            'Default desired jobs: 8; actual CPU/quota/allocation/memory admission may reduce it.' \
            'Root, Git, tools and artifact paths are fixed by this app; overrides/unknown options refuse.' \
            'Selected-file success is NOT full-suite acceptance. Inventory-only runs no checks/tests.'
          exit 0
        fi
        if [ "$inventory_only" = 1 ]; then
          echo 'Inventory only: no static checks or test execution; NOT acceptance.'
        elif [ "''${#selection[@]}" -gt 0 ]; then
          echo 'Selected-file run only: NOT full-suite acceptance.'
        fi
      '' else ''
        # The derivation check is ALWAYS full/default and argument-free.
        if [ "$#" -ne 0 ]; then
          echo 'This bounded ${mode} entrypoint accepts no arguments.' >&2
          exit 2
        fi
      ''}
      runner_args=(--jobs "$jobs" "''${selection[@]}")
      if [ "$inventory_only" = 1 ]; then runner_args+=(--inventory-only); fi
      # An app has no invented Nix allocation. Checks require the original
      # builder's positive allocation; supplied app allocations remain binding.
      core_env=()
      if [ "''${NIX_BUILD_CORES+x}" = x ]; then
        cores="$NIX_BUILD_CORES"
        if [[ ! "$cores" =~ ^[1-9][0-9]*$ ]] || \
          [ "''${#cores}" -gt 16 ] || [ "$cores" -gt 9007199254740991 ]; then
          echo 'NIX_BUILD_CORES must be a canonical positive safe integer' >&2
          exit 2
        fi
        core_env+=("NIX_BUILD_CORES=$cores")
      ${if mode == "check" then ''
      else
        echo 'Missing original builder NIX_BUILD_CORES allocation' >&2
        exit 2
      '' else ""}
      fi
      umask 077
      ${if mode == "check" then ''
        # Private builder-to-check channel, never a public app/runner option.
        # The builder retains this SAME root for copying; no stdout discovery.
        root="''${PI_WEB_NIX_CHECK_ROOT:?missing internal check root}"
        case "$root" in /*) ;; *) exit 2 ;; esac
        if [ ! -d "$root" ] || [ -L "$root" ] || \
          [ "$(${pkgs.coreutils}/bin/stat -c '%u:%a' -- "$root")" != "$(${pkgs.coreutils}/bin/id -u):700" ]; then
          echo 'Internal check root must be an owned private directory' >&2
          exit 2
        fi
      '' else ''
        root=$(${pkgs.coreutils}/bin/mktemp -d /tmp/pi-web-test-${mode}.XXXXXXXX)
      ''}
      for dir in home config cache data state runtime agent tmp artifacts; do
        ${pkgs.coreutils}/bin/mkdir -m 700 "$root/$dir"
      done
      echo "Private ${mode} test root (retained for settlement/audit): $root"
      # Never inherit live HOME/credentials/proxies/NODE_OPTIONS or user bus.
      # No automatic recursive cleanup of potentially unsettled host fixtures.
      exec ${pkgs.coreutils}/bin/env -i \
        PATH=${lib.escapeShellArg toolPath} \
        HOME="$root/home" XDG_CONFIG_HOME="$root/config" XDG_CACHE_HOME="$root/cache" \
        XDG_DATA_HOME="$root/data" XDG_STATE_HOME="$root/state" XDG_RUNTIME_DIR="$root/runtime" \
        XDG_CONFIG_DIRS="$root/config" XDG_DATA_DIRS="$root/data" \
        PI_CODING_AGENT_DIR="$root/agent" TMPDIR="$root/tmp" TMP="$root/tmp" TEMP="$root/tmp" \
        LANG=C.UTF-8 LC_ALL=C.UTF-8 SHELL=${pkgs.bash}/bin/bash \
        PI_WEB_TEST_SHELL=${pkgs.bash}/bin/bash \
        PI_OFFLINE=1 JITI_FS_CACHE=0 NEXT_TELEMETRY_DISABLED=1 \
        GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_GLOBAL=/dev/null \
        GIT_TERMINAL_PROMPT=0 "''${core_env[@]}" \
        ${body} "$root" "$inventory_only" "''${runner_args[@]}"
    '';
  offlineProgram = program "offline";
  offlineCheckProgram = program "check";
in
{
  offline = pkgs.runCommand "pi-web-offline-checks" { } ''
    set -euo pipefail
    umask 077
    # Keep failures in the ACTUAL build tree for --keep-failed, not /tmp.
    # Short private root also bounds socket-path growth. Never delete it here.
    build_top=$(cd "''${NIX_BUILD_TOP:-''${TMPDIR:?Nix build directory required}}" && pwd -P)
    check_root=$(mktemp -d "$build_top/pw.XXXXXX")
    # Capture BOTH statuses immediately; a successful tee cannot repair a
    # failed body. This does not disable errexit in the separate body script.
    set +e
    PI_WEB_NIX_CHECK_ROOT="$check_root" ${offlineCheckProgram} 2>&1 | tee "$check_root/driver.log"
    pipeline_status=("''${PIPESTATUS[@]}")
    set -e
    body_status="''${pipeline_status[0]}"
    tee_status="''${pipeline_status[1]}"
    final_status="$body_status"
    if [ "$final_status" -eq 0 ]; then final_status="$tee_status"; fi
    # This is pipeline status, NOT a success/settlement receipt. Preserve the
    # original nonzero result even if the final diagnostic channel also fails.
    if ! printf 'PI_WEB_TEST_CHECK pipeline body=%s tee=%s status=%s retained=%s artifacts=%s\n' \
      "$body_status" "$tee_status" "$final_status" "$check_root" "$check_root/artifacts" >&2; then
      if [ "$final_status" -eq 0 ]; then final_status=1; fi
    fi
    if [ "$final_status" -ne 0 ]; then exit "$final_status"; fi
    # Natural success only. Copy this exact bound parent's complete run tree:
    # per-file TAP/stderr, events, inventory and summary, without a run-* glob.
    mkdir -p "$out"
    cp -a "$check_root/artifacts" "$out/artifacts"
    cp "$check_root/source-input.json" "$check_root/driver.log" "$out/"
    printf '%s\n' \
      'Offline check passed. Stored/cached artifacts are diagnostics, NOT fresh native/OS authority receipts.' \
      'driver.log includes exporter/static preparation stdout+stderr; original output is also in the Nix build log.' \
      > "$out/result"
  '';
  apps = {
    test-offline = { type = "app"; program = toString offlineProgram; };
    # Browser/terminal/systemd acceptance is separately authorized/manual.
    # No new host adapters until bus access and nested cleanup are reviewed.
  };
}
