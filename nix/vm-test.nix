# Fixed genuine deployment proof; full browser/terminal acceptance is separate.
{ pkgs, package, home-manager, homeManagerModule, workers ? 1, ... }:
assert workers == 1;
let
  inherit (pkgs) lib;
  # Builtins-only helpers, not the browser source tree or another modules copy.
  support = pkgs.runCommand "pi-web-service-support" { } ''
    mkdir -p "$out"
    cp ${./service-plan.mjs} "$out/service-plan.mjs"
    cp ${./service-smoke.mjs} "$out/service-smoke.mjs"
    cp ${./vm-evidence.mjs} "$out/vm-evidence.mjs"
  '';
  controller = pkgs.writeShellApplication {
    name = "pi-web-deployment-control";
    runtimeInputs = [ pkgs.systemd ];
    text = ''
      if [[ ! -r /etc/pi-web-acceptance-guest ]] || \
         [[ "$(< /etc/pi-web-acceptance-guest)" != pi-web-nixos-acceptance-v1 ]] || \
         [[ "$(${pkgs.coreutils}/bin/id -u)" != 1000 ]]; then
        echo 'Deployment service control requires its disposable guest user' >&2
        exit 1
      fi
      export XDG_RUNTIME_DIR=/run/user/1000
      export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
      case "''${1:-}" in
        # No start action: only HM's generated default.target link starts it.
        restart) [[ "$#" == 1 ]]; systemctl --user restart pi-web.service ;;
        stop) [[ "$#" == 1 ]]; systemctl --user stop pi-web.service ;;
        status) [[ "$#" == 1 ]]; systemctl --user show pi-web.service \
          -p ActiveState -p SubState -p InvocationID -p MainPID -p NRestarts \
          -p ControlGroup -p Result -p UMask -p WorkingDirectory -p FragmentPath -p ExecStart ;;
        logs) [[ "$#" == 1 ]]; journalctl --user -b -u pi-web.service --no-pager -o short-iso ;;
        *) echo 'Allowed: restart, stop, status, logs' >&2; exit 2 ;;
      esac
    '';
  };
  resources = { workers = 1; cpus = 1; memoryMiB = 1536; diskMiB = 2048; };
  registry = pkgs.writeText "pi-web-service.json" (builtins.toJSON {
    version = 1;
    kind = "pi-web-service-registry";
    package = "${package}/lib/node_modules/@agegr/pi-web";
    launcher = lib.getExe package;
    shell = "${pkgs.bash}/bin/bash";
    inherit resources;
    service = {
      user = "t0"; uid = 1000; home = "/home/t0"; port = 30141; unit = "pi-web.service";
      envFile = "/home/t0/service.env"; fixture = "/home/t0/fixtures";
      agentDir = "/home/t0/fixtures/agent"; evidence = "/home/t0/evidence";
      controller = lib.getExe controller;
    };
  });
  acceptance = pkgs.testers.runNixOSTest {
    name = "pi-web-service-deployment";
    globalTimeout = 600;
    qemu.forceAccel = true;
    nodes.machine = { config, modulesPath, ... }:
      let
        storeRoots = [ config.system.build.toplevel support ];
        registration = import "${modulesPath}/../lib/store-registration-info.nix" {
          hostPkgs = config.virtualisation.host.pkgs;
          rootPaths = storeRoots;
        };
      in {
      imports = [ home-manager.nixosModules.home-manager "${modulesPath}/image/repart.nix" ];
      image.repart = {
        enable = true;
        name = "pi-web-guest-store";
        version = null;
        compression.enable = false;
        partitions."10-store" = {
          storePaths = storeRoots;
          contents."/.pi-web-registration".source = "${registration.regInfo}/registration";
          nixStorePrefix = "/";
          repartConfig = { Type = "linux-generic"; Label = "pi-web-store"; Format = "erofs"; Minimize = "best"; };
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
          device = "/dev/disk/by-partlabel/pi-web-store";
          fsType = "erofs";
          neededForBoot = true;
          options = [ "ro" ];
        };
        restrictNetwork = true;
        vlans = [ ];
        forwardPorts = [ ];
      };
      boot.kernelParams = [ "regInfo=/nix/.ro-store/.pi-web-registration" ];
      environment.etc."pi-web-acceptance-guest".text = "pi-web-nixos-acceptance-v1\n";
      environment.etc."pi-web-service.json".source = registry;
      users.users.t0 = { isNormalUser = true; uid = 1000; home = "/home/t0"; homeMode = "0700"; };
      home-manager = {
        useGlobalPkgs = true;
        useUserPackages = true;
        users.t0 = {
          imports = [ homeManagerModule ];
          home.stateVersion = "24.11";
          services.pi-web = {
            enable = true;
            inherit package;
            port = 30141;
            agentDir = "%h/fixtures/agent";
            environmentFile = "/home/t0/service.env";
            environment = {
              PI_OFFLINE = "1"; NODE_ENV = "production";
              NEXT_TELEMETRY_DISABLED = "1"; JITI_FS_CACHE = "0";
              SHELL = "${pkgs.bash}/bin/bash";
              PI_WEB_SERVICE_UNIT = "unit-value";
              PI_WEB_SERVICE_OVERRIDE = "unit-value-must-be-overridden";
              PI_WEB_SERVICE_RUNTIME = "%t";
            };
          };
          # Deliberately no replacement ExecStart or test-only service policy.
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
        "d /var/lib/pi-web-evidence 0700 root root -"
      ];
    };
    testScript = builtins.replaceStrings
      [ "@support@" "@registry@" "@node@" ]
      [ "${support}" "${registry}" "${pkgs.nodejs_24}/bin/node" ]
      (builtins.readFile ./vm-test.py);
  };
in acceptance // {
  driver = pkgs.symlinkJoin {
    name = "pi-web-service-driver";
    paths = [ acceptance.driver ];
    postBuild = ''ln -s ${registry} "$out/service.json"'';
  };
}
