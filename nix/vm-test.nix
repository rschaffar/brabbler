{ pkgs, package, modules, src, home-manager, homeManagerModule }:
let
  inherit (pkgs) lib;
  support = pkgs.runCommand "pi-web-test-support" { } ''
    mkdir -p "$out"
    cp -R ${src}/. "$out/"
    ln -s ${modules}/node_modules "$out/node_modules"
  '';
  control = pkgs.writeShellApplication {
    name = "pi-web-test-service";
    runtimeInputs = [ pkgs.systemd ];
    text = ''
      # This executable exists only in the test guest and names exactly one
      # non-root user's unit. A control-command process is not the service.
      # Refuse on the host even if it also has UID 1000 and pi-web.service.
      if [[ ! -r /etc/pi-web-acceptance-guest ]] || \
         [[ "$(< /etc/pi-web-acceptance-guest)" != pi-web-nixos-acceptance-v1 ]] || \
         [[ "$(${pkgs.coreutils}/bin/id -u)" != 1000 ]]; then
        echo 'Acceptance service control requires the disposable guest user' >&2
        exit 1
      fi
      export XDG_RUNTIME_DIR=/run/user/1000
      export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
      case "''${1:-}" in
        start) systemctl --user reset-failed pi-web.service; systemctl --user start pi-web.service ;;
        stop) systemctl --user stop pi-web.service ;;
        status) systemctl --user show pi-web.service \
          -p ActiveState -p SubState -p InvocationID -p MainPID -p NRestarts -p ControlGroup -p Result ;;
        logs) journalctl --user -b -u pi-web.service --no-pager -o short-iso ;;
        *) echo 'Allowed: start, stop, status, logs' >&2; exit 2 ;;
      esac
    '';
  };
in
pkgs.testers.runNixOSTest {
  name = "pi-web-acceptance";
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
    # A cached, read-only image exposes only the declared transitive closure,
    # unlike the fresh driver's default whole-host /nix/store export.
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
      memorySize = 4096;
      cores = 2;
      diskSize = 8192; # Sparse guest state must fit all groups' retained traces.
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
    # Literal path avoids image -> registration -> toplevel -> image cycles.
    boot.kernelParams = [ "regInfo=/nix/.ro-store/.pi-web-registration" ];
    environment.etc."pi-web-acceptance-guest".text = "pi-web-nixos-acceptance-v1\n";
    users.users.tester = { isNormalUser = true; uid = 1000; };
    home-manager = {
      useGlobalPkgs = true;
      useUserPackages = true;
      users.tester = {
        imports = [ homeManagerModule ];
        home.stateVersion = "24.11";
        services.pi-web = {
          enable = true;
          inherit package;
          port = 30141;
          agentDir = "%h/fixtures/initial";
          environmentFile = "/home/tester/service.env";
          environment = {
            PI_OFFLINE = "1";
            NODE_ENV = "production";
            NEXT_TELEMETRY_DISABLED = "1";
            JITI_FS_CACHE = "0";
            SHELL = "${pkgs.bash}/bin/bash";
          };
        };
        systemd.user.services.pi-web.Service.TimeoutStopSec = 10;
      };
    };
    environment.systemPackages = [
      pkgs.nodejs_22 pkgs.git pkgs.bash pkgs.coreutils pkgs.curl
      pkgs.chromium pkgs.util-linux control
    ];
    # These are the production unit/module, with an ordinary unprivileged
    # service user. No host ports, host credentials, or developer home mounts.
    systemd.tmpfiles.rules = [
      "d /home/tester/fixtures 0700 tester users -"
      "d /home/tester/fixtures/initial 0700 tester users -"
      "f /home/tester/service.env 0600 tester users -"
      "d /home/tester/evidence 0700 tester users -"
    ];
  };
  testScript = builtins.replaceStrings
    [ "@support@" "@package@" "@node@" "@chromium@" "@shell@" "@controller@" ]
    [ "${support}" "${package}/lib/node_modules/@agegr/pi-web" "${pkgs.nodejs_22}/bin/node"
      "${pkgs.chromium}/bin/chromium" "${pkgs.bash}/bin/bash" (lib.getExe control) ]
    (builtins.readFile ./vm-test.py);
}
