{
  description = "Pi Web: Nix-native package, development and acceptance";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.home-manager.url = "github:nix-community/home-manager";
  inputs.home-manager.inputs.nixpkgs.follows = "nixpkgs";

  outputs = { self, nixpkgs, home-manager }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      linuxSystems = [ "x86_64-linux" "aarch64-linux" ];
      forSystems = selected: f: nixpkgs.lib.genAttrs selected
        (system: f (import nixpkgs { inherit system; }));
      sources = pkgs: import ./nix/sources.nix { inherit (pkgs) lib; root = ./.; };
      modules = pkgs: import ./nix/modules.nix {
        inherit pkgs;
        nodejs = pkgs.nodejs_24;
        src = (sources pkgs).manifests;
      };
      tests = pkgs:
        let
          core = import ./nix/tests.nix {
            inherit pkgs;
            nodejs = pkgs.nodejs_24;
            modules = modules pkgs;
            src = (sources pkgs).tests;
          };
          mkE2E = { workers ? 2 }: import ./nix/vm-test.nix {
            inherit pkgs home-manager workers;
            package = self.packages.${pkgs.stdenv.hostPlatform.system}.pi-web;
            modules = modules pkgs;
            src = (sources pkgs).tests;
            homeManagerModule = self.homeManagerModules.default;
          };
          e2e = mkE2E { };
        in {
          inherit (core) core mkCore;
          inherit e2e mkE2E;
          apps = {
            test-core = {
              type = "app";
              program = pkgs.lib.getExe (pkgs.writeShellApplication {
                name = "pi-web-test-core";
                runtimeInputs = [ pkgs.nodejs_24 pkgs.nix ];
                text = ''exec node ${self}/nix/run-core.mjs ${self} ${pkgs.stdenv.hostPlatform.system} "$@"'';
              });
            };
            test = {
              type = "app";
              program = pkgs.lib.getExe (pkgs.writeShellApplication {
                name = "pi-web-test";
                runtimeInputs = [ pkgs.nodejs_24 pkgs.python3 pkgs.nix ];
                text = ''exec node ${self}/nix/test.mjs "$@"'';
              });
            };
            test-e2e = {
              type = "app";
              program = pkgs.lib.getExe (pkgs.writeShellApplication {
                name = "pi-web-test-e2e";
                runtimeInputs = [ pkgs.nodejs_24 pkgs.python3 pkgs.nix ];
                text = ''exec node ${self}/nix/run-vm.mjs ${self} ${pkgs.stdenv.hostPlatform.system} "$@"'';
              });
            };
          };
        };
    in {
      packages = forSystems systems (pkgs: rec {
        pi-web = pkgs.callPackage ./nix/package.nix {
          src = (sources pkgs).application;
          nodejs = pkgs.nodejs_24;
          modules = modules pkgs;
        };
        default = pi-web;
      });
      apps = forSystems systems (pkgs: {
        default = {
          type = "app";
          program = pkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.pi-web;
        };
        pi-web = self.apps.${pkgs.stdenv.hostPlatform.system}.default;
      } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux (tests pkgs).apps);
      homeManagerModules.default = import ./nix/home-manager.nix { inherit self; };
      checks = forSystems linuxSystems (pkgs: { inherit (tests pkgs) core e2e; });
      lib.coreCheck = forSystems linuxSystems (pkgs: (tests pkgs).mkCore);
      lib.vmTest = forSystems linuxSystems (pkgs: (tests pkgs).mkE2E);
      devShells = forSystems linuxSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 pkgs.git pkgs.python3 ];
          shellHook = ''
            source ${pkgs.replaceVars ./nix/dev-shell.sh {
              lockFile = ./package-lock.json;
              sourceModules = "${modules pkgs}/node_modules";
            }} || exit 1
          '';
        };
        update = pkgs.mkShell { packages = [ pkgs.nodejs_24 pkgs.git ]; };
      });
    };
}
