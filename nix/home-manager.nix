{ self }:
{ config, lib, pkgs, ... }:
let
  inherit (lib) mkEnableOption mkIf mkOption types;
  cfg = config.services.brabbler;
in
{
  options.services.brabbler = {
    enable = mkEnableOption "the Brabbler user service";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "inputs.brabbler.packages.${pkgs.stdenv.hostPlatform.system}.default";
      description = "Brabbler package, optionally overridden to match a separately packaged Pi CLI.";
    };
    hostname = mkOption {
      type = types.strMatching "[A-Za-z0-9.:_-]+";
      default = "127.0.0.1";
      description = "Address for the local HTTP listener. Keep loopback unless a trusted proxy is used.";
    };
    port = mkOption {
      type = types.port;
      default = 30141;
      description = "Local HTTP listener port.";
    };
    allowedHosts = mkOption {
      type = types.listOf (types.strMatching "[A-Za-z0-9.:_-]+");
      default = [ ];
      description = "Hostnames accepted by Brabbler, for example the reverse proxy's public hostname.";
    };
    agentDir = mkOption {
      type = types.str;
      default = "%h/.pi/agent";
      description = "Pi's mutable agent/session directory (systemd user unit specifiers are expanded).";
    };
    requireAuth = mkOption {
      type = types.bool;
      default = false;
      description = "Fail closed until local brabbler auth setup or an explicit runtime BRABBLER_PASSWORD is configured. No passphrase enters the Nix store.";
    };
    environmentFile = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "/run/secrets/brabbler-env";
      description = "Runtime-only systemd environment file for secrets; never store secret values in Nix options.";
    };
    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = { SSH_AUTH_SOCK = "%t/ssh-agent/selected.sock"; };
      description = "Non-secret environment variables passed to the user service.";
    };
  };

  config = mkIf cfg.enable {
    home.packages = [ cfg.package ];
    systemd.user.services.brabbler = {
      Unit.Description = "Brabbler";
      Service = {
        Type = "simple";
        ExecStart = "${lib.getExe cfg.package} --hostname ${cfg.hostname} --port ${toString cfg.port} --no-open";
        Restart = "on-failure";
        RestartSec = 5;
        # The Node launcher forwards SIGTERM and reports the conventional
        # 128+15 exit code after its child exits (bin/process-lifecycle.js).
        SuccessExitStatus = [ 143 ];
        UMask = "0077";
        WorkingDirectory = "%h";
        Environment = [
          "PI_CODING_AGENT_DIR=${cfg.agentDir}"
          "BRABBLER_SKIP_VERSION_CHECK=1"
          "BRABBLER_REQUIRE_AUTH=${if cfg.requireAuth then "1" else "0"}"
        ] ++ lib.mapAttrsToList (name: value: "${name}=${value}") cfg.environment
          ++ lib.optional (cfg.allowedHosts != [ ])
            "BRABBLER_ALLOWED_HOSTS=${lib.concatStringsSep "," cfg.allowedHosts}";
      } // lib.optionalAttrs (cfg.environmentFile != null) { EnvironmentFile = cfg.environmentFile; };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
