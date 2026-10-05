{
  description = "Pi Web package and local development tools";

  # Keep the local browser close to the Chromium revision pinned by Playwright.
  # Update this with the npm Playwright version, not implicitly with a channel.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/44a91898084f46797b5fac650c7e8c9ac38c43d4";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      linuxSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forSystems =
        selected: f: nixpkgs.lib.genAttrs selected (system: f (import nixpkgs { inherit system; }));
      # Keep the shared dependency definition in this TRACKED file. Plain Git
      # flakes cannot see untracked test helpers, even in a dirty worktree.
      devModules = pkgs: nodejs:
        let
          manifests = pkgs.runCommand "pi-web-npm-manifests" { } ''
            mkdir -p "$out"
            cp ${./package.json} "$out/package.json"
            cp ${./package-lock.json} "$out/package-lock.json"
          '';
          npmCache = import ./nix/npm-deps.nix {
            inherit (pkgs) fetchNpmDeps;
            src = manifests;
          };
          npmHooks = pkgs.npmHooks.override { inherit nodejs; };
        in
        pkgs.stdenv.mkDerivation {
          pname = "pi-web-dev-modules";
          version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
          src = manifests;
          inherit nodejs;
          npmDeps = npmCache;
          npmRebuildFlags = [ "node-pty" ];
          nativeBuildInputs = [ nodejs nodejs.python npmHooks.npmConfigHook ];
          installPhase = ''
            mkdir -p "$out"
            cp -r node_modules "$out/node_modules"
          '';
        };
      testTools = pkgs:
        let
          nodejs = pkgs.nodejs_22;
          modules = devModules pkgs nodejs;
        in
        import ./nix/tests.nix { inherit pkgs nodejs modules; src = self; };
    in
    {
      packages = forSystems systems (pkgs: rec {
        pi-web = pkgs.callPackage ./nix/package.nix {
          src = self;
          nodejs = pkgs.nodejs_22;
        };
        default = pi-web;
      });

      apps = forSystems systems (pkgs: {
        default = {
          type = "app";
          program = "${pkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.pi-web}";
        };
        pi-web = self.apps.${pkgs.stdenv.hostPlatform.system}.default;
      } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux (testTools pkgs).apps);

      homeManagerModules.default = import ./nix/home-manager.nix { inherit self; };
      checks = forSystems linuxSystems (pkgs: {
        offline = (testTools pkgs).offline;
        home-manager-module =
          assert (import ./nix/home-manager-eval.nix {
            inherit (pkgs) lib;
            inherit pkgs;
            module = self.homeManagerModules.default;
          }) == "ok";
          pkgs.runCommand "pi-web-home-manager-eval" { } "touch $out";
      });

      # Nix-wrapped Chromium avoids Playwright's downloaded binary missing
      # shared libraries on NixOS. CI and non-NixOS users keep their own browser.
      devShells = forSystems linuxSystems (pkgs:
        let
          nodejs = pkgs.nodejs_22;
          modules = devModules pkgs nodejs;
        in
        {
          default = pkgs.mkShell {
            packages = [
              nodejs
              pkgs.git
              pkgs.python3
              pkgs.chromium
            ];
            shellHook = ''
              source ${pkgs.replaceVars ./nix/dev-shell.sh {
                lockFile = ./package-lock.json;
                sourceModules = "${modules}/node_modules";
              }} || exit 1
            '';
            PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
          };
          # npm dependency changes edit only the manifest and lockfile. The
          # default shell takes ownership of Nix-managed node_modules entries.
          update = pkgs.mkShell { packages = [ nodejs pkgs.git ]; };
        });
    };
}
