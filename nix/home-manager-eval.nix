{ lib, pkgs, module }:
let
  evaluated = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      # Minimal Home Manager-owned option surface; this test runs without
      # requiring the consumer's flake, deployment or Home Manager activation.
      ({ lib, ... }: {
        options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
        options.systemd.user.services = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
      })
      module
      {
        services.pi-web = {
          enable = true;
          allowedHosts = [ "pi.internal.example" ];
          environmentFile = "/run/secrets/pi-web-env";
          environment.SSH_AUTH_SOCK = "%t/ssh-agent/selected.sock";
        };
      }
    ];
  };
  service = evaluated.config.systemd.user.services.pi-web;
in
assert builtins.length evaluated.config.home.packages == 1;
assert service.Service.EnvironmentFile == "/run/secrets/pi-web-env";
assert service.Service.Environment == [
  "PI_CODING_AGENT_DIR=%h/.pi/agent"
  "PI_WEB_SKIP_VERSION_CHECK=1"
  "SSH_AUTH_SOCK=%t/ssh-agent/selected.sock"
  "PI_WEB_ALLOWED_HOSTS=pi.internal.example"
];
assert lib.hasInfix "/bin/pi-web --hostname" service.Service.ExecStart;
assert service.Service.UMask == "0077";
assert service.Install.WantedBy == [ "default.target" ];
"ok"
