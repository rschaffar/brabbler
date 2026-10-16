{ pkgs, package, modules, src, home-manager, homeManagerModule, workers ? 2 }:
assert builtins.isInt workers && workers >= 1 && workers <= 4;
let
  inherit (pkgs) lib;
  support = pkgs.runCommand "pi-web-test-support" { } ''
    mkdir -p "$out"
    cp -R ${src}/. "$out/"
    ln -s ${modules}/node_modules "$out/node_modules"
  '';
  identities = builtins.genList (i: {
    id = "l${toString i}";
    user = "t${toString i}";
    uid = 1000 + i;
    home = "/home/t${toString i}";
    port = 30141 + i;
    envFile = "/home/t${toString i}/service.env";
    unit = "pi-web.service";
  }) workers;
  control = lane: pkgs.writeShellApplication {
    name = "pi-web-test-service-${lane.id}";
    runtimeInputs = [ pkgs.systemd ];
    text = ''
      # Immutable controller: exactly one guest UID, bus and real HM unit.
      if [[ ! -r /etc/pi-web-acceptance-guest ]] || \
         [[ "$(< /etc/pi-web-acceptance-guest)" != pi-web-nixos-acceptance-v1 ]] || \
         [[ "$(${pkgs.coreutils}/bin/id -u)" != ${toString lane.uid} ]]; then
        echo 'Acceptance service control requires its disposable guest user' >&2
        exit 1
      fi
      export XDG_RUNTIME_DIR=/run/user/${toString lane.uid}
      export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${toString lane.uid}/bus
      case "''${1:-}" in
        start) [[ "$#" == 1 ]]; systemctl --user reset-failed pi-web.service; systemctl --user start pi-web.service ;;
        stop) [[ "$#" == 1 ]]; systemctl --user stop pi-web.service ;;
        status) [[ "$#" == 1 ]]; systemctl --user show pi-web.service \
          -p ActiveState -p SubState -p InvocationID -p MainPID -p NRestarts -p ControlGroup -p Result ;;
        logs)
          if [[ "$#" == 2 && "$2" =~ ^[a-f0-9]{32}$ ]]; then
            journalctl --user -b -u pi-web.service --no-pager -o short-iso "_SYSTEMD_INVOCATION_ID=$2"
          elif [[ "$#" == 1 ]]; then
            journalctl --user -b -u pi-web.service --no-pager -o short-iso
          else exit 2; fi ;;
        *) echo 'Allowed: start, stop, status, logs [generation]' >&2; exit 2 ;;
      esac
    '';
  };
  controls = map control identities;
  lanes = lib.imap0 (i: lane: lane // { controller = lib.getExe (builtins.elemAt controls i); }) identities;
  resources = { inherit workers; cpus = workers * 2; memoryMiB = workers * 4096; };
  registry = pkgs.writeText "pi-web-acceptance-lanes.json" (builtins.toJSON {
    version = 1;
    package = "${package}/lib/node_modules/@agegr/pi-web";
    inherit lanes resources;
  });
  acceptance = pkgs.testers.runNixOSTest {
    name = "pi-web-acceptance-${toString workers}-lanes";
    globalTimeout = 3600;
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
        memorySize = resources.memoryMiB;
        cores = resources.cpus;
        diskSize = 16384; # Sparse state: concurrent traces and failure archives.
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
      environment.etc."pi-web-acceptance-lanes.json".source = registry;
      users.users = lib.listToAttrs (map (lane: lib.nameValuePair lane.user {
        isNormalUser = true; inherit (lane) uid home; homeMode = "0700";
      }) lanes);
      home-manager = {
        useGlobalPkgs = true;
        useUserPackages = true;
        users = lib.listToAttrs (map (lane: lib.nameValuePair lane.user {
          imports = [ homeManagerModule ];
          home.stateVersion = "24.11";
          services.pi-web = {
            enable = true;
            inherit package;
            inherit (lane) port;
            agentDir = "%h/fixtures/initial";
            environmentFile = lane.envFile;
            environment = {
              PI_OFFLINE = "1"; NODE_ENV = "production";
              NEXT_TELEMETRY_DISABLED = "1"; JITI_FS_CACHE = "0";
              SHELL = "${pkgs.bash}/bin/bash";
            };
          };
          systemd.user.services.pi-web.Service.TimeoutStopSec = 10;
        }) lanes);
      };
      environment.systemPackages = [
        pkgs.nodejs_24 pkgs.git pkgs.bash pkgs.coreutils pkgs.curl
        pkgs.chromium pkgs.util-linux
      ] ++ controls;
      # Users cannot read each other's fixtures, service configuration or traces.
      systemd.tmpfiles.rules = lib.concatMap (lane: [
        "d ${lane.home}/fixtures 0700 ${lane.user} users -"
        "d ${lane.home}/fixtures/initial 0700 ${lane.user} users -"
        "f ${lane.envFile} 0600 ${lane.user} users -"
        "d ${lane.home}/evidence 0700 ${lane.user} users -"
      ]) lanes ++ [ "d /var/lib/pi-web-evidence 0700 root root -" ];
    };
    testScript = builtins.replaceStrings
      [ "@support@" "@registry@" "@node@" "@chromium@" "@shell@" ]
      [ "${support}" "${registry}" "${pkgs.nodejs_24}/bin/node"
        "${pkgs.chromium}/bin/chromium" "${pkgs.bash}/bin/bash" ]
      (builtins.readFile ./vm-test.py);
  };
in acceptance // {
  # The regular driver, with its immutable registry available to the fresh
  # wrapper. No interactive driver or different test definition.
  driver = pkgs.symlinkJoin {
    name = "pi-web-acceptance-driver-${toString workers}-lanes";
    paths = [ acceptance.driver ];
    postBuild = ''ln -s ${registry} "$out/lanes.json"'';
  };
}
