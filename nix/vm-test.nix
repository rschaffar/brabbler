# Fixed genuine deployment proof; full browser/terminal acceptance is separate.
{ pkgs, package, src, modules, home-manager, homeManagerModule, workers ? 1, ... }:
assert workers == 1;
let
  inherit (pkgs) lib;
  # Test source only; reuse the exact immutable modules, never copy/install them.
  migrationSource = pkgs.runCommand "brabbler-migration-acceptance-source" { } ''
    mkdir -p "$out"
    cp -r ${src}/. "$out/"
    chmod u+w "$out"
    ln -s ${modules}/node_modules "$out/node_modules"
  '';
  migrationUnit = "brabbler-migration-acceptance.service";
  migrationProgram = pkgs.writeShellScript "brabbler-migration-acceptance" ''
    exec ${pkgs.coreutils}/bin/env -i \
      PATH=${lib.makeBinPath [ pkgs.nodejs_24 pkgs.python3 pkgs.git pkgs.acl pkgs.bash pkgs.coreutils pkgs.util-linux ]} \
      HOME=/home/t0/migration/home XDG_CONFIG_HOME=/home/t0/migration/config \
      XDG_CACHE_HOME=/home/t0/migration/cache XDG_DATA_HOME=/home/t0/migration/data \
      XDG_STATE_HOME=/home/t0/migration/state XDG_RUNTIME_DIR=/home/t0/migration/runtime \
      XDG_CONFIG_DIRS=/home/t0/migration/config XDG_DATA_DIRS=/home/t0/migration/data \
      PI_CODING_AGENT_DIR=/home/t0/migration/agent \
      TMPDIR=/home/t0/migration/tmp TMP=/home/t0/migration/tmp TEMP=/home/t0/migration/tmp \
      LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC SHELL=${pkgs.bash}/bin/bash \
      PI_OFFLINE=1 JITI_FS_CACHE=0 NEXT_TELEMETRY_DISABLED=1 \
      GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 \
      ${pkgs.nodejs_24}/bin/node --experimental-strip-types --test --test-concurrency=1 \
      --test-reporter=tap tools/migrations/git-operation-reviews/vm-acceptance.fixture.mjs
  '';
  # Builtins-only service helpers; TAP validators are imported only for migration evidence.
  support = pkgs.runCommand "brabbler-service-support" { } ''
    mkdir -p "$out"
    cp ${./service-plan.mjs} "$out/service-plan.mjs"
    cp ${./service-smoke.mjs} "$out/service-smoke.mjs"
    cp ${./auth-setup.fixture.mjs} "$out/auth-setup.fixture.mjs"
    cp ${./vm-evidence.mjs} "$out/vm-evidence.mjs"
    cp ${./test-runner.mjs} "$out/test-runner.mjs"
    cp ${./resources.mjs} "$out/resources.mjs"
    cp ${./migration-cases.json} "$out/migration-cases.json"
  '';
  controller = pkgs.writeShellApplication {
    name = "brabbler-deployment-control";
    runtimeInputs = [ pkgs.systemd ];
    text = ''
      if [[ ! -r /etc/brabbler-acceptance-guest ]] || \
         [[ "$(< /etc/brabbler-acceptance-guest)" != brabbler-nixos-acceptance-v1 ]] || \
         [[ "$(${pkgs.coreutils}/bin/id -u)" != 1000 ]]; then
        echo 'Deployment service control requires its disposable guest user' >&2
        exit 1
      fi
      export XDG_RUNTIME_DIR=/run/user/1000
      export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
      case "''${1:-}" in
        # No start action: only HM's generated default.target link starts it.
        restart) [[ "$#" == 1 ]]; systemctl --user restart brabbler.service ;;
        stop) [[ "$#" == 1 ]]; systemctl --user stop brabbler.service ;;
        status) [[ "$#" == 1 ]]; systemctl --user show brabbler.service \
          -p ActiveState -p SubState -p InvocationID -p MainPID -p NRestarts \
          -p ControlGroup -p Result -p UMask -p WorkingDirectory -p FragmentPath -p ExecStart ;;
        logs) [[ "$#" == 1 ]]; journalctl --user -b -u brabbler.service --no-pager -o short-iso ;;
        *) echo 'Allowed: restart, stop, status, logs' >&2; exit 2 ;;
      esac
    '';
  };
  resources = { workers = 1; cpus = 1; memoryMiB = 1536; diskMiB = 2048; };
  registry = pkgs.writeText "brabbler-service.json" (builtins.toJSON {
    version = 1;
    kind = "brabbler-service-registry";
    package = "${package}/lib/node_modules/brabbler";
    launcher = lib.getExe package;
    shell = "${pkgs.bash}/bin/bash";
    inherit resources;
    migration = {
      source = "${migrationSource}";
      modules = "${modules}/node_modules";
      node = "${pkgs.nodejs_24}/bin/node";
      python = "${pkgs.python3}/bin/python3";
      git = "${pkgs.git}/bin/git";
      acl = "${pkgs.acl}/bin/setfacl";
      unit = migrationUnit;
      root = "/home/t0/migration";
      fixture = "tools/migrations/git-operation-reviews/vm-acceptance.fixture.mjs";
      timeoutSeconds = 240;
    };
    service = {
      user = "t0"; uid = 1000; home = "/home/t0"; port = 30141; unit = "brabbler.service";
      envFile = "/home/t0/service.env"; fixture = "/home/t0/fixtures";
      agentDir = "/home/t0/fixtures/agent"; evidence = "/home/t0/evidence";
      controller = lib.getExe controller;
    };
  });
  acceptance = pkgs.testers.runNixOSTest {
    name = "brabbler-service-deployment";
    globalTimeout = 600;
    qemu.forceAccel = true;
    nodes.machine = { config, modulesPath, ... }:
      let
        storeRoots = [ config.system.build.toplevel support migrationSource ];
        registration = import "${modulesPath}/../lib/store-registration-info.nix" {
          hostPkgs = config.virtualisation.host.pkgs;
          rootPaths = storeRoots;
        };
      in {
      imports = [ home-manager.nixosModules.home-manager "${modulesPath}/image/repart.nix" ];
      image.repart = {
        enable = true;
        name = "brabbler-guest-store";
        version = null;
        compression.enable = false;
        partitions."10-store" = {
          storePaths = storeRoots;
          contents."/.brabbler-registration".source = "${registration.regInfo}/registration";
          nixStorePrefix = "/";
          repartConfig = { Type = "linux-generic"; Label = "brabbler-store"; Format = "erofs"; Minimize = "best"; };
        };
      };
      virtualisation = {
        # Initial execution target, not a measured minimum or a build budget.
        memorySize = resources.memoryMiB;
        cores = resources.cpus;
        diskSize = resources.diskMiB;
        mountHostNixStore = false;
        useNixStoreImage = false;
        writableStore = true;
        qemu.drives = [{
          name = "closure-store";
          file = "${config.system.build.image}/${config.image.fileName}";
          driveExtraOpts = { format = "raw"; readonly = "on"; };
        }];
        fileSystems."/nix/store".overlay = {
          lowerdir = [ "/nix/.ro-store" ];
          upperdir = "/nix/.rw-store/upper";
          workdir = "/nix/.rw-store/work";
        };
        fileSystems."/nix/.ro-store" = {
          device = "/dev/disk/by-partlabel/brabbler-store";
          fsType = "erofs";
          neededForBoot = true;
          options = [ "ro" ];
        };
        restrictNetwork = true;
        vlans = [ ];
        forwardPorts = [ ];
      };
      boot.kernelParams = [ "regInfo=/nix/.ro-store/.brabbler-registration" ];
      environment.etc."brabbler-acceptance-guest".text = "brabbler-nixos-acceptance-v1\n";
      environment.etc."brabbler-service.json".source = registry;
      users.users.t0 = { isNormalUser = true; uid = 1000; home = "/home/t0"; homeMode = "0700"; };
      home-manager = {
        useGlobalPkgs = true;
        useUserPackages = true;
        users.t0 = {
          imports = [ homeManagerModule ];
          home.stateVersion = "24.11";
          services.brabbler = {
            enable = true;
            requireAuth = true;
            inherit package;
            port = 30141;
            agentDir = "%h/fixtures/agent";
            environmentFile = "/home/t0/service.env";
            environment = {
              PI_OFFLINE = "1"; NODE_ENV = "production";
              NEXT_TELEMETRY_DISABLED = "1"; JITI_FS_CACHE = "0";
              SHELL = "${pkgs.bash}/bin/bash";
              BRABBLER_SERVICE_UNIT = "unit-value";
              BRABBLER_SERVICE_OVERRIDE = "unit-value-must-be-overridden";
              BRABBLER_SERVICE_RUNTIME = "%t";
            };
          };
          # Deliberately no replacement ExecStart or test-only service policy.
        };
      };
      # Separate test-only unit; never changes the production Home Manager unit.
      # Root's manager opens the private evidence files before dropping to t0.
      systemd.services.brabbler-migration-acceptance = {
        serviceConfig = {
          Type = "oneshot";
          User = "t0";
          Group = "users";
          UMask = "0077";
          WorkingDirectory = "${migrationSource}";
          ExecStart = migrationProgram;
          RemainAfterExit = true;
          TimeoutStartSec = 240;
          KillMode = "control-group";
          StandardOutput = "append:/var/lib/brabbler-evidence/migration.tap";
          StandardError = "append:/var/lib/brabbler-evidence/migration.stderr.log";
        };
      };
      environment.systemPackages = [
        pkgs.nodejs_24 pkgs.bash pkgs.coreutils pkgs.util-linux pkgs.gnutar pkgs.gzip controller
      ];
      systemd.tmpfiles.rules = [
        "d /home/t0/fixtures 0700 t0 users -"
        "d /home/t0/fixtures/agent 0700 t0 users -"
        "f /home/t0/service.env 0600 t0 users -"
        "d /home/t0/evidence 0700 t0 users -"
        "d /var/lib/brabbler-evidence 0700 root root -"
        "f /var/lib/brabbler-evidence/migration.tap 0600 root root -"
        "f /var/lib/brabbler-evidence/migration.stderr.log 0600 root root -"
        "d /home/t0/migration 0700 t0 users -"
      ] ++ map (name: "d /home/t0/migration/${name} 0700 t0 users -")
        [ "home" "config" "cache" "data" "state" "runtime" "agent" "tmp" ];
    };
    testScript = builtins.replaceStrings
      [ "@support@" "@registry@" "@node@" ]
      [ "${support}" "${registry}" "${pkgs.nodejs_24}/bin/node" ]
      (builtins.readFile ./vm-test.py);
  };
in acceptance // {
  driver = pkgs.symlinkJoin {
    name = "brabbler-service-driver";
    paths = [ acceptance.driver ];
    postBuild = ''ln -s ${registry} "$out/service.json"'';
  };
}
